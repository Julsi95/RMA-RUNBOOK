create or replace function public.create_kpi_month(p_month text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare current_version uuid; pinned_version uuid; pinned_settings jsonb;
begin
 if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
 if coalesce(p_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'A valid KPI month is required.' using errcode='22023'; end if;
 select c.version_id into current_version from public.current_kpi_scoring c where c.singleton;
 if current_version is null then raise exception 'KPI scoring rules have not been configured.' using errcode='P0002'; end if;
 insert into public.kpi_months(month_key,scoring_version_id,status,updated_by) values(p_month,current_version,'published',auth.uid())
 on conflict(month_key) do nothing;
 select m.scoring_version_id,v.settings into pinned_version,pinned_settings
 from public.kpi_months m join public.kpi_scoring_versions v on v.id=m.scoring_version_id where m.month_key=p_month;
 if pinned_version is null then raise exception 'This KPI month has no scoring version.' using errcode='P0002'; end if;
 return jsonb_build_object('month',p_month,'scoringVersionId',pinned_version,'scoringSettings',pinned_settings);
end $$;
revoke all on function public.create_kpi_month(text) from public,anon;
grant execute on function public.create_kpi_month(text) to authenticated;
