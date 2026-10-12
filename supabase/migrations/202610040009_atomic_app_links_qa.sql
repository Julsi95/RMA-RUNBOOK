-- Keep application CRUD atomic and emit one recoverable event per page save.
create or replace function public.save_app_links(p_items jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare before_state jsonb; actor text; ev uuid; act text; item jsonb; seq integer; ids text[]; row_item record;
begin
  if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
  if coalesce(jsonb_typeof(p_items),'')<>'array' then raise exception 'Application links must be an array.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) as entry(value)
    where coalesce(value->>'id','')='' or coalesce(trim(value->>'name'),'')='' or coalesce(jsonb_typeof(value),'')<>'object') then
    raise exception 'Each application link needs an id and a name.' using errcode='22023';
  end if;
  select array_agg(value->>'id') into ids from jsonb_array_elements(p_items) as entry(value);
  if coalesce(cardinality(ids),0)<>(select count(distinct value->>'id') from jsonb_array_elements(p_items) as entry(value)) then
    raise exception 'Application link ids must be unique.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'url',l.url,'application',l.application,
    'group',l.group_name,'description',l.description) order by l.sort_order),'[]'::jsonb)
    into before_state from public.app_links l;

  perform set_config('runbook.skip_row_audit','on',true);
  delete from public.app_links where not (id=any(coalesce(ids,array[]::text[])));
  for row_item in select value as item_value,(ordinality-1)::integer as item_order from jsonb_array_elements(p_items) with ordinality loop
    item := row_item.item_value;
    seq := row_item.item_order;
    insert into public.app_links(id,name,url,application,group_name,description,sort_order)
    values(item->>'id',trim(item->>'name'),coalesce(item->>'url',''),coalesce(item->>'application',''),
      coalesce(nullif(item->>'group',''),nullif(item->>'group_name',''),'General'),coalesce(item->>'description',''),seq)
    on conflict(id) do update set name=excluded.name,url=excluded.url,application=excluded.application,
      group_name=excluded.group_name,description=excluded.description,sort_order=excluded.sort_order,updated_at=now();
  end loop;

  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
  act := case when jsonb_array_length(before_state)=0 then 'create' else 'update' end;
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'App / Links','app_links','collection',act,
    initcap(act)||' application links.',jsonb_array_length(before_state)>0) returning id into ev;
  if jsonb_array_length(before_state)>0 then
    insert into public.history_recovery(event_id,before_state,after_state,expires_at)
    values(ev,before_state,p_items,now()+interval '30 days');
  end if;
end $$;

create or replace function public.save_qa_criteria(p_items jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare before_state jsonb; actor text; ev uuid; act text; item jsonb; seq integer; ids text[]; row_item record;
begin
  if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
  if coalesce(jsonb_typeof(p_items),'')<>'array' then raise exception 'QA criteria must be an array.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) as entry(value)
    where coalesce(value->>'id','')='' or coalesce(trim(value->>'criterion'),'')=''
      or coalesce((value->>'tcr')::integer,-1)<0 or coalesce((value->>'tcp')::integer,-1)<0
      or coalesce((value->>'tcp')::integer,-1)>coalesce((value->>'tcr')::integer,-1)) then
    raise exception 'Each criterion needs a name and valid TCR/TCP values.' using errcode='22023';
  end if;
  select array_agg(value->>'id') into ids from jsonb_array_elements(p_items) as entry(value);
  if coalesce(cardinality(ids),0)<>(select count(distinct value->>'id') from jsonb_array_elements(p_items) as entry(value)) then
    raise exception 'QA criterion ids must be unique.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'category',q.category,'criterion',q.criterion,
    'tcr',q.tcr,'tcp',q.tcp,'order',q.sort_order) order by q.sort_order),'[]'::jsonb)
    into before_state from public.qa_criteria q;

  perform set_config('runbook.skip_row_audit','on',true);
  delete from public.qa_criteria where not (id=any(coalesce(ids,array[]::text[])));
  for row_item in select value as item_value,(ordinality-1)::integer as item_order from jsonb_array_elements(p_items) with ordinality loop
    item := row_item.item_value;
    seq := row_item.item_order;
    insert into public.qa_criteria(id,category,criterion,tcr,tcp,sort_order)
    values(item->>'id',coalesce(item->>'category','General'),trim(item->>'criterion'),(item->>'tcr')::integer,(item->>'tcp')::integer,seq)
    on conflict(id) do update set category=excluded.category,criterion=excluded.criterion,tcr=excluded.tcr,
      tcp=excluded.tcp,sort_order=excluded.sort_order,updated_at=now();
  end loop;

  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
  act := case when jsonb_array_length(before_state)=0 then 'create' else 'update' end;
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'QA Parameters','qa_criteria','collection',act,
    initcap(act)||' QA criteria.',jsonb_array_length(before_state)>0) returning id into ev;
  if jsonb_array_length(before_state)>0 then
    insert into public.history_recovery(event_id,before_state,after_state,expires_at)
    values(ev,before_state,p_items,now()+interval '30 days');
  end if;
