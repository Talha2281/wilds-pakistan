import { AnimalId, BiomeId, GameMode, NpcSpeciesId, SeasonId } from '../types/game';
import { ANIMALS, FIELD_GUIDE_SPECIES } from './animals';
import { BIOMES } from './biomes';

export interface DailyExpeditionSpec {
  dateKey: string;
  seed: number;
  biomeId: BiomeId;
  animalId: AnimalId;
  mode: GameMode;
  season: SeasonId;
  title: string;
  titleUr: string;
  goalText: string;
  goalTextUr: string;
  bonusXp: number;
  speciesOfDayId: NpcSpeciesId;
}

export interface WeeklyChallengeSpec {
  weekKey: string;
  title: string;
  titleUr: string;
  description: string;
  descriptionUr: string;
  targetCount: number;
  metric: 'orbs' | 'arrests' | 'photos' | 'runs';
  rewardXp: number;
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 98765;
}

export function getTodayDateKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

const DAILY_ROTATION: Array<{
  biomeId: BiomeId;
  animalId: AnimalId;
  mode: GameMode;
  season: SeasonId;
  speciesOfDayId: NpcSpeciesId;
}> = [
  {
    biomeId: 'northern_mountains',
    animalId: 'markhor',
    mode: 'wild_life',
    season: 'winter',
    speciesOfDayId: 'markhor_npc',
  },
  {
    biomeId: 'deosai_plateau',
    animalId: 'brown_bear',
    mode: 'wild_life',
    season: 'summer',
    speciesOfDayId: 'brown_bear_npc',
  },
  {
    biomeId: 'indus_river',
    animalId: 'indus_dolphin',
    mode: 'wild_life',
    season: 'spring',
    speciesOfDayId: 'indus_dolphin_npc',
  },
  {
    biomeId: 'ziarat_juniper',
    animalId: 'ranger',
    mode: 'ranger_patrol',
    season: 'autumn',
    speciesOfDayId: 'snow_leopard_npc',
  },
  {
    biomeId: 'thar_desert',
    animalId: 'ranger',
    mode: 'photo_safari',
    season: 'spring',
    speciesOfDayId: 'gazelle',
  },
  {
    biomeId: 'northern_mountains',
    animalId: 'snow_leopard',
    mode: 'wild_life',
    season: 'autumn',
    speciesOfDayId: 'ibex',
  },
];

export function getDailyExpedition(date = new Date()): DailyExpeditionSpec {
  const dateKey = getTodayDateKey(date);
  const seed = hashString(`wild-pakistan-daily-${dateKey}`);
  const slot = DAILY_ROTATION[seed % DAILY_ROTATION.length];
  const animal = ANIMALS[slot.animalId];
  const biome = BIOMES[slot.biomeId];

  const goalText =
    slot.mode === 'wild_life'
      ? `Survive as ${animal.name} in ${biome.name} (${slot.season}) & collect all Spirit Orbs.`
      : slot.mode === 'ranger_patrol'
        ? `Arrest every poacher, rescue wildlife & clear snares in ${biome.name}.`
        : `Photograph 5 distinct wild species in ${biome.name} without disturbing herds.`;

  const goalTextUr =
    slot.mode === 'wild_life'
      ? `${biome.nameUr} میں ${animal.nameUr} بن کر زندہ رہیں اور تمام روحانی گولے جمع کریں۔`
      : slot.mode === 'ranger_patrol'
        ? `${biome.nameUr} میں تمام شکاری پکڑیں، جانور بچائیں اور پھندے صاف کریں۔`
        : `${biome.nameUr} میں 5 مختلف جنگلی جانوروں کی تصاویر کھینچیں۔`;

  return {
    dateKey,
    seed,
    biomeId: slot.biomeId,
    animalId: slot.animalId,
    mode: slot.mode,
    season: slot.season,
    title: `${animal.name} · ${biome.name}`,
    titleUr: `${animal.nameUr} · ${biome.nameUr}`,
    goalText,
    goalTextUr,
    bonusXp: 150,
    speciesOfDayId: slot.speciesOfDayId,
  };
}

export function getSpeciesOfTheDay(date = new Date()) {
  const daily = getDailyExpedition(date);
  return {
    dateKey: daily.dateKey,
    species: FIELD_GUIDE_SPECIES[daily.speciesOfDayId],
    biome: BIOMES[daily.biomeId],
  };
}

export function getTimeUntilNextDaily(): string {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const diffMs = Math.max(0, next - now.getTime());
  const hrs = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return `${hrs}h ${mins}m`;
}

export function getWeeklyChallengePool(date = new Date()): WeeklyChallengeSpec[] {
  const weekKey = getCurrentWeekKey(date);
  return [
    {
      weekKey,
      title: 'Karakoram Guardians',
      titleUr: 'قراقرم کے محافظ',
      description: 'Collect 9 Spirit Orbs across any Wild Life runs this week.',
      descriptionUr: 'اس ہفتے وائلڈ لائف موڈ میں 9 روحانی گولے جمع کریں۔',
      targetCount: 9,
      metric: 'orbs',
      rewardXp: 300,
    },
    {
      weekKey,
      title: 'Anti-Poaching Sweep',
      titleUr: 'شکاری مخالف مہم',
      description: 'Arrest 6 poachers across Ranger Patrol expeditions this week.',
      descriptionUr: 'اس ہفتے رینجر گشت میں 6 شکاریوں کو گرفتار کریں۔',
      targetCount: 6,
      metric: 'arrests',
      rewardXp: 320,
    },
    {
      weekKey,
      title: 'National Wildlife Archivist',
      titleUr: 'قومی جنگلی حیات فوٹوگرافر',
      description: 'Log 8 wildlife species photos in Photo Safari this week.',
      descriptionUr: 'اس ہفتے فوٹو سفاری میں 8 جنگلی جانوروں کی تصاویر محفوظ کریں۔',
      targetCount: 8,
      metric: 'photos',
      rewardXp: 280,
    },
  ];
}

export function getWeeklyChallenge(date = new Date()): WeeklyChallengeSpec {
  const weekKey = getCurrentWeekKey(date);
  const h = hashString(`week-${weekKey}`);
  const pool = getWeeklyChallengePool(date);
  return pool[h % pool.length];
}
