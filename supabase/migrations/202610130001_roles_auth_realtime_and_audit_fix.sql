-- RUNBOOK account roles, private workspace access, and shared audit trigger fix.
alter table public.app_accounts
  add column if not exists role text not null default 'user';

update public.app_accounts set role = 'admin' where can_edit;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='app_accounts_role_check') then
    alter table public.app_accounts add constraint app_accounts_role_check check (role in ('admin','user'));
  end if;
end $$;

create or replace function public.sync_runbook_account_role()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.role='admin' or coalesce(new.can_edit,false) then
    new.role := 'admin'; new.can_edit := true;
  else
    new.role := 'user'; new.can_edit := false;
  end if;
  return new;
end $$;
drop trigger if exists sync_runbook_account_role on public.app_accounts;
create trigger sync_runbook_account_role before insert or update of role,can_edit on public.app_accounts
for each row execute function public.sync_runbook_account_role();

create or replace function public.is_runbook_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.app_accounts a
  where a.user_id = (select auth.uid()) and a.role = 'admin'
); $$;
revoke all on function public.is_runbook_admin() from public, anon;
grant execute on function public.is_runbook_admin() to authenticated;

create or replace function public.is_runbook_editor()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.is_runbook_admin(); $$;
revoke all on function public.is_runbook_editor() from public, anon;
grant execute on function public.is_runbook_editor() to authenticated;

-- No history data is visible to regular user accounts.
drop policy if exists "Recent public history" on public.history_events;
drop policy if exists "Editor reads history" on public.history_events;
create policy "Administrators read history" on public.history_events
  for select to authenticated using (public.is_runbook_admin());
drop policy if exists "Editor reads recovery snapshots" on public.history_recovery;
create policy "Administrators read recovery snapshots" on public.history_recovery
  for select to authenticated using (public.is_runbook_admin());

drop policy if exists "Own account mapping" on public.app_accounts;
create policy "Users read own account" on public.app_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Administrators read all accounts" on public.app_accounts
  for select to authenticated using (public.is_runbook_admin());
revoke insert, update, delete on public.app_accounts from anon, authenticated;

create table if not exists public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary text not null default '',
  photo_path text,
  updated_at timestamptz not null default now()
);
alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from anon, authenticated;
grant select on public.account_profiles to authenticated;
create policy "Users read own account profile" on public.account_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Administrators read all account profiles" on public.account_profiles
  for select to authenticated using (public.is_runbook_admin());
drop trigger if exists runbook_audit on public.account_profiles;
create trigger runbook_audit after insert or update or delete on public.account_profiles
  for each row execute function public.record_runbook_change();

create or replace function public.can_manage_runbook_profile_photo(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_accounts a
    where a.user_id=(select auth.uid()) and (
      p_path like 'accounts/' || a.user_id::text || '/%'
      or (a.employee_id is not null and p_path like 'employees/' || a.employee_id || '/%')
    )
  );
$$;
revoke all on function public.can_manage_runbook_profile_photo(text) from public, anon;
grant execute on function public.can_manage_runbook_profile_photo(text) to authenticated;
drop policy if exists "Users manage own account photos" on storage.objects;
create policy "Users manage own account photos" on storage.objects for all to authenticated
  using (bucket_id='runbook-private' and public.can_manage_runbook_profile_photo(name))
  with check (bucket_id='runbook-private' and public.can_manage_runbook_profile_photo(name));

