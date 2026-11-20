-- Supabase Schema for Wild Pakistan – The Last Wilderness
-- Includes Shared Leaderboard, Secure Accounts (zero confirmation emails), Profiles & Post-Game Feedback.
-- Run this entire script in your Supabase SQL Editor.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.leaderboard_entries (
  id text primary key,
  player_name text not null,
  round integer not null default 1,
  mode text not null,
  animal_id text not null,
  biome_id text not null,
  score integer not null default 0,
  elapsed_sec integer not null default 0,
  victory boolean not null default false,
  seed bigint not null default 0,
  is_daily boolean not null default false,
  daily_date text,
  week_key text,
  conservation_score integer,
  growth_stage text,
  summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_leaderboard_score on public.leaderboard_entries (score desc);
create index if not exists idx_leaderboard_daily on public.leaderboard_entries (daily_date, score desc);
create index if not exists idx_leaderboard_week on public.leaderboard_entries (week_key, score desc);

alter table public.leaderboard_entries enable row level security;

drop policy if exists "Anyone can read leaderboard" on public.leaderboard_entries;
create policy "Anyone can read leaderboard"
  on public.leaderboard_entries
  for select
  using (true);

drop policy if exists "Anyone can submit leaderboard score" on public.leaderboard_entries;
create policy "Anyone can submit leaderboard score"
  on public.leaderboard_entries
  for insert
  with check (score >= 0 and char_length(player_name) <= 32);

-- Private Player Credentials Table (RLS blocks all direct client reads/writes; accessed only via bcrypt SECURITY DEFINER RPCs)
create table if not exists public.player_accounts (
  id text primary key,
  email text unique not null,
  ranger_name text not null,
  password_hash text not null,
  xp integer not null default 0,
  equipped_skins jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_accounts enable row level security;

-- Public Ranger Profiles Summary
create table if not exists public.player_profiles (
  id text primary key,
  email text unique not null,
  ranger_name text not null,
  auth_provider text not null default 'supabase_db',
  xp integer not null default 0,
  equipped_skins jsonb not null default '{}'::jsonb,
  favorite_biome text default 'northern_mountains',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_player_profiles_email on public.player_profiles (email);

alter table public.player_profiles enable row level security;

drop policy if exists "Anyone can read ranger profiles" on public.player_profiles;
create policy "Anyone can read ranger profiles"
  on public.player_profiles
  for select
  using (true);

drop policy if exists "Players can insert own profile" on public.player_profiles;
create policy "Players can insert own profile"
  on public.player_profiles
  for insert
  with check (char_length(ranger_name) <= 36 and xp >= 0);

drop policy if exists "Players can update profile" on public.player_profiles;
create policy "Players can update profile"
  on public.player_profiles
  for update
  using (true)
  with check (char_length(ranger_name) <= 36 and xp >= 0);

-- Secure Instant Signup & Login RPCs (Zero Confirmation Emails, Bcrypt Password Hashing)
create or replace function public.register_player(
  p_email text,
  p_password text,
  p_ranger_name text,
  p_xp integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := left(trim(coalesce(p_ranger_name, '')), 28);
  v_id text := 'acc-' || gen_random_uuid()::text;
  v_hash text;
  v_xp integer := greatest(0, coalesce(p_xp, 0));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;
  if length(v_name) < 2 then
    v_name := left(split_part(v_email, '@', 1), 28);
  end if;

  if exists (select 1 from public.player_accounts where email = v_email) then
    raise exception 'An account with this email already exists. Please log in.';
  end if;

  v_hash := crypt(p_password, gen_salt('bf', 10));

  insert into public.player_accounts (id, email, ranger_name, password_hash, xp)
  values (v_id, v_email, v_name, v_hash, v_xp);

  insert into public.player_profiles (id, email, ranger_name, auth_provider, xp)
  values (v_id, v_email, v_name, 'supabase_db', v_xp)
  on conflict (id) do update
    set ranger_name = excluded.ranger_name,
        xp = greatest(public.player_profiles.xp, excluded.xp),
        updated_at = now();

  return jsonb_build_object(
    'id', v_id,
    'email', v_email,
    'ranger_name', v_name,
    'xp', v_xp,
    'equipped_skins', '{}'::jsonb
  );
end;
$$;

create or replace function public.login_player(
  p_email text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row public.player_accounts%rowtype;
begin
  select * into v_row from public.player_accounts where email = v_email limit 1;
  if not found or v_row.password_hash <> crypt(coalesce(p_password, ''), v_row.password_hash) then
    raise exception 'Invalid email or password.';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'email', v_row.email,
    'ranger_name', v_row.ranger_name,
    'xp', v_row.xp,
    'equipped_skins', v_row.equipped_skins
  );
end;
$$;

create or replace function public.sync_player_xp(
  p_id text,
  p_email text,
  p_xp integer,
  p_skins jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.player_accounts
  set
    xp = greatest(xp, greatest(0, coalesce(p_xp, 0))),
    equipped_skins = coalesce(p_skins, equipped_skins),
    updated_at = now()
  where id = p_id and email = lower(trim(coalesce(p_email, '')));

  update public.player_profiles
  set
    xp = greatest(xp, greatest(0, coalesce(p_xp, 0))),
    equipped_skins = coalesce(p_skins, equipped_skins),
    updated_at = now()
  where id = p_id;
end;
$$;

grant execute on function public.register_player(text, text, text, integer) to anon, authenticated;
grant execute on function public.login_player(text, text) to anon, authenticated;
grant execute on function public.sync_player_xp(text, text, integer, jsonb) to anon, authenticated;

-- Post-Game Player Feedback (Backed up in Supabase + synced to Google Sheets)
create table if not exists public.player_feedback (
  id text primary key,
  player_name text not null,
  user_email text,
  rating integer not null check (rating >= 1 and rating <= 5),
  category text not null,
  mode text not null,
  animal_id text not null,
  biome_id text not null,
  score integer not null default 0,
  round integer not null default 1,
  victory boolean not null default false,
  comment text not null default '',
  sheet_synced boolean not null default false,
  spreadsheet_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_player_feedback_created on public.player_feedback (created_at desc);

alter table public.player_feedback enable row level security;

drop policy if exists "Anyone can read feedback summaries" on public.player_feedback;
create policy "Anyone can read feedback summaries"
  on public.player_feedback
  for select
  using (true);

drop policy if exists "Anyone can submit post-game feedback" on public.player_feedback;
create policy "Anyone can submit post-game feedback"
  on public.player_feedback
  for insert
  with check (rating >= 1 and rating <= 5 and char_length(comment) <= 1200);
