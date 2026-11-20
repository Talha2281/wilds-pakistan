import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimalId, GaitState, NpcSpeciesId, SkinSpec } from '../types/game';
import {
  createFibrousCoatTexture,
  createSoftShadowTexture,
  createSpottedFurTexture,
} from './materials';

export interface RigHandles {
  root: THREE.Group;
  body: THREE.Object3D;
  head?: THREE.Object3D;
  tail?: THREE.Object3D;
  legs: THREE.Object3D[];
  lowerLegs?: THREE.Object3D[];
  arms?: THREE.Object3D[];
  flippers?: THREE.Object3D[];
  dangerRing?: THREE.Mesh;
  baseBodyY?: number;
  isCustomGlb?: boolean;
}

class CustomGlbStore {
  private templates: Partial<Record<AnimalId, THREE.Group>> = {};
  private loader = new GLTFLoader();

  public hasCustomModel(id: AnimalId): boolean {
    return Boolean(this.templates[id]);
  }

  public getLoadedNames(): AnimalId[] {
    return Object.keys(this.templates) as AnimalId[];
  }

  public async loadFromFile(id: AnimalId, file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      this.loader.parse(buffer, '', resolve, reject);
    });
    const model = gltf.scene;
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const normScale = 2.0 / maxDim;

    const wrapper = new THREE.Group();
    model.scale.setScalar(normScale);
    model.position.set(
      -center.x * normScale,
      -box.min.y * normScale,
      -center.z * normScale,
    );
    wrapper.add(model);
    this.templates[id] = wrapper;
  }

  public clearModel(id: AnimalId): void {
    delete this.templates[id];
  }

  public cloneIfPresent(id: AnimalId): THREE.Group | null {
    const tpl = this.templates[id];
    return tpl ? tpl.clone(true) : null;
  }
}

export const customGlbStore = new CustomGlbStore();

let sharedShadowTex: THREE.CanvasTexture | null = null;
function addContactShadow(group: THREE.Group, radius = 0.95): void {
  if (!sharedShadowTex) sharedShadowTex = createSoftShadowTexture();
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2.2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: sharedShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.68,
  });
  const shadow = new THREE.Mesh(geo, mat);
  shadow.position.y = 0.03;
  group.add(shadow);
}

function makeOrganicMat(
  color: string | number,
  roughness = 0.72,
  metalness = 0.03,
  map?: THREE.Texture,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: map ? '#ffffff' : color,
    map: map ?? null,
    roughness,
    metalness,
    flatShading: false,
  });
}

function addEyes(
  head: THREE.Group,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  radius: number,
  irisColor: string,
): void {
  const irisMat = makeOrganicMat(irisColor, 0.16, 0.16);
  const pupilMat = makeOrganicMat('#0b0d0f', 0.08, 0.25);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), irisMat);
    eye.position.set(side * eyeX, eyeY, eyeZ);
    head.add(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.56, 8, 6), pupilMat);
    pupil.position.set(side * eyeX + side * radius * 0.15, eyeY, eyeZ + radius * 0.65);
    head.add(pupil);
  }
}

function makeArticulatedLimb(params: {
  topR: number;
  midR: number;
  botR: number;
  upperLen: number;
  lowerLen: number;
  mat: THREE.Material;
  lowerMat?: THREE.Material;
  pawMat: THREE.Material;
  hoofStyle?: boolean;
  kneePatchMat?: THREE.Material;
}): { upper: THREE.Group; knee: THREE.Group } {
  const {
    topR,
    midR,
    botR,
    upperLen,
    lowerLen,
    mat,
    lowerMat,
    pawMat,
    hoofStyle = false,
    kneePatchMat,
  } = params;

  const upper = new THREE.Group();

  const joint = new THREE.Mesh(new THREE.SphereGeometry(topR * 1.05, 10, 8), mat);
  joint.castShadow = true;
  upper.add(joint);

  const thigh = new THREE.Mesh(
    new THREE.CylinderGeometry(topR, midR, upperLen, 10),
    mat,
  );
  thigh.position.y = -upperLen * 0.5;
  thigh.castShadow = true;
  upper.add(thigh);

  const knee = new THREE.Group();
  knee.position.y = -upperLen;
  upper.add(knee);

  const kneeCap = new THREE.Mesh(
    new THREE.SphereGeometry(midR * 1.08, 9, 7),
    kneePatchMat ?? lowerMat ?? mat,
  );
  knee.add(kneeCap);

  const shin = new THREE.Mesh(
    new THREE.CylinderGeometry(midR, botR, lowerLen, 10),
    lowerMat ?? mat,
  );
  shin.position.y = -lowerLen * 0.5;
  shin.castShadow = true;
  knee.add(shin);

  if (hoofStyle) {
    const hoof = new THREE.Mesh(
      new THREE.CylinderGeometry(botR * 1.05, botR * 1.35, lowerLen * 0.24, 9),
      pawMat,
    );
    hoof.position.set(0, -lowerLen * 0.94, botR * 0.22);
    hoof.castShadow = true;
    knee.add(hoof);
  } else {
    const paw = new THREE.Mesh(new THREE.SphereGeometry(botR * 1.5, 10, 8), pawMat);
    paw.scale.set(1.06, 0.55, 1.48);
    paw.position.set(0, -lowerLen * 0.94, botR * 0.52);
    paw.castShadow = true;
    knee.add(paw);
  }

  return { upper, knee };
}

function buildLatheTorso(
  radii: Array<[number, number]>,
  segments = 16,
  scaleX = 1.0,
): THREE.BufferGeometry {
  const pts = radii.map(([r, z]) => new THREE.Vector2(r, z));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.rotateX(Math.PI / 2);
  if (scaleX !== 1.0) geo.scale(scaleX, 1.0, 1.0);
  geo.computeVertexNormals();
  return geo;
}

export function setRigHurtFlash(rig: RigHandles, hurt: boolean): void {
  rig.root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && 'emissive' in mat) {
      if (hurt) {
        mat.emissive.setHex(0xdc2626);
        mat.emissiveIntensity = 0.55;
      } else if (mat.emissiveIntensity === 0.55) {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  });
}

