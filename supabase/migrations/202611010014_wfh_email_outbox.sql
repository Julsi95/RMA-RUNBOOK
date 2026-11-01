-- Transactional WFH email outbox. This only observes WFH audit events and
-- does not alter the existing Auth email hook or other notification flows.
create table public.wfh_email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index wfh_email_outbox_pending_idx
  on public.wfh_email_outbox(available_at,created_at)
  where status in ('pending','processing');
alter table public.wfh_email_outbox enable row level security;
revoke all on public.wfh_email_outbox from public,anon,authenticated;
grant select,insert,update on public.wfh_email_outbox to service_role;

create or replace function public.enqueue_wfh_email_for_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_name text;
  employee_user_id uuid;
  recipient_id uuid;
  request_type_value text;
  event_type_value text;
  dedupe_key_value text;
  event_payload jsonb;
begin
  if new.action not in (
    'awarded','requested','cancellation_requested','approved','rejected',
    'cancellation_approved','cancellation_rejected','revoked','points_removed'
  ) then
    return new;
  end if;

  select e.name into employee_name
    from public.employees e where e.id=new.employee_id;
  if employee_name is null then employee_name := 'A RUNBOOK employee'; end if;

  event_payload := jsonb_build_object(
    'employee_name',employee_name,
    'days',new.details->'days',
    'expires_on',new.details->'expires_on',
    'dates',coalesce(new.details->'dates',new.details->'approved_dates',new.details->'requested_dates'),
    'requested_dates',new.details->'requested_dates',
    'approved_dates',new.details->'approved_dates',
    'dates_changed',coalesce((new.details->>'dates_changed')::boolean,false),
    'credit_returned',coalesce(
      (new.details->>'credit_returned')::boolean,
      jsonb_array_length(coalesce(new.details->'refunded_dates','[]'::jsonb)) > 0,
      false
    ),
    'points_removed',new.details->'points_removed',
    'days_removed',new.details->'days_removed'
  );

  if new.action in ('requested','cancellation_requested') and new.request_id is not null then
    select r.request_type into request_type_value
      from public.wfh_privilege_requests r where r.id=new.request_id;
    event_type_value := case when request_type_value='cancel' then 'cancellation_requested' else 'request_submitted' end;
    for recipient_id in
      select distinct n.recipient_id
        from public.user_notifications n
       where n.category='wfh-privilege'
         and n.event_key='wfh-request:'||new.request_id::text
    loop
      insert into public.wfh_email_outbox(dedupe_key,recipient_user_id,event_type,payload)
      values('audit:'||new.id::text||':'||recipient_id::text,recipient_id,event_type_value,event_payload)
      on conflict(dedupe_key) do nothing;
    end loop;
    return new;
  end if;

  if new.request_id is not null then
    select event_payload || jsonb_build_object(
      'dates',coalesce(new.details->'dates',to_jsonb(r.requested_dates)),
      'requested_dates',coalesce(new.details->'requested_dates',to_jsonb(r.requested_dates)),
      'approved_dates',coalesce(new.details->'approved_dates',to_jsonb(r.approved_dates))
    )
      into event_payload
      from public.wfh_privilege_requests r
     where r.id=new.request_id;
  end if;

  select a.user_id into employee_user_id
    from public.app_accounts a
   where a.employee_id=new.employee_id
   order by (a.role='super_admin') desc
   limit 1;
  if employee_user_id is null then return new; end if;

  event_type_value := case new.action
    when 'awarded' then 'reward_awarded'
    when 'approved' then case when coalesce((new.details->>'dates_changed')::boolean,false) then 'request_adjusted' else 'request_approved' end
    when 'rejected' then case when exists(select 1 from public.wfh_privilege_requests r where r.id=new.request_id and r.request_type='cancel') then 'cancellation_rejected' else 'request_rejected' end
    when 'cancellation_approved' then 'cancellation_approved'
    when 'cancellation_rejected' then 'cancellation_rejected'
    when 'revoked' then case when new.details ? 'dates' then 'approved_dates_revoked' else 'reward_revoked' end
    when 'points_removed' then 'points_removed'
    else null
  end;
  if event_type_value is null then return new; end if;

  if event_type_value='approved_dates_revoked' then
    -- One admin action can create several audit rows. Group those rows into
    -- one message per employee and transaction instead of mailing per date.
    dedupe_key_value := 'tx:'||txid_current()::text||':revoke:'||employee_user_id::text;
    insert into public.wfh_email_outbox as queued(dedupe_key,recipient_user_id,event_type,payload)
    values(dedupe_key_value,employee_user_id,event_type_value,event_payload)
    on conflict(dedupe_key) do update
      set payload = queued.payload || excluded.payload || jsonb_build_object(
        'dates',coalesce(queued.payload->'dates','[]'::jsonb)||coalesce(excluded.payload->'dates','[]'::jsonb),
        'credit_returned',coalesce((queued.payload->>'credit_returned')::boolean,false)
          or coalesce((excluded.payload->>'credit_returned')::boolean,false)
      );
  else
    insert into public.wfh_email_outbox(dedupe_key,recipient_user_id,event_type,payload)
    values('audit:'||new.id::text||':'||employee_user_id::text,employee_user_id,event_type_value,event_payload)
    on conflict(dedupe_key) do nothing;
  end if;
  return new;
