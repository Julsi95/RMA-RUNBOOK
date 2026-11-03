# RUNBOOK Project Handoff

- **Updated:** 2026-11-01 (Asia/Singapore)
- **Repository:** `C:\Users\delat\Documents\Codex\2026-09-27\x20\outputs\starter-app`
- **Branch:** `perf/in-memory-query-cache`
- **HEAD:** `29ba1db` — `Show revoked WFH dates in rewards history`
- **GitHub state:** local branch matches `origin/perf/in-memory-query-cache`.
- **Supabase project:** `vqojvzjrfjwvxvdubsla` (`ap-south-1`).

> Work in the repository path above. The current Codex launch directory `C:\Users\delat\OneDrive\Documents\ChatGPT\RUNBOOK` is only a small placeholder checkout; it is not the complete application repository.

## Product and current state

RUNBOOK is a React operations workspace hosted on Vercel, backed by Supabase Auth, PostgreSQL/RLS, Storage, Realtime, and Edge Functions. It includes public workspace pages plus authenticated user, admin, and protected Super Admin experiences. Avoid replacing existing module architecture or weakening server/database authorization.

The local branch includes the accumulated feature work through November 1: Supabase persistence and RLS, public workspace, auth/session protections, admin/account management, dashboard editor, roster/org chart, schedules, KPI import/history, WFH privileges, holidays, diagnostics, and transactional WFH email notifications. The most recent WFH UI fix now renders individual admin-revoked dates in the user and admin “Revoked rewards” list. These dates are audit events; they do not mark the whole reward as revoked because eligible credits can be returned.

### Current source and verification state

- Latest commit is present on the tracked GitHub branch (`29ba1db`); local and remote branch tips match.
- `npx supabase migration list --project-ref vqojvzjrfjwvxvdubsla` confirmed all local migrations through `202611010014` are applied remotely.
- Supabase Function inventory reports these deployed functions as `ACTIVE`: `manage-account`, `sync-holidays`, `send-email`, and `send-wfh-email`. `send-email` and `send-wfh-email` have JWT verification disabled because they use their respective signed-hook/custom-secret validation. Do not merge their responsibilities or secrets.
- `npm run build` passes (latest build emitted the existing large-main-bundle warning). `git diff --check` passed for the latest code change.
- Current uncommitted UI work groups sidebar links into Workspace, Operations, Performance, and Administration; hides the sidebar scrollbar while keeping its list scrollable; applies shared shell spacing/type polish; adds customer-representative totals to the Organization overview card; applies a subtle shared scrollbar style across scrollable page/component regions; and gives the KPI historical score matrix year filtering, person search, pagination, a fixed-height scrolling viewport, sticky row/column headers, and identity grouping to avoid duplicate people across KPI views when names match unambiguously. KPI import matching now checks stable roster IDs and uniquely matching abbreviated names. KPI records remain unchanged in storage. The existing Leadership Hierarchy counts remain. The time-zone API/conversion files were reviewed and left unchanged.
- The only pre-existing local modifications observed before updating this handoff were `supabase/.temp/cli-latest` and `supabase/.temp/storage-migration`. Do not stage or commit these CLI state files.
- Production Vercel deployment status and actual email delivery were not checked in this handoff update. Supabase CLI cannot reveal secret values, so secret configuration still needs owner verification.

## Stack and conventions

- React 19, JavaScript/JSX, Vite, Tailwind CSS 4, React Router 7, Radix UI primitives, Lucide icons, Recharts, React Grid Layout, and Supabase JS.
- `src/app/App.jsx` declares routes. `src/components/layout/` owns the application shell/navigation.
- Feature code lives in `src/features/<domain>/`; use each domain’s service and hook rather than adding duplicate clients. `src/lib/supabase.js` creates the browser Supabase client; `src/lib/backend/` contains domain repositories/shared helpers and query caching.
- Database schema/security/business rules live in ordered `supabase/migrations/`; seed data is in `supabase/seed.sql`. Supabase Edge Functions are under `supabase/functions/`.
- Browser code uses the publishable key only. Never put service-role keys, SMTP/provider credentials, or dispatcher secrets in `VITE_*` variables or frontend logs.

## Routes and access surfaces

Public workspace shell (`AppShell publicWorkspace`):

- `/` — published dashboard
- `/organizational` — organization chart and reporting graph
- `/agent-profiles` — public-safe profiles and visibility-filtered data
- `/app-links` — public app links
- `/holidays` — public holiday calendar

