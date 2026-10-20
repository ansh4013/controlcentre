-- ============================================================
-- Nexora Login → Supabase
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Create the table
create table if not exists public.nexora_logins (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  name          text not null,
  email         text not null,
  role          text,
  interest      text,
  message       text,
  page          text,
  user_agent    text,
  ip_hint       text   -- optional, leave null if you don't collect it
);

-- 2. Helpful indexes
create index if not exists nexora_logins_created_at_idx on public.nexora_logins (created_at desc);
create index if not exists nexora_logins_email_idx on public.nexora_logins (email);

-- 3. Enable Row Level Security
alter table public.nexora_logins enable row level security;

-- 4. Policy: anyone (anon) can INSERT only
--    They cannot read, update, or delete other rows.
create policy "Allow public insert"
  on public.nexora_logins
  for insert
  to anon, authenticated
  with check (true);

-- 5. Policy: only you (authenticated / service role) can SELECT
--    Leave this restricted so visitors cannot list everyone else's data.
--    (You view data in the Supabase Table Editor or with the service_role key.)
create policy "Allow owner select"
  on public.nexora_logins
  for select
  to authenticated
  using (true);

-- Optional: if you later want a public "count" without exposing rows,
-- create a security-definer function. Not required for the login form.

-- Done. After running this, go to Table Editor → nexora_logins to see rows.
