-- Keep the two actions distinct:
-- * approving a user's cancellation releases the allocation and returns an
--   unexpired, non-revoked reward day;
-- * an admin revoking an approved date releases the date but consumes its day.

create or replace function public.decide_wfh_privilege_request(
  p_request_id uuid, p_decision text, p_final_dates date[] default null, p_note text default ''
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  request_row public.wfh_privilege_requests%rowtype;
  reward public.wfh_privilege_rewards%rowtype;
  allocation public.wfh_privilege_allocations%rowtype;
  final_dates date[];
  work_date date;
  was_refunded boolean;
  refunded_dates date[] := array[]::date[];
  uncredited_dates date[] := array[]::date[];
begin
  if auth.uid() is null or not public.is_current_runbook_session() then raise exception 'Sign in to review WFH requests.' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approve','reject') or length(coalesce(p_note,'')) > 500 then raise exception 'Invalid decision or note.' using errcode = '22023'; end if;
  select * into request_row from public.wfh_privilege_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if request_row.status <> 'pending' then raise exception 'This request has already been decided.' using errcode = '22023'; end if;
  if not public.is_wfh_responsible_approver(request_row.employee_id) then raise exception 'Only the responsible TL/STL can review this request.' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(request_row.employee_id, 0));
  if p_decision = 'reject' then
    update public.wfh_privilege_requests set status = 'rejected', decision_note = btrim(coalesce(p_note,'')), decided_by = auth.uid(), decided_at = now() where id = p_request_id;
    insert into public.wfh_privilege_audit(employee_id,request_id,actor_id,action,details)
    values(request_row.employee_id,p_request_id,auth.uid(),case when request_row.request_type='cancel' then 'cancellation_rejected' else 'rejected' end,jsonb_build_object('note',btrim(coalesce(p_note,''))));
    return;
  end if;

  if request_row.request_type = 'use' then
    final_dates := coalesce(p_final_dates, request_row.requested_dates);
    if cardinality(final_dates) <> cardinality(request_row.requested_dates)
       or cardinality(final_dates) <> (select count(distinct d) from unnest(final_dates) d) then
      raise exception 'Approved dates must be unique and keep the number of requested days unchanged.' using errcode = '22023';
    end if;
    foreach work_date in array final_dates loop
      if work_date <= public.runbook_today() or not public.is_wfh_workday(work_date) then
        raise exception 'Approved dates must be future weekdays that are not non-working holidays.' using errcode = '22023';
      end if;
      if exists (select 1 from public.wfh_privilege_allocations a where a.employee_id=request_row.employee_id and a.privilege_date=work_date and a.status='active') then
        raise exception 'A WFH privilege is already approved for %.', work_date using errcode = '23505';
      end if;
      select r.* into reward
        from public.wfh_privilege_rewards r
       where r.employee_id=request_row.employee_id and r.days_available > 0 and r.revoked_at is null
         and r.expires_on >= work_date and r.expires_on >= public.runbook_today()
       order by r.expires_on, r.created_at, r.id
       limit 1 for update;
      if not found then raise exception 'There are not enough unexpired WFH days for %.', work_date using errcode = '22023'; end if;
      update public.wfh_privilege_rewards set days_available=days_available-1 where id=reward.id;
      insert into public.wfh_privilege_allocations(employee_id,request_id,reward_id,privilege_date)
      values(request_row.employee_id,p_request_id,reward.id,work_date);
    end loop;
    update public.wfh_privilege_requests set status='approved',approved_dates=final_dates,decision_note=btrim(coalesce(p_note,'')),decided_by=auth.uid(),decided_at=now() where id=p_request_id;
    insert into public.wfh_privilege_audit(employee_id,request_id,actor_id,action,details)
    values(request_row.employee_id,p_request_id,auth.uid(),'approved',jsonb_build_object('requested_dates',request_row.requested_dates,'approved_dates',final_dates,'dates_changed',final_dates is distinct from request_row.requested_dates,'note',btrim(coalesce(p_note,''))));
  else
    foreach work_date in array request_row.requested_dates loop
      select a.* into allocation from public.wfh_privilege_allocations a
       where a.employee_id=request_row.employee_id and a.privilege_date=work_date and a.status='active' for update;
      if not found then raise exception 'An approved WFH date is no longer available for cancellation.' using errcode = '22023'; end if;
      if work_date < public.runbook_today() + (select cancellation_notice_days from public.wfh_privilege_settings where singleton) then
        raise exception 'This cancellation no longer meets the company notice period.' using errcode = '22023';
      end if;
      select * into reward from public.wfh_privilege_rewards where id=allocation.reward_id for update;
      was_refunded := reward.revoked_at is null and reward.expires_on >= public.runbook_today();
      if was_refunded then
        update public.wfh_privilege_rewards
           set days_available=least(days_awarded,days_available+1)
         where id=reward.id;
        refunded_dates := array_append(refunded_dates,work_date);
      else
        uncredited_dates := array_append(uncredited_dates,work_date);
      end if;
      update public.wfh_privilege_allocations
         set status=case when was_refunded then 'cancelled_refunded' else 'cancelled_uncredited' end,
             cancellation_request_id=p_request_id
       where id=allocation.id;
    end loop;
    update public.wfh_privilege_requests set status='cancelled',approved_dates=request_row.requested_dates,decision_note=btrim(coalesce(p_note,'')),decided_by=auth.uid(),decided_at=now() where id=p_request_id;
    insert into public.wfh_privilege_audit(employee_id,request_id,actor_id,action,details)
    values(request_row.employee_id,p_request_id,auth.uid(),'cancellation_approved',jsonb_build_object('dates',request_row.requested_dates,'refunded_dates',refunded_dates,'uncredited_dates',uncredited_dates,'note',btrim(coalesce(p_note,''))));
  end if;
