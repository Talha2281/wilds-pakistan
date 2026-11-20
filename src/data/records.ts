import { AnimalId, BiomeId, GameMode, PlayerRecord } from '../types/game';
import { fetchJsonSafe } from './auth';
import { getCurrentWeekKey, getTodayDateKey } from './dailyExpedition';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const STORAGE_KEY = 'wild_pakistan_records_v1';
const LAST_NAME_KEY = 'wild_pakistan_last_player_name';

export type BoardScope = 'all' | 'daily' | 'weekly';

export interface LeaderboardResult {
  records: PlayerRecord[];
  source: 'supabase' | 'server' | 'local';
  supabaseNote?: string;
}

const DEFAULT_SEED_RECORDS: PlayerRecord[] = [
  {
    id: 'seed-1',
    playerName: 'Amina K.',
    mode: 'wild_life',
    animalId: 'snow_leopard',
    biomeId: 'northern_mountains',
    score: 1850,
    elapsedSec: 112,
    victory: true,
    seed: 4812,
    timestamp: Date.now() - 86400000 * 3,
    summary: '5/5 Orbs · 4 Hunts',
    conservationScore: 76,
    growthStage: 'adult',
  },
  {
    id: 'seed-2',
    playerName: 'Zainab R.',
    mode: 'ranger_patrol',
    animalId: 'ranger',
    biomeId: 'ziarat_juniper',
    score: 2400,
    elapsedSec: 138,
    victory: true,
    seed: 9104,
    timestamp: Date.now() - 86400000 * 2,
    summary: '4 Arrests · 3 Rescues · 5 Snares',
    conservationScore: 88,
  },
  {
    id: 'seed-3',
    playerName: 'Hamza S.',
    mode: 'photo_safari',
    animalId: 'ranger',
    biomeId: 'deosai_plateau',
    score: 1620,
    elapsedSec: 94,
    victory: true,
    seed: 3321,
    timestamp: Date.now() - 86400000,
    summary: '5/5 Species Cataloged',
    conservationScore: 82,
  },
];

export function getLastPlayerName(): string {
  try {
    return localStorage.getItem(LAST_NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function setLastPlayerName(name: string): void {
  try {
    localStorage.setItem(LAST_NAME_KEY, name.trim());
  } catch {
    // Ignore storage errors
  }
}

export function loadLocalRecords(): PlayerRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SEED_RECORDS));
      return [...DEFAULT_SEED_RECORDS];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SEED_RECORDS];
    return parsed as PlayerRecord[];
  } catch {
    return [...DEFAULT_SEED_RECORDS];
  }
}

export function saveLocalRecord(record: PlayerRecord): PlayerRecord[] {
  const existing = loadLocalRecords();
  const deduped = [record, ...existing.filter((r) => r.id !== record.id)].slice(0, 80);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
  } catch {
    // Ignore storage quota errors
  }
  return deduped;
}

export interface SaveRecordResult {
  savedToSupabase: boolean;
  savedToServer: boolean;
  note?: string;
}

export interface SupabaseStatusResult {
  configured: boolean;
  connected: boolean;
  tableReady: boolean;
  syncedCount: number;
  totalServerRecords?: number;
  schemaSql?: string;
  note: string;
}

export const LEADERBOARD_SCHEMA_SQL = `-- Run in Supabase SQL Editor to enable Leaderboard, Secure Accounts (zero confirmation emails) & Feedback
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
create policy "Anyone can read ranger profiles" on public.player_profiles for select using (true);
drop policy if exists "Players can insert own profile" on public.player_profiles;
create policy "Players can insert own profile" on public.player_profiles for insert with check (char_length(ranger_name) <= 36 and xp >= 0);
drop policy if exists "Players can update profile" on public.player_profiles;
create policy "Players can update profile" on public.player_profiles for update using (true) with check (char_length(ranger_name) <= 36 and xp >= 0);

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
  if v_email !~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' then
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
  return jsonb_build_object('id', v_id, 'email', v_email, 'ranger_name', v_name, 'xp', v_xp, 'equipped_skins', '{}'::jsonb);
end;
$$;

create or replace function public.login_player(p_email text, p_password text)
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
  return jsonb_build_object('id', v_row.id, 'email', v_row.email, 'ranger_name', v_row.ranger_name, 'xp', v_row.xp, 'equipped_skins', v_row.equipped_skins);
end;
$$;

create or replace function public.sync_player_xp(p_id text, p_email text, p_xp integer, p_skins jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.player_accounts
  set xp = greatest(xp, greatest(0, coalesce(p_xp, 0))), equipped_skins = coalesce(p_skins, equipped_skins), updated_at = now()
  where id = p_id and email = lower(trim(coalesce(p_email, '')));
  update public.player_profiles
  set xp = greatest(xp, greatest(0, coalesce(p_xp, 0))), equipped_skins = coalesce(p_skins, equipped_skins), updated_at = now()
  where id = p_id;
end;
$$;

grant execute on function public.register_player(text, text, text, integer) to anon, authenticated;
grant execute on function public.login_player(text, text) to anon, authenticated;
grant execute on function public.sync_player_xp(text, text, integer, jsonb) to anon, authenticated;

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
create policy "Anyone can read feedback summaries" on public.player_feedback for select using (true);
drop policy if exists "Anyone can submit post-game feedback" on public.player_feedback;
create policy "Anyone can submit post-game feedback" on public.player_feedback for insert with check (rating >= 1 and rating <= 5 and char_length(comment) <= 1200);`;

