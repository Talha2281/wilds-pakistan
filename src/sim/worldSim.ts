import { ANIMALS, FIELD_GUIDE_SPECIES, SPECIES_RARITY_META } from '../data/animals';
import { BIOMES } from '../data/biomes';
import { loadConservationMap, updateBiomeConservation } from '../data/conservation';
import { getDailyExpedition } from '../data/dailyExpedition';
import { getGrowthStageFromRunXp } from '../data/progression';
import {
  AnimalId,
  BinocularsTargetState,
  BiomeId,
  CoopPeerState,
  DartProjectile,
  GaitState,
  GameMode,
  GrowthStage,
  NpcActor,
  NpcSpeciesId,
  PhotoTargetState,
  RangerToolId,
  SeasonId,
  SimEvent,
  SimSnapshot,
  SpeciesRarity,
  WeatherId,
} from '../types/game';
import {
  PLAYABLE_RADIUS,
  WATER_LEVEL,
  WorldLayout,
  generateWorldLayout,
  getGroundSlope,
  getRiverCenterX,
  getTerrainHeight,
  isWaterAt,
} from './terrainMath';

export interface SimInput {
  moveX: number;
  moveZ: number;
  cameraYaw: number;
  sprint: boolean;
  actionPressed: boolean;
  secondaryPressed?: boolean;
  callPressed: boolean;
}

export interface SimOptions {
  mode: GameMode;
  animalId: AnimalId;
  biomeId: BiomeId;
  season?: SeasonId;
  weather?: WeatherId;
  seed?: number;
  round?: number;
  initialScore?: number;
  initialRunXp?: number;
  startPlaying?: boolean;
  isDailyExpedition?: boolean;
  previousSpawns?: Array<{ x: number; z: number }>;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(current: number, target: number, t: number): number {
  const diff = normalizeAngle(target - current);
  return normalizeAngle(current + diff * Math.min(1, t));
}

function generateEntropySeed(): number {
  let randBits = Math.floor(Math.random() * 0xffffffff);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    randBits = arr[0];
  }
  return ((Date.now() ^ randBits ^ Math.floor(performance.now() * 1000)) >>> 0) || 104729;
}

export class GameSimulation {
  public layout: WorldLayout;
  public mode: GameMode;
  public animalId: AnimalId;
  public biomeId: BiomeId;
  public season: SeasonId;
  public weather: WeatherId;
  public seed: number;
  public round: number;
  public isDailyExpedition: boolean;

  public phase: 'intro' | 'playing' | 'paused' | 'victory' | 'gameover';
  public keepExploring = false;
  public elapsedSec = 0;
  public roundDurationSec = 95;
  public score = 0;
  public xpEarned = 0;
  public growthStage: GrowthStage = 'cub';
  public growthProgress = 0;

  public conservationScore = 60;
  public speciesCount = 16;

  // Player 3D kinematic state
  public playerX: number;
  public playerY: number;
  public playerZ: number;
  public playerVx = 0;
  public playerVy = 0;
  public playerVz = 0;
  public playerHeading: number;
  public playerSpeed = 0;
  public playerGait: GaitState = 'idle';
  public isSwimming = false;
  public isAirborne = false;
  public isDiving = false;
  public lungeTimer = 0;
  public adrenalineTimer = 0;
  public playerHurtTimer = 0;
  public damageTaken = 0;

  // Cooldowns & ability timers
  public primaryCooldown = 0;
  public secondaryCooldown = 0;
  public secondaryActiveTimer = 0;

  // Survival vitals
  public health = 100;
  public food = 88;
  public water = 88;
  public energy = 100;
  public oxygen = 100;
  public temperatureC: number;

  // Mode & challenge tracking
  public orbsCollected = 0;
  public orbsTarget = 5;
  public preyCaught = 0;
  public jaalsCleared = 0;
  public poachersArrested = 0;
  public poachersTotal = 0;
  public animalsRescued = 0;
  public animalsTrappedTotal = 0;
  public snaresCleared = 0;
  public snaresTotal = 0;
  public photosTaken = 0;
  public photosTarget = 5;
  public photographedSpecies: Set<string> = new Set();

  public spottedPreyName: string | null = null;
  public dangerWarning = '';

  // Viewfinder & Ranger Toolkit state
  public activePhotoTargetId: string | null = null;
  public photoSteadySec = 0;
  public photoTarget: PhotoTargetState | null = null;
  public equippedTool: RangerToolId = 'dart';
  public binocularsZoomed = false;
  public telephotoZoomed = false;
  public binocularsTarget: BinocularsTargetState | null = null;
  public scoutedActorIds: Set<string> = new Set();
  public evidenceActorIds: Set<string> = new Set();
  public evidencePhotosTaken = 0;
  public photoCombo = 0;
  public lastPhotoGrade: 'S' | 'A' | 'B' | null = null;
  public photoScoreTotal = 0;
  public bestPhotoScore = 0;
  public bestPhotoLabel: string | null = null;
  public sRankCount = 0;
  public actionShotsCount = 0;
  public rareShotsCount = 0;
  public safariChallengeDone = false;
  private rareQualityPhotosCount = 0;
  private motionOrSRankCount = 0;
  private telephotoCallPortraitCount = 0;
  private bestScoreBySpecies: Map<NpcSpeciesId, number> = new Map();
  public dartTargetName: string | null = null;
  public dartTargetDistance: number | null = null;
  private lastCameraYaw = 0;
  private speciesOfDayId: string;
  private shutterCooldown = 0;

  public darts: DartProjectile[] = [];
  public shikariShots: DartProjectile[] = [];
  private dartSeq = 0;
  private jaalHitCooldown = 0;
  private meleeHitCooldown = 0;
  private predatorHitCooldown = 0;

  public statusMessage = '';
  public failReason = '';
  private statusTimer = 0;
  public ambientCallCooldown = 2.5;
  public pendingEvents: SimEvent[] = [];
  public coopPeers: CoopPeerState[] = [];

  public guideTargetLabel = '';
  public guideWorldAngle = 0;
  public guideDistance = 0;

  constructor(options: SimOptions) {
    this.mode = options.mode;
    this.animalId = options.animalId;
    this.biomeId = options.biomeId;
    const biome = BIOMES[this.biomeId];
    this.season = options.season ?? 'summer';
    this.weather = options.weather ?? biome.defaultWeather;
    this.round = Math.max(1, options.round ?? 1);
    this.roundDurationSec = Math.min(115, 95 + (this.round - 1) * 5);
    this.score = options.initialScore ?? 0;
    this.xpEarned = options.initialRunXp ?? 0;
    this.isDailyExpedition = Boolean(options.isDailyExpedition);
    this.seed = options.seed ?? generateEntropySeed();
    this.phase = options.startPlaying ? 'playing' : 'intro';

    const consMap = loadConservationMap();
    this.conservationScore = consMap[this.biomeId].conservationScore;
    this.speciesCount = consMap[this.biomeId].speciesCount;

    if (this.animalId === 'ranger') {
      this.growthStage = 'adult';
      this.growthProgress = 1;
    } else if (this.xpEarned > 0) {
      const g = getGrowthStageFromRunXp(this.xpEarned);
      this.growthStage = g.stage;
      this.growthProgress = g.progress;
    }

    this.layout = generateWorldLayout(
      this.seed,
      this.biomeId,
      this.animalId,
      this.mode,
      this.round,
      options.previousSpawns ?? [],
    );
    this.playerX = this.layout.playerStart.x;
    this.playerZ = this.layout.playerStart.z;
    this.playerHeading = this.layout.playerStart.heading;
    this.lastCameraYaw = this.playerHeading;
    this.speciesOfDayId = getDailyExpedition().speciesOfDayId;
    if (this.mode === 'photo_safari') {
      this.equippedTool = 'camera';
    }
    this.isSwimming = isWaterAt(this.playerX, this.playerZ, this.layout.terrain);
    this.playerY = this.isSwimming
      ? WATER_LEVEL - 0.1
      : getTerrainHeight(this.playerX, this.playerZ, this.layout.terrain);

    this.temperatureC = this.computeAmbientTempC();

    this.orbsTarget = this.layout.items.filter((i) => i.kind === 'orb').length;
    this.poachersTotal = this.layout.npcs.filter((n) => n.kind === 'poacher').length;
    this.animalsTrappedTotal = this.layout.npcs.filter((n) => n.kind === 'trapped_animal').length;
    this.snaresTotal = this.layout.items.filter((i) => i.kind === 'snare').length;
    this.photosTarget = Math.min(5, 2 + this.round);

    this.updateGuideArrow();
  }

  public setCoopPeers(peers: CoopPeerState[]): void {
    this.coopPeers = peers;
  }

  public getPlayerCollisionRadius(): number {
    let base = 1.3;
    if (this.animalId === 'ranger') base = 1.15;
    else if (this.animalId === 'brown_bear') base = 1.6;
    else if (this.animalId === 'markhor' || this.animalId === 'snow_leopard') base = 1.4;
    else if (this.animalId === 'indus_dolphin') base = 1.35;

    if (this.animalId === 'ranger') return base;
    const growthMult =
      this.growthStage === 'cub' ? 0.86 : this.growthStage === 'juvenile' ? 0.96 : 1.08;
    return base * growthMult;
  }

  private getDistanceToWater(): number {
    const biome = BIOMES[this.biomeId];
    const t = this.layout.terrain;
    if (biome.hasRiver) {
      const rx = getRiverCenterX(this.playerZ, t);
      return Math.max(0, Math.abs(this.playerX - rx) - t.riverWidth * 0.55);
    }
    if (biome.hasOasis) {
      return Math.max(0, Math.hypot(this.playerX - t.oasisX, this.playerZ - t.oasisZ) - t.oasisRadius * 0.9);
    }
    return 120;
  }

  public getRoundMissionMeta(targetRound = this.round): {
    title: string;
    text: string;
    progress: string;
    done: boolean;
  } {
    if (this.mode === 'ranger_patrol') {
      const titles = [
        'Sector Patrol',
        'Dawn Anti-Poaching Raid',
        'Wildlife Rescue Push',
        'Sanctuary Lockdown',
      ];
      const title = titles[(targetRound - 1) % titles.length];
      const text =
        targetRound === 1
          ? `Arrest ${this.poachersTotal} poachers, rescue ${this.animalsTrappedTotal} animals & clear ${this.snaresTotal} snares in 1:35.`
          : `Rapid Patrol Rd ${targetRound}: Stop all poachers & clear sector snares before time expires.`;
      const total = this.poachersTotal + this.animalsTrappedTotal + this.snaresTotal;
      const cur = this.poachersArrested + this.animalsRescued + this.snaresCleared;
      return {
        title,
        text,
        progress: `${cur}/${total} tasks`,
        done: targetRound === this.round && cur >= total,
      };
    }

    if (this.mode === 'photo_safari') {
      const titles = ['Field Guide Debut', 'Rare Species Survey', 'National Reserve Archive'];
      const title = titles[(targetRound - 1) % titles.length];
      const target = Math.min(5, 2 + targetRound);
      const text = `Catalog ${target} species—seek Rare/Legendary fauna & S-Rank poses for huge scores!`;
      return {
        title,
        text,
        progress: `${this.photosTaken}/${this.photosTarget} species`,
        done: targetRound === this.round && this.photosTaken >= this.photosTarget,
      };
    }

    // Wild Life dynamic missions per round & companion
    const slot = (targetRound - 1) % 3;
    if (slot === 0) {
      const title = targetRound === 1 ? 'Spirit Awakening' : 'Sanctuary Trail';
      return {
        title,
        text: `Collect ${this.orbsTarget} Spirit Orbs & survive Shikaris before time runs out.`,
        progress: `${this.orbsCollected}/${this.orbsTarget} orbs`,
        done: targetRound === this.round && this.orbsCollected >= this.orbsTarget,
      };
    }
    if (slot === 1) {
      if (this.animalId === 'markhor') {
        return {
          title: 'Cliff Defender',
          text: `Collect Orbs & Horn-Charge (F) or leap away from predators.`,
          progress: `${this.orbsCollected}/${this.orbsTarget} orbs`,
          done: targetRound === this.round && this.orbsCollected >= this.orbsTarget,
        };
      }
      if (this.animalId === 'indus_dolphin') {
        return {
          title: 'Jaal Runner',
          text: `Collect Orbs & clear at least 1 river Jaal net by leaping or deep-diving.`,
          progress: `${this.orbsCollected}/${this.orbsTarget} orbs · ${this.jaalsCleared} jaals`,
          done:
            targetRound === this.round &&
            this.orbsCollected >= this.orbsTarget &&
            this.jaalsCleared >= 1,
        };
      }
      return {
        title: 'Apex Hunt',
        text: `Collect Orbs & catch at least 1 wild prey on your pounce trail.`,
        progress: `${this.orbsCollected}/${this.orbsTarget} orbs · ${this.preyCaught} hunts`,
        done:
          targetRound === this.round &&
          this.orbsCollected >= this.orbsTarget &&
          this.preyCaught >= 1,
      };
    }
    return {
      title: 'Sovereign Growth',
      text: `Collect Orbs & grow toward Full Adult (${this.growthStage}).`,
      progress: `${this.orbsCollected}/${this.orbsTarget} orbs · ${this.growthStage}`,
      done: targetRound === this.round && this.orbsCollected >= this.orbsTarget,
    };
  }

