import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LevelEnvironment } from './levels';

export interface GeneratedPropPlacement {
  id: string;
  url: string;
  position: readonly [number, number];
  height: number;
  rotation: number;
  glow?: {
    color: number;
    intensity: number;
    distance: number;
  };
}

export const GENERATED_PROP_LAYOUTS: Record<LevelEnvironment, readonly GeneratedPropPlacement[]> = {
  ash: [
    {
      id: 'ashen-brazier-left',
      url: '/assets/generated/ashen-brazier.glb',
      position: [-7.2, -22.8],
      height: 2.35,
      rotation: 0.2,
      glow: { color: 0xff6a21, intensity: 2.1, distance: 8 },
    },
    {
      id: 'ashen-brazier-right',
      url: '/assets/generated/ashen-brazier.glb',
      position: [7.2, -22.8],
      height: 2.35,
      rotation: -0.2,
      glow: { color: 0xff6a21, intensity: 2.1, distance: 8 },
    },
    {
      id: 'ashen-siege-engine',
      url: '/assets/generated/ashen-siege-ram.glb',
      position: [24, 20],
      height: 3.7,
      rotation: -0.52,
    },
    {
      id: 'ashen-war-banner',
      url: '/assets/generated/ashen-war-banner.glb',
      position: [-20, -68],
      height: 5.6,
      rotation: 0.35,
    },
  ],
  frost: [
    {
      id: 'frost-ice-totem',
      url: '/assets/generated/frost-ice-totem.glb',
      position: [-18, -16],
      height: 4.4,
      rotation: 0.26,
      glow: { color: 0x74dcff, intensity: 1.7, distance: 9 },
    },
    {
      id: 'frost-prison-cage',
      url: '/assets/generated/frost-prison-cage.glb',
      position: [18, -47],
      height: 4.1,
      rotation: -0.45,
    },
    {
      id: 'frost-sacrificial-altar',
      url: '/assets/generated/frost-sacrificial-altar.glb',
      position: [-15, -73],
      height: 2.4,
      rotation: 0.15,
      glow: { color: 0x70d8ff, intensity: 1.35, distance: 7 },
    },
  ],
  verdant: [
    {
      id: 'verdant-root-arch',
      url: '/assets/generated/verdant-root-arch.glb',
      position: [-18, -39],
      height: 5.4,
      rotation: 0.68,
    },
    {
      id: 'verdant-moss-knight-statue',
      url: '/assets/generated/verdant-moss-knight-statue.glb',
      position: [18, -55],
      height: 4.3,
      rotation: -0.62,
    },
    {
      id: 'verdant-thorn-obelisk',
      url: '/assets/generated/verdant-thorn-obelisk.glb',
      position: [-17, -70],
      height: 5.3,
      rotation: 0.18,
      glow: { color: 0x7ad13f, intensity: 1.45, distance: 8 },
    },
  ],
  foundry: [
    {
      id: 'foundry-magma-crucible',
      url: '/assets/generated/foundry-magma-crucible.glb',
      position: [-18, -18],
      height: 3.5,
      rotation: 0.4,
      glow: { color: 0xff4b18, intensity: 2.2, distance: 9 },
    },
    {
      id: 'foundry-gear-mechanism',
      url: '/assets/generated/foundry-gear-mechanism.glb',
      position: [17, -46],
      height: 3.2,
      rotation: -0.52,
    },
    {
      id: 'foundry-forge-relic',
      url: '/assets/generated/foundry-forge-relic.glb',
      position: [-15, -71],
      height: 3.25,
      rotation: 0.25,
      glow: { color: 0xff7a2a, intensity: 1.15, distance: 6 },
    },
  ],
  eclipse: [
    {
      id: 'eclipse-void-portal',
      url: '/assets/generated/eclipse-void-portal.glb',
      position: [-17, -20],
      height: 2.8,
      rotation: 0.24,
      glow: { color: 0x9b48ff, intensity: 2, distance: 9 },
    },
    {
      id: 'eclipse-rune-column',
      url: '/assets/generated/eclipse-rune-column.glb',
      position: [-17, -54],
      height: 5.8,
      rotation: 0.2,
      glow: { color: 0xa866ff, intensity: 1.5, distance: 8 },
    },
    {
      id: 'eclipse-dark-throne',
      url: '/assets/generated/eclipse-dark-throne.glb',
      position: [9, -79],
      height: 4.5,
      rotation: -0.7,
      glow: { color: 0xb073ff, intensity: 1.2, distance: 7 },
    },
  ],
};

const loader = new GLTFLoader();
const sourceCache = new Map<string, Promise<THREE.Group>>();

function loadSource(url: string): Promise<THREE.Group> {
  let pending = sourceCache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url).then(({ scene }) => scene);
    sourceCache.set(url, pending);
  }
  return pending;
}

function prepareModel(source: THREE.Group, targetHeight: number): THREE.Group {
  const model = source.clone(true);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  model.position.set(-center.x, -bounds.min.y, -center.z);

  const root = new THREE.Group();
  root.add(model);
  root.scale.setScalar(targetHeight / Math.max(0.001, size.y));
  return root;
}

async function mountPlacement(
  scene: THREE.Scene,
  placement: GeneratedPropPlacement,
  groundHeight: (x: number, z: number) => number,
): Promise<void> {
  const source = await loadSource(placement.url);
  const prop = prepareModel(source, placement.height);
  const [x, z] = placement.position;
  prop.name = `generated-prop-${placement.id}`;
  prop.position.set(x, groundHeight(x, z), z);
  prop.rotation.y = placement.rotation;
  scene.add(prop);

  if (!placement.glow) return;
  const light = new THREE.PointLight(
    placement.glow.color,
    placement.glow.intensity,
    placement.glow.distance,
    2,
  );
  light.name = `generated-prop-light-${placement.id}`;
  light.position.set(x, prop.position.y + placement.height * 0.62, z);
  scene.add(light);
}

export function mountGeneratedLevelProps(
  scene: THREE.Scene,
  environment: LevelEnvironment,
  groundHeight: (x: number, z: number) => number,
): void {
  for (const placement of GENERATED_PROP_LAYOUTS[environment]) {
    void mountPlacement(scene, placement, groundHeight).catch((error: unknown) => {
      console.warn(`Generated prop ${placement.id} could not be loaded.`, error);
    });
  }
}
