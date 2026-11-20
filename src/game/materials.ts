import * as THREE from 'three';
import { BiomeConfig, SeasonId } from '../types/game';

export interface MaterialBundle {
  waterMaterial: THREE.MeshStandardMaterial;
  terrainMaterial: THREE.MeshStandardMaterial;
  mountainMaterial: THREE.MeshStandardMaterial;
  rockMaterial: THREE.MeshStandardMaterial;
  trunkMaterial: THREE.MeshStandardMaterial;
  foliageMaterial: THREE.MeshStandardMaterial;
  snowLeopardFur: THREE.MeshStandardMaterial;
  updateWaterTime: (t: number) => void;
  dispose: () => void;
}

export function createSpottedFurTexture(
  renderer?: THREE.WebGLRenderer,
  baseHex = '#dcded8',
  spotHex = 'rgba(62, 66, 74, 0.8)',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Fine fur hair strokes
  for (let i = 0; i < 900; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(60,64,70,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 2, y + 6);
    ctx.stroke();
  }

  // Snow Leopard Rosettes
  for (let i = 0; i < 68; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const r = 6 + rand() * 9;
    ctx.strokeStyle = spotHex;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0.2, Math.PI * 1.85);
    ctx.stroke();

    ctx.fillStyle = 'rgba(130, 134, 138, 0.42)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (renderer) {
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  return tex;
}

export function createFibrousCoatTexture(
  baseHex: string,
  darkHex: string,
  lightHex: string,
  grainDensity = 1200,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, darkHex);
  grad.addColorStop(0.45, baseHex);
  grad.addColorStop(1, lightHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < grainDensity; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const len = 5 + rand() * 9;
    ctx.strokeStyle = rand() > 0.48 ? 'rgba(25, 18, 12, 0.22)' : 'rgba(255, 245, 230, 0.16)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y + len);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createSoftShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(10, 16, 14, 0.52)');
  grad.addColorStop(0.55, 'rgba(10, 16, 14, 0.22)');
  grad.addColorStop(1, 'rgba(10, 16, 14, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBiomeMaterials(
  biome: BiomeConfig,
  renderer?: THREE.WebGLRenderer,
  season: SeasonId = 'summer',
): MaterialBundle {
  const waterUniforms = { uTime: { value: 0 } };

  const waterMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.waterColor),
    roughness: 0.16,
    metalness: 0.18,
    transparent: true,
    opacity: 0.86,
    flatShading: true,
  });

  waterMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader =
      `uniform float uTime;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        float waveA = sin(transformed.x * 0.42 + uTime * 2.1) * 0.08;
        float waveB = cos(transformed.y * 0.52 - uTime * 1.7) * 0.07;
        transformed.z += waveA + waveB;
        `,
      );
  };

  const terrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  });

  const mountainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.04,
    flatShading: true,
  });

  const rockMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.rockColor),
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
  });

  const trunkColor =
    biome.treeStyle === 'juniper'
      ? '#694e3a'
      : biome.treeStyle === 'acacia'
        ? '#75563b'
        : '#543b29';
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(trunkColor),
    roughness: 0.92,
    metalness: 0.02,
    flatShading: true,
  });

  const baseFoliage =
    biome.treeStyle === 'pine'
      ? '#256134'
      : biome.treeStyle === 'juniper'
        ? '#2e593d'
        : biome.treeStyle === 'acacia'
          ? '#657a35'
          : biome.treeStyle === 'tamarisk'
            ? '#3c7a42'
            : '#4a8540';
  const folCol = new THREE.Color(baseFoliage);
  if (season === 'autumn') {
    folCol.lerp(new THREE.Color('#b56e28'), 0.48);
  } else if (season === 'winter') {
    folCol.lerp(new THREE.Color('#bfd4d9'), biome.id === 'thar_desert' ? 0.12 : 0.42);
  } else if (season === 'spring') {
    folCol.lerp(new THREE.Color('#4aa348'), 0.25);
  }

  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: folCol,
    roughness: 0.78,
    metalness: 0.02,
    flatShading: true,
  });

  const furTex = createSpottedFurTexture(renderer);
  const snowLeopardFur = new THREE.MeshStandardMaterial({
    map: furTex,
    roughness: 0.72,
    metalness: 0.03,
    flatShading: false,
  });

  return {
    waterMaterial,
    terrainMaterial,
    mountainMaterial,
    rockMaterial,
    trunkMaterial,
    foliageMaterial,
    snowLeopardFur,
    updateWaterTime: (t: number) => {
      waterUniforms.uTime.value = t;
    },
    dispose: () => {
      waterMaterial.dispose();
      terrainMaterial.dispose();
      mountainMaterial.dispose();
      rockMaterial.dispose();
      trunkMaterial.dispose();
      foliageMaterial.dispose();
      furTex.dispose();
      snowLeopardFur.dispose();
    },
  };
}
