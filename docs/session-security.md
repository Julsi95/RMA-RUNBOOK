# RUNBOOK session security

## Current behavior

RUNBOOK uses Supabase Auth for credentials and refresh-token handling. A signed-in account also has one active RUNBOOK device session, tracked by the `runbook_active_sessions` table and the Supabase JWT `session_id` claim. The session ID is never stored in browser storage separately or written to logs.

`claim_runbook_session` serializes claims per user with a PostgreSQL advisory lock. It compares the Auth session creation time with the active record, so an older restored session cannot replace a later sign-in. A replacement updates a private Realtime signal row; the previous browser receives the change and signs out locally. Session signals expose no session ID or token.

Every existing authenticated, anonymous, or public RLS policy on application and Storage tables is additionally checked against the active RUNBOOK session. Session-aware helper RPCs and the account-management Edge Function apply the same check. Therefore an old JWT may still exist until Supabase Auth refresh/revocation catches up, but it cannot use RUNBOOK-protected table, Storage, or account-management operations after replacement or timeout.

## Timeout defaults and controls

Defaults are 30 minutes of inactivity, 12 hours absolute lifetime, and a warning 2 minutes before the next deadline. An administrator can change these values in **Settings → Session security**:

- Inactivity: 5–720 minutes
- Absolute lifetime: 1–168 hours
- Warning: 1–15 minutes

User activity extends only the inactivity deadline. The absolute deadline cannot be extended; the user must sign in again. A network failure does not immediately clear a session. The client retries checks on a 15-second cadence and when the browser returns online or to the foreground.

The app warns before expiry and retains the requested page path through reauthentication. Existing forms do not have a universal draft store, so client-only unsaved values may be lost after forced sign-out; save before the countdown reaches zero.

Routine checks do not remount the application shell. Auth initialization uses Supabase's `INITIAL_SESSION` event once; a separate competing `getSession()` initialization was removed. Focus and visibility changes no longer trigger validation; the session status is polled periodically and checked again when connectivity returns. Overlapping status calls for the same Auth session share one in-flight request.

Settings loads account records from the `manage-account` Edge Function, which reads persistent Supabase Auth users and `app_accounts` mappings. It refreshes that list on entry and Realtime changes. The protected Super Admin account is intentionally excluded from the editable account list.

The account list now has independent loading/error/retry state and ignores out-of-order responses. Invitation success is reported and the form is cleared immediately after the server accepts the invite; the account-directory refresh runs separately so a slow list request cannot leave the invite action disabled or imply the invitation failed. Failed invite submissions keep their field values available for correction/retry. Settings form synchronization uses primitive profile values instead of whole token/user objects.

## Supabase setting to enable manually

If the Supabase plan exposes **Authentication → Sessions → Single session per user**, enable it as an additional Auth-provider safeguard. Supabase documents that this setting is available on paid plans and enforces on refresh; an access JWT can remain valid until expiration. RUNBOOK's RLS session guard is the immediate data-access enforcement layer, while the provider option also limits Auth refreshes.

No extra database setup is needed beyond applying the migration. The migration adds the session tables/functions, RLS conditions, and Realtime publication entry for `runbook_session_signals`.

## Testing performed

- `npm run build` succeeds.
- Migration `202610130009_session_timeout_and_single_device.sql` is applied to the linked Supabase project.
- Remote catalog query confirms both session tables exist, the Realtime signal is published, and all applicable public/storage RLS conditions include the current-session guard (zero missing conditions).
- The updated `manage-account` Edge Function is deployed and active.
- Local browser check confirms the RUNBOOK login route renders and unauthenticated access to `/` returns to `/login`.

Manual verification still required: sign in on two separate browsers, confirm the first browser is signed out and cannot query protected data, then verify inactivity warning/extension, absolute expiration, logout, and connectivity recovery. Test with a non-admin and admin account. Avoid using two tabs in one browser as the only single-device test; Supabase Auth may share the same session across tabs.
