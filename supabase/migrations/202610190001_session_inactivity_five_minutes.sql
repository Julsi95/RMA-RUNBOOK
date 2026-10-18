-- Fix the workspace inactivity policy at five minutes. The existing
-- is_current_runbook_session() RLS helper reads this database value, so the
-- limit applies to protected data operations even if a browser timer is paused.

alter table public.runbook_session_settings
  alter column inactivity_timeout_minutes set default 5;

update public.runbook_session_settings
   set inactivity_timeout_minutes = 5,
       updated_at = now()
 where singleton and inactivity_timeout_minutes <> 5;

alter table public.runbook_session_settings
  drop constraint if exists runbook_session_settings_inactivity_timeout_minutes_check;

alter table public.runbook_session_settings
  add constraint runbook_session_settings_inactivity_timeout_minutes_check
  check (inactivity_timeout_minutes = 5);
