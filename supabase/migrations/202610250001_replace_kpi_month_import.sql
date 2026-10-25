create or replace function public.replace_kpi_month_results(p_month text, p_results jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pinned_version uuid;
  item jsonb;
  current_row public.kpi_results%rowtype;
  next_revision integer;
  before_state jsonb;
  actor text;
  event_id uuid;
  action_name text;
begin
  if not public.is_runbook_editor() then
    raise exception 'Editor access is required.' using errcode='42501';
  end if;
  if coalesce(p_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     or coalesce(jsonb_typeof(p_results),'') <> 'array' then
    raise exception 'A valid month and results array are required.' using errcode='22023';
  end if;
  if jsonb_array_length(p_results) = 0 then
    raise exception 'At least one result row is required.' using errcode='22023';
  end if;
  if jsonb_array_length(p_results) > 2000 or octet_length(p_results::text) > 5242880 then
    raise exception 'The import exceeds the allowed row or data size.' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_results) as input(value)
    where coalesce(value->>'employee_id','') = ''
       or coalesce(value->>'employee_name_snapshot','') = ''
       or length(value->>'employee_id') > 200
       or length(value->>'employee_name_snapshot') > 200
       or length(coalesce(value->>'employee_role_snapshot','')) > 120
       or length(coalesce(value->>'evaluation','')) > 200
       or (value ? 'overall_score' and jsonb_typeof(value->'overall_score') not in ('number','null'))
       or coalesce(jsonb_typeof(value->'metrics'),'') <> 'object'
       or exists (
         select 1 from jsonb_object_keys(value->'metrics') as metric_key(key)
         where key not in ('qa','callsHandled','completionCount','error','kudos','absenteeism','punctuality','excessiveBreak','pci','_importedRank')
       )
       or exists (
         select 1 from jsonb_each(value->'metrics') as metric_entry(key,value)
         where metric_entry.key <> '_importedRank'
           and (coalesce(jsonb_typeof(metric_entry.value),'') <> 'object'
             or exists (
               select 1 from jsonb_each(metric_entry.value) as metric_field(key,value)
               where metric_field.key not in ('rawValue','equivalentScore','weightedScore','percentValue')
                  or jsonb_typeof(metric_field.value) not in ('string','number','null')
                  or (jsonb_typeof(metric_field.value)='string' and length(metric_field.value#>>'{}') > 32)
             ))
       )
       or (value->'metrics' ? '_importedRank' and (jsonb_typeof(value->'metrics'->'_importedRank') <> 'string'
         or length(value->'metrics'->>'_importedRank') > 32))
  ) then
    raise exception 'Every result needs an employee id, name, and metrics object.' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_results)) <>
     (select count(distinct value->>'employee_id') from jsonb_array_elements(p_results) as input(value)) then
    raise exception 'A KPI save can include each employee only once.' using errcode='22023';
  end if;

  select c.version_id into pinned_version from public.current_kpi_scoring c where c.singleton;
  if pinned_version is null then
    raise exception 'KPI scoring rules have not been configured.' using errcode='P0002';
  end if;
  insert into public.kpi_months(month_key, scoring_version_id, status)
  values(p_month, pinned_version, 'published')
  on conflict(month_key) do nothing;
  select m.scoring_version_id into pinned_version
  from public.kpi_months m where m.month_key = p_month for update;
  if pinned_version is null then
    raise exception 'KPI scoring version is missing for this month.' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_id', latest.employee_id,
    'had_record', true,
    'employee_name_snapshot', latest.employee_name_snapshot,
    'employee_role_snapshot', latest.employee_role_snapshot,
    'metrics', latest.metrics,
    'overall_score', latest.overall_score,
    'evaluation', latest.evaluation,
    'source', latest.source
  ) order by latest.employee_id), '[]'::jsonb)
  into before_state
  from (
    select distinct on (r.employee_id) r.*
    from public.kpi_results r
    where r.month_key = p_month
    order by r.employee_id, r.result_revision desc
  ) latest
  where not latest.is_deleted;

  for item in select value from jsonb_array_elements(p_results) loop
    if not exists (
      select 1 from jsonb_array_elements(before_state) as previous(value)
      where previous.value->>'employee_id' = item->>'employee_id'
    ) then
      before_state := before_state || jsonb_build_array(jsonb_build_object(
        'employee_id', item->>'employee_id', 'had_record', false
      ));
    end if;
  end loop;

  perform set_config('runbook.skip_row_audit','on',true);
  for current_row in
    select latest.*
    from (
      select distinct on (r.employee_id) r.*
      from public.kpi_results r
      where r.month_key = p_month
      order by r.employee_id, r.result_revision desc
    ) latest
    where not latest.is_deleted
      and not exists (
        select 1 from jsonb_array_elements(p_results) as input(value)
        where input.value->>'employee_id' = latest.employee_id
      )
  loop
    select coalesce(max(r.result_revision),0)+1 into next_revision
    from public.kpi_results r
    where r.month_key = p_month and r.employee_id = current_row.employee_id;
    insert into public.kpi_results(month_key,employee_id,employee_name_snapshot,employee_role_snapshot,metrics,overall_score,evaluation,result_revision,source,updated_by,is_deleted)
    values(p_month,current_row.employee_id,current_row.employee_name_snapshot,current_row.employee_role_snapshot,
      current_row.metrics,current_row.overall_score,current_row.evaluation,next_revision,current_row.source,auth.uid(),true);
  end loop;

  for item in select value from jsonb_array_elements(p_results) loop
    select coalesce(max(r.result_revision),0)+1 into next_revision
    from public.kpi_results r
    where r.month_key = p_month and r.employee_id = item->>'employee_id';
    insert into public.kpi_results(month_key,employee_id,employee_name_snapshot,employee_role_snapshot,metrics,overall_score,evaluation,result_revision,source,updated_by,is_deleted)
    values(p_month,item->>'employee_id',item->>'employee_name_snapshot',coalesce(item->>'employee_role_snapshot',''),
      item->'metrics',nullif(item->>'overall_score','')::numeric,coalesce(item->>'evaluation',''),next_revision,
      'import',auth.uid(),false);
  end loop;

  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor
  from public.app_accounts a where a.user_id = auth.uid();
  action_name := case
    when exists(select 1 from jsonb_array_elements(before_state) as old(value) where coalesce((value->>'had_record')::boolean,false)) then 'update'
    else 'create'
  end;
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'Monthly KPI / QA','kpi_months',p_month,action_name,
    'Replaced monthly KPI / QA results for '||p_month||'.',true) returning id into event_id;
  insert into public.history_recovery(event_id,before_state,after_state,expires_at)
  values(event_id,before_state,p_results,now()+interval '30 days');
  return pinned_version;
end;
$$;

revoke all on function public.replace_kpi_month_results(text,jsonb) from public, anon;
grant execute on function public.replace_kpi_month_results(text,jsonb) to authenticated;
