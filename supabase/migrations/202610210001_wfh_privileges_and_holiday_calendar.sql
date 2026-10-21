create table public.holiday_calendar (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code in ('US', 'PH')),
  holiday_date date not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  name_override text,
  source text not null check (source in ('api', 'manual')),
  source_key text unique,
  api_is_working boolean,
  is_working_override boolean,
  is_working boolean generated always as (coalesce(is_working_override, api_is_working, false)) stored,
  normalized_name text generated always as (lower(btrim(coalesce(name_override, name)))) stored,
  is_active boolean not null default true,
  deleted_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source = 'api' and source_key is not null and api_is_working is not null)
      or (source = 'manual' and source_key is null))
);
create unique index holiday_calendar_unique_display_entry
  on public.holiday_calendar(country_code, holiday_date, normalized_name)
  where is_active and deleted_at is null;
create index holiday_calendar_date_idx
  on public.holiday_calendar(holiday_date, country_code)
  where is_active and deleted_at is null;
alter table public.holiday_calendar enable row level security;
revoke all on public.holiday_calendar from anon, authenticated;
grant select on public.holiday_calendar to anon, authenticated;
create policy "Published holiday calendar is readable"
  on public.holiday_calendar for select to anon, authenticated
  using (is_active and deleted_at is null
    and (auth.role() = 'anon' or public.is_current_runbook_session()));

create table public.holiday_sync_state (
  country_code text not null check (country_code in ('US', 'PH')),
  sync_year integer not null check (sync_year between 2000 and 2200),
  synced_at timestamptz not null,
  item_count integer not null default 0,
  primary key(country_code, sync_year)
);
alter table public.holiday_sync_state enable row level security;
revoke all on public.holiday_sync_state from anon, authenticated;

