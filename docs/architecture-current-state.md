# RUNBOOK: Current State Audit and Backend Proposal

**Audit date:** 2026-10-04
**Status:** Audit and architecture approved; backend implementation is in progress on branch `supabase-backend`. The audit sections below describe the pre-backend frontend baseline; the implementation status at the end of this document records current changes.

## 1. Purpose and scope

RUNBOOK is a SharePoint-inspired operations workspace for a customer-support team. Every workspace page and its database data require a signed-in Supabase account. Authenticated Users can view workspace data and manage their own account profile; Admins can change content and data. The intended deployment is Vercel, with Supabase/PostgreSQL for persistence, Supabase Auth for access, and Supabase Storage for uploaded files.

This document distinguishes:

- **Current implementation:** what the app does today, using sample defaults and browser `localStorage`.
- **Current access decision:** All workspace pages require sign-in. Authenticated Users have read-only workspace access; Admins can edit. Dashboard Settings, KPI scoring settings, and History also require Admin. Central 30-day History/recovery and saved Dashboard revisions remain in place.

The mock/browser data is not a production migration source. Backend setup should create seed/sample records that behave like ordinary records.

## 2. Current technical architecture

| Concern | Current state |
| --- | --- |
| UI | React 19, JavaScript/JSX, Tailwind CSS 4, local shadcn-style components |
| Routing | React Router 7 in `src/app/App.jsx` |
| Bundler/dev server | Vite 7 |
| Theme | `src/app/theme-provider.jsx`; browser preference in local storage |
| Shared shell | `src/components/layout/AppShell.jsx`, `Sidebar.jsx`, `Navbar.jsx` |
| UI primitives | `src/components/ui/Button.jsx`, `Select.jsx`; Radix Select |
| Shared data layer | None; each feature reads/writes local storage directly or via feature helpers |
| Backend/network | None; no Supabase client, server API, migrations, RLS policies, or storage buckets |
| Environment | `.env.example` has empty Supabase URL/key placeholders only |
| Deployment routing | `vercel.json` rewrites SPA routes to the app entry point |
| File storage | Data URLs/local storage for uploaded profile/dashboard images; URLs for remote assets |

`package.json` dependencies include React, React DOM, React Router, Vite/plugin-react, Tailwind/Vite, Radix Select, lucide-react, `class-variance-authority`, `clsx`, `tailwind-merge`, and `xlsx` for KPI CSV/XLSX parsing.

## 3. Route-by-route current-state audit