export function buildCoopNameBadge(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.75)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(12, 10, 232, 44, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ecfdf5';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 16), 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.3, 0.58, 1);
  sprite.position.set(0, 2.35, 0);
  return sprite;
}

export function buildCharacterRig(
  id: AnimalId,
  snowLeopardMat?: THREE.Material,
  skin?: SkinSpec,
): RigHandles {
  const custom = customGlbStore.cloneIfPresent(id);
  if (custom) {
    const root = new THREE.Group();
    root.add(custom);
    addContactShadow(root, 1.0);
    return {
      root,
      body: custom,
      legs: [],
      isCustomGlb: true,
    };
  }

  if (id === 'snow_leopard') return buildSnowLeopardRig(snowLeopardMat, skin);
  if (id === 'markhor') return buildMarkhorRig(skin);
  if (id === 'brown_bear') return buildBrownBearRig(skin);
  if (id === 'indus_dolphin') return buildIndusDolphinRig(skin);
  return buildRangerRig(skin);
}

function buildSnowLeopardRig(furOverride?: THREE.Material, skin?: SkinSpec): RigHandles {
  const root = new THREE.Group();
  const baseBodyY = 0.72;
  const body = new THREE.Group();
  body.position.y = baseBodyY;
  root.add(body);

  const primaryHex = skin?.primaryColor ?? '#dcded8';
  const secondaryHex = skin?.secondaryColor ?? '#4a5057';
  const accentHex = skin?.accentColor ?? '#f0f1ec';

  const furMat =
    skin && skin.id !== 'sl_karakoram'
      ? makeOrganicMat('#ffffff', 0.74, 0.03, createSpottedFurTexture(undefined, primaryHex, secondaryHex))
      : furOverride ?? makeOrganicMat('#ffffff', 0.74, 0.03, createSpottedFurTexture());
  const darkSpotMat = makeOrganicMat(secondaryHex, 0.68, 0.05);
  const bellyMat = makeOrganicMat(accentHex, 0.85, 0.02);
  const noseMat = makeOrganicMat('#8a6266', 0.35, 0.08);

  const torsoGeo = buildLatheTorso(
    [
      [0.01, -0.8],
      [0.23, -0.64],
      [0.3, -0.36],
      [0.26, -0.04],
      [0.33, 0.35],
      [0.27, 0.62],
      [0.01, 0.76],
    ],
    16,
    0.9,
  );
  const torso = new THREE.Mesh(torsoGeo, furMat);
  torso.castShadow = true;
  body.add(torso);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), bellyMat);
  chest.scale.set(0.88, 0.92, 1.15);
  chest.position.set(0, -0.06, 0.48);
  body.add(chest);

  const head = new THREE.Group();
  head.position.set(0, 0.22, 0.76);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.38, 12), furMat);
  neck.rotation.x = 0.72;
  neck.position.set(0, -0.1, -0.14);
  neck.castShadow = true;
  head.add(neck);

  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), furMat);
  cranium.scale.set(1.04, 0.92, 1.12);
  cranium.castShadow = true;
  head.add(cranium);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), bellyMat);
  muzzle.scale.set(1.05, 0.78, 1.2);
  muzzle.position.set(0, -0.05, 0.22);
  head.add(muzzle);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6), noseMat);
  nose.scale.set(1.2, 0.85, 0.8);
  nose.position.set(0, -0.01, 0.34);
  head.add(nose);

  addEyes(head, 0.115, 0.055, 0.19, 0.036, '#7cb89a');

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), darkSpotMat);
    ear.scale.set(0.8, 1.05, 0.45);
    ear.position.set(side * 0.15, 0.2, -0.02);
    ear.rotation.z = side * -0.25;
    head.add(ear);

    const innerEar = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bellyMat);
    innerEar.scale.set(0.75, 0.9, 0.3);
    innerEar.position.set(side * 0.145, 0.19, 0.01);
    head.add(innerEar);

    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.092, 8, 6), bellyMat);
    cheek.scale.set(0.95, 0.7, 0.85);
    cheek.position.set(side * 0.14, -0.06, 0.09);
    head.add(cheek);
  }
  body.add(head);

  const tail = new THREE.Group();
  tail.position.set(0, 0.08, -0.66);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.14, -0.35),
    new THREE.Vector3(0, -0.18, -0.74),
    new THREE.Vector3(0, 0.02, -1.06),
  ]);
  const tailGeo = new THREE.TubeGeometry(tailCurve, 18, 0.075, 10, false);
  const tailMesh = new THREE.Mesh(tailGeo, furMat);
  tailMesh.castShadow = true;
  tail.add(tailMesh);
  const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.078, 10, 8), darkSpotMat);
  tailTip.position.set(0, 0.02, -1.06);
  tail.add(tailTip);
  body.add(tail);

  const legPositions: Array<[number, number, number]> = [
    [-0.19, -0.06, 0.46],
    [0.19, -0.06, 0.46],
    [-0.2, -0.06, -0.46],
    [0.2, -0.06, -0.46],
  ];
  const legs: THREE.Object3D[] = [];
  const lowerLegs: THREE.Object3D[] = [];
  for (const [x, y, z] of legPositions) {
    const { upper, knee } = makeArticulatedLimb({
      topR: 0.108,
      midR: 0.076,
      botR: 0.064,
      upperLen: 0.34,
      lowerLen: 0.32,
      mat: furMat,
      pawMat: darkSpotMat,
    });
    upper.position.set(x, y, z);
    body.add(upper);
    legs.push(upper);
    lowerLegs.push(knee);
  }

  addContactShadow(root, 0.95);
  return { root, body, head, tail, legs, lowerLegs, baseBodyY };
}

