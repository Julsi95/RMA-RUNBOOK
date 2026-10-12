# RUNBOOK Project Handoff

**Updated:** 2026-10-04
**Repository:** `C:\Users\delat\Documents\Codex\2026-09-27\x20\outputs\starter-app`
**State:** Backend foundation is implemented on `supabase-backend`. Pre-backend baseline remains recoverable at Git tag `pre-backend-baseline`; see `docs/architecture-current-state.md` and `supabase/README.md`.

## Purpose and product direction

RUNBOOK is a SharePoint-inspired team operations app. Visitors should be able to view team information and results. Signed-in editors should be able to change permitted content. The user is building the admin/editing experience first, while keeping the main pages suitable for public viewing.

The frontend uses React, JavaScript, Tailwind CSS, React Router, and shadcn-style local UI. The approved hosting/database direction is Vercel + Supabase/PostgreSQL. Auth, migrations/seed, shared organization provider, all current module persistence integrations, and central History have been implemented in the branch. The hosted Supabase project is not configured or connected.

## Backend implementation status

- Added Supabase JS and environment-based client. Without credentials, existing local mock/browser behavior remains available.
- Added Auth/session provider, login/reset routes, editor guards for Dashboard Settings and KPI Scoring Settings, password update, and auth-aware navigation.
- Added Postgres migrations and seed, RLS and Storage policies, employee/profile visibility model, central 30-day event/recovery tables, employee soft-delete/restore, immutable KPI scoring-version structure, Dashboard drafts and published revisions.
- Added shared organization provider and backend repositories, with integrations for employee/profile management, Dashboard, App / Links, QA Parameters, Project coverage, Seat Plan, VL Credits, Inbound Call Time, Work Schedule, Monthly KPI, and History. Logical module saves use guarded RPCs and create central recovery snapshots.
- KPI settings create immutable versions; each KPI month pins the settings version on creation, and score edits append result revisions. The History page restores supported snapshot types; date-span work schedules retain their detailed page-specific preview/edit/restore/delete history.
- Migration `202610040010_kpi_restore_and_public_view.sql` makes KPI recovery restore newly added results as well as edits, keeps prior result revisions append-only with tombstones, and limits public reads to each employee's current result. The repository understands tombstones when reconstructing editor views.
- Migration `202610040011_private_profile_photos.sql` stores uploaded employee photos in the private bucket. Public profile reads expose a storage path only when visibility allows it, and Storage RLS gates signed URL creation.
- `npm run build` passes on 2026-10-04, with Vite's large bundle warning. No hosted migration, RLS, SMTP, or Storage integration test has happened.
- No external configuration changes have been made. Manual owner setup requirements are documented in `supabase/README.md`.

## Current architecture

- React SPA, Vite build, React Router 7 route table in `src/app/App.jsx`.
- Shared shell in `src/components/layout/` with sidebar, navbar, responsive content, theme handling.
- Feature pages live in `src/features/*`; `src/pages/` includes Dashboard, Settings, compatibility Projects page, and an unused Activity placeholder.
- With Supabase configured, feature pages use the stable `src/lib/backend-repositories.js` facade backed by per-domain services in `src/lib/backend/`. `src/lib/backend/shared.js` centralizes configuration checks, Supabase error propagation, and batched private-photo signed URLs. `src/app/organization-provider.jsx` owns roster UI state/fallback; persistence and mapping are in `src/lib/backend/organization.js`. History queries/restoration are in `src/lib/backend/history.js`. Without credentials, pre-existing local sample/browser behavior remains available as a development fallback.
- This is a Supabase browser-client architecture, not an Express API. Database constraints, RLS, and checked RPCs remain the validation/security boundary. HTTP controllers, middleware, and a separate response wrapper are intentionally not introduced; see [`supabase/README.md`](supabase/README.md) for the code-structure rationale.
- `.env.example` contains empty Supabase URL/key placeholders. The client is in `src/lib/supabase.js`; no hosted project credentials are present.
- Vercel SPA rewrite is configured in `vercel.json`.

## Routes and features

