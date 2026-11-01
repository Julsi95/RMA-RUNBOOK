-- Finish a one-time repair for eligible date revocations from migration 009.
-- Uses a set-based update so multiple dates against the same reward are all
-- restored in one transaction and does not touch whole-reward revocations.
create temporary table wfh_legacy_refund_candidates on commit drop as
select audit.id as audit_id,
       audit.employee_id,
       audit.reward_id,
       audit.request_id,
       (audit.details->'dates'->>0)::date as privilege_date,
       allocation.id as allocation_id,
       row_number() over (partition by reward.id order by audit.created_at,audit.id) as refund_order,
       greatest(reward.days_awarded-reward.days_available,0) as refund_capacity
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
   );

with grouped_refunds as (
  select reward_id,count(*)::integer as refund_count
    from wfh_legacy_refund_candidates
   where refund_order <= refund_capacity
   group by reward_id
), updated_rewards as (
  update public.wfh_privilege_rewards reward
     set days_available=reward.days_available+grouped_refunds.refund_count
    from grouped_refunds
   where reward.id=grouped_refunds.reward_id
     and reward.revoked_at is null
     and reward.expires_on >= public.runbook_today()
     and reward.days_available+grouped_refunds.refund_count <= reward.days_awarded
  returning reward.id
), updated_allocations as (
  update public.wfh_privilege_allocations allocation
     set status='cancelled_refunded'
    from wfh_legacy_refund_candidates candidate
    join updated_rewards on updated_rewards.id=candidate.reward_id
   where candidate.refund_order <= candidate.refund_capacity
     and allocation.id=candidate.allocation_id
     and allocation.status='cancelled_uncredited'
  returning candidate.audit_id,candidate.employee_id,candidate.reward_id,candidate.request_id,candidate.privilege_date
)
insert into public.wfh_privilege_audit(employee_id,reward_id,request_id,action,details)
select employee_id,reward_id,request_id,'credit_returned',
       jsonb_build_object('source_audit_id',audit_id,'date',privilege_date,'points_returned',1,
         'reason','Restored eligible point from legacy date revocation.')
  from updated_allocations;
