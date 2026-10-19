-- Anonymous visitors can read only explicitly published workspace content.
-- Operational tables remain inaccessible to anon; writes stay behind editor checks.

alter table public.app_links
  add column if not exists is_public boolean not null default false;

create or replace function public.get_public_workspace_branding()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('sidebar_title', b.sidebar_title, 'logo_path', b.logo_path)
    from public.workspace_branding b
   where b.singleton = true;
$$;
revoke all on function public.get_public_workspace_branding() from public, anon;
grant execute on function public.get_public_workspace_branding() to anon, authenticated;

create or replace function public.get_public_app_links()
returns table(id text, name text, url text, application text, group_name text, description text, sort_order integer)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.name, l.url, l.application, l.group_name, l.description, l.sort_order
    from public.app_links l
   where l.is_public
   order by l.sort_order, l.name;
$$;
revoke all on function public.get_public_app_links() from public, anon;
grant execute on function public.get_public_app_links() to anon, authenticated;

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
       where card.value->'publicVisible' = 'true'::jsonb
         and coalesce(card.value->>'type', '') not in ('topAgents', 'kpiResult')
    ), '[]'::jsonb),
    true
  )
    from public.dashboard_publication p
    join public.dashboard_revisions r on r.id = p.revision_id
   where p.singleton = true;
$$;
revoke all on function public.get_public_workspace_dashboard() from public, anon;
grant execute on function public.get_public_workspace_dashboard() to anon, authenticated;

create or replace function public.get_public_workspace_employee_directory()
returns table(
  id text, name text, role text, hierarchy_roles text[], manager_id text, mentor_id text,
  photo_url text, photo_path text, sort_order integer, profile jsonb
)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.role, e.hierarchy_roles, e.manager_id, e.mentor_id,
         case when coalesce(p.photo_public, true) then e.photo_url else '' end,
         case when coalesce(p.photo_public, true) then nullif(e.photo_path, '') else null end,
         e.sort_order,
         jsonb_strip_nulls(jsonb_build_object(
           'hierarchy_roles', to_jsonb(e.hierarchy_roles),
           'birthday', case when p.birthday_public then p.birthday::text end,
           'hire_date', case when p.hire_date_public then p.hire_date::text end,
           'personality', case when p.personality_public then p.personality end,
           'summary', case when p.summary_public then p.summary end,
           'custom_fields', (
             select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
               from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) as field(k, v)
              where jsonb_typeof(p.custom_field_visibility -> k) = 'boolean'
                and (p.custom_field_visibility ->> k) = 'true'
           )
         ))
    from public.employees e
    left join public.employee_profiles p on p.employee_id = e.id
   where e.deleted_at is null
   order by e.sort_order, e.name;
$$;
revoke all on function public.get_public_workspace_employee_directory() from public, anon;
grant execute on function public.get_public_workspace_employee_directory() to anon, authenticated;

create or replace function public.get_public_agent_profile_field_definitions()
returns table(id text, label text, field_type text, sort_order integer)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.label, d.field_type, d.sort_order
    from public.agent_profile_field_definitions d
   order by d.sort_order, d.label;
$$;
revoke all on function public.get_public_agent_profile_field_definitions() from public, anon;
grant execute on function public.get_public_agent_profile_field_definitions() to anon, authenticated;

create or replace function public.can_read_public_runbook_profile_photo(p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.employees e
      left join public.employee_profiles p on p.employee_id = e.id
     where e.photo_path = p_path
       and e.deleted_at is null
       and coalesce(p.photo_public, true)
  );
$$;
revoke all on function public.can_read_public_runbook_profile_photo(text) from public, anon;
grant execute on function public.can_read_public_runbook_profile_photo(text) to anon, authenticated;

-- Replace the older photo policy: its helper now requires an authenticated
-- RUNBOOK session, so anonymous requests must use the visibility-aware helper.
drop policy if exists "Public visible profile photos" on storage.objects;
drop policy if exists "Anonymous read visible employee profile photos" on storage.objects;
create policy "Anonymous read visible employee profile photos" on storage.objects
  for select to anon
  using (bucket_id = 'runbook-private' and public.can_read_public_runbook_profile_photo(name));

-- Preserve all existing authenticated editor checks, audit history, and atomic replacement behavior.
create or replace function public.save_app_links(p_items jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare before_state jsonb; actor text; ev uuid; act text; item jsonb; seq integer; ids text[]; row_item record;
begin
  if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
  if coalesce(jsonb_typeof(p_items),'')<>'array' then raise exception 'Application links must be an array.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) as entry(value)
    where coalesce(value->>'id','')='' or coalesce(trim(value->>'name'),'')='' or coalesce(jsonb_typeof(value),'')<>'object') then
    raise exception 'Each application link needs an id and a name.' using errcode='22023';
  end if;
  select array_agg(value->>'id') into ids from jsonb_array_elements(p_items) as entry(value);
  if coalesce(cardinality(ids),0)<>(select count(distinct value->>'id') from jsonb_array_elements(p_items) as entry(value)) then
    raise exception 'Application link ids must be unique.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'url',l.url,'application',l.application,
    'group',l.group_name,'description',l.description,'publicVisible',l.is_public) order by l.sort_order),'[]'::jsonb)
    into before_state from public.app_links l;

  perform set_config('runbook.skip_row_audit','on',true);
  delete from public.app_links where not (id=any(coalesce(ids,array[]::text[])));
  for row_item in select value as item_value,(ordinality-1)::integer as item_order from jsonb_array_elements(p_items) with ordinality loop
    item := row_item.item_value;
    seq := row_item.item_order;
    insert into public.app_links(id,name,url,application,group_name,description,sort_order,is_public)
    values(item->>'id',trim(item->>'name'),coalesce(item->>'url',''),coalesce(item->>'application',''),
      coalesce(nullif(item->>'group',''),nullif(item->>'group_name',''),'General'),coalesce(item->>'description',''),seq,
      coalesce((item->>'publicVisible')::boolean,false))
    on conflict(id) do update set name=excluded.name,url=excluded.url,application=excluded.application,
      group_name=excluded.group_name,description=excluded.description,sort_order=excluded.sort_order,
      is_public=excluded.is_public,updated_at=now();
  end loop;

  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
  act := case when jsonb_array_length(before_state)=0 then 'create' else 'update' end;
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'App / Links','app_links','collection',act,
    initcap(act)||' application links.',jsonb_array_length(before_state)>0) returning id into ev;
  if jsonb_array_length(before_state)>0 then
    insert into public.history_recovery(event_id,before_state,after_state,expires_at)
    values(ev,before_state,p_items,now()+interval '30 days');
  end if;
end $$;
revoke all on function public.get_public_app_links() from public;
revoke all on function public.get_public_workspace_dashboard() from public;
revoke all on function public.get_public_workspace_employee_directory() from public;
revoke all on function public.get_public_agent_profile_field_definitions() from public;
revoke all on function public.can_read_public_runbook_profile_photo(text) from public;
revoke all on function public.get_public_workspace_branding() from public;
revoke all on function public.save_app_links(jsonb) from public, anon;
grant execute on function public.save_app_links(jsonb) to authenticated;
