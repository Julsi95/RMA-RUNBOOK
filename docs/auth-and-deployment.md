# Authentication and deployment checklist

The frontend supports public read-only viewing. A signed-in account can edit its own account profile; only Admin accounts can change workspace data or open Admin pages. Supabase RLS and checked RPCs enforce this model independently of the UI.

## Apply the local database changes

The new local migrations are pending. From the project folder, run:

```powershell
npm run db:status
npm run db:dry-run
npm run db:push
npm run db:status
```

The expected new migrations are `202610130001_roles_auth_realtime_and_audit_fix.sql` and `202610130002_work_schedule_and_vl_validity.sql`. Do not pass `--include-seed` again unless you intentionally want to rerun seed data.

The account that already had `can_edit = true` is promoted to Admin by the migration. Confirm it in Settings → Account access after deploying.

## Deploy account management

The Admin invitation/account management feature uses a Supabase Edge Function. Deploy it after the database migration:

```powershell
npx supabase functions deploy manage-account
```

Supabase supplies the project URL, anon key, and service-role key to Edge Functions. Keep the service-role key out of Vercel client variables and all `VITE_` variables.

## Configure Auth in Supabase Dashboard

- Set the production site URL and allowlist the deployed Vercel URL plus any preview URL used for testing. Include `/reset-password` and `/login` redirect paths as applicable.
- Configure reliable SMTP/email delivery for invitations, password resets, and email-change confirmation. Test delivery to an address you control.
- Keep public self-signup disabled. Admins invite accounts from Settings → Account access.
- Confirm that the initial owner account has the `admin` role. If no account was previously marked `can_edit`, promote the intended owner from the Supabase SQL editor using its Auth user ID; do not share the service-role key.

## Configure Vercel

Set the client-side environment variables for Production and any Preview environment that should connect to this project:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Redeploy after changing environment variables. Never add the Supabase database password or service-role/secret key to frontend environment variables.

## Hosted smoke check

After deploying, verify in separate browser sessions:

1. Signed-out visitors can view public workspace pages and published Dashboard content.
2. Signed-out visitors cannot save changes or access Dashboard Settings, KPI scoring settings, or History.
3. A normal User can sign in, edit their own profile, and cannot perform workspace CRUD.
4. An Admin can invite a User, edit workspace data, access History, and restore a supported change.
5. Invitations, password reset, password update, email change confirmation, employee profile photos (including GIF), and profile visibility work with real Auth and Storage.
6. Work schedule and VL validations work against hosted Postgres, and two open sessions see realtime updates.

The local build and PGlite checks do not replace these hosted checks.
