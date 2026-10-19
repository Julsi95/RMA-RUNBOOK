-- Campaign Specialists and Senior Agents report directly to a Team Lead or STL.
-- Enforce this in Postgres as well as in the organizational chart editor so
-- writes made through any client cannot create an invalid reporting line.
create or replace function public.enforce_employee_reporting_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_employee public.employees%rowtype;
  manager_is_eligible boolean;
begin
  -- Constraint triggers are deferred so a bulk roster update can change a
  -- leader and reassign their reports in one transaction.
  select * into current_employee
    from public.employees
   where id = new.id;

  if not found then
    return null;
  end if;

  if current_employee.deleted_at is null
     and current_employee.role in ('Campaign Specialist', 'Senior Agent') then
    select exists (
      select 1
        from public.employees manager
       where manager.id = current_employee.manager_id
         and manager.deleted_at is null
         and (
           coalesce(manager.hierarchy_roles, '{}'::text[]) && array[
             'Team Lead (TL)',
             'Senior Team Lead (STL)'
           ]::text[]
           or lower(btrim(coalesce(manager.role, ''))) in (
             'team lead', 'team lead (tl)', 'tl',
             'senior team lead', 'senior team lead (stl)', 'stl'
           )
         )
    ) into manager_is_eligible;

    if not coalesce(manager_is_eligible, false) then
      raise exception 'Campaign Specialists and Senior Agents must report directly to an active Team Lead or Senior Team Lead (STL).'
        using errcode = '23514';
    end if;
  end if;

  -- A manager cannot lose the TL/STL assignment or be deactivated while
  -- restricted-role reports still point to them. Reassign reports first.
  if exists (
       select 1
         from public.employees report
        where report.manager_id = current_employee.id
          and report.deleted_at is null
          and report.role in ('Campaign Specialist', 'Senior Agent')
     )
     and (
       current_employee.deleted_at is not null
       or not (
         coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array[
           'Team Lead (TL)',
           'Senior Team Lead (STL)'
         ]::text[]
         or lower(btrim(coalesce(current_employee.role, ''))) in (
           'team lead', 'team lead (tl)', 'tl',
           'senior team lead', 'senior team lead (stl)', 'stl'
         )
       )
     ) then
    raise exception 'Reassign Campaign Specialist and Senior Agent reports before removing the Team Lead / STL role.'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke all on function public.enforce_employee_reporting_roles() from public, anon, authenticated;

drop trigger if exists employee_reporting_roles_guard on public.employees;
create constraint trigger employee_reporting_roles_guard
after insert or update on public.employees
deferrable initially deferred
for each row
execute function public.enforce_employee_reporting_roles();
