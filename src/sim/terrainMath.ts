import { BIOMES } from '../data/biomes';
import { AnimalId, BiomeId, GameMode, NpcActor, NpcSpeciesId, WorldItem } from '../types/game';
import { createRng, fbm2D, randRange } from './prng';

// Vastly expanded 5 Pakistani biomes (~2.6x playable area vs previous 235m)
export const WORLD_RADIUS = 440;
export const PLAYABLE_RADIUS = 380;
export const WATER_LEVEL = -0.35;

export interface TerrainConfig {
  seed: number;
  biomeId: BiomeId;
  riverPhaseA: number;
  riverPhaseB: number;
  riverWidth: number;
  oasisX: number;
  oasisZ: number;
  oasisRadius: number;
}

export interface WorldLayout {
  terrain: TerrainConfig;
  playerStart: { x: number; z: number; heading: number };
  npcs: NpcActor[];
  items: WorldItem[];
  treeSpots: Array<{ x: number; z: number; scale: number; rot: number }>;
  rockSpots: Array<{ x: number; z: number; scale: number; rot: number }>;
}

export function createTerrainConfig(seed: number, biomeId: BiomeId): TerrainConfig {
  const rng = createRng(seed ^ 0x9e3779b9);
  const isIndus = biomeId === 'indus_river';
  return {
    seed,
    biomeId,
    riverPhaseA: randRange(rng, 0, Math.PI * 2),
    riverPhaseB: randRange(rng, 0, Math.PI * 2),
    riverWidth: isIndus ? randRange(rng, 25, 33) : randRange(rng, 11.5, 16.5),
    oasisX: randRange(rng, -135, 135),
    oasisZ: randRange(rng, -135, 135),
    oasisRadius: randRange(rng, 22, 31),
  };
}

export function getRiverCenterX(z: number, cfg: TerrainConfig): number {
  return (
    Math.sin(z * 0.012 + cfg.riverPhaseA) * 68 +
    Math.cos(z * 0.0065 + cfg.riverPhaseB) * 38
  );
}

export function getTerrainHeight(x: number, z: number, cfg: TerrainConfig): number {
  const biome = BIOMES[cfg.biomeId];
  const distFromCenter = Math.hypot(x, z);

  let h =
    fbm2D(x * 0.0085, z * 0.0085, cfg.seed, 4) * (biome.terrainAmplitude * 1.15) +
    fbm2D(x * 0.025, z * 0.025, cfg.seed + 313, 3) * (biome.terrainAmplitude * 0.32);

  if (cfg.biomeId === 'thar_desert') {
    const dune = Math.sin(x * 0.032 + Math.cos(z * 0.021) * 1.8) * 2.8;
    h = h * 0.72 + dune + 1.4;
  } else if (cfg.biomeId === 'indus_river') {
    h = h * 0.52 + 0.95;
  } else if (cfg.biomeId === 'northern_mountains') {
    const valleyBowl = Math.max(0, (distFromCenter - 175) / 260);
    h = h * 0.85 + 1.3 + valleyBowl * valleyBowl * 18.0;
  } else if (cfg.biomeId === 'deosai_plateau') {
    h = h * 0.72 + 1.4;
  } else {
    h = h * 0.92 + 1.5;
  }

  if (distFromCenter > PLAYABLE_RADIUS) {
    const rim = (distFromCenter - PLAYABLE_RADIUS) / (WORLD_RADIUS - PLAYABLE_RADIUS);
    h += rim * rim * 26.0;
  }

  if (biome.hasRiver) {
    const rx = getRiverCenterX(z, cfg);
    const dRiver = Math.abs(x - rx);
    if (dRiver < cfg.riverWidth * 1.55) {
      const t = 1 - dRiver / (cfg.riverWidth * 1.55);
      const smoothT = t * t * (3 - 2 * t);
      const bedDepth = cfg.biomeId === 'indus_river' ? -3.6 : -2.5;
      h = h * (1 - smoothT) + bedDepth * smoothT;
    }
  } else if (biome.hasOasis) {
    const dOasis = Math.hypot(x - cfg.oasisX, z - cfg.oasisZ);
    if (dOasis < cfg.oasisRadius * 1.6) {
      const t = 1 - dOasis / (cfg.oasisRadius * 1.6);
      const smoothT = t * t * (3 - 2 * t);
      h = h * (1 - smoothT) + -2.5 * smoothT;
    }
  }

  return h;
}

