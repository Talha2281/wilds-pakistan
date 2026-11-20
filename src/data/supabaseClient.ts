import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function normalizeSupabaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  // Allow pasting a Supabase dashboard URL (https://supabase.com/dashboard/project/<ref>)
  const dashMatch = trimmed.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dashMatch) {
    return `https://${dashMatch[1]}.supabase.co`;
  }
  return trimmed;
}

const hasMetaEnv = typeof import.meta !== 'undefined' && Boolean(import.meta.env);
const supabaseUrl = normalizeSupabaseUrl(
  (hasMetaEnv ? (import.meta.env.VITE_SUPABASE_URL as string | undefined) : '') || '',
);
const supabaseKey = (
  (hasMetaEnv ? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) : '') || ''
).trim();

// Secret keys (sb_secret_...) must stay server-side; browser only uses anon/publishable keys.
const isBrowserSafeKey = Boolean(supabaseKey) && !supabaseKey.startsWith('sb_secret_');

export const isSupabaseConfigured = Boolean(supabaseUrl && isBrowserSafeKey);

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return cachedClient;
}
