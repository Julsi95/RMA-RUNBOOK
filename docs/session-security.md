# RUNBOOK session security

## Enforcement

Supabase Auth manages access and refresh tokens. RUNBOOK also tracks one active app session per account using `runbook_active_sessions` and the Auth JWT `session_id`. The session identifier is not separately persisted in browser storage or written to logs.

`is_current_runbook_session()` is used by row-level policies and protected RPCs. The account-management Edge Function checks the same active session and resolves the caller's role from `app_accounts`. A stale JWT cannot continue reading or changing RUNBOOK data after the database session expires or is replaced.

The fixed inactivity limit is five minutes. The migration sets the database setting to five minutes and constrains it so client settings cannot increase it. The browser checks status every 15 seconds and when it returns online or becomes visible. When the server reports inactivity expiry, the app shows **“You have been logged out due to inactivity.”**, releases the RUNBOOK session, and requests Supabase Auth global sign-out. No countdown is shown. Routine token refreshes only replace the token-bearing session state; they do not remount pages or clear form state.

The existing absolute session lifetime remains editable by Admins in Settings. The default is 12 hours.

For provider-level expiry of Auth refresh sessions as well, configure **Supabase Dashboard → Authentication → Sessions → Inactivity timeout** to five minutes if that control is available for the project's plan. Supabase documents this provider setting as a paid-plan feature. RUNBOOK's database check remains the app data-access enforcement if that setting is unavailable.

## Images and real-time updates

Public dashboard and branding images use stable public object URLs. Private employee and account photos use one-hour signed URLs, refreshed before expiration and again when a browser returns online or after a long background period. Failed refreshes keep the prior URL in state while the app retries instead of replacing it with an empty value.

Workspace pages subscribe to their related tables or privacy-safe `realtime_sync_signals` and refetch data after changes/reconnects. Account mapping changes use the `app_accounts` signal so the account list can refresh without broadcasting account fields to ordinary users. RLS is enabled on all public tables; policies still determine which rows and events each role can read.

## Invitations and account deletion

Invitation email links return to `/setup-password`. That page only offers password setup when Supabase has restored a verified, active user session and RUNBOOK has validated that session against the database; the URL alone grants no workspace access. Expired or already-used links show a request-a-new-invitation message. Add the production and local setup-password URLs to Supabase's Auth redirect allow-list.

Deleting an account is permanent. It removes the Supabase Auth identity, its account mapping/profile and active session rows, plus an account-owned profile image. An employee record and work history are retained because employee records are independent of login accounts. The protected Super Admin cannot be deleted. Admins may delete User accounts; only the Super Admin may delete another Admin.

## Verification

- `npm run build` succeeds.
- `git diff --check` succeeds.
- Linked Supabase dry-run reports only migrations `202610190001` and `202610190002` pending.
- A read-only query confirmed RLS is enabled on all 36 current public tables.
- Source review confirms each data page subscribes to its tables/signals and cleans subscriptions up on unmount. A second-browser live-change test still needs to be performed after deployment.
- Hosted invitation delivery, expiry behavior, account deletion/cascade behavior, and browser inactivity sign-out need a live check after applying migrations and deploying the function/frontend.