| Route/page | Purpose and components | Current data source and CRUD | Data relationships / persistence candidate |
| --- | --- | --- | --- |
| `/` Dashboard | `src/pages/DashboardPage.jsx`; shared `src/features/dashboard/DashboardContainer.jsx` renders content | Reads published dashboard JSON (`starter-app-dashboard-published-v1`), or built-in defaults. View only. | Persist published layout/content and revisions. Image refs should point to Storage. |
| `/admin/dashboard` Dashboard Settings | `src/features/dashboard/DashboardSettingsPage.jsx`, `dashboard-data.js`, shared `DashboardContainer.jsx` | Draft (`starter-app-dashboard-draft-v1`) is separate from published key. Add/edit/delete/duplicate/move/resize containers; style/content, image, overlay text layers, links, carousel, gap/padding. Preview, Save, Discard. | Persist drafts separately from published revisions. Save whole dashboard as one logical change/revision; do not write each resize movement. |
| `/organizational` Organization | `OrganizationPage.jsx`, `OrgBranch.jsx`, `OrgMemberDialog.jsx`, `organization-data.js` | `starter-app-organization-members-v2`; sample 8 employees. Add/edit/delete people, role, manager, optional mentor, photo. | Central employee directory. Referenced by nearly every roster-dependent page. Deletion affects related records and assets. |
| `/seat-plan` Seat plan | `src/features/seating/SeatPlanPage.jsx` | `starter-app-seat-plans-v1`; reads employee roster key directly. Per-date plan/note, seat IDs, assignments, leadership seat IDs. Add/remove seats, drag/click assignment, swap/unassign. | Seat plans reference employee IDs. Preserve assignment history/restore policy if employee is deleted. |
| `/projects` Project coverage | `src/pages/ProjectsPage.jsx` compatibility wrapper; `src/features/projects/ProjectCoveragePage.jsx`, `project-data.js` | `starter-app-project-coverage-v1`; starter projects; CRUD project information and member assignment statuses; POC and trainer management. | Projects reference employees through POC, trainer IDs, and assignment keys. Some sample project data may include inactive/archived records. |
| `/inbound-call-time` Inbound call time | `src/features/inbound/InboundSchedulePage.jsx` | `starter-app-inbound-schedule-v1`; month-keyed call window and call slot assignments. Add/edit/remove slots/person; selecting occupied person swaps. Manila time and North American time preview based on selected dates/time zone/DST. | Assignments reference roster employees. Shares monthly object with work schedule page, but remains a separate user workflow. |
| `/work-schedule` Work schedule | `src/features/inbound/WorkSchedulePage.jsx` | Same `starter-app-inbound-schedule-v1`, plus `starter-app-work-schedule-periods-v1` for flexible date spans and `starter-app-work-schedule-history-v1` for preview/edit/restore-to-cards/delete history. Work hours can be 9–6, 10–7, or custom. | References same employee roster. History is local/page-specific and has no actor identity or centralized audit. |
| `/vl-credits` VL Credits | `src/features/vl/VlCreditsPage.jsx` | `starter-app-vl-credits-v1`; month-keyed employee credit values, updated date, role/photo/name snapshots. Add/edit/delete; value can be numeric or status such as probationary. No finalized computation formula. | Employee identity should reference central employee record; preserve month-specific value snapshots as required. |
| `/app-links` App / Links | `src/features/links/AppLinksPage.jsx` | `starter-app-app-links-v1`; grouped link cards with URL, application, description. Add/edit/delete; favicon can be fetched from target URL. | Persist links and group/order metadata. External favicon fetch is presentation behavior, not core record data. |
| `/admin/qa-parameters` QA Parameters | `src/features/qa/QaParametersPage.jsx` | `starter-app-qa-parameters-v1`; sample criteria with TCR/TCP values. Add/edit/delete/reorder/search; calculates displayed performance. | Keep it independent from Monthly KPI and call reviews, as confirmed after audit. |
| `/agent-profiles` Agent profiles | `src/features/agents/AgentProfilesPage.jsx` | `starter-app-agent-profiles-v1`, `starter-app-agent-profile-fields-v1`; profiles keyed by employee ID, birthdays, hire dates, personality, summary, custom fields. Upcoming and recent-ended birthday views. | Profile extends employee record; profile photo is currently on roster. Birthday/hire date and custom fields should be persistent and reference employee. |
| `/kpi-qa` Monthly KPI / QA | `src/features/kpi/KpiQaPage.jsx`, `kpi-data.js`, `import-utils.js` | `starter-app-monthly-kpi-v1`; six months of synthetic sample data on fresh storage. Month selection, per-person results, manual entry, CSV/XLSX import/template, charts/comparison/rankings. Records contain monthly raw/equivalent/weighted/percent values and employee display snapshots. | Monthly rows reference employee IDs. Store the result snapshot and scoring-rule version so old month reviews remain consistent. |
| `/admin/kpi-scoring` KPI scoring settings | `src/features/kpi/KpiScoringSettingsPage.jsx`, `kpi-data.js` | `starter-app-kpi-scoring-settings-v1`; weights, manual or raw-value formula, direction, anchors, evaluation bands. Edit/save. Used by KPI scoring helpers. | Versioned immutable rules; month/result points to the rule version used. Settings edits must not mutate past results. |
| `/settings` Settings | `src/pages/SettingsPage.jsx`, theme provider | `starter-app-theme`; system/light/dark preference. | Theme remains frontend/browser preference. Future password change/reset is account functionality; only authenticated account settings should expose it. |
| Activity placeholder | `src/pages/ActivityPage.jsx` | Placeholder only; no route or sidebar entry. | Candidate location for central History only after its role/content is agreed; currently no history feature. |

