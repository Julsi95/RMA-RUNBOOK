-- Normalize shared reporting so employees can have any number of peer managers.
-- Keep manager_id/co_manager_id as compatibility columns for existing features.

create table if not exists public.employee_reporting_managers (
  employee_id text not null references public.employees(id) on delete cascade,
  manager_id text not null references public.employees(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  primary key (employee_id, manager_id),
  unique (employee_id, sort_order),
  check (employee_id <> manager_id)
);

insert into public.employee_reporting_managers(employee_id, manager_id, sort_order)
select e.id, linked.manager_id, linked.sort_order
  from public.employees e
 cross join lateral (
   values (e.manager_id, 0), (e.co_manager_id, 1)
 ) as linked(manager_id, sort_order)
 where e.deleted_at is null and linked.manager_id is not null
on conflict (employee_id, manager_id) do nothing;

alter table public.employee_reporting_managers enable row level security;
revoke all on public.employee_reporting_managers from public, anon, authenticated;
grant select on public.employee_reporting_managers to anon, authenticated;

create or replace function public.is_active_employee_reporting_link(p_employee_id text, p_manager_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.employees employee
    join public.employees manager on manager.id = p_manager_id
    where employee.id = p_employee_id
      and employee.deleted_at is null
      and manager.deleted_at is null
  );
$$;
revoke all on function public.is_active_employee_reporting_link(text, text) from public;
grant execute on function public.is_active_employee_reporting_link(text, text) to anon, authenticated;

drop policy if exists "Read active employee reporting links" on public.employee_reporting_managers;
create policy "Read active employee reporting links"
  on public.employee_reporting_managers for select to anon, authenticated
  using (public.is_active_employee_reporting_link(employee_id, manager_id));

create index if not exists employee_reporting_managers_manager_idx
  on public.employee_reporting_managers(manager_id, employee_id);

-- Keep older clients that still write the compatibility columns functional
-- during deployment. The new graph RPC replaces these links with the full list
-- later in the same transaction.
create or replace function public.sync_legacy_employee_reporting_links()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.manager_id is not distinct from new.manager_id
       and old.co_manager_id is not distinct from new.co_manager_id then
      return new;
    end if;
  end if;
  delete from public.employee_reporting_managers where employee_id = new.id;
  insert into public.employee_reporting_managers(employee_id, manager_id, sort_order)
  select new.id, linked.manager_id, linked.sort_order
    from (values (new.manager_id, 0), (new.co_manager_id, 1)) as linked(manager_id, sort_order)
   where linked.manager_id is not null
  on conflict (employee_id, manager_id) do nothing;
  return new;
end;
$$;
revoke all on function public.sync_legacy_employee_reporting_links() from public, anon, authenticated;
drop trigger if exists employees_sync_legacy_reporting_links on public.employees;
create trigger employees_sync_legacy_reporting_links
after insert or update of manager_id, co_manager_id on public.employees
for each row execute function public.sync_legacy_employee_reporting_links();

create or replace function public.validate_employee_reporting_graph()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.employees employee
     where employee.deleted_at is null
       and employee.role in ('Campaign Specialist', 'Senior Agent', 'Customer Rep')
       and not exists (select 1 from public.employee_reporting_managers relation where relation.employee_id = employee.id)
  ) then
    raise exception 'Campaign Specialists, Senior Agents, and Customer Reps need an eligible reporting manager.' using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.employee_reporting_managers relation
      join public.employees employee on employee.id = relation.employee_id and employee.deleted_at is null
      left join public.employees manager on manager.id = relation.manager_id
     where manager.id is null or manager.deleted_at is not null
        or employee.id = manager.id
        or not case employee.role
          when 'Campaign Specialist' then
            coalesce(manager.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
            or lower(btrim(coalesce(manager.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
          when 'Senior Agent' then
            manager.role = 'Campaign Specialist'
            or coalesce(manager.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
            or lower(btrim(coalesce(manager.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
          when 'Customer Rep' then manager.role in ('Campaign Specialist', 'Senior Agent')
          else true
        end
  ) then
    raise exception 'Each reporting manager must be active and eligible for the employee role.' using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.employee_reporting_managers relation
      join public.employees employee on employee.id = relation.employee_id and employee.deleted_at is null
     group by employee.id, employee.role
    having count(*) > 1 and employee.role = 'Campaign Specialist'
  ) then
    raise exception 'Campaign Specialists may have one TL/STL reporting manager.' using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.employee_reporting_managers relation
      join public.employees employee on employee.id = relation.employee_id and employee.deleted_at is null
      join public.employees manager on manager.id = relation.manager_id and manager.deleted_at is null
     group by employee.id, employee.role
    having count(*) > 1 and (
      (employee.role = 'Senior Agent' and bool_or(manager.role <> 'Campaign Specialist'))
      or (employee.role not in ('Senior Agent', 'Customer Rep'))
      or count(distinct coalesce(manager.manager_id, '')) > 1
    )
  ) then
    raise exception 'Shared managers must be eligible peers in the same reporting branch.' using errcode = '23514';
  end if;

  if exists (
    with recursive paths(origin_id, current_id, visited, cycle_found) as (
      select relation.employee_id, relation.manager_id,
             array[relation.employee_id, relation.manager_id]::text[],
             relation.employee_id = relation.manager_id
        from public.employee_reporting_managers relation
        join public.employees employee on employee.id = relation.employee_id and employee.deleted_at is null
      union all
      select paths.origin_id, relation.manager_id, paths.visited || relation.manager_id,
             relation.manager_id = any(paths.visited)
        from paths
        join public.employee_reporting_managers relation on relation.employee_id = paths.current_id
       where not paths.cycle_found
    )
    select 1 from paths where cycle_found
  ) then
    raise exception 'Reporting managers cannot create a cycle in the organization chart.' using errcode = '23514';
  end if;

  return null;
end;
$$;
revoke all on function public.validate_employee_reporting_graph() from public, anon, authenticated;

-- The new graph validator replaces the two-manager-only employee trigger.
drop trigger if exists employee_reporting_roles_guard on public.employees;

drop trigger if exists employee_reporting_graph_guard on public.employee_reporting_managers;
create constraint trigger employee_reporting_graph_guard
after insert or update or delete on public.employee_reporting_managers
deferrable initially deferred for each row
execute function public.validate_employee_reporting_graph();

drop trigger if exists employee_reporting_graph_employee_guard on public.employees;
create constraint trigger employee_reporting_graph_employee_guard
after insert or update on public.employees
deferrable initially deferred for each row
execute function public.validate_employee_reporting_graph();

create or replace function public.save_organization_reporting_graph(p_members jsonb, p_deleted_id text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  item record;
  manager_id text;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_editor() then
    raise exception 'Administrator access is required to change organization reporting.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_members, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid organization member payload.' using errcode = '22023';
  end if;

  for item in
    select * from jsonb_to_recordset(coalesce(p_members, '[]'::jsonb)) as row_data(
      id text, name text, role text, hierarchy_roles text[], manager_id text, co_manager_id text,
      reporting_manager_ids text[], team text, mentor_id text, photo_url text, photo_path text, sort_order integer
    )
  loop
    if item.id is null or nullif(btrim(item.name), '') is null or length(item.name) > 80 then
      raise exception 'Each employee needs a name of 1 to 80 characters.' using errcode = '22023';
    end if;

    insert into public.employees(id, name, role, hierarchy_roles, manager_id, co_manager_id, team, mentor_id, photo_url, photo_path, sort_order)
    values (
      item.id, btrim(item.name), coalesce(item.role, ''), coalesce(item.hierarchy_roles, '{}'::text[]),
      item.reporting_manager_ids[1], item.reporting_manager_ids[2], nullif(item.team, ''), item.mentor_id,
      coalesce(item.photo_url, ''), item.photo_path, coalesce(item.sort_order, 0)
    )
    on conflict (id) do update set
      name = excluded.name,
      role = excluded.role,
      hierarchy_roles = excluded.hierarchy_roles,
      manager_id = excluded.manager_id,
      co_manager_id = excluded.co_manager_id,
      team = excluded.team,
      mentor_id = excluded.mentor_id,
      photo_url = excluded.photo_url,
      photo_path = excluded.photo_path,
      sort_order = excluded.sort_order,
      updated_at = now();

    delete from public.employee_reporting_managers where employee_id = item.id;
    for manager_id in select distinct unnest(coalesce(item.reporting_manager_ids, '{}'::text[])) loop
      insert into public.employee_reporting_managers(employee_id, manager_id, sort_order)
      values (item.id, manager_id, array_position(item.reporting_manager_ids, manager_id) - 1);
    end loop;
  end loop;

  if p_deleted_id is not null then
    update public.employees
       set deleted_at = now(), deleted_by = auth.uid(), purge_after = now() + interval '30 days', updated_at = now()
     where id = p_deleted_id and deleted_at is null;
    if not found then raise exception 'Active employee not found.' using errcode = 'P0002'; end if;
  end if;
end;
$$;
revoke all on function public.save_organization_reporting_graph(jsonb, text) from public, anon;
grant execute on function public.save_organization_reporting_graph(jsonb, text) to authenticated;

create or replace function public.get_public_employee_directory()
returns table(id text, name text, role text, manager_id text, mentor_id text, photo_url text, photo_path text, profile jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.role, e.manager_id, e.mentor_id,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_url else '' end,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_path else null end,
         jsonb_strip_nulls(jsonb_build_object(
           'hierarchy_roles', to_jsonb(e.hierarchy_roles),
           'co_manager_id', e.co_manager_id,
           'reporting_manager_ids', coalesce((select jsonb_agg(r.manager_id order by r.sort_order) from public.employee_reporting_managers r where r.employee_id = e.id), '[]'::jsonb),
           'team', e.team,
           'birthday', case when public.is_runbook_editor() or coalesce(p.birthday_public, false) then p.birthday::text end,
           'birthday_public', coalesce(p.birthday_public, false),
           'hire_date', case when public.is_runbook_editor() or p.hire_date_public then p.hire_date::text end,
           'personality', case when public.is_runbook_editor() or p.personality_public then p.personality end,
           'summary', case when public.is_runbook_editor() or p.summary_public then p.summary end,
           'custom_fields', case when public.is_runbook_editor() then p.custom_fields else (
             select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) as field(k, v)
              where jsonb_typeof(p.custom_field_visibility -> k) = 'boolean' and (p.custom_field_visibility ->> k) = 'true'
           ) end,
           'custom_field_visibility', case when public.is_runbook_editor() then p.custom_field_visibility end
         ))
    from public.employees e left join public.employee_profiles p on p.employee_id = e.id
   where public.is_current_runbook_session() and e.deleted_at is null order by e.sort_order, e.name;
$$;
revoke all on function public.get_public_employee_directory() from public, anon;
grant execute on function public.get_public_employee_directory() to authenticated;

create or replace function public.get_public_workspace_employee_directory()
returns table(id text, name text, role text, hierarchy_roles text[], manager_id text, mentor_id text, photo_url text, photo_path text, sort_order integer, profile jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.role, e.hierarchy_roles, e.manager_id, e.mentor_id,
         case when coalesce(p.photo_public, true) then e.photo_url else '' end,
         case when coalesce(p.photo_public, true) then nullif(e.photo_path, '') else null end,
         e.sort_order,
         jsonb_strip_nulls(jsonb_build_object(
           'hierarchy_roles', to_jsonb(e.hierarchy_roles),
           'co_manager_id', e.co_manager_id,
           'reporting_manager_ids', coalesce((select jsonb_agg(r.manager_id order by r.sort_order) from public.employee_reporting_managers r where r.employee_id = e.id), '[]'::jsonb),
           'team', e.team,
           'birthday', case when p.birthday_public then p.birthday::text end,
           'hire_date', case when p.hire_date_public then p.hire_date::text end,
           'personality', case when p.personality_public then p.personality end,
           'summary', case when p.summary_public then p.summary end,
           'custom_fields', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) as field(k, v) where jsonb_typeof(p.custom_field_visibility -> k) = 'boolean' and (p.custom_field_visibility ->> k) = 'true')
         ))
    from public.employees e left join public.employee_profiles p on p.employee_id = e.id
   where e.deleted_at is null order by e.sort_order, e.name;
$$;
revoke all on function public.get_public_workspace_employee_directory() from public;
grant execute on function public.get_public_workspace_employee_directory() to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'employee_reporting_managers') then
    alter publication supabase_realtime add table public.employee_reporting_managers;
  end if;
end;
$$;

-- Keep employee history snapshots complete when an Org Chart edit changes
-- reporting links. The audit trigger must run before the legacy-link bridge
-- updates the compatibility relationship rows.
drop trigger if exists employees_sync_legacy_reporting_links on public.employees;
drop trigger if exists zzz_employees_sync_legacy_reporting_links on public.employees;
create trigger zzz_employees_sync_legacy_reporting_links
after insert or update of manager_id, co_manager_id on public.employees
for each row execute function public.sync_legacy_employee_reporting_links();

create or replace function public.record_runbook_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare old_row jsonb; new_row jsonb; data_row jsonb; record_key text; mod text; act text; actor text; ev uuid; purge_after_value timestamptz;
begin
  if (select auth.uid()) is null or current_setting('runbook.skip_row_audit',true)='on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'employees' and tg_op = 'DELETE' then
    purge_after_value := nullif(to_jsonb(old)->>'purge_after','')::timestamptz;
    if purge_after_value is not null and purge_after_value <= now() then return old; end if;
  end if;
  old_row := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  new_row := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  if tg_table_name = 'employees' then
    if old_row is not null then
      old_row := old_row || jsonb_build_object('reporting_manager_ids', coalesce((
        select jsonb_agg(relation.manager_id order by relation.sort_order)
          from public.employee_reporting_managers relation where relation.employee_id = old_row->>'id'
      ), '[]'::jsonb));
    end if;
    if new_row is not null then
      new_row := new_row || jsonb_build_object('reporting_manager_ids', coalesce((
        select jsonb_agg(relation.manager_id order by relation.sort_order)
          from public.employee_reporting_managers relation where relation.employee_id = new_row->>'id'
      ), '[]'::jsonb));
    end if;
  end if;
  data_row := coalesce(new_row,old_row);
  record_key := coalesce(data_row->>'id',data_row->>'employee_id',data_row->>'plan_date',data_row->>'month_start',data_row->>'month_key',data_row->>'owner_id','record');
  mod := case when tg_table_name like 'employee%' then 'Agent profiles'
    when tg_table_name like 'project%' then 'Project coverage' when tg_table_name like 'seat_%' then 'Seat plan'
    when tg_table_name like 'call_%' then 'Inbound call time' when tg_table_name like 'work_%' then 'Work schedule'
    when tg_table_name like 'vl_%' then 'VL credits' when tg_table_name like 'qa_%' then 'QA parameters'
    when tg_table_name like 'kpi_%' or tg_table_name='current_kpi_scoring' then 'Monthly KPI / QA'
    when tg_table_name like 'dashboard_%' then 'Dashboard' when tg_table_name='app_links' then 'App / Links'
    else 'Workspace' end;
  act := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;
  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=(select auth.uid());
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values((select auth.uid()),coalesce(actor,'RUNBOOK editor'),mod,tg_table_name,record_key,act,initcap(act)||' '||tg_table_name||' in '||mod||'.',tg_op in ('UPDATE','DELETE'))
  returning id into ev;
  if tg_op in ('UPDATE','DELETE') then
    insert into public.history_recovery(event_id,before_state,after_state) values(ev,old_row,new_row);
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

create or replace function public.restore_history_event(p_event_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  target public.history_events%rowtype;
  snapshot jsonb;
  actor text;
  table_name text;
  key_column text;
  key_value text;
  reporting_manager_id text;
  reporting_position bigint;
  reporting_snapshot jsonb;
begin
  if not public.is_runbook_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  select * into target from public.history_events where id=p_event_id for update;
  if not found then raise exception 'History entry was not found.' using errcode='P0002'; end if;
  if not target.recoverable or target.expires_at<=now() then raise exception 'This recovery period has expired.' using errcode='22023'; end if;
  if target.restored_at is not null then raise exception 'This history entry has already been restored.' using errcode='22023'; end if;
  select r.before_state into snapshot from public.history_recovery r where r.event_id=p_event_id and r.expires_at>now();
  if snapshot is null then raise exception 'The previous state is no longer available.' using errcode='P0002'; end if;

  perform set_config('runbook.skip_row_audit','on',true);
  if target.entity_type='seat_plans' then
    perform public.save_seat_plan(target.entity_id::date,snapshot);
  elsif target.entity_type='vl_months' then
    perform public.save_vl_credit_month(target.entity_id::date,nullif(snapshot->>'updatedOn','')::date,coalesce(snapshot->'entries','[]'::jsonb));
  elsif target.entity_type='vl_credit_entries' then
    if coalesce(snapshot->>'id','')='' then raise exception 'The previous VL record identifier is missing.' using errcode='22023'; end if;
    insert into public.vl_credit_entries select (jsonb_populate_record(null::public.vl_credit_entries,snapshot)).*
      on conflict(id) do update set month_start=excluded.month_start,employee_id=excluded.employee_id,
        employee_name_snapshot=excluded.employee_name_snapshot,employee_role_snapshot=excluded.employee_role_snapshot,
        employee_photo_snapshot=excluded.employee_photo_snapshot,credit_value=excluded.credit_value,sort_order=excluded.sort_order,
        valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=now();
  elsif target.entity_type='projects' and target.entity_id='collection' then
    perform public.save_project_coverage(snapshot);
  elsif target.entity_type='app_links' and target.entity_id='collection' then
    perform public.save_app_links(snapshot);
  elsif target.entity_type='qa_criteria' and target.entity_id='collection' then
    perform public.save_qa_criteria(snapshot);
  elsif target.entity_type='call_schedule_months' then
    perform public.save_call_schedule_month(target.entity_id::date,coalesce(snapshot->'callWindow','{}'::jsonb),coalesce(snapshot->'callAssignments','[]'::jsonb));
  elsif target.entity_type='work_schedule_document' then
    perform public.save_work_schedule_document(coalesce(snapshot->'months','[]'::jsonb),coalesce(snapshot->'periods','[]'::jsonb),coalesce(snapshot->'history','[]'::jsonb));
  elsif target.entity_type='kpi_months' then
    perform public.restore_kpi_month_snapshot(target.entity_id,coalesce(snapshot,'[]'::jsonb));
  elsif target.entity_type='dashboard_publication' then
    update public.dashboard_publication set revision_id=nullif(snapshot->>'revision_id','')::uuid,updated_at=now(),updated_by=auth.uid() where singleton;
    if not found then raise exception 'The published dashboard pointer is unavailable.' using errcode='P0002'; end if;
  elsif target.entity_type='current_kpi_scoring' then
    update public.current_kpi_scoring set version_id=(snapshot->>'version_id')::uuid,updated_at=now(),updated_by=auth.uid() where singleton;
    if not found then raise exception 'The active KPI scoring version is unavailable.' using errcode='P0002'; end if;
  elsif target.entity_type='employees' then
    update public.employees set name=snapshot->>'name',role=snapshot->>'role',
      hierarchy_roles=coalesce(array(select jsonb_array_elements_text(coalesce(snapshot->'hierarchy_roles','[]'::jsonb))), '{}'::text[]),
      manager_id=nullif(snapshot->>'manager_id',''),co_manager_id=nullif(snapshot->>'co_manager_id',''),mentor_id=nullif(snapshot->>'mentor_id',''),
      photo_url=coalesce(snapshot->>'photo_url',''),photo_path=nullif(snapshot->>'photo_path',''),
      sort_order=coalesce(nullif(snapshot->>'sort_order','')::integer,0),deleted_at=nullif(snapshot->>'deleted_at','')::timestamptz,
      deleted_by=nullif(snapshot->>'deleted_by','')::uuid,purge_after=nullif(snapshot->>'purge_after','')::timestamptz,updated_at=now()
    where id=target.entity_id;
    if not found then raise exception 'The employee record is unavailable.' using errcode='P0002'; end if;
    delete from public.employee_reporting_managers where employee_id=target.entity_id;
    reporting_snapshot := case
      when jsonb_typeof(snapshot->'reporting_manager_ids')='array' then snapshot->'reporting_manager_ids'
      else jsonb_build_array(to_jsonb(nullif(snapshot->>'manager_id','')),to_jsonb(nullif(snapshot->>'co_manager_id','')))
    end;
    for reporting_manager_id, reporting_position in
      select links.manager_id, links.position
        from jsonb_array_elements_text(reporting_snapshot) with ordinality as links(manager_id,position)
       where nullif(links.manager_id,'') is not null
    loop
      insert into public.employee_reporting_managers(employee_id,manager_id,sort_order)
      values(target.entity_id,reporting_manager_id,(reporting_position-1)::integer);
    end loop;
  elsif target.entity_type in ('employee_profiles','app_links','qa_criteria','agent_profile_field_definitions') then
    table_name := target.entity_type;
    key_column := case table_name when 'employee_profiles' then 'employee_id' else 'id' end;
    key_value := coalesce(snapshot->>key_column,'');
    if key_value='' then raise exception 'The previous record key is missing.' using errcode='22023'; end if;
    execute format('delete from public.%I where %I=$1',table_name,key_column) using key_value;
    execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).*',table_name,table_name) using snapshot;
  else
    raise exception 'This change must be restored from its page.' using errcode='0A000';
  end if;

  update public.history_events set restored_at=now(),restored_by=auth.uid() where id=p_event_id;
  select coalesce(nullif(a.display_name,''),'RUNBOOK administrator') into actor from public.app_accounts a where a.user_id=auth.uid();
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
    values(auth.uid(),coalesce(actor,'RUNBOOK administrator'),target.module,target.entity_type,target.entity_id,'restore','Restored previous state: '||target.summary,false);
end $$;
revoke all on function public.restore_history_event(uuid) from public,anon;
grant execute on function public.restore_history_event(uuid) to authenticated;
