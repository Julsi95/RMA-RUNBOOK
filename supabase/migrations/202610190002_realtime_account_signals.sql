-- Account rows are admin-visible and can disappear as an auth user is deleted.
-- A small signal row keeps admin account lists in sync without publishing any
-- account fields to ordinary signed-in users.

alter table public.realtime_sync_signals
  drop constraint if exists realtime_sync_signals_source_table_check;

alter table public.realtime_sync_signals
  add constraint realtime_sync_signals_source_table_check
  check (source_table in ('employees', 'employee_profiles', 'vl_credit_entries', 'app_accounts'));

insert into public.realtime_sync_signals (source_table)
values ('app_accounts')
on conflict (source_table) do nothing;

create trigger signal_app_account_changes
  after insert or update or delete on public.app_accounts
  for each row execute function public.signal_private_table_change();
