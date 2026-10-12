create or replace function public.save_work_schedule_document(p_months jsonb,p_periods jsonb,p_history jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare before_state jsonb; actor text; ev uuid; month_item jsonb; period_item jsonb; history_item jsonb; schedule_item jsonb;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if coalesce(jsonb_typeof(p_months),'')<>'array' or coalesce(jsonb_typeof(p_periods),'')<>'array' or coalesce(jsonb_typeof(p_history),'')<>'array' then
   raise exception 'Work schedule months, periods, and history must be arrays.' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_months) as item(value) where coalesce(value->>'month','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(coalesce(value->'workSchedules','[]'::jsonb))<>'array')
   or exists(select 1 from jsonb_array_elements(p_periods) as item(value) where coalesce(value->>'id','')='' or coalesce(value->>'startDate','')='' or coalesce(value->>'endDate','')='' or jsonb_typeof(coalesce(value->'workSchedules','[]'::jsonb))<>'array') then
   raise exception 'A work schedule entry is incomplete.' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_months) as item(value),jsonb_array_elements(coalesce(item.value->'workSchedules','[]'::jsonb)) as schedule(value)
   where coalesce(schedule.value->>'id','')='' or coalesce(schedule.value->>'memberId','')=''
    or coalesce(schedule.value->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(schedule.value->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
   raise exception 'Each scheduled person needs an employee id and valid start/end times.' using errcode='22023';
 end if;

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
 delete from public.work_schedule_month_assignments;
 delete from public.work_schedule_months;
 for month_item in select value from jsonb_array_elements(p_months) loop
  insert into public.work_schedule_months(month_start,work_preset,updated_by)
  values((month_item->>'month')||'-01',(coalesce(month_item->>'workPreset','9-6')),auth.uid());
  for schedule_item in select value from jsonb_array_elements(coalesce(month_item->'workSchedules','[]'::jsonb)) loop
   insert into public.work_schedule_month_assignments(month_start,id,employee_id,start_time,end_time,sort_order)
   values((month_item->>'month')||'-01',schedule_item->>'id',schedule_item->>'memberId',(schedule_item->>'start')::time,(schedule_item->>'end')::time,
    (select count(*)::integer from public.work_schedule_month_assignments a where a.month_start=((month_item->>'month')||'-01')::date));
  end loop;
 end loop;
 delete from public.work_schedule_periods;
 for period_item in select value from jsonb_array_elements(p_periods) loop
  insert into public.work_schedule_periods(id,start_date,end_date,work_preset,label,updated_at,updated_by)
  values(period_item->>'id',(period_item->>'startDate')::date,(period_item->>'endDate')::date,coalesce(period_item->>'workPreset','custom'),coalesce(period_item->>'label',''),coalesce(nullif(period_item->>'updatedAt','')::timestamptz,now()),auth.uid());
  for schedule_item in select value from jsonb_array_elements(coalesce(period_item->'workSchedules','[]'::jsonb)) loop
   insert into public.work_schedule_period_assignments(period_id,id,employee_id,start_time,end_time,sort_order)
   values(period_item->>'id',schedule_item->>'id',schedule_item->>'memberId',(schedule_item->>'start')::time,(schedule_item->>'end')::time,
    (select count(*)::integer from public.work_schedule_period_assignments a where a.period_id=period_item->>'id'));
  end loop;
 end loop;
 delete from public.work_schedule_revisions;
 for history_item in select value from jsonb_array_elements(p_history) loop
  if coalesce(history_item->>'scope','')='range' then
   insert into public.work_schedule_revisions(id,start_date,end_date,label,schedule_snapshot,created_at,created_by)
   values(history_item->>'id',(history_item->>'startDate')::date,(history_item->>'endDate')::date,coalesce(history_item->>'action','Date-range schedule'),history_item,
    coalesce(nullif(history_item->>'savedAt','')::timestamptz,now()),auth.uid());
  else
   insert into public.work_schedule_revisions(id,start_date,end_date,label,schedule_snapshot,created_at,created_by)
   values(history_item->>'id',((history_item->>'month')||'-01')::date,((history_item->>'month')||'-01')::date,coalesce(history_item->>'action','Monthly schedule'),history_item,
    coalesce(nullif(history_item->>'savedAt','')::timestamptz,now()),auth.uid());
  end if;
 end loop;
 select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
 insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
 values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'Work schedule','work_schedule_document','schedules','update','Updated work schedules or schedule history.',true)
 returning id into ev;
 insert into public.history_recovery(event_id,before_state,after_state,expires_at)
 values(ev,before_state,jsonb_build_object('months',p_months,'periods',p_periods,'history',p_history),now()+interval '30 days');
end $$;

revoke insert,update,delete on public.work_schedule_months,public.work_schedule_month_assignments,public.work_schedule_periods,public.work_schedule_period_assignments,public.work_schedule_revisions from authenticated;
revoke all on function public.save_work_schedule_document(jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_work_schedule_document(jsonb,jsonb,jsonb) to authenticated;