## 4. Current data flow and CRUD inventory

### Shared employee source

`src/features/organization/organization-data.js` owns the current roster key and helpers. Organization CRUD changes the roster. Seat plan, Projects, inbound/work schedules, VL credits, Agent Profiles, and KPI read or derive employee data from that roster. Some modules persist employee names, roles, or photos as snapshots alongside employee IDs to preserve readable historical displays.

This is a logical shared entity but is not currently a reactive shared repository. A page commonly reads local storage during mount and saves its own feature object. Changes made in another open page may not refresh its in-memory list immediately. The Dashboard is an exception: it listens for the published dashboard storage event.

### Existing CRUD by feature

- People: create/edit/delete employee; role/manager/mentor; profile photo.
- Seat plan: seat add/remove and assignment/replace/swap/unassign by date.
- Projects: create/edit/archive/delete project; configure POC/trainers; assign/remove people and training status.
- Call schedule: create/edit/remove slot/person assignment; automatic slot swap for a person already assigned.
- Work schedule: edit per-person hours; add/remove schedule participants; create/edit/preview/restore/delete date-span schedule entries.
- VL credits: add/edit/delete person/month credit entries.
- App links: add/edit/delete grouped application/link records.
- QA parameters: add/edit/delete/reorder criteria and values.
- Agent profiles: update profile values; manage custom field definitions; maintain birthday/hire date.
- Monthly KPI: update scores manually or import a file; no dedicated whole-month result deletion workflow was found during audit.
- KPI rules: update weights/conversion/evaluation settings.
- Dashboard builder: add/edit/delete/duplicate/reorder/resize containers and content; draft preview/save/discard.
- Settings: theme preference only.

### Current frontend-only state

Theme, sidebar collapse, open dialogs, selected month, filters/search terms, preview device, drag state, hover state, and unsaved form input are UI/session state. These should generally remain frontend-only, except explicit persisted Dashboard draft state and any editor form deliberately saved as a draft.

## 5. Dashboard Builder behavior

The builder persists an editable draft locally under `starter-app-dashboard-draft-v1` and has a published state under `starter-app-dashboard-published-v1`. The page supports independently managed containers with type/content/layout/style settings, images, text overlays/custom text layers, links/buttons, and carousel configuration. Containers can be added, edited, duplicated, removed, reordered, and resized. Page-level spacing settings are editable. Preview is intended to use the same renderer and visual behavior as the live Dashboard, especially for full-size images and absolutely positioned transparent overlays.

The agreed backend behavior is:

1. Load the current published revision.
2. Edit in an isolated draft; do not replace published data during drag/resize.
3. Preview exactly the state that Save will publish.
4. Save one complete dashboard document/revision in one logical operation.
5. Refresh loads the last saved state; a draft can optionally be retained separately for recovery/continuation.
6. Discard removes the draft and retains the published revision.
7. Dashboard save records a recoverable History event/revision.

Proposed table shape should follow real object shapes in `dashboard-data.js` after a schema review. A JSONB layout document can be reasonable for flexible container properties, with a separate dashboard revision row/asset references. Avoid deciding this without inspecting/editing constraints and query requirements.

## 6. Agreed backend and access requirements

### Public view and authenticated editing

- Public visitors can view all normal pages and KPI/team results.
- Authenticated users can access permitted editing/settings and perform CRUD.
- Hide only Dashboard Settings and KPI Scoring Settings sidebar entries while signed out; public route pages remain visible. Other public pages should hide/disable editing controls for signed-out visitors.
- Frontend hiding is not authorization. Database RLS policies and any trusted server functions must reject anonymous writes.
- Start with a single owner/admin account. Do not create separate Admin/User app experiences.
- Email is the login identifier. Password change is available in Settings once authenticated. Forgot-password sends a secure reset link to the email; never expose a stored/current password.
- Keep employee records separate from auth accounts. An auth identity may optionally reference one employee.

### History and recovery

