-- Move the fixed inactivity policy from five minutes to thirty minutes.
-- Database session checks remain authoritative after this migration runs.

alter table public.runbook_session_settings
  alter column inactivity_timeout_minutes set default 30;

update public.runbook_session_settings
   set inactivity_timeout_minutes = 30,
       updated_at = now()
 where singleton and inactivity_timeout_minutes <> 30;

alter table public.runbook_session_settings
  drop constraint if exists runbook_session_settings_inactivity_timeout_minutes_check;

alter table public.runbook_session_settings
  add constraint runbook_session_settings_inactivity_timeout_minutes_check
  check (inactivity_timeout_minutes = 30);
