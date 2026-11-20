import { AnimalId, BiomeId, GameMode, PlayerRecord } from '../types/game';
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

export const LEADERBOARD_SCHEMA_SQL = `-- Run in Supabase SQL Editor to enable Leaderboard, Accounts & Feedback persistence
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
create policy "Anyone can read ranger profiles" on public.player_profiles for select using (true);
create policy "Players can insert own profile" on public.player_profiles for insert with check (char_length(ranger_name) <= 36 and xp >= 0);
create policy "Players can update profile" on public.player_profiles for update using (true) with check (char_length(ranger_name) <= 36 and xp >= 0);

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
create policy "Anyone can read feedback summaries" on public.player_feedback for select using (true);
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
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enriched),
      });
      if (res.ok) {
        savedToServer = true;
        const json = (await res.json()) as {
          syncedSupabase?: boolean;
          supabaseNote?: string;
        };
        if (json.syncedSupabase) {
          savedToSupabase = true;
          note = undefined;
        } else if (json.supabaseNote) {
          note = json.supabaseNote;
        }
      }
    } catch {
      // Static GitHub Pages has no /api route; ignore cleanly
    }
  }

  return { savedToSupabase, savedToServer, note };
}

export async function verifyAndSyncSupabase(): Promise<SupabaseStatusResult> {
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    try {
      const res = await fetch('/api/supabase/verify', { method: 'POST' });
      if (res.ok) {
        const json = (await res.json()) as SupabaseStatusResult;
        return {
          ...json,
          schemaSql: json.schemaSql ?? LEADERBOARD_SCHEMA_SQL,
        };
      }
    } catch {
      // Fall through to browser-side Supabase check
    }
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

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    try {
      const qs = new URLSearchParams({
        scope,
        mode: modeFilter,
        limit: String(limit),
        dailyDate: today,
        weekKey: week,
      });
      const res = await fetch(`/api/leaderboard?${qs.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as {
          records?: PlayerRecord[];
          source?: 'supabase' | 'server';
          supabaseNote?: string;
        };
        if (Array.isArray(json.records)) {
          return {
            records: json.records,
            source: json.source === 'supabase' ? 'supabase' : 'server',
            supabaseNote: json.supabaseNote,
          };
        }
      }
    } catch {
      // Fall through to local records
    }
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
