-- Enforce one current Supabase session per RUNBOOK account and apply
-- configurable inactivity and absolute session limits to database access.

create table public.runbook_session_settings (
  singleton boolean primary key default true check (singleton),
  inactivity_timeout_minutes integer not null default 30 check (inactivity_timeout_minutes between 5 and 720),
  absolute_timeout_hours integer not null default 12 check (absolute_timeout_hours between 1 and 168),
  warning_minutes integer not null default 2 check (warning_minutes between 1 and 15),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.runbook_session_settings(singleton) values (true) on conflict do nothing;
alter table public.runbook_session_settings enable row level security;
revoke all on public.runbook_session_settings from anon, authenticated;
grant select on public.runbook_session_settings to authenticated;

create table public.runbook_active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.runbook_active_sessions enable row level security;
revoke all on public.runbook_active_sessions from anon, authenticated;

-- This signal intentionally remains readable by its owner after a session is
-- replaced, so the old tab can receive the sign-out notification.
create table public.runbook_session_signals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  changed_at timestamptz not null default now()
);
alter table public.runbook_session_signals enable row level security;
revoke all on public.runbook_session_signals from anon, authenticated;
grant select on public.runbook_session_signals to authenticated;
create policy "Users read their own session signal" on public.runbook_session_signals
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_current_runbook_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.runbook_active_sessions s
      cross join public.runbook_session_settings p
     where s.user_id = (select auth.uid())
       and s.session_id = nullif((select auth.jwt())->>'session_id', '')::uuid
       and s.last_activity_at > now() - make_interval(mins => p.inactivity_timeout_minutes)
       and s.started_at > now() - make_interval(hours => p.absolute_timeout_hours)
  );
$$;
revoke all on function public.is_current_runbook_session() from public;
grant execute on function public.is_current_runbook_session() to anon, authenticated;

create policy "Current sessions read security settings" on public.runbook_session_settings
  for select to authenticated using (public.is_current_runbook_session());

create or replace function public.claim_runbook_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  jwt_session_id uuid := nullif((select auth.jwt())->>'session_id', '')::uuid;
  incoming_created_at timestamptz;
  active_row public.runbook_active_sessions%rowtype;
begin
  if current_user_id is null or jwt_session_id is null or p_session_id <> jwt_session_id then
    raise exception 'Session claim does not match the signed-in session.' using errcode = '42501';
  end if;

  select s.created_at into incoming_created_at
    from auth.sessions s
   where s.id = jwt_session_id and s.user_id = current_user_id;
  if incoming_created_at is null then return false; end if;

  perform pg_advisory_xact_lock(hashtext(current_user_id::text));
  select * into active_row from public.runbook_active_sessions where user_id = current_user_id for update;

  if found and active_row.session_id = jwt_session_id then
    return public.is_current_runbook_session();
  end if;

  -- A stale session cannot reclaim the account after a newer login. This also
  -- makes concurrent login attempts deterministic by Auth session creation time.
  if found and incoming_created_at <= active_row.started_at then return false; end if;

  insert into public.runbook_active_sessions(user_id, session_id, started_at, last_activity_at, updated_at)
  values (current_user_id, jwt_session_id, incoming_created_at, now(), now())
  on conflict (user_id) do update
    set session_id = excluded.session_id,
        started_at = excluded.started_at,
        last_activity_at = excluded.last_activity_at,
        updated_at = excluded.updated_at;

  insert into public.runbook_session_signals(user_id, changed_at)
  values (current_user_id, now())
  on conflict (user_id) do update set changed_at = excluded.changed_at;

  -- The newly inserted row is not visible to a STABLE helper within this
  -- statement's snapshot. Claim validation and writes above are authoritative.
  return true;
end;
$$;

create or replace function public.touch_runbook_session()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  jwt_session_id uuid := nullif((select auth.jwt())->>'session_id', '')::uuid;
begin
  if not public.is_current_runbook_session() then return false; end if;
  update public.runbook_active_sessions s
     set last_activity_at = now(), updated_at = now()
    from public.runbook_session_settings p
   where s.user_id = current_user_id
     and s.session_id = jwt_session_id
     and s.last_activity_at > now() - make_interval(mins => p.inactivity_timeout_minutes)
     and s.started_at > now() - make_interval(hours => p.absolute_timeout_hours);
  return found;
