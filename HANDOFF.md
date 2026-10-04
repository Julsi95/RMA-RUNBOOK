# RUNBOOK Project Handoff

**Prepared:** 2026-09-28  
**Project folder:** `C:\Users\delat\Documents\Codex\2026-09-27\x20\outputs\starter-app`  
**Status:** Admin-side prototype with local browser storage. No shared database or authentication is connected.

## 1. Project purpose

RUNBOOK is a small internal team-operations app. The current scope is an **admin workspace** for managing a customer-support team. Admins need to see and update the organizational structure, assign physical seats, and review monthly QA/KPI performance. The app should feel polished and interactive, use a restrained black/white aesthetic with light/dark theme support, and stay understandable for a developer whose current experience is React, JavaScript, Tailwind, and HTML.

The intended deployment is Vercel on its free tier. Supabase was discussed as the likely database/auth service later; it is **not implemented**. For now, all editable data and settings are saved in the current browser's `localStorage`. Nothing is synchronized between browsers or users.

The user wants the admin product completed first. Once the admin workflows are stable, the app can be adapted into a user-facing experience with appropriate permissions and views.

## 2. Current technology and dependencies

- React `^19.1.1`
- React Router `^7.9.1` for SPA routes
- Vite `^7.1.5` and `@vitejs/plugin-react` `^5.0.2`
- Tailwind CSS `^4.1.13` with `@tailwindcss/vite`
- CSS variables and custom CSS for the app theme and feature layouts
- `@radix-ui/react-select` `^2.3.7` for a styled, accessible Select primitive
- shadcn-style local UI components (the project is configured to use the shadcn aliases/style, but it does not use the shadcn CLI for every component)
- `lucide-react` `^0.468.0`
- `class-variance-authority`, `clsx`, and `tailwind-merge` for component classes
- `xlsx` `^0.18.5` to parse CSV/XLSX KPI uploads

Vite aliases are configured so `@/` resolves to `src/`. `components.json` uses the `new-york` shadcn style, JavaScript rather than TypeScript, and `@/components/ui` for UI primitives.

Scripts in `package.json`:

- `npm run dev`
- `npm run build`
- `npm run preview`

## 3. Routes and navigation

Routes are declared in `src/app/App.jsx` inside the shared `AppShell`:

| Route | Page |
| --- | --- |
| `/` | Dashboard |
| `/organizational` | Organizational chart |
| `/seat-plan` | Seat plan |
| `/projects` | Admin Project Coverage matrix and project manager |
| `/inbound-call-time` | Monthly inbound call-time allocations and separate work-hour schedules |
| `/kpi-qa` | Monthly KPI / QA dashboard |
| `/admin/kpi-scoring` | Admin KPI scoring settings (added in the latest work) |
| `/settings` | App theme settings |

Unknown paths redirect to `/`. The sidebar is in `src/components/layout/Sidebar.jsx`; current feature links are listed there. The app has a responsive shell, a collapsible desktop sidebar whose content width follows it, and a mobile navigation drawer. The theme starts in system mode and can be set to system/light/dark.

Vercel SPA fallback configuration is in `vercel.json` so direct route loads/refreshes should resolve to the app entry point.

## 4. Source layout and ownership

### Application shell and shared UI

- `src/main.jsx` — React entry point.
- `src/app/App.jsx` — route table.
- `src/app/theme-provider.jsx` — system/light/dark theme handling and persistence.
- `src/components/layout/AppShell.jsx` — shared navbar/sidebar/content shell.
- `src/components/layout/Navbar.jsx` — top bar and theme/menu controls.
- `src/components/layout/Sidebar.jsx` — primary app navigation, collapse behavior, and settings link.
- `src/components/ui/Button.jsx` — local shadcn-style Button variant/size wrapper.
- `src/components/ui/Select.jsx` — local shadcn-style Select wrappers over Radix Select. It is used by the KPI month picker and the scoring settings controls.
- `src/lib/utils.js` — `cn()` helper built with `clsx` and `tailwind-merge`.
- `src/index.css` — Tailwind import, CSS variables, base styles, shell layout, and shared responsive rules.

