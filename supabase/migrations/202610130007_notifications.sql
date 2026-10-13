create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  category text not null check (category in ('birthday','vl-credit','dashboard','project','inbound-call','work-schedule','work-link','monthly-kpi')),
  title text not null,
  body text not null default '',
  href text not null default '/',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, event_key)
);
create index user_notifications_recipient_created_idx on public.user_notifications(recipient_id, created_at desc);
create index user_notifications_unread_idx on public.user_notifications(recipient_id) where read_at is null;
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
create policy "Users read their notifications"
  on public.user_notifications for select to authenticated
  using (recipient_id = auth.uid());
create policy "Users mark their notifications read"
  on public.user_notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function public.create_runbook_notification(
  p_recipient uuid, p_event_key text, p_category text, p_title text, p_body text, p_href text
)
returns void language sql security definer set search_path = ''
as $$
  insert into public.user_notifications(recipient_id,event_key,category,title,body,href)
  values(p_recipient,p_event_key,p_category,p_title,p_body,p_href)
  on conflict(recipient_id,event_key) do update
    set category=excluded.category,title=excluded.title,body=excluded.body,href=excluded.href,
        created_at=now(),read_at=null;
$$;
revoke all on function public.create_runbook_notification(uuid,text,text,text,text,text) from public,anon,authenticated;

create or replace function public.dispatch_runbook_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  row_data jsonb;
  employee_id_value text;
  record_id text;
  event_key text;
  month_label text;
  title_value text;
  body_value text;
  href_value text;
  category_value text;
  project_name text;
  recipient_id_value uuid;
  recipients text[] := array[]::text[];
  recipient_employee text;
begin
  row_data := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op='UPDATE'
     and (to_jsonb(old)-'updated_at'-'updated_by') is not distinct from (to_jsonb(new)-'updated_at'-'updated_by') then
    return null;
  end if;

  category_value := case tg_table_name
    when 'vl_credit_entries' then 'vl-credit'
    when 'project_assignments' then 'project'
    when 'project_trainers' then 'project'
    when 'call_assignments' then 'inbound-call'
    when 'work_schedule_month_assignments' then 'work-schedule'
    when 'work_schedule_period_assignments' then 'work-schedule'
    when 'app_links' then 'work-link'
    when 'kpi_results' then 'monthly-kpi'
    else null end;

  if tg_table_name='dashboard_publication' then
    if tg_op='UPDATE' and old.revision_id is not distinct from new.revision_id then return null; end if;
    if coalesce(row_data->>'revision_id','')='' then return null; end if;
    event_key := 'dashboard:'||coalesce(row_data->>'revision_id','');
    for recipient_id_value in select a.user_id from public.app_accounts a loop
      perform public.create_runbook_notification(recipient_id_value,event_key,'dashboard','Dashboard updated','New dashboard content is available.','/');
    end loop;
    return null;
  end if;

  if tg_table_name='app_links' then
    if tg_op<>'INSERT' then return null; end if;
    record_id := row_data->>'id';
    event_key := 'work-link:'||record_id;
    for recipient_id_value in select a.user_id from public.app_accounts a loop
      perform public.create_runbook_notification(recipient_id_value,event_key,'work-link','New work link',coalesce(row_data->>'name','A new work link was added.'),'/app-links');
    end loop;
    return null;
  end if;

  if category_value is null then return null; end if;
  employee_id_value := row_data->>'employee_id';
  if employee_id_value is null then return null; end if;

  if tg_table_name='project_trainers' then
    record_id := coalesce(row_data->>'project_id','')||':'||employee_id_value||':trainer';
    select p.name into project_name from public.projects p where p.id::text=row_data->>'project_id';
    title_value := case when tg_op='DELETE' then 'Project trainer assignment changed' else 'Project trainer assigned' end;
    body_value := coalesce(project_name,'A project')||case when tg_op='DELETE' then ' no longer lists you as a trainer.' else ' lists you as a trainer.' end;
    href_value := '/projects';
  elsif tg_table_name='project_assignments' then
    record_id := coalesce(row_data->>'project_id','')||':'||employee_id_value;
    select p.name into project_name from public.projects p where p.id::text=row_data->>'project_id';
    title_value := case when tg_op='DELETE' or row_data->>'status'='removed' then 'Project assignment changed' else 'Project assigned' end;
    body_value := coalesce(project_name,'A project')||case when tg_op='DELETE' then ' was removed from your assignments.' else ' was assigned to you.' end;
    href_value := '/projects';
  elsif tg_table_name='call_assignments' then
    record_id := row_data->>'id';
    month_label := row_data->>'month_start';
    title_value := 'Inbound call time updated';
    body_value := 'Your inbound call coverage for '||coalesce(month_label,'the selected month')||' changed.';
    href_value := '/inbound-call-time';
  elsif tg_table_name='work_schedule_month_assignments' then
    record_id := coalesce(row_data->>'month_start','')||':'||coalesce(row_data->>'id','');
    title_value := 'Work schedule updated';
    body_value := 'Your work schedule for '||coalesce(row_data->>'month_start','the selected month')||' changed.';
    href_value := '/work-schedule';
  elsif tg_table_name='work_schedule_period_assignments' then
    record_id := coalesce(row_data->>'period_id','')||':'||coalesce(row_data->>'id','');
    select p.start_date::text||' – '||p.end_date::text into month_label from public.work_schedule_periods p where p.id=row_data->>'period_id';
    title_value := 'Work schedule updated';
    body_value := 'Your work schedule for '||coalesce(month_label,'the selected dates')||' changed.';
    href_value := '/work-schedule';
  elsif tg_table_name='vl_credit_entries' then
    record_id := row_data->>'id';
    title_value := 'VL credits updated';
    body_value := 'Your VL credit record changed for '||coalesce(row_data->>'valid_from','the selected dates')||'.';
    href_value := '/vl-credits';
  elsif tg_table_name='kpi_results' then
    if coalesce((row_data->>'is_deleted')::boolean,false) then return null; end if;
    if not exists(select 1 from public.kpi_months m where m.month_key=row_data->>'month_key' and m.status='published') then return null; end if;
    record_id := coalesce(row_data->>'month_key','')||':'||employee_id_value;
    title_value := 'Monthly KPI results available';
    body_value := 'Your KPI results for '||coalesce(row_data->>'month_key','the selected month')||' are available.';
    href_value := '/kpi-qa';
  end if;

  event_key := category_value||':'||record_id||':'||timezone('Asia/Manila', now())::date::text;
  if tg_op='DELETE' then
    title_value := case category_value when 'project' then 'Project assignment changed' when 'work-schedule' then 'Work schedule updated' when 'inbound-call' then 'Inbound call time updated' else title_value end;
  end if;
  perform public.create_runbook_notification(a.user_id,event_key,category_value,title_value,body_value,href_value)
    from public.app_accounts a where a.employee_id=employee_id_value;
  return null;
