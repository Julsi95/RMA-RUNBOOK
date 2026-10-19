-- All content placed on the published dashboard is public, including KPI widgets.
-- Keep revisions immutable by creating a new publication revision when upgrading
-- the currently published document.
do $$
declare
  current_revision uuid;
  current_content jsonb;
  public_content jsonb;
  public_revision uuid;
begin
  select p.revision_id, r.content
    into current_revision, current_content
    from public.dashboard_publication p
    join public.dashboard_revisions r on r.id = p.revision_id
   where p.singleton
   for update of p;

  if current_revision is not null then
    public_content := jsonb_set(
      current_content,
      '{containers}',
      coalesce((
        select jsonb_agg(
          jsonb_set(card.value, '{publicVisible}', 'true'::jsonb, true)
          order by card.ordinality
        )
          from jsonb_array_elements(coalesce(current_content->'containers', '[]'::jsonb))
               with ordinality as card(value, ordinality)
      ), '[]'::jsonb),
      true
    );

    if public_content is distinct from current_content then
      insert into public.dashboard_revisions(content, created_by)
      values (public_content, null)
      returning id into public_revision;

      update public.dashboard_publication
         set revision_id = public_revision,
             updated_at = now(),
             updated_by = null
       where singleton;
    end if;
  end if;
end;
$$;

-- Anonymous dashboard access returns only the document the admin explicitly
-- published. It does not expose drafts or other dashboard revisions.
create or replace function public.get_public_workspace_dashboard()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select r.content
    from public.dashboard_publication p
    join public.dashboard_revisions r on r.id = p.revision_id
   where p.singleton = true;
$$;
revoke all on function public.get_public_workspace_dashboard() from public, anon;
grant execute on function public.get_public_workspace_dashboard() to anon, authenticated;

-- Public KPI widget data is narrowly scoped: only the latest published month,
-- current result revision per employee, and only while a KPI widget is in the
-- published dashboard. The widget's pinned scoring settings are returned to
-- render its published scores; historical months remain private.
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
           latest.metrics, latest.overall_score, latest.evaluation
      from (
        select distinct on (r.employee_id)
               r.employee_id, r.employee_name_snapshot, r.employee_role_snapshot,
               r.metrics, r.overall_score, r.evaluation, r.is_deleted
          from public.kpi_results r
          join latest_month m on m.month_key = r.month_key
         order by r.employee_id, r.result_revision desc
      ) latest
     where not latest.is_deleted
  )
  select case when (select enabled from widget_enabled) and exists(select 1 from latest_month)
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
            'evaluation', result.evaluation
          )
        )
          from current_results result
      ), '{}'::jsonb)
    )
    else null
  end;
$$;
revoke all on function public.get_public_dashboard_kpi_widget() from public, anon;
grant execute on function public.get_public_dashboard_kpi_widget() to anon, authenticated;