  public getSafariChallengeMeta(targetRound = this.round): {
    title: string;
    text: string;
    progress: string;
    done: boolean;
    bonus: number;
  } {
    const slot = (targetRound - 1) % 3;
    if (slot === 0) {
      const cur = Math.min(1, this.rareQualityPhotosCount);
      return {
        title: 'Rare & Legendary Lens',
        text: 'Photograph 1 Rare or Legendary animal (Snow Leopard, Bear, Markhor, Dolphin) at A or S-Rank.',
        progress: `${cur}/1 Rare+ A/S`,
        done: this.safariChallengeDone || cur >= 1,
        bonus: 350,
      };
    }
    if (slot === 1) {
      const cur = Math.min(2, this.motionOrSRankCount);
      return {
        title: 'Wild Motion Masters',
        text: 'Capture 2 Action Pose shots (sprint, leap, swim) or S-Rank wildlife frames.',
        progress: `${cur}/2 S/Action`,
        done: this.safariChallengeDone || cur >= 2,
        bonus: 350,
      };
    }
    const cur = Math.min(1, this.telephotoCallPortraitCount);
    return {
      title: 'Telephoto Whisperer',
      text: 'Use Call (E) & 2.2× Telephoto (F) to land 1 S-Rank wildlife portrait.',
      progress: `${cur}/1 Telephoto S`,
      done: this.safariChallengeDone || cur >= 1,
      bonus: 380,
    };
  }

  public startFromIntro(): void {
    if (this.phase === 'intro') {
      this.phase = 'playing';
      this.pushStatus(this.getInitialStatusHint(), 4);
    }
  }

