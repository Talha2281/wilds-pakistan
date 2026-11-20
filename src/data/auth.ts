import { loadProgression, saveProgression } from './progression';
import { setLastPlayerName } from './records';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const AUTH_SESSION_KEY = 'wild_pakistan_auth_session_v2';
const LOCAL_VAULT_KEY = 'wild_pakistan_local_accounts_v2';

export interface AuthAccount {
  id: string;
  email: string;
  rangerName: string;
  provider: 'supabase_db' | 'server' | 'local';
  xp: number;
  syncedToDb: boolean;
  notice?: string;
}

interface LocalVaultRecord {
  id: string;
  email: string;
  rangerName: string;
  saltHex: string;
  hashHex: string;
  xp: number;
}

export async function fetchJsonSafe<T>(
  input: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) {
    return { ok: false, status: 0, data: null };
  }
  try {
    const res = await fetch(input, init);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      return { ok: false, status: res.status, data: null };
    }
    const data = (await res.json()) as T;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export function loadActiveAccount(): AuthAccount | null {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthAccount>;
    if (!parsed.id || !parsed.email || !parsed.email.includes('@')) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      rangerName: parsed.rangerName || 'Ranger',
      provider: parsed.provider || 'supabase_db',
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

async function hashPasswordPbkdf2(password: string, saltHex?: string): Promise<{ saltHex: string; hashHex: string }> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('Secure WebCrypto is unavailable in this browser context.');
  }
  const actualSalt =
    saltHex ||
    Array.from(cryptoApi.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await cryptoApi.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(actualSalt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  const hashHex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { saltHex: actualSalt, hashHex };
}

function loadLocalVault(): Record<string, LocalVaultRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_VAULT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LocalVaultRecord>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalVault(vault: Record<string, LocalVaultRecord>): void {
  try {
    localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(vault));
  } catch {
    // ignore
  }
}

