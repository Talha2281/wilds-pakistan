export type Language = 'en' | 'ur';

export type GameMode = 'wild_life' | 'ranger_patrol' | 'photo_safari';

export type RangerToolId = 'binoculars' | 'camera' | 'dart';

export type AnimalId =
  | 'snow_leopard'
  | 'markhor'
  | 'brown_bear'
  | 'indus_dolphin'
  | 'ranger';

export type GrowthStage = 'cub' | 'juvenile' | 'adult';

export interface SkinSpec {
  id: string;
  name: string;
  nameUr: string;
  xpRequired: number;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export type NpcSpeciesId =
  | 'ibex'
  | 'marmot'
  | 'gazelle'
  | 'river_fish'
  | 'snow_leopard_npc'
  | 'markhor_npc'
  | 'brown_bear_npc'
  | 'indus_dolphin_npc';

export type BiomeId =
  | 'northern_mountains'
  | 'deosai_plateau'
  | 'ziarat_juniper'
  | 'indus_river'
  | 'thar_desert';

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export type WeatherId = 'clear' | 'breeze' | 'mist' | 'snow' | 'rain' | 'dust';

export type GaitState =
  | 'idle'
  | 'walk'
  | 'trot'
  | 'gallop'
  | 'swim'
  | 'lunge'
  | 'freeze'
  | 'jump'
  | 'dive';

export interface BiomeConfig {
  id: BiomeId;
  name: string;
  nameUr: string;
  region: string;
  tagline: string;
  description: string;
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  fogDensity: number;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  groundLow: string;
  groundMid: string;
  groundHigh: string;
  rockColor: string;
  waterColor: string;
  waterDeepColor: string;
  mountainBaseColor: string;
  mountainPeakColor: string;
  snowCapThreshold: number;
  treeStyle: 'pine' | 'juniper' | 'acacia' | 'tamarisk' | 'alpine';
  hasRiver: boolean;
  hasOasis: boolean;
  baseTempC: number;
  terrainRoughness: number;
  terrainAmplitude: number;
  defaultWeather: WeatherId;
  availableWeather: WeatherId[];
  ambientProfile: 'mountain' | 'plateau' | 'juniper' | 'river' | 'desert';
}

export interface AbilitySpec {
  name: string;
  nameUr: string;
  keyHint: string;
  description: string;
  cooldownSec: number;
}

export interface AnimalConfig {
  id: AnimalId;
  name: string;
  nameUr: string;
  scientificName: string;
  homeBiome: BiomeId;
  role: 'predator' | 'herbivore' | 'omnivore' | 'aquatic' | 'ranger';
  unlockXp: number;
  conservationStatus: string;
  shortDesc: string;
  challengeDesc: string;
  fact: string;
  primaryAbility: AbilitySpec;
  secondaryAbility: AbilitySpec;
  skins: SkinSpec[];
  walkSpeed: number;
  trotSpeed: number;
  gallopSpeed: number;
  swimSpeed: number;
  aquaticOnly: boolean;
  idealTempMin: number;
  idealTempMax: number;
  scale: number;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  callPitchHz: number;
  callType: 'chuff' | 'bleat' | 'rumble' | 'whistle_click' | 'radio_whistle';
}

export type SpeciesRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface FieldGuideSpecies {
  id: NpcSpeciesId;
  name: string;
  nameUr: string;
  scientificName: string;
  rarity: SpeciesRarity;
  basePhotoPoints: number;
  rarityMultiplier: number;
  status: string;
  biomeHint: string;
  fact: string;
}

export interface NpcActor {
  id: string;
  kind: 'prey' | 'predator' | 'poacher' | 'shikari' | 'trapped_animal';
  species: NpcSpeciesId;
  name: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  radius: number;
  gait: GaitState;
  aiState:
    | 'wander'
    | 'alert_freeze'
    | 'flee'
    | 'stalk'
    | 'aiming'
    | 'stunned'
    | 'sedated'
    | 'arrested'
    | 'rescued';
  stateTimer: number;
  zigZagPhase: number;
  hopPhase: number;
  health: number;
  photographed: boolean;
}

export interface WorldItem {
  id: string;
  kind: 'food' | 'orb' | 'snare' | 'water_spot' | 'jaal';
  x: number;
  y: number;
  z: number;
  heading?: number;
  width?: number;
  collected: boolean;
  label: string;
}

export interface DartProjectile {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

export interface SimEvent {
  type:
    | 'hunt_catch'
    | 'eat_forage'
    | 'drink'
    | 'orb_collected'
    | 'dart_fired'
    | 'poacher_sedated'
    | 'poacher_arrested'
    | 'animal_rescued'
    | 'snare_cleared'
    | 'jaal_cleared'
    | 'jaal_hit'
    | 'shikari_shot'
    | 'player_hurt'
    | 'horn_counter'
    | 'threat_stunned'
    | 'jump_leap'
    | 'pounce_launch'
    | 'dive_toggle'
    | 'growth_up'
    | 'photo_captured'
    | 'binoculars_scout'
    | 'tool_switched'
    | 'swim_enter'
    | 'swim_exit'
    | 'animal_call'
    | 'nearby_animal_call'
    | 'victory'
    | 'game_over';
  label?: string;
  speciesId?: string;
  distance?: number;
  rarity?: SpeciesRarity;
  qualityGrade?: 'S' | 'A' | 'B';
  photoScore?: number;
  actionTag?: string;
}

export interface BinocularsTargetState {
  actorId: string;
  name: string;
  category: 'Poacher' | 'Trapped Wildlife' | 'Wire Snare' | 'Wild Species';
  distance: number;
  statusText: string;
  alreadyScouted: boolean;
}

export interface PhotoTargetState {
  actorId: string;
  speciesId: NpcSpeciesId;
  speciesName: string;
  scientificName: string;
  rarity: SpeciesRarity;
  rarityLabel: string;
  distance: number;
  steadyProgress: number;
  alreadyPhotographed: boolean;
  qualityGrade: 'S' | 'A' | 'B';
  projectedPoints: number;
  scoreBreakdownText: string;
  actionTag?: string;
  posedByCall?: boolean;
  isSpeciesOfDay?: boolean;
  isEvidence?: boolean;
}

export interface SavedPhotoEntry {
  id: string;
  speciesId: NpcSpeciesId;
  speciesName: string;
  scientificName: string;
  biomeId: BiomeId;
  biomeName: string;
  rangerName: string;
  dataUrl: string;
  timestamp: number;
  rarity?: SpeciesRarity;
  qualityGrade?: 'S' | 'A' | 'B';
  photoScore?: number;
  actionTag?: string;
}

export interface BiomeConservationState {
  biomeId: BiomeId;
  conservationScore: number; // 0..100
  speciesCount: number;
  poachersStopped: number;
  photosLogged: number;
  wildlifeHarmEvents: number;
}

export type CoopSquadMode = 'rangers' | 'wolf_pack';

export interface CoopPeerState {
  peerId: string;
  playerName: string;
  animalId: AnimalId;
  skinId?: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  gait: GaitState;
  growthStage?: GrowthStage;
  updatedAt: number;
}

export interface SimSnapshot {
  phase: 'intro' | 'playing' | 'paused' | 'victory' | 'gameover';
  keepExploring: boolean;
  round: number;
  mode: GameMode;
  animalId: AnimalId;
  biomeId: BiomeId;
  season: SeasonId;
  weather: WeatherId;
  seed: number;
  elapsedSec: number;
  roundDurationSec: number;
  roundTimeLeftSec: number;
  roundMissionTitle: string;
  roundMissionText: string;
  roundMissionProgress: string;
  roundMissionDone: boolean;
  nextMissionTitle: string;
  nextMissionText: string;
  score: number;
  xpEarned: number;
  growthStage: GrowthStage;
  growthProgress: number;
  conservationScore: number;
  speciesCount: number;
  migrationLabel: string;
  isDailyExpedition: boolean;
  playerX: number;
  playerY: number;
  playerZ: number;
  distanceToWater: number;
  elevation: number;
  playerHeading: number;
  playerSpeed: number;
  playerGait: GaitState;
  isSwimming: boolean;
  isAirborne: boolean;
  isDiving: boolean;
  playerHurtFlash: boolean;
  damageTaken: number;
  adrenalineTimer: number;
  health: number;
  food: number;
  water: number;
  energy: number;
  oxygen: number;
  temperatureC: number;
  primaryCooldown: number;
  secondaryCooldown: number;
  secondaryActive: boolean;
  spottedPreyName: string | null;
  dangerWarning: string;
  orbsCollected: number;
  orbsTarget: number;
  preyCaught: number;
  jaalsCleared: number;
  poachersArrested: number;
  poachersTotal: number;
  animalsRescued: number;
  animalsTrappedTotal: number;
  snaresCleared: number;
  snaresTotal: number;
  photosTaken: number;
  photosTarget: number;
  photographedSpecies: string[];
  photoTarget: PhotoTargetState | null;
  equippedTool: RangerToolId;
  binocularsZoomed: boolean;
  telephotoZoomed: boolean;
  binocularsTarget: BinocularsTargetState | null;
  scoutedCount: number;
  evidencePhotosTaken: number;
  photoCombo: number;
  lastPhotoGrade: 'S' | 'A' | 'B' | null;
  photoScoreTotal: number;
  bestPhotoScore: number;
  bestPhotoLabel: string | null;
  sRankCount: number;
  actionShotsCount: number;
  rareShotsCount: number;
  safariChallengeTitle: string;
  safariChallengeText: string;
  safariChallengeProgress: string;
  safariChallengeDone: boolean;
  safariChallengeBonus: number;
  dartTargetName: string | null;
  dartTargetDistance: number | null;
  guideTargetLabel: string;
  guideWorldAngle: number;
  guideDistance: number;
  statusMessage: string;
  failReason: string;
}

export interface PlayerRecord {
  id: string;
  playerName: string;
  round?: number;
  mode: GameMode;
  animalId: AnimalId;
  biomeId: BiomeId;
  score: number;
  elapsedSec: number;
  victory: boolean;
  seed: number;
  timestamp: number;
  summary: string;
  isDaily?: boolean;
  dailyDate?: string;
  weekKey?: string;
  conservationScore?: number;
  growthStage?: GrowthStage;
}
