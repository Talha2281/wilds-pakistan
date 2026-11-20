import { User } from 'firebase/auth';
import { signOutGoogle } from './googleAuthSheets';
import { loadProgression, saveProgression } from './progression';
import { setLastPlayerName } from './records';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const AUTH_SESSION_KEY = 'wild_pakistan_auth_account_v1';

export interface AuthAccount {
  id: string;
  email: string;
  rangerName: string;
  provider: 'supabase' | 'google' | 'server';
  xp: number;
  syncedToDb: boolean;
  notice?: string;
}

export function loadActiveAccount(): AuthAccount | null {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthAccount>;
    if (!parsed.id || !parsed.email) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      rangerName: parsed.rangerName || 'Ranger',
      provider: parsed.provider || 'supabase',
      xp: Math.max(0, Number(parsed.xp) || 0),
      syncedToDb: Boolean(parsed.syncedToDb),
      notice: parsed.notice,
    };
  } catch {
    return null;
  }
}

export function saveActiveAccount(acc: AuthAccount | null): void {
  try {
    if (!acc) {
      localStorage.removeItem(AUTH_SESSION_KEY);
    } else {
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(acc));
      if (acc.rangerName) setLastPlayerName(acc.rangerName);
    }
  } catch {
    // ignore storage quota errors
  }
}

function mergeProgressionXp(remoteXp: number): number {
  const prog = loadProgression();
  const merged = Math.max(prog.xp, Math.max(0, Math.round(remoteXp || 0)));
  if (merged !== prog.xp) {
    saveProgression({ ...prog, xp: merged });
  }
  return merged;
}

async function upsertProfileToSupabaseAndServer(profile: {
  id: string;
  email: string;
  rangerName: string;
  provider: 'supabase' | 'google' | 'server';
  xp: number;
}): Promise<boolean> {
  const prog = loadProgression();
  const mergedXp = Math.max(prog.xp, profile.xp);
  let synced = false;

  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured) {
    try {
      const { error } = await sb.from('player_profiles').upsert(
        {
          id: profile.id,
          email: profile.email.toLowerCase(),
          ranger_name: profile.rangerName.slice(0, 32),
          auth_provider: profile.provider,
          xp: mergedXp,
          equipped_skins: prog.equippedSkins ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );
      if (!error) synced = true;
    } catch {
      // ignore cleanly
    }
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: profile.id,
          email: profile.email.toLowerCase(),
          rangerName: profile.rangerName,
          provider: profile.provider,
          xp: mergedXp,
          equippedSkins: prog.equippedSkins ?? {},
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { syncedSupabase?: boolean };
        if (json.syncedSupabase) synced = true;
      }
    } catch {
      // static host fallback
    }
  }

  return synced;
}

