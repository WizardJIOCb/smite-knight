import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clamp, damp } from './math';

export type RigAction = 'idle' | 'run' | 'jump' | 'attack' | 'block' | 'dead';

type KnightTeam = 'allies' | 'enemies';
type KnightRole = 'soldier' | 'archer' | 'brute' | 'boss';
type FactionPalette = KnightTeam | 'boss';

interface DetailedKnightAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  crossbow: THREE.Group;
  factionTextures: Record<FactionPalette, THREE.Texture>;
  skinTexture: THREE.Texture;
}

const DETAILED_KNIGHT_URL = '/assets/kaykit/knight.glb';
const CROSSBOW_URL = '/assets/kaykit/crossbow.glb';
const clipNames: Record<KnightRole, Record<RigAction, string>> = {
  soldier: {
    idle: 'Idle',
    run: 'Running_A',
    jump: 'Jump_Full_Short',
    attack: '1H_Melee_Attack_Slice_Diagonal',
    block: 'Blocking',
    dead: 'Death_A',
  },
  archer: {
    idle: 'Idle',
    run: 'Running_A',
    jump: 'Jump_Full_Short',
    attack: '2H_Ranged_Shoot',
    block: '2H_Ranged_Aiming',
    dead: 'Death_A',
  },
  brute: {
    idle: '2H_Melee_Idle',
    run: 'Running_B',
    jump: 'Jump_Full_Short',
    attack: '2H_Melee_Attack_Spin',
    block: 'Blocking',
    dead: 'Death_A',
  },
  boss: {
    idle: '2H_Melee_Idle',
    run: 'Running_B',
    jump: 'Jump_Full_Short',
    attack: '2H_Melee_Attack_Spin',
    block: 'Blocking',
    dead: 'Death_B',
  },
};

let detailedAssetPromise: Promise<DetailedKnightAsset> | undefined;
let detailedAssetWarningShown = false;

function recolorFactionTexture(source: THREE.Texture, target: [number, number, number]): THREE.Texture {
  const image = source.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];
    if (red < 70 || red - Math.max(green, blue) < 24) continue;
    const shade = 0.62 + red / 255 * 0.55;
    pixels.data[index] = Math.min(255, target[0] * shade);
    pixels.data[index + 1] = Math.min(255, target[1] * shade);
    pixels.data[index + 2] = Math.min(255, target[2] * shade);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = source.colorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.magFilter = source.magFilter;
  texture.minFilter = source.minFilter;
  texture.generateMipmaps = source.generateMipmaps;
  texture.needsUpdate = true;
  return texture;
}

function findKnightTexture(scene: THREE.Group): THREE.Texture {
  let texture: THREE.Texture | undefined;
  scene.traverse((object) => {
    if (texture || !(object instanceof THREE.Mesh)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (material instanceof THREE.MeshStandardMaterial && material.map) texture = material.map;
  });
  if (!texture) throw new Error('KayKit knight texture is missing');
  return texture;
}

function loadDetailedKnightAsset(): Promise<DetailedKnightAsset> {
  detailedAssetPromise ??= Promise.all([
    new GLTFLoader().loadAsync(DETAILED_KNIGHT_URL),
    new GLTFLoader().loadAsync(CROSSBOW_URL),
  ]).then(([knight, crossbow]) => {
    const sourceTexture = findKnightTexture(knight.scene);
    return {
      scene: knight.scene,
      animations: knight.animations,
      crossbow: crossbow.scene,
      skinTexture: recolorFactionTexture(sourceTexture, [188, 126, 89]),
      factionTextures: {
        allies: recolorFactionTexture(sourceTexture, [38, 126, 148]),
        enemies: recolorFactionTexture(sourceTexture, [151, 35, 47]),
        boss: recolorFactionTexture(sourceTexture, [137, 67, 23]),
      },
    };
  });
  return detailedAssetPromise;
}

function warnDetailedAssetFailure(error: unknown): void {
  if (detailedAssetWarningShown) return;
  detailedAssetWarningShown = true;
  console.warn('Detailed knight assets could not be loaded; using procedural fallback.', error);
}

export async function preloadKnightAssets(): Promise<void> {
  try {
    await loadDetailedKnightAsset();
  } catch (error) {
    warnDetailedAssetFailure(error);
  }
}

const geometries = {
  torso: new THREE.CapsuleGeometry(0.34, 0.72, 4, 8),
  head: new THREE.SphereGeometry(0.25, 10, 7),
  helmet: new THREE.SphereGeometry(0.29, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.7),
  visor: new THREE.BoxGeometry(0.48, 0.16, 0.12),
  limb: new THREE.CapsuleGeometry(0.1, 0.52, 3, 7),
  boot: new THREE.BoxGeometry(0.19, 0.18, 0.34),
  shoulder: new THREE.SphereGeometry(0.18, 8, 6),
  sword: new THREE.BoxGeometry(0.055, 1.05, 0.025),
  hilt: new THREE.BoxGeometry(0.34, 0.055, 0.055),
  shield: new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10),
  plume: new THREE.BoxGeometry(0.1, 0.34, 0.06),
  bow: new THREE.TorusGeometry(0.42, 0.025, 5, 12, Math.PI * 1.55),
};

