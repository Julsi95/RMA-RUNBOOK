-- Allow Senior Agents to have two Campaign Specialists as reporting managers.
-- The second manager remains stored in employees.co_manager_id and is validated
-- by the existing deferred employee reporting trigger.
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
  second_manager public.employees%rowtype;
  primary_manager public.employees%rowtype;
begin
  select * into current_employee from public.employees where id = new.id;
  if not found then return null; end if;

  if current_employee.deleted_at is null
     and current_employee.role in ('Campaign Specialist', 'Senior Agent', 'Customer Rep') then
    select manager.deleted_at is null and (
        coalesce(manager.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
        or lower(btrim(coalesce(manager.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
      ), manager.deleted_at is null and manager.role = 'Campaign Specialist',
         manager.deleted_at is null and manager.role = 'Senior Agent'
      into manager_is_lead, manager_is_campaign_specialist, manager_is_senior_agent
      from public.employees manager where manager.id = current_employee.manager_id;

    reporting_line_is_valid := case current_employee.role
      when 'Campaign Specialist' then coalesce(manager_is_lead, false)
      when 'Senior Agent' then coalesce(manager_is_lead, false) or coalesce(manager_is_campaign_specialist, false)
      when 'Customer Rep' then coalesce(manager_is_lead, false) or coalesce(manager_is_campaign_specialist, false) or coalesce(manager_is_senior_agent, false)
      else true
    end;
    if not coalesce(reporting_line_is_valid, false) then
      raise exception 'Campaign Specialists must report to a TL/STL; Senior Agents may report to a TL/STL or Campaign Specialist; Customer Reps may report to a TL/STL, Campaign Specialist, or Senior Agent.' using errcode = '23514';
    end if;
  end if;

  if current_employee.co_manager_id is not null then
    select * into primary_manager from public.employees
     where id = current_employee.manager_id and deleted_at is null;
    select * into second_manager from public.employees
     where id = current_employee.co_manager_id and deleted_at is null;

    if primary_manager.id is null or second_manager.id is null
       or second_manager.id = primary_manager.id
       or not (
         (current_employee.role = 'Customer Rep' and (
           (primary_manager.role = 'Senior Agent' and second_manager.role = 'Campaign Specialist')
           or (primary_manager.role = 'Campaign Specialist' and second_manager.role in ('Campaign Specialist', 'Senior Agent'))
         ))
         or (current_employee.role = 'Senior Agent'
           and primary_manager.role = 'Campaign Specialist'
           and second_manager.role = 'Campaign Specialist')
       ) then
      raise exception 'Choose an active second reporting manager allowed for this employee role.' using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1
      from public.employees report
     where report.deleted_at is null
       and (report.manager_id = current_employee.id or report.co_manager_id = current_employee.id)
       and not case
         when report.co_manager_id = current_employee.id then
           current_employee.deleted_at is null
           and (
             (report.role = 'Customer Rep' and exists (
               select 1 from public.employees primary_report_manager
                where primary_report_manager.id = report.manager_id
                  and primary_report_manager.deleted_at is null
                  and (
                    (primary_report_manager.role = 'Senior Agent' and current_employee.role = 'Campaign Specialist')
                    or (primary_report_manager.role = 'Campaign Specialist' and current_employee.role in ('Campaign Specialist', 'Senior Agent'))
                  )
             ))
             or (report.role = 'Senior Agent' and current_employee.role = 'Campaign Specialist'
               and exists (
                 select 1 from public.employees primary_report_manager
                  where primary_report_manager.id = report.manager_id
                    and primary_report_manager.deleted_at is null
                    and primary_report_manager.role = 'Campaign Specialist'
               ))
           )
         when report.role = 'Campaign Specialist' then
           current_employee.deleted_at is null and (
             coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
             or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
           )
         when report.role = 'Senior Agent' then
           current_employee.deleted_at is null and (
             coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
             or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
             or current_employee.role = 'Campaign Specialist'
           )
         when report.role = 'Customer Rep' then
           current_employee.deleted_at is null and (
             coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[]
             or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl')
             or current_employee.role in ('Campaign Specialist', 'Senior Agent')
           )
         else true
       end
  ) then
    raise exception 'Reassign reports before deactivating an employee or removing a role required by their reporting lines.' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function public.enforce_employee_reporting_roles() from public, anon, authenticated;
