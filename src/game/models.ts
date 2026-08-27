import * as THREE from 'three';
import { clamp, damp } from './math';

export type RigAction = 'idle' | 'run' | 'attack' | 'block' | 'dead';

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
  private readonly cape: THREE.Mesh;
  private action: RigAction = 'idle';
  private attackClock = 0;
  private deathClock = 0;
  private speed = 0;
  private damageFlash = 0;
  private readonly armorMeshes: THREE.Mesh[] = [];

  constructor(team: 'allies' | 'enemies', role: 'soldier' | 'archer' | 'boss' = 'soldier') {
    const boss = role === 'boss';
    const cloth = team === 'allies' ? materials.allyCloth : materials.enemyCloth;
    const capeMaterial = team === 'allies' ? materials.allyCape : materials.enemyCape;
    const armor = (boss ? materials.bossArmor : team === 'allies' ? materials.armor : materials.darkArmor).clone();
    armor.userData.baseEmissiveIntensity = boss ? 0.4 : 0;
    armor.emissiveIntensity = armor.userData.baseEmissiveIntensity as number;
    const scale = boss ? 1.23 : 1;

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
    if (role === 'archer') this.buildBow(); else this.buildSword(boss);
    this.shieldPivot.position.set(0, -0.43, 0);
    this.leftArm.add(this.shieldPivot);
    if (role !== 'archer') this.buildShield(team, boss);

    this.root.traverse((object) => { object.frustumCulled = true; });
  }

  setState(action: RigAction, speed: number, delta: number): void {
    if (action !== this.action) {
      if (action === 'attack') this.attackClock = 0;
      if (action === 'dead') this.deathClock = 0;
      this.action = action;
    }
    this.speed = damp(this.speed, speed, 10, delta);
  }

  flashDamage(): void {
    this.damageFlash = 0.12;
  }

  update(time: number, delta: number): void {
    this.damageFlash = Math.max(0, this.damageFlash - delta);
    this.attackClock += delta;
    if (this.action === 'dead') this.deathClock += delta;

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
    } else if (this.action === 'dead') {
      const fall = clamp(this.deathClock * 1.9, 0, 1);
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI * 0.5, 6, delta);
      this.root.position.y = damp(this.root.position.y, 0.18, 6, delta);
      bodyY = -0.12 * fall;
    } else {
      this.root.rotation.z = damp(this.root.rotation.z, 0, 7, delta);
      this.root.position.y = damp(this.root.position.y, 0, 7, delta);
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
