-- Publish only approved recognition details for the public Top Agents card.
-- Scores, metric values, evaluations, and scoring settings remain unavailable
-- to anon. Streaks count consecutive published calendar months in the last year
-- where the employee placed in the top three.
create or replace function public.get_public_workspace_dashboard()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_set(
    coalesce(r.content, '{}'::jsonb),
    '{containers}',
    coalesce((
      select jsonb_agg(card.value order by card.ordinality)
        from jsonb_array_elements(coalesce(r.content->'containers', '[]'::jsonb)) with ordinality as card(value, ordinality)
       where coalesce((card.value->>'publicVisible')::boolean, true)
         and (auth.uid() is not null or coalesce(card.value->>'type', '') <> 'kpiResult')
    ), '[]'::jsonb),
    true
  )
    from public.dashboard_publication p
    join public.dashboard_revisions r on r.id = p.revision_id
   where p.singleton = true;
$$;
revoke all on function public.get_public_workspace_dashboard() from public, anon;
grant execute on function public.get_public_workspace_dashboard() to anon, authenticated;

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
     order by month.month_key desc
     limit 1
  ),
  season_calendar as (
    select to_char(
      (latest_month.month_key || '-01')::date - make_interval(months => offsets.month_offset),
      'YYYY-MM'
    ) as month_key,
    offsets.month_offset
      from latest_month
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
           result.employee_role_snapshot,
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