end $$;

revoke insert,update,delete on public.app_links,public.qa_criteria from authenticated;
revoke all on function public.save_app_links(jsonb),public.save_qa_criteria(jsonb) from public,anon;
grant execute on function public.save_app_links(jsonb),public.save_qa_criteria(jsonb) to authenticated;

-- Restrict public employee reads to the sanitized directory RPC and apply the
-- per-profile photo visibility flag at the database boundary.
alter table public.employee_profiles add column if not exists photo_public boolean not null default true;
revoke select on public.employees from anon;
drop policy if exists "Public employee listing" on public.employees;
create or replace function public.get_public_employee_directory()
returns table(id text,name text,role text,manager_id text,mentor_id text,photo_url text,profile jsonb)
language sql stable security definer set search_path = ''
as $$
 select e.id,e.name,e.role,e.manager_id,e.mentor_id,case when coalesce(p.photo_public,true) then e.photo_url else '' end,
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
grant execute on function public.get_public_employee_directory() to anon,authenticated;

-- VL rows retain their own monthly values, but public reads must not leak an
-- employee photo that the profile owner has marked private.
revoke select on public.vl_credit_entries from anon;
drop policy if exists "Public VL entries" on public.vl_credit_entries;
create or replace function public.get_public_vl_credit_entries()
returns table(id text,month_start date,employee_id text,employee_name_snapshot text,employee_role_snapshot text,employee_photo_snapshot text,credit_value text,sort_order integer)
language sql stable security definer set search_path = ''
as $$
 select v.id,v.month_start,v.employee_id,v.employee_name_snapshot,v.employee_role_snapshot,
   case when public.is_runbook_editor() or coalesce(p.photo_public,true)
     then coalesce(nullif(e.photo_url,''),v.employee_photo_snapshot,'') else '' end,
   v.credit_value,v.sort_order
 from public.vl_credit_entries v
 left join public.employees e on e.id=v.employee_id
 left join public.employee_profiles p on p.employee_id=v.employee_id
 order by v.month_start,v.sort_order;
$$;
revoke all on function public.get_public_vl_credit_entries() from public;
grant execute on function public.get_public_vl_credit_entries() to anon,authenticated;

-- Reassert public access only to the currently published dashboard revision.
drop policy if exists "Public dashboard revisions" on public.dashboard_revisions;
drop policy if exists "Public published dashboard revision" on public.dashboard_revisions;
create policy "Public published dashboard revision" on public.dashboard_revisions for select to anon,authenticated
  using(id=(select dp.revision_id from public.dashboard_publication dp where dp.singleton));
alter policy "Public project listing" on public.projects to anon,authenticated;
alter policy "Public project trainers" on public.project_trainers to anon,authenticated;
alter policy "Public project assignments" on public.project_assignments to anon,authenticated;
alter policy "Public seat data" on public.seat_plans to anon,authenticated;
alter policy "Public seat positions" on public.seat_positions to anon,authenticated;
alter policy "Public seat assignments" on public.seat_assignments to anon,authenticated;
alter policy "Public call schedules" on public.call_schedule_months to anon,authenticated;
alter policy "Public call assignments" on public.call_assignments to anon,authenticated;
alter policy "Public monthly work schedules" on public.work_schedule_months to anon,authenticated;
alter policy "Public monthly work assignments" on public.work_schedule_month_assignments to anon,authenticated;
alter policy "Public work periods" on public.work_schedule_periods to anon,authenticated;
alter policy "Public work period assignments" on public.work_schedule_period_assignments to anon,authenticated;
alter policy "Public work revisions" on public.work_schedule_revisions to anon,authenticated;
alter policy "Public VL data" on public.vl_months to anon,authenticated;
alter policy "Public app links" on public.app_links to anon,authenticated;
alter policy "Public QA criteria" on public.qa_criteria to anon,authenticated;
alter policy "Public profile fields" on public.agent_profile_field_definitions to anon,authenticated;
alter policy "Public KPI scoring versions" on public.kpi_scoring_versions to anon,authenticated;
alter policy "Public current KPI scoring" on public.current_kpi_scoring to anon,authenticated;
alter policy "Public KPI months" on public.kpi_months to anon,authenticated;
alter policy "Public KPI results" on public.kpi_results to anon,authenticated;
alter policy "Public dashboard publication" on public.dashboard_publication to anon,authenticated;
alter policy "Recent public history" on public.history_events to anon,authenticated;
-- Public buckets allow URL-based reads. Avoid allowing anonymous object listing.
drop policy if exists "Public assets read" on storage.objects;
