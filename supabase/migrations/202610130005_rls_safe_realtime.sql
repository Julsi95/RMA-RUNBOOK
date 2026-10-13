-- Realtime row events are subject to table SELECT policies. Employee records
-- and VL credit entries are deliberately exposed through privacy-filtered RPCs,
-- so ordinary signed-in viewers need a safe signal to know when to refetch.
create table public.realtime_sync_signals (
  source_table text primary key check (source_table in ('employees', 'employee_profiles', 'vl_credit_entries')),
  changed_at timestamptz not null default clock_timestamp()
);

insert into public.realtime_sync_signals (source_table)
values ('employees'), ('employee_profiles'), ('vl_credit_entries')
on conflict (source_table) do nothing;

alter table public.realtime_sync_signals enable row level security;
revoke all on public.realtime_sync_signals from anon, authenticated;
grant select on public.realtime_sync_signals to authenticated;

create policy "Authenticated users read realtime sync signals"
  on public.realtime_sync_signals for select to authenticated
  using (auth.uid() is not null);

create or replace function public.signal_private_table_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.realtime_sync_signals
     set changed_at = clock_timestamp()
   where source_table = tg_table_name;

  if not found then
    insert into public.realtime_sync_signals (source_table, changed_at)
    values (tg_table_name, clock_timestamp())
    on conflict (source_table) do update
      set changed_at = excluded.changed_at;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.signal_private_table_change() from public, anon, authenticated;

create trigger signal_employee_changes
  after insert or update or delete on public.employees
  for each row execute function public.signal_private_table_change();

create trigger signal_employee_profile_changes
  after insert or update or delete on public.employee_profiles
  for each row execute function public.signal_private_table_change();

create trigger signal_vl_credit_changes
  after insert or update or delete on public.vl_credit_entries
  for each row execute function public.signal_private_table_change();

-- Account profiles already have an owner-scoped SELECT policy, so they can use
-- normal Postgres Changes events without exposing another user's profile.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'account_profiles'
    ) then
      alter publication supabase_realtime add table public.account_profiles;
    end if;
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'realtime_sync_signals'
    ) then
      alter publication supabase_realtime add table public.realtime_sync_signals;
    end if;
  end if;
end;
$$;
