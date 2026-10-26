# RUNBOOK Supabase setup

This folder contains the reviewed backend foundation. The application uses the local mock/browser-storage behavior until public Supabase URL and publishable key are configured. No remote project, account, or external settings have been changed by this repository work.

## Backend code structure

This project uses Supabase directly from the React application; it does not run an Express/Node API server. Database security and validation therefore live in PostgreSQL constraints, RLS policies, and checked RPC functions. The browser services keep domain logic out of pages and preserve Supabase errors for the UI to handle. HTTP controllers, middleware, and a second response-envelope format would not apply to this architecture.

- `src/lib/backend-repositories.js` is the stable export facade used by existing feature pages.
- `src/lib/backend/` contains domain services for Dashboard, History, KPI, links/QA, organization, project coverage, schedules, Seat Plan, and VL Credits.
- `src/lib/backend/shared.js` centralizes Supabase configuration checks, shared error propagation, and batched signed URLs for private profile photos.
- `src/lib/supabase.js` owns the browser Supabase client and session options.
- `src/app/organization-provider.jsx` owns roster UI state and local mock fallback; database mapping, employee/profile persistence, and Storage operations live in `src/lib/backend/organization.js`.

The services retain the current UI-facing data shapes. Private photo URLs are requested in one Storage call per roster/month load instead of one request per photo. Database RLS and RPC checks remain the authoritative write/security boundary; client permission checks only shape the UI and provide quicker feedback.

## WFH Privileges and holiday calendar

- `src/features/wfh-privileges/` contains the WFH page, focused balance/request/approval/history components, UI validation helpers, and service hooks. Awarding, expiry, approval, earliest-expiring allocation, cancellation refunds, and immutable audit writes execute in database RPCs in `202610210001_wfh_privileges_and_holiday_calendar.sql`.
- WFH records are readable only by the employee, their nearest responsible TL/STL, or an administrator, with the current RUNBOOK session required. Direct client writes are revoked. Concurrent approvals serialize per employee and a unique partial index protects each employee/date from duplicate consumption.
- `src/features/holidays/` contains the shared US/PH calendar/list and editor. `sync-holidays` uses Nager.Date; it checks for stale data on a signed-in calendar visit, with a 24-hour server-side throttle. Admins can force a sync. Holiday working-status and name overrides survive provider updates; soft-deleted API rows stay deleted.
- The migration schedules daily WFH expiry notices through `pg_cron` at 09:00 Asia/Manila. Notifications use the existing `user_notifications` unique `(recipient_id,event_key)` guard. The project must have `pg_cron` available; the migration enables the extension.
- After pushing this migration, deploy the trusted holiday function with `npx supabase functions deploy sync-holidays`. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions; never copy the service-role secret into Vercel or `VITE_*` values.
- Run frontend unit tests with `npm test`. Database contract tests are in `supabase/tests/wfh_holiday_security.test.sql` and run with `npx supabase test db` when the local Supabase stack and Docker are available.

## Manual project setup required

1. Create a Supabase project in the account you control and choose a strong database password. Keep the database password and service-role key private; neither belongs in the frontend.
2. In the project API settings, copy the project URL and publishable key (or legacy anon key) into a local `.env.local` file:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
   ```

   Add the same two public values to the Vercel project's Production, Preview, and Development environment variables when ready to deploy.
3. In Supabase Auth settings, set the Site URL to the deployed Vercel URL and add that URL plus `http://localhost:5173/**` to the redirect allow-list. Keep public sign-ups off; accounts should be invited/created by an administrator.
4. To deliver Auth email through SendLiberty, first add these Edge Function secrets in Supabase Dashboard → Edge Functions → Secrets: `SENDLIBERTY_API_KEY`, `SENDLIBERTY_FROM_EMAIL` (the connected Gmail sender), and `SEND_EMAIL_HOOK_SECRET` (generated in Auth → Hooks when creating the Send Email Hook). Restrict the SendLiberty API key to that sender if its dashboard offers the restriction. Optionally set `RUNBOOK_APP_URL` to the production app URL and `RUNBOOK_ALLOWED_ORIGINS` to comma-separated approved app origins.

   Deploy the function, then configure Auth → Hooks → Send Email to call `https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-email`:

   ```powershell
   npx supabase functions deploy send-email --no-verify-jwt
   ```

   The function verifies Supabase's signed hook request itself. Do not enable the hook until the SendLiberty and hook secrets are set. Invitation emails contain a one-time code and a plain link to `/accept-invite`; the code is verified as an `invite` OTP before password setup. This avoids putting a consumable invitation token in the link that corporate scanners may visit. Recovery and email-change events retain Supabase verification links. The Send Email Hook replaces built-in delivery for all Auth emails, so test invite, resend, password recovery, and email-change flows after enabling it. Supabase's built-in sender is limited to project team addresses and two emails per hour; configure this hook or a mail provider before inviting external users.