### Existing feature pages

- `src/pages/DashboardPage.jsx` — dashboard landing page.
- `src/pages/SettingsPage.jsx` — app theme preferences.
- `src/pages/ActivityPage.jsx` and `src/pages/ProjectsPage.jsx` — existing starter pages; inspect their route/use before removing anything.
- `src/features/organization/OrganizationPage.jsx` — interactive organizational chart/editor.
- `src/features/organization/OrgBranch.jsx` — chart branch rendering.
- `src/features/organization/OrgMemberDialog.jsx` — add/edit member UI.
- `src/features/organization/organization-data.js` — starter roster and team data helpers.
- `src/features/seating/SeatPlanPage.jsx` — dated editable seating plan.
- `src/features/projects/ProjectCoveragePage.jsx` — project matrix/cards, project CRUD, project POC/trainer editing, and member training-status assignment/removal.
- `src/features/projects/project-data.js` — reference project catalog, training status definitions, persistence key, and project loading/ID helpers.
- `src/features/projects/project-coverage.css` — matrix, project cards, dialogs, and responsive layout.
- `src/features/inbound/InboundSchedulePage.jsx` — monthly call-time and work-hour schedules, per-person edits, Manila/North American conversions, and browser persistence.
- `src/features/inbound/inbound-schedule.css` — schedule cards, visual call timeline, and responsive layout.
- `src/pages/ProjectsPage.jsx` — small compatibility entry that re-exports the project feature page.
- `src/features/kpi/KpiQaPage.jsx` — monthly KPI dashboard, comparisons, chart, leaderboard, result editor, importer dialog, and member scorecard.
- `src/features/kpi/KpiScoringSettingsPage.jsx` — admin settings editor added in the latest work.
- `src/features/kpi/kpi-data.js` — KPI definitions, defaults, local-storage access, score/evaluation calculation, CSV template generation, and demo data.
- `src/features/kpi/import-utils.js` — CSV/XLSX reading, header/month detection, name matching, and record normalization.
- `src/features/kpi/kpi-qa.css` — KPI dashboard/settings layout, KPI dialogs, Select styling, and responsive rules. The new settings page imports this file too.

Other project files include `.env.example`, `README.md`, `components.json`, `vite.config.js`, `index.html`, `package-lock.json`, and `vercel.json`.

## 5. Product decisions and agreed requirements

### Admin scope

- Treat current pages and operations as admin-side for now.
- Finish admin functionality before adding member/user-facing views.
- Later, user access should be designed after the admin workflows and actual rules have been confirmed.

### Visual direction

- Clean black/white aesthetic with light/dark system support.
- Collapsible sidebar; content follows sidebar width. Collapse control stays at the right end of the sidebar container.
- Use styled components such as shadcn/Radix Select where native dropdowns are difficult to style.
- For the monthly KPI dashboard, avoid copying the dense spreadsheet look in the supplied screenshot. Favor charts, comparisons, scorecards, and interactive rankings.
- Leaderboard/ranking should feel game-like, without obscuring the score data.

### Organizational chart

- Roles include Team Lead, Campaign Specialist, Senior Agent, and Customer Rep.
- Starts with eight sample people and must scale as people are added, edited, removed, or given pictures.
- A Customer Rep still reports to the existing hierarchy; a separately selected mentor can be shown below the rep. The mentor is a selected Campaign Specialist, not a new reporting-line branch to every specialist.

### Seat planning

- Default operations layer: eight back-to-back desks/seats, editable and scalable.
- A separate upper layer was added/planned for up to four Team Lead/Boss seats.
- Seats and people can be assigned/reassigned, with drag interaction and non-drag alternatives. Plans/notes are date-specific.

### KPI / QA dashboard

- Results are monthly; user chooses the month from one styled dropdown rather than seeing twelve months at once.
- Include an at-a-glance team comparison and person-level detail. A person can be compared with the previous month or another team member.
- Add a trend chart tracking percentages/performance, not only a static month table.
- Rankings should have a game-inspired presentation (podium, ranks, progress, badges) while preserving useful context.
- Admin needs to enter scores manually or upload CSV/XLSX data.
- CSV/XLSX uploads should be explainable and predictable; a downloadable CSV template is provided.
- KPI scoring formulas/weights must be configurable because the reference image does not establish every business rule.

