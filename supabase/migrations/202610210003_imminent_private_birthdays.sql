-- Signed-in users may see that a private birthday is approaching, but only
-- within 14 days. Return the next occurrence date rather than the birth year.
-- Anonymous public workspace reads keep the normal visibility filter.
create or replace function public.get_public_employee_directory()
returns table(id text, name text, role text, manager_id text, mentor_id text, photo_url text, photo_path text, profile jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.role, e.manager_id, e.mentor_id,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_url else '' end,
         case when public.is_runbook_editor() or coalesce(p.photo_public, true) then e.photo_path else null end,
         jsonb_strip_nulls(jsonb_build_object(
           'hierarchy_roles', to_jsonb(e.hierarchy_roles),
           'birthday', case
             when public.is_runbook_editor() or coalesce(p.birthday_public, false) then p.birthday::text
             when upcoming.next_birthday between current_day.today and current_day.today + 14 then upcoming.next_birthday::text
           end,
           'birthday_public', coalesce(p.birthday_public, false),
           'hire_date', case when public.is_runbook_editor() or p.hire_date_public then p.hire_date::text end,
           'personality', case when public.is_runbook_editor() or p.personality_public then p.personality end,
           'summary', case when public.is_runbook_editor() or p.summary_public then p.summary end,
           'custom_fields', case when public.is_runbook_editor() then p.custom_fields else (
             select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
               from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) as field(k, v)
              where jsonb_typeof(p.custom_field_visibility -> k) = 'boolean'
                and (p.custom_field_visibility ->> k) = 'true'
           ) end,
           'custom_field_visibility', case when public.is_runbook_editor() then p.custom_field_visibility end
         ))
    from public.employees e
    left join public.employee_profiles p on p.employee_id = e.id
    cross join lateral (
      select timezone('Asia/Manila', now())::date as today
    ) as current_day
    left join lateral (
      select case
        when current_year.date < current_day.today then next_year.date
        else current_year.date
      end as next_birthday
        from (
          select make_date(extract(year from current_day.today)::integer, extract(month from p.birthday)::integer, 1)
                 + (extract(day from p.birthday)::integer - 1) as date
        ) as current_year
        cross join lateral (
          select make_date(extract(year from current_day.today)::integer + 1, extract(month from p.birthday)::integer, 1)
                 + (extract(day from p.birthday)::integer - 1) as date
        ) as next_year
       where p.birthday is not null
    ) as upcoming on true
   where public.is_current_runbook_session() and e.deleted_at is null
   order by e.sort_order, e.name;
$$;

revoke all on function public.get_public_employee_directory() from public, anon;
grant execute on function public.get_public_employee_directory() to authenticated;
