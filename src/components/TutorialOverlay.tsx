import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Compass, X } from 'lucide-react';
import { ANIMALS } from '../data/animals';
import { COPY } from '../data/i18n';
import { Language, SimSnapshot } from '../types/game';

interface TutorialOverlayProps {
  snap: SimSnapshot;
  lang: Language;
  onComplete: () => void;
  onDismiss: () => void;
}

export function TutorialOverlay({
  snap,
  lang,
  onComplete,
  onDismiss,
}: TutorialOverlayProps) {
  const [moved, setMoved] = useState(false);
  const [usedPrimary, setUsedPrimary] = useState(false);
  const [usedSecondary, setUsedSecondary] = useState(false);
  const [progressedGoal, setProgressedGoal] = useState(false);
  const [completedSent, setCompletedSent] = useState(false);

  const animal = ANIMALS[snap.animalId];

  useEffect(() => {
    if (snap.playerSpeed > 2.2) setMoved(true);
    if (snap.primaryCooldown > 0 || snap.isAirborne || snap.poachersArrested > 0) {
      setUsedPrimary(true);
    }
    if (snap.secondaryCooldown > 0 || snap.secondaryActive || snap.isDiving) {
      setUsedSecondary(true);
    }
    if (
      snap.orbsCollected > 0 ||
      snap.preyCaught > 0 ||
      snap.poachersArrested > 0 ||
      snap.animalsRescued > 0 ||
      snap.snaresCleared > 0 ||
      snap.photosTaken > 0
    ) {
      setProgressedGoal(true);
    }
  }, [snap]);

  const steps =
    snap.mode === 'photo_safari'
      ? [
          {
            done: moved,
            text:
              lang === 'ur'
                ? 'WASD یا جوائس اسٹک سے چلیں'
                : 'Move toward wildlife (WASD / Stick)',
          },
          {
            done: Boolean(snap.photoTarget) || progressedGoal,
            text:
              lang === 'ur'
                ? 'جانور کو کیمرہ فریم میں رکھیں'
                : 'Aim viewfinder onto an animal',
          },
          {
            done: progressedGoal,
            text:
              lang === 'ur'
                ? 'تصویر مکمل ہونے تک ٹھہریں (+100 XP)'
                : 'Hold steady to log 1st species (+100 XP)',
          },
        ]
      : [
          {
            done: moved,
            text:
              lang === 'ur'
                ? 'WASD / جوائس اسٹک سے علاقے کی سیر کریں'
                : 'Move & look around (WASD / Drag)',
          },
          {
            done: usedPrimary,
            text:
              lang === 'ur'
                ? `${animal.primaryAbility.nameUr} (Space) استعمال کریں`
                : `Try ${animal.primaryAbility.name} (${animal.primaryAbility.keyHint})`,
          },
          {
            done: usedSecondary,
            text:
              lang === 'ur'
                ? `${animal.secondaryAbility.nameUr} (F) آزمائیں`
                : `Try ${animal.secondaryAbility.name} (${animal.secondaryAbility.keyHint})`,
          },
          {
            done: progressedGoal,
            text:
              lang === 'ur'
                ? 'سبز تیر کے نشان کا پیچھا کریں (+100 XP)'
                : 'Follow top Guide Arrow to first goal (+100 XP)',
          },
        ];

  const allDone = steps.every((s) => s.done);

  useEffect(() => {
    if (allDone && !completedSent) {
      setCompletedSent(true);
      const t = window.setTimeout(() => {
        onComplete();
      }, 1100);
      return () => window.clearTimeout(t);
    }
  }, [allDone, completedSent, onComplete]);

  // Hide automatically after first 90s so HUD stays uncluttered
  if (snap.elapsedSec > 90 && !allDone) return null;

  return (
    <div className="pointer-events-auto fixed bottom-20 left-3 z-30 w-64 rounded-2xl border border-emerald-400/40 bg-slate-950/90 p-3.5 text-slate-100 shadow-2xl sm:bottom-20 sm:left-4 sm:w-72">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
          <Compass className="h-3.5 w-3.5" />
          <span>{COPY[lang].tutorialTitle}</span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <span>{COPY[lang].skipTutorial}</span>
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {steps.map((s) => (
          <div key={s.text} className="flex items-start gap-2 text-[11px]">
            {s.done ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : (
              <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
            )}
            <span className={s.done ? 'text-emerald-200 line-through' : 'text-slate-200'}>
              {s.text}
            </span>
          </div>
        ))}
      </div>

      {allDone && (
        <div className="mt-2.5 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-center text-[11px] font-bold text-emerald-200">
          {lang === 'ur' ? 'تربیت مکمل! +100 XP' : 'Briefing Complete! +100 XP Awarded'}
        </div>
      )}
    </div>
  );
}
