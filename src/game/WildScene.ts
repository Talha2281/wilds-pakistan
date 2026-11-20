import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ANIMALS } from '../data/animals';
import { BIOMES } from '../data/biomes';
import { getGrowthStageFromRunXp } from '../data/progression';
import {
  WATER_LEVEL,
  WORLD_RADIUS,
  getTerrainHeight,
} from '../sim/terrainMath';
import { GameSimulation, SimInput } from '../sim/worldSim';
import {
  BiomeId,
  CoopPeerState,
  RangerToolId,
  SeasonId,
  SimEvent,
  SimSnapshot,
  SkinSpec,
  WeatherId,
} from '../types/game';
import { MaterialBundle, createBiomeMaterials } from './materials';
import {
  RigHandles,
  animateActorRig,
  buildCageOverlay,
  buildCharacterRig,
  buildCoopNameBadge,
  buildJaalMesh,
  buildNpcRig,
  setRigHurtFlash,
} from './models';

const _v1 = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function createSkyDome(topHex: string, horizonHex: string): THREE.Mesh {
  const geo = new THREE.SphereGeometry(960, 28, 18);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const topCol = new THREE.Color(topHex);
  const horCol = new THREE.Color(horizonHex);

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y + 60) / 560, 0, 1);
    _color.copy(horCol).lerp(topCol, Math.pow(t, 0.7));
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

function createDistantMountainRing(
  biomeId: BiomeId,
  season: SeasonId,
): THREE.Mesh {
  const biome = BIOMES[biomeId];
  const segments = 72;
  const ringRadius = 620;
  const baseColor = new THREE.Color(biome.mountainBaseColor);
  const peakColor = new THREE.Color(biome.mountainPeakColor);

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const ridge1 = Math.abs(Math.sin(angle * 5.0 + 0.4));
    const ridge2 = Math.abs(Math.cos(angle * 11.0 - 0.7)) * 0.45;
    const heightScale =
      biomeId === 'northern_mountains'
        ? 128
        : biomeId === 'deosai_plateau'
          ? 96
          : biomeId === 'ziarat_juniper'
            ? 74
            : biomeId === 'indus_river'
              ? 44
              : 34;
    const peakHeight = 28 + (ridge1 + ridge2) * heightScale;

    positions.push(cos * (ringRadius - 90), -12, sin * (ringRadius - 90));
    positions.push(cos * ringRadius, peakHeight, sin * ringRadius);
    positions.push(cos * (ringRadius + 110), -18, sin * (ringRadius + 110));

    const snowFactor =
      biomeId === 'northern_mountains' || biomeId === 'deosai_plateau' || season === 'winter'
        ? 1.0
        : 0.28;
    const mixedPeak = baseColor.clone().lerp(peakColor, snowFactor);

    colors.push(baseColor.r, baseColor.g, baseColor.b);
    colors.push(mixedPeak.r, mixedPeak.g, mixedPeak.b);
    colors.push(baseColor.r * 0.8, baseColor.g * 0.8, baseColor.b * 0.8);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    indices.push(a, a + 1, b);
    indices.push(b, a + 1, b + 1);
    indices.push(a + 1, a + 2, b + 1);
    indices.push(b + 1, a + 2, b + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
    fog: true,
  });
  return new THREE.Mesh(geo, mat);
}