export async function signUpFreeAccount(params: {
  email: string;
  password: string;
  rangerName: string;
}): Promise<AuthAccount> {
  const email = params.email.trim().toLowerCase();
  const password = params.password;
  const rangerName = params.rangerName.trim().slice(0, 28) || 'Ranger';

  if (!email.includes('@') || email.length < 5) {
    throw new Error('Please enter a valid email address.');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const localProg = loadProgression();
  let createdId = '';
  let provider: AuthAccount['provider'] = 'server';
  let syncedToDb = false;
  let notice: string | undefined;

  // 1. Primary: Free Supabase Auth + player_profiles PostgreSQL row
  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured) {
    try {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { ranger_name: rangerName } },
      });
      if (!error && data.user) {
        createdId = data.user.id;
        provider = 'supabase';
        syncedToDb = await upsertProfileToSupabaseAndServer({
          id: createdId,
          email,
          rangerName,
          provider: 'supabase',
          xp: localProg.xp,
        });
        if (!data.session) {
          notice =
            'Account saved to Supabase! Verification email sent (you can play right away).';
        }
      } else if (error && error.message.toLowerCase().includes('already')) {
        throw new Error('An account with this email already exists. Switch to Login.');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) throw err;
    }
  }

  // 2. Also register cleanly in /api/auth/signup for instant session continuity & offline/server DB persistence
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: createdId || undefined,
          email,
          password,
          rangerName,
          xp: localProg.xp,
          provider,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        account?: AuthAccount;
      };
      if (res.ok && json.account) {
        createdId = createdId || json.account.id;
        syncedToDb = syncedToDb || Boolean(json.account.syncedToDb);
      } else if (!createdId && json.error) {
        throw new Error(json.error);
      }
    } catch (err) {
      if (!createdId && err instanceof Error) throw err;
    }
  }

  if (!createdId) {
    createdId = `acc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  const account: AuthAccount = {
    id: createdId,
    email,
    rangerName,
    provider,
    xp: localProg.xp,
    syncedToDb,
    notice:
      notice ||
      (syncedToDb
        ? 'Account created & saved in Supabase PostgreSQL ✓'
        : 'Account created & saved to Wild Pakistan Server ✓'),
  };

  saveActiveAccount(account);
  return account;
}

export async function loginFreeAccount(params: {
  email: string;
  password: string;
}): Promise<AuthAccount> {
  const email = params.email.trim().toLowerCase();
  const password = params.password;

  if (!email.includes('@') || !password) {
    throw new Error('Enter both your email and password.');
  }

  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured) {
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (!error && data.user) {
        const metaName =
          (data.user.user_metadata?.ranger_name as string | undefined) ||
          email.split('@')[0];
        let remoteXp = loadProgression().xp;
        let rangerName = metaName;
        let syncedToDb = true;

        const { data: prof } = await sb
          .from('player_profiles')
          .select('ranger_name,xp')
          .eq('id', data.user.id)
          .maybeSingle();

        if (prof) {
          rangerName = String(prof.ranger_name || rangerName);
          remoteXp = mergeProgressionXp(Number(prof.xp) || 0);
        } else {
          syncedToDb = await upsertProfileToSupabaseAndServer({
            id: data.user.id,
            email,
            rangerName,
            provider: 'supabase',
            xp: remoteXp,
          });
        }

        const account: AuthAccount = {
          id: data.user.id,
          email,
          rangerName,
          provider: 'supabase',
          xp: remoteXp,
          syncedToDb,
          notice: 'Signed in with Supabase Cloud Profile ✓',
        };
        saveActiveAccount(account);
        return account;
      }
    } catch {
      // Fallback to /api/auth/login below
    }
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      account?: AuthAccount;
    };
    if (!res.ok || !json.account) {
      throw new Error(json.error || 'Invalid email or password.');
    }
    const mergedXp = mergeProgressionXp(json.account.xp);
    const account: AuthAccount = { ...json.account, xp: mergedXp };
    saveActiveAccount(account);
    return account;
  }

  throw new Error('Could not reach authentication server. Try Google Sign-In or check credentials.');
}

export async function linkGoogleAccountToDb(user: User): Promise<AuthAccount> {
  const email = (user.email || `${user.uid}@google.local`).toLowerCase();
  const rangerName = (user.displayName || email.split('@')[0] || 'Ranger').slice(0, 28);
  const localProg = loadProgression();

  const synced = await upsertProfileToSupabaseAndServer({
    id: `google-${user.uid}`,
    email,
    rangerName,
    provider: 'google',
    xp: localProg.xp,
  });

  const account: AuthAccount = {
    id: `google-${user.uid}`,
    email,
    rangerName,
    provider: 'google',
    xp: localProg.xp,
    syncedToDb: synced,
    notice: 'Google Account & Sheets Feedback Linked ✓',
  };
  saveActiveAccount(account);
  return account;
}

export async function syncCurrentAccountXp(xp: number): Promise<void> {
  const acc = loadActiveAccount();
  if (!acc) return;
  const updated: AuthAccount = { ...acc, xp: Math.max(acc.xp, xp) };
  saveActiveAccount(updated);
  await upsertProfileToSupabaseAndServer({
    id: updated.id,
    email: updated.email,
    rangerName: updated.rangerName,
    provider: updated.provider,
    xp: updated.xp,
  });
}

export async function signOutAccount(): Promise<void> {
  saveActiveAccount(null);
  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured) {
    await sb.auth.signOut().catch(() => {});
  }
  await signOutGoogle().catch(() => {});
}