- Central History appears in the main navbar.
- Events capture actor, timestamp, action summary, module/page, record identity, and relevant before/after state or a restore reference.
- Keep recoverable changes for about 30 days, then clean them up under a controlled retention process.
- Not every event requires restore (for example, login events).
- Recovery should be transactionally coherent for linked records/assets.
- For employee delete, prefer soft-delete for 30 days. Keep linked records and files recoverable; on restore, reactivate employee and restore related deleted state according to an explicit policy. Purge after retention. Avoid hard-cascade deletion at first delete.
- KPI monthly historical records and rule versions are separate from 30-day operational recovery: past KPI results must remain stable beyond the History window.

### Images and files

- Store file bytes in Supabase Storage.
- Store storage bucket/path, media type, size, and owner/record relationship in the database where needed.
- Prefer private buckets with signed access where content requires it; public dashboard images may use an explicit public bucket or controlled signed/public policy after access requirements are agreed.
- Replacing/deleting a file should retain the prior object until the associated recovery window expires if a recoverable record references it.
- Do not store base64 file data in PostgreSQL rows.

## 7. Proposed data architecture for discussion

This is an entity map, not an approved schema. Current frontend object shapes should be reviewed before migrations.

| Proposed entity | Purpose and likely relationships |
| --- | --- |
| `employees` | Person/team profile and lifecycle (`active`, `deleted_at`, etc.); independent of login. Role/manager/mentor references must handle manager changes and deletion. |
| `profiles` or `user_accounts` mapping | Link `auth.users.id` to optional `employee_id`; do not duplicate credentials or use employee record as auth. One owner/admin initially. |
| `projects` | Project metadata, active/archive state, optional POC employee reference. |
| `project_memberships` | Join employee to project with training status; trainers can be role/relationship metadata or a dedicated join depending on actual rules. |
| `seat_plans` + `seat_assignments` | Date/period plan and layout/seats; assignments reference employee. Could store seat layout as JSON if seats are user-configurable; evaluate querying/reporting needs. |
| `call_schedule_periods` + `call_assignments` | Inbound calling windows and call allocations, independent from work-hour schedule. Time zone and effective date must be explicit. |
| `work_schedule_periods` + `work_schedule_assignments` | Work-hour schedule for a date span, independent entity even though current local pages share a storage object. Schedule template/snapshot supports preview/edit. |
| `vl_credit_entries` | Month and employee credit/status values; formula remains open pending actual source computation. |
| `app_links` (and optional groups) | Editable link/application cards and ordering. |
| `qa_criteria` | Current QA criteria and TCR/TCP attributes, stored independently from Monthly KPI and call reviews. |
| `employee_profiles` + `profile_field_definitions` | Birthday/hire date/personality/summary and configurable profile fields. Could merge basic fields into `employees`; flexible custom fields may use JSONB or definitions + values depending query needs. |
| `kpi_scoring_versions` | Immutable weights/method/anchors/evaluation bands with version metadata. |
| `kpi_months` + `kpi_results` | Monthly cohort/metadata and per-employee metrics/results; result stores computed snapshot and FK to scoring version. Preserve imported/manual source metadata as appropriate. |
| `dashboard_revisions` | One published version/document per save, creator/time, content/layout JSON and referenced file IDs. |
| `dashboard_drafts` | Optional editor draft separate from published revision; access limited to authenticated editor. Decide whether only one shared draft or per-editor drafts (one owner initially). |
| `files/assets` metadata | Storage bucket/path + record relationship and retention/purge metadata. |
| `history_events` | Actor, action, entity/page, entity id, created time, summary and recoverable before-state or revision reference; centrally consumed by modules. |

Avoid duplicating employee truth in every module. Keep immutable snapshots only where needed for historical meaning/display (for example, KPI month result name/role snapshot if employment changes later). Avoid a generic key/value schema until the real query/reporting needs are understood.

## 8. KPI settings and historical result consistency

Current risk: monthly KPI helper logic uses the current `starter-app-kpi-scoring-settings-v1`; historical months can be interpreted under changed weights/formula/bands.

Proposed behavior:

