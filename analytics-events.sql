-- ============================================================
-- Analysis: optional rich event store (Supabase)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Used by tracker.js when you add data-supabase-url / data-supabase-key,
-- and by the workspace "Chatbot" tab for exact latency percentiles.
-- ============================================================

create table if not exists public.analytics_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  site        text not null check (site in ('nexora', 'discipline', 'dashboard')),
  name        text not null check (char_length(name) between 1 and 40),
  props       jsonb not null default '{}'::jsonb check (pg_column_size(props) < 2000),
  visitor_id  text check (char_length(visitor_id) <= 40),   -- random, per browser, no personal data
  session_id  text check (char_length(session_id) <= 40)
);

create index if not exists analytics_events_site_name_idx on public.analytics_events (site, name, created_at desc);
create index if not exists analytics_events_created_idx   on public.analytics_events (created_at desc);

alter table public.analytics_events enable row level security;

-- Visitors may INSERT events only. There is no SELECT policy, so rows cannot be read with the anon key.
create policy "Allow public insert" on public.analytics_events
  for insert to anon, authenticated with check (true);

-- Aggregates only: lets the dashboard read totals and percentiles without exposing any row.
create or replace function public.analytics_summary(p_site text default 'nexora', p_days int default 14)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with ev as (
    select * from public.analytics_events
    where site = p_site and created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
  ),
  lat as (select (props->>'ms')::numeric as ms from ev where name = 'chat_reply' and props ? 'ms')
  select jsonb_build_object(
    'visitors',      (select count(distinct visitor_id) from ev),
    'sessions',      (select count(distinct session_id) from ev),
    'conversations', (select count(*) from ev where name = 'chat_conversation_start'),
    'messages',      (select count(*) from ev where name = 'chat_message'),
    'replies',       (select count(*) from ev where name = 'chat_reply'),
    'errors',        (select count(*) from ev where name = 'chat_error'),
    'up',            (select count(*) from ev where name = 'chat_feedback' and props->>'kind' = 'up'),
    'down',          (select count(*) from ev where name = 'chat_feedback' and props->>'kind' = 'down'),
    'p50_ms',        (select percentile_cont(0.50) within group (order by ms) from lat),
    'p95_ms',        (select percentile_cont(0.95) within group (order by ms) from lat),
    'p99_ms',        (select percentile_cont(0.99) within group (order by ms) from lat),
    'avg_messages_per_conversation',
                     (select avg((props->>'messages')::numeric) from ev where name = 'chat_conversation_end')
  );
$$;

revoke all on function public.analytics_summary(text, int) from public;
grant execute on function public.analytics_summary(text, int) to anon, authenticated;

-- Optional housekeeping: keep 180 days
-- delete from public.analytics_events where created_at < now() - interval '180 days';