## 6. Completed work

### App shell

- React Router SPA structure and working page navigation are in place.
- Responsive navbar/sidebar layout is implemented.
- Sidebar collapse control and width-following content behavior are implemented.
- System-aware light/dark theme support and theme settings are present.
- Shared page content max width was increased from 1140px to 1480px to use widescreen workspace space more effectively. The Organizational page summary, chart labels, and person cards were also enlarged for readability; its member cards now have wider text space.
- Small text sizes were raised in their owning page styles rather than through a global minimum, to keep the project matrix and KPI layouts appropriately dense while improving labels, controls, and card details.

### Organization and seating

- Organizational chart/editor feature and starter member data are in place.
- Mentor display/selection for Customer Reps is implemented in the existing feature.
- Seat plan includes eight operational seats plus a separate four-seat Team Lead/Boss layer and supports scalable seat count.
- Seat assignment uses pointer-based drag handling for moving available teammates into seats and returning seated teammates to the pool; click-to-assign remains available. Dragging was manually verified in both directions.
- Both features persist data in local storage.
- Project Coverage starts with the project names shown in the user's spreadsheet reference (Franchisee Sync starts archived). Admins can switch between a horizontally scrollable people-by-project matrix and project cards, filter projects/people/statuses, and show/hide archived projects. Each project has one POC, multiple trainers, an active/archive state, a description, and per-person status (Trained, Refresher, To be trained, or not assigned). POC/trainer roles are separate from training status. Clicking a matrix cell adds/edits a status; choosing Not assigned or Remove from project clears only that person/project assignment. A project with assignments or contacts is archived when removed; an unused project can be deleted. Records are saved under `starter-app-project-coverage-v1`.
- The project feature reads the same member roster as the Organizational page. `getOrganizationMembers()` and `ORGANIZATION_STORAGE_KEY` are centralized in `organization-data.js`; Organizational and KPI data accessors use them.

### KPI dashboard and import

- Monthly KPI/QA dashboard includes demo data for six months, metric trends, team comparison bars, previous-month/member comparison, scorecard detail, results editor, and game-style leaderboard.
- CSV template download and CSV/XLSX import are present.
- Importer attempts to recognize grouped KPI headers from the supplied spreadsheet screenshot/workbook format and can detect month labels for multiple sections.
- Matched team-member rows update that person's record for the month; unmatched/repeated names are surfaced in import preview. Names are matched by normalized full name and a unique initial-plus-surname fallback.
- KPI data is saved per month to local storage under `starter-app-monthly-kpi-v1`.

### Month dropdown styling

- The native month `<select>` was replaced with the Radix-backed `Select` component in `src/components/ui/Select.jsx`.
- `@radix-ui/react-select` was added as a dependency.
- The KPI month trigger is forced to a white surface with black text, and the popover uses a white surface with black option text. This keeps month text readable while allowing controlled styling in dark mode.

### KPI scoring settings

- Admin page route `/admin/kpi-scoring` was added in `src/app/App.jsx`.
- Sidebar link **KPI scoring settings** was added in `src/components/layout/Sidebar.jsx`.
- The settings page is `src/features/kpi/KpiScoringSettingsPage.jsx`.
- It edits each metric's percentage weight, scoring mode, formula direction, score-5 raw-value anchor, and score-0 raw-value anchor.
- It edits performance band labels and minimum scores.
- It displays total weights, resulting maximum KPI score, and number of formula-enabled metrics.
- Formula anchor direction is validated on save. Total weight must be greater than zero. Band names/minimums are validated and duplicate thresholds are rejected.
- Reset loads defaults into the draft; the reset must still be saved to apply.
- Settings are stored in local storage under `starter-app-kpi-scoring-settings-v1`.
- KPI calculation helpers in `src/features/kpi/kpi-data.js` read those settings. Manual mode uses the entered/imported equivalent score and calculates weighted score from the configured weight. Formula mode linearly maps raw values between two anchors to 0–5, clamped at both ends. Total KPI score is the sum of weighted scores. Evaluation labels use configured bands.
- KPI scorecards, summary max score, comparisons, ranking labels, and the KPI trend scale were updated to use the settings.
- Manual result entry now displays weighted values as calculated output. Formula-mode equivalent score is read-only and derived from the raw value.