1. Every saved scoring change creates a new immutable scoring-settings version.
2. A month is calculated/saved against one selected version, and the month/result rows store that version ID plus raw inputs and calculated score snapshots.
3. Reading a past month displays the stored result snapshot and its original evaluation, regardless of current settings.
4. New months use the then-current version by default.
5. If an authorized editor intentionally rescales an old month, create an explicit new result revision linked to the new rule version. Preserve the prior revision and identify the actor/time/reason in History.
6. Do not purge scoring versions referenced by permanent KPI results when 30-day History cleanup runs.

This resolves the user’s concern: changing settings changes future calculations, while reviewed past results stay as they were unless someone deliberately creates a new rescore revision.

## 9. Security outline for proposal

- Use Supabase Auth email/password or invite flow for the initial owner; account provisioning must happen through Supabase Dashboard or a trusted server/admin operation. Do not put service-role/secret keys in the browser.
- For public reads, grant `anon` read access only to approved published/public data. For protected data, require authenticated access.
- Enable RLS on exposed tables and define explicit `SELECT`, `INSERT`, `UPDATE`, `DELETE` policies. Grants and RLS both matter. Do not trust hidden controls or route guards as security.
- Authenticated editor writes should be restricted to authenticated users initially; keep future granular roles possible without building them now.
- Storage policies must follow public/private asset needs and enforce authorized writes/deletes.
- Password reset uses Supabase Auth's email reset link. Configure authorized redirect URLs and email delivery before deployment.
- Vercel environment variables hold only public Supabase URL/anon key for browser use; server secrets, if later needed, stay server-side.

