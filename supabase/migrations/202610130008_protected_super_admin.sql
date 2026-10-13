-- Add a protected Super Admin role for the bootstrap account.
-- Account rows cannot be edited directly by authenticated clients; the
-- manage-account Edge Function also rejects changes to this protected role.

alter table public.app_accounts
  drop constraint if exists app_accounts_role_check;

alter table public.app_accounts
  add constraint app_accounts_role_check
  check (role in ('user', 'admin', 'super_admin'));

create or replace function public.sync_runbook_account_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.role = 'super_admin' then
    if new.role is distinct from old.role
      or new.can_edit is distinct from old.can_edit then
      raise exception 'The protected Super Admin access cannot be changed.'
        using errcode = '42501';
    end if;
    new.role := 'super_admin';
    new.can_edit := true;
    return new;
  end if;

  if new.role = 'super_admin' then
    new.can_edit := true;
  elsif new.role = 'admin' or coalesce(new.can_edit, false) then
    new.role := 'admin';
    new.can_edit := true;
  else
    new.role := 'user';
    new.can_edit := false;
  end if;
  return new;
end;
$$;

create or replace function public.is_runbook_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_accounts a
    where a.user_id = (select auth.uid())
      and a.role in ('admin', 'super_admin')
  );
$$;

revoke all on function public.is_runbook_admin() from public, anon;
grant execute on function public.is_runbook_admin() to authenticated;
