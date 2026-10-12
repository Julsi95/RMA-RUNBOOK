-- RUNBOOK workspace pages now require a signed-in account to read any app data.
-- Users still have read-only workspace access; existing Admin-only RLS/RPC checks
-- continue to control writes. Login, reset-password, and email invite flows use
-- Supabase Auth endpoints and do not depend on anonymous database access.

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;

-- Keep the public employee/VL directory RPCs available to authenticated Users;
-- their existing field-visibility filtering remains in effect.
grant execute on function public.get_public_employee_directory() to authenticated;
grant execute on function public.get_public_vl_credit_entries() to authenticated;
grant execute on function public.is_runbook_admin(),public.is_runbook_editor() to authenticated;
grant execute on function public.can_read_runbook_profile_photo(text),public.can_manage_runbook_profile_photo(text) to authenticated;
grant execute on function public.update_my_account_profile(text,text,text) to authenticated;
grant execute on function public.publish_dashboard(jsonb),public.save_kpi_scoring_version(text,jsonb),public.soft_delete_employee(text),public.restore_employee(text) to authenticated;
grant execute on function public.save_seat_plan(date,jsonb),public.save_vl_credit_month(date,date,jsonb),public.save_project_coverage(jsonb) to authenticated;
grant execute on function public.save_call_schedule_month(date,jsonb,jsonb),public.save_work_schedule_document(jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.create_kpi_month(text),public.save_kpi_month_results(text,jsonb),public.restore_kpi_month_snapshot(text,jsonb) to authenticated;
grant execute on function public.save_app_links(jsonb),public.save_qa_criteria(jsonb),public.restore_history_event(uuid) to authenticated;
grant execute on function public.is_public_current_kpi_result(text,text,integer,boolean) to authenticated;
grant execute on function public.save_vl_credit_entry(jsonb),public.delete_vl_credit_entry(text) to authenticated;
