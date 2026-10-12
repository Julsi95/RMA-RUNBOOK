-- RUNBOOK backend schema: public reads, editor-only writes, separated private profile data.
create extension if not exists pgcrypto;

create table public.app_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  employee_id text,
  display_name text not null default 'RUNBOOK editor',
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_runbook_editor()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_accounts a where a.user_id = (select auth.uid()) and a.can_edit); $$;
revoke all on function public.is_runbook_editor() from public;
grant execute on function public.is_runbook_editor() to anon, authenticated;

create or replace function public.bootstrap_runbook_account()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.app_accounts(user_id, display_name)
  values(new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name',''), 'RUNBOOK editor'))
  on conflict(user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_runbook on auth.users;
create trigger on_auth_user_created_runbook after insert on auth.users
for each row execute function public.bootstrap_runbook_account();

create table public.employees (
  id text primary key, name text not null, role text not null,
  manager_id text references public.employees(id) on delete set null,
  mentor_id text references public.employees(id) on delete set null,
  photo_url text not null default '', photo_path text,
  sort_order integer not null default 0,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null,
  purge_after timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.app_accounts add constraint app_accounts_employee_id_fkey
foreign key(employee_id) references public.employees(id) on delete set null;

create table public.employee_profiles (
  employee_id text primary key references public.employees(id) on delete cascade,
  birthday date, hire_date date, personality text not null default '', summary text not null default '',
  photo_public boolean not null default true,
  custom_fields jsonb not null default '{}'::jsonb,
  birthday_public boolean not null default false, hire_date_public boolean not null default false,
  personality_public boolean not null default false, summary_public boolean not null default false,
  custom_field_visibility jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);

create or replace function public.get_public_employee_directory()
returns table(id text, name text, role text, manager_id text, mentor_id text, photo_url text, profile jsonb)
language sql stable security definer set search_path = ''
as $$
 select e.id,e.name,e.role,e.manager_id,e.mentor_id,case when coalesce(p.photo_public,true) then e.photo_url else '' end,
   jsonb_strip_nulls(jsonb_build_object(
     'birthday',case when p.birthday_public then p.birthday::text end,
     'hireDate',case when p.hire_date_public then p.hire_date::text end,
     'personality',case when p.personality_public then p.personality end,
     'summary',case when p.summary_public then p.summary end,
     'fields',coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(coalesce(p.custom_fields,'{}'::jsonb)) f
       where jsonb_typeof(p.custom_field_visibility -> f.key)='boolean' and (p.custom_field_visibility ->> f.key)='true'),'{}'::jsonb)))
 from public.employees e left join public.employee_profiles p on p.employee_id=e.id
 where e.deleted_at is null order by e.sort_order,e.name;
$$;
revoke all on function public.get_public_employee_directory() from public;
grant execute on function public.get_public_employee_directory() to anon, authenticated;

create table public.projects (
  id text primary key,name text not null,description text not null default '',is_active boolean not null default true,
  poc_employee_id text references public.employees(id) on delete set null,sort_order integer not null default 0,
  archived_at timestamptz,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.project_trainers (
  project_id text not null references public.projects(id) on delete cascade,
  employee_id text not null references public.employees(id) on delete cascade,created_at timestamptz not null default now(),
  primary key(project_id,employee_id)
);
create table public.project_assignments (
  project_id text not null references public.projects(id) on delete cascade,
  employee_id text not null references public.employees(id) on delete cascade,
  status text not null check(status in ('trained','refresher','to-train')),
  updated_at timestamptz not null default now(),primary key(project_id,employee_id)
);

create table public.seat_plans(plan_date date primary key,note text not null default '',updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null);
create table public.seat_positions(
  plan_date date not null references public.seat_plans(plan_date) on delete cascade,seat_id text not null,
  seat_type text not null check(seat_type in ('team','leadership')),sort_order integer not null default 0,primary key(plan_date,seat_id)
);
create table public.seat_assignments(
  plan_date date not null,seat_id text not null,employee_id text not null references public.employees(id) on delete cascade,
  updated_at timestamptz not null default now(),primary key(plan_date,seat_id),unique(plan_date,employee_id),
  foreign key(plan_date,seat_id) references public.seat_positions(plan_date,seat_id) on delete cascade
);

create table public.call_schedule_months(
  month_start date primary key check(extract(day from month_start)=1),call_window_start time not null default '21:00',
  call_window_end time not null default '06:00',updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
);
create table public.call_assignments(
  id text primary key,month_start date not null references public.call_schedule_months(month_start) on delete cascade,
  employee_id text not null references public.employees(id) on delete cascade,call_start time not null,call_end time not null,
  sort_order integer not null default 0,unique(month_start,employee_id)
);
create table public.work_schedule_months(
  month_start date primary key check(extract(day from month_start)=1),work_preset text not null default '9-6',
  updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
);
create table public.work_schedule_month_assignments(
  month_start date not null references public.work_schedule_months(month_start) on delete cascade,id text not null,
  employee_id text not null references public.employees(id) on delete cascade,start_time time not null,end_time time not null,
  sort_order integer not null default 0,primary key(month_start,id),unique(month_start,employee_id)
);
create table public.work_schedule_periods(
  id text primary key,start_date date not null,end_date date not null,work_preset text not null default 'custom',
  label text not null default '',updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null,
  check(end_date>=start_date)
);
create table public.work_schedule_period_assignments(
  period_id text not null references public.work_schedule_periods(id) on delete cascade,id text not null,
  employee_id text not null references public.employees(id) on delete cascade,start_time time not null,end_time time not null,
  sort_order integer not null default 0,primary key(period_id,id),unique(period_id,employee_id)
);
create table public.work_schedule_revisions(
  id text primary key,start_date date not null,end_date date not null,label text not null default '',
  schedule_snapshot jsonb not null,created_at timestamptz not null default now(),created_by uuid references auth.users(id) on delete set null,
  check(end_date>=start_date)
);

create table public.vl_months(month_start date primary key check(extract(day from month_start)=1),updated_on date,updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null);
create table public.vl_credit_entries(
  id text primary key,month_start date not null references public.vl_months(month_start) on delete cascade,
  employee_id text references public.employees(id) on delete cascade,employee_name_snapshot text not null,
  employee_role_snapshot text not null default '',employee_photo_snapshot text not null default '',credit_value text not null default '',
  sort_order integer not null default 0,unique(month_start,employee_id)
);
create table public.app_links(
  id text primary key,name text not null,url text not null default '',application text not null default '',
  group_name text not null default 'General',description text not null default '',sort_order integer not null default 0,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.qa_criteria(
  id text primary key,category text not null,criterion text not null,tcr integer not null default 0 check(tcr>=0),
  tcp integer not null default 0 check(tcp>=0 and tcp<=tcr),sort_order integer not null default 0,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.agent_profile_field_definitions(
  id text primary key,label text not null,field_type text not null check(field_type in ('text','longText','date','number','url')),
  sort_order integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table public.kpi_scoring_versions(
  id uuid primary key default gen_random_uuid(),version_number bigint generated always as identity unique,
  label text not null default '',settings jsonb not null,created_at timestamptz not null default now(),created_by uuid references auth.users(id) on delete set null
);
create table public.current_kpi_scoring(
  singleton boolean primary key default true check(singleton),version_id uuid not null references public.kpi_scoring_versions(id) on delete restrict,
  updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
);
create table public.kpi_months(
  month_key text primary key check(month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  scoring_version_id uuid references public.kpi_scoring_versions(id) on delete restrict,
  status text not null default 'published' check(status in ('draft','published')),updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table public.kpi_results(
  month_key text not null references public.kpi_months(month_key) on delete cascade,
  employee_id text not null,
  employee_name_snapshot text not null,employee_role_snapshot text not null default '',metrics jsonb not null default '{}'::jsonb,
  overall_score numeric(8,4),evaluation text not null default '',result_revision integer not null default 1 check(result_revision>0),
  source text not null default 'manual' check(source in ('manual','import','seed')),
  updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null,
  primary key(month_key,employee_id,result_revision)
);

create table public.dashboard_revisions(
  id uuid primary key default gen_random_uuid(),revision_number bigint generated always as identity unique,
  content jsonb not null,created_at timestamptz not null default now(),created_by uuid references auth.users(id) on delete set null
);
create table public.dashboard_publication(
  singleton boolean primary key default true check(singleton),revision_id uuid references public.dashboard_revisions(id) on delete restrict,
  updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
);
create table public.dashboard_drafts(
  owner_id uuid primary key references auth.users(id) on delete cascade,content jsonb not null,updated_at timestamptz not null default now()
);

create table public.history_events(
  id uuid primary key default gen_random_uuid(),actor_id uuid references auth.users(id) on delete set null,
  actor_label text not null default 'RUNBOOK editor',module text not null,entity_type text not null,entity_id text not null default '',
  action text not null check(action in ('create','update','delete','restore','publish','login')),summary text not null,
  recoverable boolean not null default false,created_at timestamptz not null default now(),expires_at timestamptz not null default (now()+interval '30 days')
);
create table public.history_recovery(
  event_id uuid primary key references public.history_events(id) on delete cascade,before_state jsonb,after_state jsonb,
  expires_at timestamptz not null default (now()+interval '30 days')
);

create or replace function public.record_runbook_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare old_row jsonb; new_row jsonb; data_row jsonb; record_key text; mod text; act text; actor text; ev uuid;
begin
  if (select auth.uid()) is null or current_setting('runbook.skip_row_audit',true)='on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'employees' and tg_op = 'DELETE' and old.purge_after <= now() then return old; end if;
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

create or replace function public.publish_dashboard(p_content jsonb)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare rev uuid;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if jsonb_typeof(p_content)<>'object' or jsonb_typeof(p_content->'containers')<>'array' then raise exception 'Dashboard requires a containers array.' using errcode='22023'; end if;
 insert into public.dashboard_revisions(content,created_by) values(p_content,auth.uid()) returning id into rev;
 insert into public.dashboard_publication(singleton,revision_id,updated_by) values(true,rev,auth.uid())
 on conflict(singleton) do update set revision_id=excluded.revision_id,updated_at=now(),updated_by=excluded.updated_by;
 delete from public.dashboard_drafts where owner_id=auth.uid();
 return rev;
end $$;

create or replace function public.save_kpi_scoring_version(p_label text,p_settings jsonb)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare ver uuid;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if jsonb_typeof(p_settings)<>'object' or jsonb_typeof(p_settings->'metrics')<>'object' then raise exception 'Invalid KPI scoring settings.' using errcode='22023'; end if;
 insert into public.kpi_scoring_versions(label,settings,created_by) values(coalesce(nullif(p_label,''),'Scoring settings'),p_settings,auth.uid()) returning id into ver;
 insert into public.current_kpi_scoring(singleton,version_id,updated_by) values(true,ver,auth.uid())
 on conflict(singleton) do update set version_id=excluded.version_id,updated_at=now(),updated_by=excluded.updated_by;
 return ver;
end $$;

create or replace function public.soft_delete_employee(p_id text)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 update public.employees set deleted_at=now(),deleted_by=auth.uid(),purge_after=now()+interval '30 days',updated_at=now() where id=p_id and deleted_at is null;
 if not found then raise exception 'Active employee not found.' using errcode='P0002'; end if;
end $$;
create or replace function public.restore_employee(p_id text)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 update public.employees set deleted_at=null,deleted_by=null,purge_after=null,updated_at=now()
 where id=p_id and deleted_at is not null and purge_after>now();
 if not found then raise exception 'Employee unavailable or recovery period expired.' using errcode='P0002'; end if;
end $$;

-- RLS and explicit grants for all application tables.
do $$
declare t text;
begin
 foreach t in array array['app_accounts','employees','employee_profiles','projects','project_trainers','project_assignments',
 'seat_plans','seat_positions','seat_assignments','call_schedule_months','call_assignments','work_schedule_months',
 'work_schedule_month_assignments','work_schedule_periods','work_schedule_period_assignments','work_schedule_revisions',
 'vl_months','vl_credit_entries','app_links','qa_criteria','agent_profile_field_definitions','kpi_scoring_versions',
 'current_kpi_scoring','kpi_months','kpi_results','dashboard_revisions','dashboard_publication','dashboard_drafts',
 'history_events','history_recovery'] loop
   execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
revoke all on all tables in schema public from anon,authenticated;
grant select on public.projects,public.project_trainers,public.project_assignments,public.seat_plans,public.seat_positions,
 public.seat_assignments,public.call_schedule_months,public.call_assignments,public.work_schedule_months,
 public.work_schedule_month_assignments,public.work_schedule_periods,public.work_schedule_period_assignments,
 public.work_schedule_revisions,public.vl_months,public.app_links,public.qa_criteria,
 public.agent_profile_field_definitions,public.kpi_scoring_versions,public.current_kpi_scoring,public.kpi_months,
 public.kpi_results,public.dashboard_revisions,public.dashboard_publication,public.history_events to anon;
grant select on public.app_accounts,public.history_events,public.history_recovery to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant execute on function public.publish_dashboard(jsonb),public.save_kpi_scoring_version(text,jsonb),public.soft_delete_employee(text),public.restore_employee(text) to authenticated;
revoke update,delete on public.kpi_scoring_versions,public.dashboard_revisions from authenticated;
revoke insert,update,delete on public.history_events,public.history_recovery from anon,authenticated;

create policy "Public employee listing" on public.employees for select to anon using(deleted_at is null);
create policy "Public project listing" on public.projects for select to anon,authenticated using(deleted_at is null);
create policy "Public project trainers" on public.project_trainers for select to anon,authenticated using(exists(select 1 from public.projects p where p.id=project_id and p.deleted_at is null));
create policy "Public project assignments" on public.project_assignments for select to anon,authenticated using(exists(select 1 from public.projects p where p.id=project_id and p.deleted_at is null));
create policy "Public seat data" on public.seat_plans for select to anon,authenticated using(true);
create policy "Public seat positions" on public.seat_positions for select to anon,authenticated using(true);
create policy "Public seat assignments" on public.seat_assignments for select to anon,authenticated using(true);
create policy "Public call schedules" on public.call_schedule_months for select to anon,authenticated using(true);
create policy "Public call assignments" on public.call_assignments for select to anon,authenticated using(true);
create policy "Public monthly work schedules" on public.work_schedule_months for select to anon,authenticated using(true);
create policy "Public monthly work assignments" on public.work_schedule_month_assignments for select to anon,authenticated using(true);
create policy "Public work periods" on public.work_schedule_periods for select to anon,authenticated using(true);
create policy "Public work period assignments" on public.work_schedule_period_assignments for select to anon,authenticated using(true);
create policy "Public work revisions" on public.work_schedule_revisions for select to anon,authenticated using(true);
create policy "Public VL data" on public.vl_months for select to anon,authenticated using(true);
create policy "Public app links" on public.app_links for select to anon,authenticated using(true);
create policy "Public QA criteria" on public.qa_criteria for select to anon,authenticated using(true);
create policy "Public profile fields" on public.agent_profile_field_definitions for select to anon,authenticated using(true);
create policy "Public KPI scoring versions" on public.kpi_scoring_versions for select to anon,authenticated using(true);
create policy "Public current KPI scoring" on public.current_kpi_scoring for select to anon,authenticated using(true);
create policy "Public KPI months" on public.kpi_months for select to anon,authenticated using(true);
create policy "Public KPI results" on public.kpi_results for select to anon,authenticated using(true);
create policy "Public published dashboard revision" on public.dashboard_revisions for select to anon,authenticated
  using(id=(select dp.revision_id from public.dashboard_publication dp where dp.singleton));
create policy "Public dashboard publication" on public.dashboard_publication for select to anon,authenticated using(true);
create policy "Recent public history" on public.history_events for select to anon,authenticated using(created_at>=now()-interval '30 days');
create policy "Own account mapping" on public.app_accounts for select to authenticated using(user_id=auth.uid());

do $$
declare t text;
begin
 foreach t in array array['employees','employee_profiles','projects','project_trainers','project_assignments','seat_plans','seat_positions',
 'seat_assignments','call_schedule_months','call_assignments','work_schedule_months','work_schedule_month_assignments',
 'work_schedule_periods','work_schedule_period_assignments','work_schedule_revisions','vl_months','vl_credit_entries',
 'app_links','qa_criteria','agent_profile_field_definitions','current_kpi_scoring','kpi_months','kpi_results',
 'dashboard_publication'] loop
   execute format('create policy "Editor full access %1$s" on public.%1$I for all to authenticated using(public.is_runbook_editor()) with check(public.is_runbook_editor())',t);
 end loop;
end $$;
create policy "Editor inserts KPI settings versions" on public.kpi_scoring_versions for insert to authenticated with check(public.is_runbook_editor());
create policy "Editor inserts dashboard revisions" on public.dashboard_revisions for insert to authenticated with check(public.is_runbook_editor());
create policy "Editor reads dashboard revisions" on public.dashboard_revisions for select to authenticated using(public.is_runbook_editor());
create policy "Editor manages own draft" on public.dashboard_drafts for all to authenticated using(public.is_runbook_editor() and owner_id=auth.uid()) with check(public.is_runbook_editor() and owner_id=auth.uid());
create policy "Editor reads dashboard drafts" on public.dashboard_drafts for select to authenticated using(public.is_runbook_editor() and owner_id=auth.uid());
create policy "Editor reads history" on public.history_events for select to authenticated using(public.is_runbook_editor());
create policy "Editor reads recovery snapshots" on public.history_recovery for select to authenticated using(public.is_runbook_editor());

do $$
declare t text;
begin
 foreach t in array array['employees','employee_profiles','projects','project_trainers','project_assignments','seat_plans','seat_positions',
 'seat_assignments','call_schedule_months','call_assignments','work_schedule_months','work_schedule_month_assignments',
 'work_schedule_periods','work_schedule_period_assignments','work_schedule_revisions','vl_months','vl_credit_entries',
 'app_links','qa_criteria','agent_profile_field_definitions','kpi_scoring_versions','current_kpi_scoring','kpi_months',
 'kpi_results','dashboard_revisions','dashboard_publication'] loop
   execute format('create trigger runbook_audit after insert or update or delete on public.%I for each row execute function public.record_runbook_change()',t);
 end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('runbook-public','runbook-public',true,10485760,array['image/jpeg','image/png','image/webp','image/gif']),
 ('runbook-private','runbook-private',false,20971520,array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Public bucket objects remain fetchable by their URL; do not grant table SELECT,
-- which would also expose object listings (including unpublished draft uploads).
create policy "Editor uploads assets" on storage.objects for insert to authenticated with check(public.is_runbook_editor() and bucket_id in('runbook-public','runbook-private'));
create policy "Editor updates assets" on storage.objects for update to authenticated using(public.is_runbook_editor() and bucket_id in('runbook-public','runbook-private')) with check(public.is_runbook_editor() and bucket_id in('runbook-public','runbook-private'));
create policy "Editor deletes assets" on storage.objects for delete to authenticated using(public.is_runbook_editor() and bucket_id in('runbook-public','runbook-private'));
create policy "Editor private asset read" on storage.objects for select to authenticated using(public.is_runbook_editor() and bucket_id='runbook-private');

create or replace function public.purge_expired_history()
returns integer language plpgsql security invoker set search_path = ''
as $$
declare removed integer;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 delete from public.history_events where expires_at<=now();
 get diagnostics removed=row_count;
 delete from public.employees where deleted_at is not null and purge_after<=now();
 return removed;
end $$;
grant execute on function public.purge_expired_history() to authenticated;