end;
$$;

create or replace function public.remove_wfh_points_for_employee(p_employee_id text, p_points integer, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  reward_row public.wfh_privilege_rewards%rowtype;
  remaining integer := p_points;
  amount_to_remove integer;
begin
  if p_points is null or p_points < 0 then raise exception 'Points to remove must be zero or greater.' using errcode = '22023'; end if;
  if p_points = 0 then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id, 0));
  for reward_row in
    select * from public.wfh_privilege_rewards
     where employee_id=p_employee_id and revoked_at is null
       and expires_on >= public.runbook_today() and days_available > 0
     order by expires_on, created_at, id
     for update
  loop
    exit when remaining <= 0;
    amount_to_remove := least(remaining,reward_row.days_available);
    update public.wfh_privilege_rewards
       set days_available=days_available-amount_to_remove
     where id=reward_row.id;
    insert into public.wfh_privilege_audit(employee_id,reward_id,actor_id,action,details)
    values(p_employee_id,reward_row.id,auth.uid(),'points_removed',jsonb_build_object('points_removed',amount_to_remove,'reason',btrim(coalesce(p_reason,''))));
    remaining := remaining-amount_to_remove;
  end loop;
  if remaining > 0 then raise exception 'The agent no longer has enough active WFH points to remove.' using errcode = '22023'; end if;
  return p_points;
end;
$$;
revoke all on function public.remove_wfh_points_for_employee(text,integer,text) from public,anon,authenticated;

drop function if exists public.admin_revoke_wfh_dates(uuid,date[],text);

create or replace function public.admin_revoke_wfh_dates(
  p_reward_id uuid, p_dates date[], p_reason text default '', p_points_to_remove integer default 0
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  reward public.wfh_privilege_rewards%rowtype;
  allocation record;
  changed integer := 0;
  recipient uuid;
  date_list text;
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
  if p_points_to_remove is null or p_points_to_remove < 0 then
    raise exception 'Points to remove must be zero or greater.' using errcode = '22023';
  end if;

  for allocation in
    select a.* from public.wfh_privilege_allocations a
     where a.reward_id=p_reward_id and a.privilege_date=any(p_dates) and a.status='active'
     for update
  loop
    if allocation.privilege_date < public.runbook_today() then
      raise exception 'Past WFH dates cannot be revoked.' using errcode = '22023';
    end if;
    -- The allocated day stays consumed. Admin revoke removes the privilege;
    -- only an approved user cancellation refunds a valid reward day.
    update public.wfh_privilege_allocations set status='cancelled_uncredited' where id=allocation.id;
    update public.wfh_privilege_requests r
       set approved_dates=(select coalesce(array_agg(d order by d),'{}'::date[]) from unnest(coalesce(r.approved_dates,'{}'::date[])) d where d<>allocation.privilege_date),
           status=case when cardinality(coalesce(r.approved_dates,'{}'::date[])) <= 1 then 'cancelled' else r.status end
     where r.id=allocation.request_id;
    insert into public.wfh_privilege_audit(employee_id,reward_id,request_id,actor_id,action,details)
    values(reward.employee_id,reward.id,allocation.request_id,auth.uid(),'revoked',jsonb_build_object('dates',jsonb_build_array(allocation.privilege_date),'days_removed',1,'reason',btrim(coalesce(p_reason,''))));
    changed := changed + 1;
  end loop;
  if changed <> cardinality(p_dates) then raise exception 'One or more selected dates are no longer active.' using errcode = '23505'; end if;
  if p_points_to_remove > 0 then
    perform public.remove_wfh_points_for_employee(reward.employee_id,p_points_to_remove,p_reason);
  end if;

  select string_agg(d::text, ', ' order by d) into date_list from unnest(p_dates) d;
  select a.user_id into recipient from public.app_accounts a where a.employee_id=reward.employee_id;
  if recipient is not null then
    perform public.create_runbook_notification(recipient,'wfh-admin-date-change:'||reward.id::text||':'||gen_random_uuid()::text,
      'wfh-privilege','Your WFH privilege changed',
      'An administrator revoked these approved dates: '||coalesce(date_list,'')||case when p_points_to_remove>0 then '. '||p_points_to_remove::text||' remaining point(s) were also removed' else '' end||case when p_reason<>'' then '. '||p_reason else '.' end,
      '/wfh-privileges');
  end if;
  return changed;
end;
$$;

revoke all on function public.decide_wfh_privilege_request(uuid,text,date[],text), public.admin_revoke_wfh_dates(uuid,date[],text,integer) from public,anon;
grant execute on function public.decide_wfh_privilege_request(uuid,text,date[],text), public.admin_revoke_wfh_dates(uuid,date[],text,integer) to authenticated;
