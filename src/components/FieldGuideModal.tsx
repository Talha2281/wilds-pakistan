import { BookOpen, CheckCircle2, X } from 'lucide-react';
import { FIELD_GUIDE_SPECIES, SPECIES_RARITY_META } from '../data/animals';
import { NpcSpeciesId } from '../types/game';

interface FieldGuideModalProps {
  photographedIds: string[];
  onClose: () => void;
}

export function FieldGuideModal({ photographedIds, onClose }: FieldGuideModalProps) {
  const speciesList = Object.values(FIELD_GUIDE_SPECIES);
  const discoveredCount = speciesList.filter((s) => photographedIds.includes(s.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-emerald-500/30 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white">
                Pakistan Wildlife Field Guide
              </h2>
              <p className="text-xs text-emerald-300/90 tabular-nums">
                {discoveredCount} of {speciesList.length} species cataloged · S-Rank gives 1.5× Rarity Score
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label="Close Field Guide"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 overflow-y-auto p-6 sm:grid-cols-2">
          {speciesList.map((sp) => {
            const unlocked = photographedIds.includes(sp.id as NpcSpeciesId);
            const rarityMeta = SPECIES_RARITY_META[sp.rarity];
            return (
              <div
                key={sp.id}
                className={`rounded-xl border p-4 transition-colors ${
                  unlocked
                    ? 'border-emerald-400/40 bg-emerald-950/35'
                    : 'border-white/10 bg-slate-950/50 opacity-85'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-semibold text-white">{sp.name}</h3>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${rarityMeta.badgeCls}`}
                      >
                        {rarityMeta.label} · {sp.basePhotoPoints} pts
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs italic text-slate-400">{sp.scientificName}</p>
                  </div>
                  {unlocked ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Logged
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] text-slate-400">
                      Undiscovered
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs font-medium text-amber-300/90">{sp.status}</p>
                <p className="mt-1 text-xs text-slate-300">{sp.biomeHint}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {unlocked ? sp.fact : 'Photograph this species in Photo Safari to unlock full field notes.'}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
