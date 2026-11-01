create or replace function public.admin_revoke_wfh_dates(p_reward_id uuid, p_dates date[], p_reason text default '')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  reward public.wfh_privilege_rewards%rowtype;
  allocation record;
  changed integer := 0;
  recipient uuid;
  date_list text;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_dates is null or cardinality(p_dates) not between 1 and 30
     or cardinality(p_dates) <> (select count(distinct d) from unnest(p_dates) d)
     or length(coalesce(p_reason,'')) > 500 then
    raise exception 'Select 1–30 unique WFH dates and keep the reason under 500 characters.' using errcode = '22023';
  end if;
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
    update public.wfh_privilege_allocations set status='cancelled_uncredited' where id=allocation.id;
    if reward.expires_on >= public.runbook_today() then
      update public.wfh_privilege_rewards set days_available=least(days_awarded,days_available+1) where id=reward.id;
    end if;
    update public.wfh_privilege_requests r
       set approved_dates=(select coalesce(array_agg(d order by d),'{}'::date[]) from unnest(coalesce(r.approved_dates,'{}'::date[])) d where d<>allocation.privilege_date),
           status=case when cardinality(coalesce(r.approved_dates,'{}'::date[])) <= 1 then 'cancelled' else r.status end
     where r.id=allocation.request_id;
    insert into public.wfh_privilege_audit(employee_id,reward_id,request_id,actor_id,action,details)
    values(reward.employee_id,reward.id,allocation.request_id,auth.uid(),'revoked',jsonb_build_object('dates',jsonb_build_array(allocation.privilege_date),'reason',btrim(coalesce(p_reason,''))));
    changed := changed + 1;
  end loop;
  if changed <> cardinality(p_dates) then raise exception 'One or more selected dates are no longer active.' using errcode = '23505'; end if;

  select string_agg(d::text, ', ' order by d) into date_list from unnest(p_dates) d;
  select a.user_id into recipient from public.app_accounts a where a.employee_id=reward.employee_id;
  if recipient is not null then
    perform public.create_runbook_notification(recipient,'wfh-admin-date-change:'||reward.id::text||':'||gen_random_uuid()::text,
      'wfh-privilege','Your approved WFH dates changed',
      'An administrator revoked these approved dates: '||coalesce(date_list,'')||case when p_reason<>'' then '. '||p_reason else '.' end,
      '/wfh-privileges');
  end if;
  return changed;
end;
$$;
revoke all on function public.admin_revoke_wfh_dates(uuid,date[],text) from public,anon;
grant execute on function public.admin_revoke_wfh_dates(uuid,date[],text) to authenticated;
