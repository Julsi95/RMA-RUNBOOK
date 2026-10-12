-- Targeted, validated replacement of the shared work-schedule document.
create or replace function public.save_work_schedule_document(p_months jsonb,p_periods jsonb,p_history jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  before_state jsonb; actor text; ev uuid; month_item jsonb; period_item jsonb; history_item jsonb; schedule_item jsonb;
  month_date date; start_date date; end_date date;
begin
  if not public.is_runbook_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  if jsonb_typeof(p_months)<>'array' or jsonb_typeof(p_periods)<>'array' or jsonb_typeof(p_history)<>'array' then
    raise exception 'Work schedule months, periods, and history must be arrays.' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_months) m(value), jsonb_array_elements(coalesce(m.value->'workSchedules','[]'::jsonb)) s(value)
    where coalesce(s.value->>'id','')='' or coalesce(s.value->>'memberId','')=''
      or coalesce(s.value->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(s.value->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ) or exists (
    select 1 from jsonb_array_elements(p_periods) p(value), jsonb_array_elements(coalesce(p.value->'workSchedules','[]'::jsonb)) s(value)
    where coalesce(s.value->>'id','')='' or coalesce(s.value->>'memberId','')=''
      or coalesce(s.value->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(s.value->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ) then raise exception 'Each scheduled person needs an employee, a unique assignment, and valid times.' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_months) m(value), jsonb_array_elements(coalesce(m.value->'workSchedules','[]'::jsonb)) s(value)
    group by m.value->>'month',s.value->>'memberId' having count(*)>1
  ) or exists (
    select 1 from jsonb_array_elements(p_periods) p(value), jsonb_array_elements(coalesce(p.value->'workSchedules','[]'::jsonb)) s(value)
    group by p.value->>'id',s.value->>'memberId' having count(*)>1
  ) then raise exception 'A person can only appear once in a schedule.' using errcode='23505'; end if;

  for period_item in select value from jsonb_array_elements(p_periods) loop
    start_date := (period_item->>'startDate')::date;
    end_date := (period_item->>'endDate')::date;
    if end_date < start_date then raise exception 'Schedule end date must not be before its start date.' using errcode='22023'; end if;
    if extract(isodow from start_date) > 5 or extract(isodow from end_date) > 5 then
      raise exception 'Work schedule ranges must start and end on a weekday.' using errcode='22023';
    end if;
  end loop;

  select jsonb_build_object(
    'months',coalesce((select jsonb_agg(jsonb_build_object('month',to_char(m.month_start,'YYYY-MM'),'workPreset',m.work_preset,'workSchedules',coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'memberId',a.employee_id,'start',to_char(a.start_time,'HH24:MI'),'end',to_char(a.end_time,'HH24:MI')) order by a.sort_order)
      from public.work_schedule_month_assignments a where a.month_start=m.month_start),'[]'::jsonb)) order by m.month_start) from public.work_schedule_months m),'[]'::jsonb),
    'periods',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'startDate',p.start_date,'endDate',p.end_date,'workPreset',p.work_preset,'label',p.label,'updatedAt',p.updated_at,'workSchedules',coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'memberId',a.employee_id,'start',to_char(a.start_time,'HH24:MI'),'end',to_char(a.end_time,'HH24:MI')) order by a.sort_order)
      from public.work_schedule_period_assignments a where a.period_id=p.id),'[]'::jsonb)) order by p.start_date) from public.work_schedule_periods p),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(r.schedule_snapshot order by r.created_at desc) from public.work_schedule_revisions r),'[]'::jsonb)
  ) into before_state;

  perform set_config('runbook.skip_row_audit','on',true);

  -- Delete only rows omitted from the submitted document or explicitly replaced.
  delete from public.work_schedule_month_assignments a where a.month_start in (
    select m.month_start from public.work_schedule_months m
    where exists (select 1 from jsonb_array_elements(p_months) x(value) where ((x.value->>'month')||'-01')::date=m.month_start)
  );
  delete from public.work_schedule_months m where not exists (
    select 1 from jsonb_array_elements(p_months) x(value) where ((x.value->>'month')||'-01')::date=m.month_start
  );
  delete from public.work_schedule_periods p where not exists (
    select 1 from jsonb_array_elements(p_periods) x(value) where x.value->>'id'=p.id
  );
  delete from public.work_schedule_period_assignments a where a.period_id in (
    select p.id from public.work_schedule_periods p
    where exists (select 1 from jsonb_array_elements(p_periods) x(value) where x.value->>'id'=p.id)
  );
  delete from public.work_schedule_revisions r where not exists (
    select 1 from jsonb_array_elements(p_history) x(value) where x.value->>'id'=r.id
  );

  for month_item in select value from jsonb_array_elements(p_months) loop
    month_date := ((month_item->>'month')||'-01')::date;
    insert into public.work_schedule_months(month_start,work_preset,updated_by)
      values(month_date,coalesce(month_item->>'workPreset','9-6'),auth.uid())
      on conflict(month_start) do update set work_preset=excluded.work_preset,updated_at=now(),updated_by=excluded.updated_by;
    for schedule_item in select value from jsonb_array_elements(coalesce(month_item->'workSchedules','[]'::jsonb)) loop
      insert into public.work_schedule_month_assignments(month_start,id,employee_id,start_time,end_time,sort_order)
      values(month_date,schedule_item->>'id',schedule_item->>'memberId',(schedule_item->>'start')::time,(schedule_item->>'end')::time,
        (select count(*)::integer from public.work_schedule_month_assignments a where a.month_start=month_date))
      on conflict(month_start,id) do update set employee_id=excluded.employee_id,start_time=excluded.start_time,end_time=excluded.end_time,sort_order=excluded.sort_order;
    end loop;
  end loop;

  for period_item in select value from jsonb_array_elements(p_periods) loop
    insert into public.work_schedule_periods(id,start_date,end_date,work_preset,label,updated_at,updated_by)
      values(period_item->>'id',(period_item->>'startDate')::date,(period_item->>'endDate')::date,coalesce(period_item->>'workPreset','custom'),coalesce(period_item->>'label',''),coalesce(nullif(period_item->>'updatedAt','')::timestamptz,now()),auth.uid())
      on conflict(id) do update set start_date=excluded.start_date,end_date=excluded.end_date,work_preset=excluded.work_preset,label=excluded.label,updated_at=now(),updated_by=excluded.updated_by;
    for schedule_item in select value from jsonb_array_elements(coalesce(period_item->'workSchedules','[]'::jsonb)) loop
      insert into public.work_schedule_period_assignments(period_id,id,employee_id,start_time,end_time,sort_order)
      values(period_item->>'id',schedule_item->>'id',schedule_item->>'memberId',(schedule_item->>'start')::time,(schedule_item->>'end')::time,
        (select count(*)::integer from public.work_schedule_period_assignments a where a.period_id=period_item->>'id'))
      on conflict(period_id,id) do update set employee_id=excluded.employee_id,start_time=excluded.start_time,end_time=excluded.end_time,sort_order=excluded.sort_order;
    end loop;
  end loop;

  for history_item in select value from jsonb_array_elements(p_history) loop
    if coalesce(history_item->>'scope','')='range' then
      insert into public.work_schedule_revisions(id,start_date,end_date,label,schedule_snapshot,created_at,created_by)
        values(history_item->>'id',(history_item->>'startDate')::date,(history_item->>'endDate')::date,coalesce(history_item->>'action','Date-range schedule'),history_item,coalesce(nullif(history_item->>'savedAt','')::timestamptz,now()),auth.uid())
        on conflict(id) do update set start_date=excluded.start_date,end_date=excluded.end_date,label=excluded.label,schedule_snapshot=excluded.schedule_snapshot;
    else
      insert into public.work_schedule_revisions(id,start_date,end_date,label,schedule_snapshot,created_at,created_by)
        values(history_item->>'id',((history_item->>'month')||'-01')::date,((history_item->>'month')||'-01')::date,coalesce(history_item->>'action','Monthly schedule'),history_item,coalesce(nullif(history_item->>'savedAt','')::timestamptz,now()),auth.uid())
        on conflict(id) do update set start_date=excluded.start_date,end_date=excluded.end_date,label=excluded.label,schedule_snapshot=excluded.schedule_snapshot;
    end if;
  end loop;

  select coalesce(nullif(a.display_name,''),'RUNBOOK administrator') into actor from public.app_accounts a where a.user_id=auth.uid();
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
    values(auth.uid(),coalesce(actor,'RUNBOOK administrator'),'Work schedule','work_schedule_document','schedules','update','Updated work schedules or schedule history.',true)
    returning id into ev;
  insert into public.history_recovery(event_id,before_state,after_state,expires_at)
    values(ev,before_state,jsonb_build_object('months',p_months,'periods',p_periods,'history',p_history),now()+interval '30 days');
