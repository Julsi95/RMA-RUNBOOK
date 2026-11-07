-- Publish only a single timestamp when published KPI data changes. The signal
-- contains no names, scores, metrics, or other KPI data and is safe for anon.
create table if not exists public.public_dashboard_kpi_signal (
  singleton boolean primary key default true check (singleton),
  changed_at timestamptz not null default now()
);

insert into public.public_dashboard_kpi_signal (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.public_dashboard_kpi_signal enable row level security;
revoke all on table public.public_dashboard_kpi_signal from public, anon, authenticated;
grant select on table public.public_dashboard_kpi_signal to anon, authenticated;

drop policy if exists "Anyone can read public dashboard KPI change signal"
  on public.public_dashboard_kpi_signal;
create policy "Anyone can read public dashboard KPI change signal"
  on public.public_dashboard_kpi_signal
  for select
  to anon, authenticated
  using (true);

create or replace function public.bump_public_dashboard_kpi_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.public_dashboard_kpi_signal
     set changed_at = clock_timestamp()
   where singleton = true;
  return null;
end;
$$;

revoke all on function public.bump_public_dashboard_kpi_signal() from public, anon, authenticated;

drop trigger if exists kpi_results_public_dashboard_signal on public.kpi_results;
create trigger kpi_results_public_dashboard_signal
  after insert or update or delete on public.kpi_results
  for each statement execute function public.bump_public_dashboard_kpi_signal();

drop trigger if exists kpi_months_public_dashboard_signal on public.kpi_months;
create trigger kpi_months_public_dashboard_signal
  after insert or update or delete on public.kpi_months
  for each statement execute function public.bump_public_dashboard_kpi_signal();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
         from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'public_dashboard_kpi_signal'
     ) then
    alter publication supabase_realtime add table public.public_dashboard_kpi_signal;
  end if;
end;
$$;