Useful official references:

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase password authentication and reset](https://supabase.com/docs/guides/auth/passwords)
- [Supabase Auth users and invitations](https://supabase.com/docs/guides/auth/users)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

## 10. Seed/sample data proposal

Create small realistic sample rows through migrations/seed scripts after schema approval. Sample employees should be ordinary employee records and should drive the same relationships used by schedules, profiles, projects, KPI and seat plans. Seed only enough records to make each page useful; mark them clearly as demo data if they may appear in production. Do not import the current browser's locally edited mock records.

## 11. Decisions confirmed after the audit

### QA Parameters

Keep QA Parameters as its own criteria/configuration feature for now. It currently contains editable criteria and TCR/TCP values but does not feed individual call reviews or Monthly KPI. Do not create a relationship to those modules unless a later requirement explicitly connects them.

### Agent profile visibility

Add an editor-only **Hide info / Profile visibility** control in the Agent Profiles page. The editor chooses which fields are visible to public visitors for each employee profile. The control should cover the current profile fields (birthday, hire date, personality, summary, photo, and custom fields); name and role can remain public identity fields unless the editor chooses otherwise. Editors remain able to see and edit all fields.

Store visibility with the profile/field configuration so it persists. Hidden values must be omitted from anonymous/public reads at the database or trusted data-access boundary. Do not send private values to the browser and merely hide them with CSS or frontend conditions. Authenticated editors can read all fields under the editor policy. This is a presentation/privacy setting, not a replacement for database authorization.

The editor control should be understandable and reversible: a per-profile dropdown/popover with explicit visible/hidden choices and a clear save state. Custom profile fields should have the same visibility option. A global “apply to all profiles” option can be considered later; initial behavior should be per profile to avoid unexpectedly hiding information across the team. Recommended initial defaults: name, role, and profile photo visible; birthday, hire date, personality, summary, and custom fields hidden until the editor chooses to show them.

### Schedule history and central History

Keep the Work Schedule page's detailed schedule history because it supports date-specific preview, editing, restore-to-cards, and deletion. Each important schedule create/edit/delete/restore should also create a central History event. The event should link to the schedule period/revision and identify the affected date range. Restoring through the schedule page restores that saved revision; the central History timeline may link to that page/revision. Do not create two independent copies of the schedule payload.

## 12. Risks and remaining design points

1. **Roster deletion:** many pages reference employee IDs and some copy display snapshots. Define soft delete, dependent-data retention, and restoration transaction before implementation.
2. **KPI versioning:** current rules can affect old periods; pin versions and store calculated snapshots.
3. **Call/work schedules:** two distinct user workflows share one local key. Split into conceptual backend entities while preserving familiar UI.
4. **Dashboard layout storage:** flexible drag-resize properties may be stored in a revision JSON document, but search, concurrent edit and responsive layout requirements may favor normalized child rows. Decide based on current object schema and access patterns.
5. **Draft ownership:** current app has one browser draft. With one initial editor, one shared draft is simplest; later multi-editor support may need per-editor drafts or optimistic locking.
6. **Image visibility:** user-facing dashboard images may need public read; confirm before choosing public/private buckets.
7. **Profile visibility implementation:** per-employee field visibility is agreed. Use the recommended initial defaults above; verify public reads exclude hidden values.
8. **File retention:** Storage cleanup must coordinate with recoverable records and deleted employees.
9. **Import behavior:** CSV/XLSX parsing occurs in-browser today. Decide file size limits, validation, error report and whether original imports are retained.
10. **Bundle size:** build has a >500 kB chunk warning. Measure before backend work; consider lazy loading XLSX on import rather than changing behavior during this audit.
11. **No central reactive cache:** multiple open pages/tabs may show stale roster state until remount/reload. A data client/cache should define invalidation after backend mutations.

## 13. Implementation status (2026-10-04)

The backend foundation is now being implemented. This is separate from the pre-backend baseline tag `pre-backend-baseline` and branch `main`; implementation work is on `supabase-backend`.

### Implemented in code so far

- Added `@supabase/supabase-js`, environment-aware browser client, auth/session provider, login/forgot/reset flows, password update in Settings, editor route guard, and editor-aware sidebar/navigation.
- Added the first SQL migration and sample seed for account/employee separation, employee profiles and field visibility, module entities, KPI scoring versions/month snapshots, Dashboard drafts/revisions, Storage buckets/policies, RLS, audit triggers, employee soft-delete/restore, and checked RPCs.
- Added an Organization provider for shared employee/profile reads and writes, including a public-safe directory RPC that applies per-profile field and photo visibility, and Storage-backed employee photos.
- Added database repositories and integrations for Dashboard publication/drafts, App / Links, QA Parameters, employee profiles, Seat Plan, VL Credits, Project coverage, Inbound Call Time, Work Schedule, KPI scoring settings, month-pinned KPI results, and central History. Multi-record page saves use checked RPCs with logical recoverable History snapshots; App / Links and QA Parameters use one atomic collection save each.
- Added a KPI history correction migration: restores reverse additions as well as edits using append-only tombstone revisions, and public reads expose only the latest non-deleted result for each employee/month.
- Added private-bucket storage for uploaded profile photos. Public profile reads include a private-bucket path only when photo visibility is enabled; Storage RLS gates short-lived signed URL creation on that same flag.
- Executed all eleven migrations and `seed.sql` in an isolated PGlite/Postgres-WASM harness with stubbed Supabase Auth and Storage schemas. The run verified seed rows, anonymous employee/profile sanitization, hidden/public profile-photo Storage policies, dashboard publication visibility, authenticated-viewer write denial, editor checked RPCs, and restoration of KPI edits plus imported additions. It exposed a missing VL photo snapshot column, which is now present in the base schema and guarded idempotently in migration 003.
- Added Supabase setup instructions in `supabase/README.md`. No Supabase/Vercel account was accessed and no external project configuration was changed.
- `npm run build` passes after the current integration set. Vite reports the large-chunk warning. The isolated SQL harness uses stubbed Supabase schemas, so hosted Postgres 17, PostgREST, Auth/session, actual Storage signed URLs, and Vercel behavior remain deployment-dependent. No local Supabase CLI, `psql`, or Docker is installed and no hosted project has been configured.

### Remaining work

- Central History provides a database-backed timeline and restore actions for supported snapshots (Dashboard publication, employee/profile records, App / Links, QA criteria, KPI revisions, Seat Plan, VL, Project Coverage, Inbound, and Work Schedule documents). Work Schedule also keeps its focused schedule history for date-specific preview/edit/restore and logs those changes centrally. Unsupported snapshot types are identified for restoration from their owning page.
- Apply all eleven migrations and seed against the manually configured Supabase project, then verify anonymous/editor access, KPI restore (including imported additions), private profile photo signed URLs and visibility revocation, Auth email delivery, and Vercel routes. The isolated SQL harness has already checked the SQL migration sequence and representative database-level policies/RPCs, but cannot replace this hosted check.
- After the owner configures Supabase, verify anonymous/editor access, recovery flows, Storage policies, Auth email delivery, and Vercel routes using separate sessions.

## 14. Deployment-dependent work

- Create/configure the user's Supabase project and Vercel environment, then apply the SQL migrations in order and run `seed.sql` once.
- Create the owner Auth account and explicitly promote its `app_accounts` row; configure redirect URLs, SMTP, disabled public signups, and the trusted retention job.
- Run database/RLS/Auth/Storage verification against the configured project. The frontend build cannot prove hosted authorization or SQL execution.

## 15. Remaining implementation order

1. Complete the final SQL/RLS review and production build before the user applies migrations.
2. After manual project setup, apply migrations/seed and verify public/editor access, recovery, files, Auth emails, and Vercel routes.

## 16. Audit sources

The audit reviewed the route table, app shell/theme, page components, feature data helpers, local storage access, sample defaults, and package scripts/dependencies under `src/`, `package.json`, `.env.example`, and `vercel.json`. Exact current source behavior should be rechecked as implementation proceeds; this document is an architectural handoff, not a replacement for source code.

## 17. Current implementation update (2026-10-13)

This section supersedes earlier statements above that describe backend setup as proposed or public read access as the approved model.

- **Viewing/access model:** All workspace routes require a valid signed-in session. Signed-in Users can read workspace data and manage their own account profile. Admin accounts can edit workspace data, use Dashboard Settings/KPI scoring settings, manage login accounts, and access History. Admin routes and writes are protected by route guards plus Supabase RLS/RPC checks. Login, forgot-password, and reset-password pages remain available while signed out.
- **Auth and accounts:** `app_accounts.role` is `admin` or `user`; legacy `can_edit` is synchronized for compatibility. Employee records remain separate from Auth accounts. Admins invite accounts through the `manage-account` Edge Function; passwords are set through the emailed Supabase invitation and are never handled by the app as plaintext.
- **Profile:** Signed-in users can update display name, summary, login email, password, and a static or animated GIF photo. If linked to an employee, supported profile fields sync to that employee record. Public employee reads continue through a field-visibility-filtered RPC.
- **History:** Change history and recoverable snapshots are Admin-only. Employee delete audit now reads `purge_after` through JSON only for employee deletes, avoiding errors when a different table is deleted. History restore remains limited to supported record types and the retention cleanup path.
- **Realtime:** Shared roster and key page data subscribe to Supabase Realtime where configured, so open pages refresh after remote changes.
- **Schedules/VL:** Work schedule saves reject weekend endpoints and duplicate employee assignments within a saved period; range updates/deletes target affected rows. VL credits use effective date ranges, validate nonnegative numeric values or `Proby`, reject overlapping records for the same employee, and support recoverable delete/restore.
- **Migrations:** Migrations 202610130001 and 202610130002 add role/account profile support, the audit fix, realtime publication membership, schedule validation, and VL effective-date operations. Migration 202610130003 removes anonymous access to app tables/functions so workspace reads require authentication. The first two migrations were applied remotely; 202610130003 remains pending.
- **Verification:** `npm run build` passed before the latest route-gating change; rerun it after this update. An isolated PGlite harness previously verified the first two new migrations and seed. Rerun it with migration 202610130003 to confirm anonymous reads fail, signed-in User reads work, and Admin writes/recovery still work. Hosted Auth email delivery, Edge Function execution, actual Storage behavior, and Vercel deployment still require project-side verification.

See [`auth-and-deployment.md`](auth-and-deployment.md) for required manual Supabase/Vercel actions before production use.