export function isWaterAt(x: number, z: number, cfg: TerrainConfig): boolean {
  return getTerrainHeight(x, z, cfg) < WATER_LEVEL;
}

export function getWaterDepthAt(x: number, z: number, cfg: TerrainConfig): number {
  const h = getTerrainHeight(x, z, cfg);
  return Math.max(0, WATER_LEVEL - h);
}

export function getGroundSlope(x: number, z: number, cfg: TerrainConfig): number {
  const eps = 1.0;
  const hx = getTerrainHeight(x + eps, z, cfg) - getTerrainHeight(x - eps, z, cfg);
  const hz = getTerrainHeight(x, z + eps, cfg) - getTerrainHeight(x, z - eps, cfg);
  return Math.hypot(hx, hz) / (2 * eps);
}

function findValidSpot(
  rng: () => number,
  cfg: TerrainConfig,
  requireWater: boolean,
  avoidX = 0,
  avoidZ = 0,
  minDistFromAvoid = 18,
  maxRadius = PLAYABLE_RADIUS - 32,
  extraAvoidPoints: Array<{ x: number; z: number }> = [],
): { x: number; z: number } {
  for (let attempt = 0; attempt < 180; attempt++) {
    let x: number;
    let z: number;

    if (requireWater) {
      const biome = BIOMES[cfg.biomeId];
      if (biome.hasRiver) {
        z = randRange(rng, -maxRadius * 0.85, maxRadius * 0.85);
        x = getRiverCenterX(z, cfg) + randRange(rng, -cfg.riverWidth * 0.35, cfg.riverWidth * 0.35);
      } else {
        const ang = randRange(rng, 0, Math.PI * 2);
        const rad = randRange(rng, 0, cfg.oasisRadius * 0.65);
        x = cfg.oasisX + Math.cos(ang) * rad;
        z = cfg.oasisZ + Math.sin(ang) * rad;
      }
    } else {
      const ang = randRange(rng, 0, Math.PI * 2);
      const rad = Math.sqrt(rng()) * (maxRadius - 12) + 12;
      x = Math.cos(ang) * rad;
      z = Math.sin(ang) * rad;
    }

    const inWater = isWaterAt(x, z, cfg);
    if (inWater !== requireWater) continue;
    if (Math.hypot(x - avoidX, z - avoidZ) < minDistFromAvoid) continue;
    if (extraAvoidPoints.some((p) => Math.hypot(x - p.x, z - p.z) < 28)) continue;
    if (!requireWater && getGroundSlope(x, z, cfg) > 1.25) continue;

    return { x, z };
  }

  if (requireWater) {
    const biome = BIOMES[cfg.biomeId];
    if (biome.hasRiver) {
      const z = randRange(rng, -190, 190);
      return { x: getRiverCenterX(z, cfg), z };
    }
    return { x: cfg.oasisX, z: cfg.oasisZ };
  }
  const fallbackAng = randRange(rng, 0, Math.PI * 2);
  const fallbackRad = randRange(rng, 45, maxRadius * 0.8);
  return { x: Math.cos(fallbackAng) * fallbackRad, z: Math.sin(fallbackAng) * fallbackRad };
}

function findSpotInSector(
  rng: () => number,
  cfg: TerrainConfig,
  requireWater: boolean,
  centerX: number,
  centerZ: number,
  minDist: number,
  maxDist: number,
): { x: number; z: number } {
  const biome = BIOMES[cfg.biomeId];
  for (let attempt = 0; attempt < 140; attempt++) {
    let x: number;
    let z: number;
    if (requireWater && biome.hasRiver) {
      z = Math.max(
        -PLAYABLE_RADIUS + 20,
        Math.min(PLAYABLE_RADIUS - 20, centerZ + randRange(rng, -maxDist, maxDist)),
      );
      x = getRiverCenterX(z, cfg) + randRange(rng, -cfg.riverWidth * 0.35, cfg.riverWidth * 0.35);
    } else if (requireWater && biome.hasOasis) {
      const ang = randRange(rng, 0, Math.PI * 2);
      const rad = randRange(rng, 2, cfg.oasisRadius * 0.72);
      x = cfg.oasisX + Math.cos(ang) * rad;
      z = cfg.oasisZ + Math.sin(ang) * rad;
    } else {
      const ang = randRange(rng, 0, Math.PI * 2);
      const rad = randRange(rng, minDist, maxDist);
      x = centerX + Math.cos(ang) * rad;
      z = centerZ + Math.sin(ang) * rad;
    }

    if (Math.hypot(x, z) > PLAYABLE_RADIUS - 16) continue;
    if (isWaterAt(x, z, cfg) !== requireWater) continue;
    const d = Math.hypot(x - centerX, z - centerZ);
    if (d < minDist) continue;
    if (!requireWater && getGroundSlope(x, z, cfg) > 1.25) continue;
    return { x, z };
  }
  return findValidSpot(rng, cfg, requireWater, centerX, centerZ, minDist);
}

