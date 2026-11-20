import express from 'express';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

interface LeaderboardRecord {
  id: string;
  playerName: string;
  round?: number;
  mode: string;
  animalId: string;
  biomeId: string;
  score: number;
  elapsedSec: number;
  victory: boolean;
  seed: number;
  timestamp: number;
  summary: string;
  isDaily?: boolean;
  dailyDate?: string;
  weekKey?: string;
  conservationScore?: number;
  growthStage?: string;
}

interface RoomPeer {
  peerId: string;
  playerName: string;
  animalId: string;
  skinId?: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  gait: string;
  growthStage?: string;
  updatedAt: number;
  socket: WebSocket;
}

interface CoopRoom {
  code: string;
  squadMode: 'rangers' | 'wolf_pack';
  biomeId: string;
  mode: string;
  seed: number;
  peers: Map<string, RoomPeer>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const serverRecords: LeaderboardRecord[] = [
  {
    id: 'srv-seed-1',
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
    id: 'srv-seed-2',
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
    id: 'srv-seed-3',
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

const rooms = new Map<string, CoopRoom>();

interface ServerAccountRecord {
  id: string;
  email: string;
  rangerName: string;
  provider: 'supabase' | 'google' | 'server';
  passwordHash?: string;
  salt?: string;
  xp: number;
  updatedAt: number;
}

interface ServerFeedbackRecord {
  id: string;
  createdAtIso: string;
  playerName: string;
  userEmail?: string;
  rating: number;
  category: string;
  mode: string;
  animalId: string;
  biomeId: string;
  round: number;
  score: number;
  victory: boolean;
  comment: string;
  sheetSynced?: boolean;
  spreadsheetId?: string;
}

const serverAccountsByEmail = new Map<string, ServerAccountRecord>();
const serverFeedbackList: ServerFeedbackRecord[] = [];

function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return { hash, salt: actualSalt };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function normalizeSupabaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const dashMatch = trimmed.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dashMatch) {
    return `https://${dashMatch[1]}.supabase.co`;
  }
  return trimmed;
}

function getSupabaseRestConfig(): { url: string; key: string } | null {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '');
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!url || !key) return null;
  return { url, key };
}

function mapSupabaseRowToRecord(row: Record<string, unknown>): LeaderboardRecord {
  return {
    id: String(row.id ?? ''),
    playerName: String(row.player_name ?? 'Ranger'),
    round: Number(row.round) || 1,
    mode: String(row.mode ?? 'wild_life'),
    animalId: String(row.animal_id ?? 'snow_leopard'),
    biomeId: String(row.biome_id ?? 'northern_mountains'),
    score: Number(row.score) || 0,
    elapsedSec: Number(row.elapsed_sec) || 0,
    victory: Boolean(row.victory),
    seed: Number(row.seed) || 0,
    timestamp: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
    summary: String(row.summary ?? ''),
    isDaily: Boolean(row.is_daily),
    dailyDate: row.daily_date ? String(row.daily_date) : undefined,
    weekKey: row.week_key ? String(row.week_key) : undefined,
    conservationScore:
      row.conservation_score != null ? Number(row.conservation_score) : undefined,
    growthStage: row.growth_stage ? String(row.growth_stage) : undefined,
  };
}