## 7. KPI scoring defaults and important behavior

The defaults were inferred from the user's spreadsheet screenshot, not confirmed as final official rules:

| Metric | Default weight |
| --- | ---: |
| QA score | 15% |
| Calls handled | 20% |
| Completion count | 48% |
| Error | 2% |
| Kudos | 0% |
| Absenteeism | 5% |
| Punctuality | 5% |
| Excessive break | 3% |
| PCI | 1% |

These weights total **99%**, so the default maximum score is **4.95** on a five-point metric scale. This matches the apparent team-score ceiling in the screenshot. The UI intentionally shows that the weights are one percentage point below 100%; do not silently normalize them without the user's agreement.

Default evaluation bands are:

- Outstanding: 4.65+
- Above Average: 4.40+
- On Track: 4.00+
- Needs Focus: 0+

All metrics start in **manual equivalent score** mode. That is intentional: the user has not provided their actual raw-count targets/denominators or scoring formulas. The direction field has a suggested default for a few metrics, but does nothing until formula mode is enabled.

For formula mode, the app uses a linear interpolation:

- Higher is better: `(raw - zeroPoint) / (fivePoint - zeroPoint) * 5`
- Lower is better: `(zeroPoint - raw) / (zeroPoint - fivePoint) * 5`
- Clamp the resulting equivalent score between 0 and 5.
- Weighted score: `equivalentScore * weightPercent / 100`.
- Overall KPI score: sum of all metric weighted scores.

This only supports a simple linear two-anchor rule. It is not an arbitrary formula editor, tiered scoring table, or percentage/denominator builder. Do not enable formula mode for a metric until the user knows the appropriate anchors. More complex rules need more UI/data model work.

`getOverallScore()` recalculates from metric equivalent/weighted values under current settings and does not use an imported `overallScore` column as authoritative. In manual mode, if equivalent is missing but an imported weighted score exists, the old imported weighted value is used as a fallback; changing a weight cannot correctly recompute that incomplete row. The importer/template normally requests both fields, but currently it validates the presence of headers rather than requiring every individual cell to be non-empty.

## 8. Data persistence and boundaries

Current persistence is browser-local only:

- KPI monthly records: `starter-app-monthly-kpi-v1`
- KPI scoring settings: `starter-app-kpi-scoring-settings-v1`
- Organizational members: `starter-app-organization-members-v2`
- Seat plans use their own feature key(s) in `src/features/seating/SeatPlanPage.jsx`; inspect the file for the exact current key before migrating.
- Theme/sidebar preferences are also stored locally; inspect `src/app/theme-provider.jsx` and `src/components/layout/AppShell.jsx` for the exact keys.

This is prototype storage. It is not multi-user, not an authorization boundary, not a backup, and not shared across devices. A later Supabase migration should consider relational tables for users/roles, team members, monthly KPI records, metric definitions, scoring settings/version history, seat plans, and audit timestamps. Scoring-setting changes can alter historical scores because calculations currently use the currently saved settings; consider storing a settings version/snapshot on each month before real operational use.

There is no admin login or role access control. The `/admin/kpi-scoring` path is an organization convention only, not a protected admin route.

## 9. Known issues and risks