5. Apply the versioned SQL files through the Supabase CLI. The CLI is pinned as a project dev dependency; authenticate and link the project once, then preview before applying:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npm run db:status
   npm run db:dry-run
   npm run db:push -- --include-seed
   npm run db:status
   ```

   `supabase link` prompts for the database password. Enter it in the terminal only; do not put it in `.env.local`, the repository, or chat. `db:dry-run` should list the eleven migrations before the first push. `--include-seed` is for this new, empty project and applies the editable sample records once; omit it on later pushes. The seed intentionally does not import browser storage.
6. Create the initial owner login in Supabase Auth. After the account row is created by the auth trigger, grant that one account edit access in the SQL Editor by matching its verified email to the auth UUID:

   ```sql
   update public.app_accounts a
   set can_edit = true, display_name = 'RUNBOOK owner'
   from auth.users u
   where a.user_id = u.id and lower(u.email) = lower('YOUR_LOGIN_EMAIL');
   ```

   Confirm exactly one row was updated. The app does not contain a default account or password. The owner can change their password in Settings; password recovery uses Supabase Auth email delivery.

7. After confirming the `pg_cron` extension is available for your Supabase plan, schedule daily retention cleanup from the SQL Editor as the database owner:

   ```sql
   select cron.schedule(
     'runbook-retention-daily',
     '17 3 * * *',
     $$select public.purge_expired_history();$$
   );
   ```

   If that extension is unavailable, configure an equivalent trusted server-side scheduled job. Do not call this cleanup function from a browser or expose it to public roles.

## Current behavior and security

- Anonymous visitors and signed-in viewers can read the public pages. Employee reads use a safe directory RPC that omits hidden profile values/photos; VL reads use a safe RPC so a private employee photo is not exposed through a monthly snapshot. Uploaded employee photos are stored in the private bucket. Public profiles receive five-minute signed URLs under a Storage read policy that checks the employee's visibility flag; hidden profile photos cannot request a new URL. Existing signed URLs can remain valid until their short expiry.
- Database-backed writes require `app_accounts.can_edit` through row-level security and checked RPCs. Organization, Dashboard, KPI, App / Links, QA Parameters, employee profiles, Seat Plan, VL Credits, Project Coverage, Inbound Call Time, and Work Schedule have Supabase integrations. When Supabase is not configured, the existing browser-backed prototype remains available.
- Employee records are separate from login accounts. Employee removal is soft deletion for 30 days; related employee-keyed records remain associated and become visible again on restore.
- Dashboard edits are saved as an account-owned draft. The publish action creates an immutable revision and switches the public pointer. Anonymous and authenticated dashboard readers only see the published revision; draft image objects cannot be enumerated through anonymous Storage table reads.
- KPI scoring settings use immutable versions, and each monthly KPI record references its scoring version so later settings changes do not silently rescore past months.
- History events and recoverable snapshots are database-backed and expire after 30 days. The central timeline restores supported database snapshots; schedule revisions remain managed through the Work Schedule page, and other unsupported snapshot types direct editors to their owning page. Automated cleanup scheduling still needs a hosted-project operational setup; do not expose cleanup execution to anonymous users.
- Uploaded dashboard images use `runbook-public`; uploaded employee photos use `runbook-private` so profile visibility is enforced by Storage as well as the directory API. Other private assets can use that bucket with editor-only reads. Old unreferenced profile files are retained for recovery; configure a trusted cleanup job before expecting unused Storage objects to be purged with database history.

## Local validation limits

The production frontend build passes without credentials. All eleven migrations and the seed also apply in an isolated PGlite/Postgres-WASM harness with stubbed Supabase Auth/Storage schemas; representative public/viewer/editor RLS and restore flows pass there. This does not validate Supabase's hosted Postgres/PostgREST/Auth/Storage behavior. Hosted RLS, short-lived signed photo URLs, Auth email delivery, and Vercel redirects still require a project that the owner configures manually. Never put a service-role key in `VITE_*` variables or client code.
