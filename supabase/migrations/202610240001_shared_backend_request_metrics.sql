-- Aggregate short-lived backend request metrics across all RUNBOOK visitors.
-- Only one weekly aggregate row is retained; individual requests are never stored.
create table if not exists public.runbook_backend_request_metrics (
  singleton boolean primary key default true check (singleton),
  week_start date not null,
  total bigint not null default 0 check (total >= 0),
  failed bigint not null default 0 check (failed >= 0),
  slowest_ms integer not null default 0 check (slowest_ms >= 0),
  by_page jsonb not null default '{}'::jsonb,
  by_category jsonb not null default '{}'::jsonb,
  last_at timestamptz
);

alter table public.runbook_backend_request_metrics enable row level security;
revoke all on public.runbook_backend_request_metrics from public, anon, authenticated;
grant select on public.runbook_backend_request_metrics to authenticated;
drop policy if exists "Administrators read shared backend request metrics" on public.runbook_backend_request_metrics;
create policy "Administrators read shared backend request metrics"
  on public.runbook_backend_request_metrics for select to authenticated
  using (public.is_current_runbook_session() and public.is_runbook_admin());

create or replace function public.get_runbook_backend_request_metrics()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_week_start date := timezone('UTC', now())::date - extract(dow from timezone('UTC', now())::date)::integer;
  v_metrics public.runbook_backend_request_metrics%rowtype;
begin
  if auth.uid() is null or not public.is_current_runbook_session() or not public.is_runbook_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  select * into v_metrics from public.runbook_backend_request_metrics where singleton;
  if not found or v_metrics.week_start <> v_week_start then
    return pg_catalog.jsonb_build_object(
      'week_start', v_week_start, 'total', 0, 'failed', 0, 'slowest_ms', 0,
      'by_page', '{}'::jsonb, 'by_category', '{}'::jsonb, 'last_at', null
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'week_start', v_metrics.week_start, 'total', v_metrics.total, 'failed', v_metrics.failed,
    'slowest_ms', v_metrics.slowest_ms, 'by_page', v_metrics.by_page,
    'by_category', v_metrics.by_category, 'last_at', v_metrics.last_at
  );
end;
$$;
revoke all on function public.get_runbook_backend_request_metrics() from public, anon;
grant execute on function public.get_runbook_backend_request_metrics() to authenticated;

create or replace function public.record_runbook_backend_request_metrics(
  p_total integer,
  p_failed integer,
  p_slowest_ms integer,
  p_by_page jsonb,
  p_by_category jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_week_start date := timezone('UTC', now())::date - extract(dow from timezone('UTC', now())::date)::integer;
  v_metrics public.runbook_backend_request_metrics%rowtype;
  v_page_counts jsonb;
  v_category_counts jsonb;
  v_page_total integer;
  v_category_total integer;
begin
  if auth.uid() is not null and not public.is_current_runbook_session() then
    raise exception 'A valid RUNBOOK session is required.' using errcode = '42501';
  end if;
  if p_total is null or p_total < 1 or p_total > 5000
     or p_failed is null or p_failed < 0 or p_failed > p_total
     or p_slowest_ms is null or p_slowest_ms < 0 or p_slowest_ms > 300000
     or pg_catalog.jsonb_typeof(p_by_page) <> 'object'
     or pg_catalog.jsonb_typeof(p_by_category) <> 'object' then
    raise exception 'Invalid backend request metric batch.' using errcode = '22023';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_each_text(p_by_category) as metric(key, value)
    where metric.key not in ('Database API','Authentication','Storage API','Edge Function','Realtime HTTP','Supabase API')
       or metric.value !~ '^[1-9][0-9]{0,5}$'
  ) or exists (
    select 1 from pg_catalog.jsonb_each_text(p_by_page) as metric(key, value)
    where metric.key not in (
      '/','/login','/forgot-password','/reset-password','/setup-password','/organizational',
      '/agent-profiles','/app-links','/holidays','/admin/dashboard','/seat-plan','/projects',
      '/inbound-call-time','/work-schedule','/wfh-privileges','/vl-credits','/admin/qa-parameters',
      '/history','/notifications','/kpi-qa','/admin/kpi-scoring','/settings','/profile'
    ) or metric.value !~ '^[1-9][0-9]{0,5}$'
  ) then
    raise exception 'Invalid backend request metric dimensions.' using errcode = '22023';
  end if;

  select coalesce(sum(metric.value::integer), 0) into v_page_total
    from pg_catalog.jsonb_each_text(p_by_page) as metric(key, value);
  select coalesce(sum(metric.value::integer), 0) into v_category_total
    from pg_catalog.jsonb_each_text(p_by_category) as metric(key, value);
  if v_page_total <> p_total or v_category_total <> p_total then
    raise exception 'Metric dimensions must sum to the request total.' using errcode = '22023';
  end if;

  insert into public.runbook_backend_request_metrics(singleton, week_start)
    values (true, v_week_start) on conflict (singleton) do nothing;
  select * into v_metrics from public.runbook_backend_request_metrics where singleton for update;

  if v_metrics.week_start = v_week_start then
    select pg_catalog.jsonb_object_agg(dim.key,
      pg_catalog.to_jsonb(coalesce((v_metrics.by_page ->> dim.key)::bigint, 0) + coalesce((p_by_page ->> dim.key)::bigint, 0)))
      into v_page_counts
      from (select pg_catalog.jsonb_object_keys(v_metrics.by_page) as key union select pg_catalog.jsonb_object_keys(p_by_page)) as dim;
    select pg_catalog.jsonb_object_agg(dim.key,
      pg_catalog.to_jsonb(coalesce((v_metrics.by_category ->> dim.key)::bigint, 0) + coalesce((p_by_category ->> dim.key)::bigint, 0)))
      into v_category_counts
      from (select pg_catalog.jsonb_object_keys(v_metrics.by_category) as key union select pg_catalog.jsonb_object_keys(p_by_category)) as dim;
    update public.runbook_backend_request_metrics set
      total = v_metrics.total + p_total,
      failed = v_metrics.failed + p_failed,
      slowest_ms = greatest(v_metrics.slowest_ms, p_slowest_ms),
      by_page = coalesce(v_page_counts, '{}'::jsonb),
      by_category = coalesce(v_category_counts, '{}'::jsonb),
      last_at = now()
    where singleton;
  else
    update public.runbook_backend_request_metrics set
      week_start = v_week_start, total = p_total, failed = p_failed,
      slowest_ms = p_slowest_ms, by_page = p_by_page,
      by_category = p_by_category, last_at = now()
    where singleton;
  end if;
end;
$$;
revoke all on function public.record_runbook_backend_request_metrics(integer,integer,integer,jsonb,jsonb) from public;
grant execute on function public.record_runbook_backend_request_metrics(integer,integer,integer,jsonb,jsonb) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'runbook_backend_request_metrics') then
    alter publication supabase_realtime add table public.runbook_backend_request_metrics;
  end if;
end; $$;
