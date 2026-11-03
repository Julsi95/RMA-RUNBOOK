-- Let authorized editors clear a mistaken monthly import while retaining
-- append-only result revisions and a 30-day recovery snapshot.
create or replace function public.reset_kpi_month_results(p_month text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.kpi_results%rowtype;
  next_revision integer;
  before_state jsonb;
  actor text;
  event_id uuid;
  reset_count integer;
begin
  if not public.is_runbook_editor() then
    raise exception 'Editor access is required.' using errcode='42501';
  end if;
  if coalesce(p_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'A valid KPI month is required.' using errcode='22023';
  end if;

  perform 1 from public.kpi_months where month_key = p_month for update;
  if not found then
    raise exception 'The KPI month does not exist.' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_id', latest.employee_id,
    'had_record', true,
    'employee_name_snapshot', latest.employee_name_snapshot,
    'employee_role_snapshot', latest.employee_role_snapshot,
    'metrics', latest.metrics,
    'overall_score', latest.overall_score,
    'evaluation', latest.evaluation,
    'source', latest.source
  ) order by latest.employee_id), '[]'::jsonb)
    into before_state
    from (
      select distinct on (result.employee_id) result.*
        from public.kpi_results result
       where result.month_key = p_month
       order by result.employee_id, result.result_revision desc
    ) latest
   where not latest.is_deleted;

  reset_count := jsonb_array_length(before_state);
  if reset_count = 0 then return 0; end if;

  perform set_config('runbook.skip_row_audit', 'on', true);
  for current_row in
    select latest.*
      from (
        select distinct on (result.employee_id) result.*
          from public.kpi_results result
         where result.month_key = p_month
         order by result.employee_id, result.result_revision desc
      ) latest
     where not latest.is_deleted
  loop
    select coalesce(max(result.result_revision), 0) + 1
      into next_revision
      from public.kpi_results result
     where result.month_key = p_month
       and result.employee_id = current_row.employee_id;

    insert into public.kpi_results(
      month_key, employee_id, employee_name_snapshot, employee_role_snapshot,
      metrics, overall_score, evaluation, result_revision, source, updated_by, is_deleted
    ) values (
      p_month, current_row.employee_id, current_row.employee_name_snapshot,
      current_row.employee_role_snapshot, current_row.metrics, current_row.overall_score,
      current_row.evaluation, next_revision, current_row.source, auth.uid(), true
    );
  end loop;

  select coalesce(nullif(account.display_name, ''), 'RUNBOOK editor')
    into actor
    from public.app_accounts account
   where account.user_id = auth.uid();

  insert into public.history_events(
    actor_id, actor_label, module, entity_type, entity_id, action, summary, recoverable
  ) values (
    auth.uid(), coalesce(actor, 'RUNBOOK editor'), 'Monthly KPI / QA', 'kpi_months',
    p_month, 'delete', 'Reset ' || reset_count || ' KPI / QA result(s) for ' || p_month || '.', true
  ) returning id into event_id;

  insert into public.history_recovery(event_id, before_state, after_state, expires_at)
  values (event_id, before_state, '[]'::jsonb, now() + interval '30 days');

  return reset_count;
end;
$$;
revoke all on function public.reset_kpi_month_results(text) from public, anon;
grant execute on function public.reset_kpi_month_results(text) to authenticated;

-- Public and authenticated dashboard widgets should choose the latest
-- published month that still has current, non-deleted result rows.
create or replace function public.get_public_dashboard_kpi_widget()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with published_document as (
    select revision.content
      from public.dashboard_publication publication
      join public.dashboard_revisions revision on revision.id = publication.revision_id
     where publication.singleton = true
  ),
  widget_enabled as (
    select exists (
      select 1
        from published_document document,
             jsonb_array_elements(coalesce(document.content->'containers', '[]'::jsonb)) as card(value)
       where card.value->>'type' in ('topAgents', 'kpiResult')
         and coalesce((card.value->>'publicVisible')::boolean, true)
    ) as enabled
  ),
  latest_month as (
    select month.month_key, month.scoring_version_id
      from public.kpi_months month
     where month.status = 'published'
       and exists (
         select 1
           from public.kpi_results result
          where result.month_key = month.month_key
            and not result.is_deleted
            and result.result_revision = (
              select max(current_result.result_revision)
                from public.kpi_results current_result
               where current_result.month_key = result.month_key
                 and current_result.employee_id = result.employee_id
            )
       )
     order by month.month_key desc
     limit 1
  ),
  current_results as (
    select latest.employee_id, latest.employee_name_snapshot, latest.employee_role_snapshot,
           latest.metrics, latest.overall_score, latest.evaluation, latest.source
      from (
        select distinct on (result.employee_id)
               result.employee_id, result.employee_name_snapshot, result.employee_role_snapshot,
               result.metrics, result.overall_score, result.evaluation, result.source,
               result.result_revision, result.is_deleted
          from public.kpi_results result
          join latest_month month on month.month_key = result.month_key
         order by result.employee_id, result.result_revision desc
      ) latest
     where not latest.is_deleted
  )
  select case when auth.uid() is not null and (select enabled from widget_enabled)
    then jsonb_build_object(
      'monthKey', (select month_key from latest_month),
      'scoringSettings', (
        select version.settings
          from latest_month month
          left join public.kpi_scoring_versions version on version.id = month.scoring_version_id
      ),
      'records', coalesce((
        select jsonb_object_agg(
          result.employee_id,
          jsonb_build_object(
            'memberId', result.employee_id,
            'memberName', result.employee_name_snapshot,
            'role', result.employee_role_snapshot,
            'metrics', result.metrics,
            'overallScore', result.overall_score,
            'evaluation', result.evaluation,
            'source', result.source
          )
        ) from current_results result
      ), '{}'::jsonb)
    )
    else null
  end;