1. **Production build passes, but browser/interaction verification has not been performed for Project Coverage or KPI settings.** `npm run build` succeeded after Project Coverage was implemented. Vite reported the JS chunk is 828.48 kB minified (270.07 kB gzip), above its 500 kB advisory threshold; the existing `xlsx` dependency likely contributes materially. The new page still needs visual/manual browser review.
2. **XLSX dependency security advisory:** installed `xlsx@0.18.5` is reported by `npm audit` as high severity, with advisories for prototype pollution and ReDoS; npm reports no direct fix for the installed line. This dependency pre-existed the current month-dropdown/settings work, but it is on the user-uploaded file parsing path. Investigate an updated supported version/source or replace the parser before processing untrusted real uploads or deploying the importer for operational use.
3. **Formula defaults are not official business rules.** They are manual until the user gives metric-specific formula definitions, targets, directions, denominators, and rounding expectations.
4. **Formula engine is intentionally simple.** Two-anchor linear interpolation cannot model thresholds, caps/floors at arbitrary bands, per-month denominators, exception handling, or categorical logic beyond simple clamp behavior.
5. **Local storage only.** Settings/records are not shared between admins and can be lost if browser data is cleared. Vercel hosting alone does not make local browser state shared.
6. **Historical recalculation:** changing settings immediately changes calculations for old records because no settings version is attached to each month. Decide whether historical months should keep the rules used at the time or always recalculate.
7. **CSV fallback detail:** imported KPI Score/Evaluation/Rank columns exist in the template/import shape, but KPI score is recalculated from metric rows and dynamic evaluation bands now control the displayed evaluation. Do not promise that imported KPI total/rank/evaluation values are the authoritative displayed values.
8. The npm install in the prior month-dropdown work emitted an install-script warning that esbuild's postinstall was blocked by the local npm `allowScripts` policy. Vite may already work from installed binaries, but this should be checked when running the dev server/build.
9. Project names were seeded from the screenshot, but no POCs, trainers, or person statuses were seeded because the user has not specified real owners/qualifications. Projects start with unset contacts and unassigned people.

## 10. Previous attempts and outcomes

- The user initially asked for the month dropdown text to be black because the native dropdown text was unreadable. A CSS color fix was applied first.
- The user then asked for a shadcn-style dropdown matching the supplied compact viewing-month control so the control could be styled. The native selector was replaced with the Radix-backed local Select component and the trigger/popover colors were defined explicitly. The visible selected month is black on white, satisfying the original contrast request.
- The previous discussion recommended an admin KPI scoring page, editable weights/bands, and a simple sample calculation preview. The latest code implements the settings and calculation controls, but **does not yet include a user-entered sample preview**. Add that next if useful before relying on new formulas.
- After that handoff was created, the user asked to proceed with Project Coverage. The page, route, sidebar link, screenshot-derived project catalog, POC/trainer selectors, matrix status controls, project archive/delete behavior, and project cards were implemented. `npm run build` passed; browser interactions have not yet been checked.
- The user clarified that all current work is admin-side and should only be extended into user-facing pages after admin functionality is complete.
- The user asked where to find settings before they existed; the response clarified they had not yet been built. The user then explicitly asked to add the page, and the route/sidebar/settings implementation described above was created.

## 11. Exact next steps

1. Run `npm run dev`, open the app, and confirm sidebar navigation to `/projects`, `/admin/kpi-scoring`, and `/kpi-qa`. Review light/dark themes and narrow/mobile layouts, especially the wide matrix, sticky person column/header, and dialogs.
2. Verify Project Coverage workflows manually: add/edit a project; set/clear its POC; select multiple trainers; add/update/remove member statuses; archive a project with assignments; show/hide archived projects; reload and check local persistence; confirm Organizational roster edits are reflected.
3. Verify the KPI settings workflow manually:
   - Defaults display a 99% total and 4.95 maximum.
   - Edit a weight, save, navigate to KPI/QA, and confirm score, max, comparisons, graph scale, and ranking labels update.
   - Try higher-is-better and lower-is-better anchors and inspect scores at both anchors, between them, and outside them.
   - Try invalid/equal/reversed anchors and duplicate/out-of-range evaluation thresholds; confirm save feedback is clear.
   - Reload and confirm settings persist in the same browser.
