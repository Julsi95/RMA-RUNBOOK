-- Keep roster reporting rules consistent in Postgres and the organization editor.
-- Campaign Specialists report to TL/STL; Senior Agents may report to TL/STL or
-- a Campaign Specialist; Customer Reps may report to those roles or a Senior Agent.
create or replace function public.enforce_employee_reporting_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_employee public.employees%rowtype;
  manager_is_lead boolean;
  manager_is_campaign_specialist boolean;
  manager_is_senior_agent boolean;
  reporting_line_is_valid boolean;
begin
  -- Constraint triggers are deferred so a bulk roster update can change a
  -- leader and reassign their reports in one transaction.
  select * into current_employee from public.employees where id = new.id;
  if not found then return null; end if;

  if current_employee.deleted_at is null
     and current_employee.role in ('Campaign Specialist', 'Senior Agent', 'Customer Rep') then
    select
      manager.deleted_at is null
      and (
        coalesce(manager.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
        or lower(btrim(coalesce(manager.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
      ),
      manager.deleted_at is null and manager.role = 'Campaign Specialist',
      manager.deleted_at is null and manager.role = 'Senior Agent'
      into manager_is_lead, manager_is_campaign_specialist, manager_is_senior_agent
      from public.employees manager
     where manager.id = current_employee.manager_id;

    reporting_line_is_valid := case current_employee.role
      when 'Campaign Specialist' then coalesce(manager_is_lead, false)
      when 'Senior Agent' then coalesce(manager_is_lead, false) or coalesce(manager_is_campaign_specialist, false)
      when 'Customer Rep' then coalesce(manager_is_lead, false) or coalesce(manager_is_campaign_specialist, false) or coalesce(manager_is_senior_agent, false)
      else true
    end;

    if not coalesce(reporting_line_is_valid, false) then
      raise exception 'Campaign Specialists must report to a TL/STL; Senior Agents may also report to a Campaign Specialist; Customer Reps may also report to a Senior Agent.'
        using errcode = '23514';
    end if;
  end if;

  -- A manager cannot be deactivated or lose a role needed by their reports
  -- until those reports have been reassigned.
  if exists (
    select 1
      from public.employees report
     where report.manager_id = current_employee.id
       and report.deleted_at is null
       and report.role in ('Campaign Specialist', 'Senior Agent', 'Customer Rep')
       and not case report.role
         when 'Campaign Specialist' then current_employee.deleted_at is null and (
           coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
           or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
         )
         when 'Senior Agent' then current_employee.deleted_at is null and (
           coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
           or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
           or current_employee.role = 'Campaign Specialist'
         )
         when 'Customer Rep' then current_employee.deleted_at is null and (
           coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
           or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
           or current_employee.role in ('Campaign Specialist', 'Senior Agent')
         )
         else true
       end
  ) then
    raise exception 'Reassign reports before deactivating this employee or removing a role required by their reporting lines.'
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
