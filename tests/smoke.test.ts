import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getConservationEnding } from '../src/data/conservation';
import { getDailyExpedition } from '../src/data/dailyExpedition';
import { buildFeedbackEntry } from '../src/data/feedback';
import { buildRecordSummary } from '../src/data/records';
import { PLAYABLE_RADIUS, WATER_LEVEL, getRiverCenterX, getTerrainHeight } from '../src/sim/terrainMath';
import { GameSimulation, SimInput } from '../src/sim/worldSim';

const IDLE_INPUT: SimInput = {
  moveX: 0,
  moveZ: 0,
  cameraYaw: 0,
  sprint: false,
  actionPressed: false,
  callPressed: false,
};

function runSmokeTests() {
  // 1. Expanded Biome scale & unique non-repeating spawns on restart
  assert.ok(PLAYABLE_RADIUS >= 350, 'All 5 biomes must be vastly expanded (>=350m playable radius)');

  const simA = new GameSimulation({
    mode: 'wild_life',
    animalId: 'snow_leopard',
    biomeId: 'northern_mountains',
    seed: 1001,
    startPlaying: true,
  });
  const simB = new GameSimulation({
    mode: 'wild_life',
    animalId: 'snow_leopard',
    biomeId: 'northern_mountains',
    seed: 2002,
    previousSpawns: [{ x: simA.playerX, z: simA.playerZ }],
    startPlaying: true,
  });

  const spawnDist = Math.hypot(simA.playerX - simB.playerX, simA.playerZ - simB.playerZ);
  assert.ok(spawnDist > 20, 'Different restarts must place player at distinct unique coordinates');

  const orbA = simA.layout.items.find((i) => i.kind === 'orb')!;
  const orbB = simB.layout.items.find((i) => i.kind === 'orb')!;
  assert.notEqual(
    `${orbA.x.toFixed(2)},${orbA.z.toFixed(2)}`,
    `${orbB.x.toFixed(2)},${orbB.z.toFixed(2)}`,
    'Different seeds should randomize orb positions',
  );

  // 2. Snow Leopard Prey Pounce & auto-hunt catch + Growth progression
  const prey = simA.layout.npcs.find((n) => n.kind === 'prey' && n.species !== 'river_fish')!;
  simA.food = 50;
  simA.playerX = prey.x - 6.5;
  simA.playerZ = prey.z;
  simA.step(0.016, IDLE_INPUT);
  assert.equal(simA.isAirborne, true, 'Snow Leopard spotting prey within 8.5m should launch airborne Prey Pounce');
  assert.ok(simA.lungeTimer > 0, 'Prey Pounce should engage lungeTimer');

  simA.playerX = prey.x - 1.5;
  simA.playerZ = prey.z;
  simA.step(0.016, IDLE_INPUT);
  assert.equal(simA.preyCaught, 1, 'Predator approaching prey should auto-hunt and catch it');
  assert.ok(simA.food > 50, 'Catching prey should restore food');
  assert.ok(simA.xpEarned > 0, 'Hunting should earn run XP toward Cub -> Juvenile -> Adult growth');

  // 3. Markhor Hill Leap & Horn Charge vs attacking Snow Leopard & Shikari
  const simMarkhor = new GameSimulation({
    mode: 'wild_life',
    animalId: 'markhor',
    biomeId: 'ziarat_juniper',
    season: 'winter',
    seed: 3003,
    startPlaying: true,
  });
  assert.ok(
    simMarkhor.getMigrationLabel().includes('Winter Valley Descent'),
    'Winter season must display Winter Valley Descent migration',
  );

  const groundAtMarkhor = getTerrainHeight(simMarkhor.playerX, simMarkhor.playerZ, simMarkhor.layout.terrain);
  const leaped = simMarkhor.triggerPrimaryAbility();
  assert.equal(leaped, true, 'Markhor should trigger Hill Leap');
  assert.equal(simMarkhor.isAirborne, true, 'Hill Leap should make Markhor airborne');
  simMarkhor.step(0.05, IDLE_INPUT);
  assert.ok(simMarkhor.playerY > groundAtMarkhor + 0.1, 'Markhor Hill Leap must elevate above hill terrain');

  simMarkhor.isAirborne = false;
  simMarkhor.playerY = groundAtMarkhor;
  const predator = simMarkhor.layout.npcs.find((n) => n.kind === 'predator')!;
  assert.ok(predator, 'Wild Life biome should spawn stalking Snow Leopard predator');
  predator.x = simMarkhor.playerX + 3.2;
  predator.z = simMarkhor.playerZ;
  const charged = simMarkhor.triggerSecondaryAbility();
  assert.equal(charged, true, 'Markhor Horn Charge should activate');
  assert.equal(predator.aiState, 'flee', 'Markhor horning an attacking Snow Leopard should force leopard to recoil/flee');
  assert.ok(simMarkhor.adrenalineTimer > 0, 'Markhor horning an attacker should activate protective escape speed burst');

  // 4. Shikari rifle gunfire must genuinely hurt animal on hit!
  simMarkhor.secondaryActiveTimer = 0;
  simMarkhor.secondaryCooldown = 0;
  simMarkhor.adrenalineTimer = 0;
  simMarkhor.isAirborne = false;
  simMarkhor.playerY = getTerrainHeight(simMarkhor.playerX, simMarkhor.playerZ, simMarkhor.layout.terrain);
  const hpBeforeShot = simMarkhor.health;
  simMarkhor.shikariShots.push({
    id: 'test-shot-1',
    x: simMarkhor.playerX,
    y: simMarkhor.playerY + 0.75,
    z: simMarkhor.playerZ,
    vx: 30,
    vy: 0,
    vz: 0,
    life: 1.0,
  });
  simMarkhor.step(0.016, IDLE_INPUT);
  assert.ok(simMarkhor.health < hpBeforeShot, 'Shikari rifle gunfire impact must damage player health');
  assert.ok(simMarkhor.damageTaken > 0, 'Shikari impact must record damageTaken');
  assert.ok(simMarkhor.playerHurtTimer > 0, 'Shikari impact must trigger playerHurtTimer');

  // 5. Brown Bear Slam & Thunder Roar
  const simBear = new GameSimulation({
    mode: 'wild_life',
    animalId: 'brown_bear',
    biomeId: 'deosai_plateau',
    seed: 4004,
    startPlaying: true,
  });
  const bearThreat = simBear.layout.npcs.find((n) => n.kind === 'shikari')!;
  bearThreat.x = simBear.playerX + 5.0;
  bearThreat.z = simBear.playerZ;
  assert.equal(simBear.triggerPrimaryAbility(), true, 'Brown Bear Slam should trigger');
  assert.equal(bearThreat.aiState, 'stunned', 'Brown Bear Slam should stun nearby Shikari');

  // 6. Indus River Dolphin: Jaal entanglement, Breach Jump ABOVE Jaal, and Deep Dive UNDER Jaal
  const simDolphin = new GameSimulation({
    mode: 'wild_life',
    animalId: 'indus_dolphin',
    biomeId: 'indus_river',
    seed: 5005,
    startPlaying: true,
  });
  const jaals = simDolphin.layout.items.filter((i) => i.kind === 'jaal');
  assert.ok(jaals.length >= 2, 'Indus River should spawn multiple Jaal fishing net barriers');

  const jaal1 = jaals[0];
  simDolphin.playerX = jaal1.x;
  simDolphin.playerZ = jaal1.z;
  simDolphin.playerY = WATER_LEVEL - 0.12;
  simDolphin.isDiving = false;
  simDolphin.isAirborne = false;
  simDolphin.step(0.02, IDLE_INPUT);
  assert.ok(simDolphin.health < 100, 'Swimming directly into a Jaal without leaping or diving should cause entanglement damage');

  simDolphin.primaryCooldown = 0;
  simDolphin.jaalsCleared = 0;
  simDolphin.playerY = WATER_LEVEL - 0.1;
  assert.equal(simDolphin.triggerPrimaryAbility(), true, 'Dolphin Breach Jump should trigger');
  for (let i = 0; i < 6; i++) simDolphin.step(0.03, IDLE_INPUT);
  assert.ok(simDolphin.playerY >= WATER_LEVEL + 0.45, 'Breach Jump should lift Dolphin high above water surface');
  simDolphin.playerX = jaal1.x;
  simDolphin.playerZ = jaal1.z;
  simDolphin.step(0.016, IDLE_INPUT);
  assert.equal(jaal1.collected, true, 'Breach Jumping above Jaal should clear it cleanly');
  assert.equal(simDolphin.jaalsCleared, 1, 'jaalsCleared counter should increment');

  const jaal2 = jaals[1];
  simDolphin.secondaryCooldown = 0;
  simDolphin.isAirborne = false;
  simDolphin.playerY = WATER_LEVEL - 0.12;
  simDolphin.playerX = jaal2.x;
  simDolphin.playerZ = jaal2.z - 8;
  assert.equal(simDolphin.triggerSecondaryAbility(), true, 'Dolphin Deep Dive should toggle on');
  assert.equal(simDolphin.isDiving, true, 'isDiving should be true after Deep Dive toggle');
  for (let i = 0; i < 20; i++) simDolphin.step(0.04, IDLE_INPUT);
  assert.ok(simDolphin.playerY <= WATER_LEVEL - 0.85, 'Deep Dive should submerge Dolphin well underneath Jaal depth');
  assert.ok(simDolphin.oxygen < 100, 'Deep Dive underwater must consume oxygen');
  simDolphin.playerX = jaal2.x;
  simDolphin.playerZ = jaal2.z;
  simDolphin.step(0.016, IDLE_INPUT);
  assert.equal(jaal2.collected, true, 'Deep Diving underneath Jaal should clear it cleanly');
  assert.equal(simDolphin.jaalsCleared, 2, 'jaalsCleared should increment for Deep Dive clearance');

  // 7. Swimming, Darts, Arrests & Conservation score increase
  const simSwim = new GameSimulation({
    mode: 'ranger_patrol',
    animalId: 'ranger',
    biomeId: 'indus_river',
    seed: 777,
    startPlaying: true,
  });
  const initialCons = simSwim.conservationScore;
  const riverZ = 10;
  const riverX = getRiverCenterX(riverZ, simSwim.layout.terrain);
  assert.ok(
    getTerrainHeight(riverX, riverZ, simSwim.layout.terrain) < WATER_LEVEL,
    'River center must be below water level',
  );
  simSwim.playerX = riverX;
  simSwim.playerZ = riverZ;
  simSwim.step(0.03, { ...IDLE_INPUT, moveZ: 1 });
  assert.equal(simSwim.isSwimming, true, 'Ranger in river must transition to swimming');
  assert.equal(simSwim.playerGait, 'swim', 'Ranger gait in river must be swim');

  const poacher = simSwim.layout.npcs.find((n) => n.kind === 'poacher')!;
  poacher.x = simSwim.playerX;
  poacher.z = simSwim.playerZ + 12;
  simSwim.playerHeading = 0;
  assert.equal(simSwim.fireDart(), true, 'Ranger should fire tranquilizer dart');

  for (let i = 0; i < 30; i++) {
    simSwim.step(0.02, IDLE_INPUT);
  }
  assert.equal(poacher.aiState, 'sedated', 'Dart hitting poacher should sedate them');

  simSwim.playerX = poacher.x;
  simSwim.playerZ = poacher.z - 1.2;
  simSwim.step(0.02, IDLE_INPUT);
  assert.equal(poacher.aiState, 'arrested', 'Ranger near poacher should auto-arrest');
  assert.equal(simSwim.poachersArrested, 1, 'Arrest counter should increment');
  assert.ok(simSwim.conservationScore > initialCons, 'Arresting poacher must raise biome Conservation Score');

  const trapped = simSwim.layout.npcs.find((n) => n.kind === 'trapped_animal')!;
  simSwim.playerX = trapped.x;
  simSwim.playerZ = trapped.z;
  simSwim.step(0.02, IDLE_INPUT);
  assert.equal(simSwim.animalsRescued, 1, 'Ranger near cage should rescue trapped animal');

  const snare = simSwim.layout.items.find((i) => i.kind === 'snare')!;
  simSwim.playerX = snare.x;
  simSwim.playerZ = snare.z;
  simSwim.step(0.02, IDLE_INPUT);
  assert.equal(simSwim.snaresCleared, 1, 'Ranger near snare should clear it');

  // 8. Photo Safari steady auto-capture & predator non-aggression test
  const simPhoto = new GameSimulation({
    mode: 'photo_safari',
    animalId: 'ranger',
    biomeId: 'northern_mountains',
    seed: 555,
    startPlaying: true,
  });
  const targetAnimal = simPhoto.layout.npcs.find((n) => n.kind === 'predator')!;
  simPhoto.playerX = targetAnimal.x;
  simPhoto.playerZ = targetAnimal.z - 10;
  for (let i = 0; i < 40; i++) {
    simPhoto.step(0.04, { ...IDLE_INPUT, cameraYaw: 0 });
  }
  assert.equal(simPhoto.health, 100, 'Predators must leave photographer alone in Photo Safari');
  assert.ok(simPhoto.photosTaken >= 1, 'Holding steady in viewfinder should auto-capture photo');

  // 9. Daily Expedition Determinism + Conservation Endings + Growth Tiers
  const fixedDate = new Date('2026-11-16T10:00:00Z');
  const d1 = getDailyExpedition(fixedDate);
  const d2 = getDailyExpedition(fixedDate);
  assert.equal(d1.seed, d2.seed, 'Daily Expedition seed must be deterministic per UTC date');

  assert.equal(getConservationEnding(85).tier, 'thriving');
  assert.equal(getConservationEnding(65).tier, 'recovering');
  assert.equal(getConservationEnding(30).tier, 'fragile');

  // 10. 1-2 minute timed rounds, mission rotation, sector clustering, carried XP & species call events
  const simTimed = new GameSimulation({
    mode: 'wild_life',
    animalId: 'markhor',
    biomeId: 'ziarat_juniper',
    seed: 9091,
    round: 1,
    startPlaying: true,
  });
  assert.ok(
    simTimed.roundDurationSec >= 90 && simTimed.roundDurationSec <= 120,
    'Round duration must stay in 1-2 minute range (90-120s)',
  );
  const m1 = simTimed.getRoundMissionMeta(1);
  const m2 = simTimed.getRoundMissionMeta(2);
  assert.notEqual(m1.title, m2.title, 'Each round must present a fresh mission title');

  const round1Orbs = simTimed.layout.items.filter((i) => i.kind === 'orb');
  for (const orb of round1Orbs) {
    const d = Math.hypot(orb.x - simTimed.layout.playerStart.x, orb.z - simTimed.layout.playerStart.z);
    assert.ok(d <= 165, `Sector orbs must stay reachable within 165m for 1-2 min rounds (got ${d.toFixed(1)}m)`);
  }

  // Trigger proximity animal sound call & timed round completion
  const nearbyPrey = simTimed.layout.npcs.find((n) => n.kind === 'prey')!;
  nearbyPrey.x = simTimed.playerX + 8;
  nearbyPrey.z = simTimed.playerZ;
  simTimed.pendingEvents.length = 0;
  simTimed.ambientCallCooldown = 0;
  simTimed.elapsedSec = simTimed.roundDurationSec - 0.02;
  simTimed.step(0.05, IDLE_INPUT);
  const events = [...simTimed.pendingEvents];
  assert.equal(simTimed.phase, 'victory', 'Reaching roundDurationSec must cleanly conclude the round with victory');
  assert.ok(events.some((e) => e.type === 'victory'), 'Timed completion must emit victory event');
  assert.ok(
    events.some((e) => e.type === 'nearby_animal_call' && e.speciesId === nearbyPrey.species),
    'Nearby animal within range must emit nearby_animal_call with speciesId',
  );

  // Carried run XP across rounds should keep Adult progression
  const simAdultCarry = new GameSimulation({
    mode: 'wild_life',
    animalId: 'snow_leopard',
    biomeId: 'northern_mountains',
    round: 2,
    initialRunXp: 180,
    startPlaying: true,
  });
  assert.equal(simAdultCarry.growthStage, 'adult', 'Carrying >=175 run XP into Round 2 must keep Adult stage');

  // 11. Animal <-> Animal, Ranger Man <-> Animal & Ranger Man <-> Co-op Ranger non-overlapping collision + dynamic audio env
  // 11a. Wild Life: Predator <-> Prey non-overlap
  const simWildSep = new GameSimulation({
    mode: 'wild_life',
    animalId: 'markhor',
    biomeId: 'ziarat_juniper',
    seed: 6062,
    startPlaying: true,
  });
  const wlPrey = simWildSep.layout.npcs.find((n) => n.kind === 'prey')!;
  const wlPred = simWildSep.layout.npcs.find((n) => n.kind === 'predator')!;
  const safeTestX = simWildSep.playerX + (simWildSep.playerX > 0 ? -35 : 35);
  const safeTestZ = simWildSep.playerZ + (simWildSep.playerZ > 0 ? -35 : 35);
  wlPrey.x = safeTestX;
  wlPrey.z = safeTestZ;
  wlPred.x = safeTestX + 0.1;
  wlPred.z = safeTestZ;
  simWildSep.step(0.016, IDLE_INPUT);
  const wlSep = Math.hypot(wlPrey.x - wlPred.x, wlPrey.z - wlPred.z);
  assert.ok(
    wlSep >= wlPrey.radius + wlPred.radius + 0.3,
    `Overlapping wild animals must physically separate beyond combined radii (got ${wlSep.toFixed(2)}m)`,
  );

  // 11b. Ranger Patrol: Actor <-> Actor & Ranger Man <-> Animal & Ranger Man <-> Co-op Ranger non-overlap
  const simOverlap = new GameSimulation({
    mode: 'ranger_patrol',
    animalId: 'ranger',
    biomeId: 'ziarat_juniper',
    seed: 6061,
    startPlaying: true,
  });
  const npcA = simOverlap.layout.npcs.find((n) => n.kind === 'prey')!;
  const npcB = simOverlap.layout.npcs.find(
    (n) => n.id !== npcA.id && n.kind !== 'trapped_animal',
  )!;
  const rSafeX = simOverlap.playerX + (simOverlap.playerX > 0 ? -35 : 35);
  const rSafeZ = simOverlap.playerZ + (simOverlap.playerZ > 0 ? -35 : 35);
  npcA.x = rSafeX;
  npcA.z = rSafeZ;
  npcB.x = rSafeX + 0.1;
  npcB.z = rSafeZ;
  simOverlap.step(0.016, IDLE_INPUT);
  const npcSep = Math.hypot(npcA.x - npcB.x, npcA.z - npcB.z);
  assert.ok(
    npcSep >= npcA.radius + npcB.radius + 0.3,
    `Overlapping actors in Ranger Patrol must physically separate beyond combined radii (got ${npcSep.toFixed(2)}m)`,
  );

  // Place Ranger directly overlapping npcA
  simOverlap.playerX = npcA.x + 0.1;
  simOverlap.playerZ = npcA.z;
  simOverlap.step(0.016, IDLE_INPUT);
  const rangerNpcSep = Math.hypot(simOverlap.playerX - npcA.x, simOverlap.playerZ - npcA.z);
  const expectedRangerNpcMin = npcA.radius + simOverlap.getPlayerCollisionRadius() + 0.25;
  assert.ok(
    rangerNpcSep >= expectedRangerNpcMin,
    `Ranger Man and animal must never overlap (got ${rangerNpcSep.toFixed(2)}m, expected >= ${expectedRangerNpcMin.toFixed(2)}m)`,
  );

  // Co-op Ranger peer separation
  simOverlap.setCoopPeers([
    {
      peerId: 'peer-ranger-2',
      playerName: 'Fellow Ranger',
      animalId: 'ranger',
      x: simOverlap.playerX + 0.15,
      y: simOverlap.playerY,
      z: simOverlap.playerZ,
      heading: 0,
      gait: 'idle',
      updatedAt: Date.now(),
    },
  ]);
  simOverlap.step(0.016, IDLE_INPUT);
  const peerSep = Math.hypot(
    simOverlap.playerX - simOverlap.coopPeers[0].x,
    simOverlap.playerZ - simOverlap.coopPeers[0].z,
  );
  assert.ok(
    peerSep >= simOverlap.getPlayerCollisionRadius() + 1.15 + 0.25,
    `Co-op Rangers must separate cleanly without overlapping (got ${peerSep.toFixed(2)}m)`,
  );

  // Dynamic environment metrics for localized audio engine
  const dolphinSnap = simDolphin.getSnapshot();
  const ziaratSnap = simOverlap.getSnapshot();
  assert.equal(dolphinSnap.distanceToWater, 0, 'Indus Dolphin inside river should report distanceToWater === 0');
  assert.ok(Number.isFinite(ziaratSnap.elevation), 'Snapshot must expose finite elevation for wind modulation');
  assert.ok(ziaratSnap.distanceToWater >= 0, 'Snapshot must expose non-negative distanceToWater');

  // 12. Ranger Toolkit (Binoculars, Camera, Tranq Dart) & Interactive Photo Safari (Manual Snap, Telephoto, Call Pose, Grades)
  const simToolkit = new GameSimulation({
    mode: 'ranger_patrol',
    animalId: 'ranger',
    biomeId: 'ziarat_juniper',
    seed: 8080,
    startPlaying: true,
  });
  const tkPoacher = simToolkit.layout.npcs.find((n) => n.kind === 'poacher')!;
  tkPoacher.x = simToolkit.playerX;
  tkPoacher.z = simToolkit.playerZ + 18;
  simToolkit.playerHeading = 0;

  // 12a. Binoculars: switch, aim, scout & tag
  simToolkit.setEquippedTool('binoculars');
  assert.equal(simToolkit.equippedTool, 'binoculars', 'Ranger should equip binoculars');
  simToolkit.step(0.02, { ...IDLE_INPUT, cameraYaw: 0 });
  assert.ok(simToolkit.binocularsTarget !== null, 'Binoculars aimed at poacher must acquire target');
  const scoreBeforeScout = simToolkit.score;
  assert.equal(simToolkit.triggerPrimaryAbility(), true, 'Binoculars primary action should scout & tag target');
  assert.ok(simToolkit.scoutedActorIds.size >= 1, 'Binoculars scouting must record scouted target');
  assert.ok(simToolkit.score >= scoreBeforeScout + 65, 'Scouting threat with Binoculars must award +65 score');

  // 12b. Camera in Ranger Patrol: evidence capture boosts conservationScore
  simToolkit.setEquippedTool('camera');
  assert.equal(simToolkit.equippedTool, 'camera', 'Ranger should equip camera');
  simToolkit.step(0.02, { ...IDLE_INPUT, cameraYaw: 0 });
  const consBeforeEvidence = simToolkit.conservationScore;
  assert.equal(simToolkit.triggerPrimaryAbility(), true, 'Ranger Camera should snap poacher evidence photo');
  assert.ok(simToolkit.evidencePhotosTaken >= 1, 'Ranger Camera must increment evidencePhotosTaken on poacher shot');
  assert.ok(simToolkit.conservationScore > consBeforeEvidence, 'Evidence photo must raise Conservation Score');

  // 12c. Tranq Dart: target lock + fire
  simToolkit.setEquippedTool('dart');
  assert.equal(simToolkit.equippedTool, 'dart', 'Ranger should equip dart rifle');
  simToolkit.step(0.02, { ...IDLE_INPUT, cameraYaw: 0 });
  assert.ok(simToolkit.dartTargetName !== null, 'Dart rifle aimed at active poacher should display lock target');
  const dartsBefore = simToolkit.darts.length;
  assert.equal(simToolkit.triggerPrimaryAbility(), true, 'Dart primary action should fire tranquilizer dart');
  assert.equal(simToolkit.darts.length, dartsBefore + 1, 'Firing dart should spawn active dart projectile');

  // 12d. Photo Safari upgrades: Telephoto Zoom, Wildlife Call pose attraction, Manual S-Rank Snap
  const simSafari = new GameSimulation({
    mode: 'photo_safari',
    animalId: 'ranger',
    biomeId: 'northern_mountains',
    seed: 9191,
    startPlaying: true,
  });
  const safariWild = simSafari.layout.npcs.find((n) => n.kind === 'predator' || n.kind === 'prey')!;
  safariWild.x = simSafari.playerX;
  safariWild.z = simSafari.playerZ + 11;

  assert.equal(simSafari.triggerSecondaryAbility(), true, 'Photo Safari secondary action must toggle Telephoto Zoom');
  assert.equal(simSafari.telephotoZoomed, true, 'telephotoZoomed must be active');

  simSafari.step(0.02, { ...IDLE_INPUT, cameraYaw: 0, callPressed: true });
  assert.equal(safariWild.aiState, 'alert_freeze', 'Pressing Call (E) in Photo Safari must pause nearby wildlife for portrait pose');
  assert.ok(simSafari.photoTarget !== null, 'Viewfinder aimed at framed wildlife must populate photoTarget');

  simSafari.pendingEvents.length = 0;
  assert.equal(simSafari.triggerPrimaryAbility(), true, 'Photo Safari primary action (Space/Snap) must capture photo immediately');
  assert.ok(simSafari.photosTaken >= 1, 'Manual snap must increment photosTaken');
  assert.equal(simSafari.lastPhotoGrade, 'S', 'Close centered shot (<14m) must earn S-Rank grade');
  assert.ok(
    simSafari.pendingEvents.some((e) => e.type === 'photo_captured'),
    'Manual photo snap must emit photo_captured event for 3D album capture & SFX',
  );

  // 13. Photo Safari Rarity x Quality Scoring, Rotating Field Challenges & Leaderboard Summary
  const simRarity = new GameSimulation({
    mode: 'photo_safari',
    animalId: 'ranger',
    biomeId: 'northern_mountains',
    seed: 9393,
    round: 1,
    startPlaying: true,
  });

  // 13a. Common species shot vs Legendary species shot
  const commonIbex = simRarity.layout.npcs.find((n) => n.species === 'ibex')!;
  const legLeopard = simRarity.layout.npcs.find((n) => n.species === 'snow_leopard_npc')!;
  // Keep leopard far initially so we isolate common Ibex first
  legLeopard.x = simRarity.playerX - 180;
  legLeopard.z = simRarity.playerZ - 180;
  commonIbex.x = simRarity.playerX;
  commonIbex.z = simRarity.playerZ + 12;

  simRarity.step(0.02, { ...IDLE_INPUT, cameraYaw: 0 });
  assert.ok(simRarity.photoTarget !== null, 'Ibex should lock in viewfinder');
  assert.equal(simRarity.photoTarget?.rarity, 'common', 'Ibex should report Common rarity');
  const commonProjected = simRarity.photoTarget?.projectedPoints ?? 0;
  assert.equal(simRarity.triggerPrimaryAbility(), true, 'Should snap Common Ibex');
  const scoreAfterCommon = simRarity.score;

  // Move Ibex away and frame Legendary Snow Leopard close at center!
  commonIbex.x = simRarity.playerX - 160;
  legLeopard.x = simRarity.playerX;
  legLeopard.z = simRarity.playerZ + 12;
  // Wait out short shutter cooldown
  for (let i = 0; i < 12; i++) simRarity.step(0.05, { ...IDLE_INPUT, cameraYaw: 0 });
  simRarity.step(0.02, { ...IDLE_INPUT, cameraYaw: 0, callPressed: true });
  assert.equal(legLeopard.aiState, 'alert_freeze', 'Predator in Photo Safari must hold Portrait Pose on E Call');
  assert.equal(simRarity.photoTarget?.rarity, 'legendary', 'Snow Leopard must report Legendary rarity');
  const legProjected = simRarity.photoTarget?.projectedPoints ?? 0;
  assert.ok(
    legProjected > commonProjected * 2,
    `Legendary Snow Leopard (${legProjected} pts) must score well over 2x Common Ibex (${commonProjected} pts)`,
  );

  assert.equal(simRarity.triggerPrimaryAbility(), true, 'Should snap Legendary Snow Leopard');
  assert.ok(simRarity.score - scoreAfterCommon >= 780, 'Legendary S-Rank + Round 1 Rare Challenge must award huge score');
  assert.equal(simRarity.safariChallengeDone, true, 'Round 1 Rare & Legendary Lens challenge must complete on A/S Legendary capture');
  assert.ok(simRarity.rareShotsCount >= 1 && simRarity.sRankCount >= 2, 'Snapshot must track rareShotsCount and sRankCount');

  // Round 3 Telephoto Whisperer Challenge check
  const simSafariR3 = new GameSimulation({
    mode: 'photo_safari',
    animalId: 'ranger',
    biomeId: 'northern_mountains',
    seed: 9494,
    round: 3,
    startPlaying: true,
  });
  const r3Snap = simSafariR3.getSnapshot();
  assert.equal(r3Snap.safariChallengeTitle, 'Telephoto Whisperer', 'Round 3 must rotate to Telephoto Whisperer challenge');
  const lbSummary = buildRecordSummary(simRarity.getSnapshot());
  assert.ok(lbSummary.includes('S-Rank') && lbSummary.includes('Rare+'), `Leaderboard summary must highlight S-Rank & Rare+: ${lbSummary}`);

  // 14. Post-Game Feedback builder, README & SEO/AEO/GEO verification
  const fb = buildFeedbackEntry({
    playerName: '  Amina Khan  ',
    userEmail: 'amina@example.com',
    rating: 7,
    category: 'Photo Safari',
    mode: 'photo_safari',
    animalId: 'ranger',
    biomeId: 'northern_mountains',
    round: 2,
    score: 2140,
    victory: true,
    comment: 'Loved photographing the Snow Leopard in Winter!',
  });
  assert.equal(fb.rating, 5, 'Feedback rating must clamp to max 5');
  assert.equal(fb.playerName, 'Amina Khan', 'Feedback builder should trim playerName');
  assert.ok(fb.id.startsWith('fb-'), 'Feedback ID must have fb- prefix');

  const rootDir = process.cwd();
  const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
  assert.ok(readme.includes('Wild Pakistan'), 'README.md must exist and document Wild Pakistan');
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('"@type": ["VideoGame", "WebApplication"]') && indexHtml.includes('FAQPage'), 'index.html must include VideoGame/WebApplication & FAQPage JSON-LD');
  const llmsTxt = fs.readFileSync(path.join(rootDir, 'public/llms.txt'), 'utf8');
  assert.ok(llmsTxt.includes('Rarity') && llmsTxt.includes('Ranger Toolkit'), 'public/llms.txt must document Photo Safari Rarity & Ranger Toolkit for AEO/GEO');

  const schemaSql = fs.readFileSync(path.join(rootDir, 'supabase/schema.sql'), 'utf8');
  assert.ok(
    schemaSql.includes('register_player') && schemaSql.includes('login_player') && schemaSql.includes('player_accounts'),
    'supabase/schema.sql must define pgcrypto bcrypt account tables & RPCs',
  );
  const authSrc = fs.readFileSync(path.join(rootDir, 'src/data/auth.ts'), 'utf8');
  assert.ok(authSrc.includes('fetchJsonSafe'), 'src/data/auth.ts must guard /api fetches with fetchJsonSafe');
  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  assert.ok(
    appSrc.includes('allowClose={false}') && appSrc.includes('requestNavigateToGame'),
    'src/App.tsx must enforce Login Gate before entering Wilderness or /game/',
  );

  console.log(
    'ALL SMOKE TESTS PASSED: expanded scale (>=350m), unique spawns, 1-2 min timed rounds, non-overlapping animal/ranger/coop separation, dynamic audio env metrics, Ranger Toolkit (Binoculars/Camera/Dart), Photo Safari Rarity x Quality scoring & Field Challenges, Markhor horn-counter, lethal Shikari gunfire, seasonal migration, carried XP growth tiers, Daily Expedition, Conservation endings, Dolphin breach/dive, Ranger patrol, Feedback, Auth Login Gate & SEO/AEO/GEO checks',
  );
}

runSmokeTests();