export async function signUpFreeAccount(params: {
  email: string;
  password: string;
  rangerName: string;
}): Promise<AuthAccount> {
  const email = params.email.trim().toLowerCase();
  const password = params.password;
  const rangerName = params.rangerName.trim().slice(0, 28) || 'Ranger';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  if (rangerName.length < 2) {
    throw new Error('Please enter a Ranger name (at least 2 characters).');
  }

  const localProg = loadProgression();

  // 1. Primary Production Path: Direct Supabase PostgreSQL bcrypt RPC (zero confirmation emails, works on GitHub Pages!)
  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured) {
    const { data, error } = await sb.rpc('register_player', {
      p_email: email,
      p_password: password,
      p_ranger_name: rangerName,
      p_xp: localProg.xp,
    });
    if (!error && data) {
      const row = data as { id: string; email: string; ranger_name: string; xp: number };
      const account: AuthAccount = {
        id: row.id,
        email: row.email,
        rangerName: row.ranger_name || rangerName,
        provider: 'supabase_db',
        xp: mergeProgressionXp(Number(row.xp) || localProg.xp),
        syncedToDb: true,
        notice: 'Account created & saved in Supabase Database ✓',
      };
      saveActiveAccount(account);
      return account;
    }
    if (error) {
      const msg = error.message || '';
      if (msg.toLowerCase().includes('already exists')) {
        throw new Error('An account with this email already exists. Switch to Sign In.');
      }
      if (!msg.toLowerCase().includes('could not find the function')) {
        throw new Error(msg);
      }
    }
  }

  // 2. Full-Stack Express API (when hosted on Node server; safely ignores GitHub Pages 404 HTML)
  const apiRes = await fetchJsonSafe<{
    ok?: boolean;
    error?: string;
    account?: AuthAccount;
  }>('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      rangerName,
      xp: localProg.xp,
    }),
  });
  if (apiRes.data?.account) {
    const account: AuthAccount = {
      ...apiRes.data.account,
      xp: mergeProgressionXp(apiRes.data.account.xp),
      notice: apiRes.data.account.syncedToDb
        ? 'Account created & saved in Supabase Database ✓'
        : 'Account created & saved on Server ✓',
    };
    saveActiveAccount(account);
    return account;
  }
  if (apiRes.status === 409 && apiRes.data?.error) {
    throw new Error(apiRes.data.error);
  }
  if (apiRes.status >= 400 && apiRes.status !== 404 && apiRes.data?.error) {
    throw new Error(apiRes.data.error);
  }

  // 3. Static Fallback (PBKDF2-salted WebCrypto credential vault when static host has no VITE_SUPABASE_* baked in)
  const vault = loadLocalVault();
  if (vault[email]) {
    throw new Error('An account with this email already exists on this device. Please Sign In.');
  }
  const { saltHex, hashHex } = await hashPasswordPbkdf2(password);
  const id = `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  vault[email] = {
    id,
    email,
    rangerName,
    saltHex,
    hashHex,
    xp: localProg.xp,
  };
  saveLocalVault(vault);

  const localAccount: AuthAccount = {
    id,
    email,
    rangerName,
    provider: 'local',
    xp: localProg.xp,
    syncedToDb: false,
    notice: 'Account saved securely on this device ✓',
  };
  saveActiveAccount(localAccount);
  return localAccount;
}

export async function loginFreeAccount(params: {
  email: string;
  password: string;
}): Promise<AuthAccount> {
  const email = params.email.trim().toLowerCase();
  const password = params.password;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
    throw new Error('Please enter both your email and password.');
  }

  // 1. Primary Production Path: Direct Supabase PostgreSQL bcrypt RPC
  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured) {
    const { data, error } = await sb.rpc('login_player', {
      p_email: email,
      p_password: password,
    });
    if (!error && data) {
      const row = data as { id: string; email: string; ranger_name: string; xp: number };
      const account: AuthAccount = {
        id: row.id,
        email: row.email,
        rangerName: row.ranger_name || 'Ranger',
        provider: 'supabase_db',
        xp: mergeProgressionXp(Number(row.xp) || 0),
        syncedToDb: true,
        notice: 'Signed in & synced from Supabase Database ✓',
      };
      saveActiveAccount(account);
      return account;
    }
    if (error && !error.message.toLowerCase().includes('could not find the function')) {
      throw new Error(error.message || 'Invalid email or password.');
    }
  }

  // 2. Full-Stack Express API fallback (safely skips GitHub Pages HTML 404s)
  const apiRes = await fetchJsonSafe<{
    ok?: boolean;
    error?: string;
    account?: AuthAccount;
  }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (apiRes.ok && apiRes.data?.account) {
    const account: AuthAccount = {
      ...apiRes.data.account,
      xp: mergeProgressionXp(apiRes.data.account.xp),
      notice: 'Signed in cleanly ✓',
    };
    saveActiveAccount(account);
    return account;
  }
  if (apiRes.status === 401 && apiRes.data?.error) {
    throw new Error(apiRes.data.error);
  }

  // 3. Static Fallback (verify salted PBKDF2 hash locally)
  const vault = loadLocalVault();
  const localRec = vault[email];
  if (!localRec) {
    throw new Error('No account found for this email. Create a free account first.');
  }
  const { hashHex } = await hashPasswordPbkdf2(password, localRec.saltHex);
  if (hashHex !== localRec.hashHex) {
    throw new Error('Incorrect password.');
  }

  const localAccount: AuthAccount = {
    id: localRec.id,
    email: localRec.email,
    rangerName: localRec.rangerName,
    provider: 'local',
    xp: mergeProgressionXp(localRec.xp),
    syncedToDb: false,
    notice: 'Signed in cleanly ✓',
  };
  saveActiveAccount(localAccount);
  return localAccount;
}

export async function syncCurrentAccountXp(xp: number): Promise<void> {
  const acc = loadActiveAccount();
  if (!acc) return;
  const prog = loadProgression();
  const nextXp = Math.max(acc.xp, xp);
  const updated: AuthAccount = { ...acc, xp: nextXp };
  saveActiveAccount(updated);

  const vault = loadLocalVault();
  if (vault[acc.email]) {
    vault[acc.email].xp = Math.max(vault[acc.email].xp, nextXp);
    saveLocalVault(vault);
  }

  const sb = getSupabaseClient();
  if (sb && isSupabaseConfigured && acc.provider === 'supabase_db') {
    await sb
      .rpc('sync_player_xp', {
        p_id: acc.id,
        p_email: acc.email,
        p_xp: nextXp,
        p_skins: prog.equippedSkins ?? {},
      })
      .then(() => {});
  }

  await fetchJsonSafe('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: acc.id,
      email: acc.email,
      rangerName: acc.rangerName,
      provider: acc.provider,
      xp: nextXp,
      equippedSkins: prog.equippedSkins ?? {},
    }),
  });
}

export async function signOutAccount(): Promise<void> {
  saveActiveAccount(null);
}