end;
$$;

create or replace function public.release_runbook_session()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  jwt_session_id uuid := nullif((select auth.jwt())->>'session_id', '')::uuid;
begin
  if current_user_id is null or jwt_session_id is null then return; end if;
  delete from public.runbook_active_sessions
   where user_id = current_user_id and session_id = jwt_session_id;
  if found then
    insert into public.runbook_session_signals(user_id, changed_at)
    values (current_user_id, now())
    on conflict (user_id) do update set changed_at = excluded.changed_at;
  end if;
end;
$$;

create or replace function public.get_runbook_session_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'state', case
      when s.user_id is null then 'unregistered'
      when s.session_id <> nullif((select auth.jwt())->>'session_id', '')::uuid then 'replaced'
      when s.last_activity_at <= now() - make_interval(mins => p.inactivity_timeout_minutes)
        or s.started_at <= now() - make_interval(hours => p.absolute_timeout_hours) then 'expired'
      else 'active'
    end,
    'active', public.is_current_runbook_session(),
    'inactivityDeadline', case when s.session_id = nullif((select auth.jwt())->>'session_id', '')::uuid
      then s.last_activity_at + make_interval(mins => p.inactivity_timeout_minutes) end,
    'absoluteDeadline', case when s.session_id = nullif((select auth.jwt())->>'session_id', '')::uuid
      then s.started_at + make_interval(hours => p.absolute_timeout_hours) end,
    'warningMinutes', p.warning_minutes,
    'inactivityTimeoutMinutes', p.inactivity_timeout_minutes,
    'absoluteTimeoutHours', p.absolute_timeout_hours
  )
  from public.runbook_session_settings p
  left join public.runbook_active_sessions s on s.user_id = (select auth.uid())
  where (select auth.uid()) is not null and p.singleton;
$$;