function buildMarkhorRig(skin?: SkinSpec): RigHandles {
  const root = new THREE.Group();
  const baseBodyY = 0.78;
  const body = new THREE.Group();
  body.position.y = baseBodyY;
  root.add(body);

  const primaryHex = skin?.primaryColor ?? '#8d623d';
  const secondaryHex = skin?.secondaryColor ?? '#3b2515';
  const accentHex = skin?.accentColor ?? '#f0e5d2';

  const coatTex = createFibrousCoatTexture(primaryHex, secondaryHex, accentHex, 1400);
  const coatMat = makeOrganicMat('#ffffff', 0.82, 0.02, coatTex);
  const maneMat = makeOrganicMat(secondaryHex, 0.88, 0.02);
  const muzzleMat = makeOrganicMat(accentHex, 0.68, 0.02);
  const hornMat = makeOrganicMat('#786856', 0.4, 0.12);
  const darkLegMat = makeOrganicMat('#261f1a', 0.55, 0.06);

  const torsoGeo = buildLatheTorso(
    [
      [0.01, -0.75],
      [0.23, -0.58],
      [0.29, -0.25],
      [0.27, 0.12],
      [0.33, 0.45],
      [0.24, 0.66],
      [0.01, 0.75],
    ],
    16,
    0.86,
  );
  const torso = new THREE.Mesh(torsoGeo, coatMat);
  torso.castShadow = true;
  body.add(torso);

  const dorsalMane = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), maneMat);
  dorsalMane.scale.set(0.62, 0.56, 2.3);
  dorsalMane.position.set(0, 0.25, 0.2);
  body.add(dorsalMane);

  const chestRuff = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.64, 12), maneMat);
  chestRuff.rotation.x = Math.PI * 0.92;
  chestRuff.scale.set(0.85, 1.0, 0.94);
  chestRuff.position.set(0, -0.14, 0.54);
  chestRuff.castShadow = true;
  body.add(chestRuff);

  const head = new THREE.Group();
  head.position.set(0, 0.44, 0.65);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.52, 12), maneMat);
  neck.rotation.x = -0.36;
  neck.position.set(0, -0.22, -0.09);
  neck.castShadow = true;
  head.add(neck);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), coatMat);
  skull.scale.set(0.82, 0.88, 1.25);
  skull.position.set(0, 0.04, 0.07);
  skull.castShadow = true;
  head.add(skull);

  const creamMuzzle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), muzzleMat);
  creamMuzzle.scale.set(0.82, 0.72, 1.15);
  creamMuzzle.position.set(0, -0.02, 0.25);
  head.add(creamMuzzle);

  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), darkLegMat);
  noseTip.position.set(0, 0.01, 0.37);
  head.add(noseTip);

  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.088, 0.36, 10), maneMat);
  beard.rotation.x = Math.PI * 0.88;
  beard.position.set(0, -0.21, 0.21);
  head.add(beard);

  addEyes(head, 0.115, 0.07, 0.13, 0.032, '#d4a33b');

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.19, 8), coatMat);
    ear.rotation.z = side * -1.25;
    ear.position.set(side * 0.2, 0.08, 0.02);
    head.add(ear);
  }

  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const archAngle = t * Math.PI * 1.3;
      const spiral = Math.sin(t * Math.PI * 3.2) * 0.06 * t;
      const x = side * (0.07 + Math.sin(archAngle * 0.85) * 0.56 + t * 0.11 + spiral);
      const y = 0.14 + Math.sin(archAngle) * 0.48 - Math.pow(t, 2.2) * 0.24;
      const z = 0.02 - t * 0.25 + Math.cos(t * Math.PI * 3.2) * 0.055;
      pts.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const hornGeo = new THREE.TubeGeometry(curve, 24, 0.056, 8, false);
    const horn = new THREE.Mesh(hornGeo, hornMat);
    horn.castShadow = true;
    head.add(horn);
  }
  body.add(head);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 8), maneMat);
  tail.rotation.x = -0.55;
  tail.position.set(0, 0.15, -0.68);
  body.add(tail);

  const legCoords: Array<[number, number, number]> = [
    [-0.18, -0.1, 0.44],
    [0.18, -0.1, 0.44],
    [-0.19, -0.1, -0.44],
    [0.19, -0.1, -0.44],
  ];
  const legs: THREE.Object3D[] = [];
  const lowerLegs: THREE.Object3D[] = [];
  for (const [x, y, z] of legCoords) {
    const { upper, knee } = makeArticulatedLimb({
      topR: 0.09,
      midR: 0.06,
      botR: 0.044,
      upperLen: 0.34,
      lowerLen: 0.34,
      mat: coatMat,
      lowerMat: darkLegMat,
      pawMat: darkLegMat,
      hoofStyle: true,
      kneePatchMat: muzzleMat,
    });
    upper.position.set(x, y, z);
    body.add(upper);
    legs.push(upper);
    lowerLegs.push(knee);
  }

  addContactShadow(root, 0.9);
  return { root, body, head, tail, legs, lowerLegs, baseBodyY };
}

