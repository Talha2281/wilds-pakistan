import { Calendar, History, ShieldCheck, Trophy, X } from 'lucide-react';
import { ANIMALS } from '../data/animals';
import { BIOMES } from '../data/biomes';
import { MODE_LABELS, formatDuration } from '../data/records';
import { PlayerRecord } from '../types/game';

interface RecordsModalProps {
  records: PlayerRecord[];
  onClose: () => void;
}

export function RecordsModal({ records, onClose }: RecordsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-amber-400/30 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Expedition History & Records</h2>
              <p className="text-xs text-slate-400">Personal records &amp; conservation milestones</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label="Close Records"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {records.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              No expeditions recorded yet. Complete a run to enter the Hall of Rangers!
            </p>
          ) : (
            <div className="space-y-2.5">
              {records.map((rec) => (
                <div
                  key={rec.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-white">{rec.playerName}</span>
                      <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        {MODE_LABELS[rec.mode]}
                      </span>
                      {rec.isDaily && (
                        <span className="inline-flex items-center gap-1 rounded bg-sky-500/20 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                          <Calendar className="h-3 w-3" />
                          Daily
                        </span>
                      )}
                      {rec.conservationScore != null && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                          <ShieldCheck className="h-3 w-3" />
                          {rec.conservationScore}%
                        </span>
                      )}
                      {rec.victory && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                          <Trophy className="h-3 w-3" />
                          Cleared
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {ANIMALS[rec.animalId]?.name ?? rec.animalId} ·{' '}
                      {BIOMES[rec.biomeId]?.name ?? rec.biomeId} · {rec.summary}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-base font-bold text-amber-300">{rec.score} pts</div>
                    <div className="text-xs text-slate-400">{formatDuration(rec.elapsedSec)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
