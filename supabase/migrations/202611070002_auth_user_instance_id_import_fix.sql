-- Supabase Auth scopes user lookup to instance_id = uuid_nil().
-- The prior auth import omitted this column, so imported RUNBOOK users were
-- present in auth.users but invisible to Auth's login and admin APIs.
-- Limit the repair to RUNBOOK-mapped users and leave existing values intact.
update auth.users as auth_user
   set instance_id = '00000000-0000-0000-0000-000000000000'::uuid
  from public.app_accounts as account
 where account.user_id = auth_user.id
   and auth_user.instance_id is null;