function buildTerrainMesh(
  sim: GameSimulation,
  material: THREE.MeshStandardMaterial,
): THREE.Mesh {
  const size = WORLD_RADIUS * 2.25;
  const segs = 176;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const biome = BIOMES[sim.biomeId];
  const cLow = new THREE.Color(biome.groundLow);
  const cMid = new THREE.Color(biome.groundMid);
  const cHigh = new THREE.Color(biome.groundHigh);
  const cRock = new THREE.Color(biome.rockColor);
  const cSand = new THREE.Color('#c9b079');
  const cSnow = new THREE.Color('#eff5f8');

  if (sim.season === 'autumn') {
    cMid.lerp(new THREE.Color('#a67838'), 0.45);
    cLow.lerp(new THREE.Color('#8c6b32'), 0.35);
  } else if (sim.season === 'winter') {
    cHigh.lerp(cSnow, 0.72);
    if (sim.biomeId !== 'thar_desert' && sim.biomeId !== 'indus_river') {
      cMid.lerp(cSnow, 0.38);
    }
  } else if (sim.season === 'spring') {
    cLow.lerp(new THREE.Color('#4d9448'), 0.2);
    cMid.lerp(new THREE.Color('#5ea352'), 0.16);
  }

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = getTerrainHeight(x, z, sim.layout.terrain);
    pos.setY(i, y);

    if (y < WATER_LEVEL + 0.18) {
      _color.copy(cSand);
    } else if (y < 2.4) {
      _color.copy(cLow).lerp(cMid, THREE.MathUtils.clamp((y - 0.18) / 2.2, 0, 1));
    } else if (y < 8.5) {
      _color.copy(cMid).lerp(cHigh, THREE.MathUtils.clamp((y - 2.4) / 6.1, 0, 1));
    } else {
      _color.copy(cHigh).lerp(cRock, THREE.MathUtils.clamp((y - 8.5) / 6.5, 0, 1));
      if (y > 14 && (sim.biomeId === 'northern_mountains' || sim.season === 'winter')) {
        _color.lerp(cSnow, THREE.MathUtils.clamp((y - 14) / 6, 0, 0.85));
      }
    }

    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function createBiomeTreesInstanced(
  sim: GameSimulation,
  mats: MaterialBundle,
): THREE.Group {
  const group = new THREE.Group();
  const spots = sim.layout.treeSpots;
  if (spots.length === 0) return group;

  const style = BIOMES[sim.biomeId].treeStyle;
  const count = spots.length;

  const trunkGeo =
    style === 'juniper'
      ? new THREE.CylinderGeometry(0.16, 0.32, 2.2, 5)
      : style === 'acacia'
        ? new THREE.CylinderGeometry(0.14, 0.24, 2.6, 5)
        : new THREE.CylinderGeometry(0.18, 0.3, 2.5, 6);
  trunkGeo.translate(0, 1.25, 0);

  const canopyGeo =
    style === 'pine'
      ? new THREE.ConeGeometry(1.55, 4.4, 6)
      : style === 'acacia'
        ? new THREE.CylinderGeometry(2.1, 0.55, 1.1, 7)
        : style === 'juniper'
          ? new THREE.DodecahedronGeometry(1.45, 0)
          : new THREE.DodecahedronGeometry(1.35, 0);

  if (style === 'pine') canopyGeo.translate(0, 4.2, 0);
  else if (style === 'acacia') canopyGeo.translate(0, 2.9, 0);
  else canopyGeo.translate(0, 2.8, 0);

  const trunks = new THREE.InstancedMesh(trunkGeo, mats.trunkMaterial, count);
  const canopies = new THREE.InstancedMesh(canopyGeo, mats.foliageMaterial, count);
  trunks.castShadow = true;
  canopies.castShadow = true;
  canopies.receiveShadow = true;

  let upperCones: THREE.InstancedMesh | null = null;
  if (style === 'pine') {
    const upperGeo = new THREE.ConeGeometry(1.12, 3.2, 6);
    upperGeo.translate(0, 6.1, 0);
    upperCones = new THREE.InstancedMesh(upperGeo, mats.foliageMaterial, count);
    upperCones.castShadow = true;
  }

  for (let i = 0; i < count; i++) {
    const sp = spots[i];
    const y = getTerrainHeight(sp.x, sp.z, sim.layout.terrain);
    _dummy.position.set(sp.x, y - 0.1, sp.z);
    _dummy.rotation.set(0, sp.rot, 0);
    _dummy.scale.setScalar(sp.scale);
    _dummy.updateMatrix();

    trunks.setMatrixAt(i, _dummy.matrix);
    canopies.setMatrixAt(i, _dummy.matrix);
    upperCones?.setMatrixAt(i, _dummy.matrix);

    const tint = 0.86 + ((i * 37) % 28) * 0.01;
    _color.setRGB(tint, tint, tint);
    canopies.setColorAt(i, _color);
    upperCones?.setColorAt(i, _color);
  }

  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  canopies.computeBoundingSphere();

  group.add(trunks, canopies);
  if (upperCones) {
    upperCones.instanceMatrix.needsUpdate = true;
    if (upperCones.instanceColor) upperCones.instanceColor.needsUpdate = true;
    upperCones.computeBoundingSphere();
    group.add(upperCones);
  }

  return group;
}

function createRocksInstanced(
  sim: GameSimulation,
  rockMat: THREE.MeshStandardMaterial,
): THREE.InstancedMesh | null {
  const spots = sim.layout.rockSpots;
  if (spots.length === 0) return null;

  const geo = new THREE.DodecahedronGeometry(0.95, 0);
  geo.scale(1.15, 0.72, 1.0);
  const rocks = new THREE.InstancedMesh(geo, rockMat, spots.length);
  rocks.castShadow = true;
  rocks.receiveShadow = true;

  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const y = getTerrainHeight(sp.x, sp.z, sim.layout.terrain);
    _dummy.position.set(sp.x, y + 0.15 * sp.scale, sp.z);
    _dummy.rotation.set(sp.rot * 0.3, sp.rot, 0);
    _dummy.scale.setScalar(sp.scale);
    _dummy.updateMatrix();
    rocks.setMatrixAt(i, _dummy.matrix);

    const shade = 0.85 + ((i * 19) % 30) * 0.01;
    _color.setRGB(shade, shade, shade);
    rocks.setColorAt(i, _color);
  }

  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  rocks.computeBoundingSphere();
  return rocks;
}

