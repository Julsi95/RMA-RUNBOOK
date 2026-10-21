-- Super Admins may review any WFH request, while regular admins retain
-- management access without gaining approval authority.
create or replace function public.is_wfh_responsible_approver(p_employee_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain(id, manager_id, hierarchy_roles, role, depth, visited) as (
    select e.id, e.manager_id, e.hierarchy_roles, e.role, 0, array[e.id]::text[]
      from public.employees e
     where e.id = p_employee_id and e.deleted_at is null
    union all
    select m.id, m.manager_id, m.hierarchy_roles, m.role, c.depth + 1, c.visited || m.id
      from chain c
      join public.employees m on m.id = c.manager_id
     where m.deleted_at is null and c.depth < 32 and not m.id = any(c.visited)
  ),
  leads as (
    select c.id, c.depth
      from chain c
     where coalesce(c.hierarchy_roles, '{}'::text[]) &&
             array['Senior Team Lead (STL)', 'Team Lead (TL)']::text[]
        or lower(btrim(coalesce(c.role, ''))) in (
             'team lead', 'team lead (tl)', 'tl',
             'senior team lead', 'senior team lead (stl)', 'stl'
           )
  ),
  responsible as (
    select id from leads order by depth limit 1
  )
  select public.is_current_runbook_session()
     and (
       exists (
         select 1 from public.app_accounts a
          where a.user_id = (select auth.uid()) and a.role = 'super_admin'
       )
       or exists (
         select 1
           from responsible r
           join public.app_accounts a on a.employee_id = r.id
          where a.user_id = (select auth.uid())
       )
     );
$$;

create or replace function public.notify_wfh_request_approvers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_name text;
  request_label text;
  dates_label text;
begin
  select e.name into employee_name
    from public.employees e
   where e.id = new.employee_id;

  request_label := case
    when new.request_type = 'cancel' then 'cancellation'
    else 'WFH date'
  end;

  select string_agg(to_char(d, 'Mon DD'), ', ' order by d)
    into dates_label
    from unnest(new.requested_dates) as d;

  with recursive chain(id, manager_id, hierarchy_roles, role, depth, visited) as (
    select e.id, e.manager_id, e.hierarchy_roles, e.role, 0, array[e.id]::text[]
      from public.employees e
     where e.id = new.employee_id and e.deleted_at is null
    union all
    select m.id, m.manager_id, m.hierarchy_roles, m.role, c.depth + 1, c.visited || m.id
      from chain c
      join public.employees m on m.id = c.manager_id
     where m.deleted_at is null and c.depth < 32 and not m.id = any(c.visited)
  ),
  lead as (
    select c.id
      from chain c
     where c.depth > 0
       and (
         coalesce(c.hierarchy_roles, '{}'::text[]) &&
           array['Senior Team Lead (STL)', 'Team Lead (TL)']::text[]
         or lower(btrim(coalesce(c.role, ''))) in (
           'team lead', 'team lead (tl)', 'tl',
           'senior team lead', 'senior team lead (stl)', 'stl'
         )
       )
     order by c.depth
     limit 1
  ),
  recipients as (
    select a.user_id
      from lead l
      join public.app_accounts a on a.employee_id = l.id
    union
    select a.user_id
      from public.app_accounts a
     where a.role = 'super_admin'
  )
  insert into public.user_notifications(recipient_id, event_key, category, title, body, href)
  select distinct r.user_id,
         'wfh-request:' || new.id::text,
         'wfh-privilege',
         case when new.request_type = 'cancel'
           then 'WFH cancellation needs review'
           else 'WFH request needs review'
         end,
         coalesce(employee_name, 'An employee') || ' submitted a ' ||
           request_label || ' request for ' || coalesce(dates_label, 'selected dates') || '.',
         '/wfh-privileges'
    from recipients r
   where r.user_id <> new.created_by
  on conflict (recipient_id, event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.notify_wfh_request_approvers() from public, anon, authenticated;

drop trigger if exists wfh_request_approver_notifications on public.wfh_privilege_requests;
create trigger wfh_request_approver_notifications
  after insert on public.wfh_privilege_requests
  for each row execute function public.notify_wfh_request_approvers();
