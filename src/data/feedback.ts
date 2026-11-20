import { fetchJsonSafe } from './auth';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { AnimalId, BiomeId, GameMode } from '../types/game';

const FEEDBACK_STORAGE_KEY = 'wild_pakistan_feedback_v1';

export type FeedbackCategory =
  | 'Gameplay & Controls'
  | '3D Graphics & Biomes'
  | 'Photo Safari'
  | 'Sound & Audio'
  | 'Bug Report'
  | 'Feature Request';

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  'Gameplay & Controls',
  '3D Graphics & Biomes',
  'Photo Safari',
  'Sound & Audio',
  'Bug Report',
  'Feature Request',
];

export interface PlayerFeedbackEntry {
  id: string;
  createdAtIso: string;
  playerName: string;
  userEmail?: string;
  rating: number;
  category: FeedbackCategory;
  mode: GameMode;
  animalId: AnimalId;
  biomeId: BiomeId;
  round: number;
  score: number;
  victory: boolean;
  comment: string;
  sheetSynced?: boolean;
  spreadsheetId?: string;
}

export interface SubmitFeedbackResult {
  savedToSupabase: boolean;
  savedToServer: boolean;
  savedToGoogleSheet: boolean;
  note?: string;
}

export function buildFeedbackEntry(params: {
  playerName: string;
  userEmail?: string;
  rating: number;
  category: FeedbackCategory;
  mode: GameMode;
  animalId: AnimalId;
  biomeId: BiomeId;
  round: number;
  score: number;
  victory: boolean;
  comment: string;
}): PlayerFeedbackEntry {
  const clampedRating = Math.min(5, Math.max(1, Math.round(params.rating || 5)));
  return {
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAtIso: new Date().toISOString(),
    playerName: params.playerName.trim().slice(0, 32) || 'Ranger',
    userEmail: params.userEmail?.trim().slice(0, 80) || undefined,
    rating: clampedRating,
    category: params.category,
    mode: params.mode,
    animalId: params.animalId,
    biomeId: params.biomeId,
    round: Math.max(1, Math.round(params.round || 1)),
    score: Math.max(0, Math.round(params.score || 0)),
    victory: Boolean(params.victory),
    comment: params.comment.trim().slice(0, 1200),
  };
}

export function loadLocalFeedback(): PlayerFeedbackEntry[] {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlayerFeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

function saveLocalFeedback(entry: PlayerFeedbackEntry): void {
  const list = [entry, ...loadLocalFeedback()].slice(0, 40);
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

export async function submitPlayerFeedback(
  entry: PlayerFeedbackEntry,
): Promise<SubmitFeedbackResult> {
  let savedToSupabase = false;
  let savedToServer = false;
  let savedToGoogleSheet = false;

  const envWebhook =
    typeof import.meta !== 'undefined' && import.meta.env
      ? String(import.meta.env.VITE_SHEETS_WEBHOOK_URL || '').trim()
      : '';
  const envSheetId =
    typeof import.meta !== 'undefined' && import.meta.env
      ? String(import.meta.env.VITE_FEEDBACK_SHEET_ID || '').trim()
      : '';

  // 1. Direct Google Apps Script Webhook (works from both static GitHub Pages & local dev without OAuth popups!)
  if (envWebhook) {
    try {
      // Apps Script Web Apps accept text/plain POST cleanly without triggering CORS preflight rejection
      const whRes = await fetch(envWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(entry),
      });
      if (whRes.ok || whRes.type === 'opaque') {
        savedToGoogleSheet = true;
      }
    } catch {
      // Try Express server webhook below if available
    }
  }

  const enriched: PlayerFeedbackEntry = {
    ...entry,
    sheetSynced: savedToGoogleSheet,
    spreadsheetId: envSheetId || undefined,
  };
  saveLocalFeedback(enriched);

  // 2. Supabase database persistence (public.player_feedback)
  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured) {
    try {
      const { error } = await sb.from('player_feedback').upsert(
        {
          id: enriched.id,
          player_name: enriched.playerName,
          user_email: enriched.userEmail ?? null,
          rating: enriched.rating,
          category: enriched.category,
          mode: enriched.mode,
          animal_id: enriched.animalId,
          biome_id: enriched.biomeId,
          score: enriched.score,
          round: enriched.round,
          victory: enriched.victory,
          comment: enriched.comment,
          sheet_synced: Boolean(enriched.sheetSynced),
          spreadsheet_id: enriched.spreadsheetId ?? null,
        },
        { onConflict: 'id' },
      );
      if (!error) savedToSupabase = true;
    } catch {
      // ignore cleanly
    }
  }

  // 3. Express backend fallback (safely skips static GitHub Pages 404 HTML)
  const apiRes = await fetchJsonSafe<{
    syncedSupabase?: boolean;
    syncedSheetWebhook?: boolean;
  }>('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(enriched),
  });
  if (apiRes.ok && apiRes.data) {
    savedToServer = true;
    if (apiRes.data.syncedSupabase) savedToSupabase = true;
    if (apiRes.data.syncedSheetWebhook) savedToGoogleSheet = true;
  }

  return {
    savedToSupabase,
    savedToServer,
    savedToGoogleSheet,
  };
}