async function fetchSupabaseRecords(params: {
  scope: string;
  mode: string;
  limit: number;
  dailyDate: string;
  weekKey: string;
}): Promise<{ ok: true; records: LeaderboardRecord[] } | { ok: false; note: string }> {
  const cfg = getSupabaseRestConfig();
  if (!cfg) {
    return { ok: false, note: 'Supabase credentials not set in server environment' };
  }
  try {
    const qs = new URLSearchParams({
      select: '*',
      order: 'score.desc',
      limit: String(params.limit),
    });
    if (params.mode !== 'all') qs.set('mode', `eq.${params.mode}`);
    if (params.scope === 'daily' && params.dailyDate) qs.set('daily_date', `eq.${params.dailyDate}`);
    else if (params.scope === 'weekly' && params.weekKey) qs.set('week_key', `eq.${params.weekKey}`);

    const res = await fetch(`${cfg.url}/rest/v1/leaderboard_entries?${qs.toString()}`, {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const note =
        res.status === 404 || errText.includes('leaderboard_entries')
          ? 'Supabase connected, but public.leaderboard_entries table is missing (run supabase/schema.sql)'
          : `Supabase REST returned ${res.status}`;
      return { ok: false, note };
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return { ok: true, records: rows.map(mapSupabaseRowToRecord) };
  } catch {
    return { ok: false, note: 'Supabase REST request timed out or unreachable' };
  }
}

const LEADERBOARD_SCHEMA_SQL = `-- Run in Supabase SQL Editor to enable Leaderboard, Accounts & Feedback persistence
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

async function upsertSupabaseRecord(
  record: LeaderboardRecord,
): Promise<{ ok: boolean; note?: string }> {
  const cfg = getSupabaseRestConfig();
  if (!cfg) return { ok: false, note: 'Supabase credentials not set in server environment' };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/leaderboard_entries?on_conflict=id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        id: record.id,
        player_name: record.playerName,
        round: record.round ?? 1,
        mode: record.mode,
        animal_id: record.animalId,
        biome_id: record.biomeId,
        score: record.score,
        elapsed_sec: Math.round(record.elapsedSec),
        victory: record.victory,
        seed: record.seed,
        is_daily: Boolean(record.isDaily),
        daily_date: record.dailyDate ?? null,
        week_key: record.weekKey ?? null,
        conservation_score: record.conservationScore ?? null,
        growth_stage: record.growthStage ?? null,
        summary: record.summary,
      }),
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) return { ok: true };
    const note =
      res.status === 404
        ? 'Missing public.leaderboard_entries table — run supabase/schema.sql'
        : `Supabase REST write returned HTTP ${res.status}`;
    return { ok: false, note };
  } catch {
    return { ok: false, note: 'Supabase REST request timed out or unreachable' };
  }
}

function sanitizePeer(peer: RoomPeer) {
  return {
    peerId: peer.peerId,
    playerName: peer.playerName,
    animalId: peer.animalId,
    skinId: peer.skinId,
    x: peer.x,
    y: peer.y,
    z: peer.z,
    heading: peer.heading,
    gait: peer.gait,
    growthStage: peer.growthStage,
    updatedAt: peer.updatedAt,
  };
}

function broadcastToRoom(room: CoopRoom, payload: unknown, excludePeerId?: string) {
  const raw = JSON.stringify(payload);
  for (const [pid, peer] of room.peers.entries()) {
    if (excludePeerId && pid === excludePeerId) continue;
    if (peer.socket.readyState === WebSocket.OPEN) {
      peer.socket.send(raw);
    }
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    const cfg = getSupabaseRestConfig();
    let supabaseConnected = false;
    let profilesReady = false;
    let feedbackReady = false;
    let supabaseNote = cfg ? 'Ready' : 'Not configured';
    if (cfg) {
      try {
        const [lbProbe, profProbe, fbProbe] = await Promise.all([
          fetch(`${cfg.url}/rest/v1/leaderboard_entries?select=id&limit=1`, {
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
            signal: AbortSignal.timeout(2500),
          }),
          fetch(`${cfg.url}/rest/v1/player_profiles?select=id&limit=1`, {
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
            signal: AbortSignal.timeout(2500),
          }),
          fetch(`${cfg.url}/rest/v1/player_feedback?select=id&limit=1`, {
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
            signal: AbortSignal.timeout(2500),
          }),
        ]);
        supabaseConnected = lbProbe.ok;
        profilesReady = profProbe.ok;
        feedbackReady = fbProbe.ok;
        if (!lbProbe.ok) {
          supabaseNote =
            lbProbe.status === 404
              ? 'Missing public.leaderboard_entries table — run supabase/schema.sql'
              : `HTTP ${lbProbe.status}`;
        } else if (!profilesReady || !feedbackReady) {
          supabaseNote =
            'Leaderboard live ✓ — run updated supabase/schema.sql to enable Accounts & Feedback tables in Supabase';
        }
      } catch {
        supabaseNote = 'Connection timed out';
      }
    }
    const sheetsWebhookConfigured = Boolean(
      (process.env.SHEETS_WEBHOOK_URL || process.env.VITE_SHEETS_WEBHOOK_URL || '').trim(),
    );
    const feedbackSheetIdConfigured = Boolean(
      (process.env.VITE_FEEDBACK_SHEET_ID || process.env.FEEDBACK_SHEET_ID || '').trim(),
    );
    res.json({
      ok: true,
      rooms: rooms.size,
      records: serverRecords.length,
      supabase: {
        configured: Boolean(cfg),
        connected: supabaseConnected,
        tables: {
          leaderboard: supabaseConnected,
          profiles: profilesReady,
          feedback: feedbackReady,
        },
        note: supabaseNote,
      },
      sheets: {
        webhookConfigured: sheetsWebhookConfigured,
        sheetIdConfigured: feedbackSheetIdConfigured,
      },
    });
  });

  app.get('/api/leaderboard', async (req, res) => {
    const scope = String(req.query.scope || 'all');
    const mode = String(req.query.mode || 'all');
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
    const dailyDate = String(req.query.dailyDate || '');
    const weekKey = String(req.query.weekKey || '');

    const sbRes = await fetchSupabaseRecords({ scope, mode, limit, dailyDate, weekKey });
    if (sbRes.ok) {
      res.json({ records: sbRes.records, source: 'supabase' });
      return;
    }

    const filtered = serverRecords.filter((r) => {
      if (mode !== 'all' && r.mode !== mode) return false;
      if (scope === 'daily') return Boolean(r.isDaily) && (!dailyDate || r.dailyDate === dailyDate);
      if (scope === 'weekly') return !weekKey || r.weekKey === weekKey;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => b.score - a.score).slice(0, limit);
    res.json({ records: sorted, source: 'server', supabaseNote: sbRes.note });
  });

  app.post('/api/leaderboard', async (req, res) => {
    const body = req.body as Partial<LeaderboardRecord>;
    if (!body || typeof body.id !== 'string' || typeof body.playerName !== 'string') {
      res.status(400).json({ error: 'Invalid record payload' });
      return;
    }
    const cleanRecord: LeaderboardRecord = {
      id: body.id.slice(0, 64),
      playerName: body.playerName.trim().slice(0, 28) || 'Ranger',
      round: Math.max(1, Number(body.round || 1)),
      mode: String(body.mode || 'wild_life'),
      animalId: String(body.animalId || 'snow_leopard'),
      biomeId: String(body.biomeId || 'northern_mountains'),
      score: Math.max(0, Math.round(Number(body.score || 0))),
      elapsedSec: Math.max(0, Number(body.elapsedSec || 0)),
      victory: Boolean(body.victory),
      seed: Number(body.seed || 0),
      timestamp: Number(body.timestamp || Date.now()),
      summary: String(body.summary || '').slice(0, 120),
      isDaily: Boolean(body.isDaily),
      dailyDate: body.dailyDate ? String(body.dailyDate) : undefined,
      weekKey: body.weekKey ? String(body.weekKey) : undefined,
      conservationScore:
        body.conservationScore != null ? Number(body.conservationScore) : undefined,
      growthStage: body.growthStage ? String(body.growthStage) : undefined,
    };

    const idx = serverRecords.findIndex((r) => r.id === cleanRecord.id);
    if (idx >= 0) serverRecords[idx] = cleanRecord;
    else serverRecords.unshift(cleanRecord);

    if (serverRecords.length > 200) serverRecords.length = 200;
    const sbWrite = await upsertSupabaseRecord(cleanRecord);
    res.status(201).json({
      ok: true,
      record: cleanRecord,
      syncedSupabase: sbWrite.ok,
      supabaseNote: sbWrite.note,
    });
  });

  app.post('/api/supabase/verify', async (_req, res) => {
    const cfg = getSupabaseRestConfig();
    if (!cfg) {
      res.json({
        configured: false,
        connected: false,
        tableReady: false,
        syncedCount: 0,
        schemaSql: LEADERBOARD_SCHEMA_SQL,
        note: 'Supabase credentials not set in server environment.',
      });
      return;
    }

    try {
      const probe = await fetch(`${cfg.url}/rest/v1/leaderboard_entries?select=id&limit=1`, {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
        signal: AbortSignal.timeout(3000),
      });

      if (!probe.ok) {
        const note =
          probe.status === 404
            ? 'Supabase host reached, but public.leaderboard_entries table does not exist yet — run supabase/schema.sql in Supabase SQL Editor.'
            : `Supabase probe returned HTTP ${probe.status}`;
        res.json({
          configured: true,
          connected: false,
          tableReady: false,
          syncedCount: 0,
          schemaSql: LEADERBOARD_SCHEMA_SQL,
          note,
        });
        return;
      }

      const [profProbe, fbProbe] = await Promise.all([
        fetch(`${cfg.url}/rest/v1/player_profiles?select=id&limit=1`, {
          headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
          signal: AbortSignal.timeout(2500),
        }),
        fetch(`${cfg.url}/rest/v1/player_feedback?select=id&limit=1`, {
          headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
          signal: AbortSignal.timeout(2500),
        }),
      ]);

      let syncedCount = 0;
      for (const rec of serverRecords) {
        const w = await upsertSupabaseRecord(rec);
        if (w.ok) syncedCount += 1;
      }

      const missingExtra: string[] = [];
      if (!profProbe.ok) missingExtra.push('player_profiles');
      if (!fbProbe.ok) missingExtra.push('player_feedback');

      res.json({
        configured: true,
        connected: true,
        tableReady: missingExtra.length === 0,
        syncedCount,
        totalServerRecords: serverRecords.length,
        schemaSql: LEADERBOARD_SCHEMA_SQL,
        note:
          missingExtra.length === 0
            ? `Supabase connected! All 3 tables verified & synced ${syncedCount} leaderboard record(s).`
            : `Leaderboard connected (${syncedCount} synced). Run updated supabase/schema.sql to add: ${missingExtra.join(', ')}.`,
      });
    } catch {
      res.json({
        configured: true,
        connected: false,
        tableReady: false,
        syncedCount: 0,
        schemaSql: LEADERBOARD_SCHEMA_SQL,
        note: 'Supabase REST request timed out or host unreachable.',
      });
    }
  });

  app.post('/api/auth/signup', async (req, res) => {
    const body = req.body as {
      id?: string;
      email?: string;
      password?: string;
      rangerName?: string;
      xp?: number;
      provider?: 'supabase' | 'google' | 'server';
    };
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const rangerName = String(body?.rangerName || 'Ranger').trim().slice(0, 28) || 'Ranger';

    if (!email.includes('@') || email.length < 5) {
      res.status(400).json({ error: 'Valid email is required.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const existing = serverAccountsByEmail.get(email);
    if (existing && existing.passwordHash && !body.id) {
      res.status(409).json({ error: 'Account already exists for this email. Please sign in.' });
      return;
    }

    const cfg = getSupabaseRestConfig();
    let supabaseUserId = body.id ? String(body.id).slice(0, 64) : '';
    let provider: 'supabase' | 'google' | 'server' = body.provider || 'server';

    if (cfg && !supabaseUserId) {
      try {
        const authRes = await fetch(`${cfg.url}/auth/v1/signup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.key,
          },
          body: JSON.stringify({
            email,
            password,
            data: { ranger_name: rangerName },
          }),
          signal: AbortSignal.timeout(3500),
        });
        if (authRes.ok) {
          const authJson = (await authRes.json()) as { user?: { id?: string }; id?: string };
          const uid = authJson.user?.id || authJson.id;
          if (uid) {
            supabaseUserId = String(uid);
            provider = 'supabase';
          }
        }
      } catch {
        // fallback cleanly to server account creation
      }
    }

    const { hash, salt } = hashPassword(password);
    const id = supabaseUserId || `acc-${crypto.randomUUID()}`;
    const xp = Math.max(existing?.xp ?? 0, Math.max(0, Math.round(Number(body?.xp || 0))));

    const stored: ServerAccountRecord = {
      id,
      email,
      rangerName,
      provider,
      passwordHash: hash,
      salt,
      xp,
      updatedAt: Date.now(),
    };
    serverAccountsByEmail.set(email, stored);

    let syncedSupabase = false;
    if (cfg) {
      try {
        const sbRes = await fetch(`${cfg.url}/rest/v1/player_profiles?on_conflict=id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            id: stored.id,
            email: stored.email,
            ranger_name: stored.rangerName,
            auth_provider: stored.provider,
            xp: stored.xp,
          }),
          signal: AbortSignal.timeout(3000),
        });
        syncedSupabase = sbRes.ok;
      } catch {
        // ignore cleanly
      }
    }

    res.status(201).json({
      ok: true,
      account: {
        id: stored.id,
        email: stored.email,
        rangerName: stored.rangerName,
        provider: stored.provider,
        xp: stored.xp,
        syncedToDb: syncedSupabase || provider === 'supabase',
      },
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const body = req.body as { email?: string; password?: string };
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');

    const cfg = getSupabaseRestConfig();
    if (cfg) {
      try {
        const authRes = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.key,
          },
          body: JSON.stringify({ email, password }),
          signal: AbortSignal.timeout(3500),
        });
        if (authRes.ok) {
          const authJson = (await authRes.json()) as {
            user?: { id: string; user_metadata?: { ranger_name?: string } };
          };
          if (authJson.user?.id) {
            let rangerName = authJson.user.user_metadata?.ranger_name || email.split('@')[0];
            let xp = 0;
            const profRes = await fetch(
              `${cfg.url}/rest/v1/player_profiles?select=ranger_name,xp&id=eq.${encodeURIComponent(authJson.user.id)}&limit=1`,
              {
                headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
                signal: AbortSignal.timeout(2500),
              },
            );
            if (profRes.ok) {
              const rows = (await profRes.json()) as Array<{ ranger_name?: string; xp?: number }>;
              if (rows[0]) {
                rangerName = rows[0].ranger_name || rangerName;
                xp = Number(rows[0].xp || 0);
              }
            }
            res.json({
              ok: true,
              account: {
                id: authJson.user.id,
                email,
                rangerName,
                provider: 'supabase',
                xp,
                syncedToDb: true,
              },
            });
            return;
          }
        }
      } catch {
        // fall through to local server verification
      }
    }

    const stored = serverAccountsByEmail.get(email);
    if (!stored || !stored.salt || !stored.passwordHash) {
      res.status(401).json({ error: 'Account not found or password not verified.' });
      return;
    }
    if (!verifyPassword(password, stored.salt, stored.passwordHash)) {
      res.status(401).json({ error: 'Incorrect password.' });
      return;
    }

    res.json({
      ok: true,
      account: {
        id: stored.id,
        email: stored.email,
        rangerName: stored.rangerName,
        provider: stored.provider,
        xp: stored.xp,
        syncedToDb: true,
      },
    });
  });

  app.post('/api/profiles', async (req, res) => {
    const body = req.body as {
      id?: string;
      email?: string;
      rangerName?: string;
      provider?: 'supabase' | 'google' | 'server';
      xp?: number;
      equippedSkins?: Record<string, string>;
    };
    const email = String(body?.email || '').trim().toLowerCase();
    if (!email || !body?.id) {
      res.status(400).json({ error: 'Invalid profile payload' });
      return;
    }
    const prev = serverAccountsByEmail.get(email);
    const updated: ServerAccountRecord = {
      id: String(body.id).slice(0, 64),
      email,
      rangerName: String(body.rangerName || prev?.rangerName || 'Ranger').slice(0, 28),
      provider: body.provider || prev?.provider || 'server',
      passwordHash: prev?.passwordHash,
      salt: prev?.salt,
      xp: Math.max(prev?.xp ?? 0, Math.max(0, Math.round(Number(body.xp || 0)))),
      updatedAt: Date.now(),
    };
    serverAccountsByEmail.set(email, updated);

    let syncedSupabase = false;
    const cfg = getSupabaseRestConfig();
    if (cfg) {
      try {
        const sbRes = await fetch(`${cfg.url}/rest/v1/player_profiles?on_conflict=id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            id: updated.id,
            email: updated.email,
            ranger_name: updated.rangerName,
            auth_provider: updated.provider,
            xp: updated.xp,
            equipped_skins: body.equippedSkins ?? {},
          }),
          signal: AbortSignal.timeout(3000),
        });
        syncedSupabase = sbRes.ok;
      } catch {
        // ignore cleanly
      }
    }

    res.json({ ok: true, syncedSupabase });
  });

  app.get('/api/feedback', async (_req, res) => {
    const cfg = getSupabaseRestConfig();
    if (cfg) {
      try {
        const sbRes = await fetch(
          `${cfg.url}/rest/v1/player_feedback?select=*&order=created_at.desc&limit=25`,
          {
            headers: {
              apikey: cfg.key,
              Authorization: `Bearer ${cfg.key}`,
            },
            signal: AbortSignal.timeout(3000),
          },
        );
        if (sbRes.ok) {
          const rows = (await sbRes.json()) as Array<Record<string, unknown>>;
          res.json({ feedback: rows, source: 'supabase' });
          return;
        }
      } catch {
        // fall through to server memory
      }
    }
    res.json({ feedback: serverFeedbackList.slice(0, 25), source: 'server' });
  });

  app.post('/api/feedback', async (req, res) => {
    const body = req.body as Partial<ServerFeedbackRecord>;
    if (!body || typeof body.id !== 'string' || typeof body.playerName !== 'string') {
      res.status(400).json({ error: 'Invalid feedback payload' });
      return;
    }

    const clean: ServerFeedbackRecord = {
      id: body.id.slice(0, 64),
      createdAtIso: String(body.createdAtIso || new Date().toISOString()),
      playerName: body.playerName.trim().slice(0, 32) || 'Ranger',
      userEmail: body.userEmail ? String(body.userEmail).slice(0, 80) : undefined,
      rating: Math.min(5, Math.max(1, Math.round(Number(body.rating || 5)))),
      category: String(body.category || 'Gameplay & Controls').slice(0, 48),
      mode: String(body.mode || 'wild_life').slice(0, 32),
      animalId: String(body.animalId || 'snow_leopard').slice(0, 32),
      biomeId: String(body.biomeId || 'northern_mountains').slice(0, 32),
      round: Math.max(1, Math.round(Number(body.round || 1))),
      score: Math.max(0, Math.round(Number(body.score || 0))),
      victory: Boolean(body.victory),
      comment: String(body.comment || '').slice(0, 1200),
      sheetSynced: Boolean(body.sheetSynced),
      spreadsheetId: body.spreadsheetId ? String(body.spreadsheetId).slice(0, 120) : undefined,
    };

    serverFeedbackList.unshift(clean);
    if (serverFeedbackList.length > 120) serverFeedbackList.length = 120;

    let syncedSupabase = false;
    const cfg = getSupabaseRestConfig();
    if (cfg) {
      try {
        const sbRes = await fetch(`${cfg.url}/rest/v1/player_feedback?on_conflict=id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            id: clean.id,
            player_name: clean.playerName,
            user_email: clean.userEmail ?? null,
            rating: clean.rating,
            category: clean.category,
            mode: clean.mode,
            animal_id: clean.animalId,
            biome_id: clean.biomeId,
            score: clean.score,
            round: clean.round,
            victory: clean.victory,
            comment: clean.comment,
            sheet_synced: Boolean(clean.sheetSynced),
            spreadsheet_id: clean.spreadsheetId ?? null,
          }),
          signal: AbortSignal.timeout(3000),
        });
        syncedSupabase = sbRes.ok;
      } catch {
        // ignore cleanly
      }
    }

    let syncedSheetWebhook = false;
    const sheetWebhook = (
      process.env.SHEETS_WEBHOOK_URL ||
      process.env.VITE_SHEETS_WEBHOOK_URL ||
      ''
    ).trim();
    if (sheetWebhook && !clean.sheetSynced) {
      try {
        const wh = await fetch(sheetWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clean),
          signal: AbortSignal.timeout(3500),
        });
        syncedSheetWebhook = wh.ok;
      } catch {
        // ignore cleanly
      }
    }

    res.status(201).json({
      ok: true,
      feedback: clean,
      syncedSupabase,
      syncedSheetWebhook,
    });
  });


  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws:
          process.env.DISABLE_HMR === 'true'
            ? false
            : { server, path: '/__vite_hmr' },
        hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      },
      appType: 'mpa',
    });
    if (process.env.DISABLE_HMR === 'true') {
      app.get(/\/@vite\/client$/, async (_req, res, next) => {
        try {
          const result = await vite.environments.client.transformRequest('/@vite/client');
          if (!result?.code) {
            next();
            return;
          }
          const patched = result.code
            .replace('await wsTransport.connect(handlers);', 'return;')
            .replace('wsTransport.send(data);', 'return;');
          res.setHeader('Content-Type', 'application/javascript');
          res.send(patched);
        } catch {
          next();
        }
      });
    }
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/game', (_req, res) => {
      res.sendFile(path.join(distDir, 'game/index.html'));
    });
    app.get('/game/', (_req, res) => {
      res.sendFile(path.join(distDir, 'game/index.html'));
    });
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (socket) => {
    let joinedRoomCode: string | null = null;
    let joinedPeerId: string | null = null;

    socket.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');
      if (type === 'join') {
        const roomCode = String(msg.roomCode || 'PK-WILD')
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, '')
          .slice(0, 16) || 'PK-WILD';
        const peerId = String(msg.peerId || `p-${Date.now()}`).slice(0, 48);
        const squadMode = msg.squadMode === 'wolf_pack' ? 'wolf_pack' : 'rangers';

        let room = rooms.get(roomCode);
        if (!room) {
          room = {
            code: roomCode,
            squadMode,
            biomeId: String(msg.biomeId || 'northern_mountains'),
            mode: String(msg.mode || (squadMode === 'rangers' ? 'ranger_patrol' : 'wild_life')),
            seed: Number(msg.seed || (Date.now() % 900000) + 10000),
            peers: new Map(),
          };
          rooms.set(roomCode, room);
        }

        joinedRoomCode = roomCode;
        joinedPeerId = peerId;

        const peer: RoomPeer = {
          peerId,
          playerName: String(msg.playerName || 'Ranger').slice(0, 24),
          animalId: String(msg.animalId || 'ranger'),
          skinId: msg.skinId ? String(msg.skinId) : undefined,
          x: Number(msg.x || 0),
          y: Number(msg.y || 0),
          z: Number(msg.z || 0),
          heading: Number(msg.heading || 0),
          gait: String(msg.gait || 'idle'),
          growthStage: msg.growthStage ? String(msg.growthStage) : 'adult',
          updatedAt: Date.now(),
          socket,
        };
        room.peers.set(peerId, peer);

        const existingPeers = Array.from(room.peers.values())
          .filter((p) => p.peerId !== peerId)
          .map(sanitizePeer);

        socket.send(
          JSON.stringify({
            type: 'room_welcome',
            roomCode: room.code,
            squadMode: room.squadMode,
            biomeId: room.biomeId,
            mode: room.mode,
            seed: room.seed,
            peers: existingPeers,
          }),
        );

        broadcastToRoom(
          room,
          { type: 'peer_update', peer: sanitizePeer(peer) },
          peerId,
        );
      } else if (type === 'state' && joinedRoomCode && joinedPeerId) {
        const room = rooms.get(joinedRoomCode);
        const peer = room?.peers.get(joinedPeerId);
        if (!room || !peer) return;

        peer.x = Math.max(-440, Math.min(440, Number(msg.x || 0)));
        peer.y = Math.max(-20, Math.min(80, Number(msg.y || 0)));
        peer.z = Math.max(-440, Math.min(440, Number(msg.z || 0)));
        peer.heading = Number(msg.heading || 0);
        peer.gait = String(msg.gait || 'idle');
        if (msg.animalId) peer.animalId = String(msg.animalId);
        if (msg.skinId) peer.skinId = String(msg.skinId);
        if (msg.growthStage) peer.growthStage = String(msg.growthStage);
        peer.updatedAt = Date.now();

        broadcastToRoom(
          room,
          { type: 'peer_update', peer: sanitizePeer(peer) },
          joinedPeerId,
        );
      } else if (type === 'coop_event' && joinedRoomCode && joinedPeerId) {
        const room = rooms.get(joinedRoomCode);
        if (!room) return;
        broadcastToRoom(
          room,
          {
            type: 'coop_event',
            peerId: joinedPeerId,
            playerName: String(msg.playerName || 'Teammate'),
            eventType: String(msg.eventType || ''),
            label: String(msg.label || ''),
          },
          joinedPeerId,
        );
      }
    });

    socket.on('close', () => {
      if (!joinedRoomCode || !joinedPeerId) return;
      const room = rooms.get(joinedRoomCode);
      if (!room) return;
      room.peers.delete(joinedPeerId);
      broadcastToRoom(room, { type: 'peer_left', peerId: joinedPeerId });
      if (room.peers.size === 0) {
        rooms.delete(joinedRoomCode);
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Wild Pakistan server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
