create or replace function public.save_call_schedule_month(p_month date,p_window jsonb,p_assignments jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare before_state jsonb; actor text; ev uuid; act text;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if p_month is null or extract(day from p_month)<>1 or coalesce(jsonb_typeof(p_window),'')<>'object' or coalesce(jsonb_typeof(p_assignments),'')<>'array' then
   raise exception 'A first-of-month date, call window, and assignments array are required.' using errcode='22023';
 end if;
 if coalesce(p_window->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_window->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
   raise exception 'The inbound call window must have valid start and end times.' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_assignments) as slot(value)
   where coalesce(value->>'id','')='' or coalesce(value->>'memberId','')=''
     or coalesce(value->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(value->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
   raise exception 'Each inbound call assignment needs an id, employee, and valid start/end times.' using errcode='22023';
 end if;
 select jsonb_build_object('callWindow',jsonb_build_object('start',to_char(m.call_window_start,'HH24:MI'),'end',to_char(m.call_window_end,'HH24:MI')),
   'callAssignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'memberId',a.employee_id,'start',to_char(a.call_start,'HH24:MI'),'end',to_char(a.call_end,'HH24:MI')) order by a.sort_order)
     from public.call_assignments a where a.month_start=p_month),'[]'::jsonb))
 into before_state from public.call_schedule_months m where m.month_start=p_month;
 if (select count(*) from jsonb_array_elements(p_assignments))<>(select count(distinct value->>'memberId') from jsonb_array_elements(p_assignments) as slot(value)) then
   raise exception 'An employee can only be assigned one inbound call slot per month.' using errcode='22023';
 end if;
 perform set_config('runbook.skip_row_audit','on',true);
 insert into public.call_schedule_months(month_start,call_window_start,call_window_end,updated_by)
 values(p_month,(p_window->>'start')::time,(p_window->>'end')::time,auth.uid())
 on conflict(month_start) do update set call_window_start=excluded.call_window_start,call_window_end=excluded.call_window_end,updated_at=now(),updated_by=auth.uid();
 delete from public.call_assignments where month_start=p_month;
 insert into public.call_assignments(id,month_start,employee_id,call_start,call_end,sort_order)
 select value->>'id',p_month,value->>'memberId',(value->>'start')::time,(value->>'end')::time,(ordinality-1)::integer
 from jsonb_array_elements(p_assignments) with ordinality as slot(value,ordinality);
 select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
 act := case when before_state is null then 'create' else 'update' end;
 insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
 values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'Inbound call time','call_schedule_months',p_month::text,act,
   initcap(act)||' inbound call schedule for '||p_month::text||'.',before_state is not null) returning id into ev;
 if before_state is not null then
   insert into public.history_recovery(event_id,before_state,after_state,expires_at)
   values(ev,before_state,jsonb_build_object('callWindow',p_window,'callAssignments',p_assignments),now()+interval '30 days');
 end if;
end $$;

revoke insert,update,delete on public.call_schedule_months,public.call_assignments from authenticated;
revoke all on function public.save_call_schedule_month(date,jsonb,jsonb) from public,anon;
grant execute on function public.save_call_schedule_month(date,jsonb,jsonb) to authenticated;