| Path | Feature | Current implementation/data | Existing editing |
| --- | --- | --- | --- |
| `/` | Dashboard | Published dashboard state + starter defaults; shared `DashboardContainer` renderer | View only |
| `/admin/dashboard` | Dashboard Settings | Published and draft dashboard JSON | Add/edit/delete/duplicate/reorder/resize containers, edit content/style, images, text overlays/layers, carousel; Preview, Save, Discard |
| `/organizational` | Organizational chart | Shared employee roster; 8 sample people | Add/edit/delete employee, role, manager, mentor, photo |
| `/seat-plan` | Seat plan | Dated plan assignments + shared roster | Add/remove seats, drag/click assign, swap, unassign, note/date |
| `/projects` | Project coverage | Project list, assignments, POC/trainers, shared roster | Add/edit/archive/delete projects; assignment/status CRUD |
| `/inbound-call-time` | Inbound call rotation | Month-keyed call schedule + shared roster | Add/edit/remove people/slots, swap assignments, call window and Manila/North American conversion |
| `/work-schedule` | Work schedule | Same month store as call scheduling plus date-range schedules/history | Monthly work hours, custom presets, date-span schedules, preview/edit/restore-to-cards/delete saved schedule entries |
| `/vl-credits` | VL credits | Month-keyed values + roster snapshots | Add/edit/delete monthly values; numeric values or status labels |
| `/app-links` | App / Links | Link cards grouped into sections | Add/edit/delete links and application labels |
| `/admin/qa-parameters` | QA Parameters | Criteria with TCR/TCP values | Add/edit/delete/reorder/search criteria; computed performance |
| `/agent-profiles` | Agent profiles | Profiles/custom-field definitions keyed by employee | Edit profile, birthday, hire date, personality, summary, custom fields; birthday upcoming/recent views and delete |
| `/kpi-qa` | Monthly KPI / QA | Synthetic monthly KPI records + roster | Month selection, per-person details, manual score entry, CSV/XLSX import/template, comparisons/rankings/charts |
| `/admin/kpi-scoring` | KPI scoring settings | Metric weights, manual/formula settings, evaluation bands | Edit and save scoring settings |
| `/settings` | Settings | Theme preference | System/light/dark choice |

History is routed at `/history` from the main navbar. `src/pages/ActivityPage.jsx` remains an unused placeholder.

## Current data sources and storage keys

These keys describe the pre-backend/local fallback only. When Supabase is configured, shared records are loaded from Postgres instead. Sample defaults are not migrated; `supabase/seed.sql` creates separate editable sample records.

| Data | Current source/key | Notes |
| --- | --- | --- |
| Employees/team roster | `starter-app-organization-members-v2` | Primary roster used across modules; sample 8 people. Photos may be data URLs. |
| Dashboard published state | `starter-app-dashboard-published-v1` | Full layout/content configuration read by live Dashboard. |
| Dashboard draft | `starter-app-dashboard-draft-v1` | Builder's unsaved edit state. |
| Seat plans | `starter-app-seat-plans-v1` | Per-date seat IDs, assignments, notes, leadership seats. |
| Project coverage | `starter-app-project-coverage-v1` | Project descriptions, active state, POC, trainers, employee assignment/status. |
| Call + monthly work schedule | `starter-app-inbound-schedule-v1` | Shared month-keyed object consumed by two separate pages. |
| Work schedule date spans | `starter-app-work-schedule-periods-v1` | Flexible date-range schedules. |
| Work schedule history | `starter-app-work-schedule-history-v1` | Page-specific preview/edit/restore/delete history; no cross-module actor audit. |
| VL credits | `starter-app-vl-credits-v1` | Month-keyed employee credit values and snapshots. |
| App links | `starter-app-app-links-v1` | Link records; favicon is fetched from target URL at runtime. |
| QA parameters | `starter-app-qa-parameters-v1` | Criteria and TCR/TCP settings; separate from Monthly KPI records. |
| Agent profiles | `starter-app-agent-profiles-v1` | Birthday, hire date, personality, summary and custom profile values. |
| Profile field definitions | `starter-app-agent-profile-fields-v1` | Editable custom fields for profiles. |
| Monthly KPI | `starter-app-monthly-kpi-v1` | Six months of synthetic demo records on fresh storage; contains values and score snapshots. |
| KPI settings | `starter-app-kpi-scoring-settings-v1` | Weights, scoring method/direction/anchors, evaluation bands. |
| Theme | `starter-app-theme` | System/light/dark preference. |
| Sidebar collapse | `starter-app-sidebar-collapsed` | UI preference. |

## Cross-page dependencies and current risks