create table public.holiday_audit_events (
  id uuid primary key default gen_random_uuid(),
  holiday_id uuid,
  actor_id uuid,
  action text not null check (action in ('create', 'update', 'delete', 'sync')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.holiday_audit_events enable row level security;
revoke all on public.holiday_audit_events from anon, authenticated;
grant select on public.holiday_audit_events to authenticated;
create policy "Admins read holiday history"
  on public.holiday_audit_events for select to authenticated
  using (public.is_current_runbook_session() and public.is_runbook_admin());

create or replace function public.block_holiday_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Holiday audit history is append-only.' using errcode = '42501';
end;
$$;
revoke all on function public.block_holiday_audit_mutation() from public, anon, authenticated;
create trigger holiday_audit_append_only
  before update or delete on public.holiday_audit_events
  for each row execute function public.block_holiday_audit_mutation();

create or replace function public.sync_holiday_calendar(p_country text, p_year integer, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry record;
  entry_key text;
  entry_count integer := 0;
  seen_keys text[] := array[]::text[];
  seen_display_entries text[] := array[]::text[];
  display_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Holiday synchronization must run through the authenticated server function.' using errcode = '42501';
  end if;
  if p_country is null or p_country not in ('US', 'PH') or p_year is null or p_year < 2000 or p_year > 2200
     or p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'A valid country, year, and non-empty holiday list are required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) = 0 then
    raise exception 'A valid country, year, and non-empty holiday list are required.' using errcode = '22023';
  end if;

  for entry in
    select * from jsonb_to_recordset(p_entries) as x(holiday_date date, name text, is_working boolean, source_key text)
  loop
    if entry.holiday_date is null or extract(year from entry.holiday_date)::integer <> p_year
       or entry.name is null or length(btrim(entry.name)) not between 1 and 160
       or entry.is_working is null or entry.source_key is null
       or length(entry.source_key) > 240
       or entry.source_key !~ ('^' || p_country || ':' || entry.holiday_date::text || ':[0-9]+$') then
      raise exception 'The holiday provider returned an invalid entry.' using errcode = '22023';
    end if;
    entry_key := entry.source_key;
    if entry_key = any(seen_keys) then continue; end if;
    display_key := p_country || ':' || entry.holiday_date::text || ':' || lower(btrim(entry.name));
    if display_key = any(seen_display_entries) then continue; end if;
    seen_display_entries := array_append(seen_display_entries, display_key);
    entry_count := entry_count + 1;

    -- A hand-entered duplicate takes precedence over provider data.
    if exists (
      select 1 from public.holiday_calendar h
       where h.country_code = p_country and h.holiday_date = entry.holiday_date
         and h.normalized_name = lower(btrim(entry.name))
         and h.source = 'manual' and h.deleted_at is null and h.is_active
    ) then
      continue;
    end if;
    seen_keys := array_append(seen_keys, entry_key);

    insert into public.holiday_calendar as current_holiday(country_code, holiday_date, name, source, source_key, api_is_working, is_active, synced_at)
    values (p_country, entry.holiday_date, btrim(entry.name), 'api', entry_key, entry.is_working, true, now())
    on conflict (source_key) do update
      set name = case when current_holiday.name_override is null then excluded.name else current_holiday.name end,
          api_is_working = excluded.api_is_working,
          is_active = current_holiday.deleted_at is null,
          synced_at = now(), updated_at = now();
  end loop;

  if entry_count = 0 then
    raise exception 'The holiday provider returned no usable entries.' using errcode = '22023';
  end if;

  update public.holiday_calendar h
     set is_active = false, updated_at = now()
   where h.country_code = p_country
     and extract(year from h.holiday_date)::integer = p_year
     and h.source = 'api' and h.is_active and h.deleted_at is null
     and h.name_override is null and h.is_working_override is null
     and not (h.source_key = any(seen_keys));

  insert into public.holiday_sync_state(country_code, sync_year, synced_at, item_count)
  values (p_country, p_year, now(), entry_count)
  on conflict (country_code, sync_year) do update
    set synced_at = excluded.synced_at, item_count = excluded.item_count;
  insert into public.holiday_audit_events(actor_id, action, detail)
  values (auth.uid(), 'sync', jsonb_build_object('country', p_country, 'year', p_year, 'count', entry_count));
  return jsonb_build_object('country', p_country, 'year', p_year, 'count', entry_count);
end;
$$;
revoke all on function public.sync_holiday_calendar(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.sync_holiday_calendar(text, integer, jsonb) to service_role;

create or replace function public.save_holiday(
  p_id uuid, p_country text, p_date date, p_name text, p_is_working boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_id uuid;
  prior jsonb;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_country is null or p_country not in ('US', 'PH') or p_date is null or p_name is null
     or length(btrim(p_name)) not between 1 and 160 or p_is_working is null then
    raise exception 'Enter a holiday name, date, country, and working status.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.holiday_calendar(country_code, holiday_date, name, source, is_working_override)
    values (p_country, p_date, btrim(p_name), 'manual', p_is_working)
    returning id into saved_id;
    insert into public.holiday_audit_events(holiday_id, actor_id, action, detail)
    values (saved_id, auth.uid(), 'create', jsonb_build_object('country',p_country,'date',p_date,'name',btrim(p_name),'is_working',p_is_working));
  else
    select to_jsonb(h) into prior from public.holiday_calendar h where h.id = p_id and h.deleted_at is null and h.is_active for update;
    if prior is null then raise exception 'Holiday not found.' using errcode = 'P0002'; end if;
    update public.holiday_calendar
       set country_code = p_country,
           holiday_date = p_date,
           name = case when source = 'manual' then btrim(p_name) else name end,
           name_override = case when source = 'api' then btrim(p_name) else null end,
           is_working_override = p_is_working,
           updated_at = now()
     where id = p_id returning id into saved_id;
    insert into public.holiday_audit_events(holiday_id, actor_id, action, detail)
    values (saved_id, auth.uid(), 'update', jsonb_build_object('before', prior, 'after', (select to_jsonb(h) from public.holiday_calendar h where h.id = saved_id)));
  end if;
  return saved_id;
end;
$$;

create or replace function public.delete_holiday(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare prior jsonb;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  select to_jsonb(h) into prior from public.holiday_calendar h where h.id = p_id and h.deleted_at is null for update;
  if prior is null then raise exception 'Holiday not found.' using errcode = 'P0002'; end if;
  update public.holiday_calendar set deleted_at = now(), is_active = false, updated_at = now() where id = p_id;
  insert into public.holiday_audit_events(holiday_id, actor_id, action, detail)
  values (p_id, auth.uid(), 'delete', prior);
end;
$$;
revoke all on function public.save_holiday(uuid,text,date,text,boolean), public.delete_holiday(uuid) from public, anon;
grant execute on function public.save_holiday(uuid,text,date,text,boolean), public.delete_holiday(uuid) to authenticated;

create table public.wfh_privilege_settings (
  singleton boolean primary key default true check (singleton),
  expiration_days integer not null default 365 check (expiration_days between 1 and 3650),
  cancellation_notice_days integer not null default 1 check (cancellation_notice_days between 0 and 90),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.wfh_privilege_settings(singleton) values (true) on conflict do nothing;
alter table public.wfh_privilege_settings enable row level security;
revoke all on public.wfh_privilege_settings from anon, authenticated;
grant select on public.wfh_privilege_settings to authenticated;
create policy "Authenticated users read WFH policy"
  on public.wfh_privilege_settings for select to authenticated using (public.is_current_runbook_session());

create table public.wfh_privilege_rewards (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees(id) on delete cascade,
  days_awarded integer not null check (days_awarded between 1 and 365),
  days_available integer not null check (days_available between 0 and days_awarded),
  expires_on date not null,
  note text not null default '',
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index wfh_rewards_employee_expiry_idx on public.wfh_privilege_rewards(employee_id, expires_on, created_at);
alter table public.wfh_privilege_rewards enable row level security;
revoke all on public.wfh_privilege_rewards from anon, authenticated;
grant select on public.wfh_privilege_rewards to authenticated;

create table public.wfh_privilege_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees(id) on delete cascade,
  request_type text not null check (request_type in ('use', 'cancel')),
  requested_dates date[] not null check (cardinality(requested_dates) between 1 and 30),
  approved_dates date[],
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text not null default '',
  decision_note text not null default '',
  created_by uuid not null,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index wfh_requests_employee_created_idx on public.wfh_privilege_requests(employee_id, created_at desc);
create index wfh_requests_pending_idx on public.wfh_privilege_requests(created_at) where status = 'pending';
alter table public.wfh_privilege_requests enable row level security;
revoke all on public.wfh_privilege_requests from anon, authenticated;
grant select on public.wfh_privilege_requests to authenticated;

create table public.wfh_privilege_allocations (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees(id) on delete cascade,
  request_id uuid not null references public.wfh_privilege_requests(id) on delete cascade,
  reward_id uuid not null references public.wfh_privilege_rewards(id) on delete cascade,
  privilege_date date not null,
  status text not null default 'active' check (status in ('active', 'cancelled_refunded', 'cancelled_uncredited')),
  cancellation_request_id uuid references public.wfh_privilege_requests(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index wfh_one_active_privilege_per_employee_day
  on public.wfh_privilege_allocations(employee_id, privilege_date) where status = 'active';
create index wfh_allocations_employee_date_idx on public.wfh_privilege_allocations(employee_id, privilege_date desc);
alter table public.wfh_privilege_allocations enable row level security;
revoke all on public.wfh_privilege_allocations from anon, authenticated;
grant select on public.wfh_privilege_allocations to authenticated;

create table public.wfh_privilege_audit (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  reward_id uuid,
  request_id uuid,
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index wfh_audit_employee_created_idx on public.wfh_privilege_audit(employee_id, created_at desc);
alter table public.wfh_privilege_audit enable row level security;
revoke all on public.wfh_privilege_audit from anon, authenticated;
grant select on public.wfh_privilege_audit to authenticated;

create or replace function public.block_wfh_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'WFH privilege audit history is append-only.' using errcode = '42501';
end;
$$;
revoke all on function public.block_wfh_audit_mutation() from public, anon, authenticated;
create trigger wfh_privilege_audit_append_only
  before update or delete on public.wfh_privilege_audit
  for each row execute function public.block_wfh_audit_mutation();

create or replace function public.is_wfh_workday(p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_date is not null
     and extract(isodow from p_date) between 1 and 5
     and not exists (
       select 1 from public.holiday_calendar h
        where h.holiday_date = p_date and h.is_active and h.deleted_at is null and not h.is_working
     );
$$;
create or replace function public.runbook_today()
returns date language sql stable set search_path = '' as $$
  select timezone('Asia/Manila', now())::date;
$$;
revoke all on function public.runbook_today() from public, anon;
grant execute on function public.runbook_today() to authenticated;

create or replace function public.is_wfh_responsible_approver(p_employee_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive chain(id, manager_id, hierarchy_roles, role, depth, visited) as (
    select e.id, e.manager_id, e.hierarchy_roles, e.role, 0, array[e.id]::text[]
      from public.employees e where e.id = p_employee_id and e.deleted_at is null
    union all
    select m.id, m.manager_id, m.hierarchy_roles, m.role, c.depth + 1, c.visited || m.id
      from chain c join public.employees m on m.id = c.manager_id
     where m.deleted_at is null and c.depth < 32 and not m.id = any(c.visited)
  ), leads as (
    select c.id, c.depth from chain c
     where coalesce(c.hierarchy_roles, '{}'::text[]) && array['Senior Team Lead (STL)','Team Lead (TL)']::text[]
        or lower(btrim(coalesce(c.role,''))) in ('team lead','team lead (tl)','tl','senior team lead','senior team lead (stl)','stl')
  ), responsible as (select id from leads order by depth limit 1)
  select exists (
    select 1 from responsible r join public.app_accounts a on a.employee_id = r.id
     where a.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_view_wfh_employee(p_employee_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_runbook_admin()
      or exists (select 1 from public.app_accounts a where a.user_id = (select auth.uid()) and a.employee_id = p_employee_id)
      or public.is_wfh_responsible_approver(p_employee_id);
$$;
revoke all on function public.is_wfh_workday(date), public.is_wfh_responsible_approver(text), public.can_view_wfh_employee(text) from public, anon;
grant execute on function public.is_wfh_workday(date), public.is_wfh_responsible_approver(text), public.can_view_wfh_employee(text) to authenticated;

create policy "WFH rewards are scoped to owners and responsible leads"
  on public.wfh_privilege_rewards for select to authenticated using (public.is_current_runbook_session() and public.can_view_wfh_employee(employee_id));
create policy "WFH requests are scoped to owners and responsible leads"
  on public.wfh_privilege_requests for select to authenticated using (public.is_current_runbook_session() and public.can_view_wfh_employee(employee_id));
create policy "WFH allocations are scoped to owners and responsible leads"
  on public.wfh_privilege_allocations for select to authenticated using (public.is_current_runbook_session() and public.can_view_wfh_employee(employee_id));
create policy "WFH audit is scoped to owners and responsible leads"
  on public.wfh_privilege_audit for select to authenticated using (public.is_current_runbook_session() and public.can_view_wfh_employee(employee_id));

create or replace function public.update_wfh_privilege_settings(p_expiration_days integer, p_cancellation_notice_days integer)
returns void language plpgsql security definer set search_path = '' as $$
declare previous_settings jsonb;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_expiration_days is null or p_expiration_days not between 1 and 3650
     or p_cancellation_notice_days is null or p_cancellation_notice_days not between 0 and 90 then
    raise exception 'Expiration must be 1–3650 days and cancellation notice must be 0–90 days.' using errcode = '22023';
  end if;
  select to_jsonb(s) into previous_settings from public.wfh_privilege_settings s where singleton for update;
  update public.wfh_privilege_settings
     set expiration_days = p_expiration_days, cancellation_notice_days = p_cancellation_notice_days,
         updated_by = auth.uid(), updated_at = now()
   where singleton;
  insert into public.wfh_privilege_audit(employee_id, actor_id, action, details)
  values (null, auth.uid(), 'policy_updated', jsonb_build_object(
    'before', previous_settings,
    'after', jsonb_build_object('expiration_days', p_expiration_days, 'cancellation_notice_days', p_cancellation_notice_days)
  ));
end;
$$;

create or replace function public.award_wfh_privileges(
  p_employee_ids text[], p_days integer, p_expires_on date default null, p_note text default ''
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  employee_id_value text;
  reward_id_value uuid;
  expiry date;
  awarded_count integer := 0;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_employee_ids is null or cardinality(p_employee_ids) = 0 or p_days is null or p_days not between 1 and 365
     or length(coalesce(p_note,'')) > 500 then
    raise exception 'Select at least one employee and award between 1 and 365 days.' using errcode = '22023';
  end if;
  select coalesce(p_expires_on, public.runbook_today() + s.expiration_days) into expiry
    from public.wfh_privilege_settings s where s.singleton;
  if expiry <= public.runbook_today() then raise exception 'The expiration date must be in the future.' using errcode = '22023'; end if;

  for employee_id_value in select distinct unnest(p_employee_ids) loop
    if not exists (select 1 from public.employees e where e.id = employee_id_value and e.deleted_at is null) then
      raise exception 'An award recipient is not an active employee.' using errcode = '22023';
    end if;
    insert into public.wfh_privilege_rewards(employee_id,days_awarded,days_available,expires_on,note,created_by)
    values(employee_id_value,p_days,p_days,expiry,btrim(coalesce(p_note,'')),auth.uid()) returning id into reward_id_value;
    insert into public.wfh_privilege_audit(employee_id,reward_id,actor_id,action,details)
    values(employee_id_value,reward_id_value,auth.uid(),'awarded',jsonb_build_object('days',p_days,'expires_on',expiry,'note',btrim(coalesce(p_note,''))));
    awarded_count := awarded_count + 1;
  end loop;
  return awarded_count;
end;
$$;

create or replace function public.revoke_wfh_reward(p_reward_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare reward public.wfh_privilege_rewards%rowtype;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if length(coalesce(p_reason,'')) > 500 then raise exception 'Reason must be 500 characters or fewer.' using errcode = '22023'; end if;
  select * into reward from public.wfh_privilege_rewards where id = p_reward_id for update;
  if not found then raise exception 'Reward not found.' using errcode = 'P0002'; end if;
  if reward.revoked_at is not null then raise exception 'This reward was already revoked.' using errcode = '22023'; end if;
  update public.wfh_privilege_rewards set days_available = 0, revoked_at = now(), revoked_by = auth.uid() where id = p_reward_id;
  insert into public.wfh_privilege_audit(employee_id,reward_id,actor_id,action,details)
  values(reward.employee_id,p_reward_id,auth.uid(),'revoked',jsonb_build_object('days_removed',reward.days_available,'reason',btrim(coalesce(p_reason,''))));
end;
$$;

create or replace function public.request_wfh_privilege(p_dates date[], p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  employee_id_value text;
  request_id_value uuid;
  work_date date;
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
  if exists (
    select 1 from public.wfh_privilege_requests r
     where r.employee_id = employee_id_value and r.request_type = 'use' and r.status = 'pending'
       and r.requested_dates && p_dates
  ) then
    raise exception 'One or more dates are already included in a pending WFH request.' using errcode = '23505';
  end if;
  insert into public.wfh_privilege_requests(employee_id,request_type,requested_dates,note,created_by)
  values(employee_id_value,'use',p_dates,btrim(coalesce(p_note,'')),auth.uid()) returning id into request_id_value;
  insert into public.wfh_privilege_audit(employee_id,request_id,actor_id,action,details)
  values(employee_id_value,request_id_value,auth.uid(),'requested',jsonb_build_object('dates',p_dates,'note',btrim(coalesce(p_note,''))));
  return request_id_value;
end;
$$;

create or replace function public.request_wfh_cancellation(p_dates date[], p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  employee_id_value text;
  request_id_value uuid;
  notice_days integer;
  work_date date;
begin
  if auth.uid() is null or not public.is_current_runbook_session() then raise exception 'Sign in to request cancellation.' using errcode = '42501'; end if;
  select a.employee_id into employee_id_value from public.app_accounts a where a.user_id = auth.uid();
  if employee_id_value is null then raise exception 'Link your account to an employee record first.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(employee_id_value, 0));
  if p_dates is null or cardinality(p_dates) not between 1 and 30 or length(coalesce(p_note,'')) > 500
     or cardinality(p_dates) <> (select count(distinct d) from unnest(p_dates) d) then
    raise exception 'Choose 1–30 unique approved dates and keep the note within 500 characters.' using errcode = '22023';
  end if;
  select cancellation_notice_days into notice_days from public.wfh_privilege_settings where singleton;
  foreach work_date in array p_dates loop
    if work_date < public.runbook_today() + notice_days or not exists (
      select 1 from public.wfh_privilege_allocations a
       where a.employee_id = employee_id_value and a.privilege_date = work_date and a.status = 'active'
    ) then
      raise exception 'Only active approved dates that meet the cancellation notice period can be cancelled.' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from public.wfh_privilege_requests r
     where r.employee_id = employee_id_value and r.request_type = 'cancel' and r.status = 'pending'
       and r.requested_dates && p_dates
  ) then
    raise exception 'One or more dates already have a pending cancellation request.' using errcode = '23505';
  end if;
  insert into public.wfh_privilege_requests(employee_id,request_type,requested_dates,note,created_by)
  values(employee_id_value,'cancel',p_dates,btrim(coalesce(p_note,'')),auth.uid()) returning id into request_id_value;
  insert into public.wfh_privilege_audit(employee_id,request_id,actor_id,action,details)
  values(employee_id_value,request_id_value,auth.uid(),'cancellation_requested',jsonb_build_object('dates',p_dates,'note',btrim(coalesce(p_note,''))));
  return request_id_value;
end;
$$;

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
        update public.wfh_privilege_rewards set days_available=days_available+1 where id=reward.id;
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

create or replace function public.ensure_wfh_expiry_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  if auth.uid() is null or not public.is_current_runbook_session() then raise exception 'Sign-in is required.' using errcode='42501'; end if;
  return public.enqueue_wfh_expiry_notifications();
end;
$$;

create or replace function public.enqueue_wfh_expiry_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  insert into public.user_notifications(recipient_id,event_key,category,title,body,href)
  select a.user_id,
         'wfh-expiry:'||r.id::text,
         'wfh-privilege',
         'WFH days expire soon',
         r.days_available::text||' WFH day(s) expire on '||r.expires_on::text||'.',
         '/wfh-privileges'
    from public.wfh_privilege_rewards r
    join public.app_accounts a on a.employee_id=r.employee_id
   where r.days_available > 0 and r.revoked_at is null
     and public.runbook_today() >= r.expires_on - interval '1 month'
     and public.runbook_today() < r.expires_on
  on conflict(recipient_id,event_key) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

revoke all on function public.enqueue_wfh_expiry_notifications() from public, anon, authenticated;
grant execute on function public.enqueue_wfh_expiry_notifications() to service_role, postgres;

-- Supabase-hosted PostgreSQL provides pg_cron for trusted scheduled database work.
create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'runbook-wfh-expiry-notifications') then
    perform cron.unschedule('runbook-wfh-expiry-notifications');
  end if;
  perform cron.schedule(
    'runbook-wfh-expiry-notifications',
    '0 1 * * *', -- 09:00 Asia/Manila
    'select public.enqueue_wfh_expiry_notifications();'
  );
end;
$$;

revoke all on function public.update_wfh_privilege_settings(integer,integer), public.award_wfh_privileges(text[],integer,date,text), public.revoke_wfh_reward(uuid,text), public.request_wfh_privilege(date[],text), public.request_wfh_cancellation(date[],text), public.decide_wfh_privilege_request(uuid,text,date[],text), public.ensure_wfh_expiry_notifications() from public, anon;
grant execute on function public.update_wfh_privilege_settings(integer,integer), public.award_wfh_privileges(text[],integer,date,text), public.revoke_wfh_reward(uuid,text), public.request_wfh_privilege(date[],text), public.request_wfh_cancellation(date[],text), public.decide_wfh_privilege_request(uuid,text,date[],text), public.ensure_wfh_expiry_notifications() to authenticated;

alter table public.user_notifications drop constraint if exists user_notifications_category_check;
alter table public.user_notifications add constraint user_notifications_category_check
  check (category in ('birthday','vl-credit','dashboard','project','inbound-call','work-schedule','work-link','monthly-kpi','wfh-privilege'));

do $$
declare table_name text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach table_name in array array['holiday_calendar','wfh_privilege_settings','wfh_privilege_rewards','wfh_privilege_requests','wfh_privilege_allocations','wfh_privilege_audit'] loop
      if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