function buildBrownBearRig(skin?: SkinSpec): RigHandles {
  const root = new THREE.Group();
  const baseBodyY = 0.86;
  const body = new THREE.Group();
  body.position.y = baseBodyY;
  root.add(body);

  const primaryHex = skin?.primaryColor ?? '#764f33';
  const secondaryHex = skin?.secondaryColor ?? '#5e3d25';
  const accentHex = skin?.accentColor ?? '#b88e65';

  const bearTex = createFibrousCoatTexture(primaryHex, secondaryHex, accentHex, 1500);
  const furMat = makeOrganicMat('#ffffff', 0.86, 0.02, bearTex);
  const humpMat = makeOrganicMat(secondaryHex, 0.88, 0.02);
  const muzzleMat = makeOrganicMat(accentHex, 0.68, 0.03);
  const clawMat = makeOrganicMat('#241b15', 0.4, 0.12);

  const torsoGeo = buildLatheTorso(
    [
      [0.01, -0.96],
      [0.42, -0.75],
      [0.54, -0.35],
      [0.52, 0.12],
      [0.56, 0.48],
      [0.4, 0.78],
      [0.01, 0.9],
    ],
    16,
    0.92,
  );
  const torso = new THREE.Mesh(torsoGeo, furMat);
  torso.castShadow = true;
  body.add(torso);

  const hump = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), humpMat);
  hump.scale.set(1.0, 0.78, 1.12);
  hump.position.set(0, 0.34, 0.38);
  hump.castShadow = true;
  body.add(hump);

  const head = new THREE.Group();
  head.position.set(0, 0.24, 0.94);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), furMat);
  skull.scale.set(1.02, 0.94, 1.05);
  skull.castShadow = true;
  head.add(skull);

  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.3, 12), muzzleMat);
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.06, 0.32);
  head.add(snout);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), clawMat);
  nose.scale.set(1.2, 0.85, 0.85);
  nose.position.set(0, -0.02, 0.47);
  head.add(nose);

  addEyes(head, 0.145, 0.08, 0.25, 0.036, '#3b2416');

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), humpMat);
    ear.scale.set(1.0, 1.0, 0.55);
    ear.position.set(side * 0.24, 0.27, -0.02);
    head.add(ear);

    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), muzzleMat);
    inner.scale.set(0.9, 0.9, 0.35);
    inner.position.set(side * 0.24, 0.27, 0.01);
    head.add(inner);
  }
  body.add(head);

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), humpMat);
  tail.position.set(0, 0.14, -0.92);
  body.add(tail);

  const legCoords: Array<[number, number, number]> = [
    [-0.31, -0.14, 0.48],
    [0.31, -0.14, 0.48],
    [-0.33, -0.14, -0.48],
    [0.33, -0.14, -0.48],
  ];
  const legs: THREE.Object3D[] = [];
  const lowerLegs: THREE.Object3D[] = [];
  for (const [x, y, z] of legCoords) {
    const { upper, knee } = makeArticulatedLimb({
      topR: 0.178,
      midR: 0.142,
      botR: 0.116,
      upperLen: 0.38,
      lowerLen: 0.34,
      mat: furMat,
      pawMat: clawMat,
    });
    upper.position.set(x, y, z);
    body.add(upper);
    legs.push(upper);
    lowerLegs.push(knee);
  }

  addContactShadow(root, 1.2);
  return { root, body, head, tail, legs, lowerLegs, baseBodyY };
}

function buildIndusDolphinRig(skin?: SkinSpec): RigHandles {
  const root = new THREE.Group();
  const baseBodyY = 0.38;
  const body = new THREE.Group();
  body.position.y = baseBodyY;
  root.add(body);

  const primaryHex = skin?.primaryColor ?? '#917c85';
  const finHex = skin?.secondaryColor ?? '#63525b';
  const bellyHex = skin?.accentColor ?? '#c7b1b8';

  const skinTex = createFibrousCoatTexture(primaryHex, finHex, bellyHex, 240);
  const skinMat = makeOrganicMat('#ffffff', 0.24, 0.14, skinTex);
  const bellyMat = makeOrganicMat(bellyHex, 0.28, 0.08);
  const finMat = makeOrganicMat(finHex, 0.32, 0.1);

  const hullGeo = buildLatheTorso(
    [
      [0.01, -1.04],
      [0.08, -0.82],
      [0.19, -0.48],
      [0.33, -0.08],
      [0.36, 0.28],
      [0.27, 0.62],
      [0.12, 0.84],
      [0.01, 0.92],
    ],
    16,
    0.9,
  );
  const hull = new THREE.Mesh(hullGeo, skinMat);
  hull.castShadow = true;
  body.add(hull);

  const melon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), bellyMat);
  melon.scale.set(0.92, 0.9, 1.15);
  melon.position.set(0, 0.08, 0.66);
  body.add(melon);

  const blowhole = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 8, 6),
    makeOrganicMat('#362c32', 0.25, 0.1),
  );
  blowhole.scale.set(1.3, 0.4, 0.8);
  blowhole.position.set(0, 0.27, 0.56);
  body.add(blowhole);

  const beak = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.072, 0.62, 10), bellyMat);
  beak.rotation.x = Math.PI / 2 - 0.06;
  beak.position.set(0, -0.02, 1.08);
  beak.castShadow = true;
  body.add(beak);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 8), finMat);
  dorsal.rotation.x = -0.52;
  dorsal.scale.set(0.35, 1.0, 1.6);
  dorsal.position.set(0, 0.35, -0.08);
  body.add(dorsal);

  const flippers: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const flipperShape = new THREE.Shape();
    flipperShape.moveTo(0, 0);
    flipperShape.quadraticCurveTo(0.28, -0.08, 0.44, -0.22);
    flipperShape.quadraticCurveTo(0.3, -0.34, 0.06, -0.24);
    flipperShape.closePath();
    const flGeo = new THREE.ExtrudeGeometry(flipperShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 2,
    });
    flGeo.rotateX(Math.PI / 2);
    const fl = new THREE.Mesh(flGeo, finMat);
    fl.position.set(side * 0.25, -0.1, 0.28);
    if (side === -1) fl.scale.x = -1;
    fl.rotation.z = side * -0.28;
    body.add(fl);
    flippers.push(fl);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.94);
  const flukeShape = new THREE.Shape();
  flukeShape.moveTo(0, 0.14);
  flukeShape.quadraticCurveTo(0.35, 0.04, 0.44, -0.18);
  flukeShape.quadraticCurveTo(0.16, -0.08, 0, -0.04);
  flukeShape.quadraticCurveTo(-0.16, -0.08, -0.44, -0.18);
  flukeShape.quadraticCurveTo(-0.35, 0.04, 0, 0.14);
  const flukeGeo = new THREE.ExtrudeGeometry(flukeShape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  flukeGeo.rotateX(Math.PI / 2);
  const fluke = new THREE.Mesh(flukeGeo, finMat);
  tail.add(fluke);
  body.add(tail);

  return { root, body, tail, flippers, legs: [], baseBodyY };
}