export async function submitSharedRecord(record: PlayerRecord): Promise<SaveRecordResult> {
  const enriched: PlayerRecord = {
    ...record,
    dailyDate: record.dailyDate ?? (record.isDaily ? getTodayDateKey() : undefined),
    weekKey: record.weekKey ?? getCurrentWeekKey(),
  };

  saveLocalRecord(enriched);

  let savedToSupabase = false;
  let savedToServer = false;
  let note: string | undefined;

  const sb = getSupabaseClient();
  if (sb) {
    try {
      const { error } = await sb.from('leaderboard_entries').upsert(
        {
          id: enriched.id,
          player_name: enriched.playerName,
          round: enriched.round ?? 1,
          mode: enriched.mode,
          animal_id: enriched.animalId,
          biome_id: enriched.biomeId,
          score: enriched.score,
          elapsed_sec: Math.round(enriched.elapsedSec),
          victory: enriched.victory,
          seed: enriched.seed,
          is_daily: Boolean(enriched.isDaily),
          daily_date: enriched.dailyDate ?? null,
          week_key: enriched.weekKey ?? null,
          conservation_score: enriched.conservationScore ?? null,
          growth_stage: enriched.growthStage ?? null,
          summary: enriched.summary,
        },
        { onConflict: 'id' },
      );
      if (!error) {
        savedToSupabase = true;
      } else {
        note = error.message;
      }
    } catch {
      // Ignore network failure cleanly; local copy preserved
    }
  }

  // Also post to Express /api/leaderboard if running on full-stack server
  const apiRes = await fetchJsonSafe<{
    syncedSupabase?: boolean;
    supabaseNote?: string;
  }>('/api/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(enriched),
  });
  if (apiRes.ok && apiRes.data) {
    savedToServer = true;
    if (apiRes.data.syncedSupabase) {
      savedToSupabase = true;
      note = undefined;
    } else if (apiRes.data.supabaseNote) {
      note = apiRes.data.supabaseNote;
    }
  }

  return { savedToSupabase, savedToServer, note };
}

export async function verifyAndSyncSupabase(): Promise<SupabaseStatusResult> {
  const serverRes = await fetchJsonSafe<SupabaseStatusResult>('/api/supabase/verify', {
    method: 'POST',
  });
  if (serverRes.ok && serverRes.data) {
    return {
      ...serverRes.data,
      schemaSql: serverRes.data.schemaSql ?? LEADERBOARD_SCHEMA_SQL,
    };
  }

  const sb = getSupabaseClient();
  if (!sb) {
    return {
      configured: false,
      connected: false,
      tableReady: false,
      syncedCount: 0,
      schemaSql: LEADERBOARD_SCHEMA_SQL,
      note: 'Running in browser-only storage mode (no Supabase credentials configured).',
    };
  }

  try {
    const { error } = await sb.from('leaderboard_entries').select('id').limit(1);
    if (error) {
      return {
        configured: true,
        connected: false,
        tableReady: false,
        syncedCount: 0,
        schemaSql: LEADERBOARD_SCHEMA_SQL,
        note: `Supabase reachable, but leaderboard_entries returned: ${error.message}`,
      };
    }
    return {
      configured: true,
      connected: true,
      tableReady: true,
      syncedCount: 0,
      note: 'Supabase public.leaderboard_entries verified live.',
    };
  } catch {
    return {
      configured: true,
      connected: false,
      tableReady: false,
      syncedCount: 0,
      schemaSql: LEADERBOARD_SCHEMA_SQL,
      note: 'Supabase verification timed out.',
    };
  }
}