create or replace function public.update_my_account_profile(
  p_display_name text,
  p_summary text,
  p_photo_path text default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare linked_employee text;
begin
  if auth.uid() is null then raise exception 'Sign in is required.' using errcode='42501'; end if;
  if length(trim(coalesce(p_display_name,''))) not between 1 and 80 then
    raise exception 'Display name must be between 1 and 80 characters.' using errcode='22023';
  end if;
  if length(coalesce(p_summary,'')) > 500 then raise exception 'Profile summary is too long.' using errcode='22023'; end if;

  select employee_id into linked_employee from public.app_accounts where user_id=auth.uid();
  if not found then raise exception 'Account mapping was not found.' using errcode='P0002'; end if;
  if p_photo_path is not null and p_photo_path <> '' then
    if linked_employee is not null and p_photo_path not like 'employees/' || linked_employee || '/%'
      or linked_employee is null and p_photo_path not like 'accounts/' || auth.uid()::text || '/%' then
      raise exception 'Photo path is not owned by this account.' using errcode='42501';
    end if;
  end if;

  update public.app_accounts set display_name=trim(p_display_name),updated_at=now() where user_id=auth.uid();
  insert into public.account_profiles(user_id,summary,photo_path,updated_at)
  values(auth.uid(),coalesce(p_summary,''),nullif(p_photo_path,''),now())
  on conflict(user_id) do update set summary=excluded.summary,photo_path=excluded.photo_path,updated_at=now();
  if linked_employee is null then
    null;
  else
    update public.employees set photo_path=nullif(p_photo_path,''),photo_url='',updated_at=now() where id=linked_employee;
    insert into public.employee_profiles(employee_id,summary,updated_by)
    values(linked_employee,coalesce(p_summary,''),auth.uid())
    on conflict(employee_id) do update set summary=excluded.summary,updated_by=auth.uid(),updated_at=now();
  end if;
end $$;
revoke all on function public.update_my_account_profile(text,text,text) from public, anon;
grant execute on function public.update_my_account_profile(text,text,text) to authenticated;

-- Fix: the shared row audit trigger cannot dereference an employee-only field on other tables.
create or replace function public.record_runbook_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare old_row jsonb; new_row jsonb; data_row jsonb; record_key text; mod text; act text; actor text; ev uuid; purge_after_value timestamptz;
begin
  if (select auth.uid()) is null or current_setting('runbook.skip_row_audit',true)='on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'employees' and tg_op = 'DELETE' then
    purge_after_value := nullif(to_jsonb(old)->>'purge_after','')::timestamptz;
    if purge_after_value is not null and purge_after_value <= now() then return old; end if;
  end if;
  old_row := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  new_row := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  data_row := coalesce(new_row,old_row);
  record_key := coalesce(data_row->>'id',data_row->>'employee_id',data_row->>'plan_date',data_row->>'month_start',data_row->>'month_key',data_row->>'owner_id','record');
  mod := case when tg_table_name like 'employee%' then 'Agent profiles'
    when tg_table_name like 'project%' then 'Project coverage' when tg_table_name like 'seat_%' then 'Seat plan'
    when tg_table_name like 'call_%' then 'Inbound call time' when tg_table_name like 'work_%' then 'Work schedule'
    when tg_table_name like 'vl_%' then 'VL credits' when tg_table_name like 'qa_%' then 'QA parameters'
    when tg_table_name like 'kpi_%' or tg_table_name='current_kpi_scoring' then 'Monthly KPI / QA'
    when tg_table_name like 'dashboard_%' then 'Dashboard' when tg_table_name='app_links' then 'App / Links'
    else 'Workspace' end;
  act := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;
  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=(select auth.uid());
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values((select auth.uid()),coalesce(actor,'RUNBOOK editor'),mod,tg_table_name,record_key,act,initcap(act)||' '||tg_table_name||' in '||mod||'.',tg_op in ('UPDATE','DELETE'))
  returning id into ev;
  if tg_op in ('UPDATE','DELETE') then
    insert into public.history_recovery(event_id,before_state,after_state) values(ev,old_row,new_row);
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

-- Public pages remain viewable without signing in. Grant only the read-only
-- datasets already intended for public display; account, recovery, and draft
-- data remain private. All writes still require the Admin role via RLS/RPCs.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant select on public.projects,public.project_trainers,public.project_assignments,
  public.seat_plans,public.seat_positions,public.seat_assignments,
  public.call_schedule_months,public.call_assignments,
  public.work_schedule_months,public.work_schedule_month_assignments,
  public.work_schedule_periods,public.work_schedule_period_assignments,public.work_schedule_revisions,
  public.app_links,public.qa_criteria,public.agent_profile_field_definitions,
  public.kpi_scoring_versions,public.current_kpi_scoring,public.kpi_months,public.kpi_results,
  public.dashboard_revisions,public.dashboard_publication
  to anon,authenticated;
grant execute on function public.get_public_employee_directory(),public.get_public_vl_credit_entries() to anon,authenticated;
grant execute on function public.can_read_runbook_profile_photo(text) to anon,authenticated;
grant execute on function public.is_runbook_admin(),public.is_runbook_editor(),public.can_read_runbook_profile_photo(text),public.can_manage_runbook_profile_photo(text) to authenticated;
grant execute on function public.update_my_account_profile(text,text,text) to authenticated;
grant execute on function public.publish_dashboard(jsonb),public.save_kpi_scoring_version(text,jsonb),public.soft_delete_employee(text),public.restore_employee(text) to authenticated;
grant execute on function public.save_seat_plan(date,jsonb),public.save_vl_credit_month(date,date,jsonb),public.save_project_coverage(jsonb) to authenticated;
grant execute on function public.save_call_schedule_month(date,jsonb,jsonb),public.save_work_schedule_document(jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.create_kpi_month(text),public.save_kpi_month_results(text,jsonb),public.restore_kpi_month_snapshot(text,jsonb) to authenticated;
grant execute on function public.save_app_links(jsonb),public.save_qa_criteria(jsonb),public.restore_history_event(uuid) to authenticated;
grant execute on function public.is_public_current_kpi_result(text,text,integer,boolean) to authenticated;

-- The editor is an Admin; ordinary User accounts retain read-only RLS access.
-- Existing "Editor full access" policies call is_runbook_editor(), now Admin-only.
-- Ensure all tables remain enabled for realtime change feeds used by the client.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array[
      'app_accounts','employees','employee_profiles','agent_profile_field_definitions',
      'seat_plans','seat_positions','seat_assignments','projects','project_trainers','project_assignments',
      'call_schedule_months','call_assignments','work_schedule_months','work_schedule_month_assignments',
      'work_schedule_periods','work_schedule_period_assignments','work_schedule_revisions',
      'vl_months','vl_credit_entries','app_links','qa_criteria','kpi_months','kpi_results',
      'current_kpi_scoring','kpi_scoring_versions','dashboard_publication','dashboard_revisions'
    ] loop
      if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end $$;