function buildRangerRig(skin?: SkinSpec): RigHandles {
  const root = new THREE.Group();
  const baseBodyY = 0.85;
  const body = new THREE.Group();
  body.position.y = baseBodyY;
  root.add(body);

  const uniformMat = makeOrganicMat(skin?.primaryColor ?? '#3f5e3a', 0.76, 0.04);
  const vestMat = makeOrganicMat(skin?.accentColor ?? '#c99d4f', 0.66, 0.1);
  const skinMat = makeOrganicMat('#c48c64', 0.62, 0.02);
  const bootMat = makeOrganicMat('#2b241d', 0.55, 0.12);
  const hatMat = makeOrganicMat(skin?.secondaryColor ?? '#544633', 0.8, 0.04);
  const metalMat = makeOrganicMat('#3a434a', 0.28, 0.72);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.36, 6, 12), uniformMat);
  torso.scale.set(1.12, 1.0, 0.72);
  torso.position.y = 0.28;
  torso.castShadow = true;
  body.add(torso);

  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.4, 12), vestMat);
  vest.scale.set(1.06, 1.0, 0.74);
  vest.position.y = 0.31;
  body.add(vest);

  const pack = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.26, 5, 10), hatMat);
  pack.scale.set(1.2, 1.0, 0.68);
  pack.position.set(0, 0.32, -0.24);
  pack.castShadow = true;
  body.add(pack);

  const head = new THREE.Group();
  head.position.set(0, 0.78, 0);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skinMat);
  face.castShadow = true;
  head.add(face);
  addEyes(head, 0.075, 0.03, 0.16, 0.022, '#2e241b');

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.035, 14), hatMat);
  brim.position.y = 0.13;
  head.add(brim);

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.16, 12), hatMat);
  crown.position.y = 0.22;
  head.add(crown);
  body.add(head);

  const arms: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const { upper } = makeArticulatedLimb({
      topR: 0.075,
      midR: 0.065,
      botR: 0.055,
      upperLen: 0.28,
      lowerLen: 0.24,
      mat: uniformMat,
      pawMat: skinMat,
    });
    upper.position.set(side * 0.33, 0.52, 0);
    body.add(upper);
    arms.push(upper);
  }
  const dartGun = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.56, 8), metalMat);
  dartGun.rotation.x = Math.PI / 2;
  dartGun.position.set(0, -0.44, 0.24);
  arms[1].add(dartGun);

  const left = makeArticulatedLimb({
    topR: 0.095,
    midR: 0.08,
    botR: 0.07,
    upperLen: 0.4,
    lowerLen: 0.38,
    mat: uniformMat,
    pawMat: bootMat,
  });
  left.upper.position.set(-0.15, -0.04, 0);
  body.add(left.upper);

  const right = makeArticulatedLimb({
    topR: 0.095,
    midR: 0.08,
    botR: 0.07,
    upperLen: 0.4,
    lowerLen: 0.38,
    mat: uniformMat,
    pawMat: bootMat,
  });
  right.upper.position.set(0.15, -0.04, 0);
  body.add(right.upper);

  addContactShadow(root, 0.65);
  return {
    root,
    body,
    head,
    arms,
    legs: [left.upper, right.upper],
    lowerLegs: [left.knee, right.knee],
    baseBodyY,
  };
}