4. Add the promised **live KPI scoring preview** before asking the user to configure real metrics. It should accept example raw values/equivalent inputs per metric and show equivalent score, weighted contribution, and sample total before settings are saved. Clearly label examples so no demo values are mistaken for official data.
5. Ask the user to provide actual KPI metric rules before switching any metric from manual mode: raw input definition, target/denominator, scoring direction, score anchors/bands, rounding, handling of missing/zero values, and whether weights should total 99% or 100%.
6. Decide whether score-setting edits recalculate past months or whether each month should retain a settings version. Implement history/versioning before production use if prior-month rankings must remain historically accurate.
7. Review and resolve the `xlsx@0.18.5` advisory before real CSV/XLSX ingestion. The import format and upload parser should be treated as an important path because users will upload files.
8. Consider CSV import/export for Project Coverage once the user agrees on a file format for project POCs, trainers, and status assignments.
9. After admin behavior is settled, plan Supabase schema/auth and role-gated admin/user views. Keep the current no-auth/local-storage prototype clearly scoped until that work is done.

## 12. Working constraints for the next chat

- Work in the project folder listed at the top of this document, not the separate empty `C:\Users\delat\OneDrive\Documents\ChatGPT\RUNBOOK` directory encountered in the latest tool context.
- The user is still learning React/JavaScript. Prefer clear component boundaries, simple formulas, and explanations in concrete terms.
- Preserve the design preference: modern, clean, black/white, polished, interactive; avoid dense spreadsheet-style KPI tables.
- No official scoring formula or weight normalization decision has been supplied. Do not assume custom business rules from the screenshot beyond clearly labeling them as inferred defaults.
- `npm run build` passed after Project Coverage was implemented. No automated test suite or browser interaction review has been run. Report verification honestly.

## 13. Latest UI fixes (2026-09-28)

- KPI scoring metric cards now use two independent vertical columns instead of shared grid rows, removing the empty space below shorter cards. Desktop columns keep the original side-by-side order (QA/Calls handled, Completion/Error, etc.); narrow containers switch to one column with natural metric order. Formula cards still grow to fit their controls without stretching the other column. This was checked in the browser at a 927 px settings-container width; both columns stack with a consistent 10 px gap.
- Seat-plan dragging now displays a floating teammate card attached just below/right of the pointer once the drag passes its movement threshold. The source person card dims while held. The preview follows the pointer over seats and the available-person pool, and has `pointer-events: none` so it does not interfere with drop-target detection. Relevant implementation: `src/features/seating/SeatPlanPage.jsx` and `src/index.css`.
- `npm run build` passes after these fixes. Vite still warns that the minified JS bundle is about 830 kB, above its 500 kB advisory threshold. No automated tests were added or run.

## 14. Inbound call schedule page (2026-09-28)

- Added the `/inbound-call-time` route and sidebar link. The page title is also included in the shared navbar breadcrumb.
- Call allocation and employee work hours are separate schedules in both the UI and state. Changing work hours does not change call assignments or their independent call coverage window.
- The month selector stores separate schedules by month under `starter-app-inbound-schedule-v1` in localStorage. New months seed a work-hour card for each current organization member, using 9 PM–6 AM by default. Members can be added or removed for that month.
- The work schedule has month-specific 9 PM–6 AM and 10 PM–7 AM presets, a custom state, and editable per-person login/logout values. Choosing a preset applies it to the current month's work schedules only.
- The inbound call section has its own 9 PM–6 AM coverage window and add/edit/remove assignment controls. Each member can have one call assignment per month; the person's start/end times and assigned teammate are editable. A lane timeline visualizes each interval, and the duration is shown per person.
- North American timezone options include Eastern, Central, Mountain, Arizona, Pacific, Alaska, and Hawaii. A date-in-month selector supplies the date-sensitive daylight-saving conversion. The UI displays the same Manila schedule in its selected North American zone and allows toggling which view is emphasized. Values are stored/edited as Manila local times.
- Browser review confirmed the route and default roster display, adding/removing a call assignment, and applying then restoring the 10 PM–7 AM preset. The preset changed login/logout values to 10 PM / 7 AM; call coverage remained separate. A 390×844 mobile preview was reviewed; controls and cards stack vertically without visible horizontal overflow. No browser console errors were observed.
- `npm run build` passes. Vite reports the existing large-bundle advisory at approximately 845 kB minified. Data remains browser-local; no database or authentication is connected.
