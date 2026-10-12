create or replace function public.save_project_coverage(p_projects jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare before_state jsonb; actor text; ev uuid; act text; item jsonb; ids text[]; seq integer; row_item record;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if coalesce(jsonb_typeof(p_projects),'')<>'array' then raise exception 'Project collection must be an array.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_projects) as item_row(value)
   where coalesce(value->>'id','')='' or coalesce(value->>'name','')='' or
   coalesce(jsonb_typeof(value->'trainerIds'),'array')<>'array' or coalesce(jsonb_typeof(value->'assignments'),'object')<>'object') then
   raise exception 'Each project needs an id, name, trainers array, and assignments object.' using errcode='22023';
 end if;
 select array_agg(value->>'id') into ids from jsonb_array_elements(p_projects) as item_row(value);
 if coalesce(cardinality(ids),0)<>(select count(distinct value->>'id') from jsonb_array_elements(p_projects) as item_row(value)) then
   raise exception 'Project ids must be unique.' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'name',p.name,'description',p.description,'isActive',p.is_active,'pocId',p.poc_employee_id,
   'trainerIds',coalesce((select jsonb_agg(t.employee_id order by t.employee_id) from public.project_trainers t where t.project_id=p.id),'[]'::jsonb),
   'assignments',coalesce((select jsonb_object_agg(a.employee_id,a.status) from public.project_assignments a where a.project_id=p.id),'{}'::jsonb)
 ) order by p.sort_order),'[]'::jsonb) into before_state
 from public.projects p where p.deleted_at is null;

 perform set_config('runbook.skip_row_audit','on',true);
 for row_item in select value as item_value,(ordinality-1)::integer as item_order from jsonb_array_elements(p_projects) with ordinality loop
   item := row_item.item_value;
   seq := row_item.item_order;
   insert into public.projects(id,name,description,is_active,poc_employee_id,sort_order,archived_at,deleted_at)
   values(item->>'id',item->>'name',coalesce(item->>'description',''),coalesce((item->>'isActive')::boolean,true),
     nullif(item->>'pocId',''),seq,
     case when coalesce((item->>'isActive')::boolean,true) then null else now() end,null)
   on conflict(id) do update set name=excluded.name,description=excluded.description,is_active=excluded.is_active,
     poc_employee_id=excluded.poc_employee_id,sort_order=excluded.sort_order,
     archived_at=case when excluded.is_active then null else coalesce(projects.archived_at,now()) end,deleted_at=null,updated_at=now();
   delete from public.project_trainers where project_id=item->>'id';
   insert into public.project_trainers(project_id,employee_id)
   select item->>'id',value from jsonb_array_elements_text(coalesce(item->'trainerIds','[]'::jsonb));
   delete from public.project_assignments where project_id=item->>'id';
   insert into public.project_assignments(project_id,employee_id,status)
   select item->>'id',key,value from jsonb_each_text(coalesce(item->'assignments','{}'::jsonb));
 end loop;
 update public.projects set deleted_at=now(),archived_at=coalesce(archived_at,now()),is_active=false,updated_at=now()
 where deleted_at is null and not (id=any(coalesce(ids,array[]::text[])));
 select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
 act := case when jsonb_array_length(before_state)=0 then 'create' else 'update' end;
 insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
 values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'Project coverage','projects','collection',act,
   initcap(act)||' project coverage records.',jsonb_array_length(before_state)>0) returning id into ev;
 if jsonb_array_length(before_state)>0 then
   insert into public.history_recovery(event_id,before_state,after_state,expires_at)
   values(ev,before_state,p_projects,now()+interval '30 days');
 end if;
end $$;

revoke insert,update,delete on public.projects,public.project_trainers,public.project_assignments from authenticated;
revoke all on function public.save_project_coverage(jsonb) from public,anon;
grant execute on function public.save_project_coverage(jsonb) to authenticated;