export function buildNpcRig(
  kind: 'prey' | 'predator' | 'poacher' | 'shikari' | 'trapped_animal',
  species: NpcSpeciesId,
  snowMat?: THREE.Material,
): RigHandles {
  if (kind === 'poacher' || kind === 'shikari') {
    const isShikari = kind === 'shikari';
    const root = new THREE.Group();
    const baseBodyY = 0.85;
    const body = new THREE.Group();
    body.position.y = baseBodyY;
    root.add(body);

    const jacketMat = makeOrganicMat(isShikari ? '#3d3328' : '#543734', 0.78, 0.04);
    const pantsMat = makeOrganicMat('#2e3033', 0.85, 0.02);
    const skinMat = makeOrganicMat('#b8845e', 0.65, 0.02);
    const capMat = makeOrganicMat(isShikari ? '#c45b28' : '#8c2620', 0.7, 0.05);
    const rifleMat = makeOrganicMat('#222629', 0.32, 0.72);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.35, 6, 12), jacketMat);
    torso.scale.set(1.1, 1.0, 0.72);
    torso.position.y = 0.28;
    torso.castShadow = true;
    body.add(torso);

    const head = new THREE.Group();
    head.position.set(0, 0.77, 0);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 12), skinMat));
    addEyes(head, 0.072, 0.025, 0.16, 0.02, '#1e1b18');

    const turbanCap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), capMat);
    turbanCap.scale.set(1.06, 0.72, 1.08);
    turbanCap.position.y = 0.08;
    head.add(turbanCap);
    body.add(head);

    const arms = [-1, 1].map((side) => {
      const { upper } = makeArticulatedLimb({
        topR: 0.072,
        midR: 0.062,
        botR: 0.052,
        upperLen: 0.27,
        lowerLen: 0.24,
        mat: jacketMat,
        pawMat: skinMat,
      });
      upper.position.set(side * 0.32, 0.52, 0);
      body.add(upper);
      return upper;
    });

    if (isShikari) {
      const rifleStock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.35), makeOrganicMat('#593b22', 0.7, 0.05));
      rifleStock.position.set(0, -0.4, 0.14);
      arms[1].add(rifleStock);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.78, 8), rifleMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, -0.39, 0.48);
      arms[1].add(barrel);
    }

    const legs: THREE.Object3D[] = [];
    const lowerLegs: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const { upper, knee } = makeArticulatedLimb({
        topR: 0.09,
        midR: 0.078,
        botR: 0.068,
        upperLen: 0.4,
        lowerLen: 0.38,
        mat: pantsMat,
        pawMat: makeOrganicMat('#211d1a', 0.6, 0.08),
      });
      upper.position.set(side * 0.14, -0.04, 0);
      body.add(upper);
      legs.push(upper);
      lowerLegs.push(knee);
    }

    let dangerRing: THREE.Mesh | undefined;
    if (isShikari) {
      const ringGeo = new THREE.RingGeometry(1.15, 1.45, 24);
      ringGeo.rotateX(-Math.PI / 2);
      dangerRing = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: '#f43f5e', side: THREE.DoubleSide }),
      );
      dangerRing.position.y = 0.08;
      dangerRing.visible = false;
      root.add(dangerRing);
    }

    addContactShadow(root, 0.62);
    return { root, body, head, arms, legs, lowerLegs, dangerRing, baseBodyY };
  }

  if (species === 'snow_leopard_npc') return buildSnowLeopardRig(snowMat);
  if (species === 'markhor_npc') return buildMarkhorRig();
  if (species === 'brown_bear_npc') return buildBrownBearRig();
  if (species === 'indus_dolphin_npc') return buildIndusDolphinRig();

  if (species === 'river_fish') {
    const root = new THREE.Group();
    const baseBodyY = 0.25;
    const body = new THREE.Group();
    body.position.y = baseBodyY;
    root.add(body);
    const scaleMat = makeOrganicMat('#d9ac52', 0.28, 0.32);
    const finMat = makeOrganicMat('#a35b29', 0.45, 0.1);

    const fishGeo = buildLatheTorso(
      [
        [0.01, -0.45],
        [0.08, -0.28],
        [0.18, 0.02],
        [0.14, 0.28],
        [0.01, 0.44],
      ],
      12,
      0.65,
    );
    const fishBody = new THREE.Mesh(fishGeo, scaleMat);
    body.add(fishBody);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.28, 4), finMat);
    tail.rotation.x = -Math.PI / 2;
    tail.scale.set(0.3, 1.0, 1.2);
    tail.position.z = -0.48;
    body.add(tail);
    return { root, body, tail, legs: [], baseBodyY };
  }

  if (species === 'marmot') {
    const root = new THREE.Group();
    const baseBodyY = 0.27;
    const body = new THREE.Group();
    body.position.y = baseBodyY;
    root.add(body);
    const furMat = makeOrganicMat('#cc974b', 0.82, 0.02);
    const capMat = makeOrganicMat('#4d3822', 0.84, 0.02);

    const torsoGeo = buildLatheTorso(
      [
        [0.01, -0.38],
        [0.2, -0.22],
        [0.24, 0.04],
        [0.18, 0.28],
        [0.01, 0.36],
      ],
      12,
      0.9,
    );
    const torso = new THREE.Mesh(torsoGeo, furMat);
    torso.castShadow = true;
    body.add(torso);

    const head = new THREE.Group();
    head.position.set(0, 0.14, 0.32);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), capMat));
    addEyes(head, 0.08, 0.04, 0.1, 0.02, '#1f160e');
    body.add(head);

    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.26, 4, 8), capMat);
    tail.rotation.x = Math.PI * 0.4;
    tail.position.set(0, 0.04, -0.4);
    body.add(tail);

    const legs: THREE.Object3D[] = [];
    const lowerLegs: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      for (const z of [0.2, -0.2]) {
        const { upper, knee } = makeArticulatedLimb({
          topR: 0.055,
          midR: 0.042,
          botR: 0.036,
          upperLen: 0.12,
          lowerLen: 0.1,
          mat: capMat,
          pawMat: capMat,
        });
        upper.position.set(s * 0.13, -0.05, z);
        body.add(upper);
        legs.push(upper);
        lowerLegs.push(knee);
      }
    }
    addContactShadow(root, 0.45);
    return { root, body, head, tail, legs, lowerLegs, baseBodyY };
  }

  const isGazelle = species === 'gazelle';
  const root = new THREE.Group();
  const baseBodyY = 0.72;
  const body = new THREE.Group();
  body.position.y = baseBodyY;
  root.add(body);

  const coatMat = makeOrganicMat(isGazelle ? '#d1a775' : '#8f7d6b', 0.75, 0.02);
  const bellyMat = makeOrganicMat('#f2eadc', 0.82, 0.02);
  const hornMat = makeOrganicMat('#2e2924', 0.42, 0.12);

  const torsoGeo = buildLatheTorso(
    [
      [0.01, -0.58],
      [0.18, -0.42],
      [0.22, -0.1],
      [0.21, 0.24],
      [0.24, 0.45],
      [0.01, 0.58],
    ],
    14,
    isGazelle ? 0.78 : 0.88,
  );
  const torso = new THREE.Mesh(torsoGeo, coatMat);
  torso.castShadow = true;
  body.add(torso);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), bellyMat);
  belly.scale.set(0.75, 0.45, 2.2);
  belly.position.y = -0.14;
  body.add(belly);

  const head = new THREE.Group();
  head.position.set(0, 0.38, 0.54);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.44, 10), coatMat);
  neck.rotation.x = -0.38;
  neck.position.set(0, -0.18, -0.06);
  head.add(neck);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), coatMat);
  skull.scale.set(0.82, 0.85, 1.35);
  skull.position.set(0, 0.04, 0.08);
  head.add(skull);

  addEyes(head, 0.082, 0.06, 0.14, 0.025, '#2b2016');

  for (const side of [-1, 1]) {
    const pts = isGazelle
      ? [
          new THREE.Vector3(side * 0.05, 0.1, 0.04),
          new THREE.Vector3(side * 0.09, 0.24, -0.02),
          new THREE.Vector3(side * 0.07, 0.36, 0.02),
        ]
      : [
          new THREE.Vector3(side * 0.06, 0.12, 0.04),
          new THREE.Vector3(side * 0.12, 0.34, -0.14),
          new THREE.Vector3(side * 0.14, 0.46, -0.36),
        ];
    const hornGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.026, 7, false);
    const horn = new THREE.Mesh(hornGeo, hornMat);
    head.add(horn);
  }
  body.add(head);

  const legs: THREE.Object3D[] = [];
  const lowerLegs: THREE.Object3D[] = [];
  const legPos: Array<[number, number, number]> = [
    [-0.13, -0.08, 0.36],
    [0.13, -0.08, 0.36],
    [-0.14, -0.08, -0.38],
    [0.14, -0.08, -0.38],
  ];
  for (const [x, y, z] of legPos) {
    const { upper, knee } = makeArticulatedLimb({
      topR: 0.068,
      midR: 0.045,
      botR: 0.036,
      upperLen: 0.31,
      lowerLen: 0.3,
      mat: coatMat,
      pawMat: hornMat,
      hoofStyle: true,
    });
    upper.position.set(x, y, z);
    body.add(upper);
    legs.push(upper);
    lowerLegs.push(knee);
  }

  addContactShadow(root, 0.72);
  return { root, body, head, legs, lowerLegs, baseBodyY };
}