function getNpcRadius(species: NpcSpeciesId, kind: NpcActor['kind']): number {
  if (kind === 'trapped_animal') return 1.85;
  if (kind === 'poacher' || kind === 'shikari') return 1.15;
  switch (species) {
    case 'marmot':
      return 0.85;
    case 'river_fish':
      return 0.95;
    case 'gazelle':
      return 1.25;
    case 'ibex':
      return 1.3;
    case 'markhor_npc':
    case 'snow_leopard_npc':
    case 'indus_dolphin_npc':
      return 1.45;
    case 'brown_bear_npc':
      return 1.7;
  }
}

function findSpacedNpcSpot(
  rng: () => number,
  cfg: TerrainConfig,
  requireWater: boolean,
  playerX: number,
  playerZ: number,
  minDistPlayer: number,
  existingNpcs: NpcActor[],
  sectorMaxDist?: number,
): { x: number; z: number } {
  let best = sectorMaxDist
    ? findSpotInSector(rng, cfg, requireWater, playerX, playerZ, minDistPlayer, sectorMaxDist)
    : findValidSpot(rng, cfg, requireWater, playerX, playerZ, minDistPlayer);
  for (let tries = 0; tries < 22; tries++) {
    const clear = existingNpcs.every((n) => Math.hypot(n.x - best.x, n.z - best.z) >= 5.2);
    if (clear) return best;
    best = sectorMaxDist
      ? findSpotInSector(rng, cfg, requireWater, playerX, playerZ, minDistPlayer, sectorMaxDist)
      : findValidSpot(rng, cfg, requireWater, playerX, playerZ, minDistPlayer);
  }
  return best;
}

function getBiomePreySpecies(biomeId: BiomeId): NpcSpeciesId[] {
  switch (biomeId) {
    case 'northern_mountains':
      return ['ibex', 'marmot', 'markhor_npc'];
    case 'deosai_plateau':
      return ['marmot', 'ibex'];
    case 'ziarat_juniper':
      return ['markhor_npc', 'gazelle'];
    case 'indus_river':
      return ['gazelle', 'marmot'];
    case 'thar_desert':
      return ['gazelle'];
  }
}

function getBiomePredatorSpecies(biomeId: BiomeId): NpcSpeciesId {
  switch (biomeId) {
    case 'northern_mountains':
    case 'ziarat_juniper':
      return 'snow_leopard_npc';
    case 'deosai_plateau':
      return 'brown_bear_npc';
    default:
      return 'snow_leopard_npc';
  }
}

function getSpeciesDisplayName(species: NpcSpeciesId): string {
  switch (species) {
    case 'ibex':
      return 'Himalayan Ibex';
    case 'marmot':
      return 'Golden Marmot';
    case 'gazelle':
      return 'Chinkara Gazelle';
    case 'river_fish':
      return 'Indus Mahseer';
    case 'snow_leopard_npc':
      return 'Snow Leopard';
    case 'markhor_npc':
      return 'Suleiman Markhor';
    case 'brown_bear_npc':
      return 'Deosai Brown Bear';
    case 'indus_dolphin_npc':
      return 'Indus River Dolphin';
  }
}