const materials = {
  allyCloth: new THREE.MeshStandardMaterial({ color: 0x244e57, roughness: 0.92 }),
  allyCape: new THREE.MeshStandardMaterial({ color: 0xb3572c, roughness: 0.95, side: THREE.DoubleSide }),
  enemyCloth: new THREE.MeshStandardMaterial({ color: 0x3a2026, roughness: 0.95 }),
  enemyCape: new THREE.MeshStandardMaterial({ color: 0x6c1622, roughness: 0.95, side: THREE.DoubleSide }),
  armor: new THREE.MeshStandardMaterial({ color: 0x59616a, metalness: 0.8, roughness: 0.3 }),
  darkArmor: new THREE.MeshStandardMaterial({ color: 0x25282c, metalness: 0.86, roughness: 0.26 }),
  bossArmor: new THREE.MeshStandardMaterial({ color: 0x241c1b, metalness: 0.88, roughness: 0.24, emissive: 0x260600, emissiveIntensity: 0.4 }),
  skin: new THREE.MeshStandardMaterial({ color: 0x9a725b, roughness: 1 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x33251d, roughness: 0.96 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xb8c2ca, metalness: 0.94, roughness: 0.18 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xb07b32, metalness: 0.82, roughness: 0.26 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x51351f, roughness: 0.92 }),
};

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, castShadow = true): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = castShadow;
  result.receiveShadow = castShadow;
  return result;
}

