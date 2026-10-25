create or replace function public.delete_history_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare removed boolean;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode='42501';
  end if;
  delete from public.history_events where id = p_event_id;
  removed := found;
  return removed;
end;
$$;

create or replace function public.reset_runbook_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare removed integer;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode='42501';
  end if;
  delete from public.history_events;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.delete_history_event(uuid), public.reset_runbook_history() from public, anon;
grant execute on function public.delete_history_event(uuid), public.reset_runbook_history() to authenticated;

create or replace function public.request_wfh_privilege(p_dates date[], p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_id_value text;
  request_id_value uuid;
  work_date date;
begin
  if auth.uid() is null or not public.is_current_runbook_session() then
    raise exception 'Sign in to request WFH privileges.' using errcode = '42501';
  end if;
  select a.employee_id into employee_id_value from public.app_accounts a where a.user_id = auth.uid();
  if employee_id_value is null or not exists (
    select 1 from public.employees e where e.id = employee_id_value and e.deleted_at is null
  ) then
    raise exception 'Link your account to an active employee record before requesting WFH privileges.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(employee_id_value, 0));
  if p_dates is null or cardinality(p_dates) not between 1 and 30 or length(coalesce(p_note, '')) > 500
     or cardinality(p_dates) <> (select count(distinct d) from unnest(p_dates) d) then
    raise exception 'Choose 1–30 unique dates and keep the note within 500 characters.' using errcode = '22023';
  end if;
  foreach work_date in array p_dates loop
    if work_date <= public.runbook_today() or not public.is_wfh_workday(work_date) then
      raise exception 'Choose future weekdays that are not marked as non-working holidays.' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from public.wfh_privilege_requests r
     where r.employee_id = employee_id_value and r.request_type = 'use' and r.status = 'pending'
       and r.requested_dates && p_dates
  ) or exists (
    select 1 from public.wfh_privilege_allocations a
     where a.employee_id = employee_id_value and a.status = 'active' and a.privilege_date = any(p_dates)
  ) then
    raise exception 'One or more dates are already filed or scheduled for WFH.' using errcode = '23505';
  end if;

  insert into public.wfh_privilege_requests(employee_id, request_type, requested_dates, note, created_by)
  values(employee_id_value, 'use', p_dates, btrim(coalesce(p_note, '')), auth.uid()) returning id into request_id_value;
  insert into public.wfh_privilege_audit(employee_id, request_id, actor_id, action, details)
  values(employee_id_value, request_id_value, auth.uid(), 'requested', jsonb_build_object('dates', p_dates, 'note', btrim(coalesce(p_note, ''))));
  return request_id_value;
end;
$$;

revoke all on function public.request_wfh_privilege(date[], text) from public, anon;
grant execute on function public.request_wfh_privilege(date[], text) to authenticated;
