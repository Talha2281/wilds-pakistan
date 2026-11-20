import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  MessageSquarePlus,
  Send,
  Star,
  X,
} from 'lucide-react';
import { AuthAccount, linkGoogleAccountToDb } from '../data/auth';
import {
  FEEDBACK_CATEGORIES,
  FeedbackCategory,
  SubmitFeedbackResult,
  buildFeedbackEntry,
  submitPlayerFeedback,
} from '../data/feedback';
import {
  SavedFeedbackSheetMeta,
  connectExistingFeedbackSheet,
  createFeedbackSpreadsheet,
  getGoogleAccessToken,
  loadSavedFeedbackSheet,
  signInWithGoogleSheets,
} from '../data/googleAuthSheets';
import { MODE_LABELS } from '../data/records';
import { AnimalId, BiomeId, GameMode } from '../types/game';
import { GoogleSignInButton } from './GoogleSignInButton';

interface FeedbackModalProps {
  playerName: string;
  account: AuthAccount | null;
  mode: GameMode;
  animalId: AnimalId;
  biomeId: BiomeId;
  round: number;
  score: number;
  victory: boolean;
  onAuthChange?: (acc: AuthAccount) => void;
  onClose: () => void;
}

export function FeedbackModal({
  playerName,
  account,
  mode,
  animalId,
  biomeId,
  round,
  score,
  victory,
  onAuthChange,
  onClose,
}: FeedbackModalProps) {
  const [rating, setRating] = useState(5);
  const [category, setCategory] = useState<FeedbackCategory>('Gameplay & Controls');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmitFeedbackResult | null>(null);
  const [error, setError] = useState('');

  // Google Sheets state
  const [hasGoogleToken, setHasGoogleToken] = useState(() => Boolean(getGoogleAccessToken()));
  const [sheetMeta, setSheetMeta] = useState<SavedFeedbackSheetMeta | null>(() =>
    loadSavedFeedbackSheet(),
  );
  const [sheetInput, setSheetInput] = useState('');
  const [confirmCreateSheet, setConfirmCreateSheet] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [serverWebhookReady, setServerWebhookReady] = useState(false);

  useEffect(() => {
    setHasGoogleToken(Boolean(getGoogleAccessToken()));
  }, [account]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
      fetch('/api/health')
        .then((r) => (r.ok ? r.json() : null))
        .then((h: { sheets?: { webhookConfigured?: boolean } } | null) => {
          if (h?.sheets?.webhookConfigured) setServerWebhookReady(true);
        })
        .catch(() => {});
    }
  }, []);

  const handleGoogleConnect = async () => {
    setError('');
    setSheetBusy(true);
    try {
      const { user } = await signInWithGoogleSheets();
      setHasGoogleToken(true);
      const linked = await linkGoogleAccountToDb(user);
      onAuthChange?.(linked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In cancelled.');
    } finally {
      setSheetBusy(false);
    }
  };

  const handleCreateConfirmedSheet = async () => {
    const token = getGoogleAccessToken();
    if (!token) {
      setError('Please sign in with Google first so we have permission to create your feedback sheet.');
      return;
    }
    setSheetBusy(true);
    setError('');
    try {
      const created = await createFeedbackSpreadsheet(token);
      setSheetMeta(created);
      setConfirmCreateSheet(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Google Sheet.');
    } finally {
      setSheetBusy(false);
    }
  };

  const handleConnectExisting = async () => {
    const token = getGoogleAccessToken();
    if (!token) {
      setError('Sign in with Google first to connect an existing Google Sheet.');
      return;
    }
    setSheetBusy(true);
    setError('');
    try {
      const connected = await connectExistingFeedbackSheet(sheetInput, token);
      setSheetMeta(connected);
      setSheetInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not access that Google Sheet.');
    } finally {
      setSheetBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const entry = buildFeedbackEntry({
        playerName: account?.rangerName || playerName || 'Ranger',
        userEmail: account?.email,
        rating,
        category,
        mode,
        animalId,
        biomeId,
        round,
        score,
        victory,
        comment: comment || `Rated ${rating}/5 in ${MODE_LABELS[mode]}`,
      });
      const res = await submitPlayerFeedback(entry, { sheetMeta });
      setSubmitted(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-emerald-400/35 bg-slate-900 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
              <MessageSquarePlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Expedition Feedback</h2>
              <p className="text-xs text-slate-400">
                {MODE_LABELS[mode]} · Round {round} · {score} pts ({victory ? 'Completed' : 'Run Ended'})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close feedback modal"
            className="rounded-lg border border-white/15 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-emerald-400/35 bg-emerald-950/35 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
                <span>Thank you! Your feedback has been recorded.</span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-slate-200">
                <div>
                  • Database:{' '}
                  <span className="font-semibold text-emerald-300">
                    {submitted.savedToSupabase
                      ? 'Saved to Supabase PostgreSQL ✓'
                      : submitted.savedToServer
                        ? 'Saved to Wild Pakistan Server ✓'
                        : 'Saved in Browser Storage ✓'}
                  </span>
                </div>
                <div>
                  • Google Sheets:{' '}
                  <span
                    className={`font-semibold ${
                      submitted.savedToGoogleSheet ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {submitted.savedToGoogleSheet
                      ? 'Appended row directly to Google Sheets ✓'
                      : 'Not synced (connect Google Sheet below to push rows live)'}
                  </span>
                </div>
              </div>

              {(submitted.spreadsheetUrl || sheetMeta?.spreadsheetUrl) && (
                <a
                  href={submitted.spreadsheetUrl || sheetMeta?.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Open Feedback Google Sheet</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Star Rating */}
            <div>
              <div className="text-xs font-semibold text-emerald-300 uppercase">
                How was this expedition?
              </div>
              <div className="mt-2 flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`rounded-xl border p-2 transition-colors ${
                      star <= rating
                        ? 'border-amber-400/50 bg-amber-500/20 text-amber-300'
                        : 'border-white/10 bg-slate-950 text-slate-500 hover:text-slate-300'
                    }`}
                    aria-label={`Rate ${star} stars`}
                  >
                    <Star className={`h-5 w-5 ${star <= rating ? 'fill-current' : ''}`} />
                  </button>
                ))}
                <span className="ml-2 text-xs font-semibold text-amber-300">{rating}/5</span>
              </div>
            </div>

            {/* Category */}
            <div>
              <div className="text-xs font-semibold text-emerald-300 uppercase">Focus Area</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {FEEDBACK_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      category === cat
                        ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                        : 'border-white/10 bg-slate-950 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Comment */}
            <div>
              <label
                htmlFor="feedback-comment"
                className="block text-xs font-semibold text-emerald-300 uppercase"
              >
                Your Feedback or Suggestions
              </label>
              <textarea
                id="feedback-comment"
                rows={3}
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tell us what you loved, bugs you spotted, or animals/features you want next..."
                className="mt-1.5 w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
              />
            </div>

            {/* Google Sheets Integration Box */}
            <div className="rounded-xl border border-sky-400/30 bg-slate-950/85 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-300">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Google Sheets Sync</span>
                </span>
                {(sheetMeta || serverWebhookReady) && (
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    {sheetMeta ? 'Sheet Linked ✓' : 'Auto Webhook Active ✓'}
                  </span>
                )}
              </div>

              {serverWebhookReady && !sheetMeta && (
                <p className="mt-2 text-[11px] text-emerald-300">
                  Central Feedback Sheet webhook is active — your rating &amp; comments automatically append to Google Sheets + Supabase!
                </p>
              )}

              {!hasGoogleToken ? (
                <div className="mt-2.5 space-y-2">
                  <p className="text-[11px] text-slate-300">
                    Sign in with Google to save feedback directly into a Google Sheet (your feedback
                    also always saves to Supabase &amp; Server DB).
                  </p>
                  <GoogleSignInButton
                    label="Sign in with Google to Sync Sheet"
                    disabled={sheetBusy}
                    onClick={handleGoogleConnect}
                  />
                </div>
              ) : sheetMeta ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-200">
                    Target: <strong className="text-white">{sheetMeta.spreadsheetName}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSheetMeta(null)}
                    className="text-[11px] font-semibold text-slate-400 underline hover:text-white"
                  >
                    Change Sheet
                  </button>
                </div>
              ) : (
                <div className="mt-2.5 space-y-2.5">
                  {confirmCreateSheet ? (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-950/35 p-2.5 text-xs">
                      <p className="font-semibold text-amber-200">
                        Create a new spreadsheet &ldquo;Wild Pakistan – Player Feedback&rdquo; in your
                        Google Drive and append feedback rows there?
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={sheetBusy}
                          onClick={handleCreateConfirmedSheet}
                          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                        >
                          {sheetBusy ? 'Creating...' : 'Confirm & Create Sheet'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmCreateSheet(false)}
                          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmCreateSheet(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      Create &ldquo;Wild Pakistan – Player Feedback&rdquo; Sheet
                    </button>
                  )}

                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={sheetInput}
                      onChange={(e) => setSheetInput(e.target.value)}
                      placeholder="Or paste existing Google Sheet URL / ID..."
                      className="flex-1 rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={sheetBusy || !sheetInput.trim()}
                      onClick={handleConnectExisting}
                      className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                    >
                      Link
                    </button>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-rose-400/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/5"
              >
                Skip for Now
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {submitting ? 'Saving...' : 'Submit Feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
