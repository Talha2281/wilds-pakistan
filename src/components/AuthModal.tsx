import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  Lock,
  LogIn,
  LogOut,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AuthAccount,
  loginFreeAccount,
  signOutAccount,
  signUpFreeAccount,
} from '../data/auth';

interface AuthModalProps {
  account: AuthAccount | null;
  promptMessage?: string;
  allowClose?: boolean;
  onNavigateHome?: () => void;
  onAuthChange: (account: AuthAccount | null) => void;
  onClose: () => void;
}

export function AuthModal({
  account,
  promptMessage,
  allowClose = true,
  onNavigateHome,
  onAuthChange,
  onClose,
}: AuthModalProps) {
  const [tab, setTab] = useState<'login' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rangerName, setRangerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusNote, setStatusNote] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatusNote('');
    setBusy(true);
    try {
      const next =
        tab === 'signup'
          ? await signUpFreeAccount({ email, password, rangerName })
          : await loginFreeAccount({ email, password });
      setStatusNote(next.notice || 'Signed in!');
      onAuthChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOutAccount();
      onAuthChange(null);
      setStatusNote('Signed out cleanly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4">
      <div className="w-full max-w-md rounded-2xl border border-emerald-400/35 bg-slate-900 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Ranger Account (Secure Login)</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Instant signup with zero confirmation emails — saved securely in database.
            </p>
          </div>
          {allowClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close account dialog"
              className="rounded-lg border border-white/15 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {promptMessage && !account && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-400/40 bg-amber-950/35 px-3.5 py-2.5 text-xs text-amber-200">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>{promptMessage}</span>
          </div>
        )}

        {account ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-emerald-400/35 bg-emerald-950/35 p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                <span>Signed In &amp; Verified</span>
              </div>
              <div className="mt-2 text-base font-bold text-white">{account.rangerName}</div>
              <div className="text-xs text-slate-300">{account.email}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-lg bg-slate-950/80 px-2.5 py-1 text-emerald-300">
                  <Database className="h-3 w-3" />
                  {account.syncedToDb
                    ? 'Saved in Supabase PostgreSQL'
                    : account.provider === 'server'
                      ? 'Saved on Game Server'
                      : 'Encrypted Device Vault'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg bg-slate-950/80 px-2.5 py-1 text-amber-300">
                  <ShieldCheck className="h-3 w-3" />
                  {account.xp} XP Cloud Profile
                </span>
              </div>
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={handleSignOut}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-400/35 bg-rose-500/15 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-500/25 disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
              >
                Continue Playing
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-slate-950 p-1">
              <button
                type="button"
                onClick={() => {
                  setTab('signup');
                  setError('');
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold ${
                  tab === 'signup'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Create Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setError('');
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold ${
                  tab === 'login'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign In
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {tab === 'signup' && (
                <div>
                  <label
                    htmlFor="auth-ranger-name"
                    className="block text-[11px] font-semibold text-emerald-300 uppercase"
                  >
                    Ranger / Explorer Callsign
                  </label>
                  <input
                    id="auth-ranger-name"
                    type="text"
                    required
                    maxLength={28}
                    value={rangerName}
                    onChange={(e) => setRangerName(e.target.value)}
                    placeholder="e.g. Ranger Hamza"
                    className="mt-1 w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-[11px] font-semibold text-emerald-300 uppercase"
                >
                  Email Address
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ranger@example.com"
                  className="mt-1 w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-[11px] font-semibold text-emerald-300 uppercase"
                >
                  Password (min 6 chars)
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1 w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-rose-400/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                  {error}
                </div>
              )}
              {statusNote && (
                <div className="rounded-xl border border-emerald-400/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
                  {statusNote}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                {busy
                  ? 'Connecting...'
                  : tab === 'signup'
                    ? 'Create Free Account & Enter'
                    : 'Sign In & Enter Wilderness'}
              </button>
            </form>

            <div className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-400">
              <strong className="text-slate-200">Where login is saved:</strong> Encrypted bcrypt password &amp; XP profile are stored in{' '}
              <span className="text-emerald-300">Supabase PostgreSQL</span> (<code className="text-slate-300">player_accounts</code>) — zero confirmation emails sent.
            </div>

            {!allowClose && onNavigateHome && (
              <button
                type="button"
                onClick={onNavigateHome}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Home Page</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
