-- The prior work-schedule migration changed this checked writer to SECURITY
-- INVOKER. Its direct table writes are intentionally revoked, so the RPC then
-- failed with permission denied despite its administrator check.
alter function public.save_work_schedule_document(jsonb, jsonb, jsonb) security definer;
alter function public.save_work_schedule_document(jsonb, jsonb, jsonb) set search_path = '';
revoke all on function public.save_work_schedule_document(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_work_schedule_document(jsonb, jsonb, jsonb) to authenticated;

create table public.workspace_branding (
  singleton boolean primary key default true check (singleton),
  sidebar_title text not null default 'RUNBOOK' check (char_length(sidebar_title) between 1 and 48),
  logo_path text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.workspace_branding enable row level security;
revoke all on public.workspace_branding from anon, authenticated;
grant select, insert, update on public.workspace_branding to authenticated;
create policy "Authenticated users read workspace branding"
  on public.workspace_branding for select to authenticated using (auth.uid() is not null);
create policy "Admins manage workspace branding"
  on public.workspace_branding for all to authenticated
  using (public.is_runbook_admin()) with check (public.is_runbook_admin());
insert into public.workspace_branding(singleton, sidebar_title, logo_path)
values (true, 'RUNBOOK', '') on conflict (singleton) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_branding') then
    alter publication supabase_realtime add table public.workspace_branding;
  end if;
end;
$$;