end $$;

-- VL credits are effective-dated records. Keep month_start nullable for older snapshots,
-- and store new records once for their whole validity range.
alter table public.vl_credit_entries alter column month_start drop not null;
alter table public.vl_credit_entries add column if not exists valid_from date;
alter table public.vl_credit_entries add column if not exists valid_to date;
alter table public.vl_credit_entries add column if not exists updated_at timestamptz not null default now();
update public.vl_credit_entries e set
  valid_from=coalesce(e.valid_from,e.month_start),
  valid_to=coalesce(e.valid_to,(e.month_start + interval '1 month - 1 day')::date)
where e.month_start is not null and (e.valid_from is null or e.valid_to is null);
alter table public.vl_credit_entries drop constraint if exists vl_credit_entries_month_start_employee_id_key;
create unique index if not exists vl_credit_entries_employee_start_uidx
  on public.vl_credit_entries(employee_id,valid_from) where employee_id is not null and valid_from is not null;
create index if not exists vl_credit_entries_validity_idx on public.vl_credit_entries(valid_from,valid_to);

create or replace function public.enforce_vl_credit_validity()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.employee_id is null or new.valid_from is null or new.valid_to is null then return new; end if;
  if new.valid_to<new.valid_from then raise exception 'VL validity end date must be on or after its start date.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext(new.employee_id));
  if exists(select 1 from public.vl_credit_entries v where v.employee_id=new.employee_id and v.id<>new.id
    and v.valid_from is not null and v.valid_to is not null and daterange(v.valid_from,v.valid_to,'[]') && daterange(new.valid_from,new.valid_to,'[]')) then
    raise exception 'VL records for the same employee cannot overlap.' using errcode='23P01';
  end if;
  return new;
