-- The VL write function below stores a profile image reference per month.
alter table public.vl_credit_entries
  add column if not exists employee_photo_snapshot text not null default '';

create or replace function public.save_seat_plan(p_plan_date date,p_plan jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare before_state jsonb; actor text; act text; ev uuid;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if p_plan_date is null or coalesce(jsonb_typeof(p_plan),'')<>'object'
   or coalesce(jsonb_typeof(p_plan->'seatIds'),'array')<>'array'
   or coalesce(jsonb_typeof(p_plan->'leadershipSeatIds'),'array')<>'array'
   or coalesce(jsonb_typeof(p_plan->'assignments'),'object')<>'object' then
   raise exception 'Invalid seat plan.' using errcode='22023';
 end if;

 select jsonb_build_object(
   'note',sp.note,
   'seatIds',coalesce((select jsonb_agg(pos.seat_id order by pos.sort_order) from public.seat_positions pos where pos.plan_date=p_plan_date and pos.seat_type='team'),'[]'::jsonb),
   'leadershipSeatIds',coalesce((select jsonb_agg(pos.seat_id order by pos.sort_order) from public.seat_positions pos where pos.plan_date=p_plan_date and pos.seat_type='leadership'),'[]'::jsonb),
   'assignments',coalesce((select jsonb_object_agg(a.seat_id,a.employee_id) from public.seat_assignments a where a.plan_date=p_plan_date),'{}'::jsonb)
 ) into before_state from public.seat_plans sp where sp.plan_date=p_plan_date;

 perform set_config('runbook.skip_row_audit','on',true);
 insert into public.seat_plans(plan_date,note,updated_by) values(p_plan_date,coalesce(p_plan->>'note',''),auth.uid())
 on conflict(plan_date) do update set note=excluded.note,updated_at=now(),updated_by=auth.uid();
 delete from public.seat_assignments where plan_date=p_plan_date;
 delete from public.seat_positions where plan_date=p_plan_date;
 insert into public.seat_positions(plan_date,seat_id,seat_type,sort_order)
 select p_plan_date,value,'team',(ordinality-1)::integer
 from jsonb_array_elements_text(coalesce(p_plan->'seatIds','[]'::jsonb)) with ordinality;
 insert into public.seat_positions(plan_date,seat_id,seat_type,sort_order)
 select p_plan_date,value,'leadership',(ordinality-1)::integer
 from jsonb_array_elements_text(coalesce(p_plan->'leadershipSeatIds','[]'::jsonb)) with ordinality;
 insert into public.seat_assignments(plan_date,seat_id,employee_id)
 select p_plan_date,key,value from jsonb_each_text(coalesce(p_plan->'assignments','{}'::jsonb));

 select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor
 from public.app_accounts a where a.user_id=auth.uid();
 act := case when before_state is null then 'create' else 'update' end;
 insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
 values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'Seat plan','seat_plans',p_plan_date::text,act,
   initcap(act)||' seat plan for '||p_plan_date::text||'.',before_state is not null)
 returning id into ev;
 if before_state is not null then
   insert into public.history_recovery(event_id,before_state,after_state,expires_at)
   values(ev,before_state,p_plan,now()+interval '30 days');
 end if;
end $$;

revoke insert,update,delete on public.seat_plans,public.seat_positions,public.seat_assignments from authenticated;
revoke all on function public.save_seat_plan(date,jsonb) from public,anon;
grant execute on function public.save_seat_plan(date,jsonb) to authenticated;

create or replace function public.save_vl_credit_month(p_month date,p_updated_on date,p_entries jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare before_state jsonb; actor text; ev uuid; act text;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if p_month is null or extract(day from p_month)<>1 or coalesce(jsonb_typeof(p_entries),'')<>'array' then
   raise exception 'A first-of-month date and entries array are required.' using errcode='22023';
 end if;
 select jsonb_build_object('updatedOn',m.updated_on,'entries',coalesce((
   select jsonb_agg(jsonb_build_object('id',e.id,'memberId',e.employee_id,'name',e.employee_name_snapshot,
     'role',e.employee_role_snapshot,'photo',e.employee_photo_snapshot,'value',e.credit_value) order by e.sort_order)
   from public.vl_credit_entries e where e.month_start=p_month),'[]'::jsonb))
 into before_state from public.vl_months m where m.month_start=p_month;
 if exists(select 1 from jsonb_array_elements(p_entries) as entry(value) where coalesce(value->>'id','')='' or coalesce(value->>'name','')='' or coalesce(value->>'memberId','')='') then
   raise exception 'Every VL entry requires an id, employee id, and employee name.' using errcode='22023';
 end if;
 perform set_config('runbook.skip_row_audit','on',true);
 insert into public.vl_months(month_start,updated_on,updated_by) values(p_month,p_updated_on,auth.uid())
 on conflict(month_start) do update set updated_on=excluded.updated_on,updated_at=now(),updated_by=auth.uid();
 delete from public.vl_credit_entries where month_start=p_month;
 insert into public.vl_credit_entries(id,month_start,employee_id,employee_name_snapshot,employee_role_snapshot,employee_photo_snapshot,credit_value,sort_order)
 select value->>'id',p_month,nullif(value->>'memberId',''),value->>'name',coalesce(value->>'role',''),coalesce(value->>'photo',''),coalesce(value->>'value',''),(ordinality-1)::integer
 from jsonb_array_elements(p_entries) with ordinality as entry(value,ordinality);
 select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
 act := case when before_state is null then 'create' else 'update' end;
 insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
 values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'VL credits','vl_months',p_month::text,act,
   initcap(act)||' VL credits for '||p_month::text||'.',before_state is not null) returning id into ev;
 if before_state is not null then
   insert into public.history_recovery(event_id,before_state,after_state,expires_at)
   values(ev,before_state,jsonb_build_object('updatedOn',p_updated_on,'entries',p_entries),now()+interval '30 days');
 end if;
end $$;

revoke insert,update,delete on public.vl_months,public.vl_credit_entries from authenticated;
revoke all on function public.save_vl_credit_month(date,date,jsonb) from public,anon;
grant execute on function public.save_vl_credit_month(date,date,jsonb) to authenticated;