The Organization roster is the source of employee identity/name/role/photo for Seat plan, Projects, Inbound call schedule, Work schedule, VL credits, Agent profiles, and Monthly KPI. Some feature records also keep name/role/photo snapshots for display. Most pages load the roster on mount; there is no centralized live data layer. Deleting an employee today can leave references or snapshots in other local records. Backend deletion therefore needs a transaction/soft-delete policy and a clear retention/recovery relationship.

Project records refer to employees by POC, trainer IDs, and assignment keys. Seat plans and schedules refer to roster member IDs. Profiles are keyed by member ID. KPI month entries are keyed by employee ID and keep historical display fields. These relationships must be mapped explicitly before persistence is designed.

The call-time and work-schedule pages have separate interfaces but intentionally share a monthly storage object. The work schedule additionally has date-range and page-local history keys. There is no centralized audit/history route.

KPI scoring settings are read by Monthly KPI scoring helpers. In the current implementation, a changed settings object can affect how past months are displayed/recomputed. This is a known historical consistency risk. The agreed backend plan is versioned scoring settings and immutable monthly saved results pinned to the settings version used at the time.

Dashboard image uploads are currently stored as base64 data URLs inside local storage. Browser storage capacity and file lifecycle are limitations. Dashboard preview and live Dashboard share the renderer; previous preview rendering fixes aimed to keep image backgrounds full-size with independent overlay text. The builder draft is separate from published state, and Save publishes the entire dashboard while Discard removes the draft.

Additional known limitations:

- No authentication or server authorization exists; current visibility is frontend navigation only.
- No centralized history, multi-user synchronization, server backup, or recovery exists.
- Browser-local records can be cleared or diverge across devices.
- `npm run build` has emitted a Vite warning that the main minified JavaScript chunk exceeds 500 kB; build still succeeds. `xlsx` is a likely contributor, but bundle composition should be measured before deciding whether to split it.
- QA Parameters is a separate criteria/TCR/TCP feature; it is not currently connected to call-level QA evaluations or Monthly KPI. Keep it distinct unless product requirements later define a relationship.

## Decisions agreed for backend planning

1. Use Supabase with PostgreSQL and deploy the SPA through Vercel.
2. Public visitors can view regular app pages and results. Editing/settings links and CRUD controls are available only to authenticated users. Specifically, Dashboard Settings (`/admin/dashboard`) and KPI Scoring Settings (`/admin/kpi-scoring`) are hidden in the sidebar when signed out; backend authorization must still protect every write.
3. Start with one owner/admin account. Use email as the login identifier. Allow password change from Settings. Forgot password uses a secure email reset link; the app must never retrieve or email a current password.
4. Employee records are independent of login accounts. A login account may optionally link to an employee.
5. Employee deletion should be recoverable for approximately 30 days, including associated records where possible. Preferred design: soft-delete/tombstone the employee, preserve dependent records and assets during the retention period, restore related state coherently, then purge after retention. Avoid cascading hard deletion at initial delete.
6. Create a centralized History page/system for important changes, recording actor, timestamp, affected page/record, and change summary/state. Keep recoverable history for about 30 days. Not every event needs restore.
7. Supabase Storage holds uploaded images/files; PostgreSQL stores file paths/metadata and relationships, not file bytes.
8. Dashboard Builder's saved state is persistent. Editing stays in an isolated draft; Save writes one complete layout revision, Discard leaves published state intact. Drag/resize movements do not each write to the backend.
9. Create useful seed/sample database rows. Do not migrate current browser mock data as production data.
10. Monthly KPI results stay historically consistent when scoring settings change. Use immutable/versioned rule sets and link each saved month/result to its rule version and stored computed values. Any deliberate rescore should create a new revision while retaining the prior one.
11. The current frontend is the behavior baseline for audit. Do not redesign/refactor during the audit; architectural improvements are recommendations until approved.
12. Keep QA Parameters as an independent criteria/configuration feature; do not connect it to Monthly KPI or call reviews without a later requirement.
13. Add an editor-only per-profile visibility control in Agent Profiles. Editors choose which profile fields public visitors can see. Hidden values must be excluded from public database reads, not merely hidden in the UI; editors can still see/edit all values. Recommended defaults: name, role, and profile photo visible; birthday, hire date, personality, summary, and custom fields hidden until enabled by an editor.
14. Keep detailed schedule snapshots/history in Work Schedule for preview/edit/restore/delete. Important schedule changes also create central History events linked to the relevant schedule revision; do not duplicate the full schedule payload in two history systems.

