-- Supabase Schema for Wild Pakistan – The Last Wilderness Shared Leaderboard & Daily/Weekly Challenges
-- Run this in your Supabase SQL Editor if connecting an external Supabase project.

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

create policy "Anyone can read leaderboard"
  on public.leaderboard_entries
  for select
  using (true);

create policy "Anyone can submit leaderboard score"
  on public.leaderboard_entries
  for insert
  with check (score >= 0 and char_length(player_name) <= 32);

-- Player Accounts / Cloud Profiles (Free Tier Auth + XP Sync)
create table if not exists public.player_profiles (
  id text primary key,
  email text unique not null,
  ranger_name text not null,
  auth_provider text not null default 'supabase',
  xp integer not null default 0,
  equipped_skins jsonb not null default '{}'::jsonb,
  favorite_biome text default 'northern_mountains',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_player_profiles_email on public.player_profiles (email);

alter table public.player_profiles enable row level security;

create policy "Anyone can read ranger profiles"
  on public.player_profiles
  for select
  using (true);

create policy "Players can insert own profile"
  on public.player_profiles
  for insert
  with check (char_length(ranger_name) <= 36 and xp >= 0);

create policy "Players can update profile"
  on public.player_profiles
  for update
  using (true)
  with check (char_length(ranger_name) <= 36 and xp >= 0);

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

create policy "Anyone can read feedback summaries"
  on public.player_feedback
  for select
  using (true);

create policy "Anyone can submit post-game feedback"
  on public.player_feedback
  for insert
  with check (rating >= 1 and rating <= 5 and char_length(comment) <= 1200);

