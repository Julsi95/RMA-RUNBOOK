-- Supabase Auth scans these token and pending-change fields as non-null strings.
-- Imported rows must use '' for unused tokens and NULL only for timestamps.
update auth.users as auth_user
   set confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change_token_current = coalesce(email_change_token_current, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change = coalesce(email_change, ''),
       phone_change_token = coalesce(phone_change_token, ''),
       phone_change = coalesce(phone_change, ''),
       reauthentication_token = coalesce(reauthentication_token, '')
  from public.app_accounts as account
 where account.user_id = auth_user.id
   and (auth_user.confirmation_token is null
     or auth_user.recovery_token is null
     or auth_user.email_change_token_current is null
     or auth_user.email_change_token_new is null
     or auth_user.email_change is null
     or auth_user.phone_change_token is null
     or auth_user.phone_change is null
     or auth_user.reauthentication_token is null);