## Implemented architecture and setup

See [`docs/architecture-current-state.md`](docs/architecture-current-state.md) for the pre-backend page/data audit and implemented data relationships. SQL lives in `supabase/migrations/` and seed data in `supabase/seed.sql`. Migrations have not been applied to a project.

## Manual setup required before connecting a real project

- Follow the Supabase project, environment, Auth, migration/seed, owner-account promotion, and retention-job steps in [`supabase/README.md`](supabase/README.md). Do not share the service-role key or database password in chat or expose them in `VITE_*` values.
- No Supabase or Vercel account/configuration has been changed. The owner must create the project, configure the URL and publishable key locally and in Vercel, configure Auth redirect URLs/SMTP, apply migrations in order, run seed, create the owner account, promote that account to editor, and schedule cleanup.
- Once connected, validate migrations on Postgres, public reads vs editor writes, recovery flows, Storage policies, password reset email, and SPA routes. The current local production build passes but cannot validate hosted RLS/Auth behavior.
- All eleven migrations and `seed.sql` now apply in an isolated PGlite/Postgres-WASM harness with stubbed Supabase `auth` and `storage` schemas. The harness confirms seed records, sanitized anonymous employee reads, private-photo Storage RLS, public dashboard/KPI reads, viewer write denial, editor checked RPCs, and KPI recovery including tombstones for imported additions. PGlite is not a Supabase deployment: hosted Postgres 17, PostgREST schema exposure, Supabase Auth/session behavior, Storage signed-URL issuance, and Vercel routing still need validation after manual project setup. No Supabase CLI, `psql`, or Docker is installed in this workspace.
- The local migration run caught and fixed the missing `employee_photo_snapshot` column by adding it to the base schema and an idempotent guard in migration 003.
- Detached/replaced profile images stay in private Storage so 30-day recovery can restore their paths. Database retention does not yet remove orphaned Storage objects; coordinate that with a trusted cleanup job before enabling long-term automatic file purges.
- Central History restores supported snapshots, while unsupported snapshot types currently point editors to the owning page. Storage object cleanup should be coordinated with record retention before enabling automated purges.

## Latest implementation status (2026-10-13)

The preceding setup notes are historical. The user has already linked and configured the Supabase project, applied migrations `202610040001` through `202610040011`, seeded the project, and confirmed sign-in. Do not repeat the initial setup/seed without checking migration state first.

- New migrations `202610130001_roles_auth_realtime_and_audit_fix.sql` and `202610130002_work_schedule_and_vl_validity.sql` are implemented locally and still need `db:dry-run`/`db:push` against the linked project.
- The access model is public, read-only workspace viewing; signed-in Users can update their own account profile; Admins can edit workspace data and view/restore History. RLS/RPCs protect database writes. Dashboard Settings and KPI scoring settings remain Admin-only routes/nav links.
- Admin account invitations and access management use `supabase/functions/manage-account/index.ts`; deploy it with `npx supabase functions deploy manage-account` after migrations. Supabase Auth email delivery and production/preview redirect URLs must be verified manually.
- Added account profile self-service (display name, summary, email, password, static/GIF photo), admin role management, and realtime refresh subscriptions for shared page data.
- Fixed the generic deletion audit trigger so it only reads employee `purge_after` when deleting an employee. Added schedule duplicate/weekday validation and effective-date VL records with overlap/value checks and recoverable delete/restore.
- Public read grants were retained for approved pages; account profiles, unpublished Dashboard drafts, History, and recovery data remain private.
- Verified the current migration sequence plus seed in an isolated PGlite harness, covering public reads/private data denial, User profile-only permissions, Admin writes, audit deletion, schedule checks, VL ranges, and History restore. `npm run build` succeeds. Vite still reports a large main JS chunk warning.
- No new migration was pushed and no external configuration was changed in this turn. Hosted Supabase Auth/email, Edge Function, Storage, RLS and Vercel checks remain outstanding.
- Current manual next step: `npm run db:status`, `npm run db:dry-run`, then `npm run db:push`; deploy `manage-account`; configure/verify Auth email delivery and Vercel redirect allowlists; then run the hosted smoke checks in [`docs/auth-and-deployment.md`](docs/auth-and-deployment.md).
