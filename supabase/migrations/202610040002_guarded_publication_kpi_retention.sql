-- Keep versioned/published records writable only through checked database functions.
create or replace function public.publish_dashboard(p_content jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare rev uuid;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if coalesce(jsonb_typeof(p_content),'')<>'object' or coalesce(jsonb_typeof(p_content->'containers'),'')<>'array' then raise exception 'Dashboard requires a containers array.' using errcode='22023'; end if;
 insert into public.dashboard_revisions(content,created_by) values(p_content,auth.uid()) returning id into rev;
 insert into public.dashboard_publication(singleton,revision_id,updated_by) values(true,rev,auth.uid())
 on conflict(singleton) do update set revision_id=excluded.revision_id,updated_at=now(),updated_by=excluded.updated_by;
 delete from public.dashboard_drafts where owner_id=auth.uid();
 return rev;
end $$;

create or replace function public.save_kpi_scoring_version(p_label text,p_settings jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare ver uuid;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if coalesce(jsonb_typeof(p_settings),'')<>'object' or coalesce(jsonb_typeof(p_settings->'metrics'),'')<>'object' then raise exception 'Invalid KPI scoring settings.' using errcode='22023'; end if;
 insert into public.kpi_scoring_versions(label,settings,created_by) values(coalesce(nullif(p_label,''),'Scoring settings'),p_settings,auth.uid()) returning id into ver;
 insert into public.current_kpi_scoring(singleton,version_id,updated_by) values(true,ver,auth.uid())
 on conflict(singleton) do update set version_id=excluded.version_id,updated_at=now(),updated_by=excluded.updated_by;
 return ver;
end $$;

create or replace function public.save_kpi_month_results(p_month text,p_results jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare pinned_version uuid; item jsonb; next_revision integer; before_state jsonb; actor text; ev uuid; action_name text;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if coalesce(p_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(jsonb_typeof(p_results),'')<>'array' then
   raise exception 'A valid month and results array are required.' using errcode='22023';
 end if;
 select c.version_id into pinned_version from public.current_kpi_scoring c where c.singleton;
 if pinned_version is null then raise exception 'KPI scoring rules have not been configured.' using errcode='P0002'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('employee_id',r.employee_id,'employee_name_snapshot',r.employee_name_snapshot,
   'employee_role_snapshot',r.employee_role_snapshot,'metrics',r.metrics,'overall_score',r.overall_score,'evaluation',r.evaluation)
   order by r.employee_id),'[]'::jsonb) into before_state
 from public.kpi_results r
 where r.month_key=p_month and r.employee_id in (select value->>'employee_id' from jsonb_array_elements(p_results))
   and r.result_revision=(select max(previous.result_revision) from public.kpi_results previous where previous.month_key=r.month_key and previous.employee_id=r.employee_id);
 perform set_config('runbook.skip_row_audit','on',true);
 insert into public.kpi_months(month_key,scoring_version_id,status)
 values(p_month,pinned_version,'published') on conflict(month_key) do nothing;
 select m.scoring_version_id into pinned_version from public.kpi_months m where m.month_key=p_month for update;
 if pinned_version is null then raise exception 'KPI scoring version is missing for this month.' using errcode='P0002'; end if;
 for item in select value from jsonb_array_elements(p_results) loop
   if coalesce(item->>'employee_id','')='' or jsonb_typeof(item->'metrics')<>'object' then
     raise exception 'Every result needs an employee id and metrics object.' using errcode='22023';
   end if;
   select coalesce(max(r.result_revision),0)+1 into next_revision
   from public.kpi_results r where r.month_key=p_month and r.employee_id=item->>'employee_id';
   insert into public.kpi_results(month_key,employee_id,employee_name_snapshot,employee_role_snapshot,metrics,overall_score,evaluation,result_revision,source,updated_by)
   values(p_month,item->>'employee_id',coalesce(item->>'employee_name_snapshot',''),coalesce(item->>'employee_role_snapshot',''),
     item->'metrics',nullif(item->>'overall_score','')::numeric,coalesce(item->>'evaluation',''),next_revision,
     case when item->>'source' in ('manual','import','seed') then item->>'source' else 'manual' end,auth.uid());
 end loop;
 select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
 action_name := case when jsonb_array_length(before_state)=0 then 'create' else 'update' end;
 insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
 values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'Monthly KPI / QA','kpi_months',p_month,action_name,
   initcap(action_name)||' monthly KPI / QA results for '||p_month||'.',jsonb_array_length(before_state)>0) returning id into ev;
 if jsonb_array_length(before_state)>0 then
   insert into public.history_recovery(event_id,before_state,after_state,expires_at)
   values(ev,before_state,p_results,now()+interval '30 days');
 end if;
 return pinned_version;
end $$;

revoke insert,update,delete on public.current_kpi_scoring,public.kpi_scoring_versions,public.kpi_results from authenticated;
revoke insert,update,delete on public.dashboard_publication,public.dashboard_revisions from authenticated;
revoke all on function public.publish_dashboard(jsonb),public.save_kpi_scoring_version(text,jsonb),public.save_kpi_month_results(text,jsonb),public.soft_delete_employee(text),public.restore_employee(text) from public,anon;
grant execute on function public.publish_dashboard(jsonb),public.save_kpi_scoring_version(text,jsonb),public.save_kpi_month_results(text,jsonb) to authenticated;
grant execute on function public.soft_delete_employee(text),public.restore_employee(text) to authenticated;

-- Cleanup is run by pg_cron/database owner, never by anonymous users or browser clients.
create or replace function public.purge_expired_history()
returns integer language plpgsql security definer set search_path = ''
as $$
declare removed integer;
begin
 delete from public.history_events where expires_at<=now();
 get diagnostics removed=row_count;
 delete from public.employees where deleted_at is not null and purge_after<=now();
 return removed;
end $$;
revoke all on function public.purge_expired_history() from public,anon,authenticated;
grant execute on function public.purge_expired_history() to postgres;
