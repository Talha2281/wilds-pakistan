import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileSpreadsheet,
  MessageSquarePlus,
  Send,
  Star,
  X,
} from 'lucide-react';
import { AuthAccount, fetchJsonSafe } from '../data/auth';
import {
  FEEDBACK_CATEGORIES,
  FeedbackCategory,
  SubmitFeedbackResult,
  buildFeedbackEntry,
  submitPlayerFeedback,
} from '../data/feedback';
import { MODE_LABELS } from '../data/records';
import { AnimalId, BiomeId, GameMode } from '../types/game';

interface FeedbackModalProps {
  playerName: string;
  account: AuthAccount | null;
  mode: GameMode;
  animalId: AnimalId;
  biomeId: BiomeId;
  round: number;
  score: number;
  victory: boolean;
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
  onClose,
}: FeedbackModalProps) {
  const [rating, setRating] = useState(5);
  const [category, setCategory] = useState<FeedbackCategory>('Gameplay & Controls');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmitFeedbackResult | null>(null);
  const [error, setError] = useState('');

  const clientWebhookConfigured = Boolean(
    typeof import.meta !== 'undefined' &&
      import.meta.env &&
      String(import.meta.env.VITE_SHEETS_WEBHOOK_URL || '').trim(),
  );
  const [serverWebhookReady, setServerWebhookReady] = useState(false);

  useEffect(() => {
    let active = true;
    fetchJsonSafe<{ sheets?: { webhookConfigured?: boolean } }>('/api/health').then((res) => {
      if (active && res.ok && res.data?.sheets?.webhookConfigured) {
        setServerWebhookReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const webhookActive = clientWebhookConfigured || serverWebhookReady;

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
      const res = await submitPlayerFeedback(entry);
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
                      ? 'Appended row to Feedback Google Sheet ✓'
                      : 'Saved to Database (set VITE_SHEETS_WEBHOOK_URL to also mirror to Google Sheets)'}
                  </span>
                </div>
              </div>
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

            {/* Automated Google Sheets + Supabase Sync Status */}
            <div className="rounded-xl border border-sky-400/30 bg-slate-950/85 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-300">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Feedback Storage</span>
                </span>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  {webhookActive ? 'Database + Google Sheet Active ✓' : 'Supabase Database Active ✓'}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-300">
                {webhookActive
                  ? 'Your rating and suggestions save automatically to Supabase Database and append a live row to the Wild Pakistan Feedback Google Sheet.'
                  : 'Your rating and suggestions save directly to Supabase Database (public.player_feedback).'}
              </p>
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
