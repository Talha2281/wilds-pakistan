import { AnimalId, GrowthStage, SkinSpec } from '../types/game';
import { ANIMALS } from './animals';
import { getCurrentWeekKey } from './dailyExpedition';

const PROG_KEY = 'wild_pakistan_progression_v1';

export interface ProgressionState {
  xp: number;
  equippedSkins: Partial<Record<AnimalId, string>>;
  tutorialCompleted: boolean;
  dailyCompletedDates: string[];
  weeklyCounters: Record<
    string,
    {
      orbs: number;
      arrests: number;
      photos: number;
      runs: number;
      claimed?: boolean;
    }
  >;
}

const DEFAULT_PROG: ProgressionState = {
  xp: 0,
  equippedSkins: {},
  tutorialCompleted: false,
  dailyCompletedDates: [],
  weeklyCounters: {},
};

export function loadProgression(): ProgressionState {
  try {
    const raw = localStorage.getItem(PROG_KEY);
    if (!raw) return { ...DEFAULT_PROG };
    const parsed = JSON.parse(raw) as Partial<ProgressionState>;
    return {
      xp: Math.max(0, Number(parsed.xp) || 0),
      equippedSkins: parsed.equippedSkins ?? {},
      tutorialCompleted: Boolean(parsed.tutorialCompleted),
      dailyCompletedDates: Array.isArray(parsed.dailyCompletedDates) ? parsed.dailyCompletedDates : [],
      weeklyCounters: parsed.weeklyCounters ?? {},
    };
  } catch {
    return { ...DEFAULT_PROG };
  }
}

export function saveProgression(state: ProgressionState): void {
  try {
    localStorage.setItem(PROG_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

export function getLevelFromXp(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
} {
  const level = Math.floor(xp / 180) + 1;
  const currentLevelXp = (level - 1) * 180;
  const nextLevelXp = level * 180;
  const progress = Math.min(1, Math.max(0, (xp - currentLevelXp) / 180));
  return { level, currentLevelXp, nextLevelXp, progress };
}

export function isAnimalUnlocked(
  animalId: AnimalId,
  xp: number,
  dailyAnimalId?: AnimalId,
): boolean {
  if (dailyAnimalId && animalId === dailyAnimalId) return true;
  return xp >= ANIMALS[animalId].unlockXp;
}

export function isSkinUnlocked(skin: SkinSpec, xp: number): boolean {
  return xp >= skin.xpRequired;
}

export function getEquippedSkin(animalId: AnimalId, state: ProgressionState): SkinSpec {
  const skins = ANIMALS[animalId].skins;
  const pickedId = state.equippedSkins[animalId];
  const found = skins.find((s) => s.id === pickedId && isSkinUnlocked(s, state.xp));
  return found ?? skins[0];
}

export function equipSkin(animalId: AnimalId, skinId: string): ProgressionState {
  const st = loadProgression();
  const skin = ANIMALS[animalId].skins.find((s) => s.id === skinId);
  if (skin && isSkinUnlocked(skin, st.xp)) {
    st.equippedSkins[animalId] = skinId;
    saveProgression(st);
  }
  return st;
}

export function addProgressionXp(amount: number): ProgressionState {
  const st = loadProgression();
  st.xp = Math.max(0, st.xp + Math.round(amount));
  saveProgression(st);
  return st;
}

export function markTutorialCompleted(): ProgressionState {
  const st = loadProgression();
  if (!st.tutorialCompleted) {
    st.tutorialCompleted = true;
    st.xp += 100;
    saveProgression(st);
  }
  return st;
}

export function recordDailyCompletion(dateKey: string): ProgressionState {
  const st = loadProgression();
  if (!st.dailyCompletedDates.includes(dateKey)) {
    st.dailyCompletedDates = [dateKey, ...st.dailyCompletedDates].slice(0, 30);
    st.xp += 150;
    saveProgression(st);
  }
  return st;
}

export function updateWeeklyProgress(
  delta: {
    orbs?: number;
    arrests?: number;
    photos?: number;
    runs?: number;
  },
  weeklyTarget?: { metric: 'orbs' | 'arrests' | 'photos' | 'runs'; targetCount: number; rewardXp: number },
): ProgressionState {
  const st = loadProgression();
  const wk = getCurrentWeekKey();
  const cur = st.weeklyCounters[wk] ?? { orbs: 0, arrests: 0, photos: 0, runs: 0 };
  const updated = {
    orbs: cur.orbs + (delta.orbs ?? 0),
    arrests: cur.arrests + (delta.arrests ?? 0),
    photos: cur.photos + (delta.photos ?? 0),
    runs: cur.runs + (delta.runs ?? 0),
    claimed: cur.claimed,
  };
  if (weeklyTarget && !updated.claimed && updated[weeklyTarget.metric] >= weeklyTarget.targetCount) {
    updated.claimed = true;
    st.xp += weeklyTarget.rewardXp;
  }
  st.weeklyCounters[wk] = updated;
  saveProgression(st);
  return st;
}

export function getGrowthStageFromRunXp(runXp: number): {
  stage: GrowthStage;
  progress: number;
  scaleFactor: number;
  powerFactor: number;
} {
  if (runXp < 75) {
    return {
      stage: 'cub',
      progress: Math.min(1, runXp / 75),
      scaleFactor: 0.68,
      powerFactor: 0.85,
    };
  }
  if (runXp < 175) {
    return {
      stage: 'juvenile',
      progress: Math.min(1, (runXp - 75) / 100),
      scaleFactor: 0.88,
      powerFactor: 1.05,
    };
  }
  return {
    stage: 'adult',
    progress: 1,
    scaleFactor: 1.1,
    powerFactor: 1.3,
  };
}