Auth routes: `/login`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/setup-password`.

Authenticated app routes include Seat Plan, Project Coverage, Inbound Call Time, Work Schedule, WFH Privileges, VL Credits, QA Parameters, Monthly KPI/QA, notifications, settings, and profile. Admin/editor guards protect Dashboard Settings, KPI scoring settings, and History. Role and RLS checks must remain authoritative on the server/database; client route guards only shape navigation and UI.

The account model includes User, Admin, and protected Super Admin distinctions. Super Admin controls are intentionally restricted and should not be exposed to ordinary admins. The account-management Edge Function owns privileged Auth user operations; do not put service-role operations in the browser.

## Feature overview and important data behavior

- **Dashboard:** published content is public; authenticated admin edits drafts and publishes revisions. The editor supports draggable/resizable containers, text/image content, and preview. Published dashboard content is read from the database; images use Supabase Storage paths/URLs.
- **Organization:** employee roster and multi-manager reporting graph. Campaign Specialists and Senior Agents can participate in shared manager structures; reporting connectors are calculated by graph/layout code. Roster is shared across other modules. Employee deletion is a protected/confirmed server action with recoverable soft-delete behavior where applicable.
- **Scheduling/operations:** Seat Plan, Project Coverage, Inbound Call Time, Work Schedule, and VL Credits are separate features backed by Supabase data/services. Seat plans support month/date planning; inbound lanes are draggable and display adjusted time zones.
- **Monthly KPI/QA:** spreadsheet/CSV import reads uploaded content for review; monthly source-of-truth results and historical rows/ranks are persisted, including former roster members. Uploaded source files are not intended to be permanently stored. Charts and historical score matrix are part of the feature.
- **WFH Privileges:** admin awards, employee requests, TL/STL and Super Admin approvals, adjusted dates, cancellations, revocations with eligible refund semantics, separate point removal, audit history, and email outbox. Whole-reward revocation (`revoked_at`) differs from revoking an approved date (allocation status + audit row); both now appear in relevant revoked history views. Realtime table subscriptions refresh WFH data.
- **Holiday Calendar:** US/PH holidays, sync Edge Function, manual editing, and admin working/non-working overrides. Public page is read-only.
- **Notifications and history:** database notifications and central admin history are separate. History supports retention and selected recovery paths; preserve audit records unless the owner approves a specific retention change.
- **Backend request diagnostics:** the shared weekly report is an aggregate row, not a log row per request. It stores counts by page/category, failed count, slowest duration, and last activity; individual request payloads are not persisted. Admin-only read RPC/permissions apply.
- **Images:** employee/account photos are private and visibility-gated; public profiles use safe directory data and signed photo URLs. Dashboard public assets are handled separately. Do not expose private object paths/signing privileges to public users.

## Authentication, sessions, and email

- Supabase Auth owns access/refresh tokens; protected Postgres reads/writes also validate RUNBOOK's active session. Latest migration `202610230001_session_inactivity_thirty_minutes.sql` sets the database-enforced inactivity timeout to **30 minutes** (it supersedes the earlier five-minute policy migration). The browser should not remount pages or clear in-progress form state during normal refresh/tab changes.
- Invitation setup uses the dedicated `/accept-invite` and `/setup-password` routes and a verified Supabase session; a URL alone never grants access. Preserve configured redirect allowlists.
- Existing `send-email` is the Supabase Auth Send Email Hook. It verifies Supabase's signed hook payload and sends via SendLiberty. Its endpoint, hook authorization secret, and provider secrets must not be repurposed for WFH.
- `send-wfh-email` is a separate scheduled outbox dispatcher. Migration `202611010014_wfh_email_outbox.sql` adds an RLS-protected outbox, service-only claim RPC, audit enqueue trigger, and one-minute cron job. The deployed Edge Function uses `WFH_EMAIL_DISPATCH_SECRET`, and reuses server-side `SENDLIBERTY_API_KEY` and `SENDLIBERTY_FROM_EMAIL`.
- The function is deployed and migration is applied, but confirm the following Supabase Vault secrets exist and match the Edge Function secret before expecting scheduled delivery:
  - `wfh_email_dispatch_url` = `https://vqojvzjrfjwvxvdubsla.supabase.co`
  - `wfh_email_dispatch_key` = the exact value of `WFH_EMAIL_DISPATCH_SECRET`
- Then test with accounts you control: award, request (check the actual approvers), approve/adjust, reject, cancel/revoke, and point removal. Check Edge Function logs and SendLiberty delivery if a message is missing. Do not paste secrets in chat.

## Database, RLS, and migrations

The local/remote migration sequence currently ends at `202611010014_wfh_email_outbox.sql`; the last `supabase migration list` showed every local migration applied remotely. Important schema areas include `app_accounts`, employees/profiles, dashboard drafts/publications, KPI scoring/results/history, schedules, WFH rewards/requests/allocations/audit, holiday calendar, notifications, history, and weekly backend metrics.

RLS and checked RPCs are the access boundary. Reuse established `is_current_runbook_session()`, role checks, and domain authorization helpers. Use `SECURITY DEFINER` functions with an empty/fixed `search_path`, explicit grants/revokes, input validation, and atomic operations for privileged writes. Inspect existing policies and function signatures before changing schema. Never run a destructive data reset unless the user explicitly asks and the target/data impact is stated.

Typical commands from the full repository:

```powershell
npm run build
npm test
npx supabase migration list --project-ref vqojvzjrfjwvxvdubsla
npx supabase db push --dry-run --project-ref vqojvzjrfjwvxvdubsla
```

Only run `db push` when an actual pending migration is intended. Deploy a specific Edge Function by name; avoid redeploying or altering the Auth hook while changing another function.

## Current handoff: next steps

1. Check Supabase Vault has the two WFH dispatcher secrets above and that `WFH_EMAIL_DISPATCH_SECRET` matches `wfh_email_dispatch_key`. Values cannot be checked through the CLI listing.
2. Run controlled end-to-end WFH email tests and confirm delivery, retry behavior, and actual recipients. The dispatcher processes a small sequential batch and retries transient errors.
3. Verify the latest public Vercel deployment is on the desired branch/commit. It was not inspected here.
4. Keep the large bundle warning on the backlog; don’t make broad refactors as part of a focused bug fix.
5. Preserve current changes in source. Leave the two Supabase `.temp` files unstaged.

## Git workflow

The working branch is `perf/in-memory-query-cache` and was up to date with origin at `29ba1db` before this handoff edit. Check `git status` before staging. Stage only intended files; the user prefers Git steps whenever code changes are made.

```powershell
git add HANDOFF.md
git commit -m "Update RUNBOOK project handoff"
git push origin perf/in-memory-query-cache
```
