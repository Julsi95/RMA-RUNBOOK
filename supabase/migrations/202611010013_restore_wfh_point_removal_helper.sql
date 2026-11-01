-- Restore the private point-allocation helper used by the admin RPC.
-- The public-facing entry point remains admin_remove_wfh_points, which checks
-- the authenticated session and admin role before reaching this function.
create or replace function public.remove_wfh_points_for_employee(
  p_employee_id text,
  p_points integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  reward_row public.wfh_privilege_rewards%rowtype;
  remaining integer := p_points;
  amount_to_remove integer;
begin
  if p_employee_id is null or p_points is null or p_points < 1
     or length(coalesce(p_reason,'')) > 500 then
    raise exception 'Choose an employee and a valid number of WFH points to remove.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.employees
     where id=p_employee_id and deleted_at is null
  ) then
    raise exception 'The employee is not active.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_employee_id, 0));
  for reward_row in
    select * from public.wfh_privilege_rewards
     where employee_id=p_employee_id
       and revoked_at is null
       and expires_on >= public.runbook_today()
       and days_available > 0
     order by expires_on, created_at, id
     for update
  loop
    exit when remaining <= 0;
    amount_to_remove := least(remaining,reward_row.days_available);
    update public.wfh_privilege_rewards
       set days_available=days_available-amount_to_remove
     where id=reward_row.id;
    insert into public.wfh_privilege_audit(employee_id,reward_id,actor_id,action,details)
    values(p_employee_id,reward_row.id,auth.uid(),'points_removed',
      jsonb_build_object('points_removed',amount_to_remove,'reason',btrim(coalesce(p_reason,''))));
    remaining := remaining-amount_to_remove;
  end loop;
  if remaining > 0 then
    raise exception 'The agent no longer has enough active WFH points to remove.' using errcode = '22023';
  end if;
  return p_points;
end;
$$;

revoke all on function public.remove_wfh_points_for_employee(text,integer,text) from public,anon,authenticated;
notify pgrst, 'reload schema';
