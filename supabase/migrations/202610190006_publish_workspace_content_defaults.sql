-- The public workspace should show the current published dashboard and current
-- app-link directory by default. KPI and Top Agents cards remain private.
-- Publish a new dashboard revision instead of mutating the historical revision.
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
          jsonb_set(
            card.value,
            '{publicVisible}',
            to_jsonb(coalesce(card.value->>'type', '') not in ('topAgents', 'kpiResult')),
            true
          ) order by card.ordinality
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

-- Existing links were already part of the RUNBOOK resource directory. Make
-- those entries visible on the public App / Links page; admins can still hide
-- any individual resource using its visibility control.
alter table public.app_links alter column is_public set default true;
update public.app_links set is_public = true where not is_public;