create or replace function public.get_runbook_session_settings()
returns table(inactivity_timeout_minutes integer, absolute_timeout_hours integer, warning_minutes integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  return query select p.inactivity_timeout_minutes, p.absolute_timeout_hours, p.warning_minutes
    from public.runbook_session_settings p where p.singleton;
end;
$$;

create or replace function public.save_runbook_session_settings(
  p_inactivity_timeout_minutes integer,
  p_absolute_timeout_hours integer,
  p_warning_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  update public.runbook_session_settings
     set inactivity_timeout_minutes = p_inactivity_timeout_minutes,
         absolute_timeout_hours = p_absolute_timeout_hours,
         warning_minutes = p_warning_minutes,
         updated_at = now(), updated_by = (select auth.uid())
   where singleton;
  insert into public.history_events(actor_id, actor_label, module, entity_type, entity_id, action, summary, recoverable)
  select (select auth.uid()), coalesce(a.display_name, 'RUNBOOK administrator'), 'Settings', 'session_policy', 'workspace',
         'update', 'Updated workspace session timeout settings.', false
    from public.app_accounts a where a.user_id = (select auth.uid());
end;
$$;

-- Keep the existing administrator helpers, but require the current device session.
create or replace function public.is_runbook_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_current_runbook_session() and exists (
    select 1 from public.app_accounts a
     where a.user_id = (select auth.uid()) and a.role in ('admin', 'super_admin')
  );
$$;
create or replace function public.is_runbook_editor()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.is_runbook_admin(); $$;

-- Gate every existing authenticated RLS policy, including Storage policies.
-- Authenticated access is private for this application; anon receives no RUNBOOK data.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname in ('public', 'storage')
       and tablename not in ('runbook_session_signals', 'runbook_active_sessions')
       and ('authenticated' = any(roles) or 'anon' = any(roles) or 'public' = any(roles))
  loop
    execute format(
      'alter policy %I on %I.%I%s%s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      case when policy_row.qual is not null
        then format(' using ((%s) and public.is_current_runbook_session())', policy_row.qual)
        else '' end,
      case when policy_row.with_check is not null
        then format(' with check ((%s) and public.is_current_runbook_session())', policy_row.with_check)
        else '' end
    );
  end loop;
end;
$$;

-- Direct admin checks and session RPCs.
revoke all on function public.is_runbook_admin() from public, anon;
grant execute on function public.is_runbook_admin() to authenticated;
revoke all on function public.is_runbook_editor() from public, anon;
grant execute on function public.is_runbook_editor() to authenticated;
revoke all on function public.claim_runbook_session(uuid) from public, anon;
grant execute on function public.claim_runbook_session(uuid) to authenticated;
revoke all on function public.touch_runbook_session() from public, anon;
grant execute on function public.touch_runbook_session() to authenticated;
revoke all on function public.release_runbook_session() from public, anon;
grant execute on function public.release_runbook_session() to authenticated;
revoke all on function public.get_runbook_session_status() from public, anon;
grant execute on function public.get_runbook_session_status() to authenticated;
revoke all on function public.get_runbook_session_settings() from public, anon;
grant execute on function public.get_runbook_session_settings() to authenticated;
revoke all on function public.save_runbook_session_settings(integer, integer, integer) from public, anon;
grant execute on function public.save_runbook_session_settings(integer, integer, integer) to authenticated;

-- Read-only privacy-filtered RPCs also need an active session because their
-- SECURITY DEFINER implementations intentionally bypass table RLS.
create or replace function public.get_public_employee_directory()
returns table(id text, name text, role text, manager_id text, mentor_id text, photo_url text, photo_path text, profile jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.role, e.manager_id, e.mentor_id,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_url else '' end,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_path else null end,
         jsonb_strip_nulls(jsonb_build_object(
           'birthday', case when public.is_runbook_editor() or p.birthday_public then p.birthday::text end,
           'hire_date', case when public.is_runbook_editor() or p.hire_date_public then p.hire_date::text end,
           'personality', case when public.is_runbook_editor() or p.personality_public then p.personality end,
           'summary', case when public.is_runbook_editor() or p.summary_public then p.summary end,
           'custom_fields', case when public.is_runbook_editor() then p.custom_fields else (
             select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
               from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) as field(k, v)
              where jsonb_typeof(p.custom_field_visibility -> k) = 'boolean'
                and (p.custom_field_visibility ->> k) = 'true'
           ) end,
           'custom_field_visibility', case when public.is_runbook_editor() then p.custom_field_visibility end
         ))
    from public.employees e
    left join public.employee_profiles p on p.employee_id = e.id
   where public.is_current_runbook_session() and e.deleted_at is null
   order by e.sort_order, e.name;
$$;

revoke all on function public.get_public_employee_directory() from public, anon;
grant execute on function public.get_public_employee_directory() to authenticated;

create or replace function public.get_public_vl_credit_entries()
returns table(id text, month_start date, employee_id text, employee_name_snapshot text, employee_role_snapshot text, employee_photo_snapshot text, credit_value text, sort_order integer, valid_from date, valid_to date, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select v.id, v.month_start, v.employee_id, v.employee_name_snapshot, v.employee_role_snapshot,
         case when public.is_runbook_editor() or (e.deleted_at is null and coalesce(p.photo_public, true))
           then coalesce(nullif(e.photo_path, ''), nullif(e.photo_url, ''), v.employee_photo_snapshot, '') else '' end,
         v.credit_value, v.sort_order, v.valid_from, v.valid_to, v.updated_at
    from public.vl_credit_entries v
    left join public.employees e on e.id = v.employee_id
    left join public.employee_profiles p on p.employee_id = v.employee_id
   where public.is_current_runbook_session()
   order by v.valid_from, v.sort_order, v.employee_name_snapshot;
$$;
revoke all on function public.get_public_vl_credit_entries() from public, anon;
grant execute on function public.get_public_vl_credit_entries() to authenticated;

create or replace function public.can_read_runbook_profile_photo(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_current_runbook_session() and exists (
    select 1 from public.employees e
      left join public.employee_profiles p on p.employee_id = e.id
     where e.photo_path = p_path and e.deleted_at is null and coalesce(p.photo_public, true)
  );
$$;
revoke all on function public.can_read_runbook_profile_photo(text) from public, anon;
grant execute on function public.can_read_runbook_profile_photo(text) to authenticated;

create or replace function public.can_manage_runbook_profile_photo(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_current_runbook_session() and exists (
    select 1 from public.app_accounts a
     where a.user_id = (select auth.uid()) and (
       p_path like 'accounts/' || a.user_id::text || '/%'
       or (a.employee_id is not null and p_path like 'employees/' || a.employee_id || '/%')
     )
  );
$$;
revoke all on function public.can_manage_runbook_profile_photo(text) from public, anon;
grant execute on function public.can_manage_runbook_profile_photo(text) to authenticated;

create or replace function public.is_public_current_kpi_result(p_month text, p_employee_id text, p_revision integer, p_is_deleted boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_current_runbook_session() and coalesce(
    not p_is_deleted and p_revision = (
      select max(r.result_revision) from public.kpi_results r
       where r.month_key = p_month and r.employee_id = p_employee_id
    ), false
  );
$$;
revoke all on function public.is_public_current_kpi_result(text, text, integer, boolean) from public, anon;
grant execute on function public.is_public_current_kpi_result(text, text, integer, boolean) to authenticated;

create or replace function public.ensure_birthday_notifications()
returns integer language plpgsql security definer set search_path = ''
as $$
declare inserted_count integer;
begin
  if not public.is_current_runbook_session() then raise exception 'An active session is required.' using errcode = '42501'; end if;
  insert into public.user_notifications(recipient_id, event_key, category, title, body, href)
  select auth.uid(), 'birthday:' || extract(year from timezone('Asia/Manila', now()))::integer || ':' || e.id,
         'birthday', 'Happy birthday!', e.name || ' has a birthday today.', '/agent-profiles'
    from public.employees e
    join public.employee_profiles p on p.employee_id = e.id and p.birthday_public
   where e.deleted_at is null and p.birthday is not null
     and extract(month from p.birthday) = extract(month from timezone('Asia/Manila', now()))
     and extract(day from p.birthday) = extract(day from timezone('Asia/Manila', now()))
  on conflict (recipient_id, event_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function public.ensure_birthday_notifications() from public, anon;
grant execute on function public.ensure_birthday_notifications() to authenticated;

create or replace function public.update_my_account_profile(p_display_name text, p_summary text, p_photo_path text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare linked_employee text;
begin
  if not public.is_current_runbook_session() then raise exception 'An active session is required.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_display_name, ''))) not between 1 and 80 then
    raise exception 'Display name must be between 1 and 80 characters.' using errcode = '22023';
  end if;
  if length(coalesce(p_summary, '')) > 500 then raise exception 'Profile summary is too long.' using errcode = '22023'; end if;
  select employee_id into linked_employee from public.app_accounts where user_id = auth.uid();
  if not found then raise exception 'Account mapping was not found.' using errcode = 'P0002'; end if;
  if p_photo_path is not null and p_photo_path <> '' then
    if linked_employee is not null and p_photo_path not like 'employees/' || linked_employee || '/%'
      or linked_employee is null and p_photo_path not like 'accounts/' || auth.uid()::text || '/%' then
      raise exception 'Photo path is not owned by this account.' using errcode = '42501';
    end if;
  end if;
  update public.app_accounts set display_name = trim(p_display_name), updated_at = now() where user_id = auth.uid();
  insert into public.account_profiles(user_id, summary, photo_path, updated_at)
  values (auth.uid(), coalesce(p_summary, ''), nullif(p_photo_path, ''), now())
  on conflict (user_id) do update set summary = excluded.summary, photo_path = excluded.photo_path, updated_at = now();
  if linked_employee is not null then
    update public.employees set photo_path = nullif(p_photo_path, ''), photo_url = '', updated_at = now() where id = linked_employee;
    insert into public.employee_profiles(employee_id, summary, updated_by)
    values (linked_employee, coalesce(p_summary, ''), auth.uid())
    on conflict (employee_id) do update set summary = excluded.summary, updated_by = auth.uid(), updated_at = now();
  end if;
end;
$$;
revoke all on function public.update_my_account_profile(text, text, text) from public, anon;
grant execute on function public.update_my_account_profile(text, text, text) to authenticated;

-- Publish the per-account change signal. It contains no session token or ID.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'runbook_session_signals') then
    alter publication supabase_realtime add table public.runbook_session_signals;
  end if;
end;
$$;