end $$;
drop trigger if exists validate_vl_credit_validity on public.vl_credit_entries;
create trigger validate_vl_credit_validity before insert or update on public.vl_credit_entries
for each row execute function public.enforce_vl_credit_validity();

drop function if exists public.get_public_vl_credit_entries();
create function public.get_public_vl_credit_entries()
returns table(id text,month_start date,employee_id text,employee_name_snapshot text,employee_role_snapshot text,employee_photo_snapshot text,credit_value text,sort_order integer,valid_from date,valid_to date,updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select v.id,v.month_start,v.employee_id,v.employee_name_snapshot,v.employee_role_snapshot,
    case when public.is_runbook_admin() or (e.deleted_at is null and coalesce(p.photo_public,true))
      then coalesce(nullif(e.photo_path,''),nullif(e.photo_url,''),v.employee_photo_snapshot,'') else '' end,
    v.credit_value,v.sort_order,v.valid_from,v.valid_to,v.updated_at
  from public.vl_credit_entries v
  left join public.employees e on e.id=v.employee_id
  left join public.employee_profiles p on p.employee_id=v.employee_id
  order by v.valid_from,v.sort_order,v.employee_name_snapshot;
$$;
revoke all on function public.get_public_vl_credit_entries() from public,anon;
grant execute on function public.get_public_vl_credit_entries() to anon,authenticated;

create or replace function public.save_vl_credit_entry(p_entry jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare entry_id text; employee_id_value text; from_date date; to_date date; credit_value_text text;
begin
  if not public.is_runbook_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  entry_id := nullif(p_entry->>'id','');
  employee_id_value := nullif(p_entry->>'memberId','');
  from_date := nullif(p_entry->>'validFrom','')::date;
  to_date := nullif(p_entry->>'validTo','')::date;
  credit_value_text := trim(coalesce(p_entry->>'value',''));
  if entry_id is null or employee_id_value is null or from_date is null or to_date is null or to_date<from_date then
    raise exception 'Employee and a valid From–To date range are required.' using errcode='22023';
  end if;
  if credit_value_text !~ '^(Proby|[0-9]+([.][0-9]{1,2})?)$' then
    raise exception 'Credit must be a non-negative number or Proby.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(employee_id_value));
  if exists(select 1 from public.vl_credit_entries e where e.employee_id=employee_id_value and e.valid_from is not null and e.id<>entry_id
    and daterange(e.valid_from,e.valid_to,'[]') && daterange(from_date,to_date,'[]')) then
    raise exception 'This employee already has a VL record that overlaps those dates.' using errcode='23P01';
  end if;
  insert into public.vl_credit_entries(id,month_start,employee_id,employee_name_snapshot,employee_role_snapshot,employee_photo_snapshot,credit_value,sort_order,valid_from,valid_to,updated_at)
  select entry_id,null,e.id,e.name,e.role,coalesce(nullif(e.photo_path,''),e.photo_url,''),credit_value_text,
    coalesce((select max(v.sort_order)+1 from public.vl_credit_entries v),0),from_date,to_date,now()
  from public.employees e where e.id=employee_id_value and e.deleted_at is null
  on conflict(id) do update set month_start=null,employee_id=excluded.employee_id,employee_name_snapshot=excluded.employee_name_snapshot,
    employee_role_snapshot=excluded.employee_role_snapshot,employee_photo_snapshot=excluded.employee_photo_snapshot,credit_value=excluded.credit_value,
    valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=now();
  if not found then raise exception 'Active employee not found.' using errcode='P0002'; end if;
end $$;

create or replace function public.delete_vl_credit_entry(p_id text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_runbook_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  delete from public.vl_credit_entries where id=p_id;
  if not found then raise exception 'VL record was not found.' using errcode='P0002'; end if;
end $$;
revoke all on function public.save_vl_credit_entry(jsonb),public.delete_vl_credit_entry(text) from public,anon;
grant execute on function public.save_vl_credit_entry(jsonb),public.delete_vl_credit_entry(text) to authenticated;

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
  select coalesce(nullif(a.display_name,''),'RUNBOOK administrator') into actor from public.app_accounts a where a.user_id=auth.uid();
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
    values(auth.uid(),coalesce(actor,'RUNBOOK administrator'),target.module,target.entity_type,target.entity_id,'restore','Restored previous state: '||target.summary,false);
end $$;
revoke all on function public.restore_history_event(uuid) from public,anon;
grant execute on function public.restore_history_event(uuid) to authenticated;