export class KnightRig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly leftArm = new THREE.Group();
  readonly rightArm = new THREE.Group();
  readonly leftLeg = new THREE.Group();
  readonly rightLeg = new THREE.Group();
  readonly weaponPivot = new THREE.Group();
  readonly shieldPivot = new THREE.Group();
  readonly head = new THREE.Group();
  private readonly team: KnightTeam;
  private readonly role: KnightRole;
  private readonly cape: THREE.Mesh;
  private action: RigAction = 'idle';
  private attackClock = 0;
  private deathClock = 0;
  private speed = 0;
  private damageFlash = 0;
  private groundHeight = 0;
  private verticalOffset = 0;
  private readonly armorMeshes: THREE.Mesh[] = [];
  private detailedModel?: THREE.Group;
  private mixer?: THREE.AnimationMixer;
  private activeAnimation?: THREE.AnimationAction;
  private activeClipName = '';
  private readonly detailedMaterials: THREE.MeshStandardMaterial[] = [];
  private bossAura?: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;

  constructor(team: KnightTeam, role: KnightRole = 'soldier') {
    this.team = team;
    this.role = role;
    const boss = role === 'boss';
    const brute = role === 'brute';
    const cloth = team === 'allies' ? materials.allyCloth : materials.enemyCloth;
    const capeMaterial = team === 'allies' ? materials.allyCape : materials.enemyCape;
    const armor = (boss ? materials.bossArmor : team === 'allies' ? materials.armor : materials.darkArmor).clone();
    armor.userData.baseEmissiveIntensity = boss ? 0.4 : 0;
    armor.emissiveIntensity = armor.userData.baseEmissiveIntensity as number;
    const scale = boss ? 1.28 : brute ? 1.12 : 1;

    this.root.scale.setScalar(scale);
    this.root.add(this.body);
    this.body.position.y = 1.08;

    const torso = mesh(geometries.torso, cloth);
    torso.rotation.z = Math.PI / 2;
    torso.scale.set(1.2, 1, 1.05);
    this.body.add(torso);

    const breastplate = mesh(new THREE.CylinderGeometry(0.39, 0.31, 0.64, 8, 1, false), armor);
    breastplate.rotation.z = Math.PI / 2;
    breastplate.position.y = 0.06;
    this.body.add(breastplate);
    this.armorMeshes.push(breastplate);

    const belt = mesh(new THREE.TorusGeometry(0.31, 0.055, 5, 12), materials.leather);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.38;
    this.body.add(belt);

    this.head.position.y = 0.72;
    this.body.add(this.head);
    const face = mesh(geometries.head, materials.skin);
    this.head.add(face);
    const helmet = mesh(geometries.helmet, armor);
    helmet.position.y = 0.02;
    this.head.add(helmet);
    this.armorMeshes.push(helmet);
    const visor = mesh(geometries.visor, armor);
    visor.position.set(0, 0.01, 0.245);
    this.head.add(visor);
    const slit = mesh(new THREE.BoxGeometry(0.35, 0.025, 0.015), new THREE.MeshBasicMaterial({ color: boss ? 0xff411f : 0x050505 }));
    slit.position.set(0, 0.03, 0.313);
    this.head.add(slit);
    if (boss || role === 'archer') {
      const plume = mesh(geometries.plume, boss ? materials.enemyCape : capeMaterial);
      plume.position.set(0, 0.35, -0.03);
      plume.rotation.x = -0.22;
      this.head.add(plume);
    }

    this.cape = mesh(new THREE.PlaneGeometry(boss ? 0.82 : 0.66, boss ? 1.08 : 0.84, 1, 3), capeMaterial, false);
    this.cape.position.set(0, 0.02, -0.36);
    this.cape.rotation.x = -0.12;
    this.body.add(this.cape);

    this.leftArm.position.set(-0.45, 0.31, 0);
    this.rightArm.position.set(0.45, 0.31, 0);
    this.body.add(this.leftArm, this.rightArm);
    this.buildArm(this.leftArm, armor);
    this.buildArm(this.rightArm, armor);

    this.leftLeg.position.set(-0.2, -0.48, 0);
    this.rightLeg.position.set(0.2, -0.48, 0);
    this.body.add(this.leftLeg, this.rightLeg);
    this.buildLeg(this.leftLeg, armor);
    this.buildLeg(this.rightLeg, armor);

    this.weaponPivot.position.set(0, -0.48, 0);
    this.rightArm.add(this.weaponPivot);
    if (role === 'archer') this.buildBow(); else this.buildSword(boss || brute);
    this.shieldPivot.position.set(0, -0.43, 0);
    this.leftArm.add(this.shieldPivot);
    if (role !== 'archer') this.buildShield(team, boss);
    if (boss) this.buildBossRegalia();

    this.root.traverse((object) => { object.frustumCulled = true; });
    void loadDetailedKnightAsset().then((asset) => this.mountDetailedModel(asset)).catch(warnDetailedAssetFailure);
  }

  setState(action: RigAction, speed: number, delta: number): void {
    if (action !== this.action) {
      if (action === 'attack' || action === 'jump') this.attackClock = 0;
      if (action === 'dead') this.deathClock = 0;
      this.action = action;
      this.playDetailedAction(action);
    }
    this.speed = damp(this.speed, speed, 10, delta);
  }

  flashDamage(): void {
    this.damageFlash = 0.12;
  }

  setGroundHeight(height: number): void {
    this.groundHeight = height;
    if (this.action !== 'dead') this.root.position.y = height + this.verticalOffset;
  }

  setVerticalOffset(offset: number): void {
    this.verticalOffset = Math.max(0, offset);
  }

  update(time: number, delta: number): void {
    this.damageFlash = Math.max(0, this.damageFlash - delta);
    this.attackClock += delta;
    if (this.action === 'dead') this.deathClock += delta;
    if (this.mixer) {
      const animationSpeed = this.action === 'run' ? 0.9 + clamp(this.speed, 0, 1) * 0.3 : 1;
      this.mixer.update(delta * animationSpeed);
    }

    const run = Math.sin(time * (7.5 + this.speed * 3.5));
    const stride = this.action === 'run' ? clamp(this.speed, 0, 1) : 0;
    this.leftLeg.rotation.x = damp(this.leftLeg.rotation.x, run * 0.65 * stride, 13, delta);
    this.rightLeg.rotation.x = damp(this.rightLeg.rotation.x, -run * 0.65 * stride, 13, delta);
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, -run * 0.4 * stride, 12, delta);

    let rightArmX = run * 0.33 * stride;
    let rightArmZ = 0;
    let leftArmX = -run * 0.3 * stride;
    let leftArmZ = 0;
    let bodyY = Math.abs(run) * 0.035 * stride;
    let bodyX = 0;
    let bodyZ = 0;

    if (this.action === 'attack') {
      const attack = clamp(this.attackClock / 0.58, 0, 1);
      const windup = Math.sin(attack * Math.PI);
      rightArmX = -1.85 + attack * 2.45;
      rightArmZ = -0.8 * windup;
      bodyZ = 0.28 * windup;
      bodyX = -0.12 * windup;
    } else if (this.action === 'block') {
      leftArmX = -1.25;
      leftArmZ = -0.42;
      rightArmX = -0.45;
    } else if (this.action === 'jump') {
      const tuck = Math.sin(clamp(this.attackClock / 0.36, 0, 1) * Math.PI);
      leftArmX = -0.45 - tuck * 0.55;
      rightArmX = -0.35 - tuck * 0.65;
      this.leftLeg.rotation.x = damp(this.leftLeg.rotation.x, 0.45 * tuck, 18, delta);
      this.rightLeg.rotation.x = damp(this.rightLeg.rotation.x, -0.32 * tuck, 18, delta);
      bodyX = -0.14 * tuck;
    } else if (this.action === 'dead') {
      const fall = clamp(this.deathClock * 1.9, 0, 1);
      if (!this.detailedModel) {
        this.root.rotation.z = damp(this.root.rotation.z, Math.PI * 0.5, 6, delta);
        this.root.position.y = damp(this.root.position.y, this.groundHeight + 0.18, 6, delta);
      }
      bodyY = -0.12 * fall;
    } else {
      this.root.rotation.z = damp(this.root.rotation.z, 0, 7, delta);
      this.root.position.y = damp(this.root.position.y, this.groundHeight + this.verticalOffset, 18, delta);
    }

    this.rightArm.rotation.x = damp(this.rightArm.rotation.x, rightArmX, 16, delta);
    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, rightArmZ, 16, delta);
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, leftArmX, 14, delta);
    this.leftArm.rotation.z = damp(this.leftArm.rotation.z, leftArmZ, 14, delta);
    this.body.position.y = damp(this.body.position.y, 1.08 + bodyY, 12, delta);
    this.body.rotation.x = damp(this.body.rotation.x, bodyX, 12, delta);
    this.body.rotation.z = damp(this.body.rotation.z, bodyZ, 12, delta);
    this.cape.rotation.x = -0.12 - stride * 0.22 + Math.sin(time * 2.6) * 0.035;
    this.head.rotation.y = Math.sin(time * 0.6 + this.root.id) * 0.04;

    const emissive = this.damageFlash > 0 ? 0.9 : 0;
    for (const armorMesh of this.armorMeshes) {
      const material = armorMesh.material as THREE.MeshStandardMaterial;
      const base = (material.userData.baseEmissiveIntensity as number | undefined) ?? 0;
      material.emissiveIntensity = base + emissive;
    }
    for (const material of this.detailedMaterials) {
      material.emissiveIntensity = (this.role === 'boss' ? 0.14 : 0) + (this.damageFlash > 0 ? 0.82 : 0);
    }
    if (this.bossAura) {
      this.bossAura.rotation.z = time * 0.48;
      this.bossAura.material.emissiveIntensity = 1.2 + Math.sin(time * 3.4) * 0.45;
    }
  }

  private buildBossRegalia(): void {
    const regalia = new THREE.Group();
    regalia.name = 'Warlord_Regalia';
    const blackIron = new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: 0.9, roughness: 0.24 });
    const ember = new THREE.MeshStandardMaterial({ color: 0xff6a20, emissive: 0xb51d05, emissiveIntensity: 2.1, metalness: 0.45, roughness: 0.28 });
    for (const side of [-1, 1]) {
      const horn = mesh(new THREE.ConeGeometry(0.13, 0.66, 7), blackIron);
      horn.position.set(side * 0.35, 2.22, -0.02);
      horn.rotation.z = side * -0.38;
      regalia.add(horn);
      const shoulderSpike = mesh(new THREE.ConeGeometry(0.14, 0.58, 6), blackIron);
      shoulderSpike.position.set(side * 0.62, 1.48, -0.02);
      shoulderSpike.rotation.z = side * -1.02;
      regalia.add(shoulderSpike);
    }
    const crown = mesh(new THREE.TorusGeometry(0.3, 0.055, 7, 12), ember);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 2.13;
    regalia.add(crown);
    this.bossAura = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.035, 6, 24), ember.clone());
    this.bossAura.rotation.x = Math.PI / 2;
    this.bossAura.position.y = 0.06;
    regalia.add(this.bossAura);
    this.root.add(regalia);
  }

  private mountDetailedModel(asset: DetailedKnightAsset): void {
    if (this.detailedModel) return;
    const model = cloneSkeleton(asset.scene) as THREE.Group;
    model.name = `KayKitKnight_${this.team}_${this.role}`;
    model.scale.setScalar(0.78);

    const palette: FactionPalette = this.role === 'boss' ? 'boss' : this.team;
    const materialClones = new Map<string, THREE.Material>();
    const cloneMaterial = (source: THREE.Material, face = false): THREE.Material => {
      const key = `${source.uuid}:${face ? 'face' : 'faction'}`;
      const cached = materialClones.get(key);
      if (cached) return cached;
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const material = source.clone();
      material.map = face && this.role !== 'boss' ? asset.skinTexture : asset.factionTextures[palette];
      material.roughness = face ? 0.78 : this.role === 'boss' ? 0.34 : 0.48;
      material.metalness = face ? 0.01 : this.role === 'boss' ? 0.24 : 0.12;
      material.emissive.set(face ? 0x000000 : this.role === 'boss' ? 0x481007 : 0xff5a31);
      material.emissiveIntensity = face ? 0 : this.role === 'boss' ? 0.14 : 0;
      materialClones.set(key, material);
      this.detailedMaterials.push(material);
      return material;
    };

    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      // Animated skinned bounds can lag behind a running pose and briefly cull the whole unit.
      object.frustumCulled = false;
      const face = object.name === 'Knight_Head';
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => cloneMaterial(material, face))
        : cloneMaterial(object.material, face);
    });

    const accessoryNames = [
      '1H_Sword_Offhand',
      'Badge_Shield',
      'Rectangle_Shield',
      'Round_Shield',
      'Spike_Shield',
      '1H_Sword',
      '2H_Sword',
    ];
    for (const name of accessoryNames) {
      const accessory = model.getObjectByName(name);
      if (accessory) accessory.visible = false;
    }

    if (this.role === 'archer') {
      const crossbow = asset.crossbow.clone(true);
      crossbow.name = 'KayKit_Crossbow';
      crossbow.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      model.getObjectByName('handslot.r')?.add(crossbow);
    } else if (this.role === 'boss' || this.role === 'brute') {
      const sword = model.getObjectByName('2H_Sword');
      if (sword) sword.visible = true;
    } else {
      const sword = model.getObjectByName('1H_Sword');
      const shield = model.getObjectByName(this.team === 'allies' ? 'Rectangle_Shield' : 'Spike_Shield');
      if (sword) sword.visible = true;
      if (shield) shield.visible = true;
    }

    this.body.visible = false;
    this.root.add(model);
    this.detailedModel = model;
    this.mixer = new THREE.AnimationMixer(model);
    this.playDetailedAction(this.action, true, asset.animations);
  }

  private playDetailedAction(action: RigAction, immediate = false, clips?: THREE.AnimationClip[]): void {
    if (!this.mixer || !this.detailedModel) return;
    const availableClips = clips ?? (this.detailedModel.userData.animationClips as THREE.AnimationClip[] | undefined);
    if (clips) this.detailedModel.userData.animationClips = clips;
    if (!availableClips) return;
    const clipName = clipNames[this.role][action];
    if (clipName === this.activeClipName) return;
    const clip = THREE.AnimationClip.findByName(availableClips, clipName);
    if (!clip) return;

    const next = this.mixer.clipAction(clip);
    const loop = action !== 'attack' && action !== 'dead';
    next.reset();
    next.enabled = true;
    next.clampWhenFinished = !loop;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Number.POSITIVE_INFINITY : 1);
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (this.activeAnimation && !immediate) this.activeAnimation.crossFadeTo(next, action === 'dead' ? 0.08 : 0.14, false);
    else if (this.activeAnimation) this.activeAnimation.stop();
    this.activeAnimation = next;
    this.activeClipName = clipName;
  }

  private buildArm(group: THREE.Group, armor: THREE.Material): void {
    const shoulder = mesh(geometries.shoulder, armor);
    shoulder.scale.set(1.25, 0.75, 1.2);
    group.add(shoulder);
    const arm = mesh(geometries.limb, materials.leather);
    arm.position.y = -0.32;
    group.add(arm);
  }

  private buildLeg(group: THREE.Group, armor: THREE.Material): void {
    const leg = mesh(geometries.limb, armor);
    leg.position.y = -0.38;
    group.add(leg);
    const boot = mesh(geometries.boot, materials.leather);
    boot.position.set(0, -0.78, 0.08);
    group.add(boot);
  }

  private buildSword(boss: boolean): void {
    const blade = mesh(geometries.sword, materials.steel);
    blade.position.y = -0.58;
    blade.rotation.z = 0.03;
    this.weaponPivot.add(blade);
    const hilt = mesh(geometries.hilt, boss ? materials.gold : materials.leather);
    hilt.position.y = -0.03;
    this.weaponPivot.add(hilt);
    const grip = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.25, 6), materials.leather);
    grip.position.y = 0.1;
    this.weaponPivot.add(grip);
    this.weaponPivot.rotation.x = -0.18;
  }

  private buildBow(): void {
    const bow = mesh(geometries.bow, materials.wood);
    bow.rotation.z = Math.PI / 2;
    bow.position.y = -0.42;
    this.weaponPivot.add(bow);
  }

  private buildShield(team: 'allies' | 'enemies', boss: boolean): void {
    const shield = mesh(geometries.shield, team === 'allies' ? materials.allyCape : materials.enemyCape);
    shield.rotation.x = Math.PI / 2;
    shield.rotation.z = Math.PI / 2;
    shield.scale.set(boss ? 1.18 : 1, 0.7, 1.15);
    this.shieldPivot.add(shield);
    const bossMark = mesh(new THREE.TorusGeometry(0.2, 0.035, 5, 8), boss ? materials.gold : materials.armor);
    bossMark.position.z = 0.07;
    this.shieldPivot.add(bossMark);
  }
}

export function createRemoteKnight(): KnightRig {
  return new KnightRig('allies', 'soldier');
}
