alter table public.history_events add column if not exists restored_at timestamptz;
alter table public.history_events add column if not exists restored_by uuid references auth.users(id) on delete set null;

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
  if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
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
    perform public.save_kpi_month_results(target.entity_id,coalesce(snapshot,'[]'::jsonb));
  elsif target.entity_type='dashboard_publication' then
    update public.dashboard_publication set revision_id=nullif(snapshot->>'revision_id','')::uuid,updated_at=now(),updated_by=auth.uid() where singleton;
    if not found then raise exception 'The published dashboard pointer is unavailable.' using errcode='P0002'; end if;
  elsif target.entity_type='current_kpi_scoring' then
    update public.current_kpi_scoring set version_id=(snapshot->>'version_id')::uuid,updated_at=now(),updated_by=auth.uid() where singleton;
    if not found then raise exception 'The active KPI scoring version is unavailable.' using errcode='P0002'; end if;
  elsif target.entity_type='employees' then
    update public.employees set name=snapshot->>'name',role=snapshot->>'role',manager_id=nullif(snapshot->>'manager_id',''),
      mentor_id=nullif(snapshot->>'mentor_id',''),photo_url=coalesce(snapshot->>'photo_url',''),photo_path=nullif(snapshot->>'photo_path',''),
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
  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values(auth.uid(),coalesce(actor,'RUNBOOK editor'),target.module,target.entity_type,target.entity_id,'restore',
    'Restored previous state: '||target.summary,false);
end $$;

revoke all on function public.restore_history_event(uuid) from public,anon;
grant execute on function public.restore_history_event(uuid) to authenticated;
