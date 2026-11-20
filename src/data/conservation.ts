import { BiomeConservationState, BiomeId } from '../types/game';

const CONS_KEY = 'wild_pakistan_conservation_v1';

const BASELINE_SPECIES: Record<BiomeId, number> = {
  northern_mountains: 18,
  deosai_plateau: 14,
  ziarat_juniper: 16,
  indus_river: 22,
  thar_desert: 15,
};

function createDefaultMap(): Record<BiomeId, BiomeConservationState> {
  return {
    northern_mountains: {
      biomeId: 'northern_mountains',
      conservationScore: 62,
      speciesCount: BASELINE_SPECIES.northern_mountains,
      poachersStopped: 0,
      photosLogged: 0,
      wildlifeHarmEvents: 0,
    },
    deosai_plateau: {
      biomeId: 'deosai_plateau',
      conservationScore: 58,
      speciesCount: BASELINE_SPECIES.deosai_plateau,
      poachersStopped: 0,
      photosLogged: 0,
      wildlifeHarmEvents: 0,
    },
    ziarat_juniper: {
      biomeId: 'ziarat_juniper',
      conservationScore: 60,
      speciesCount: BASELINE_SPECIES.ziarat_juniper,
      poachersStopped: 0,
      photosLogged: 0,
      wildlifeHarmEvents: 0,
    },
    indus_river: {
      biomeId: 'indus_river',
      conservationScore: 55,
      speciesCount: BASELINE_SPECIES.indus_river,
      poachersStopped: 0,
      photosLogged: 0,
      wildlifeHarmEvents: 0,
    },
    thar_desert: {
      biomeId: 'thar_desert',
      conservationScore: 61,
      speciesCount: BASELINE_SPECIES.thar_desert,
      poachersStopped: 0,
      photosLogged: 0,
      wildlifeHarmEvents: 0,
    },
  };
}

export function loadConservationMap(): Record<BiomeId, BiomeConservationState> {
  const fallback = createDefaultMap();
  try {
    const raw = localStorage.getItem(CONS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<BiomeId, BiomeConservationState>>;
    for (const id of Object.keys(fallback) as BiomeId[]) {
      if (parsed[id]) {
        fallback[id] = {
          ...fallback[id],
          ...parsed[id],
          conservationScore: Math.max(5, Math.min(100, parsed[id]!.conservationScore)),
          speciesCount: Math.max(4, parsed[id]!.speciesCount),
        };
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function updateBiomeConservation(
  biomeId: BiomeId,
  deltaScore: number,
  options?: { poachersStopped?: number; photosLogged?: number; wildlifeHarm?: number },
): BiomeConservationState {
  const all = loadConservationMap();
  const cur = all[biomeId];
  const nextScore = Math.max(5, Math.min(100, Math.round(cur.conservationScore + deltaScore)));
  const baseline = BASELINE_SPECIES[biomeId];
  const nextSpecies = Math.max(4, Math.round(baseline * (0.45 + (nextScore / 100) * 0.95)));

  const updated: BiomeConservationState = {
    ...cur,
    conservationScore: nextScore,
    speciesCount: nextSpecies,
    poachersStopped: cur.poachersStopped + (options?.poachersStopped ?? 0),
    photosLogged: cur.photosLogged + (options?.photosLogged ?? 0),
    wildlifeHarmEvents: cur.wildlifeHarmEvents + (options?.wildlifeHarm ?? 0),
  };
  all[biomeId] = updated;
  try {
    localStorage.setItem(CONS_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
  return updated;
}

export function getConservationEnding(score: number): {
  tier: 'thriving' | 'recovering' | 'fragile';
  title: string;
  titleUr: string;
  narrative: string;
  narrativeUr: string;
} {
  if (score >= 80) {
    return {
      tier: 'thriving',
      title: 'Thriving Sanctuary Ending',
      titleUr: 'خوشحال محفوظ جنگل کا انجام',
      narrative:
        'Poachers were pushed back and documented habitats flourished. Herds and apex predators are multiplying across the valley!',
      narrativeUr:
        'شکاریوں کو روک دیا گیا اور محفوظ علاقے میں جنگلی حیات کی نسلیں تیزی سے بڑھ رہی ہیں!',
    };
  }
  if (score >= 50) {
    return {
      tier: 'recovering',
      title: 'Recovering Habitat Ending',
      titleUr: 'بحالی کی راہ پر انجام',
      narrative:
        'Balance is returning to the ecosystem. Continue patrolling, clearing Jaal nets, and logging wildlife photos to reach sanctuary status.',
      narrativeUr:
        'ماحولیاتی توازن واپس آ رہا ہے۔ مکمل تحفظ کے لیے گشت اور فوٹوگرافی جاری رکھیں۔',
    };
  }
  return {
    tier: 'fragile',
    title: 'Fragile Ecosystem Ending',
    titleUr: 'نازک ماحولیاتی انجام',
    narrative:
      'Poaching pressure and Shikari gunfire strained local herds. Deploy Ranger Patrols and Photo Safaris to rebuild this biome.',
    narrativeUr:
      'شکاریوں کے دباؤ سے جنگلی حیات متاثر ہوئی ہے۔ اس علاقے کو بچانے کے لیے رینجر گشت شروع کریں۔',
  };
}
