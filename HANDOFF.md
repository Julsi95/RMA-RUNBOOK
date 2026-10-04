# RUNBOOK Project Handoff

**Updated:** 2026-10-04
**Repository:** `C:\Users\delat\Documents\Codex\2026-09-27\x20\outputs\starter-app`
**State:** Frontend prototype complete enough for backend planning; all app data remains mock/sample data in browser storage. Backend work has not started.

## Purpose and product direction

RUNBOOK is a SharePoint-inspired team operations app. Visitors should be able to view team information and results. Signed-in editors should be able to change permitted content. The user is building the admin/editing experience first, while keeping the main pages suitable for public viewing.

The frontend uses React, JavaScript, Tailwind CSS, React Router, and shadcn-style local UI. The chosen future hosting/database direction is Vercel + Supabase/PostgreSQL. Neither Supabase Auth, database, Storage, nor API integration exists yet.

## Current architecture

- React SPA, Vite build, React Router 7 route table in `src/app/App.jsx`.
- Shared shell in `src/components/layout/` with sidebar, navbar, responsive content, theme handling.
- Feature pages live in `src/features/*`; `src/pages/` includes Dashboard, Settings, compatibility Projects page, and an unused Activity placeholder.
- Feature data is initialized from hardcoded sample defaults and saved directly to `localStorage`. There is no API/data repository abstraction and no shared reactive state layer.
- `.env.example` contains empty Supabase URL/key placeholders only. No Supabase client or backend code is present.
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

`src/pages/ActivityPage.jsx` is a placeholder and is not currently routed. There is no central History page yet.

## Current data sources and storage keys

All storage below is browser-local. Different browsers/devices do not share changes. Sample defaults are frontend data, not production migration data.

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

## Proposed architecture for discussion (not implemented)

See [`docs/architecture-current-state.md`](docs/architecture-current-state.md) for the page-by-page audit, current data flow, proposed entities/relationships, authorization, history/recovery, dashboard draft/publish model, file storage, seed plan, risks, and open design choices. This is a proposal only. No schema, migration, bucket, auth flow, or backend code should be created until the user reviews and approves it.

## Before backend implementation

- Confirm the architecture in `docs/architecture-current-state.md` with the user.
- Implement the confirmed QA Parameters, profile visibility, and schedule History decisions in the proposed architecture.
- Confirm remaining details (especially initial visibility defaults and exact employee restore scope) before schema/migrations.
- Keep this frontend baseline commit/tag intact for rollback.
- Implement backend incrementally only after approval; maintain the current routes and public-view/editor model.
