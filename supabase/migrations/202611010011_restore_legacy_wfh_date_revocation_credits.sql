-- Migration 009 briefly revoked approved dates without refunding their
-- eligible points. Restore only those exact allocations, based on their
-- append-only audit events. Whole-reward revocations have no `dates` array
-- and are intentionally excluded.
do $$
declare
  candidate record;
begin
  for candidate in
    select audit.id as audit_id,
           audit.employee_id,
           audit.reward_id,
           audit.request_id,
           (audit.details->'dates'->>0)::date as privilege_date,
           allocation.id as allocation_id
      from public.wfh_privilege_audit audit
      join public.wfh_privilege_allocations allocation
        on allocation.employee_id=audit.employee_id
       and allocation.reward_id=audit.reward_id
       and allocation.request_id=audit.request_id
       and allocation.privilege_date=(audit.details->'dates'->>0)::date
      join public.wfh_privilege_rewards reward on reward.id=audit.reward_id
     where audit.action='revoked'
       and audit.details ? 'days_removed'
       and audit.details ? 'dates'
       and coalesce((audit.details->>'days_removed')::integer,0)=1
       and allocation.status='cancelled_uncredited'
       and reward.revoked_at is null
       and reward.expires_on >= public.runbook_today()
       and not exists (
         select 1 from public.wfh_privilege_audit restored
          where restored.action='credit_returned'
            and restored.details->>'source_audit_id'=audit.id::text
       )
     order by audit.created_at, audit.id
     for update of allocation, reward
  loop
    -- Changing allocation status first makes this safe if duplicate legacy
    -- audit rows ever point to the same allocation.
    update public.wfh_privilege_allocations
       set status='cancelled_refunded'
     where id=candidate.allocation_id and status='cancelled_uncredited';
    if not found then continue; end if;

    update public.wfh_privilege_rewards
       set days_available=days_available+1
     where id=candidate.reward_id
       and revoked_at is null
       and expires_on >= public.runbook_today()
       and days_available < days_awarded;
    if not found then
      update public.wfh_privilege_allocations
         set status='cancelled_uncredited'
       where id=candidate.allocation_id and status='cancelled_refunded';
      continue;
    end if;

    insert into public.wfh_privilege_audit(employee_id,reward_id,request_id,action,details)
    values(candidate.employee_id,candidate.reward_id,candidate.request_id,'credit_returned',
      jsonb_build_object('source_audit_id',candidate.audit_id,'date',candidate.privilege_date,'points_returned',1,'reason','Restored eligible point from legacy date revocation.'));
  end loop;
end;
$$;
