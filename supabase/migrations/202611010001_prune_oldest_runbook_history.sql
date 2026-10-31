create or replace function public.prune_oldest_runbook_history(p_keep_newest integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare removed integer;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_keep_newest is null or p_keep_newest not between 1 and 100000 then
    raise exception 'Choose between 1 and 100,000 newest history records to keep.' using errcode = '22023';
  end if;

  delete from public.history_events
   where id in (
     select id
       from public.history_events
      order by created_at desc, id desc
     offset p_keep_newest
   );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Keep the legacy full-reset RPC functional for existing clients while making
-- its deletion explicit to SQL safety checks. The UI now uses the bounded prune RPC.
create or replace function public.reset_runbook_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare removed integer;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  delete from public.history_events where id in (select id from public.history_events);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_oldest_runbook_history(integer), public.reset_runbook_history() from public, anon;
grant execute on function public.prune_oldest_runbook_history(integer), public.reset_runbook_history() to authenticated;