  public togglePause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'playing';
  }

  public resumeExplore(): void {
    this.keepExploring = true;
    this.phase = 'playing';
    this.pushStatus('Free exploration enabled — enjoy the wilderness!', 4);
  }

  public consumeEvents(): SimEvent[] {
    if (this.pendingEvents.length === 0) return [];
    const copy = this.pendingEvents;
    this.pendingEvents = [];
    return copy;
  }

  public getMigrationLabel(): string {
    if (this.season === 'winter') return 'Winter Valley Descent (Herds seek low shelter)';
    if (this.season === 'summer') return 'Summer High-Peak Migration (Herds climb crags)';
    if (this.season === 'autumn') return 'Autumn Foothill Shift';
    return 'Spring Meadow Bloom';
  }

  private awardRunXp(amount: number): void {
    this.xpEarned += amount;
    if (this.animalId === 'ranger') return;
    const prevStage = this.growthStage;
    const info = getGrowthStageFromRunXp(this.xpEarned);
    this.growthStage = info.stage;
    this.growthProgress = info.progress;
    if (prevStage !== info.stage) {
      const label = info.stage === 'juvenile' ? 'Juvenile' : 'Full Adult';
      this.health = Math.min(100, this.health + 20);
      this.energy = 100;
      this.pushStatus(`Growth Milestone: Grown into ${label}! (+Power & Speed)`, 3.4);
      this.pendingEvents.push({ type: 'growth_up', label });
    }
  }

  private adjustConservation(
    delta: number,
    opts?: { poachersStopped?: number; photosLogged?: number; wildlifeHarm?: number },
  ): void {
    const updated = updateBiomeConservation(this.biomeId, delta, opts);
    this.conservationScore = updated.conservationScore;
    this.speciesCount = updated.speciesCount;
  }

  private getInitialStatusHint(): string {
    if (this.mode === 'ranger_patrol') return 'Dart or tackle poachers, rescue caged wildlife, and clear snares.';
    if (this.mode === 'photo_safari') return 'Frame wildlife steadily in your viewfinder to fill the Field Guide.';
    const cfg = ANIMALS[this.animalId];
    return `Use ${cfg.primaryAbility.name} (${cfg.primaryAbility.keyHint}) & ${cfg.secondaryAbility.name} (${cfg.secondaryAbility.keyHint}) to survive!`;
  }

  private pushStatus(msg: string, duration = 2.8): void {
    this.statusMessage = msg;
    this.statusTimer = duration;
  }

  private computeAmbientTempC(): number {
    let t = BIOMES[this.biomeId].baseTempC;
    if (this.season === 'winter') t -= 12;
    else if (this.season === 'spring') t -= 2;
    else if (this.season === 'autumn') t -= 5;
    else if (this.season === 'summer') t += 4;

    if (this.weather === 'snow') t -= 6;
    else if (this.weather === 'rain') t -= 4;
    else if (this.weather === 'mist') t -= 2;
    if (this.isSwimming) t -= 5;
    return t;
  }

  public setEquippedTool(tool: RangerToolId): void {
    if (this.mode !== 'ranger_patrol') return;
    this.equippedTool = tool;
    this.binocularsZoomed = tool === 'binoculars';
    if (tool !== 'camera') {
      this.photoTarget = null;
      this.activePhotoTargetId = null;
      this.photoSteadySec = 0;
    }
    const label =
      tool === 'binoculars'
        ? 'Binoculars (4.5× Scope — Space to Scan/Tag)'
        : tool === 'camera'
          ? 'Field Camera (Space to Snap Wildlife & Evidence)'
          : 'Tranquilizer Dart Rifle (Space to Sedate Poachers)';
    this.pushStatus(`Equipped: ${label}`, 2.4);
    this.pendingEvents.push({ type: 'tool_switched', label: tool });
  }

  public toggleBinocularsZoom(): boolean {
    if (this.mode !== 'ranger_patrol' || this.equippedTool !== 'binoculars') return false;
    this.binocularsZoomed = !this.binocularsZoomed;
    this.pendingEvents.push({ type: 'tool_switched', label: 'binoculars_zoom' });
    return this.binocularsZoomed;
  }

  public toggleTelephotoZoom(): boolean {
    if (this.mode !== 'photo_safari') return false;
    this.telephotoZoomed = !this.telephotoZoomed;
    this.pushStatus(
      this.telephotoZoomed ? '2.2× Telephoto Lens Active' : 'Wide Safari Lens',
      1.6,
    );
    this.pendingEvents.push({ type: 'tool_switched', label: 'telephoto' });
    return this.telephotoZoomed;
  }

  public scoutCurrentBinocularsTarget(): boolean {
    if (this.mode !== 'ranger_patrol' || this.equippedTool !== 'binoculars') return false;
    this.updateRangerOpticsAndDartLock(this.lastCameraYaw);
    const target = this.binocularsTarget;
    if (target && !target.alreadyScouted) {
      this.scoutedActorIds.add(target.actorId);
      target.alreadyScouted = true;
      this.score += 65;
      this.awardRunXp(20);
      this.pushStatus(
        `Scouted ${target.name} (${target.distance}m · ${target.category}) +65 pts!`,
        2.5,
      );
      this.pendingEvents.push({ type: 'binoculars_scout', label: target.name });
      return true;
    }
    this.binocularsZoomed = !this.binocularsZoomed;
    this.pushStatus(
      this.binocularsZoomed ? 'Binoculars: 4.5× Optical Zoom' : 'Binoculars: Wide Scan',
      1.5,
    );
    this.pendingEvents.push({ type: 'tool_switched', label: 'binoculars_zoom' });
    return true;
  }

  public snapPhotoManual(): boolean {
    const allowed =
      this.mode === 'photo_safari' ||
      (this.mode === 'ranger_patrol' && this.equippedTool === 'camera');
    if (!allowed || this.shutterCooldown > 0) return false;
    this.shutterCooldown = 0.45;

    const match = this.findBestPhotoCandidate(this.lastCameraYaw, true);
    if (match) {
      this.recordPhotoCapture(match.npc, match.dot, match.dist, true);
      return true;
    }

    // Scenic field snapshot still saves to album and feels responsive!
    this.score += 20;
    this.photoScoreTotal += 20;
    this.pushStatus(
      `Captured ${BIOMES[this.biomeId].name} habitat shot! Aim at wildlife for Rarity × S-Rank pts.`,
      2.2,
    );
    this.pendingEvents.push({
      type: 'photo_captured',
      label: BIOMES[this.biomeId].name,
      speciesId: 'ibex',
      rarity: 'common',
      qualityGrade: 'B',
      photoScore: 20,
    });
    return true;
  }

  public fireDart(): boolean {
    if (this.mode !== 'ranger_patrol' || this.animalId !== 'ranger') return false;
    if (this.primaryCooldown > 0) return false;
    this.primaryCooldown = ANIMALS.ranger.primaryAbility.cooldownSec;

    let aimHeading = this.playerHeading;
    let bestDist = 38;
    for (const npc of this.layout.npcs) {
      if (npc.kind !== 'poacher' || npc.aiState === 'sedated' || npc.aiState === 'arrested') continue;
      const dx = npc.x - this.playerX;
      const dz = npc.z - this.playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        const angToNpc = Math.atan2(dx, dz);
        if (Math.abs(normalizeAngle(angToNpc - this.playerHeading)) < 0.72) {
          bestDist = dist;
          aimHeading = angToNpc;
        }
      }
    }

    const speed = 40;
    this.darts.push({
      id: `dart-${++this.dartSeq}`,
      x: this.playerX + Math.sin(aimHeading) * 0.9,
      y: this.playerY + 1.35,
      z: this.playerZ + Math.cos(aimHeading) * 0.9,
      vx: Math.sin(aimHeading) * speed,
      vy: 0.4,
      vz: Math.cos(aimHeading) * speed,
      life: 1.4,
    });
    this.pendingEvents.push({ type: 'dart_fired' });
    return true;
  }

  public triggerPrimaryAbility(): boolean {
    if (this.mode === 'ranger_patrol' && this.animalId === 'ranger') {
      if (this.equippedTool === 'binoculars') return this.scoutCurrentBinocularsTarget();
      if (this.equippedTool === 'camera') return this.snapPhotoManual();
      return this.fireDart();
    }
    if (this.mode === 'photo_safari') {
      return this.snapPhotoManual();
    }
    if (this.primaryCooldown > 0) return false;

    const cfg = ANIMALS[this.animalId];

    if (this.animalId === 'markhor') {
      if (this.isAirborne) return false;
      const slope = getGroundSlope(this.playerX, this.playerZ, this.layout.terrain);
      const hillBonus = Math.min(4.5, slope * 3.8);
      this.playerVy = 12.2 + hillBonus;
      this.playerVx += Math.sin(this.playerHeading) * 6.8;
      this.playerVz += Math.cos(this.playerHeading) * 6.8;
      this.isAirborne = true;
      this.energy = Math.max(0, this.energy - 7);
      this.primaryCooldown = cfg.primaryAbility.cooldownSec;
      this.pushStatus(hillBonus > 1.0 ? 'Markhor Hill Leap!' : 'Markhor Cliff Jump!', 1.5);
      this.pendingEvents.push({ type: 'jump_leap' });
      return true;
    }

    if (this.animalId === 'snow_leopard') {
      if (this.isAirborne) return false;
      const preyTarget = this.findPouncePreyTarget(14.5);
      const threatTarget = !preyTarget ? this.findClosestThreat(9.5) : null;
      const focusTarget = preyTarget ?? threatTarget;
      if (focusTarget) {
        this.playerHeading = Math.atan2(
          focusTarget.x - this.playerX,
          focusTarget.z - this.playerZ,
        );
      }
      this.playerVy = 9.2;
      this.playerVx = Math.sin(this.playerHeading) * 21.0;
      this.playerVz = Math.cos(this.playerHeading) * 21.0;
      this.isAirborne = true;
      this.lungeTimer = 0.65;
      this.energy = Math.max(0, this.energy - 8);
      this.primaryCooldown = cfg.primaryAbility.cooldownSec;

      if (threatTarget) {
        threatTarget.aiState = 'stunned';
        threatTarget.stateTimer = 5.5;
        threatTarget.vx = Math.sin(this.playerHeading) * 9;
        threatTarget.vz = Math.cos(this.playerHeading) * 9;
        this.score += 150;
        this.awardRunXp(35);
        this.pushStatus(`Pounced on ${threatTarget.name} to defend yourself!`, 2.2);
        this.pendingEvents.push({ type: 'threat_stunned' });
      } else {
        this.pushStatus(preyTarget ? `Pouncing onto ${preyTarget.name}!` : 'Snow Leopard Pounce!', 1.6);
        this.pendingEvents.push({ type: 'pounce_launch' });
      }
      return true;
    }

    if (this.animalId === 'brown_bear') {
      if (this.isAirborne) return false;
      this.playerVy = 8.0;
      this.isAirborne = true;
      this.lungeTimer = 0.5;
      this.primaryCooldown = cfg.primaryAbility.cooldownSec;
      this.energy = Math.max(0, this.energy - 8);
      let stunned = 0;
      const power = getGrowthStageFromRunXp(this.xpEarned).powerFactor;
      for (const npc of this.layout.npcs) {
        if (npc.kind !== 'shikari' && npc.kind !== 'predator') continue;
        const dx = npc.x - this.playerX;
        const dz = npc.z - this.playerZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 11.0 * power) {
          npc.aiState = 'stunned';
          npc.stateTimer = 6.5;
          const inv = 1 / Math.max(0.2, dist);
          npc.x += dx * inv * 4.5;
          npc.z += dz * inv * 4.5;
          stunned += 1;
          this.score += 130;
          this.awardRunXp(35);
        }
      }
      this.pushStatus(
        stunned > 0 ? `Bear Slam knocked down ${stunned} threat(s)!` : 'Bear Ground Slam!',
        2.0,
      );
      this.pendingEvents.push({ type: stunned > 0 ? 'threat_stunned' : 'jump_leap' });
      return true;
    }

    if (this.animalId === 'indus_dolphin') {
      if (this.isAirborne) return false;
      this.isDiving = false;
      this.playerVy = 13.0;
      this.playerVx += Math.sin(this.playerHeading) * 6.0;
      this.playerVz += Math.cos(this.playerHeading) * 6.0;
      this.isAirborne = true;
      this.primaryCooldown = cfg.primaryAbility.cooldownSec;
      this.oxygen = Math.min(100, this.oxygen + 35);
      this.pushStatus('Dolphin Breach Jump!', 1.4);
      this.pendingEvents.push({ type: 'jump_leap' });
      return true;
    }

    return false;
  }

  public triggerSecondaryAbility(): boolean {
    if (this.secondaryCooldown > 0) return false;
    const cfg = ANIMALS[this.animalId];

    if (this.animalId === 'indus_dolphin') {
      this.isDiving = !this.isDiving;
      this.secondaryCooldown = cfg.secondaryAbility.cooldownSec;
      if (this.isDiving) {
        this.isAirborne = false;
        this.playerVy = -4.2;
        this.pushStatus('Deep Dive! Swim underneath Jaal nets (watch Oxygen).', 2.2);
      } else {
        this.pushStatus('Surfacing for air!', 1.5);
      }
      this.pendingEvents.push({ type: 'dive_toggle' });
      return true;
    }

    if (this.animalId === 'markhor') {
      // Horn Charge: Horns attacking Snow Leopards or Shikaris -> knocks back, forces predator to FLEE, & gives escape run burst!
      this.secondaryCooldown = cfg.secondaryAbility.cooldownSec;
      this.secondaryActiveTimer = 0.85;
      this.lungeTimer = 0.6;
      const growthPower = getGrowthStageFromRunXp(this.xpEarned).powerFactor;
      const reach = 10.5 * growthPower;

      let hitPredator = false;
      let hitShikari = false;
      let hitCount = 0;

      for (const npc of this.layout.npcs) {
        if (npc.kind !== 'predator' && npc.kind !== 'shikari') continue;
        const dx = npc.x - this.playerX;
        const dz = npc.z - this.playerZ;
        const dist = Math.hypot(dx, dz);
        if (dist < reach) {
          const inv = 1 / Math.max(0.2, dist);
          npc.x += dx * inv * 6.0;
          npc.z += dz * inv * 6.0;
          npc.health = Math.max(10, npc.health - Math.round(55 * growthPower));
          // Make horned predators & shikaris recoil and flee while Markhor runs to safety!
          npc.aiState = 'flee';
          npc.stateTimer = 7.5;
          npc.heading = Math.atan2(dx, dz);
          hitCount += 1;
          this.score += 180;
          this.awardRunXp(45);
          if (npc.kind === 'predator') hitPredator = true;
          else hitShikari = true;
        }
      }

      if (hitCount > 0) {
        // Turn away from danger & sprint away to protect yourself!
        this.adrenalineTimer = 3.5;
        this.energy = Math.min(100, this.energy + 25);
        this.playerVx = Math.sin(this.playerHeading) * 23.5;
        this.playerVz = Math.cos(this.playerHeading) * 23.5;
        this.pushStatus(
          hitPredator
            ? 'Horned the Leopard! It recoils—run to safety!'
            : hitShikari
              ? 'Horn-charged Shikari! Sprint away!'
              : `Horn Charge drove back ${hitCount} threat(s)!`,
          2.6,
        );
        this.pendingEvents.push({ type: 'horn_counter' });
      } else {
        this.playerVx = Math.sin(this.playerHeading) * 22.0;
        this.playerVz = Math.cos(this.playerHeading) * 22.0;
        this.pushStatus('Markhor Horn Charge!', 1.8);
        this.pendingEvents.push({ type: 'pounce_launch' });
      }
      return true;
    }

    if (this.animalId === 'snow_leopard') {
      this.secondaryCooldown = cfg.secondaryAbility.cooldownSec;
      this.secondaryActiveTimer = 7.0;
      for (const npc of this.layout.npcs) {
        if (npc.kind === 'shikari' && npc.aiState === 'aiming') {
          npc.aiState = 'wander';
          npc.stateTimer = 2.0;
        }
      }
      this.pushStatus('Shadow Stalk active (7s) — fast stealth prowl!', 2.5);
      return true;
    }

    if (this.animalId === 'brown_bear') {
      this.secondaryCooldown = cfg.secondaryAbility.cooldownSec;
      this.secondaryActiveTimer = 1.6;
      let scared = 0;
      for (const npc of this.layout.npcs) {
        if (npc.kind !== 'predator' && npc.kind !== 'shikari') continue;
        if (Math.hypot(npc.x - this.playerX, npc.z - this.playerZ) < 22.0) {
          npc.aiState = 'flee';
          npc.stateTimer = 7.0;
          scared += 1;
          this.score += 120;
          this.awardRunXp(30);
        }
      }
      this.pushStatus(
        scared > 0 ? `Thunder Roar panicked ${scared} threat(s)!` : 'Thunder Roar echoed across the mountains!',
        2.4,
      );
      this.pendingEvents.push({ type: 'animal_call', label: 'Brown Bear Roar' });
      return true;
    }

    if (this.mode === 'photo_safari') {
      this.secondaryCooldown = 0.25;
      return this.toggleTelephotoZoom();
    }

    if (this.animalId === 'ranger' && !this.isAirborne) {
      this.playerVy = 10.8;
      this.isAirborne = true;
      this.secondaryCooldown = cfg.secondaryAbility.cooldownSec;
      this.pendingEvents.push({ type: 'jump_leap' });
      return true;
    }

    return false;
  }

  private findClosestThreat(maxDist: number): NpcActor | null {
    let best: NpcActor | null = null;
    let bestDist = maxDist;
    for (const npc of this.layout.npcs) {
      if ((npc.kind !== 'shikari' && npc.kind !== 'predator') || npc.aiState === 'stunned' || npc.aiState === 'flee') continue;
      const dist = Math.hypot(npc.x - this.playerX, npc.z - this.playerZ);
      if (dist < bestDist) {
        bestDist = dist;
        best = npc;
      }
    }
    return best;
  }

  private findPouncePreyTarget(maxDist: number): NpcActor | null {
    let best: NpcActor | null = null;
    let bestDist = maxDist;
    for (const npc of this.layout.npcs) {
      if (npc.kind !== 'prey' || npc.health <= 0) continue;
      if (npc.species === 'river_fish' && this.animalId === 'snow_leopard') continue;
      const dx = npc.x - this.playerX;
      const dz = npc.z - this.playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = npc;
      }
    }
    return best;
  }

  public step(rawDt: number, input: SimInput): void {
    const dt = Math.min(Math.max(rawDt, 0.0001), 0.05);
    if (this.phase !== 'playing') return;

    this.lastCameraYaw = input.cameraYaw;
    this.elapsedSec += dt;
    if (this.primaryCooldown > 0) this.primaryCooldown = Math.max(0, this.primaryCooldown - dt);
    if (this.shutterCooldown > 0) this.shutterCooldown = Math.max(0, this.shutterCooldown - dt);
    if (this.secondaryCooldown > 0) this.secondaryCooldown = Math.max(0, this.secondaryCooldown - dt);
    if (this.secondaryActiveTimer > 0) this.secondaryActiveTimer = Math.max(0, this.secondaryActiveTimer - dt);
    if (this.lungeTimer > 0) this.lungeTimer = Math.max(0, this.lungeTimer - dt);
    if (this.adrenalineTimer > 0) this.adrenalineTimer = Math.max(0, this.adrenalineTimer - dt);
    if (this.playerHurtTimer > 0) this.playerHurtTimer = Math.max(0, this.playerHurtTimer - dt);
    if (this.jaalHitCooldown > 0) this.jaalHitCooldown = Math.max(0, this.jaalHitCooldown - dt);
    if (this.meleeHitCooldown > 0) this.meleeHitCooldown = Math.max(0, this.meleeHitCooldown - dt);
    if (this.predatorHitCooldown > 0) this.predatorHitCooldown = Math.max(0, this.predatorHitCooldown - dt);
    if (this.ambientCallCooldown > 0) this.ambientCallCooldown = Math.max(0, this.ambientCallCooldown - dt);

    if (this.statusTimer > 0) {
      this.statusTimer -= dt;
      if (this.statusTimer <= 0) this.statusMessage = '';
    }

    if (input.callPressed) {
      this.pendingEvents.push({ type: 'animal_call', label: ANIMALS[this.animalId].name });
      // In Photo Safari, calling wildlife gets nearby herds & predators to pause & pose toward your camera!
      if (this.mode === 'photo_safari') {
        let attracted = 0;
        for (const npc of this.layout.npcs) {
          if (npc.kind !== 'prey' && npc.kind !== 'predator') continue;
          const d = Math.hypot(npc.x - this.playerX, npc.z - this.playerZ);
          if (d < 38 && d > 3.0) {
            npc.aiState = 'alert_freeze';
            npc.stateTimer = 2.6;
            npc.vx = 0;
            npc.vz = 0;
            npc.gait = 'freeze';
            npc.heading = Math.atan2(this.playerX - npc.x, this.playerZ - npc.z);
            attracted += 1;
          }
        }
        if (attracted > 0) {
          this.pushStatus(
            `${attracted} nearby animal(s) paused in Portrait Pose (+70 pts bonus)!`,
            2.2,
          );
        }
      }
    }

    if (input.actionPressed) {
      this.triggerPrimaryAbility();
    }
    if (input.secondaryPressed) {
      this.triggerSecondaryAbility();
    }

    this.updatePlayerMovement(dt, input);
    this.updateDarts(dt);
    this.updateShikariShots(dt);
    this.updateNpcs(dt);
    this.applySoftCollisionSeparation(dt);
    this.updateItemsAndInteractions(dt);
    this.updateSurvivalVitals(dt);
    this.updateRangerOpticsAndDartLock(input.cameraYaw);
    this.updatePhotoSafariViewfinder(dt, input);
    this.updateGuideArrow();
    this.checkVictoryOrDefeat();
  }

  private updatePlayerMovement(dt: number, input: SimInput): void {
    const cfg = ANIMALS[this.animalId];
    const terrain = this.layout.terrain;

    const inputMag = Math.min(1, Math.hypot(input.moveX, input.moveZ));
    const worldDirX =
      Math.sin(input.cameraYaw) * input.moveZ + Math.cos(input.cameraYaw) * input.moveX;
    const worldDirZ =
      Math.cos(input.cameraYaw) * input.moveZ - Math.sin(input.cameraYaw) * input.moveX;

    const wasSwimming = this.isSwimming;
    const groundAtPlayer = getTerrainHeight(this.playerX, this.playerZ, terrain);
    const inWater = groundAtPlayer < WATER_LEVEL - 0.05;
    this.isSwimming = inWater && !this.isAirborne;

    if (!wasSwimming && this.isSwimming) {
      this.pendingEvents.push({ type: 'swim_enter' });
    } else if (wasSwimming && !this.isSwimming && !this.isAirborne) {
      this.pendingEvents.push({ type: 'swim_exit' });
    }

    const canSprint = input.sprint && this.energy > 6;
    const slope = getGroundSlope(this.playerX, this.playerZ, terrain);
    const stageSpeedBoost =
      this.growthStage === 'adult' ? 1.08 : this.growthStage === 'juvenile' ? 1.03 : 1.0;

    let abilitySpeedMult = stageSpeedBoost;
    if (this.adrenalineTimer > 0) {
      // Protective escape burst after Markhor horns an attacking Snow Leopard or Shikari!
      abilitySpeedMult *= 1.32;
    } else if (this.animalId === 'markhor' && slope > 0.22) {
      abilitySpeedMult *= 1.2;
    } else if (this.animalId === 'snow_leopard' && this.secondaryActiveTimer > 0) {
      abilitySpeedMult *= 1.22;
    } else if (this.animalId === 'indus_dolphin' && this.isDiving) {
      abilitySpeedMult *= 1.16;
    } else if (this.animalId === 'brown_bear' && this.secondaryActiveTimer > 0) {
      abilitySpeedMult *= 1.14;
    }

    let targetSpeed = 0;
    if (inputMag > 0.06) {
      if (this.isSwimming) {
        targetSpeed = cfg.swimSpeed * (canSprint ? 1.25 : 1.0) * abilitySpeedMult * inputMag;
      } else if (canSprint) {
        targetSpeed = cfg.gallopSpeed * abilitySpeedMult * inputMag;
      } else if (inputMag > 0.65) {
        targetSpeed = cfg.trotSpeed * abilitySpeedMult * inputMag;
      } else {
        targetSpeed = cfg.walkSpeed * abilitySpeedMult * inputMag;
      }
    }

    if (this.lungeTimer > 0) {
      targetSpeed = Math.max(targetSpeed, cfg.gallopSpeed * 1.34);
    }

    const dirLen = Math.hypot(worldDirX, worldDirZ);
    const desiredVx = dirLen > 0.001 ? (worldDirX / dirLen) * targetSpeed : 0;
    const desiredVz = dirLen > 0.001 ? (worldDirZ / dirLen) * targetSpeed : 0;

    if (!this.isAirborne) {
      const accel = 1 - Math.exp(-10 * dt);
      this.playerVx += (desiredVx - this.playerVx) * accel;
      this.playerVz += (desiredVz - this.playerVz) * accel;
    } else {
      this.playerVx += (desiredVx - this.playerVx) * Math.min(1, 2.5 * dt);
      this.playerVz += (desiredVz - this.playerVz) * Math.min(1, 2.5 * dt);
    }

    this.playerSpeed = Math.hypot(this.playerVx, this.playerVz);

    if (this.playerSpeed > 0.35 && dirLen > 0.05 && !this.isAirborne) {
      const targetHeading = Math.atan2(this.playerVx, this.playerVz);
      this.playerHeading = lerpAngle(this.playerHeading, targetHeading, 12 * dt);
    }

    let nextX = this.playerX + this.playerVx * dt;
    let nextZ = this.playerZ + this.playerVz * dt;

    if (cfg.aquaticOnly && (BIOMES[this.biomeId].hasRiver || BIOMES[this.biomeId].hasOasis)) {
      const nextH = getTerrainHeight(nextX, nextZ, terrain);
      if (nextH > WATER_LEVEL + 0.15) {
        if (getTerrainHeight(nextX, this.playerZ, terrain) <= WATER_LEVEL + 0.15) {
          nextZ = this.playerZ;
        } else if (getTerrainHeight(this.playerX, nextZ, terrain) <= WATER_LEVEL + 0.15) {
          nextX = this.playerX;
        } else {
          nextX = this.playerX;
          nextZ = this.playerZ;
        }
      }
    }

    const r = Math.hypot(nextX, nextZ);
    if (r > PLAYABLE_RADIUS) {
      const scale = PLAYABLE_RADIUS / r;
      nextX *= scale;
      nextZ *= scale;
    }

    this.playerX = nextX;
    this.playerZ = nextZ;
    const newGround = getTerrainHeight(this.playerX, this.playerZ, terrain);
    const overWater = newGround < WATER_LEVEL - 0.05;

    if (this.isAirborne) {
      this.playerVy -= 25.0 * dt;
      this.playerY += this.playerVy * dt;
      const landingFloor = overWater ? WATER_LEVEL - 0.12 : newGround;
      if (this.playerY <= landingFloor && this.playerVy <= 0) {
        this.playerY = landingFloor;
        this.playerVy = 0;
        this.isAirborne = false;
        if (overWater) this.pendingEvents.push({ type: 'swim_enter' });
      }
    } else if (overWater) {
      this.isSwimming = true;
      const bob = Math.sin(this.elapsedSec * 4.5) * 0.06;
      const diveOffset =
        this.animalId === 'indus_dolphin' && this.isDiving ? -1.45 : this.animalId === 'indus_dolphin' ? -0.12 : -0.45;
      const targetY = Math.max(newGround + 0.35, WATER_LEVEL + diveOffset + bob);
      this.playerY += (targetY - this.playerY) * Math.min(1, 9 * dt);
    } else {
      this.isSwimming = false;
      this.isDiving = false;
      this.playerY += (newGround - this.playerY) * Math.min(1, 16 * dt);
    }

    if (this.isAirborne) {
      this.playerGait = this.lungeTimer > 0 ? 'lunge' : 'jump';
    } else if (this.isDiving) {
      this.playerGait = 'dive';
    } else if (this.lungeTimer > 0) {
      this.playerGait = 'lunge';
    } else if (this.isSwimming) {
      this.playerGait = 'swim';
    } else if (this.playerSpeed < 0.4) {
      this.playerGait = 'idle';
    } else if (this.playerSpeed < cfg.walkSpeed * 1.15) {
      this.playerGait = 'walk';
    } else if (this.playerSpeed < cfg.trotSpeed * 1.15) {
      this.playerGait = 'trot';
    } else {
      this.playerGait = 'gallop';
    }
  }

  private updateDarts(dt: number): void {
    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.vy -= 4.5 * dt;
      d.life -= dt;

      let hit = false;
      for (const npc of this.layout.npcs) {
        if (npc.kind !== 'poacher' || npc.aiState === 'sedated' || npc.aiState === 'arrested') continue;
        const dist = Math.hypot(npc.x - d.x, npc.z - d.z);
        if (dist < 1.85) {
          npc.aiState = 'sedated';
          npc.stateTimer = 10;
          npc.gait = 'freeze';
          npc.vx = 0;
          npc.vz = 0;
          hit = true;
          this.score += 120;
          this.awardRunXp(25);
          this.pushStatus(`${npc.name} sedated! Approach to arrest.`, 3);
          this.pendingEvents.push({ type: 'poacher_sedated', label: npc.name });
          break;
        }
      }

      if (hit || d.life <= 0) {
        this.darts.splice(i, 1);
      }
    }
  }

  private applyPlayerHurt(amount: number, reasonText: string): void {
    if (this.keepExploring || this.mode !== 'wild_life') return;
    this.health = Math.max(0, this.health - amount);
    this.damageTaken += amount;
    this.playerHurtTimer = 0.48;
    this.adjustConservation(-3, { wildlifeHarm: 1 });
    this.pushStatus(reasonText, 2.5);
    this.pendingEvents.push({ type: 'player_hurt' });
  }

  private updateShikariShots(dt: number): void {
    const groundAtPlayer = getTerrainHeight(this.playerX, this.playerZ, this.layout.terrain);

    for (let i = this.shikariShots.length - 1; i >= 0; i--) {
      const s = this.shikariShots[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.life -= dt;

      const distHoriz = Math.hypot(s.x - this.playerX, s.z - this.playerZ);
      const distVert = Math.abs(s.y - (this.playerY + 0.75));

      if (distHoriz < 1.5 && distVert < 1.85) {
        const highLeap = this.isAirborne && this.playerY > groundAtPlayer + 1.35;
        const countering =
          this.secondaryActiveTimer > 0 &&
          (this.animalId === 'markhor' || this.animalId === 'brown_bear');
        const dodging = highLeap || this.isDiving || countering || this.keepExploring;

        if (dodging) {
          this.score += 75;
          this.awardRunXp(20);
          this.pushStatus('Dodged Shikari rifle fire!', 1.8);
        } else {
          // Shikari gunfire genuinely hurts the animal!
          this.playerVx += Math.sign(s.vx || 1) * 4.2;
          this.playerVz += Math.sign(s.vz || 1) * 4.2;
          this.applyPlayerHurt(20, 'Shot & hurt by Shikari fire! Leap high (Space) or Charge (F)!');
        }
        this.shikariShots.splice(i, 1);
        continue;
      }

      if (s.life <= 0) {
        this.shikariShots.splice(i, 1);
      }
    }
  }

  private updateNpcs(dt: number): void {
    const terrain = this.layout.terrain;
    const playerRole = ANIMALS[this.animalId].role;
    const playerIsPredator = playerRole === 'predator' || playerRole === 'omnivore';
    const playerIsAquatic = this.animalId === 'indus_dolphin';
    const isStealthed = this.animalId === 'snow_leopard' && this.secondaryActiveTimer > 0;

    let nearestSpottedPrey: string | null = null;
    let nearestPreyDist = 16.0;
    let activeWarning = '';

    for (const npc of this.layout.npcs) {
      if (npc.kind === 'trapped_animal') {
        if (npc.aiState !== 'rescued') {
          npc.gait = 'idle';
          const dPlayer = Math.hypot(npc.x - this.playerX, npc.z - this.playerZ);
          if (this.mode === 'ranger_patrol' && dPlayer < 3.6) {
            npc.aiState = 'rescued';
            this.animalsRescued += 1;
            this.score += 300;
            this.awardRunXp(55);
            this.adjustConservation(7);
            this.pushStatus(`Rescued ${npc.name.replace('Trapped ', '')}! (+Species)`, 3);
            this.pendingEvents.push({ type: 'animal_rescued', label: npc.name });
          }
          continue;
        }
      }

      if (npc.kind === 'poacher') {
        if (npc.aiState === 'arrested') continue;
        const dPlayer = Math.hypot(npc.x - this.playerX, npc.z - this.playerZ);

        if (this.mode === 'ranger_patrol' && this.animalId === 'ranger' && dPlayer < 3.4) {
          npc.aiState = 'arrested';
          npc.vx = 0;
          npc.vz = 0;
          npc.gait = 'idle';
          this.poachersArrested += 1;
          this.score += 400;
          this.awardRunXp(70);
          this.adjustConservation(8, { poachersStopped: 1 });
          this.pushStatus(`Arrested ${npc.name}! (${this.poachersArrested}/${this.poachersTotal})`, 3);
          this.pendingEvents.push({ type: 'poacher_arrested', label: npc.name });
          continue;
        }

        if (npc.aiState === 'sedated') {
          npc.stateTimer -= dt;
          if (npc.stateTimer <= 0) npc.aiState = 'wander';
          continue;
        }

        if (dPlayer < 28) {
          const awayX = npc.x - this.playerX;
          const awayZ = npc.z - this.playerZ;
          const len = Math.max(0.01, Math.hypot(awayX, awayZ));
          npc.heading = Math.atan2(awayX / len, awayZ / len);
          npc.vx = Math.sin(npc.heading) * 7.8;
          npc.vz = Math.cos(npc.heading) * 7.8;
          npc.gait = 'gallop';
        } else {
          npc.stateTimer -= dt;
          if (npc.stateTimer <= 0) {
            npc.heading += Math.sin(this.elapsedSec * 7 + npc.x) * 1.4;
            npc.stateTimer = 2.5;
          }
          npc.vx = Math.sin(npc.heading) * 2.8;
          npc.vz = Math.cos(npc.heading) * 2.8;
          npc.gait = 'walk';
        }
      } else if (npc.kind === 'shikari') {
        const dPlayer = Math.hypot(npc.x - this.playerX, npc.z - this.playerZ);
        if (npc.aiState === 'stunned') {
          npc.stateTimer -= dt;
          npc.vx = 0;
          npc.vz = 0;
          npc.gait = 'freeze';
          if (npc.stateTimer <= 0) npc.aiState = 'wander';
          continue;
        }

        if (npc.aiState === 'flee') {
          npc.stateTimer -= dt;
          const awayAngle = Math.atan2(npc.x - this.playerX, npc.z - this.playerZ);
          npc.heading = lerpAngle(npc.heading, awayAngle, 9 * dt);
          npc.vx = Math.sin(npc.heading) * 8.4;
          npc.vz = Math.cos(npc.heading) * 8.4;
          npc.gait = 'gallop';
          if (npc.stateTimer <= 0) npc.aiState = 'wander';
        } else {
          const detectRange = isStealthed ? 11.0 : 38.0 + Math.min(10, this.round * 2);
          if (this.mode === 'wild_life' && dPlayer < detectRange && !(playerIsAquatic && this.isDiving)) {
            const toPlayer = Math.atan2(this.playerX - npc.x, this.playerZ - npc.z);
            npc.heading = lerpAngle(npc.heading, toPlayer, 8 * dt);

            if (dPlayer < 3.0 && this.meleeHitCooldown <= 0 && !this.keepExploring && this.lungeTimer <= 0) {
              this.meleeHitCooldown = 1.25;
              this.applyPlayerHurt(16, 'Shikari struck! Charge / Pounce / Slam (F / Space)!');
            }

            if (dPlayer > 24 && !playerIsAquatic) {
              npc.aiState = 'stalk';
              npc.vx = Math.sin(npc.heading) * (6.2 + Math.min(1.6, this.round * 0.4));
              npc.vz = Math.cos(npc.heading) * (6.2 + Math.min(1.6, this.round * 0.4));
              npc.gait = 'gallop';
              activeWarning = 'Shikari hunting you — prepare to defend or leap!';
            } else {
              npc.vx = 0;
              npc.vz = 0;
              npc.gait = 'freeze';
              if (npc.aiState !== 'aiming') {
                npc.aiState = 'aiming';
                npc.stateTimer = Math.max(0.85, 1.35 - this.round * 0.1);
              } else {
                npc.stateTimer -= dt;
                activeWarning = `Shikari aiming (${npc.stateTimer.toFixed(1)}s) — Leap / Charge!`;
                if (npc.stateTimer <= 0) {
                  const dx = this.playerX - npc.x;
                  const dy = this.playerY + 0.75 - (npc.y + 1.35);
                  const dz = this.playerZ - npc.z;
                  const dist3 = Math.max(0.1, Math.hypot(dx, dy, dz));
                  const shotSpeed = 46;
                  this.shikariShots.push({
                    id: `shot-${++this.dartSeq}`,
                    x: npc.x + Math.sin(npc.heading) * 1.1,
                    y: npc.y + 1.35,
                    z: npc.z + Math.cos(npc.heading) * 1.1,
                    vx: (dx / dist3) * shotSpeed,
                    vy: (dy / dist3) * shotSpeed,
                    vz: (dz / dist3) * shotSpeed,
                    life: 1.5,
                  });
                  this.pendingEvents.push({ type: 'shikari_shot' });
                  npc.stateTimer = Math.max(1.2, 2.0 - this.round * 0.15);
                }
              }
            }
          } else {
            npc.aiState = 'wander';
            npc.stateTimer -= dt;
            if (npc.stateTimer <= 0) {
              npc.heading += Math.sin(this.elapsedSec * 4 + npc.z) * 1.2;
              npc.stateTimer = 2.8;
            }
            npc.vx = Math.sin(npc.heading) * 3.0;
            npc.vz = Math.cos(npc.heading) * 3.0;
            npc.gait = 'walk';
          }
        }
      } else if (npc.kind === 'prey') {
        const isFish = npc.species === 'river_fish' || npc.species === 'indus_dolphin_npc';
        const dPlayer = Math.hypot(npc.x - this.playerX, npc.z - this.playerZ);

        const canHuntThis =
          this.mode === 'wild_life' &&
          ((playerIsPredator && !isFish) ||
            (this.animalId === 'brown_bear' && isFish) ||
            (playerIsAquatic && isFish));

        if (canHuntThis && dPlayer < nearestPreyDist && npc.health > 0) {
          nearestPreyDist = dPlayer;
          nearestSpottedPrey = npc.name;
        }

        if (
          canHuntThis &&
          this.animalId === 'snow_leopard' &&
          !this.isAirborne &&
          this.primaryCooldown <= 0 &&
          dPlayer > 4.2 &&
          dPlayer < 8.5 &&
          npc.health > 0
        ) {
          this.triggerPrimaryAbility();
        }

        if (canHuntThis && dPlayer < 4.2 && npc.health > 0) {
          this.lungeTimer = 0.28;
          npc.health = 0;
          this.preyCaught += 1;
          this.food = Math.min(100, this.food + 34);
          this.energy = Math.min(100, this.energy + 18);
          this.health = Math.min(100, this.health + 8);
          this.score += 180;
          this.awardRunXp(45);
          this.pushStatus(`Pounced & ate ${npc.name}! +Food & XP`, 2.6);
          this.pendingEvents.push({ type: 'hunt_catch', label: npc.name });

          const ang = normalizeAngle(this.playerHeading + Math.PI + (npc.x % 1.5));
          npc.x = Math.cos(ang) * 78;
          npc.z = Math.sin(ang) * 78;
          if (isFish) {
            const zFish = ((this.elapsedSec * 23) % 180) - 90;
            npc.z = zFish;
            npc.x = getRiverCenterX(zFish, this.layout.terrain);
          }
          npc.health = 100;
          npc.aiState = 'wander';
          continue;
        }

        const sprintingPhotoSpook =
          this.mode === 'photo_safari' && this.playerGait === 'gallop' ? 19.5 : 7.5;
        const threatRange =
          this.mode === 'photo_safari' ? sprintingPhotoSpook : isStealthed ? 6.5 : 16.0;
        if (dPlayer < threatRange && npc.aiState === 'wander') {
          npc.aiState = 'alert_freeze';
          npc.stateTimer = 0.55;
          npc.vx = 0;
          npc.vz = 0;
          npc.gait = 'freeze';
          if (this.ambientCallCooldown <= 0 && dPlayer < 40) {
            this.ambientCallCooldown = 3.2;
            this.pendingEvents.push({
              type: 'nearby_animal_call',
              speciesId: npc.species,
              distance: dPlayer,
              label: npc.name,
            });
          }
        } else if (npc.aiState === 'alert_freeze') {
          npc.stateTimer -= dt;
          npc.vx = 0;
          npc.vz = 0;
          npc.gait = 'freeze';
          if (npc.stateTimer <= 0) {
            npc.aiState = 'flee';
            npc.stateTimer = 3.2;
          }
        } else if (npc.aiState === 'flee') {
          npc.stateTimer -= dt;
          npc.zigZagPhase += dt * 5.2;
          npc.hopPhase += dt * 11.0;

          const awayX = npc.x - this.playerX;
          const awayZ = npc.z - this.playerZ;
          const baseAngle = Math.atan2(awayX, awayZ);
          const zigOffset = Math.sin(npc.zigZagPhase) * 0.65;
          npc.heading = lerpAngle(npc.heading, baseAngle + zigOffset, 9 * dt);
          const fleeSpeed = isFish ? 7.5 : 10.2;
          npc.vx = Math.sin(npc.heading) * fleeSpeed;
          npc.vz = Math.cos(npc.heading) * fleeSpeed;
          npc.gait = isFish ? 'swim' : 'gallop';

          if (npc.stateTimer <= 0 && dPlayer > 22) {
            npc.aiState = 'wander';
            npc.stateTimer = 2.5;
          }
        } else {
          // Seasonal altitude migration for Markhor & Ibex herds!
          const isMountainUngulate = npc.species === 'markhor_npc' || npc.species === 'ibex';
          npc.stateTimer -= dt;
          if (npc.stateTimer <= 0) {
            if (isMountainUngulate && (this.season === 'winter' || this.season === 'summer')) {
              const curH = getTerrainHeight(npc.x, npc.z, terrain);
              const wantLow = this.season === 'winter';
              const stepAheadX = npc.x + Math.sin(npc.heading) * 6;
              const stepAheadZ = npc.z + Math.cos(npc.heading) * 6;
              const aheadH = getTerrainHeight(stepAheadX, stepAheadZ, terrain);
              if ((wantLow && aheadH > curH) || (!wantLow && aheadH < curH)) {
                npc.heading += Math.PI * 0.65;
              } else {
                npc.heading += (Math.sin(this.elapsedSec * 2.7 + npc.z) - 0.15) * 0.6;
              }
            } else {
              npc.heading += (Math.sin(this.elapsedSec * 3.1 + npc.z) - 0.2) * 1.2;
            }
            npc.stateTimer = 2.4;
          }
          const wanderSpeed = isFish ? 3.2 : 2.8;
          npc.vx = Math.sin(npc.heading) * wanderSpeed;
          npc.vz = Math.cos(npc.heading) * wanderSpeed;
          npc.gait = isFish ? 'swim' : 'walk';
        }
      } else if (npc.kind === 'predator') {
        if (npc.aiState === 'stunned') {
          npc.stateTimer -= dt;
          npc.vx = 0;
          npc.vz = 0;
          npc.gait = 'freeze';
          if (npc.stateTimer <= 0) npc.aiState = 'wander';
          continue;
        }

        if (npc.aiState === 'flee') {
          npc.stateTimer -= dt;
          const awayAngle = Math.atan2(npc.x - this.playerX, npc.z - this.playerZ);
          npc.heading = lerpAngle(npc.heading, awayAngle, 9 * dt);
          npc.vx = Math.sin(npc.heading) * 10.6;
          npc.vz = Math.cos(npc.heading) * 10.6;
          npc.gait = 'gallop';
          if (npc.stateTimer <= 0) npc.aiState = 'wander';
          continue;
        }

        if (npc.aiState === 'alert_freeze') {
          npc.stateTimer -= dt;
          npc.vx = 0;
          npc.vz = 0;
          npc.gait = 'freeze';
          if (npc.stateTimer <= 0) npc.aiState = 'wander';
          continue;
        }

        const dPlayer = Math.hypot(npc.x - this.playerX, npc.z - this.playerZ);
        if (
          this.mode === 'wild_life' &&
          (ANIMALS[this.animalId].role === 'herbivore' || this.animalId === 'brown_bear') &&
          dPlayer < 30
        ) {
          const toPlayer = Math.atan2(this.playerX - npc.x, this.playerZ - npc.z);
          npc.heading = lerpAngle(npc.heading, toPlayer, 7 * dt);
          const chaseSpeed = dPlayer < 9 ? 11.6 : 9.6;
          npc.vx = Math.sin(npc.heading) * chaseSpeed;
          npc.vz = Math.cos(npc.heading) * chaseSpeed;
          npc.gait = dPlayer < 6.0 ? 'lunge' : 'gallop';
          if (dPlayer < 16 && this.ambientCallCooldown <= 0) {
            this.ambientCallCooldown = 2.6;
            this.pendingEvents.push({
              type: 'nearby_animal_call',
              speciesId: npc.species,
              distance: dPlayer,
              label: npc.name,
            });
          }
          if (dPlayer < 18) {
            activeWarning =
              this.animalId === 'markhor'
                ? `${npc.name} lunging! Press F to Horn Strike & Run!`
                : `${npc.name} charging! Leap (Space) or Counter (F)!`;
          }

          // Markhor vs Leopard lunging attack: if Markhor actively Horn-Charges or parries, Markhor horns leopard & runs!
          if (dPlayer < 3.45 && !this.keepExploring) {
            if (this.animalId === 'markhor' && this.secondaryActiveTimer > 0) {
              npc.aiState = 'flee';
              npc.stateTimer = 7.5;
              this.adrenalineTimer = 3.5;
              this.score += 180;
              this.awardRunXp(45);
              this.pushStatus('Markhor horned the attacking Leopard & sprinted away!', 2.6);
              this.pendingEvents.push({ type: 'horn_counter' });
            } else if (!this.isAirborne && this.predatorHitCooldown <= 0) {
              this.predatorHitCooldown = 1.1;
              this.applyPlayerHurt(
                18,
                this.animalId === 'markhor'
                  ? 'Leopard slashed you! Press F to Horn Counter & run!'
                  : `${npc.name} attacked!`,
              );
            }
          }
        } else if (
          this.mode === 'photo_safari' &&
          this.playerGait === 'gallop' &&
          dPlayer < 21
        ) {
          // Loud sprinting spooks shy Rare/Legendary wildlife into an exhilarating Action Sprint!
          npc.aiState = 'flee';
          npc.stateTimer = 2.4;
          const awayAngle = Math.atan2(npc.x - this.playerX, npc.z - this.playerZ);
          npc.heading = lerpAngle(npc.heading, awayAngle, 9 * dt);
          npc.vx = Math.sin(npc.heading) * 10.2;
          npc.vz = Math.cos(npc.heading) * 10.2;
          npc.gait = 'gallop';
        } else {
          npc.stateTimer -= dt;
          if (npc.stateTimer <= 0) {
            npc.heading += Math.cos(this.elapsedSec * 2 + npc.x) * 1.1;
            npc.stateTimer = 3.2;
          }
          npc.vx = Math.sin(npc.heading) * 3.6;
          npc.vz = Math.cos(npc.heading) * 3.6;
          npc.gait = 'walk';
        }
      }

      const nx = npc.x + npc.vx * dt;
      const nz = npc.z + npc.vz * dt;
      const isWaterCreature = npc.species === 'river_fish' || npc.species === 'indus_dolphin_npc';

      if (isWaterCreature) {
        if (isWaterAt(nx, nz, terrain)) {
          npc.x = nx;
          npc.z = nz;
        } else {
          npc.heading = normalizeAngle(npc.heading + Math.PI * 0.75);
        }
        npc.y = WATER_LEVEL - 0.15;
      } else {
        const dist = Math.hypot(nx, nz);
        if (dist < PLAYABLE_RADIUS - 6 && !isWaterAt(nx, nz, terrain)) {
          npc.x = nx;
          npc.z = nz;
        } else {
          npc.heading = normalizeAngle(npc.heading + Math.PI * 0.65);
        }
        const hopOffset = npc.aiState === 'flee' ? Math.abs(Math.sin(npc.hopPhase)) * 0.55 : 0;
        npc.y = getTerrainHeight(npc.x, npc.z, terrain) + hopOffset;
      }
    }

    if (this.ambientCallCooldown <= 0) {
      for (const npc of this.layout.npcs) {
        if (npc.kind !== 'prey' && npc.kind !== 'predator') continue;
        const d = Math.hypot(npc.x - this.playerX, npc.z - this.playerZ);
        if (d > 5 && d < 36) {
          this.ambientCallCooldown = 4.6;
          this.pendingEvents.push({
            type: 'nearby_animal_call',
            speciesId: npc.species,
            distance: d,
            label: npc.name,
          });
          break;
        }
      }
    }

    this.spottedPreyName = nearestSpottedPrey;
    this.dangerWarning = activeWarning;
  }

  private applySoftCollisionSeparation(_dt: number): void {
    const actors = this.layout.npcs;
    const terrain = this.layout.terrain;
    const playerRadius = this.getPlayerCollisionRadius();
    const isAquaticPlayer = this.animalId === 'indus_dolphin';

    const clampNpcPos = (npc: NpcActor, nx: number, nz: number) => {
      const r = Math.hypot(nx, nz);
      if (r > PLAYABLE_RADIUS - 4) {
        const s = (PLAYABLE_RADIUS - 4) / r;
        nx *= s;
        nz *= s;
      }
      const isWaterCreature =
        npc.species === 'river_fish' || npc.species === 'indus_dolphin_npc';
      if (isWaterCreature === isWaterAt(nx, nz, terrain)) {
        npc.x = nx;
        npc.z = nz;
      }
    };

    const clampPlayerPos = (nx: number, nz: number) => {
      const r = Math.hypot(nx, nz);
      if (r > PLAYABLE_RADIUS) {
        const s = PLAYABLE_RADIUS / r;
        nx *= s;
        nz *= s;
      }
      if (isAquaticPlayer && !isWaterAt(nx, nz, terrain)) return;
      this.playerX = nx;
      this.playerZ = nz;
    };

    // 3 iterative projection passes eliminate visual overlap between animals, Rangers & co-op peers
    for (let pass = 0; pass < 3; pass++) {
      // 1. NPC <-> NPC separation
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (a.aiState === 'arrested') continue;

        for (let j = i + 1; j < actors.length; j++) {
          const b = actors[j];
          if (b.aiState === 'arrested') continue;

          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const dist = Math.hypot(dx, dz);
          const minDist = a.radius + b.radius + 0.55;
          if (dist < minDist) {
            const nx = dist > 0.001 ? dx / dist : Math.cos(i * 1.7 + j);
            const nz = dist > 0.001 ? dz / dist : Math.sin(i * 1.7 + j);
            const overlap = minDist - dist;

            const aStatic = a.kind === 'trapped_animal';
            const bStatic = b.kind === 'trapped_animal';
            if (aStatic && bStatic) continue;

            if (aStatic) {
              clampNpcPos(b, b.x + nx * overlap, b.z + nz * overlap);
            } else if (bStatic) {
              clampNpcPos(a, a.x - nx * overlap, a.z - nz * overlap);
            } else {
              clampNpcPos(a, a.x - nx * overlap * 0.52, a.z - nz * overlap * 0.52);
              clampNpcPos(b, b.x + nx * overlap * 0.52, b.z + nz * overlap * 0.52);
            }
          }
        }
      }

      // 2. Player (Ranger Man or Animal) <-> NPC separation
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (a.aiState === 'arrested') continue;
        // Skip horizontal collision only if player leaped high cleanly over the animal
        if (this.isAirborne && Math.abs(this.playerY - a.y) > 1.75) continue;

        const dx = a.x - this.playerX;
        const dz = a.z - this.playerZ;
        const dist = Math.hypot(dx, dz);
        const minDist = a.radius + playerRadius + 0.35;

        if (dist < minDist) {
          const nx = dist > 0.001 ? dx / dist : Math.sin(this.playerHeading + 0.4);
          const nz = dist > 0.001 ? dz / dist : Math.cos(this.playerHeading + 0.4);
          const overlap = minDist - dist;

          if (a.kind === 'trapped_animal') {
            clampPlayerPos(this.playerX - nx * overlap, this.playerZ - nz * overlap);
          } else {
            clampPlayerPos(this.playerX - nx * overlap * 0.4, this.playerZ - nz * overlap * 0.4);
            clampNpcPos(a, a.x + nx * overlap * 0.62, a.z + nz * overlap * 0.62);
          }

          // Cancel inward velocity so neither walks straight through the other
          const relVn = this.playerVx * nx + this.playerVz * nz;
          if (relVn > 0) {
            this.playerVx -= relVn * nx * 0.85;
            this.playerVz -= relVn * nz * 0.85;
          }
        }
      }

      // 3. Player & NPC <-> Co-op Peers (so fellow Rangers & Wolf Packmates never overlap)
      for (const peer of this.coopPeers) {
        const peerR = peer.animalId === 'ranger' ? 1.15 : 1.4;
        const dx = this.playerX - peer.x;
        const dz = this.playerZ - peer.z;
        const dist = Math.hypot(dx, dz);
        const minPeer = playerRadius + peerR + 0.45;
        if (dist < minPeer && !this.isAirborne) {
          const nx = dist > 0.001 ? dx / dist : 1;
          const nz = dist > 0.001 ? dz / dist : 0;
          const overlap = minPeer - dist;
          clampPlayerPos(this.playerX + nx * overlap, this.playerZ + nz * overlap);
        }

        for (const a of actors) {
          if (a.aiState === 'arrested' || a.kind === 'trapped_animal') continue;
          const ndx = a.x - peer.x;
          const ndz = a.z - peer.z;
          const nd = Math.hypot(ndx, ndz);
          const nMin = a.radius + peerR + 0.35;
          if (nd < nMin) {
            const nx = nd > 0.001 ? ndx / nd : 0;
            const nz = nd > 0.001 ? ndz / nd : 1;
            clampNpcPos(a, a.x + nx * (nMin - nd), a.z + nz * (nMin - nd));
          }
        }
      }
    }

    // 4. Gentle tree-trunk obstacle separation so Ranger & animals walk around tree trunks
    if (!isAquaticPlayer && !this.isAirborne) {
      for (const tree of this.layout.treeSpots) {
        const trunkR = 0.62 * tree.scale + playerRadius * 0.55;
        const dx = this.playerX - tree.x;
        const dz = this.playerZ - tree.z;
        if (Math.abs(dx) > trunkR || Math.abs(dz) > trunkR) continue;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.001 && dist < trunkR) {
          const overlap = trunkR - dist;
          clampPlayerPos(this.playerX + (dx / dist) * overlap, this.playerZ + (dz / dist) * overlap);
        }
      }
    }

    // Re-clamp NPC vertical height after horizontal projection
    for (const npc of actors) {
      if (npc.aiState === 'arrested') continue;
      const isWaterCreature =
        npc.species === 'river_fish' || npc.species === 'indus_dolphin_npc';
      if (isWaterCreature) {
        npc.y = WATER_LEVEL - 0.15;
      } else {
        const hopOffset = npc.aiState === 'flee' ? Math.abs(Math.sin(npc.hopPhase)) * 0.55 : 0;
        npc.y = getTerrainHeight(npc.x, npc.z, terrain) + hopOffset;
      }
    }
  }

  private updateItemsAndInteractions(dt: number): void {
    for (const item of this.layout.items) {
      if (item.collected) continue;
      const d = Math.hypot(item.x - this.playerX, item.z - this.playerZ);

      if (item.kind === 'jaal') {
        const halfW = (item.width ?? 16) * 0.52;
        const inSpanX = Math.abs(this.playerX - item.x) < halfW;
        const inLineZ = Math.abs(this.playerZ - item.z) < 1.35;

        if (this.mode === 'ranger_patrol' && d < 5.5) {
          item.collected = true;
          this.jaalsCleared += 1;
          this.score += 220;
          this.awardRunXp(45);
          this.adjustConservation(5);
          this.pushStatus('Cleared illegal River Jaal net!', 2.6);
          this.pendingEvents.push({ type: 'jaal_cleared' });
          continue;
        }

        if (this.animalId === 'indus_dolphin' && inSpanX && inLineZ) {
          const jumpedAbove = this.playerY >= WATER_LEVEL + 0.45;
          const divedUnder = this.isDiving && this.playerY <= WATER_LEVEL - 0.85;

          if (jumpedAbove || divedUnder) {
            item.collected = true;
            this.jaalsCleared += 1;
            this.score += 240;
            this.awardRunXp(50);
            this.adjustConservation(4);
            this.pushStatus(
              jumpedAbove ? 'Leaped cleanly ABOVE the Jaal!' : 'Deep-dived cleanly UNDER the Jaal!',
              2.6,
            );
            this.pendingEvents.push({ type: 'jaal_cleared' });
          } else if (this.jaalHitCooldown <= 0) {
            this.jaalHitCooldown = 1.4;
            this.playerVz = -Math.sign(this.playerVz || 1) * 7.5;
            this.applyPlayerHurt(22, 'Caught in Jaal! Jump ABOVE (Space) or Deep Dive UNDER (F)!');
            this.pendingEvents.push({ type: 'jaal_hit' });
          }
        }
        continue;
      }

      if (item.kind === 'orb' && d < 2.8) {
        item.collected = true;
        this.orbsCollected += 1;
        this.score += 250;
        this.awardRunXp(65);
        this.health = Math.min(100, this.health + 15);
        this.energy = Math.min(100, this.energy + 25);
        this.pushStatus(`Spirit Orb collected! (${this.orbsCollected}/${this.orbsTarget})`, 2.6);
        this.pendingEvents.push({ type: 'orb_collected' });
      } else if (item.kind === 'food' && d < 2.4) {
        if (this.food < 98 || this.mode !== 'wild_life') {
          item.collected = true;
          this.food = Math.min(100, this.food + 28);
          this.health = Math.min(100, this.health + 6);
          this.score += 75;
          this.awardRunXp(24);
          this.pushStatus(`Foraged ${item.label}! +Food & Growth XP`, 2.2);
          this.pendingEvents.push({ type: 'eat_forage' });
        }
      } else if (item.kind === 'snare' && this.mode === 'ranger_patrol' && d < 2.8) {
        item.collected = true;
        this.snaresCleared += 1;
        this.score += 180;
        this.awardRunXp(35);
        this.adjustConservation(5);
        this.pushStatus(`Wire snare cleared! (${this.snaresCleared}/${this.snaresTotal})`, 2.4);
        this.pendingEvents.push({ type: 'snare_cleared' });
      } else if (item.kind === 'water_spot' && d < 3.6) {
        if (this.water < 96) {
          this.water = Math.min(100, this.water + 32 * dt);
          if (Math.random() < 0.04) {
            this.pendingEvents.push({ type: 'drink' });
          }
        }
      }
    }

    if (this.isSwimming && this.water < 100) {
      this.water = Math.min(100, this.water + 22 * dt);
    }
  }

  private updateSurvivalVitals(dt: number): void {
    const ambient = this.computeAmbientTempC();
    this.temperatureC += (ambient - this.temperatureC) * Math.min(1, 0.5 * dt);

    if (this.animalId === 'indus_dolphin' && this.isDiving) {
      this.oxygen = Math.max(0, this.oxygen - 16 * dt);
      if (this.oxygen <= 0) {
        this.isDiving = false;
        this.health = Math.max(0, this.health - 10 * dt);
        this.pushStatus('Out of breath — surfacing!', 2.0);
      }
    } else {
      this.oxygen = Math.min(100, this.oxygen + 35 * dt);
    }

    if (this.playerGait === 'gallop') {
      this.energy = Math.max(0, this.energy - 8.5 * dt);
    } else if (this.playerGait === 'swim' && this.animalId !== 'indus_dolphin') {
      this.energy = Math.max(0, this.energy - 3.2 * dt);
    } else {
      this.energy = Math.min(100, this.energy + 8.0 * dt);
    }

    if (this.mode !== 'wild_life' || this.keepExploring) return;

    const activityMult = this.playerGait === 'gallop' ? 1.5 : this.playerGait === 'idle' ? 0.55 : 1.0;
    this.food = Math.max(0, this.food - 1.1 * activityMult * dt);
    this.water = Math.max(0, this.water - 1.3 * activityMult * dt);

    const cfg = ANIMALS[this.animalId];
    const tempCold = Math.max(0, cfg.idealTempMin - this.temperatureC);
    const tempHot = Math.max(0, this.temperatureC - cfg.idealTempMax);
    const tempStress = tempCold + tempHot;

    if (this.food <= 0 || this.water <= 0 || tempStress > 10) {
      this.health = Math.max(0, this.health - 4.5 * dt);
    } else if (this.food > 55 && this.water > 55 && this.playerHurtTimer <= 0) {
      this.health = Math.min(100, this.health + 1.2 * dt);
    }
  }

  private updateRangerOpticsAndDartLock(cameraYaw: number): void {
    if (this.mode !== 'ranger_patrol') {
      this.binocularsTarget = null;
      this.dartTargetName = null;
      this.dartTargetDistance = null;
      return;
    }

    const fwdX = Math.sin(cameraYaw);
    const fwdZ = Math.cos(cameraYaw);

    // Dart rifle target lock preview
    let bestPoacher: { name: string; dist: number } | null = null;
    let bestPoacherDist = 38;
    for (const npc of this.layout.npcs) {
      if (npc.kind !== 'poacher' || npc.aiState === 'sedated' || npc.aiState === 'arrested') continue;
      const dx = npc.x - this.playerX;
      const dz = npc.z - this.playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist < bestPoacherDist) {
        const angToNpc = Math.atan2(dx, dz);
        if (Math.abs(normalizeAngle(angToNpc - this.playerHeading)) < 0.72) {
          bestPoacherDist = dist;
          bestPoacher = { name: npc.name, dist: Math.round(dist) };
        }
      }
    }
    this.dartTargetName = bestPoacher?.name ?? null;
    this.dartTargetDistance = bestPoacher?.dist ?? null;

    if (this.equippedTool !== 'binoculars') {
      this.binocularsTarget = null;
      return;
    }

    let bestOptic: BinocularsTargetState | null = null;
    let bestRank = Infinity;
    const minDot = this.binocularsZoomed ? 0.92 : 0.86;
    const maxDist = this.binocularsZoomed ? 115 : 75;

    for (const npc of this.layout.npcs) {
      if (npc.aiState === 'arrested' || npc.aiState === 'rescued') continue;
      const dx = npc.x - this.playerX;
      const dz = npc.z - this.playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.5 || dist > maxDist) continue;
      const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ;
      if (dot < minDot) continue;

      const rank = dist * (1.15 - dot);
      if (rank < bestRank) {
        bestRank = rank;
        const category: BinocularsTargetState['category'] =
          npc.kind === 'poacher'
            ? 'Poacher'
            : npc.kind === 'trapped_animal'
              ? 'Trapped Wildlife'
              : 'Wild Species';
        const statusText =
          npc.kind === 'poacher'
            ? npc.aiState === 'sedated'
              ? 'Sedated — Approach to Arrest'
              : 'Active Poacher — Needs Dart'
            : npc.kind === 'trapped_animal'
              ? 'Caged — Approach to Rescue'
              : `${FIELD_GUIDE_SPECIES[npc.species]?.status ?? 'Wild'} · ${npc.gait}`;
        bestOptic = {
          actorId: npc.id,
          name: npc.name,
          category,
          distance: Math.round(dist),
          statusText,
          alreadyScouted: this.scoutedActorIds.has(npc.id),
        };
      }
    }

    for (const item of this.layout.items) {
      if (item.collected || item.kind !== 'snare') continue;
      const dx = item.x - this.playerX;
      const dz = item.z - this.playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.5 || dist > maxDist) continue;
      const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ;
      if (dot < minDot) continue;
      const rank = dist * (1.15 - dot);
      if (rank < bestRank) {
        bestRank = rank;
        bestOptic = {
          actorId: item.id,
          name: item.label,
          category: 'Wire Snare',
          distance: Math.round(dist),
          statusText: 'Illegal Trap — Approach to Disarm',
          alreadyScouted: this.scoutedActorIds.has(item.id),
        };
      }
    }

    this.binocularsTarget = bestOptic;
  }

  private getPhotoMetaForNpc(npc: NpcActor, dot: number, dist: number) {
    const isAction =
      npc.gait === 'gallop' ||
      npc.gait === 'lunge' ||
      npc.gait === 'jump' ||
      npc.gait === 'swim';
    const posedByCall = npc.aiState === 'alert_freeze';
    const actionTag =
      npc.gait === 'lunge'
        ? 'HUNTING POSE!'
        : npc.gait === 'jump'
          ? 'AIRBORNE LEAP!'
          : npc.gait === 'gallop'
            ? 'SPRINT ACTION!'
            : npc.gait === 'swim'
              ? 'RIVER SWIM!'
              : posedByCall
                ? 'PORTRAIT POSE!'
                : undefined;

    const telephotoClose = this.telephotoZoomed && dist <= 36 && dot >= 0.935;
    const qualityGrade: 'S' | 'A' | 'B' =
      (dist <= 22 && dot >= 0.94) || telephotoClose || (isAction && dist <= 30 && dot >= 0.9)
        ? 'S'
        : dist <= 35 && dot >= 0.895
          ? 'A'
          : 'B';

    const isSpeciesOfDay = npc.species === this.speciesOfDayId;
    const isEvidence = npc.kind === 'poacher';
    const meta = FIELD_GUIDE_SPECIES[npc.species];
    const rarity: SpeciesRarity = isEvidence ? 'uncommon' : meta.rarity;
    const rarityInfo = SPECIES_RARITY_META[rarity];

    const baseRarityPts = isEvidence ? 180 : meta.basePhotoPoints;
    const qualityMult = qualityGrade === 'S' ? 1.5 : qualityGrade === 'A' ? 1.2 : 1.0;
    const actionBonus = isAction ? 120 : 0;
    const callPoseBonus = posedByCall ? 70 : 0;
    const telephotoBonus = this.telephotoZoomed && dist >= 20 ? 50 : 0;
    const dayMult = isSpeciesOfDay && !isEvidence ? 2 : 1;

    const projectedPoints =
      Math.round(baseRarityPts * qualityMult + actionBonus + callPoseBonus + telephotoBonus) *
      dayMult;

    const parts: string[] = [`${rarityInfo.label} ${baseRarityPts}`, `${qualityGrade} ×${qualityMult}`];
    if (actionBonus > 0) parts.push(`Action +${actionBonus}`);
    else if (callPoseBonus > 0) parts.push(`Pose +${callPoseBonus}`);
    if (telephotoBonus > 0) parts.push(`Tele +${telephotoBonus}`);
    if (dayMult > 1) parts.push('Daily 2×');

    return {
      qualityGrade,
      actionTag,
      isAction,
      posedByCall,
      isSpeciesOfDay,
      isEvidence,
      rarity,
      rarityLabel: rarityInfo.label,
      projectedPoints,
      scoreBreakdownText: parts.join(' · '),
      speciesName: isEvidence ? `${npc.name} (Evidence)` : meta.name,
      scientificName: isEvidence ? 'Anti-Poaching Case File' : meta.scientificName,
    };
  }

  private findBestPhotoCandidate(
    cameraYaw: number,
    isManualSnap: boolean,
  ): { npc: NpcActor; dot: number; dist: number } | null {
    const fwdX = Math.sin(cameraYaw);
    const fwdZ = Math.cos(cameraYaw);
    const zoomed = this.telephotoZoomed || (this.mode === 'ranger_patrol' && this.equippedTool === 'camera');
    const maxDist = zoomed ? 58 : isManualSnap ? 44 : 42;
    const minDot = isManualSnap ? 0.85 : 0.885;

    let bestNpc: NpcActor | null = null;
    let bestDot = 0;
    let bestDist = 0;
    let bestRank = Infinity;

    for (const npc of this.layout.npcs) {
      if (npc.kind === 'shikari') continue;
      if (this.mode === 'photo_safari' && (npc.kind === 'poacher' || npc.kind === 'trapped_animal')) {
        continue;
      }
      if (npc.aiState === 'arrested' || npc.aiState === 'rescued') continue;

      const dx = npc.x - this.playerX;
      const dz = npc.z - this.playerZ;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.0 || dist > maxDist) continue;

      const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ;
      if (dot > minDot) {
        const alreadyKnown =
          npc.kind === 'poacher'
            ? this.evidenceActorIds.has(npc.id)
            : this.photographedSpecies.has(npc.species);
        const rarityBonusRank =
          FIELD_GUIDE_SPECIES[npc.species].rarity === 'legendary'
            ? -8
            : FIELD_GUIDE_SPECIES[npc.species].rarity === 'rare'
              ? -4
              : 0;
        const rank = dist + (alreadyKnown ? 16 : 0) + rarityBonusRank;
        if (rank < bestRank) {
          bestRank = rank;
          bestNpc = npc;
          bestDot = dot;
          bestDist = dist;
        }
      }
    }

    return bestNpc ? { npc: bestNpc, dot: bestDot, dist: bestDist } : null;
  }

  private recordPhotoCapture(
    npc: NpcActor,
    dot: number,
    dist: number,
    isManual: boolean,
  ): void {
    const info = this.getPhotoMetaForNpc(npc, dot, dist);
    this.lastPhotoGrade = info.qualityGrade;

    if (info.isEvidence) {
      if (!this.evidenceActorIds.has(npc.id)) {
        this.evidenceActorIds.add(npc.id);
        this.evidencePhotosTaken += 1;
        this.score += 180;
        this.awardRunXp(35);
        this.adjustConservation(4, { photosLogged: 1 });
        this.pushStatus(
          `Evidence Logged: ${npc.name}! (+180 pts · +4% Conservation)`,
          3.0,
        );
      } else {
        this.score += 40;
        this.pushStatus(`Extra evidence shot of ${npc.name} saved to Album.`, 2.0);
      }
      this.pendingEvents.push({
        type: 'photo_captured',
        label: info.speciesName,
        speciesId: npc.species,
        rarity: info.rarity,
        qualityGrade: info.qualityGrade,
        photoScore: 180,
        actionTag: info.actionTag,
      });
      return;
    }

    const wasNewSpecies = !this.photographedSpecies.has(npc.species);
    npc.photographed = true;
    this.photographedSpecies.add(npc.species);
    this.photosTaken = this.photographedSpecies.size;

    const isRareOrLeg = info.rarity === 'rare' || info.rarity === 'legendary';
    if (info.qualityGrade === 'S') this.sRankCount += 1;
    if (info.isAction) this.actionShotsCount += 1;

    const prevBest = this.bestScoreBySpecies.get(npc.species) ?? 0;
    let earned = 0;

    if (wasNewSpecies) {
      this.photoCombo += 1;
      const comboBonus = (this.photoCombo - 1) * 85;
      earned = info.projectedPoints + comboBonus;
      this.bestScoreBySpecies.set(npc.species, info.projectedPoints);
      if (isRareOrLeg) this.rareShotsCount += 1;
      const baseXp =
        (info.rarity === 'legendary' ? 115 : info.rarity === 'rare' ? 95 : 70) *
        (info.qualityGrade === 'S' ? 1.3 : 1);
      this.awardRunXp(Math.round(baseXp * (info.isSpeciesOfDay ? 1.5 : 1)));
      this.adjustConservation(isRareOrLeg || info.isSpeciesOfDay ? 10 : 6, {
        photosLogged: 1,
      });
    } else if (isManual) {
      const upgradeDiff = Math.max(0, info.projectedPoints - prevBest);
      const actionOrGradeBonus = info.qualityGrade === 'S' || info.isAction ? 95 : 65;
      earned = upgradeDiff + actionOrGradeBonus;
      if (info.projectedPoints > prevBest) {
        this.bestScoreBySpecies.set(npc.species, info.projectedPoints);
      }
      this.awardRunXp(upgradeDiff > 0 ? 35 : 20);
      if (info.qualityGrade === 'S') this.adjustConservation(2, { photosLogged: 1 });
    }

    if (earned > 0) {
      this.score += earned;
      this.photoScoreTotal += earned;
      if (earned > this.bestPhotoScore) {
        this.bestPhotoScore = earned;
        this.bestPhotoLabel = `${info.speciesName} (${info.rarityLabel} · ${info.qualityGrade}-Rank)`;
      }
    }

    // Track Photo Safari Field Challenge progress & award completion bonus
    if (this.mode === 'photo_safari') {
      if (isRareOrLeg && (info.qualityGrade === 'A' || info.qualityGrade === 'S')) {
        this.rareQualityPhotosCount += 1;
      }
      if (info.isAction || info.qualityGrade === 'S') {
        this.motionOrSRankCount += 1;
      }
      if (
        (this.telephotoZoomed || info.posedByCall) &&
        info.qualityGrade === 'S'
      ) {
        this.telephotoCallPortraitCount += 1;
      }

      const chal = this.getSafariChallengeMeta(this.round);
      if (!this.safariChallengeDone && chal.done) {
        this.safariChallengeDone = true;
        this.score += chal.bonus;
        this.photoScoreTotal += chal.bonus;
        this.awardRunXp(75);
        this.adjustConservation(6);
        this.pushStatus(
          `Challenge Complete: ${chal.title}! +${chal.bonus} pts & +6% Conservation!`,
          3.4,
        );
      } else if (wasNewSpecies || earned > 0) {
        const tagNote = info.isSpeciesOfDay
          ? ' · 2× SPECIES OF THE DAY!'
          : info.actionTag
            ? ` · ${info.actionTag}`
            : '';
        this.pushStatus(
          `${info.rarityLabel} ${info.qualityGrade}-Rank ${info.speciesName}! +${earned} pts${tagNote}`,
          3.2,
        );
      }
    } else if (wasNewSpecies || earned > 0) {
      this.pushStatus(
        `${info.rarityLabel} ${info.qualityGrade}-Rank ${info.speciesName}! +${earned} pts`,
        2.8,
      );
    }

    this.pendingEvents.push({
      type: 'photo_captured',
      label: info.speciesName,
      speciesId: npc.species,
      rarity: info.rarity,
      qualityGrade: info.qualityGrade,
      photoScore: earned > 0 ? earned : info.projectedPoints,
      actionTag: info.actionTag,
    });
  }

  private updatePhotoSafariViewfinder(dt: number, input: SimInput): void {
    const cameraEnabled =
      this.mode === 'photo_safari' ||
      (this.mode === 'ranger_patrol' && this.equippedTool === 'camera');
    if (!cameraEnabled) {
      this.photoTarget = null;
      return;
    }

    const candidate = this.findBestPhotoCandidate(input.cameraYaw, false);
    if (!candidate) {
      this.activePhotoTargetId = null;
      this.photoSteadySec = 0;
      this.photoTarget = null;
      return;
    }

    const { npc, dot, dist } = candidate;
    if (this.activePhotoTargetId !== npc.id) {
      this.activePhotoTargetId = npc.id;
      this.photoSteadySec = 0;
    }

    const steadyFactor = this.playerSpeed < 1.5 ? 1.2 : this.playerSpeed < 7 ? 0.85 : 0.35;
    const already =
      npc.kind === 'poacher'
        ? this.evidenceActorIds.has(npc.id)
        : this.photographedSpecies.has(npc.species);

    if (!already) {
      this.photoSteadySec += dt * steadyFactor;
      if (this.photoSteadySec >= 1.0) {
        this.photoSteadySec = 0;
        this.recordPhotoCapture(npc, dot, dist, false);
      }
    }

    const info = this.getPhotoMetaForNpc(npc, dot, dist);
    this.photoTarget = {
      actorId: npc.id,
      speciesId: npc.species,
      speciesName: info.speciesName,
      scientificName: info.scientificName,
      rarity: info.rarity,
      rarityLabel: info.rarityLabel,
      distance: Math.round(dist),
      steadyProgress: already ? 1 : Math.min(1, this.photoSteadySec / 1.0),
      alreadyPhotographed: already,
      qualityGrade: info.qualityGrade,
      projectedPoints: info.projectedPoints,
      scoreBreakdownText: info.scoreBreakdownText,
      actionTag: info.actionTag,
      posedByCall: info.posedByCall,
      isSpeciesOfDay: info.isSpeciesOfDay,
      isEvidence: info.isEvidence,
    };
  }

  private findClosest<T extends { x: number; z: number }>(list: T[]): { item: T; dist: number } | null {
    let best: T | null = null;
    let bestDist = Infinity;
    for (const entry of list) {
      const d = Math.hypot(entry.x - this.playerX, entry.z - this.playerZ);
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }
    return best ? { item: best, dist: bestDist } : null;
  }

  private updateGuideArrow(): void {
    let targetX = 0;
    let targetZ = 0;
    let label = 'Explore';

    if (this.mode === 'wild_life') {
      if (this.water < 35) {
        const w = this.findClosest(this.layout.items.filter((i) => i.kind === 'water_spot'));
        if (w) {
          targetX = w.item.x;
          targetZ = w.item.z;
          label = 'Water Source';
        }
      } else if (this.food < 35) {
        const foods = this.layout.items.filter((i) => i.kind === 'food' && !i.collected);
        const f = this.findClosest(foods);
        if (f) {
          targetX = f.item.x;
          targetZ = f.item.z;
          label = 'Food / Forage';
        }
      } else {
        const orbs = this.layout.items.filter((i) => i.kind === 'orb' && !i.collected);
        const o = this.findClosest(orbs);
        if (o) {
          targetX = o.item.x;
          targetZ = o.item.z;
          label = 'Spirit Orb';
        }
      }
    } else if (this.mode === 'ranger_patrol') {
      const activePoachers = this.layout.npcs.filter(
        (n) => n.kind === 'poacher' && n.aiState !== 'arrested',
      );
      const trapped = this.layout.npcs.filter(
        (n) => n.kind === 'trapped_animal' && n.aiState !== 'rescued',
      );
      const snares = this.layout.items.filter((i) => i.kind === 'snare' && !i.collected);

      const candidates: Array<{ x: number; z: number; label: string }> = [
        ...activePoachers.map((p) => ({
          x: p.x,
          z: p.z,
          label: p.aiState === 'sedated' ? 'Arrest Poacher' : 'Poacher',
        })),
        ...trapped.map((t) => ({ x: t.x, z: t.z, label: 'Trapped Animal' })),
        ...snares.map((s) => ({ x: s.x, z: s.z, label: 'Wire Snare' })),
      ];
      const closest = this.findClosest(candidates);
      if (closest) {
        targetX = closest.item.x;
        targetZ = closest.item.z;
        label = closest.item.label;
      }
    } else if (this.mode === 'photo_safari') {
      const unphotographed = this.layout.npcs.filter(
        (n) =>
          n.kind !== 'poacher' &&
          n.kind !== 'shikari' &&
          n.kind !== 'trapped_animal' &&
          !this.photographedSpecies.has(n.species),
      );
      const closest = this.findClosest(unphotographed);
      if (closest) {
        targetX = closest.item.x;
        targetZ = closest.item.z;
        label = closest.item.name;
      }
    }

    const dx = targetX - this.playerX;
    const dz = targetZ - this.playerZ;
    this.guideDistance = Math.round(Math.hypot(dx, dz));
    this.guideWorldAngle = Math.atan2(dx, dz);
    this.guideTargetLabel = label;
  }

  private checkVictoryOrDefeat(): void {
    if (this.health <= 0 && this.mode === 'wild_life' && !this.keepExploring) {
      this.phase = 'gameover';
      this.adjustConservation(-10, { wildlifeHarm: 1 });
      this.failReason =
        this.water <= 0
          ? 'Dehydration in the wilderness'
          : this.food <= 0
            ? 'Starvation in the wilderness'
            : this.animalId === 'indus_dolphin'
              ? 'Entangled in river fishing nets (Jaal) or low oxygen'
              : 'Succumbed to predators, Shikari gunfire, or harsh weather';
      this.pendingEvents.push({ type: 'game_over' });
      return;
    }

    if (this.keepExploring) return;

    const mission = this.getRoundMissionMeta(this.round);
    let won = false;
    if (this.mode === 'wild_life' && this.orbsCollected >= this.orbsTarget && mission.done) {
      won = true;
    } else if (
      this.mode === 'ranger_patrol' &&
      this.poachersArrested >= this.poachersTotal &&
      this.animalsRescued >= this.animalsTrappedTotal &&
      this.snaresCleared >= this.snaresTotal
    ) {
      won = true;
    } else if (this.mode === 'photo_safari' && this.photosTaken >= this.photosTarget) {
      won = true;
    } else if (this.elapsedSec >= this.roundDurationSec) {
      // Timed 1-2 minute round completion: conclude cleanly so players progress & receive new missions!
      won = true;
      this.pushStatus(`Round ${this.round} Expedition Time Complete!`, 3.0);
    }

    if (won) {
      this.phase = 'victory';
      const timeBonus = Math.max(0, Math.round((this.roundDurationSec - this.elapsedSec) * 4));
      this.score += 400 + timeBonus;
      this.awardRunXp(85);
      this.adjustConservation(5);
      this.pendingEvents.push({ type: 'victory' });
    }
  }

  public getSnapshot(): SimSnapshot {
    const mission = this.getRoundMissionMeta(this.round);
    const nextMission = this.getRoundMissionMeta(this.round + 1);
    const safariChallenge = this.getSafariChallengeMeta(this.round);
    return {
      phase: this.phase,
      keepExploring: this.keepExploring,
      round: this.round,
      mode: this.mode,
      animalId: this.animalId,
      biomeId: this.biomeId,
      season: this.season,
      weather: this.weather,
      seed: this.seed,
      elapsedSec: this.elapsedSec,
      roundDurationSec: this.roundDurationSec,
      roundTimeLeftSec: Math.max(0, Math.ceil(this.roundDurationSec - this.elapsedSec)),
      roundMissionTitle: mission.title,
      roundMissionText: mission.text,
      roundMissionProgress: mission.progress,
      roundMissionDone: mission.done,
      nextMissionTitle: nextMission.title,
      nextMissionText: nextMission.text,
      score: Math.round(this.score),
      xpEarned: Math.round(this.xpEarned),
      growthStage: this.growthStage,
      growthProgress: this.growthProgress,
      conservationScore: this.conservationScore,
      speciesCount: this.speciesCount,
      migrationLabel: this.getMigrationLabel(),
      isDailyExpedition: this.isDailyExpedition,
      playerX: this.playerX,
      playerY: this.playerY,
      playerZ: this.playerZ,
      distanceToWater: Math.round(this.getDistanceToWater()),
      elevation: Number(this.playerY.toFixed(1)),
      playerHeading: this.playerHeading,
      playerSpeed: this.playerSpeed,
      playerGait: this.playerGait,
      isSwimming: this.isSwimming,
      isAirborne: this.isAirborne,
      isDiving: this.isDiving,
      playerHurtFlash: this.playerHurtTimer > 0,
      damageTaken: Math.round(this.damageTaken),
      adrenalineTimer: Number(this.adrenalineTimer.toFixed(1)),
      health: Math.round(this.health),
      food: Math.round(this.food),
      water: Math.round(this.water),
      energy: Math.round(this.energy),
      oxygen: Math.round(this.oxygen),
      temperatureC: Math.round(this.temperatureC),
      primaryCooldown: Number(this.primaryCooldown.toFixed(1)),
      secondaryCooldown: Number(this.secondaryCooldown.toFixed(1)),
      secondaryActive: this.secondaryActiveTimer > 0,
      spottedPreyName: this.spottedPreyName,
      dangerWarning: this.dangerWarning,
      orbsCollected: this.orbsCollected,
      orbsTarget: this.orbsTarget,
      preyCaught: this.preyCaught,
      jaalsCleared: this.jaalsCleared,
      poachersArrested: this.poachersArrested,
      poachersTotal: this.poachersTotal,
      animalsRescued: this.animalsRescued,
      animalsTrappedTotal: this.animalsTrappedTotal,
      snaresCleared: this.snaresCleared,
      snaresTotal: this.snaresTotal,
      photosTaken: this.photosTaken,
      photosTarget: this.photosTarget,
      photographedSpecies: Array.from(this.photographedSpecies),
      photoTarget: this.photoTarget,
      equippedTool: this.equippedTool,
      binocularsZoomed: this.binocularsZoomed,
      telephotoZoomed: this.telephotoZoomed,
      binocularsTarget: this.binocularsTarget,
      scoutedCount: this.scoutedActorIds.size,
      evidencePhotosTaken: this.evidencePhotosTaken,
      photoCombo: this.photoCombo,
      lastPhotoGrade: this.lastPhotoGrade,
      photoScoreTotal: Math.round(this.photoScoreTotal),
      bestPhotoScore: Math.round(this.bestPhotoScore),
      bestPhotoLabel: this.bestPhotoLabel,
      sRankCount: this.sRankCount,
      actionShotsCount: this.actionShotsCount,
      rareShotsCount: this.rareShotsCount,
      safariChallengeTitle: safariChallenge.title,
      safariChallengeText: safariChallenge.text,
      safariChallengeProgress: safariChallenge.progress,
      safariChallengeDone: safariChallenge.done,
      safariChallengeBonus: safariChallenge.bonus,
      dartTargetName: this.dartTargetName,
      dartTargetDistance: this.dartTargetDistance,
      guideTargetLabel: this.guideTargetLabel,
      guideWorldAngle: this.guideWorldAngle,
      guideDistance: this.guideDistance,
      statusMessage: this.statusMessage,
      failReason: this.failReason,
    };
  }
}