function createWeatherParticles(weather: WeatherId): THREE.Points | null {
  if (weather === 'clear') return null;
  const count = weather === 'snow' ? 750 : weather === 'rain' ? 820 : 380;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 160;
    positions[i * 3 + 1] = Math.random() * 36;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 160;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const color =
    weather === 'snow'
      ? '#f7fbff'
      : weather === 'rain'
        ? '#a7d8f0'
        : weather === 'dust'
          ? '#e8c488'
          : '#fff8dc';
  const mat = new THREE.PointsMaterial({
    color,
    size: weather === 'snow' ? 0.38 : weather === 'rain' ? 0.24 : 0.28,
    transparent: true,
    opacity: weather === 'mist' ? 0.35 : 0.72,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

export interface WildSceneCallbacks {
  onSnapshot: (snap: SimSnapshot) => void;
  onEvents: (events: SimEvent[]) => void;
}

export class WildScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private envRT: THREE.WebGLRenderTarget;

  private sim: GameSimulation;
  private callbacks: WildSceneCallbacks;
  private mats: MaterialBundle;
  private activeSkin?: SkinSpec;

  private playerRig: RigHandles;
  private npcRigs: Map<string, { rig: RigHandles; cage?: THREE.Group }> = new Map();
  private peerRigs: Map<
    string,
    { rig: RigHandles; animalId: string; badge: THREE.Sprite; state: CoopPeerState }
  > = new Map();
  private itemMeshes: Map<string, THREE.Object3D> = new Map();
  private dartMeshes: Map<string, THREE.Mesh> = new Map();
  private shikariShotMeshes: Map<string, THREE.Mesh> = new Map();
  private weatherPoints: THREE.Points | null = null;
  private keyLight: THREE.DirectionalLight;

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private animPhase = 0;

  private heldKeys: Record<string, boolean> = {};
  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchSprint = false;
  private pendingAction = false;
  private pendingSecondary = false;
  private pendingCall = false;

  private cameraYaw = 0;
  private cameraPitch = 0.28;
  private cameraDist = 11.5;
  private targetCamPos = new THREE.Vector3();
  private targetLookAt = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private flythroughMode = false;
  private snapshotTimer = 0;

  constructor(
    container: HTMLElement,
    sim: GameSimulation,
    callbacks: WildSceneCallbacks,
    flythroughMode = false,
    skin?: SkinSpec,
  ) {
    this.container = container;
    this.sim = sim;
    this.callbacks = callbacks;
    this.flythroughMode = flythroughMode;
    this.activeSkin = skin;
    this.cameraYaw = sim.playerHeading;

    this.isSoftwareGl = detectSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
    );
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const biome = BIOMES[sim.biomeId];
    this.scene.background = new THREE.Color(biome.skyHorizon);
    this.scene.fog = new THREE.FogExp2(biome.fogColor, biome.fogDensity);

    const aspect =
      (container.clientWidth || window.innerWidth) /
      Math.max(1, container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.25, 1280);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(
      biome.hemiSky,
      biome.hemiGround,
      biome.hemiIntensity,
    );
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(biome.sunColor, biome.sunIntensity);
    this.keyLight.position.set(55, 85, 45);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.camera.near = 5;
    this.keyLight.shadow.camera.far = 230;
    const d = 75;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    const rimLight = new THREE.DirectionalLight('#b5dcff', 0.45);
    rimLight.position.set(-45, 35, -60);
    this.scene.add(rimLight);

    this.mats = createBiomeMaterials(biome, this.renderer, sim.season);
    this.scene.add(createSkyDome(biome.skyTop, biome.skyHorizon));
    this.scene.add(createDistantMountainRing(sim.biomeId, sim.season));
    this.scene.add(buildTerrainMesh(sim, this.mats.terrainMaterial));

    const waterGeo = new THREE.PlaneGeometry(WORLD_RADIUS * 2.25, WORLD_RADIUS * 2.25, 64, 64);
    const waterMesh = new THREE.Mesh(waterGeo, this.mats.waterMaterial);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = WATER_LEVEL;
    waterMesh.receiveShadow = true;
    this.scene.add(waterMesh);

    this.scene.add(createBiomeTreesInstanced(sim, this.mats));
    const rocks = createRocksInstanced(sim, this.mats.rockMaterial);
    if (rocks) this.scene.add(rocks);

    this.weatherPoints = createWeatherParticles(sim.weather);
    if (this.weatherPoints) this.scene.add(this.weatherPoints);

    this.playerRig = buildCharacterRig(sim.animalId, this.mats.snowLeopardFur, this.activeSkin);
    const growthMult =
      sim.animalId === 'ranger'
        ? 1.0
        : getGrowthStageFromRunXp(sim.xpEarned).scaleFactor;
    this.playerRig.root.scale.setScalar(ANIMALS[sim.animalId].scale * growthMult);
    this.playerRig.root.position.set(sim.playerX, sim.playerY, sim.playerZ);
    this.playerRig.root.rotation.y = sim.playerHeading;
    if (flythroughMode) this.playerRig.root.visible = false;
    this.scene.add(this.playerRig.root);

    this.populateDynamicEntities();
    this.snapCameraToPlayer();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.startLoop();
  }

  private populateDynamicEntities(): void {
    for (const npc of this.sim.layout.npcs) {
      const rig = buildNpcRig(npc.kind, npc.species, this.mats.snowLeopardFur);
      rig.root.position.set(npc.x, npc.y, npc.z);
      rig.root.rotation.y = npc.heading;
      let cage: THREE.Group | undefined;
      if (npc.kind === 'trapped_animal') {
        cage = buildCageOverlay();
        rig.root.add(cage);
      }
      this.scene.add(rig.root);
      this.npcRigs.set(npc.id, { rig, cage });
    }

    const orbGeo = new THREE.OctahedronGeometry(0.65, 0);
    const orbMat = new THREE.MeshStandardMaterial({
      color: '#4de3b2',
      emissive: '#1fa37b',
      emissiveIntensity: 0.75,
      roughness: 0.2,
      metalness: 0.3,
      flatShading: true,
    });

    const foodGeo = new THREE.DodecahedronGeometry(0.45, 0);
    const foodMat = new THREE.MeshStandardMaterial({
      color: '#d96b38',
      roughness: 0.65,
      flatShading: true,
    });

    const snareGeo = new THREE.TorusGeometry(0.65, 0.08, 6, 12);
    snareGeo.rotateX(Math.PI / 2);
    const snareMat = new THREE.MeshStandardMaterial({
      color: '#cf4836',
      emissive: '#751c12',
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.7,
    });

    for (const item of this.sim.layout.items) {
      if (item.kind === 'water_spot') continue;
      let obj: THREE.Object3D;
      if (item.kind === 'orb') {
        obj = new THREE.Mesh(orbGeo, orbMat);
      } else if (item.kind === 'food') {
        obj = new THREE.Mesh(foodGeo, foodMat);
      } else if (item.kind === 'jaal') {
        obj = buildJaalMesh(item.width ?? 16);
      } else {
        obj = new THREE.Mesh(snareGeo, snareMat);
      }
      obj.position.set(
        item.x,
        item.kind === 'jaal' ? WATER_LEVEL : item.y + (item.kind === 'snare' ? 0.1 : 0.3),
        item.z,
      );
      obj.castShadow = item.kind !== 'jaal';
      this.scene.add(obj);
      this.itemMeshes.set(item.id, obj);
    }
  }

  public syncCoopPeers(peers: CoopPeerState[]): void {
    this.sim.setCoopPeers(peers);
    const incomingIds = new Set(peers.map((p) => p.peerId));
    for (const [id, entry] of this.peerRigs.entries()) {
      if (!incomingIds.has(id)) {
        this.scene.remove(entry.rig.root);
        this.peerRigs.delete(id);
      }
    }

    for (const peer of peers) {
      const existing = this.peerRigs.get(peer.peerId);
      if (!existing || existing.animalId !== peer.animalId) {
        if (existing) this.scene.remove(existing.rig.root);
        const rig = buildCharacterRig(peer.animalId, this.mats.snowLeopardFur);
        rig.root.scale.setScalar(ANIMALS[peer.animalId].scale);
        rig.root.position.set(peer.x, peer.y, peer.z);
        rig.root.rotation.y = peer.heading;
        const badge = buildCoopNameBadge(peer.playerName);
        rig.root.add(badge);
        this.scene.add(rig.root);
        this.peerRigs.set(peer.peerId, { rig, animalId: peer.animalId, badge, state: peer });
      } else {
        existing.state = peer;
      }
    }
  }

  public captureSnapshotDataUrl(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/jpeg', 0.85);
  }

  private snapCameraToPlayer(): void {
    const dist = this.sim.mode === 'photo_safari' ? 7.5 : 11.5;
    this.cameraDist = dist;
    const x = this.sim.playerX - Math.sin(this.cameraYaw) * dist;
    const z = this.sim.playerZ - Math.cos(this.cameraYaw) * dist;
    this.camera.position.set(x, this.sim.playerY + 4.8, z);
    this.currentLookAt.set(this.sim.playerX, this.sim.playerY + 1.2, this.sim.playerZ);
    this.camera.lookAt(this.currentLookAt);
  }

  public setTouchControls(moveX: number, moveZ: number, sprint: boolean): void {
    this.touchMoveX = moveX;
    this.touchMoveZ = moveZ;
    this.touchSprint = sprint;
  }

  public triggerAction(): void {
    this.pendingAction = true;
  }

  public triggerSecondaryAction(): void {
    this.pendingSecondary = true;
  }

  public triggerCall(): void {
    this.pendingCall = true;
  }

  public setRangerTool(tool: RangerToolId): void {
    this.sim.setEquippedTool(tool);
    this.callbacks.onSnapshot(this.sim.getSnapshot());
  }

  public toggleOpticZoom(): void {
    if (this.sim.mode === 'ranger_patrol') {
      this.sim.toggleBinocularsZoom();
    } else if (this.sim.mode === 'photo_safari') {
      this.sim.toggleTelephotoZoom();
    }
    this.callbacks.onSnapshot(this.sim.getSnapshot());
  }

  public rebuildPlayerModel(skin?: SkinSpec): void {
    if (skin) this.activeSkin = skin;
    this.scene.remove(this.playerRig.root);
    this.playerRig = buildCharacterRig(
      this.sim.animalId,
      this.mats.snowLeopardFur,
      this.activeSkin,
    );
    const growthMult =
      this.sim.animalId === 'ranger'
        ? 1.0
        : getGrowthStageFromRunXp(this.sim.xpEarned).scaleFactor;
    this.playerRig.root.scale.setScalar(ANIMALS[this.sim.animalId].scale * growthMult);
    this.playerRig.root.position.set(this.sim.playerX, this.sim.playerY, this.sim.playerZ);
    this.playerRig.root.rotation.y = this.sim.playerHeading;
    this.scene.add(this.playerRig.root);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.heldKeys[e.code] = true;
    if (e.code === 'Space' && !e.repeat) {
      this.pendingAction = true;
    }
    if ((e.code === 'KeyF' || e.code === 'KeyV') && !e.repeat) {
      this.pendingSecondary = true;
    }
    if ((e.code === 'KeyE' || e.code === 'KeyC') && !e.repeat) {
      this.pendingCall = true;
    }
    if (this.sim.mode === 'ranger_patrol' && this.sim.phase === 'playing' && !e.repeat) {
      if (e.code === 'Digit1') {
        this.setRangerTool('binoculars');
      } else if (e.code === 'Digit2') {
        this.setRangerTool('camera');
      } else if (e.code === 'Digit3') {
        this.setRangerTool('dart');
      } else if (e.code === 'Tab') {
        e.preventDefault();
        const order: RangerToolId[] = ['binoculars', 'camera', 'dart'];
        const next = order[(order.indexOf(this.sim.equippedTool) + 1) % order.length];
        this.setRangerTool(next);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys[e.code] = false;
  };

  private onBlur = () => {
    this.heldKeys = {};
    this.touchMoveX = 0;
    this.touchMoveZ = 0;
    this.touchSprint = false;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.flythroughMode) return;
    this.isDragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.isDragging || this.flythroughMode) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.cameraYaw -= dx * 0.0055;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.004, 0.06, 0.88);
  };

  private onPointerUp = () => {
    this.isDragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (this.flythroughMode) return;
    this.cameraDist = THREE.MathUtils.clamp(this.cameraDist + e.deltaY * 0.006, 5.5, 22);
  };

  private onResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private unbindEvents(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('wheel', this.onWheel);
  }

  private gatherInput(): SimInput {
    let moveX = this.touchMoveX;
    let moveZ = this.touchMoveZ;

    if (this.heldKeys['KeyW'] || this.heldKeys['ArrowUp']) moveZ += 1;
    if (this.heldKeys['KeyS'] || this.heldKeys['ArrowDown']) moveZ -= 1;
    if (this.heldKeys['KeyD'] || this.heldKeys['ArrowRight']) moveX -= 1;
    if (this.heldKeys['KeyA'] || this.heldKeys['ArrowLeft']) moveX += 1;

    if (this.heldKeys['KeyQ']) this.cameraYaw += 0.032;

    const sprint =
      this.touchSprint || Boolean(this.heldKeys['ShiftLeft'] || this.heldKeys['ShiftRight']);
    const actionPressed = this.pendingAction;
    const secondaryPressed = this.pendingSecondary;
    const callPressed = this.pendingCall;
    this.pendingAction = false;
    this.pendingSecondary = false;
    this.pendingCall = false;

    return {
      moveX: THREE.MathUtils.clamp(moveX, -1, 1),
      moveZ: THREE.MathUtils.clamp(moveZ, -1, 1),
      cameraYaw: this.cameraYaw,
      sprint,
      actionPressed,
      secondaryPressed,
      callPressed,
    };
  }

  private syncVisuals(dt: number): void {
    this.animPhase += dt;
    this.mats.updateWaterTime(this.animPhase);

    // Sync Player position, growth scale & hurt flash
    const growthMult =
      this.sim.animalId === 'ranger'
        ? 1.0
        : getGrowthStageFromRunXp(this.sim.xpEarned).scaleFactor;
    const targetScale = ANIMALS[this.sim.animalId].scale * growthMult;
    const currentScale = this.playerRig.root.scale.x;
    this.playerRig.root.scale.setScalar(
      THREE.MathUtils.lerp(currentScale, targetScale, Math.min(1, 5 * dt)),
    );

    this.playerRig.root.position.set(this.sim.playerX, this.sim.playerY, this.sim.playerZ);
    this.playerRig.root.rotation.y = this.sim.playerHeading;
    setRigHurtFlash(this.playerRig, this.sim.playerHurtTimer > 0);
    animateActorRig(
      this.playerRig,
      this.sim.playerGait,
      this.animPhase,
      this.sim.animalId === 'ranger',
      false,
      this.sim.animalId,
      this.sim.secondaryActiveTimer > 0,
    );

    // Sync Co-op Teammates
    for (const entry of this.peerRigs.values()) {
      const p = entry.state;
      _v1.set(p.x, p.y, p.z);
      entry.rig.root.position.lerp(_v1, Math.min(1, 12 * dt));
      entry.rig.root.rotation.y = p.heading;
      animateActorRig(
        entry.rig,
        p.gait,
        this.animPhase,
        p.animalId === 'ranger',
        false,
        p.animalId,
        false,
      );
    }

    this.keyLight.position.set(this.sim.playerX + 48, 76, this.sim.playerZ + 40);
    this.keyLight.target.position.set(this.sim.playerX, this.sim.playerY, this.sim.playerZ);

    for (const npc of this.sim.layout.npcs) {
      const entry = this.npcRigs.get(npc.id);
      if (!entry) continue;
      entry.rig.root.position.set(npc.x, npc.y, npc.z);
      entry.rig.root.rotation.y = npc.heading;
      if (entry.cage) {
        entry.cage.visible = npc.aiState !== 'rescued';
      }
      if (entry.rig.dangerRing) {
        entry.rig.dangerRing.visible = npc.aiState === 'aiming';
      }
      if (npc.kind === 'poacher' && npc.aiState === 'arrested') {
        entry.rig.root.visible = false;
      } else {
        animateActorRig(
          entry.rig,
          npc.gait,
          this.animPhase + npc.zigZagPhase * 0.2,
          npc.kind === 'poacher' || npc.kind === 'shikari',
          npc.aiState === 'sedated' || npc.aiState === 'stunned',
          npc.species,
          false,
        );
      }
    }

    for (const item of this.sim.layout.items) {
      const obj = this.itemMeshes.get(item.id);
      if (!obj) continue;
      obj.visible = !item.collected;
      if (!item.collected && item.kind === 'orb') {
        obj.rotation.y += dt * 1.8;
        obj.position.y = item.y + 0.35 + Math.sin(this.animPhase * 2.6 + item.x) * 0.18;
      }
    }

    const activeIds = new Set<string>();
    for (const d of this.sim.darts) {
      activeIds.add(d.id);
      let mesh = this.dartMeshes.get(d.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 0.42, 6),
          new THREE.MeshStandardMaterial({ color: '#4de3b2', emissive: '#1fa37b' }),
        );
        mesh.rotation.x = Math.PI / 2;
        this.scene.add(mesh);
        this.dartMeshes.set(d.id, mesh);
      }
      mesh.position.set(d.x, d.y, d.z);
    }
    for (const [id, mesh] of this.dartMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.dartMeshes.delete(id);
      }
    }

    const activeShotIds = new Set<string>();
    for (const s of this.sim.shikariShots) {
      activeShotIds.add(s.id);
      let mesh = this.shikariShotMeshes.get(s.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 8, 8),
          new THREE.MeshStandardMaterial({
            color: '#fb7185',
            emissive: '#ef4444',
            emissiveIntensity: 1.6,
          }),
        );
        this.scene.add(mesh);
        this.shikariShotMeshes.set(s.id, mesh);
      }
      mesh.position.set(s.x, s.y, s.z);
    }
    for (const [id, mesh] of this.shikariShotMeshes) {
      if (!activeShotIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.shikariShotMeshes.delete(id);
      }
    }

    if (this.weatherPoints) {
      const pos = this.weatherPoints.geometry.attributes.position as THREE.BufferAttribute;
      const fallSpeed =
        this.sim.weather === 'rain' ? 18 : this.sim.weather === 'snow' ? 3.2 : 0.7;
      const driftX = this.sim.weather === 'dust' ? 6.5 : 1.4;
      for (let i = 0; i < pos.count; i++) {
        let px = pos.getX(i) + driftX * dt;
        let py = pos.getY(i) - fallSpeed * dt;
        let pz = pos.getZ(i);
        if (py < 0) {
          py = 34;
          px = this.sim.playerX + (Math.random() - 0.5) * 140;
          pz = this.sim.playerZ + (Math.random() - 0.5) * 140;
        }
        pos.setXYZ(i, px, py, pz);
      }
      pos.needsUpdate = true;
    }
  }

  private updateCamera(dt: number): void {
    if (this.flythroughMode) {
      const t = this.animPhase * 0.1;
      const radius = 145;
      this.camera.position.set(
        Math.cos(t) * radius,
        28 + Math.sin(t * 1.7) * 6.0,
        Math.sin(t) * radius,
      );
      _v1.set(Math.cos(t + 0.45) * 32, 6.5, Math.sin(t + 0.45) * 32);
      this.camera.lookAt(_v1);
      return;
    }

    const isBinocularsScope =
      this.sim.mode === 'ranger_patrol' &&
      this.sim.equippedTool === 'binoculars' &&
      this.sim.binocularsZoomed;
    const isRangerCam =
      this.sim.mode === 'ranger_patrol' && this.sim.equippedTool === 'camera';
    const isTelephoto =
      this.sim.mode === 'photo_safari' && this.sim.telephotoZoomed;

    const targetFov = isBinocularsScope ? 24 : isTelephoto ? 30 : isRangerCam ? 42 : 58;
    if (Math.abs(this.camera.fov - targetFov) > 0.08) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, 9 * dt));
      this.camera.updateProjectionMatrix();
    }

    const eyeScope = isBinocularsScope || isTelephoto;
    this.playerRig.root.visible = !this.flythroughMode && !eyeScope;

    if (!this.isDragging && this.sim.playerSpeed > 1.2) {
      const diff = Math.atan2(
        Math.sin(this.sim.playerHeading - this.cameraYaw),
        Math.cos(this.sim.playerHeading - this.cameraYaw),
      );
      this.cameraYaw += diff * Math.min(1, 2.2 * dt);
    }

    const dampFactor = 1 - Math.exp(-10 * dt);

    if (eyeScope) {
      this.targetCamPos.set(
        this.sim.playerX + Math.sin(this.cameraYaw) * 0.4,
        this.sim.playerY + 1.85,
        this.sim.playerZ + Math.cos(this.cameraYaw) * 0.4,
      );
      this.camera.position.lerp(this.targetCamPos, dampFactor);
      const pitchOffset = (0.28 - this.cameraPitch) * 26;
      this.targetLookAt.set(
        this.sim.playerX + Math.sin(this.cameraYaw) * 32,
        this.sim.playerY + 1.85 + pitchOffset,
        this.sim.playerZ + Math.cos(this.cameraYaw) * 32,
      );
      this.currentLookAt.lerp(this.targetLookAt, dampFactor);
      this.camera.lookAt(this.currentLookAt);
      return;
    }

    const activeDist = isRangerCam ? Math.min(this.cameraDist, 6.2) : this.cameraDist;
    const horizDist = Math.cos(this.cameraPitch) * activeDist;
    const vertOffset = Math.sin(this.cameraPitch) * activeDist + 1.8;

    this.targetCamPos.set(
      this.sim.playerX - Math.sin(this.cameraYaw) * horizDist,
      this.sim.playerY + vertOffset,
      this.sim.playerZ - Math.cos(this.cameraYaw) * horizDist,
    );

    const camGround = getTerrainHeight(
      this.targetCamPos.x,
      this.targetCamPos.z,
      this.sim.layout.terrain,
    );
    if (this.targetCamPos.y < camGround + 1.4) {
      this.targetCamPos.y = camGround + 1.4;
    }

    this.camera.position.lerp(this.targetCamPos, dampFactor);

    const lookAhead =
      this.sim.mode === 'photo_safari' || isRangerCam ? 6.0 : 2.2;
    this.targetLookAt.set(
      this.sim.playerX + Math.sin(this.cameraYaw) * lookAhead,
      this.sim.playerY + (this.sim.mode === 'photo_safari' || isRangerCam ? 1.55 : 1.15),
      this.sim.playerZ + Math.cos(this.cameraYaw) * lookAhead,
    );
    this.currentLookAt.lerp(this.targetLookAt, dampFactor);
    this.camera.lookAt(this.currentLookAt);
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    if (!this.flythroughMode) {
      const input = this.gatherInput();
      this.sim.step(dt, input);
      const events = this.sim.consumeEvents();
      if (events.length > 0) this.callbacks.onEvents(events);
      this.snapshotTimer += dt;
      if (this.snapshotTimer >= 0.08 || events.length > 0) {
        this.snapshotTimer = 0;
        this.callbacks.onSnapshot(this.sim.getSnapshot());
      }
    } else {
      for (const npc of this.sim.layout.npcs) {
        npc.x += Math.sin(npc.heading) * 1.8 * dt;
        npc.z += Math.cos(npc.heading) * 1.8 * dt;
        if (Math.hypot(npc.x, npc.z) > 105) npc.heading += Math.PI * 0.5;
        npc.y =
          npc.species === 'river_fish'
            ? WATER_LEVEL - 0.15
            : getTerrainHeight(npc.x, npc.z, this.sim.layout.terrain);
      }
    }

    this.syncVisuals(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private startLoop(): void {
    this.clock.start();
    if (this.isSoftwareGl) {
      this.tick();
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  public getCameraYaw(): number {
    return this.cameraYaw;
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
    this.unbindEvents();
    this.mats.dispose();
    this.envRT.dispose();
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material?.dispose();
      }
    });
    this.renderer.dispose();
  }
}
