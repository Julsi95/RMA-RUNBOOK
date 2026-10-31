create table if not exists public.runbook_terms_acceptances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now()
);
alter table public.runbook_terms_acceptances enable row level security;
revoke all on public.runbook_terms_acceptances from public, anon, authenticated;

create or replace function public.runbook_terms_accepted(p_version text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.is_current_runbook_session()
    and exists (select 1 from public.runbook_terms_acceptances a where a.user_id = auth.uid() and a.terms_version = p_version);
$$;

create or replace function public.accept_runbook_terms(p_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_current_runbook_session() then
    raise exception 'A valid signed-in session is required.' using errcode = '42501';
  end if;
  if p_version <> '2026-11-01' then raise exception 'This terms version is not supported.' using errcode = '22023'; end if;
  insert into public.runbook_terms_acceptances(user_id,terms_version,accepted_at)
  values(auth.uid(),p_version,now())
  on conflict(user_id) do update set terms_version=excluded.terms_version,accepted_at=excluded.accepted_at;
end;
$$;
revoke all on function public.runbook_terms_accepted(text), public.accept_runbook_terms(text) from public, anon;
grant execute on function public.runbook_terms_accepted(text), public.accept_runbook_terms(text) to authenticated;

create or replace function public.request_wfh_privilege(p_dates date[], p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  employee_id_value text;
  request_id_value uuid;
  work_date date;
  available_days integer;
  pending_days integer;
begin
  if auth.uid() is null or not public.is_current_runbook_session() then raise exception 'Sign in to request WFH privileges.' using errcode = '42501'; end if;
  select a.employee_id into employee_id_value from public.app_accounts a where a.user_id = auth.uid();
  if employee_id_value is null or not exists (select 1 from public.employees e where e.id = employee_id_value and e.deleted_at is null) then
    raise exception 'Link your account to an active employee record before requesting WFH privileges.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(employee_id_value, 0));
  if p_dates is null or cardinality(p_dates) not between 1 and 30 or length(coalesce(p_note,'')) > 500
     or cardinality(p_dates) <> (select count(distinct d) from unnest(p_dates) d) then
    raise exception 'Choose 1–30 unique dates and keep the note within 500 characters.' using errcode = '22023';
  end if;
  foreach work_date in array p_dates loop
    if work_date <= public.runbook_today() or not public.is_wfh_workday(work_date) then
      raise exception 'Choose future weekdays that are not marked as non-working holidays.' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from public.wfh_privilege_requests r where r.employee_id = employee_id_value and r.request_type = 'use' and r.status = 'pending' and r.requested_dates && p_dates)
     or exists (select 1 from public.wfh_privilege_allocations a where a.employee_id = employee_id_value and a.status = 'active' and a.privilege_date = any(p_dates)) then
    raise exception 'One or more dates are already included in a pending or approved WFH request.' using errcode = '23505';
  end if;
  select coalesce(sum(r.days_available),0)::integer into available_days
    from public.wfh_privilege_rewards r where r.employee_id = employee_id_value and r.revoked_at is null and r.expires_on >= public.runbook_today();
  select coalesce(sum(cardinality(r.requested_dates)),0)::integer into pending_days
    from public.wfh_privilege_requests r where r.employee_id = employee_id_value and r.request_type = 'use' and r.status = 'pending';
  if cardinality(p_dates) > greatest(0,available_days-pending_days) then
    raise exception 'Your request exceeds your available WFH privilege balance.' using errcode = '22023';
  end if;
  insert into public.wfh_privilege_requests(employee_id,request_type,requested_dates,note,created_by)
  values(employee_id_value,'use',p_dates,btrim(coalesce(p_note,'')),auth.uid()) returning id into request_id_value;
  insert into public.wfh_privilege_audit(employee_id,request_id,actor_id,action,details)
  values(employee_id_value,request_id_value,auth.uid(),'requested',jsonb_build_object('dates',p_dates,'note',btrim(coalesce(p_note,''))));
  return request_id_value;
end;
$$;
revoke all on function public.request_wfh_privilege(date[],text) from public, anon;
grant execute on function public.request_wfh_privilege(date[],text) to authenticated;