export function buildCageOverlay(): THREE.Group {
  const cage = new THREE.Group();
  const barMat = makeOrganicMat('#585e66', 0.4, 0.72);
  const frameGeo = new THREE.BoxGeometry(2.1, 1.85, 2.1);
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(frameGeo),
    new THREE.LineBasicMaterial({ color: '#d49a3a' }),
  );
  wire.position.y = 0.95;
  cage.add(wire);

  for (const x of [-0.95, 0.95]) {
    for (const z of [-0.95, 0.95]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.85, 8), barMat);
      post.position.set(x, 0.92, z);
      cage.add(post);
    }
  }
  return cage;
}

export function buildJaalMesh(width = 16): THREE.Group {
  const jaal = new THREE.Group();
  const stakeMat = makeOrganicMat('#5c4128', 0.9, 0.02);
  const floatMat = makeOrganicMat('#f97316', 0.5, 0.05);
  const ropeMat = makeOrganicMat('#d6c6a5', 0.85, 0.02);
  const netMat = new THREE.MeshBasicMaterial({
    color: '#e2e8f0',
    wireframe: true,
    transparent: true,
    opacity: 0.74,
  });

  for (const side of [-1, 1]) {
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.6, 8), stakeMat);
    stake.position.set(side * (width * 0.5), 0.1, 0);
    stake.castShadow = true;
    jaal.add(stake);
  }

  const headline = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, width, 8), ropeMat);
  headline.rotation.z = Math.PI / 2;
  headline.position.y = 0.32;
  jaal.add(headline);

  const buoyCount = 7;
  for (let i = 0; i < buoyCount; i++) {
    const t = (i / (buoyCount - 1) - 0.5) * (width * 0.86);
    const buoy = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.16, 4, 8), floatMat);
    buoy.rotation.z = Math.PI / 2;
    buoy.position.set(t, 0.34, 0);
    jaal.add(buoy);
  }

  const netMesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.96, 1.05, 16, 4), netMat);
  netMesh.position.y = -0.22;
  jaal.add(netMesh);

  return jaal;
}

