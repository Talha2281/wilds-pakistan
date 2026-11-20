import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Binoculars, Camera, Crosshair, Volume2, Zap, ZoomIn } from 'lucide-react';
import { ANIMALS } from '../data/animals';
import { AnimalId, GameMode, RangerToolId } from '../types/game';

interface TouchControlsProps {
  mode: GameMode;
  animalId: AnimalId;
  isDiving: boolean;
  equippedTool?: RangerToolId;
  telephotoZoomed?: boolean;
  onMove: (x: number, z: number, sprint: boolean) => void;
  onPrimary: () => void;
  onSecondary: () => void;
  onCall: () => void;
}

export function TouchControls({
  mode,
  animalId,
  isDiving,
  equippedTool = 'dart',
  telephotoZoomed = false,
  onMove,
  onPrimary,
  onSecondary,
  onCall,
}: TouchControlsProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [sprint, setSprint] = useState(false);
  const activePointer = useRef<number | null>(null);
  const cfg = ANIMALS[animalId];

  const updateStick = (clientX: number, clientY: number, isSprinting: boolean) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.38;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setKnob({ x: dx, y: dy });
    onMove(-dx / maxR, -dy / maxR, isSprinting);
  };

  const resetStick = () => {
    activePointer.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0, sprint);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    activePointer.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateStick(e.clientX, e.clientY, sprint);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return;
    e.stopPropagation();
    updateStick(e.clientX, e.clientY, sprint);
  };

  const primaryLabel =
    mode === 'photo_safari'
      ? 'Snap'
      : mode === 'ranger_patrol'
        ? equippedTool === 'binoculars'
          ? 'Scan'
          : equippedTool === 'camera'
            ? 'Snap'
            : 'Dart'
        : cfg.primaryAbility.name.split(' ')[1] || cfg.primaryAbility.name;

  const secondaryLabel =
    mode === 'photo_safari'
      ? telephotoZoomed
        ? '1× Lens'
        : '2.2× Zoom'
      : animalId === 'indus_dolphin'
        ? isDiving
          ? 'Surface'
          : 'Deep Dive'
        : cfg.secondaryAbility.name;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex items-end justify-between px-4 md:hidden">
      <div
        ref={padRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={resetStick}
        onPointerCancel={resetStick}
        className="pointer-events-auto relative h-28 w-28 touch-none rounded-full border border-white/25 bg-slate-950/70"
        aria-label="Movement joystick"
      >
        <div
          className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/70 bg-emerald-500/80 shadow-lg"
          style={{
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          }}
        />
      </div>

      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCall}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-slate-950/75 text-amber-300 active:scale-95"
            aria-label="Animal Call"
          >
            <Volume2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onPointerDown={() => {
              setSprint(true);
              onMove(0, 0, true);
            }}
            onPointerUp={() => {
              setSprint(false);
              onMove(0, 0, false);
            }}
            onPointerCancel={() => {
              setSprint(false);
              onMove(0, 0, false);
            }}
            className={`flex h-11 items-center gap-1 rounded-full border px-3.5 text-xs font-semibold ${
              sprint
                ? 'border-emerald-300 bg-emerald-500 text-slate-950'
                : 'border-white/20 bg-slate-950/75 text-white'
            }`}
          >
            <Zap className="h-4 w-4" />
            Sprint
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSecondary}
            className={`flex h-12 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold shadow-lg active:scale-95 ${
              isDiving || (mode === 'photo_safari' && telephotoZoomed)
                ? 'border-sky-300 bg-sky-500 text-slate-950'
                : 'border-amber-300/40 bg-slate-950/85 text-amber-200'
            }`}
          >
            {mode === 'photo_safari' ? (
              <ZoomIn className="h-4 w-4" />
            ) : (
              animalId === 'indus_dolphin' && !isDiving && <ArrowDown className="h-4 w-4" />
            )}
            {secondaryLabel}
          </button>

          <button
            type="button"
            onClick={onPrimary}
            className={`flex h-12 items-center gap-1.5 rounded-full border px-4 text-xs font-bold text-white shadow-lg active:scale-95 ${
              mode === 'photo_safari' || (mode === 'ranger_patrol' && equippedTool === 'camera')
                ? 'border-sky-300/70 bg-sky-600/95'
                : mode === 'ranger_patrol' && equippedTool === 'binoculars'
                  ? 'border-amber-300/70 bg-amber-600/95'
                  : 'border-emerald-300/60 bg-emerald-600/90'
            }`}
          >
            {mode === 'photo_safari' || (mode === 'ranger_patrol' && equippedTool === 'camera') ? (
              <Camera className="h-4 w-4" />
            ) : mode === 'ranger_patrol' && equippedTool === 'binoculars' ? (
              <Binoculars className="h-4 w-4" />
            ) : mode === 'ranger_patrol' ? (
              <Crosshair className="h-4 w-4" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