end;
$$;
revoke all on function public.dispatch_runbook_notification() from public,anon,authenticated;

create trigger notify_vl_credit_change after insert or update or delete on public.vl_credit_entries
  for each row execute function public.dispatch_runbook_notification();
create trigger notify_project_assignment_change after insert or update or delete on public.project_assignments
  for each row execute function public.dispatch_runbook_notification();
create trigger notify_project_trainer_change after insert or update or delete on public.project_trainers
  for each row execute function public.dispatch_runbook_notification();
create trigger notify_call_assignment_change after insert or update or delete on public.call_assignments
  for each row execute function public.dispatch_runbook_notification();
create trigger notify_work_month_assignment_change after insert or update or delete on public.work_schedule_month_assignments
  for each row execute function public.dispatch_runbook_notification();
create trigger notify_work_period_assignment_change after insert or update or delete on public.work_schedule_period_assignments
  for each row execute function public.dispatch_runbook_notification();
create trigger notify_work_link_added after insert on public.app_links
  for each row execute function public.dispatch_runbook_notification();
create trigger notify_dashboard_published after insert or update on public.dashboard_publication
  for each row execute function public.dispatch_runbook_notification();
create trigger notify_kpi_result_published after insert on public.kpi_results
  for each row execute function public.dispatch_runbook_notification();

create or replace function public.ensure_birthday_notifications()
returns integer language plpgsql security definer set search_path = ''
as $$
declare inserted_count integer;
begin
  if auth.uid() is null then raise exception 'Sign-in is required.' using errcode='42501'; end if;
  insert into public.user_notifications(recipient_id,event_key,category,title,body,href)
  select auth.uid(),
         'birthday:'||extract(year from timezone('Asia/Manila', now()))::integer||':'||e.id,
         'birthday','Happy birthday!',e.name||' has a birthday today.','/agent-profiles'
    from public.employees e
    join public.employee_profiles p on p.employee_id=e.id and p.birthday_public
   where e.deleted_at is null and p.birthday is not null
     and extract(month from p.birthday)=extract(month from timezone('Asia/Manila', now()))
     and extract(day from p.birthday)=extract(day from timezone('Asia/Manila', now()))
  on conflict(recipient_id,event_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function public.ensure_birthday_notifications() from public,anon;
grant execute on function public.ensure_birthday_notifications() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_notifications') then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end;
$$;
