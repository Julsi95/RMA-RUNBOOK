-- Restore the established date-revoke RPC signature and refund its eligible
-- allocation. Point removal is a separate admin action against an employee.

drop function if exists public.admin_revoke_wfh_dates(uuid,date[],text,integer);
drop function if exists public.admin_revoke_wfh_dates(uuid,date[],text);

create function public.admin_revoke_wfh_dates(p_reward_id uuid, p_dates date[], p_reason text default '')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  reward public.wfh_privilege_rewards%rowtype;
  allocation record;
  changed integer := 0;
  recipient uuid;
  date_list text;
  was_refunded boolean;
  refunded_dates date[] := array[]::date[];
  uncredited_dates date[] := array[]::date[];
  employee_id_value text;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_dates is null or cardinality(p_dates) not between 1 and 30
     or cardinality(p_dates) <> (select count(distinct d) from unnest(p_dates) d)
     or length(coalesce(p_reason,'')) > 500 then
    raise exception 'Select 1–30 unique WFH dates and keep the reason under 500 characters.' using errcode = '22023';
  end if;
  select employee_id into employee_id_value from public.wfh_privilege_rewards where id=p_reward_id;
  if not found then raise exception 'This WFH reward was not found.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(employee_id_value, 0));
  select * into reward from public.wfh_privilege_rewards where id=p_reward_id for update;
  if not found or reward.revoked_at is not null then raise exception 'This WFH reward is not active.' using errcode = '22023'; end if;

  for allocation in
    select a.* from public.wfh_privilege_allocations a
     where a.reward_id=p_reward_id and a.privilege_date=any(p_dates) and a.status='active'
     for update
  loop
    if allocation.privilege_date < public.runbook_today() then
      raise exception 'Past WFH dates cannot be revoked.' using errcode = '22023';
    end if;
    select * into reward from public.wfh_privilege_rewards where id=allocation.reward_id for update;
    was_refunded := reward.revoked_at is null and reward.expires_on >= public.runbook_today();
    if was_refunded then
      update public.wfh_privilege_rewards
         set days_available=least(days_awarded,days_available+1)
       where id=reward.id;
      refunded_dates := array_append(refunded_dates,allocation.privilege_date);
    else
      uncredited_dates := array_append(uncredited_dates,allocation.privilege_date);
    end if;
    update public.wfh_privilege_allocations
       set status=case when was_refunded then 'cancelled_refunded' else 'cancelled_uncredited' end
     where id=allocation.id;
    update public.wfh_privilege_requests r
       set approved_dates=(select coalesce(array_agg(d order by d),'{}'::date[]) from unnest(coalesce(r.approved_dates,'{}'::date[])) d where d<>allocation.privilege_date),
           status=case when cardinality(coalesce(r.approved_dates,'{}'::date[])) <= 1 then 'cancelled' else r.status end
     where r.id=allocation.request_id;
    insert into public.wfh_privilege_audit(employee_id,reward_id,request_id,actor_id,action,details)
    values(reward.employee_id,reward.id,allocation.request_id,auth.uid(),'revoked',jsonb_build_object('dates',jsonb_build_array(allocation.privilege_date),'credit_returned',was_refunded,'reason',btrim(coalesce(p_reason,''))));
    changed := changed + 1;
  end loop;
  if changed <> cardinality(p_dates) then raise exception 'One or more selected dates are no longer active.' using errcode = '23505'; end if;

  select string_agg(d::text, ', ' order by d) into date_list from unnest(p_dates) d;
  select a.user_id into recipient from public.app_accounts a where a.employee_id=reward.employee_id;
  if recipient is not null then
    perform public.create_runbook_notification(recipient,'wfh-admin-date-change:'||reward.id::text||':'||gen_random_uuid()::text,
      'wfh-privilege','Your approved WFH dates changed',
      'An administrator revoked these approved dates: '||coalesce(date_list,'')||
      case when cardinality(refunded_dates)>0 then '. Eligible WFH point(s) were returned.' else '. No points were returned because the reward is expired or revoked.' end||
      case when p_reason<>'' then ' '||p_reason else '' end,
      '/wfh-privileges');
  end if;
  return changed;
end;
$$;

create or replace function public.admin_remove_wfh_points(p_employee_id text, p_points integer, p_reason text default '')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  recipient uuid;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_employee_id is null or p_points is null or p_points not between 1 and 10000
     or length(coalesce(p_reason,'')) > 500 then
    raise exception 'Choose an employee and remove between 1 and 10,000 points.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employees where id=p_employee_id and deleted_at is null) then
    raise exception 'The employee is not active.' using errcode = '22023';
  end if;

  perform public.remove_wfh_points_for_employee(p_employee_id,p_points,coalesce(nullif(btrim(p_reason),''),'Removed by administrator'));
  select a.user_id into recipient from public.app_accounts a where a.employee_id=p_employee_id;
  if recipient is not null then
    perform public.create_runbook_notification(recipient,'wfh-points-removed:'||gen_random_uuid()::text,
      'wfh-privilege','WFH points removed',p_points::text||' WFH point(s) were removed from your available balance.'||
      case when p_reason<>'' then ' '||p_reason else '' end,'/wfh-privileges');
  end if;
  return p_points;
end;
$$;

revoke all on function public.admin_revoke_wfh_dates(uuid,date[],text),public.admin_remove_wfh_points(text,integer,text) from public,anon;
grant execute on function public.admin_revoke_wfh_dates(uuid,date[],text),public.admin_remove_wfh_points(text,integer,text) to authenticated;

notify pgrst, 'reload schema';