export function animateActorRig(
  rig: RigHandles,
  gait: GaitState,
  phase: number,
  isHumanoid = false,
  sedated = false,
  animalKey?: string,
  secondaryActive = false,
): void {
  const baseBodyY = rig.baseBodyY ?? (isHumanoid ? 0.85 : 0.74);

  if (sedated) {
    rig.body.rotation.z = THREE.MathUtils.lerp(rig.body.rotation.z, Math.PI * 0.48, 0.14);
    rig.body.position.y = THREE.MathUtils.lerp(rig.body.position.y, 0.25, 0.14);
    return;
  }

  if (rig.isCustomGlb) {
    const bob = gait === 'idle' ? 0 : Math.abs(Math.sin(phase * 2)) * 0.08;
    rig.body.position.y = bob;
    return;
  }

  if (rig.legs.length === 0) {
    const speed = gait === 'swim' || gait === 'dive' ? 9.5 : 3.5;
    const isDolphin = animalKey === 'indus_dolphin' || animalKey === 'indus_dolphin_npc';
    if (gait === 'jump') {
      rig.body.rotation.x = THREE.MathUtils.lerp(rig.body.rotation.x, -0.38, 0.22);
      rig.body.rotation.z = THREE.MathUtils.lerp(rig.body.rotation.z, 0, 0.2);
    } else if (gait === 'dive') {
      rig.body.rotation.x = THREE.MathUtils.lerp(rig.body.rotation.x, 0.38, 0.2);
      rig.body.rotation.z = THREE.MathUtils.lerp(rig.body.rotation.z, isDolphin ? 0.36 : 0, 0.15);
    } else {
      rig.body.rotation.x = Math.sin(phase * speed) * 0.15;
      rig.body.rotation.z = THREE.MathUtils.lerp(rig.body.rotation.z, isDolphin ? 0.35 : 0, 0.12);
    }
    if (rig.tail) {
      rig.tail.rotation.x = Math.sin(phase * speed - 0.8) * 0.38;
    }
    if (rig.flippers) {
      rig.flippers.forEach((f, idx) => {
        f.rotation.z = (idx === 0 ? 1 : -1) * (0.25 + Math.sin(phase * speed) * 0.2);
      });
    }
    return;
  }

  const bearSway =
    animalKey === 'brown_bear' || animalKey === 'brown_bear_npc'
      ? Math.sin(phase * 4.5) * (gait === 'idle' ? 0.01 : 0.06)
      : 0;
  rig.body.rotation.z = THREE.MathUtils.lerp(rig.body.rotation.z, bearSway, 0.16);

  if (gait === 'jump') {
    if (animalKey === 'brown_bear') {
      rig.body.rotation.x = THREE.MathUtils.lerp(rig.body.rotation.x, -0.35, 0.22);
      rig.legs.forEach((l, i) => {
        l.rotation.x = i < 2 ? -1.05 : 0.35;
      });
    } else {
      rig.body.rotation.x = THREE.MathUtils.lerp(rig.body.rotation.x, -0.26, 0.22);
      rig.legs.forEach((l, i) => {
        l.rotation.x = i < 2 ? -0.78 : 0.82;
        if (rig.lowerLegs?.[i]) {
          rig.lowerLegs[i].rotation.x = i < 2 ? 1.05 : -0.45;
        }
      });
    }
    if (rig.tail) rig.tail.rotation.x = -0.25;
    return;
  }

  if (gait === 'lunge') {
    if (animalKey === 'markhor') {
      rig.body.rotation.x = 0.14;
      if (rig.head) rig.head.rotation.x = 0.62;
    } else if (animalKey === 'brown_bear') {
      rig.body.rotation.x = -0.28;
      if (rig.head) rig.head.rotation.x = -0.35;
    } else {
      rig.body.rotation.x = -0.22;
      if (rig.head) rig.head.rotation.x = 0.12;
    }
    rig.legs.forEach((l, i) => {
      l.rotation.x = i < 2 ? -0.9 : 0.9;
      if (rig.lowerLegs?.[i]) rig.lowerLegs[i].rotation.x = 0.35;
    });
    return;
  }

  if (rig.head) {
    rig.head.rotation.x = THREE.MathUtils.lerp(rig.head.rotation.x, 0, 0.18);
  }

  if (gait === 'idle' || gait === 'freeze') {
    const breathe = Math.sin(phase * 2.2) * 0.015;
    const crouchDrop = animalKey === 'snow_leopard' && secondaryActive ? 0.16 : 0;
    rig.body.rotation.x = THREE.MathUtils.lerp(rig.body.rotation.x, crouchDrop ? 0.08 : 0, 0.16);
    rig.body.position.y = THREE.MathUtils.lerp(rig.body.position.y, baseBodyY - crouchDrop + breathe, 0.18);
    rig.legs.forEach((l, i) => {
      l.rotation.x = THREE.MathUtils.lerp(l.rotation.x, crouchDrop ? (i < 2 ? -0.35 : 0.3) : 0, 0.18);
      if (rig.lowerLegs?.[i]) {
        rig.lowerLegs[i].rotation.x = THREE.MathUtils.lerp(
          rig.lowerLegs[i].rotation.x,
          crouchDrop ? 0.55 : 0,
          0.18,
        );
      }
    });
    if (rig.arms) {
      rig.arms.forEach((a, idx) => {
        const aimAngle = isHumanoid && gait === 'freeze' && idx === 1 ? -1.15 : 0;
        a.rotation.x = THREE.MathUtils.lerp(a.rotation.x, aimAngle, 0.22);
      });
    }
    if (rig.head) {
      rig.head.rotation.y = gait === 'freeze' ? Math.sin(phase * 4.5) * 0.18 : Math.sin(phase * 1.1) * 0.08;
    }
    return;
  }

  if (gait === 'swim') {
    const freq = 7.2;
    rig.body.rotation.x = isHumanoid ? 0.55 : 0.12;
    rig.legs.forEach((l, i) => {
      l.rotation.x = Math.sin(phase * freq + i * Math.PI) * 0.7;
      if (rig.lowerLegs?.[i]) rig.lowerLegs[i].rotation.x = 0.25 + Math.cos(phase * freq) * 0.25;
    });
    if (rig.arms) {
      rig.arms.forEach((a, i) => {
        a.rotation.x = -0.6 + Math.sin(phase * freq + i * Math.PI) * 0.85;
      });
    }
    return;
  }

  const isLeopard = animalKey === 'snow_leopard' || animalKey === 'snow_leopard_npc';
  const isMarkhor = animalKey === 'markhor' || animalKey === 'markhor_npc';
  const isBear = animalKey === 'brown_bear' || animalKey === 'brown_bear_npc';

  const stealthCrouch = isLeopard && secondaryActive ? 0.16 : 0;
  const freq =
    gait === 'gallop'
      ? isLeopard
        ? 13.5
        : isMarkhor
          ? 12.5
          : isBear
            ? 9.8
            : 11.5
      : gait === 'trot'
        ? 8.5
        : 5.6;
  const amp = gait === 'gallop' ? (isBear ? 0.68 : 0.82) : gait === 'trot' ? 0.54 : 0.36;
  const bounce =
    Math.abs(Math.sin(phase * freq)) *
    (gait === 'gallop' ? (isMarkhor ? 0.15 : 0.11) : 0.045);

  rig.body.rotation.x =
    gait === 'gallop'
      ? Math.sin(phase * freq) * (isLeopard ? 0.16 : 0.11)
      : stealthCrouch
        ? 0.08
        : 0;
  if (rig.head) rig.head.rotation.y = 0;

  if (rig.legs.length === 2) {
    rig.legs[0].rotation.x = Math.sin(phase * freq) * amp;
    rig.legs[1].rotation.x = -Math.sin(phase * freq) * amp;
    if (rig.lowerLegs) {
      rig.lowerLegs[0].rotation.x = Math.max(0, -Math.cos(phase * freq)) * amp * 0.85;
      rig.lowerLegs[1].rotation.x = Math.max(0, Math.cos(phase * freq)) * amp * 0.85;
    }
    if (rig.arms) {
      rig.arms[0].rotation.x = -Math.sin(phase * freq) * amp * 0.75;
      rig.arms[1].rotation.x = Math.sin(phase * freq) * amp * 0.35 - 0.25;
    }
  } else if (rig.legs.length === 4) {
    if (gait === 'gallop') {
      rig.legs[0].rotation.x = Math.sin(phase * freq) * amp;
      rig.legs[1].rotation.x = Math.sin(phase * freq + 0.38) * amp;
      rig.legs[2].rotation.x = -Math.sin(phase * freq + 0.2) * amp;
      rig.legs[3].rotation.x = -Math.sin(phase * freq + 0.55) * amp;
    } else {
      rig.legs[0].rotation.x = Math.sin(phase * freq) * amp;
      rig.legs[3].rotation.x = Math.sin(phase * freq) * amp;
      rig.legs[1].rotation.x = -Math.sin(phase * freq) * amp;
      rig.legs[2].rotation.x = -Math.sin(phase * freq) * amp;
    }
    if (rig.lowerLegs && rig.lowerLegs.length === 4) {
      for (let i = 0; i < 4; i++) {
        const swing = rig.legs[i].rotation.x;
        rig.lowerLegs[i].rotation.x =
          stealthCrouch > 0
            ? 0.45 + Math.max(0, swing) * 0.5
            : Math.max(0, -swing) * 0.72 + (gait === 'gallop' ? 0.22 : 0.08);
      }
    }
    if (rig.tail) {
      rig.tail.rotation.y = Math.sin(phase * freq * 0.6) * 0.28;
      rig.tail.rotation.x = isLeopard ? 0.14 + Math.cos(phase * freq) * 0.14 : 0;
    }
  }

  rig.body.position.y = baseBodyY - stealthCrouch + bounce;
}