export function generateWorldLayout(
  seed: number,
  biomeId: BiomeId,
  animalId: AnimalId,
  mode: GameMode,
  round = 1,
  previousSpawns: Array<{ x: number; z: number }> = [],
): WorldLayout {
  const rng = createRng(seed ^ (round * 2654435761));
  const terrain = createTerrainConfig(seed, biomeId);
  const biome = BIOMES[biomeId];
  const isAquaticPlayer = animalId === 'indus_dolphin';

  // Unique random start position far from any prior spawn in the session
  const startPos = findValidSpot(
    rng,
    terrain,
    isAquaticPlayer && (biome.hasRiver || biome.hasOasis),
    9999,
    9999,
    0,
    PLAYABLE_RADIUS * 0.72,
    previousSpawns,
  );
  const playerStart = {
    x: startPos.x,
    z: startPos.z,
    heading: randRange(rng, 0, Math.PI * 2),
  };

  const npcs: NpcActor[] = [];
  const items: WorldItem[] = [];

  for (let i = 0; i < 14; i++) {
    let wx: number;
    let wz: number;
    if (biome.hasRiver) {
      wz = randRange(rng, -290, 290);
      const side = i % 2 === 0 ? 1 : -1;
      wx = getRiverCenterX(wz, terrain) + side * (terrain.riverWidth * 0.74);
    } else {
      const ang = (i / 14) * Math.PI * 2 + randRange(rng, -0.25, 0.25);
      wx = terrain.oasisX + Math.cos(ang) * (terrain.oasisRadius * 0.94);
      wz = terrain.oasisZ + Math.sin(ang) * (terrain.oasisRadius * 0.94);
    }
    items.push({
      id: `water-${i}`,
      kind: 'water_spot',
      x: wx,
      y: Math.max(WATER_LEVEL, getTerrainHeight(wx, wz, terrain)),
      z: wz,
      collected: false,
      label: 'Fresh Water',
    });
  }

  const preyPool = getBiomePreySpecies(biomeId);
  const landPreyCount = mode === 'photo_safari' ? 24 : 20 + Math.min(8, round * 2);
  for (let i = 0; i < landPreyCount; i++) {
    const species = preyPool[i % preyPool.length];
    const inSector = i < 12;
    const spot = findSpacedNpcSpot(
      rng,
      terrain,
      false,
      playerStart.x,
      playerStart.z,
      inSector ? 22 : 26,
      npcs,
      inSector ? 115 : undefined,
    );
    npcs.push({
      id: `prey-${i}`,
      kind: 'prey',
      species,
      name: getSpeciesDisplayName(species),
      x: spot.x,
      y: getTerrainHeight(spot.x, spot.z, terrain),
      z: spot.z,
      vx: 0,
      vz: 0,
      heading: randRange(rng, 0, Math.PI * 2),
      radius: getNpcRadius(species, 'prey'),
      gait: 'idle',
      aiState: 'wander',
      stateTimer: randRange(rng, 1, 4),
      zigZagPhase: randRange(rng, 0, Math.PI * 2),
      hopPhase: 0,
      health: 100,
      photographed: false,
    });
  }

  const fishCount = isAquaticPlayer || biome.hasRiver ? 24 : 8;
  for (let i = 0; i < fishCount; i++) {
    const spot = findSpacedNpcSpot(rng, terrain, true, playerStart.x, playerStart.z, 12, npcs);
    npcs.push({
      id: `fish-${i}`,
      kind: 'prey',
      species: 'river_fish',
      name: 'Indus Mahseer',
      x: spot.x,
      y: WATER_LEVEL - 0.15,
      z: spot.z,
      vx: 0,
      vz: 0,
      heading: randRange(rng, 0, Math.PI * 2),
      radius: getNpcRadius('river_fish', 'prey'),
      gait: 'swim',
      aiState: 'wander',
      stateTimer: randRange(rng, 1, 3),
      zigZagPhase: randRange(rng, 0, Math.PI * 2),
      hopPhase: 0,
      health: 100,
      photographed: false,
    });
  }

  // Wild predators in Photo Safari or Wild Life
  if (mode === 'photo_safari' || (mode === 'wild_life' && animalId !== 'snow_leopard' && !isAquaticPlayer)) {
    const predCount = mode === 'photo_safari' ? 8 : 3 + Math.min(4, round);
    const safariSpecies: NpcSpeciesId[] = [
      'snow_leopard_npc',
      'brown_bear_npc',
      'markhor_npc',
      'indus_dolphin_npc',
    ];
    for (let i = 0; i < predCount; i++) {
      const sp = mode === 'photo_safari' ? safariSpecies[i % safariSpecies.length] : getBiomePredatorSpecies(biomeId);
      const isWaterSp = sp === 'indus_dolphin_npc';
      const predKind = isWaterSp ? 'prey' : 'predator';
      const spot = findSpacedNpcSpot(
        rng,
        terrain,
        isWaterSp,
        playerStart.x,
        playerStart.z,
        mode === 'photo_safari' && !isWaterSp ? 28 : 36,
        npcs,
        mode === 'photo_safari' && !isWaterSp ? 115 : undefined,
      );
      npcs.push({
        id: `pred-${i}`,
        kind: predKind,
        species: sp,
        name: getSpeciesDisplayName(sp),
        x: spot.x,
        y: isWaterSp ? WATER_LEVEL - 0.1 : getTerrainHeight(spot.x, spot.z, terrain),
        z: spot.z,
        vx: 0,
        vz: 0,
        heading: randRange(rng, 0, Math.PI * 2),
        radius: getNpcRadius(sp, predKind),
        gait: isWaterSp ? 'swim' : 'walk',
        aiState: 'wander',
        stateTimer: randRange(rng, 2, 5),
        zigZagPhase: 0,
        hopPhase: 0,
        health: 100,
        photographed: false,
      });
    }
  }

  // Armed Shikaris (Hunters) who stalk and shoot wildlife!
  if (mode === 'wild_life') {
    const shikariCount = isAquaticPlayer ? 3 : 3 + Math.min(5, round);
    for (let i = 0; i < shikariCount; i++) {
      let spot: { x: number; z: number };
      if (isAquaticPlayer && biome.hasRiver) {
        const rz = randRange(rng, -250, 250);
        const side = i % 2 === 0 ? 1 : -1;
        const rx = getRiverCenterX(rz, terrain) + side * (terrain.riverWidth * 1.15);
        spot = { x: rx, z: rz };
      } else {
        spot = findSpacedNpcSpot(rng, terrain, false, playerStart.x, playerStart.z, 42, npcs);
      }
      npcs.push({
        id: `shikari-${i}`,
        kind: 'shikari',
        species: 'ibex',
        name: `Shikari Hunter #${i + 1}`,
        x: spot.x,
        y: getTerrainHeight(spot.x, spot.z, terrain),
        z: spot.z,
        vx: 0,
        vz: 0,
        heading: randRange(rng, 0, Math.PI * 2),
        radius: getNpcRadius('ibex', 'shikari'),
        gait: 'walk',
        aiState: 'wander',
        stateTimer: randRange(rng, 1.5, 3.5),
        zigZagPhase: 0,
        hopPhase: 0,
        health: 100,
        photographed: false,
      });
    }
  }

  // Illegal Jaal (River Fishing Nets) placed along the active river stretch near playerStart
  if (biome.hasRiver && (isAquaticPlayer || mode === 'ranger_patrol')) {
    const netCount = Math.min(7, 4 + round);
    const span = 125;
    for (let idx = 0; idx < netCount; idx++) {
      const offset = -span + (idx / Math.max(1, netCount - 1)) * (span * 2);
      const rawZ = playerStart.z + offset + randRange(rng, -10, 10);
      const z = Math.max(-PLAYABLE_RADIUS + 28, Math.min(PLAYABLE_RADIUS - 28, rawZ));
      const x = getRiverCenterX(z, terrain);
      if (Math.hypot(x - playerStart.x, z - playerStart.z) < 16) continue;
      items.push({
        id: `jaal-${idx}`,
        kind: 'jaal',
        x,
        y: WATER_LEVEL,
        z,
        heading: 0,
        width: terrain.riverWidth * 1.48,
        collected: false,
        label: 'Illegal River Jaal (Net)',
      });
    }
  }

  const forageCount = mode === 'wild_life' ? 38 : 14;
  for (let i = 0; i < forageCount; i++) {
    const inSector = i < 16;
    const spot = inSector
      ? findSpotInSector(rng, terrain, isAquaticPlayer, playerStart.x, playerStart.z, 12, 110)
      : findValidSpot(rng, terrain, isAquaticPlayer, playerStart.x, playerStart.z, 14);
    items.push({
      id: `food-${i}`,
      kind: 'food',
      x: spot.x,
      y: isAquaticPlayer ? WATER_LEVEL : getTerrainHeight(spot.x, spot.z, terrain),
      z: spot.z,
      collected: false,
      label: isAquaticPlayer ? 'River Kelp & Shrimp' : 'Wild Forage',
    });
  }

  // Crisp 1-2 minute round orb counts clustered within 115m Expedition Sector
  const orbCount = mode === 'wild_life' ? Math.min(5, 3 + Math.floor((round - 1) / 2)) : 3;
  for (let i = 0; i < orbCount; i++) {
    const spot = findSpotInSector(
      rng,
      terrain,
      isAquaticPlayer,
      playerStart.x,
      playerStart.z,
      26,
      115 + Math.min(30, round * 8),
    );
    items.push({
      id: `orb-${i}`,
      kind: 'orb',
      x: spot.x,
      y: (isAquaticPlayer ? WATER_LEVEL + 0.5 : getTerrainHeight(spot.x, spot.z, terrain)) + 0.9,
      z: spot.z,
      collected: false,
      label: 'Wilderness Spirit Orb',
    });
  }

  if (mode === 'ranger_patrol') {
    const poacherCount = Math.min(4, 2 + Math.floor(round / 2));
    for (let i = 0; i < poacherCount; i++) {
      const spot = findSpacedNpcSpot(rng, terrain, false, playerStart.x, playerStart.z, 32, npcs, 120);
      npcs.push({
        id: `poacher-${i}`,
        kind: 'poacher',
        species: 'ibex',
        name: `Poacher #${i + 1}`,
        x: spot.x,
        y: getTerrainHeight(spot.x, spot.z, terrain),
        z: spot.z,
        vx: 0,
        vz: 0,
        heading: randRange(rng, 0, Math.PI * 2),
        radius: getNpcRadius('ibex', 'poacher'),
        gait: 'walk',
        aiState: 'wander',
        stateTimer: randRange(rng, 1.5, 4),
        zigZagPhase: 0,
        hopPhase: 0,
        health: 100,
        photographed: false,
      });
    }

    const trappedCount = Math.min(3, 2 + Math.floor((round - 1) / 2));
    const trappedPool: NpcSpeciesId[] = ['snow_leopard_npc', 'markhor_npc', 'gazelle'];
    for (let i = 0; i < trappedCount; i++) {
      const spot = findSpacedNpcSpot(rng, terrain, false, playerStart.x, playerStart.z, 26, npcs, 115);
      const sp = trappedPool[i % trappedPool.length];
      npcs.push({
        id: `trapped-${i}`,
        kind: 'trapped_animal',
        species: sp,
        name: `Trapped ${getSpeciesDisplayName(sp)}`,
        x: spot.x,
        y: getTerrainHeight(spot.x, spot.z, terrain),
        z: spot.z,
        vx: 0,
        vz: 0,
        heading: randRange(rng, 0, Math.PI * 2),
        radius: getNpcRadius(sp, 'trapped_animal'),
        gait: 'idle',
        aiState: 'wander',
        stateTimer: 0,
        zigZagPhase: 0,
        hopPhase: 0,
        health: 100,
        photographed: false,
      });
    }

    const snareCount = Math.min(4, 2 + Math.floor(round / 2));
    for (let i = 0; i < snareCount; i++) {
      const spot = findSpotInSector(rng, terrain, false, playerStart.x, playerStart.z, 22, 110);
      items.push({
        id: `snare-${i}`,
        kind: 'snare',
        x: spot.x,
        y: getTerrainHeight(spot.x, spot.z, terrain),
        z: spot.z,
        collected: false,
        label: 'Illegal Wire Snare',
      });
    }
  }

  const treeSpots: Array<{ x: number; z: number; scale: number; rot: number }> = [];
  const treeTarget = biomeId === 'thar_desert' ? 175 : biomeId === 'deosai_plateau' ? 140 : 380;
  for (let i = 0; i < treeTarget; i++) {
    const ang = randRange(rng, 0, Math.PI * 2);
    const rad = Math.sqrt(rng()) * (WORLD_RADIUS - 20) + 10;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    if (isWaterAt(x, z, terrain)) continue;
    if (Math.hypot(x - playerStart.x, z - playerStart.z) < 9) continue;
    if (getGroundSlope(x, z, terrain) > 1.3) continue;
    treeSpots.push({
      x,
      z,
      scale: randRange(rng, 0.85, 1.65),
      rot: randRange(rng, 0, Math.PI * 2),
    });
  }

  const rockSpots: Array<{ x: number; z: number; scale: number; rot: number }> = [];
  for (let i = 0; i < 250; i++) {
    const ang = randRange(rng, 0, Math.PI * 2);
    const rad = Math.sqrt(rng()) * (WORLD_RADIUS - 18) + 12;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    if (Math.hypot(x - playerStart.x, z - playerStart.z) < 8) continue;
    rockSpots.push({
      x,
      z,
      scale: randRange(rng, 0.75, 2.35),
      rot: randRange(rng, 0, Math.PI * 2),
    });
  }

  return {
    terrain,
    playerStart,
    npcs,
    items,
    treeSpots,
    rockSpots,
  };
}