$$;
revoke all on function public.get_public_dashboard_kpi_widget() from public, anon, authenticated;
grant execute on function public.get_public_dashboard_kpi_widget() to authenticated;

create or replace function public.get_public_dashboard_recognition()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with published_document as (
    select revision.content
      from public.dashboard_publication publication
      join public.dashboard_revisions revision on revision.id = publication.revision_id
     where publication.singleton = true
  ),
  enabled as (
    select exists (
      select 1
        from published_document document,
             jsonb_array_elements(coalesce(document.content->'containers', '[]'::jsonb)) as card(value)
       where card.value->>'type' = 'topAgents'
         and coalesce((card.value->>'publicVisible')::boolean, true)
    ) as value
  ),
  latest_month as (
    select month.month_key
      from public.kpi_months month
     where month.status = 'published'
       and exists (
         select 1
           from public.kpi_results result
          where result.month_key = month.month_key
            and not result.is_deleted
            and result.result_revision = (
              select max(current_result.result_revision)
                from public.kpi_results current_result
               where current_result.month_key = result.month_key
                 and current_result.employee_id = result.employee_id
            )
       )
     order by month.month_key desc
     limit 1
  ),
  season_calendar as (
    select to_char(
      (latest.month_key || '-01')::date - make_interval(months => offsets.month_offset),
      'YYYY-MM'
    ) as month_key,
    offsets.month_offset
      from latest_month latest
      cross join generate_series(0, 11) as offsets(month_offset)
  ),
  current_results as (
    select distinct on (result.month_key, result.employee_id)
           result.month_key, result.employee_id, result.employee_name_snapshot,
           result.employee_role_snapshot, result.metrics, result.overall_score,
           result.result_revision, result.is_deleted
      from public.kpi_results result
      join season_calendar calendar on calendar.month_key = result.month_key
      join public.kpi_months published_month
        on published_month.month_key = result.month_key
       and published_month.status = 'published'
     order by result.month_key, result.employee_id, result.result_revision desc
  ),
  ranked_months as (
    select result.month_key, result.employee_id, result.employee_name_snapshot,
           coalesce(nullif((regexp_match(coalesce(result.metrics->>'_importedRank', ''), '[0-9]+'))[1], '')::integer, null) as imported_rank,
           row_number() over (
             partition by result.month_key
             order by
               ((regexp_match(coalesce(result.metrics->>'_importedRank', ''), '[0-9]+'))[1] is null),
               ((regexp_match(coalesce(result.metrics->>'_importedRank', ''), '[0-9]+'))[1])::integer nulls last,
               result.overall_score desc nulls last,
               result.employee_name_snapshot
           ) as rank_order
      from current_results result
     where not result.is_deleted
  ),
  current_top_three as (
    select ranked.*
      from ranked_months ranked
      join latest_month latest on latest.month_key = ranked.month_key
     where ranked.rank_order <= 3
  ),
  directory as (
    select employee.id, employee.photo_url, employee.photo_path
      from public.get_public_workspace_employee_directory() employee
  ),
  recognition as (
    select current.employee_id, current.employee_name_snapshot,
           coalesce(current.imported_rank, current.rank_order)::integer as display_rank,
           coalesce(directory.photo_url, '') as photo_url,
           directory.photo_path,
           coalesce((
             select min(calendar.month_offset)
               from season_calendar calendar
               left join ranked_months prior
                 on prior.month_key = calendar.month_key
                and prior.employee_id = current.employee_id
              where prior.employee_id is null or prior.rank_order > 3
           ), 12)::integer as streak_months
      from current_top_three current
      left join directory on directory.id = current.employee_id
     order by current.rank_order
  )
  select case when (select value from enabled) and exists(select 1 from latest_month)
    then jsonb_build_object(
      'monthKey', (select month_key from latest_month),
      'agents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'memberId', recognition.employee_id,
          'name', recognition.employee_name_snapshot,
          'rank', recognition.display_rank,
          'photoUrl', recognition.photo_url,
          'photoPath', recognition.photo_path,
          'streakMonths', recognition.streak_months
        ) order by recognition.display_rank, recognition.employee_name_snapshot)
          from recognition
      ), '[]'::jsonb)
    )
    else null
  end;
$$;
revoke all on function public.get_public_dashboard_recognition() from public;
grant execute on function public.get_public_dashboard_recognition() to anon, authenticated;
