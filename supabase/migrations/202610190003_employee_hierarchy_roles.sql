-- Store RUNBOOK leadership hierarchy separately from the employee's operational role.
-- Keeping these fields separate lets TM/OM appear in the Org Chart and Seat Plan
-- without leaking into agent, KPI, schedule, or project role labels.
alter table public.employees
  add column if not exists hierarchy_roles text[] not null default '{}'::text[];

alter table public.employees
  drop constraint if exists employees_hierarchy_roles_check;

alter table public.employees
  add constraint employees_hierarchy_roles_check
  check (hierarchy_roles <@ array[
    'Operational Manager (OM)',
    'Team Manager (TM)',
    'Senior Team Lead (STL)',
    'Team Lead (TL)'
  ]::text[]);

-- Preserve the established privacy-filtered directory contract. The hierarchy
-- roles travel inside its existing profile JSON, so the RPC signature and its
-- existing grants remain unchanged.
create or replace function public.get_public_employee_directory()
returns table(id text, name text, role text, manager_id text, mentor_id text, photo_url text, photo_path text, profile jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.role, e.manager_id, e.mentor_id,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_url else '' end,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_path else null end,
         jsonb_strip_nulls(jsonb_build_object(
           'hierarchy_roles', to_jsonb(e.hierarchy_roles),
           'birthday', case when public.is_runbook_editor() or p.birthday_public then p.birthday::text end,
           'hire_date', case when public.is_runbook_editor() or p.hire_date_public then p.hire_date::text end,
           'personality', case when public.is_runbook_editor() or p.personality_public then p.personality end,
           'summary', case when public.is_runbook_editor() or p.summary_public then p.summary end,
           'custom_fields', case when public.is_runbook_editor() then p.custom_fields else (
             select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
               from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) as field(k, v)
              where jsonb_typeof(p.custom_field_visibility -> k) = 'boolean'
                and (p.custom_field_visibility ->> k) = 'true'
           ) end,
           'custom_field_visibility', case when public.is_runbook_editor() then p.custom_field_visibility end
         ))
    from public.employees e
    left join public.employee_profiles p on p.employee_id = e.id
   where public.is_current_runbook_session() and e.deleted_at is null
   order by e.sort_order, e.name;
$$;

-- Employee recovery must also restore all hierarchy assignments captured in
-- the historical before-state snapshot.
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
      manager_id=nullif(snapshot->>'manager_id',''),mentor_id=nullif(snapshot->>'mentor_id',''),
      photo_url=coalesce(snapshot->>'photo_url',''),photo_path=nullif(snapshot->>'photo_path',''),
      sort_order=coalesce(nullif(snapshot->>'sort_order','')::integer,0),deleted_at=nullif(snapshot->>'deleted_at','')::timestamptz,
      deleted_by=nullif(snapshot->>'deleted_by','')::uuid,purge_after=nullif(snapshot->>'purge_after','')::timestamptz,updated_at=now()
    where id=target.entity_id;
    if not found then raise exception 'The employee record is unavailable.' using errcode='P0002'; end if;
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
