-- Keep monthly KPI results append-only while making restore recover exact edits.
-- New import rows can be removed from the current view through tombstone revisions.
alter table public.kpi_results
  add column if not exists is_deleted boolean not null default false;

create or replace function public.is_public_current_kpi_result(
  p_month text,
  p_employee_id text,
  p_revision integer,
  p_is_deleted boolean
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    not p_is_deleted
    and p_revision = (
      select max(r.result_revision)
      from public.kpi_results r
      where r.month_key = p_month and r.employee_id = p_employee_id
    ),
    false
  );
$$;
revoke all on function public.is_public_current_kpi_result(text,text,integer,boolean) from public;
grant execute on function public.is_public_current_kpi_result(text,text,integer,boolean) to anon, authenticated;

drop policy if exists "Public KPI results" on public.kpi_results;
drop policy if exists "Public current KPI results" on public.kpi_results;
create policy "Public current KPI results" on public.kpi_results for select to anon, authenticated
  using (public.is_public_current_kpi_result(month_key, employee_id, result_revision, is_deleted));

create or replace function public.save_kpi_month_results(p_month text, p_results jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  pinned_version uuid;
  item jsonb;
  next_revision integer;
  before_state jsonb;
  actor text;
  ev uuid;
  action_name text;
begin
  if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
  if coalesce(p_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(jsonb_typeof(p_results),'')<>'array' then
    raise exception 'A valid month and results array are required.' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_results) as input(value)
    where coalesce(value->>'employee_id','')=''
       or coalesce(jsonb_typeof(value->'metrics'),'')<>'object'
  ) then
    raise exception 'Every result needs an employee id and metrics object.' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_results)) <>
     (select count(distinct value->>'employee_id') from jsonb_array_elements(p_results) as input(value)) then
    raise exception 'A KPI save can include each employee only once.' using errcode='22023';
  end if;

  select c.version_id into pinned_version from public.current_kpi_scoring c where c.singleton;
  if pinned_version is null then raise exception 'KPI scoring rules have not been configured.' using errcode='P0002'; end if;

  -- Store the state of every touched employee, including a marker for newly
  -- added rows, so restoring a mixed import can remove its additions too.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'employee_id', input.value->>'employee_id',
      'had_record', coalesce(latest.employee_id is not null and not latest.is_deleted, false),
      'employee_name_snapshot', latest.employee_name_snapshot,
      'employee_role_snapshot', latest.employee_role_snapshot,
      'metrics', latest.metrics,
      'overall_score', latest.overall_score,
      'evaluation', latest.evaluation,
      'source', latest.source
    ) order by input.value->>'employee_id'
  ), '[]'::jsonb)
  into before_state
  from jsonb_array_elements(p_results) as input(value)
  left join lateral (
    select r.* from public.kpi_results r
    where r.month_key=p_month and r.employee_id=input.value->>'employee_id'
    order by r.result_revision desc limit 1
  ) latest on true;

  perform set_config('runbook.skip_row_audit','on',true);
  insert into public.kpi_months(month_key,scoring_version_id,status)
  values(p_month,pinned_version,'published') on conflict(month_key) do nothing;
  select m.scoring_version_id into pinned_version from public.kpi_months m where m.month_key=p_month for update;
  if pinned_version is null then raise exception 'KPI scoring version is missing for this month.' using errcode='P0002'; end if;

  for item in select value from jsonb_array_elements(p_results) loop
    select coalesce(max(r.result_revision),0)+1 into next_revision
    from public.kpi_results r where r.month_key=p_month and r.employee_id=item->>'employee_id';
    insert into public.kpi_results(month_key,employee_id,employee_name_snapshot,employee_role_snapshot,metrics,overall_score,evaluation,result_revision,source,updated_by,is_deleted)
    values(p_month,item->>'employee_id',coalesce(item->>'employee_name_snapshot',''),coalesce(item->>'employee_role_snapshot',''),
      item->'metrics',nullif(item->>'overall_score','')::numeric,coalesce(item->>'evaluation',''),next_revision,
      case when item->>'source' in ('manual','import','seed') then item->>'source' else 'manual' end,auth.uid(),false);
  end loop;

  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
  action_name := case when exists(select 1 from jsonb_array_elements(before_state) as old(value) where (value->>'had_record')::boolean) then 'update' else 'create' end;
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'Monthly KPI / QA','kpi_months',p_month,action_name,
    initcap(action_name)||' monthly KPI / QA results for '||p_month||'.',true) returning id into ev;
  insert into public.history_recovery(event_id,before_state,after_state,expires_at)
  values(ev,before_state,p_results,now()+interval '30 days');
  return pinned_version;
