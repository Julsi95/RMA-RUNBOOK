# Starter App

A small React SPA starter with a responsive workspace layout, React Router navigation, Tailwind CSS v4, a shadcn/ui-ready setup, and system-aware light/dark mode.

## Run locally

1. Install Node.js (LTS) if it is not already installed.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm run dev` and open the local URL Vite prints.

## Add your content

- Add a page under `src/pages/`.
- Add its route in `src/app/App.jsx`.
- Add its navigation link in `src/components/layout/Sidebar.jsx`.
- Put app-wide layout in `src/components/layout/` and reusable UI in `src/components/ui/`.
- The organizational chart lives in `src/features/organization/`; its member list is saved in local storage.
- The dated, editable seat planner lives in `src/features/seating/`; plans and notes are saved separately by date.
- Project coverage lives in `src/features/projects/`; projects can be added, edited, archived, or removed. Each project can have a primary contact (POC), multiple trainers, and per-person training statuses. Project coverage is saved in local storage.
- The monthly KPI / QA dashboard lives in `src/features/kpi/`; results are saved by month in local storage and support manual entry plus CSV/Excel import. It uses `xlsx` to read workbooks.

## Layout

The sidebar can be collapsed on desktop; the content area adjusts to the available width. The collapsed preference is saved in local storage. On smaller screens, the sidebar opens as a navigation drawer.

## Theme

The theme starts in `system` mode and follows the device preference. The navbar button toggles light/dark. Settings lets you choose System, Light, or Dark; the choice is saved in local storage.

The Organizational page starts with eight sample team members, including two Campaign Specialists. Add, edit, remove, change roles and primary reporting lines, or upload photos. Customer Reps can optionally choose a Campaign Specialist as a mentor; the mentor's name appears beneath the rep in the chart. Chart edits are saved in this browser's local storage.

The Seat Plan page starts with a separate four-seat Team Lead / Boss row above eight back-to-back team desks. Add or remove seats in either layer to fit the room; removing an occupied seat returns its teammate to the available list. Drag people into or between seats, drag seated people back to the available list, or select seats and teammates to make assignments without dragging. Plans and date-specific notes are saved per date in this browser.

The Monthly KPI / QA page includes six months of clearly marked demo scores so the trend chart, comparisons, badges, and leaderboard are visible when first opened. Replace the demo results with manual entry or import a CSV/Excel file. A CSV template is available in the import dialog. For a formatted workbook with multiple monthly sections, each section should include a month heading; the importer recognizes the KPI / QA grouped-header layout and imports detected months separately. Results remain in this browser until connected to a shared database.

## Supabase later

The `.env.example` has placeholders for the public project URL and anon/publishable key. Copy it to `.env.local` when you are ready, then add the Supabase client and features you need. Do not put a Supabase service-role key in frontend code.

## Deploy

Import the folder as a Vercel project and use the default Vite settings. `vercel.json` sends SPA routes back to `index.html` so direct links and refreshes work.


