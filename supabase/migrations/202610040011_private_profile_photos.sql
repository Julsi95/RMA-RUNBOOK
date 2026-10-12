-- Uploaded employee photos live in the private bucket. Public photos receive
-- short-lived signed URLs only when the employee's visibility flag permits it.
create or replace function public.can_read_runbook_profile_photo(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    left join public.employee_profiles p on p.employee_id=e.id
    where e.photo_path=p_path and e.deleted_at is null and coalesce(p.photo_public,true)
  );
$$;
revoke all on function public.can_read_runbook_profile_photo(text) from public;
grant execute on function public.can_read_runbook_profile_photo(text) to anon, authenticated;

drop policy if exists "Public visible profile photos" on storage.objects;
create policy "Public visible profile photos" on storage.objects for select to anon, authenticated
  using (bucket_id='runbook-private' and public.can_read_runbook_profile_photo(name));

drop function if exists public.get_public_employee_directory();
create function public.get_public_employee_directory()
returns table(id text,name text,role text,manager_id text,mentor_id text,photo_url text,photo_path text,profile jsonb)
language sql stable security definer set search_path = ''
as $$
  select e.id,e.name,e.role,e.manager_id,e.mentor_id,
    case when coalesce(p.photo_public,true) then e.photo_url else '' end,
    case when coalesce(p.photo_public,true) then coalesce(e.photo_path,'') else '' end,
    jsonb_strip_nulls(jsonb_build_object(
      'birthday',case when p.birthday_public then p.birthday::text end,
      'hireDate',case when p.hire_date_public then p.hire_date::text end,
      'personality',case when p.personality_public then p.personality end,
      'summary',case when p.summary_public then p.summary end,
      'fields',coalesce((select jsonb_object_agg(f.key,f.value) from jsonb_each(coalesce(p.custom_fields,'{}'::jsonb)) f
        where jsonb_typeof(p.custom_field_visibility -> f.key)='boolean' and (p.custom_field_visibility ->> f.key)='true'),'{}'::jsonb)))
  from public.employees e left join public.employee_profiles p on p.employee_id=e.id
  where e.deleted_at is null order by e.sort_order,e.name;
$$;
revoke all on function public.get_public_employee_directory() from public;
grant execute on function public.get_public_employee_directory() to anon, authenticated;

create or replace function public.get_public_vl_credit_entries()
returns table(id text,month_start date,employee_id text,employee_name_snapshot text,employee_role_snapshot text,employee_photo_snapshot text,credit_value text,sort_order integer)
language sql stable security definer set search_path = ''
as $$
  select v.id,v.month_start,v.employee_id,v.employee_name_snapshot,v.employee_role_snapshot,
    case when public.is_runbook_editor() or (e.deleted_at is null and coalesce(p.photo_public,true))
      then coalesce(nullif(e.photo_path,''),nullif(e.photo_url,''),v.employee_photo_snapshot,'') else '' end,
    v.credit_value,v.sort_order
  from public.vl_credit_entries v
  left join public.employees e on e.id=v.employee_id
  left join public.employee_profiles p on p.employee_id=v.employee_id
  order by v.month_start,v.sort_order;
$$;
revoke all on function public.get_public_vl_credit_entries() from public;
grant execute on function public.get_public_vl_credit_entries() to anon, authenticated;