end $$;

create or replace function public.restore_kpi_month_snapshot(p_month text, p_snapshot jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
  current_row public.kpi_results%rowtype;
  next_revision integer;
  had_record boolean;
begin
  if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
  if coalesce(p_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(jsonb_typeof(p_snapshot),'')<>'array' then
    raise exception 'The KPI recovery snapshot is invalid.' using errcode='22023';
  end if;
  perform 1 from public.kpi_months where month_key=p_month for update;
  if not found then
    raise exception 'The KPI month no longer exists.' using errcode='P0002';
  end if;
  perform set_config('runbook.skip_row_audit','on',true);

  for item in select value from jsonb_array_elements(p_snapshot) loop
    if coalesce(item->>'employee_id','')='' then raise exception 'A recovered KPI row has no employee id.' using errcode='22023'; end if;
    -- Snapshots created before this migration contain a previous row directly.
    had_record := case when item ? 'had_record' then coalesce((item->>'had_record')::boolean,false) else true end;
    select coalesce(max(r.result_revision),0)+1 into next_revision
    from public.kpi_results r where r.month_key=p_month and r.employee_id=item->>'employee_id';

    if had_record then
      if coalesce(jsonb_typeof(item->'metrics'),'')<>'object' then raise exception 'A recovered KPI row has invalid metrics.' using errcode='22023'; end if;
      insert into public.kpi_results(month_key,employee_id,employee_name_snapshot,employee_role_snapshot,metrics,overall_score,evaluation,result_revision,source,updated_by,is_deleted)
      values(p_month,item->>'employee_id',coalesce(item->>'employee_name_snapshot',''),coalesce(item->>'employee_role_snapshot',''),
        item->'metrics',nullif(item->>'overall_score','')::numeric,coalesce(item->>'evaluation',''),next_revision,
        case when item->>'source' in ('manual','import','seed') then item->>'source' else 'manual' end,auth.uid(),false);
    else
      select r.* into current_row from public.kpi_results r
      where r.month_key=p_month and r.employee_id=item->>'employee_id'
      order by r.result_revision desc limit 1;
      if found and not current_row.is_deleted then
        insert into public.kpi_results(month_key,employee_id,employee_name_snapshot,employee_role_snapshot,metrics,overall_score,evaluation,result_revision,source,updated_by,is_deleted)
        values(p_month,current_row.employee_id,current_row.employee_name_snapshot,current_row.employee_role_snapshot,
          current_row.metrics,current_row.overall_score,current_row.evaluation,next_revision,current_row.source,auth.uid(),true);
      end if;
    end if;
  end loop;
end $$;

-- Install the recovery dispatcher after the KPI snapshot helper exists. Older
-- migration versions restore previous score values but cannot tombstone rows
-- introduced by a mixed import.
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
    perform public.restore_kpi_month_snapshot(target.entity_id,coalesce(snapshot,'[]'::jsonb));
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

revoke all on function public.save_kpi_month_results(text,jsonb),public.restore_kpi_month_snapshot(text,jsonb) from public,anon;
grant execute on function public.save_kpi_month_results(text,jsonb),public.restore_kpi_month_snapshot(text,jsonb) to authenticated;
revoke all on function public.restore_history_event(uuid) from public,anon;
grant execute on function public.restore_history_event(uuid) to authenticated;
