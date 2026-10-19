-- Allow signed-in Users to render employee photos that are marked visible.
-- The previous public-workspace policy was anon-only, while User directory RPCs
-- return visible photo paths to authenticated accounts as well.
drop policy if exists "Anonymous read visible employee profile photos" on storage.objects;
drop policy if exists "Read visible employee profile photos" on storage.objects;

create policy "Read visible employee profile photos" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'runbook-private'
    and public.can_read_public_runbook_profile_photo(name)
    and (auth.role() = 'anon' or public.is_current_runbook_session())
  );
