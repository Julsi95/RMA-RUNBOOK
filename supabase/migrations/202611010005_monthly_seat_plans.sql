create table public.seat_month_plans (
  month_start date primary key check (extract(day from month_start)=1),
  plan jsonb not null check (jsonb_typeof(plan)='object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.seat_month_plans enable row level security;
revoke all on public.seat_month_plans from public, anon, authenticated;
grant select on public.seat_month_plans to anon, authenticated;
create policy "Published monthly seat plans are readable" on public.seat_month_plans for select to anon, authenticated using (true);

create or replace function public.save_seat_month_plan(p_month date,p_plan jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare before_state jsonb; actor text; event_id_value uuid; action_value text;
begin
  if not public.is_runbook_editor() then raise exception 'Editor access is required.' using errcode='42501'; end if;
  if p_month is null or extract(day from p_month)<>1 or coalesce(jsonb_typeof(p_plan),'')<>'object'
    or coalesce(jsonb_typeof(p_plan->'seatIds'),'array')<>'array'
    or coalesce(jsonb_typeof(p_plan->'leadershipSeatIds'),'array')<>'array'
    or coalesce(jsonb_typeof(p_plan->'assignments'),'object')<>'object'
    or length(coalesce(p_plan->>'note',''))>500 then
    raise exception 'A first-of-month date and valid seat plan are required.' using errcode='22023';
  end if;
  select plan into before_state from public.seat_month_plans where month_start=p_month for update;
  insert into public.seat_month_plans(month_start,plan,updated_by) values(p_month,p_plan,auth.uid())
  on conflict(month_start) do update set plan=excluded.plan,updated_at=now(),updated_by=auth.uid();
  select coalesce(nullif(a.display_name,''),'RUNBOOK editor') into actor from public.app_accounts a where a.user_id=auth.uid();
  action_value := case when before_state is null then 'create' else 'update' end;
  insert into public.history_events(actor_id,actor_label,module,entity_type,entity_id,action,summary,recoverable)
  values(auth.uid(),coalesce(actor,'RUNBOOK editor'),'Seat plan','seat_month_plans',to_char(p_month,'YYYY-MM'),action_value,
    initcap(action_value)||' monthly seat plan for '||to_char(p_month,'FMMonth YYYY')||'.',before_state is not null)
  returning id into event_id_value;
  if before_state is not null then
    insert into public.history_recovery(event_id,before_state,after_state,expires_at)
    values(event_id_value,before_state,p_plan,now()+interval '30 days');
  end if;
end;
$$;
revoke all on function public.save_seat_month_plan(date,jsonb) from public,anon;
grant execute on function public.save_seat_month_plan(date,jsonb) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='seat_month_plans') then
    alter publication supabase_realtime add table public.seat_month_plans;
  end if;
end $$;
