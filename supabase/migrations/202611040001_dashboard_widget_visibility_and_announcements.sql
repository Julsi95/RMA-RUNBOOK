-- Public visitors can see published workspace content and public app links, but
-- must not be able to retrieve identifiable KPI results. Authenticated users
-- retain the dashboard KPI widgets.
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
         and (auth.uid() is not null or coalesce(card.value->>'type', '') not in ('topAgents', 'kpiResult'))
    ), '[]'::jsonb),
    true
  )
    from public.dashboard_publication p
    join public.dashboard_revisions r on r.id = p.revision_id
   where p.singleton = true;
$$;
revoke all on function public.get_public_workspace_dashboard() from public, anon;
grant execute on function public.get_public_workspace_dashboard() to anon, authenticated;

create or replace function public.get_public_dashboard_kpi_widget()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with published_document as (
    select r.content
      from public.dashboard_publication p
      join public.dashboard_revisions r on r.id = p.revision_id
     where p.singleton = true
  ),
  widget_enabled as (
    select exists (
      select 1
        from published_document d,
             jsonb_array_elements(coalesce(d.content->'containers', '[]'::jsonb)) as card(value)
       where card.value->>'type' in ('topAgents', 'kpiResult')
         and coalesce((card.value->>'publicVisible')::boolean, true)
    ) as enabled
  ),
  latest_month as (
    select m.month_key, m.scoring_version_id
      from public.kpi_months m
     where m.status = 'published'
     order by m.month_key desc
     limit 1
  ),
  current_results as (
    select latest.employee_id, latest.employee_name_snapshot, latest.employee_role_snapshot,
           latest.metrics, latest.overall_score, latest.evaluation, latest.source
      from (
        select distinct on (r.employee_id)
               r.employee_id, r.employee_name_snapshot, r.employee_role_snapshot,
               r.metrics, r.overall_score, r.evaluation, r.source, r.is_deleted
          from public.kpi_results r
          join latest_month m on m.month_key = r.month_key
         order by r.employee_id, r.result_revision desc
      ) latest
     where not latest.is_deleted
  )
  select case when auth.uid() is not null and (select enabled from widget_enabled) and exists(select 1 from latest_month)
    then jsonb_build_object(
      'monthKey', (select month_key from latest_month),
      'scoringSettings', (
        select version.settings
          from latest_month m
          left join public.kpi_scoring_versions version on version.id = m.scoring_version_id
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
        )
          from current_results result
      ), '{}'::jsonb)
    )
    else null
  end;
$$;
revoke all on function public.get_public_dashboard_kpi_widget() from public, anon, authenticated;
grant execute on function public.get_public_dashboard_kpi_widget() to authenticated;

-- Close the direct anonymous read path as well; hiding KPI cards alone would
-- still leave the underlying score tables queryable through the Data API.
revoke select on public.kpi_scoring_versions, public.current_kpi_scoring,
  public.kpi_months, public.kpi_results from anon;
drop policy if exists "Public KPI scoring versions" on public.kpi_scoring_versions;
drop policy if exists "Public current KPI scoring" on public.current_kpi_scoring;
drop policy if exists "Public KPI months" on public.kpi_months;
drop policy if exists "Public KPI results" on public.kpi_results;
create policy "Authenticated KPI scoring versions" on public.kpi_scoring_versions
  for select to authenticated using (auth.uid() is not null);
create policy "Authenticated current KPI scoring" on public.current_kpi_scoring
  for select to authenticated using (auth.uid() is not null);
create policy "Authenticated KPI months" on public.kpi_months
  for select to authenticated using (auth.uid() is not null);
create policy "Authenticated KPI results" on public.kpi_results
  for select to authenticated using (auth.uid() is not null);

-- Send notifications only when an announcement is added or its text/date
-- changes. The existing dashboard-published notification is replaced by these
-- more useful, announcement-specific notifications for such a publish.
create or replace function public.notify_published_dashboard_announcements()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  current_content jsonb;
  previous_content jsonb := '{}'::jsonb;
  card record;
  recipient uuid;
  card_id text;
  title_text text;
  body_text text;
  date_text text;
  event_key_text text;
  announcement_changed boolean := false;
begin
  if tg_op = 'UPDATE' and old.revision_id is not distinct from new.revision_id then
    return null;
  end if;

  select r.content into current_content
    from public.dashboard_revisions r where r.id = new.revision_id;
  if current_content is null then return null; end if;

  if tg_op = 'UPDATE' and old.revision_id is not null then
    select r.content into previous_content
      from public.dashboard_revisions r where r.id = old.revision_id;
    previous_content := coalesce(previous_content, '{}'::jsonb);
  end if;

  for card in
    select entry.value
      from jsonb_array_elements(coalesce(current_content->'containers', '[]'::jsonb)) as entry(value)
     where entry.value->>'type' = 'announcement'
       and (nullif(btrim(entry.value->>'title'), '') is not null
         or nullif(btrim(entry.value->>'body'), '') is not null
         or nullif(btrim(entry.value->>'description'), '') is not null)
  loop
    card_id := coalesce(nullif(card.value->>'id', ''), md5(card.value::text));
    if card_id !~ '^[A-Za-z0-9_-]{1,100}$' then continue; end if;
    title_text := left(coalesce(nullif(btrim(card.value->>'title'), ''), 'Team announcement'), 200);
    body_text := left(coalesce(nullif(btrim(card.value->>'body'), ''), nullif(btrim(card.value->>'description'), ''), 'A new team announcement is available.'), 1000);
    date_text := coalesce(card.value->>'date', '');

    if not exists (
      select 1
        from jsonb_array_elements(coalesce(previous_content->'containers', '[]'::jsonb)) as prior(value)
       where prior.value->>'id' = card_id
         and prior.value->>'type' = 'announcement'
         and coalesce(prior.value->>'title', '') = coalesce(card.value->>'title', '')
         and coalesce(prior.value->>'body', '') = coalesce(card.value->>'body', '')
         and coalesce(prior.value->>'description', '') = coalesce(card.value->>'description', '')
         and coalesce(prior.value->>'date', '') = coalesce(card.value->>'date', '')
    ) then
      announcement_changed := true;
      event_key_text := 'dashboard-announcement:' || card_id || ':' || md5(title_text || E'\n' || body_text || E'\n' || date_text);
      for recipient in select account.user_id from public.app_accounts account loop
        perform public.create_runbook_notification(
          recipient,
          event_key_text,
          'dashboard',
          title_text,
          body_text,
          '/?announcement=' || card_id
        );
      end loop;
    end if;
  end loop;

  if announcement_changed then
    delete from public.user_notifications
     where event_key = 'dashboard:' || new.revision_id::text;
  end if;
  return null;
end;
$$;
revoke all on function public.notify_published_dashboard_announcements() from public, anon, authenticated;
drop trigger if exists zzzz_notify_published_dashboard_announcements on public.dashboard_publication;
create trigger zzzz_notify_published_dashboard_announcements
  after insert or update on public.dashboard_publication
  for each row execute function public.notify_published_dashboard_announcements();