export async function fetchSharedLeaderboard(
  scope: BoardScope = 'all',
  modeFilter: GameMode | 'all' = 'all',
  limit = 12,
): Promise<LeaderboardResult> {
  const today = getTodayDateKey();
  const week = getCurrentWeekKey();

  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured) {
    try {
      let query = sb
        .from('leaderboard_entries')
        .select('*')
        .order('score', { ascending: false })
        .limit(limit);
      if (scope === 'daily') query = query.eq('daily_date', today);
      else if (scope === 'weekly') query = query.eq('week_key', week);
      if (modeFilter !== 'all') query = query.eq('mode', modeFilter);

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        const mapped: PlayerRecord[] = data.map((row) => ({
          id: String(row.id),
          playerName: String(row.player_name),
          round: Number(row.round) || 1,
          mode: row.mode as GameMode,
          animalId: row.animal_id as AnimalId,
          biomeId: row.biome_id as BiomeId,
          score: Number(row.score) || 0,
          elapsedSec: Number(row.elapsed_sec) || 0,
          victory: Boolean(row.victory),
          seed: Number(row.seed) || 0,
          timestamp: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
          summary: String(row.summary || ''),
          isDaily: Boolean(row.is_daily),
          dailyDate: row.daily_date ? String(row.daily_date) : undefined,
          weekKey: row.week_key ? String(row.week_key) : undefined,
          conservationScore:
            row.conservation_score != null ? Number(row.conservation_score) : undefined,
          growthStage: row.growth_stage ?? undefined,
        }));
        return { records: mapped, source: 'supabase' };
      }
    } catch {
      // Fall through
    }
  }

  const qs = new URLSearchParams({
    scope,
    mode: modeFilter,
    limit: String(limit),
    dailyDate: today,
    weekKey: week,
  });
  const apiRes = await fetchJsonSafe<{
    records?: PlayerRecord[];
    source?: 'supabase' | 'server';
    supabaseNote?: string;
  }>(`/api/leaderboard?${qs.toString()}`);
  if (apiRes.ok && apiRes.data && Array.isArray(apiRes.data.records)) {
    return {
      records: apiRes.data.records,
      source: apiRes.data.source === 'supabase' ? 'supabase' : 'server',
      supabaseNote: apiRes.data.supabaseNote,
    };
  }

  return {
    records: getTopLeaderboard(modeFilter, limit, scope),
    source: 'local',
  };
}

export function getTopLeaderboard(
  modeFilter?: GameMode | 'all',
  limit = 10,
  scope: BoardScope = 'all',
): PlayerRecord[] {
  const all = loadLocalRecords();
  const today = getTodayDateKey();
  const week = getCurrentWeekKey();
  const filtered = all.filter((r) => {
    if (modeFilter && modeFilter !== 'all' && r.mode !== modeFilter) return false;
    if (scope === 'daily') return r.isDaily && r.dailyDate === today;
    if (scope === 'weekly') return r.weekKey === week;
    return true;
  });
  return [...filtered].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function clearLocalRecords(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SEED_RECORDS));
  } catch {
    // Ignore
  }
}

export const MODE_LABELS: Record<GameMode, string> = {
  wild_life: 'Wild Life',
  ranger_patrol: 'Ranger Patrol',
  photo_safari: 'Photo Safari',
};

export function createRecordId(): string {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem.toString().padStart(2, '0')}`;
}

export function buildRecordSummary(params: {
  round?: number;
  mode: GameMode;
  orbsCollected: number;
  orbsTarget: number;
  preyCaught: number;
  poachersArrested: number;
  animalsRescued: number;
  snaresCleared: number;
  photosTaken: number;
  photosTarget: number;
  sRankCount?: number;
  rareShotsCount?: number;
  safariChallengeDone?: boolean;
}): string {
  const prefix = params.round && params.round > 1 ? `Rd ${params.round} · ` : '';
  if (params.mode === 'wild_life') {
    return `${prefix}${params.orbsCollected}/${params.orbsTarget} Orbs · ${params.preyCaught} Hunts`;
  }
  if (params.mode === 'ranger_patrol') {
    return `${prefix}${params.poachersArrested} Arrests · ${params.animalsRescued} Rescues · ${params.snaresCleared} Snares`;
  }
  const extras: string[] = [];
  if (params.sRankCount && params.sRankCount > 0) extras.push(`${params.sRankCount} S-Rank`);
  if (params.rareShotsCount && params.rareShotsCount > 0) extras.push(`${params.rareShotsCount} Rare+`);
  if (params.safariChallengeDone) extras.push('Challenge ✓');
  const tail = extras.length > 0 ? ` · ${extras.join(' · ')}` : '';
  return `${prefix}${params.photosTaken}/${params.photosTarget} Species${tail}`;
}

export function isAnimalBiomeHome(animalId: AnimalId, biomeId: BiomeId): boolean {
  if (animalId === 'snow_leopard') return biomeId === 'northern_mountains';
  if (animalId === 'markhor') return biomeId === 'ziarat_juniper';
  if (animalId === 'brown_bear') return biomeId === 'deosai_plateau';
  if (animalId === 'indus_dolphin') return biomeId === 'indus_river';
  return biomeId === 'thar_desert';
}