exception when others then
  -- Email is secondary to the WFH action. A delivery-queue issue must never
  -- roll back a reward, request, approval, or audit record.
  raise warning 'WFH email enqueue skipped (SQLSTATE %).', SQLSTATE;
  return new;
end;
$$;
revoke all on function public.enqueue_wfh_email_for_audit() from public,anon,authenticated;
drop trigger if exists wfh_email_outbox_from_audit on public.wfh_privilege_audit;
create trigger wfh_email_outbox_from_audit
  after insert on public.wfh_privilege_audit
  for each row execute function public.enqueue_wfh_email_for_audit();

create or replace function public.claim_wfh_email_outbox(p_limit integer default 5)
returns table(id uuid,recipient_user_id uuid,event_type text,payload jsonb,attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service access is required.' using errcode='42501';
  end if;
  return query
    with candidates as (
      select o.id
        from public.wfh_email_outbox o
       where (o.status='pending' and o.available_at<=now())
          or (o.status='processing' and o.locked_at<now()-interval '10 minutes')
       order by o.available_at,o.created_at
       limit greatest(1,least(coalesce(p_limit,5),10))
       for update skip locked
    ), claimed as (
      update public.wfh_email_outbox o
         set status='processing',locked_at=now(),attempts=o.attempts+1
        from candidates c
       where o.id=c.id
       returning o.id,o.recipient_user_id,o.event_type,o.payload,o.attempts
    )
    select claimed.id,claimed.recipient_user_id,claimed.event_type,claimed.payload,claimed.attempts
      from claimed;
end;
$$;
revoke all on function public.claim_wfh_email_outbox(integer) from public,anon,authenticated;
grant execute on function public.claim_wfh_email_outbox(integer) to service_role;

-- Supabase Cron retries queued emails even if no user is currently online.
create extension if not exists pg_net with schema extensions;
create or replace function public.invoke_wfh_email_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  dispatch_key text;
begin
  select s.decrypted_secret into project_url
    from vault.decrypted_secrets s where s.name='wfh_email_dispatch_url';
  select s.decrypted_secret into dispatch_key
    from vault.decrypted_secrets s where s.name='wfh_email_dispatch_key';
  if coalesce(project_url,'')='' or coalesce(dispatch_key,'')='' then return; end if;
  perform net.http_post(
    url:=rtrim(project_url,'/')||'/functions/v1/send-wfh-email',
    headers:=jsonb_build_object('Content-Type','application/json','x-wfh-dispatch-secret',dispatch_key),
    body:=jsonb_build_object('source','scheduled-outbox'),
    timeout_milliseconds:=5000
  );
end;
$$;
revoke all on function public.invoke_wfh_email_dispatcher() from public,anon,authenticated;
do $$
begin
  if exists(select 1 from cron.job where jobname='runbook-wfh-email-dispatch') then
    perform cron.unschedule('runbook-wfh-email-dispatch');
  end if;
  perform cron.schedule('runbook-wfh-email-dispatch','* * * * *','select public.invoke_wfh_email_dispatcher();');
end;
$$;

notify pgrst,'reload schema';
