alter table public.employees
  add column if not exists co_manager_id text references public.employees(id) on delete set null,
  add column if not exists team text;

alter table public.employees drop constraint if exists employees_team_check;
alter table public.employees add constraint employees_team_check
  check (team is null or team in ('RMA', 'Contracts', 'OM', 'Petro Admin'));

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
  shared_manager public.employees%rowtype;
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
      raise exception 'Campaign Specialists must report to a TL/STL; Senior Agents may also report to a Campaign Specialist; Customer Reps may report to an operational lead.' using errcode = '23514';
    end if;
  end if;

  if current_employee.role='Customer Rep' and current_employee.co_manager_id is null
     and exists (select 1 from public.employees primary_manager where primary_manager.id=current_employee.manager_id and primary_manager.deleted_at is null and primary_manager.role in ('Senior Agent','Campaign Specialist')) then
    raise exception 'Customer Reps reporting to an operational lead need a paired Senior Agent and Campaign Specialist.' using errcode = '23514';
  end if;

  if current_employee.co_manager_id is not null then
    select * into shared_manager from public.employees where id = current_employee.co_manager_id and deleted_at is null;
    if current_employee.role <> 'Customer Rep' or shared_manager.id is null
       or shared_manager.id = current_employee.manager_id
       or not (
         (current_employee.manager_id is not null and exists (select 1 from public.employees primary_manager where primary_manager.id = current_employee.manager_id and primary_manager.deleted_at is null and primary_manager.role = 'Senior Agent') and shared_manager.role = 'Campaign Specialist')
         or (current_employee.manager_id is not null and exists (select 1 from public.employees primary_manager where primary_manager.id = current_employee.manager_id and primary_manager.deleted_at is null and primary_manager.role = 'Campaign Specialist') and shared_manager.role = 'Senior Agent')
       ) then
      raise exception 'A shared Customer Representative report must pair one active Senior Agent with one active Campaign Specialist.' using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1 from public.employees report
     where report.deleted_at is null and (report.manager_id = current_employee.id or report.co_manager_id = current_employee.id)
       and not case
         when report.co_manager_id = current_employee.id then current_employee.deleted_at is null and (
           (report.manager_id is not null and exists (select 1 from public.employees primary_manager where primary_manager.id = report.manager_id and primary_manager.deleted_at is null and ((primary_manager.role = 'Senior Agent' and current_employee.role = 'Campaign Specialist') or (primary_manager.role = 'Campaign Specialist' and current_employee.role = 'Senior Agent'))))
         )
         when report.role = 'Campaign Specialist' then current_employee.deleted_at is null and (coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[] or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl'))
         when report.role = 'Senior Agent' then current_employee.deleted_at is null and (coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[] or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl') or current_employee.role = 'Campaign Specialist')
         when report.role = 'Customer Rep' then current_employee.deleted_at is null and (coalesce(current_employee.hierarchy_roles, '{}'::text[]) && array['Team Lead (TL)', 'Senior Team Lead (STL)']::text[] or lower(btrim(coalesce(current_employee.role, ''))) in ('team lead', 'team lead (tl)', 'tl', 'senior team lead', 'senior team lead (stl)', 'stl') or current_employee.role in ('Campaign Specialist', 'Senior Agent'))
         else true
       end
  ) then
    raise exception 'Reassign reports before deactivating an employee or removing a role required by their reporting lines.' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function public.enforce_employee_reporting_roles() from public, anon, authenticated;
drop trigger if exists employee_reporting_roles_guard on public.employees;
create constraint trigger employee_reporting_roles_guard
after insert or update on public.employees
deferrable initially deferred
for each row execute function public.enforce_employee_reporting_roles();

create or replace function public.get_public_employee_directory()
returns table(id text, name text, role text, manager_id text, mentor_id text, photo_url text, photo_path text, profile jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.role, e.manager_id, e.mentor_id,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_url else '' end,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_path else null end,
         jsonb_strip_nulls(jsonb_build_object(
           'hierarchy_roles', to_jsonb(e.hierarchy_roles), 'co_manager_id', e.co_manager_id, 'team', e.team,
           'birthday', case when public.is_runbook_editor() or coalesce(p.birthday_public, false) then p.birthday::text end,
           'birthday_public', coalesce(p.birthday_public, false),
           'hire_date', case when public.is_runbook_editor() or p.hire_date_public then p.hire_date::text end,
           'personality', case when public.is_runbook_editor() or p.personality_public then p.personality end,
           'summary', case when public.is_runbook_editor() or p.summary_public then p.summary end,
           'custom_fields', case when public.is_runbook_editor() then p.custom_fields else (
             select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) as field(k, v)
              where jsonb_typeof(p.custom_field_visibility -> k) = 'boolean' and (p.custom_field_visibility ->> k) = 'true'
           ) end,
           'custom_field_visibility', case when public.is_runbook_editor() then p.custom_field_visibility end
         ))
    from public.employees e left join public.employee_profiles p on p.employee_id = e.id
   where public.is_current_runbook_session() and e.deleted_at is null order by e.sort_order, e.name;
$$;
revoke all on function public.get_public_employee_directory() from public, anon;
grant execute on function public.get_public_employee_directory() to authenticated;

create or replace function public.get_public_workspace_employee_directory()
returns table(id text, name text, role text, hierarchy_roles text[], manager_id text, mentor_id text, photo_url text, photo_path text, sort_order integer, profile jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.role, e.hierarchy_roles, e.manager_id, e.mentor_id,
         case when coalesce(p.photo_public, true) then e.photo_url else '' end,
         case when coalesce(p.photo_public, true) then nullif(e.photo_path, '') else null end,
         e.sort_order,
         jsonb_strip_nulls(jsonb_build_object('hierarchy_roles', to_jsonb(e.hierarchy_roles), 'co_manager_id', e.co_manager_id, 'team', e.team,
           'birthday', case when p.birthday_public then p.birthday::text end,
           'hire_date', case when p.hire_date_public then p.hire_date::text end,
           'personality', case when p.personality_public then p.personality end,
           'summary', case when p.summary_public then p.summary end,
           'custom_fields', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) as field(k, v) where jsonb_typeof(p.custom_field_visibility -> k) = 'boolean' and (p.custom_field_visibility ->> k) = 'true')
         ))
    from public.employees e left join public.employee_profiles p on p.employee_id = e.id
   where e.deleted_at is null order by e.sort_order, e.name;
$$;
revoke all on function public.get_public_workspace_employee_directory() from public;
grant execute on function public.get_public_workspace_employee_directory() to anon, authenticated;
