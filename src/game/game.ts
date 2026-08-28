import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { NetworkPlayer } from '../../shared/protocol';
import { BattleAudio } from './audio';
import { KnightRig, createRemoteKnight, type RigAction } from './models';
import {
  angleDelta,
  clamp,
  damp,
  dampAngle,
  distanceXZ,
  movementDirection,
  pointInAttackArc,
  ramEscortOffset,
  seededRandom,
  smoothstep,
} from './math';
import { battlefieldSurfaceAt, CASTLE_LIMITS, castleGroundHeight } from './world';

export interface HudState {
  health: number;
  maxHealth: number;
  stamina: number;
  phase: number;
  objective: string;
  progress: number;
  allies: number;
  enemies: number;
  interaction: boolean;
}

export interface GameStats {
  kills: number;
  duration: number;
  damage: number;
}

export interface GameEvents {
  onHud: (state: HudState) => void;
  onFeed: (message: string) => void;
  onPause: () => void;
  onVictory: (stats: GameStats) => void;
  onDamage: (strength: number) => void;
  onNetworkState: (state: Omit<NetworkPlayer, 'id' | 'name'>) => void;
  onBattleEvent: (type: 'gate-hit' | 'phase', value: number) => void;
}

type Team = 'allies' | 'enemies';
type Role = 'soldier' | 'archer' | 'brute' | 'boss' | 'player';

interface Actor {
  id: string;
  team: Team;
  role: Role;
  rig: KnightRig;
  health: number;
  maxHealth: number;
  stamina: number;
  speed: number;
  attackRange: number;
  damage: number;
  cooldown: number;
  action: RigAction;
  actionTime: number;
  hitDone: boolean;
  dead: boolean;
  target?: Actor;
  decisionTimer: number;
  strafe: number;
  lastAttacker?: Actor;
}

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  team: Team;
  damage: number;
  life: number;
  fire: boolean;
  trailTimer?: number;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity?: number;
  drag?: number;
  growth?: number;
  spin?: THREE.Vector3;
}

type ImpactSurface = 'earth' | 'stone' | 'wood' | 'armor';

interface ExplosiveProp {
  group: THREE.Group;
  kind: 'barrel' | 'mine';
  armed: boolean;
  triggerRadius: number;
  blastRadius: number;
  damage: number;
  team: Team | 'neutral';
}

interface RemoteRig {
  rig: KnightRig;
  targetPosition: THREE.Vector3;
  targetRotation: number;
  action: RigAction;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const PLAYER_START = new THREE.Vector3(0, 0, 27);

export class SiegeGame {
  readonly audio = new BattleAudio();
  private readonly canvas: HTMLCanvasElement;
  private readonly events: GameEvents;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.08, 180);
  private readonly clock = new THREE.Clock();
  private readonly random = seededRandom(0x5a17e);
  private readonly keys = new Set<string>();
  private readonly actors: Actor[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly particles: Particle[] = [];
  private readonly explosives: ExplosiveProp[] = [];
  private readonly remotes = new Map<string, RemoteRig>();
  private readonly temp = new THREE.Vector3();
  private readonly temp2 = new THREE.Vector3();
  private player!: Actor;
  private boss!: Actor;
  private gateLeft!: THREE.Group;
  private gateRight!: THREE.Group;
  private gateGroup!: THREE.Group;
  private ram!: THREE.Group;
  private ramHead!: THREE.Mesh;
  private banner!: THREE.Group;
  private sun!: THREE.DirectionalLight;
  private mode: 'preview' | 'running' | 'paused' | 'victory' = 'preview';
  private phase = 0;
  private gateHealth = 100;
  private captureProgress = 0;
  private yaw = Math.PI;
  private pitch = -0.13;
  private cameraShoulder = 1;
  private cameraShake = 0;
  private elapsed = 0;
  private kills = 0;
  private damageDone = 0;
  private ramStrikeTimer = 0;
  private fireballTimer = 2.5;
  private jumpTimer = 0;
  private readonly jumpDuration = 0.38;
  private readonly jumpDirection = new THREE.Vector3(0, 0, -1);
  private jumpTrailTimer = 0;
  private networkTimer = 0;
  private respawnTimer = 0;
  private lastHud = 0;
  private lastPointerLock = false;
  private isMobile = matchMedia('(pointer: coarse)').matches;
  private joystick = new THREE.Vector2();
  private quality: 'high' | 'medium' | 'low' = 'high';

  constructor(canvas: HTMLCanvasElement, events: GameEvents) {
    this.canvas = canvas;
    this.events = events;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.34;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.33, 0.7, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.buildWorld();
    this.spawnBattle();
    this.bindInput();
    this.resize();
    this.animate();
  }

  start(): void {
    this.mode = 'running';
    this.elapsed = 0;
    this.lastPointerLock = false;
    this.audio.horn();
    if (!this.isMobile) this.lockPointer();
    this.emitHud(true);
  }

  pause(): void {
    if (this.mode !== 'running') return;
    this.mode = 'paused';
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'running';
    if (!this.isMobile) this.lockPointer();
  }

  restart(): void {
    for (const actor of this.actors) this.scene.remove(actor.rig.root);
    this.actors.length = 0;
    for (const projectile of this.projectiles) this.scene.remove(projectile.mesh);
    this.projectiles.length = 0;
    for (const particle of this.particles) this.scene.remove(particle.mesh);
    this.particles.length = 0;
    this.phase = 0;
    this.gateHealth = 100;
    this.captureProgress = 0;
    this.kills = 0;
    this.damageDone = 0;
    this.elapsed = 0;
    this.respawnTimer = 0;
    this.jumpTimer = 0;
    this.jumpTrailTimer = 0;
    this.ram.position.set(0, 0, 15);
    this.gateLeft.rotation.y = 0;
    this.gateRight.rotation.y = 0;
    this.gateLeft.visible = true;
    this.gateRight.visible = true;
    this.banner.rotation.z = Math.PI / 2;
    for (const explosive of this.explosives) {
      explosive.armed = true;
      explosive.group.visible = true;
    }
    this.spawnBattle();
    this.start();
  }

  setVolume(value: number): void { this.audio.setVolume(value); }

  setQuality(quality: 'high' | 'medium' | 'low'): void {
    this.quality = quality;
    const ratio = quality === 'high' ? Math.min(devicePixelRatio, 1.75) : quality === 'medium' ? Math.min(devicePixelRatio, 1.25) : 0.85;
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.bloom.enabled = quality !== 'low';
    this.sun.shadow.mapSize.setScalar(quality === 'high' ? 2048 : 1024);
    this.resize();
  }

  setJoystick(x: number, y: number): void { this.joystick.set(clamp(x, -1, 1), clamp(y, -1, 1)); }
  attack(): void { this.playerAttack(); }
  setBlock(blocking: boolean): void { if (!this.player.dead && this.jumpTimer <= 0) this.player.action = blocking ? 'block' : 'idle'; }
  dodge(): void { this.playerDodge(); }

  syncRemotePlayers(players: NetworkPlayer[], localId: string): void {
    const active = new Set<string>();
    for (const player of players) {
      if (player.id === localId) continue;
      active.add(player.id);
      this.updateRemotePlayer(player);
    }
    for (const id of this.remotes.keys()) if (!active.has(id)) this.removeRemotePlayer(id);
  }

  updateRemotePlayer(player: NetworkPlayer): void {
    let remote = this.remotes.get(player.id);
    if (!remote) {
      const rig = createRemoteKnight();
      rig.root.position.set(player.x, player.y, player.z);
      this.scene.add(rig.root);
      remote = { rig, targetPosition: new THREE.Vector3(player.x, player.y, player.z), targetRotation: player.rotation, action: player.action };
      this.remotes.set(player.id, remote);
    }
    remote.targetPosition.set(player.x, player.y, player.z);
    remote.targetRotation = player.rotation;
    remote.action = player.action;
  }

  removeRemotePlayer(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.scene.remove(remote.rig.root);
    this.remotes.delete(id);
  }

  applyNetworkBattleEvent(type: 'gate-hit' | 'phase', value: number): void {
    if (type === 'gate-hit') this.gateHealth = Math.min(this.gateHealth, value);
    else {
      this.phase = Math.max(this.phase, Math.floor(value));
      if (this.phase >= 2) this.gateHealth = 0;
      if (this.phase >= 3) this.boss.rig.root.visible = true;
    }
  }

  private buildWorld(): void {
    this.scene.background = new THREE.Color(0x222a32);
    this.scene.fog = new THREE.FogExp2(0x2c3338, 0.015);

    const hemisphere = new THREE.HemisphereLight(0xa8bdd0, 0x392317, 1.8);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight(0xffd4a8, 4.15);
    this.sun.position.set(-24, 42, 21);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -50;
    this.sun.shadow.camera.right = 50;
    this.sun.shadow.camera.top = 50;
    this.sun.shadow.camera.bottom = -50;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 110;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);

    const groundTexture = this.createGroundTexture();
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(22, 30);
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 190, 64, 80),
      new THREE.MeshStandardMaterial({ map: groundTexture, bumpMap: groundTexture, bumpScale: 0.09, color: 0x655e4b, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.03, -20);
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.buildCastle();
    this.buildBattlefield();
    this.buildSkyline();
    this.camera.position.set(19, 10, 46);
    this.camera.lookAt(0, 5, -24);
  }

  private buildCastle(): void {
    const stoneTexture = this.createStoneTexture();
    stoneTexture.wrapS = stoneTexture.wrapT = THREE.RepeatWrapping;
    stoneTexture.repeat.set(3.5, 2.5);
    stoneTexture.colorSpace = THREE.SRGBColorSpace;
    const woodTexture = this.createWoodTexture();
    woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
    woodTexture.repeat.set(2, 3);
    woodTexture.colorSpace = THREE.SRGBColorSpace;
    const stone = new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.12, color: 0x86837b, roughness: 0.88, metalness: 0.03 });
    const darkStone = new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.15, color: 0x505457, roughness: 0.93 });
    const paleStone = new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.1, color: 0xa19a8e, roughness: 0.86 });
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture, bumpMap: woodTexture, bumpScale: 0.09, color: 0x5a2f18, roughness: 0.84, metalness: 0.04 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x242629, metalness: 0.82, roughness: 0.3 });

    const makeBox = (size: THREE.Vector3, position: THREE.Vector3, material: THREE.Material, cast = true): THREE.Mesh => {
      const item = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
      item.position.copy(position);
      item.castShadow = cast;
      item.receiveShadow = true;
      this.scene.add(item);
      return item;
    };

    makeBox(new THREE.Vector3(21, 9, 3.2), new THREE.Vector3(-15.5, 4.5, -27), stone);
    makeBox(new THREE.Vector3(21, 9, 3.2), new THREE.Vector3(15.5, 4.5, -27), stone);
    makeBox(new THREE.Vector3(3.2, 10, 55), new THREE.Vector3(-27, 5, -54.5), stone);
    makeBox(new THREE.Vector3(3.2, 10, 55), new THREE.Vector3(27, 5, -54.5), stone);
    makeBox(new THREE.Vector3(54, 13, 3.2), new THREE.Vector3(0, 6.5, CASTLE_LIMITS.backWallZ), darkStone);

    makeBox(new THREE.Vector3(31, 3, 13), new THREE.Vector3(0, 1.5, -52.5), darkStone);
    makeBox(new THREE.Vector3(25, 6, 18), new THREE.Vector3(0, 3, -73), darkStone);
    this.createStaircase(12, 12, CASTLE_LIMITS.firstStairStartZ, CASTLE_LIMITS.firstStairEndZ, 0, CASTLE_LIMITS.firstTerraceHeight, paleStone);
    this.createStaircase(10, 12, CASTLE_LIMITS.secondStairStartZ, CASTLE_LIMITS.secondStairEndZ, CASTLE_LIMITS.firstTerraceHeight, CASTLE_LIMITS.summitHeight, paleStone);

    for (const x of [-24, -21, -18, -15, -12, -9, 9, 12, 15, 18, 21, 24]) {
      makeBox(new THREE.Vector3(1.7, 1.4, 2.3), new THREE.Vector3(x, 9.7, -27), stone);
    }
    for (const z of [-31, -36, -41, -46, -51, -56, -61, -66, -71, -76, -80]) {
      makeBox(new THREE.Vector3(2.3, 1.4, 1.7), new THREE.Vector3(-27, 10.7, z), stone);
      makeBox(new THREE.Vector3(2.3, 1.4, 1.7), new THREE.Vector3(27, 10.7, z), stone);
    }

    for (const x of [-25, 25]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.8, 11, 12), stone);
      tower.position.set(x, 5.5, -27);
      tower.castShadow = tower.receiveShadow = true;
      this.scene.add(tower);
      for (let index = 0; index < 12; index += 2) {
        const merlon = makeBox(new THREE.Vector3(1.4, 1.4, 1.4), new THREE.Vector3(), stone);
        const angle = index / 12 * Math.PI * 2;
        merlon.position.set(x + Math.sin(angle) * 4, 11.1, -27 + Math.cos(angle) * 4);
        merlon.rotation.y = angle;
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5, 3.6, 12), new THREE.MeshStandardMaterial({ color: 0x2b2c2f, metalness: 0.65, roughness: 0.5 }));
      roof.position.set(x, 13.2, -27);
      roof.castShadow = true;
      this.scene.add(roof);
    }

    const gateArch = new THREE.Mesh(new THREE.TorusGeometry(4, 1.25, 8, 24, Math.PI), paleStone);
    gateArch.position.set(0, 4.05, -25.7);
    gateArch.castShadow = true;
    this.scene.add(gateArch);
    const keystone = makeBox(new THREE.Vector3(1.3, 1.8, 1.25), new THREE.Vector3(0, 9.05, -25.65), paleStone);
    keystone.rotation.z = Math.PI / 4;
    for (const side of [-1, 1]) {
      makeBox(new THREE.Vector3(1.45, 4.5, 1.55), new THREE.Vector3(side * 4.62, 2.25, -25.68), paleStone);
      makeBox(new THREE.Vector3(2.05, 0.72, 1.9), new THREE.Vector3(side * 4.62, 0.36, -25.66), darkStone);
    }
    makeBox(new THREE.Vector3(9.25, 0.32, 1.65), new THREE.Vector3(0, 0.14, -25.65), darkStone);

    this.gateGroup = new THREE.Group();
    this.gateGroup.position.set(0, 0, -25.5);
    this.scene.add(this.gateGroup);
    this.gateLeft = new THREE.Group();
    this.gateRight = new THREE.Group();
    this.gateLeft.position.set(-3.9, 3.5, 0);
    this.gateRight.position.set(3.9, 3.5, 0);
    this.gateGroup.add(this.gateLeft, this.gateRight);
    for (const [door, direction] of [[this.gateLeft, 1], [this.gateRight, -1]] as [THREE.Group, number][]) {
      const leaf = new THREE.Group();
      leaf.position.x = direction * 1.95;
      door.add(leaf);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3.9, 7, 0.45), wood);
      slab.castShadow = slab.receiveShadow = true;
      leaf.add(slab);
      for (const y of [-2.5, -0.8, 0.9, 2.6]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(4.05, 0.16, 0.56), iron);
        brace.position.y = y;
        leaf.add(brace);
      }
      const bottomBrace = new THREE.Mesh(new THREE.BoxGeometry(4.05, 0.28, 0.59), iron);
      bottomBrace.position.y = -3.34;
      leaf.add(bottomBrace);
      for (const x of [-1.25, 1.25]) {
        const verticalBrace = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6.82, 0.58), iron);
        verticalBrace.position.set(x, 0, 0);
        leaf.add(verticalBrace);
      }
      for (const x of [-1.45, -0.72, 0, 0.72, 1.45]) {
        const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8), iron);
        stud.rotation.x = Math.PI / 2;
        stud.position.set(x, 0, 0.28);
        leaf.add(stud);
      }
    }

    for (const [x, z, base] of [[-14, -67, 6], [14, -67, 6]] as [number, number, number][]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.1, 12, 12), darkStone);
      tower.position.set(x, base + 6, z);
      tower.castShadow = tower.receiveShadow = true;
      this.scene.add(tower);
      for (let index = 0; index < 12; index += 2) {
        const angle = index / 12 * Math.PI * 2;
        const merlon = makeBox(new THREE.Vector3(1.2, 1.5, 1.2), new THREE.Vector3(x + Math.sin(angle) * 3.4, base + 12.4, z + Math.cos(angle) * 3.4), darkStone);
        merlon.rotation.y = angle;
      }
    }

    const keep = makeBox(new THREE.Vector3(20, 20, 7), new THREE.Vector3(0, 16, -78), darkStone);
    for (const x of [-8, -4, 0, 4, 8]) {
      const merlon = makeBox(new THREE.Vector3(2, 1.7, 1.6), new THREE.Vector3(x, 26.8, -75.5), darkStone);
      merlon.castShadow = true;
    }
    const keepDoor = makeBox(new THREE.Vector3(4, 6, 0.35), new THREE.Vector3(0, 9, -74.35), wood);
    keepDoor.castShadow = true;

    this.banner = this.createBanner(0xa52922, 0xd6ae60, true);
    this.banner.position.set(0, CASTLE_LIMITS.summitHeight, -72.8);
    this.banner.rotation.z = Math.PI / 2;
    this.scene.add(this.banner);

    for (const position of [
      new THREE.Vector3(-5.2, 1.5, -25),
      new THREE.Vector3(5.2, 1.5, -25),
      new THREE.Vector3(-8, 4.5, -50),
      new THREE.Vector3(8, 4.5, -50),
      new THREE.Vector3(-7, 7.5, -69),
      new THREE.Vector3(7, 7.5, -69),
    ]) {
      this.createTorch(position);
    }
    for (const position of [
      new THREE.Vector3(-22.2, 10.45, -24.15),
      new THREE.Vector3(22.2, 10.45, -24.15),
      new THREE.Vector3(-14, 18.15, -63.6),
      new THREE.Vector3(14, 18.15, -63.6),
    ]) this.createCastleCannon(position);
    void keep;
  }

  private createStaircase(
    width: number,
    steps: number,
    startZ: number,
    endZ: number,
    baseHeight: number,
    topHeight: number,
    material: THREE.Material,
  ): void {
    const depth = Math.abs(endZ - startZ) / steps;
    for (let index = 0; index < steps; index += 1) {
      const progress = (index + 1) / steps;
      const height = baseHeight + (topHeight - baseHeight) * progress;
      const step = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth + 0.04), material);
      step.position.set(0, height * 0.5, startZ - depth * (index + 0.5));
      step.castShadow = step.receiveShadow = true;
      this.scene.add(step);
    }
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x3c4143, metalness: 0.65, roughness: 0.4 });
    for (const side of [-1, 1]) {
      for (let index = 0; index <= steps; index += 2) {
        const progress = index / steps;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.16), railMaterial);
        post.position.set(side * (width * 0.5 - 0.2), baseHeight + (topHeight - baseHeight) * progress + 0.52, startZ - Math.abs(endZ - startZ) * progress);
        post.castShadow = true;
        this.scene.add(post);
      }
    }
  }

  private createCastleCannon(position: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.copy(position);
    const iron = new THREE.MeshStandardMaterial({ color: 0x181b1e, metalness: 0.9, roughness: 0.28 });
    const ember = new THREE.MeshStandardMaterial({ color: 0x62210f, emissive: 0xff3b0b, emissiveIntensity: 0.55, roughness: 0.5 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x4f2b18, roughness: 0.9 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 2.65, 12), iron);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.4, 0.72);
    barrel.castShadow = true;
    group.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.065, 7, 12), ember);
    muzzle.position.set(0, 0.4, 2.06);
    group.add(muzzle);
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.18, 10), wood);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.48, 0.08, 0.15);
      wheel.castShadow = true;
      group.add(wheel);
    }
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.26, 1.55), wood);
    carriage.position.set(0, 0.12, 0.15);
    carriage.castShadow = true;
    group.add(carriage);
    this.scene.add(group);
  }

  private buildBattlefield(): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2b18, roughness: 0.94 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x303235, metalness: 0.82, roughness: 0.36 });
    this.ram = new THREE.Group();
    this.ram.position.set(0, 0, 15);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.72, 7.2, 8), wood);
    beam.rotation.x = Math.PI / 2;
    beam.position.set(0, 1.45, -0.25);
    beam.castShadow = true;
    this.ram.add(beam);
    this.ramHead = new THREE.Mesh(new THREE.ConeGeometry(0.73, 1.4, 8), iron);
    this.ramHead.rotation.x = -Math.PI / 2;
    this.ramHead.position.set(0, 1.45, -4.45);
    this.ramHead.castShadow = true;
    this.ram.add(this.ramHead);
    for (const x of [-1.35, 1.35]) {
      for (const z of [-2.35, 2.35]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 10), wood);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.62, z);
        wheel.castShadow = true;
        this.ram.add(wheel);
      }
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 5.4), wood);
      support.position.set(x, 1.5, 0);
      support.castShadow = true;
      this.ram.add(support);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.22, 6.3), new THREE.MeshStandardMaterial({ color: 0x4d2a22, roughness: 1 }));
    canopy.position.y = 2.75;
    canopy.castShadow = true;
    this.ram.add(canopy);
    this.scene.add(this.ram);

    for (let index = 0; index < 55; index += 1) {
      const x = (this.random() - 0.5) * 78;
      const z = (this.random() - 0.45) * 66;
      if (Math.abs(x) < 7 && z > -30) continue;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.18 + this.random() * 0.75, 0),
        new THREE.MeshStandardMaterial({ color: 0x57554d, roughness: 1 }),
      );
      rock.position.set(x, rock.geometry.boundingSphere?.radius ?? 0.2, z);
      rock.scale.y = 0.45 + this.random() * 0.6;
      rock.rotation.set(this.random(), this.random() * Math.PI, this.random());
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
    }

    for (let index = 0; index < 14; index += 1) {
      const x = (index % 2 ? 1 : -1) * (10 + this.random() * 25);
      const z = 4 + this.random() * 32;
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 3 + this.random() * 2.8, 5), new THREE.MeshStandardMaterial({ color: 0x211a14, roughness: 1 }));
      stake.position.set(x, 1.2, z);
      stake.rotation.z = (this.random() - 0.5) * 0.3;
      stake.castShadow = true;
      this.scene.add(stake);
    }

    for (const [x, z] of [[-14, 28], [15, 32], [-23, 20], [25, 12]] as [number, number][]) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.7, 3.1, 4), new THREE.MeshStandardMaterial({ color: 0x3d4e4c, roughness: 1, side: THREE.DoubleSide }));
      tent.position.set(x, 1.55, z);
      tent.rotation.y = Math.PI / 4;
      tent.scale.z = 1.35;
      tent.castShadow = true;
      this.scene.add(tent);
      this.createTorch(new THREE.Vector3(x + 3.3, 0.2, z));
    }

    for (const [x, z, scale] of [
      [-34, 30, 1.25], [-29, 12, 0.95], [33, 26, 1.2], [37, 4, 0.9],
      [-36, -12, 1.1], [36, -18, 1.25], [-22, -63, 0.85], [22, -70, 0.9],
    ] as [number, number, number][]) this.createBattleTree(x, z, scale);

    for (const [x, z, layers] of [
      [-11, 7, 2], [12, -7, 3], [-18, -17, 2], [9, -35, 3], [-10, -51, 2], [7, -68, 2],
    ] as [number, number, number][]) this.createCrateStack(x, z, layers);

    for (const [x, z, rotation] of [
      [-8, 1, 0.18], [9, -14, -0.2], [-12, -33, 0.08], [10, -55, -0.12],
    ] as [number, number, number][]) this.createBarricade(x, z, rotation);

    for (const [x, z] of [
      [-6, -9], [7, -15], [-13, -34], [11, -49], [-8, -67], [8, -70],
    ] as [number, number][]) this.createExplosiveBarrel(x, z);

    for (const [x, z] of [[-10, 5], [11, -4], [-7, -36], [6, -54], [-5, -65]] as [number, number][]) {
      this.createMine(x, z, 'enemies');
    }
  }

  private createBattleTree(x: number, z: number, scale: number): void {
    const ground = castleGroundHeight(x, z);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x35261b, roughness: 1 });
    const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x263f34, roughness: 0.96, flatShading: true });
    const tree = new THREE.Group();
    tree.position.set(x, ground, z);
    tree.scale.setScalar(scale);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.48, 4.8, 7), trunkMaterial);
    trunk.position.y = 2.4;
    trunk.castShadow = trunk.receiveShadow = true;
    tree.add(trunk);
    for (const [ox, oy, oz, size] of [[0, 5.2, 0, 2.4], [-1, 4.7, 0.3, 1.7], [1, 4.9, -0.2, 1.8], [0.2, 6.3, 0.1, 1.55]] as [number, number, number, number][]) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), crownMaterial);
      crown.position.set(ox, oy, oz);
      crown.scale.y = 0.78;
      crown.castShadow = crown.receiveShadow = true;
      tree.add(crown);
    }
    tree.rotation.y = this.random() * Math.PI;
    this.scene.add(tree);
  }

  private createCrateStack(x: number, z: number, layers: number): void {
    const material = new THREE.MeshStandardMaterial({ map: this.createWoodTexture(), color: 0x704526, roughness: 0.9 });
    const ground = castleGroundHeight(x, z);
    for (let layer = 0; layer < layers; layer += 1) {
      const count = Math.max(1, layers - layer);
      for (let index = 0; index < count; index += 1) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), material);
        crate.position.set(x + (index - (count - 1) / 2) * 1.08, ground + 0.54 + layer * 1.06, z);
        crate.rotation.y = (this.random() - 0.5) * 0.18;
        crate.castShadow = crate.receiveShadow = true;
        this.scene.add(crate);
      }
    }
  }

  private createBarricade(x: number, z: number, rotation: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    group.rotation.y = rotation;
    const wood = new THREE.MeshStandardMaterial({ color: 0x4b2c18, roughness: 0.95 });
    for (const offset of [-1.4, 0, 1.4]) {
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 2.8, 6), wood);
      stake.position.set(offset, 0.95, 0);
      stake.rotation.z = Math.PI * 0.42;
      stake.castShadow = true;
      group.add(stake);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.28, 0.3), wood);
    beam.position.y = 0.85;
    beam.castShadow = true;
    group.add(beam);
    this.scene.add(group);
  }

  private createExplosiveBarrel(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b351d, roughness: 0.82 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x292c30, metalness: 0.78, roughness: 0.32 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.46, 1.35, 12), wood);
    body.position.y = 0.68;
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    for (const y of [0.18, 0.68, 1.18]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 6, 12), iron);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      group.add(band);
    }
    const warning = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff3100, emissiveIntensity: 2.5 }));
    warning.position.set(0, 1.43, 0);
    group.add(warning);
    this.scene.add(group);
    this.explosives.push({ group, kind: 'barrel', armed: true, triggerRadius: 0.75, blastRadius: 5.5, damage: 82, team: 'neutral' });
  }

  private createMine(x: number, z: number, team: Team): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z) + 0.08, z);
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c3031, metalness: 0.75, roughness: 0.38 });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.62, 0.18, 10), metal);
    plate.castShadow = true;
    group.add(plate);
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 5), metal);
      spike.position.set(Math.sin(angle) * 0.42, 0.18, Math.cos(angle) * 0.42);
      spike.rotation.z = Math.sin(angle) * 0.7;
      spike.rotation.x = Math.cos(angle) * -0.7;
      group.add(spike);
    }
    const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff4a18 }));
    fuse.position.y = 0.2;
    fuse.name = 'mine-fuse';
    group.add(fuse);
    this.scene.add(group);
    this.explosives.push({ group, kind: 'mine', armed: true, triggerRadius: 1.35, blastRadius: 4.6, damage: 68, team });
  }

  private buildSkyline(): void {
    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x20272b, roughness: 1, flatShading: true });
    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2;
      const radius = 118 + this.random() * 30;
      const height = 20 + this.random() * 34;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(10 + this.random() * 12, height, 5), mountainMaterial);
      mountain.position.set(Math.sin(angle) * radius, height * 0.5 - 1, Math.cos(angle) * radius);
      mountain.rotation.y = this.random() * Math.PI;
      this.scene.add(mountain);
    }
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 12), new THREE.MeshBasicMaterial({ color: 0xf5c990 }));
    moon.position.set(58, 45, -126);
    this.scene.add(moon);
  }

  private spawnBattle(): void {
    this.player = this.createActor('player', 'allies', 180, 4.9, 3.1, 36);
    this.player.rig.root.position.copy(PLAYER_START);
    this.player.rig.setGroundHeight(0);

    for (let index = 0; index < 22; index += 1) {
      const role: Role = index % 10 === 0 ? 'brute' : index % 6 === 0 ? 'archer' : 'soldier';
      const actor = this.createActor(
        role,
        'allies',
        role === 'brute' ? 175 : role === 'archer' ? 76 : 108,
        role === 'brute' ? 3.25 : role === 'archer' ? 3.25 : 3.82,
        role === 'archer' ? 15 : role === 'brute' ? 2.8 : 2.4,
        role === 'brute' ? 31 : role === 'archer' ? 14 : 19,
      );
      actor.rig.root.position.set((index % 6 - 2.5) * 2.4 + (this.random() - 0.5), 0, 11 + Math.floor(index / 6) * 3.1);
      actor.rig.setGroundHeight(0);
    }

    for (let index = 0; index < 34; index += 1) {
      const role: Role = index % 11 === 0 ? 'brute' : index % 7 === 0 ? 'archer' : 'soldier';
      const actor = this.createActor(
        role,
        'enemies',
        role === 'brute' ? 190 : role === 'archer' ? 70 : 96,
        role === 'brute' ? 3.05 : role === 'archer' ? 3.12 : 3.66,
        role === 'archer' ? 16 : role === 'brute' ? 2.9 : 2.3,
        role === 'brute' ? 34 : role === 'archer' ? 12 : 17,
      );
      let x: number;
      let z: number;
      if (index < 15) {
        x = (index % 7 - 3) * 3.1 + (this.random() - 0.5) * 1.2;
        z = -5 - Math.floor(index / 7) * 3.3;
      } else if (index < 25) {
        x = (index % 5 - 2) * 3.2;
        z = -49 - Math.floor((index - 15) / 5) * 4.2;
      } else {
        x = (index % 5 - 2) * 2.8;
        z = -66.5 - Math.floor((index - 25) / 5) * 4;
      }
      const height = castleGroundHeight(x, z);
      actor.rig.root.position.set(x, height, z);
      actor.rig.setGroundHeight(height);
    }

    this.boss = this.createActor('boss', 'enemies', 760, 3.55, 3.5, 42);
    this.boss.rig.root.position.set(0, CASTLE_LIMITS.summitHeight, CASTLE_LIMITS.summitZ - 2);
    this.boss.rig.setGroundHeight(CASTLE_LIMITS.summitHeight);
    this.boss.rig.root.visible = false;
    this.boss.dead = false;
    this.emitHud(true);
  }

  private createActor(role: Role, team: Team, health: number, speed: number, attackRange: number, damage: number): Actor {
    const rigRole = role === 'player' ? 'soldier' : role;
    const rig = new KnightRig(team, rigRole);
    rig.root.rotation.y = team === 'allies' ? Math.PI : 0;
    this.scene.add(rig.root);
    const actor: Actor = {
      id: `${team}-${role}-${this.actors.length}`,
      team,
      role,
      rig,
      health,
      maxHealth: health,
      stamina: 100,
      speed,
      attackRange,
      damage,
      cooldown: this.random(),
      action: 'idle',
      actionTime: 0,
      hitDone: false,
      dead: false,
      decisionTimer: 0,
      strafe: this.random() > 0.5 ? 1 : -1,
    };
    this.actors.push(actor);
    return actor;
  }

  private bindInput(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === 'KeyC') this.cameraShoulder *= -1;
      if (event.code === 'Space') {
        event.preventDefault();
        this.playerDodge();
      }
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (event) => {
      if (this.mode !== 'running' || document.pointerLockElement !== this.canvas) return;
      this.yaw -= event.movementX * 0.0022;
      this.pitch = clamp(this.pitch - event.movementY * 0.0018, -0.62, 0.42);
    });
    this.canvas.addEventListener('mousedown', (event) => {
      if (this.mode !== 'running') return;
      if (document.pointerLockElement !== this.canvas && !this.isMobile) {
        this.lockPointer();
        return;
      }
      if (event.button === 0) this.playerAttack();
      if (event.button === 2) this.setBlock(true);
    });
    window.addEventListener('mouseup', (event) => { if (event.button === 2) this.setBlock(false); });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) this.lastPointerLock = true;
      if (!locked && this.lastPointerLock && this.mode === 'running') {
        this.mode = 'paused';
        this.events.onPause();
      }
    });
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    if (this.mode === 'preview') this.updatePreview(time, delta);
    if (this.mode === 'running') this.updateGame(time, delta);
    if (this.mode === 'paused') this.updateParticles(delta);
    this.updateRemotePlayers(time, delta);
    this.updateGateVisual(delta);
    this.updateTorches(time);
    this.composer.render();
  };

  private updatePreview(time: number, delta: number): void {
    const orbit = time * 0.045;
    const targetPosition = new THREE.Vector3(Math.sin(orbit) * 23, 8.5 + Math.sin(time * 0.17) * 1.5, 34 + Math.cos(orbit) * 10);
    this.camera.position.lerp(targetPosition, 1 - Math.exp(-1.4 * delta));
    this.camera.lookAt(0, 4.2, -19);
    for (const actor of this.actors) actor.rig.update(time, delta);
    this.updateParticles(delta);
  }

  private updateGame(time: number, delta: number): void {
    this.elapsed += delta;
    this.updatePlayer(delta);
    this.updateObjectives(delta);
    this.updateActors(time, delta);
    this.updateProjectiles(delta);
    this.updateExplosives(time);
    this.updateParticles(delta);
    this.updateCamera(delta);
    this.updateRespawn(delta);
    this.networkTimer -= delta;
    if (this.networkTimer <= 0) {
      this.networkTimer = 0.09;
      const position = this.player.rig.root.position;
      this.events.onNetworkState({
        x: position.x,
        y: position.y,
        z: position.z,
        rotation: this.player.rig.root.rotation.y,
        health: this.player.health,
        action: this.player.action,
      });
    }
    this.emitHud();
  }

  private updatePlayer(delta: number): void {
    if (this.player.dead) return;
    this.player.cooldown = Math.max(0, this.player.cooldown - delta);
    this.player.actionTime += delta;
    if (this.player.action === 'attack' && this.player.actionTime > 0.58) this.player.action = 'idle';
    if (this.player.action === 'block') this.player.stamina = Math.max(0, this.player.stamina - delta * 8);
    else this.player.stamina = Math.min(100, this.player.stamina + delta * 17);

    const inputX = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) + this.joystick.x;
    const inputZ = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0) - this.joystick.y;
    const inputStrength = Math.min(1, Math.hypot(inputX, inputZ));
    if (this.jumpTimer > 0) {
      const progress = clamp((this.jumpDuration - this.jumpTimer) / this.jumpDuration, 0, 1);
      const jumpSpeed = 4 + Math.sin(progress * Math.PI) * 15;
      this.player.rig.root.position.addScaledVector(this.jumpDirection, jumpSpeed * delta);
      this.resolveWorldCollision(this.player.rig.root.position);
      this.resolveRamCollision(this.player.rig.root.position);
      this.player.rig.setVerticalOffset(Math.sin(progress * Math.PI) * 0.66);
      this.player.rig.setGroundHeight(castleGroundHeight(this.player.rig.root.position.x, this.player.rig.root.position.z));
      this.player.rig.root.rotation.y = dampAngle(
        this.player.rig.root.rotation.y,
        Math.atan2(this.jumpDirection.x, this.jumpDirection.z),
        18,
        delta,
      );
      this.player.action = 'jump';
      this.jumpTrailTimer -= delta;
      if (this.jumpTrailTimer <= 0) {
        this.jumpTrailTimer = 0.045;
        this.spawnJumpTrail(this.player.rig.root.position, this.jumpDirection);
      }
      this.jumpTimer = Math.max(0, this.jumpTimer - delta);
      if (this.jumpTimer <= 0) {
        this.player.rig.setVerticalOffset(0);
        this.player.rig.setGroundHeight(castleGroundHeight(this.player.rig.root.position.x, this.player.rig.root.position.z));
        this.player.action = 'idle';
      }
      this.player.rig.setState(this.player.action, 1.35, delta);
      return;
    }
    this.player.rig.setVerticalOffset(0);
    const sprint = this.keys.has('ShiftLeft') && this.player.stamina > 8 ? 1.38 : 1;
    if (sprint > 1 && inputStrength > 0.01) this.player.stamina = Math.max(0, this.player.stamina - delta * 12);
    const moveSpeed = this.player.speed * sprint * (this.player.action === 'block' ? 0.38 : 1);
    const direction = movementDirection(inputX, inputZ, this.yaw);
    if (direction) {
      this.temp.set(direction.x, 0, direction.z);
      this.player.rig.root.position.addScaledVector(this.temp, moveSpeed * delta);
      if (this.player.action !== 'attack' && this.player.action !== 'block') this.player.action = 'run';
      this.player.rig.root.rotation.y = dampAngle(this.player.rig.root.rotation.y, Math.atan2(direction.x, direction.z), 12, delta);
    } else if (this.player.action === 'run') this.player.action = 'idle';
    this.resolveWorldCollision(this.player.rig.root.position);
    this.resolveRamCollision(this.player.rig.root.position);
    this.syncActorGround(this.player, delta);
    this.player.rig.setState(this.player.action, inputStrength, delta);
  }

  private updateObjectives(delta: number): void {
    if (this.phase === 0) {
      const playerNear = distanceXZ(this.player.rig.root.position, this.ram.position) < 16;
      const nearbyAllies = this.actors.filter((actor) => !actor.dead && actor.team === 'allies' && distanceXZ(actor.rig.root.position, this.ram.position) < 8).length;
      if (playerNear && nearbyAllies >= 2) this.ram.position.z = Math.max(-21.9, this.ram.position.z - delta * 1.25);
      if (this.ram.position.z <= -21.85) {
        this.phase = 1;
        this.ramStrikeTimer = 0.4;
        this.audio.horn();
        this.events.onFeed('<b>Таран у ворот.</b> Защитите расчёт!');
        this.events.onBattleEvent('phase', 1);
      }
    } else if (this.phase === 1) {
      this.ramStrikeTimer -= delta;
      if (this.ramStrikeTimer <= 0 && this.gateHealth > 0) {
        this.ramStrikeTimer = 2.65;
        this.damageGate(14);
        this.cameraShake = Math.max(this.cameraShake, 0.7);
        this.audio.ram();
        this.spawnImpact(new THREE.Vector3(0, 2.4, -25), 0xb56a31, 15);
      }
      if (this.gateHealth <= 0) this.breakGate();
    } else if (this.phase === 2) {
      const summitAllies = this.actors.filter((actor) => actor.team === 'allies' && !actor.dead && actor.rig.root.position.z < CASTLE_LIMITS.secondStairEndZ + 0.5).length;
      if (this.player.rig.root.position.z < CASTLE_LIMITS.secondStairEndZ + 0.5 && summitAllies >= 3) {
        this.phase = 3;
        this.boss.rig.root.visible = true;
        this.audio.horn();
        this.events.onFeed('<b>Верхний двор взят.</b> Варгрим вышел к последней лестнице!');
        this.events.onBattleEvent('phase', 3);
      }
    } else if (this.phase === 3) {
      if (this.boss.dead) {
        const near = distanceXZ(this.player.rig.root.position, this.banner.position) < 4.2;
        if (near && this.keys.has('KeyE')) this.captureProgress = Math.min(100, this.captureProgress + delta * 34);
        else this.captureProgress = Math.max(0, this.captureProgress - delta * 5);
        if (this.captureProgress >= 100) this.victory();
      }
    }
    this.fireballTimer -= delta;
    if (this.fireballTimer <= 0 && this.phase < 3) {
      this.fireballTimer = 5.5 + this.random() * 4;
      this.launchFireball();
    }
  }

  private updateActors(time: number, delta: number): void {
    for (const actor of this.actors) {
      if (actor === this.player) continue;
      actor.cooldown = Math.max(0, actor.cooldown - delta);
      actor.actionTime += delta;
      if (actor.dead) {
        actor.rig.setState('dead', 0, delta);
        actor.rig.update(time, delta);
        continue;
      }
      if (actor === this.boss && this.phase < 3) continue;
      actor.decisionTimer -= delta;
      if (actor.decisionTimer <= 0) {
        actor.decisionTimer = 0.22 + this.random() * 0.26;
        actor.target = this.findTarget(actor);
      }
      const target = actor.target;
      let moving = false;
      if (target && !target.dead) {
        const distance = distanceXZ(actor.rig.root.position, target.rig.root.position);
        const desiredRange = actor.role === 'archer' ? 11.5 : actor.role === 'brute' ? 2.4 : actor.attackRange * 0.78;
        const direction = this.temp.subVectors(target.rig.root.position, actor.rig.root.position);
        direction.y = 0;
        if (direction.lengthSq() > 0.01) direction.normalize();
        actor.rig.root.rotation.y = dampAngle(actor.rig.root.rotation.y, Math.atan2(direction.x, direction.z), 9, delta);
        if (distance > desiredRange && actor.action !== 'attack') {
          const separation = this.computeSeparation(actor);
          const strafe = this.temp2.set(direction.z, 0, -direction.x).multiplyScalar(actor.role === 'archer' ? actor.strafe * 0.25 : 0);
          actor.rig.root.position.addScaledVector(direction.add(strafe).add(separation), actor.speed * delta);
          moving = true;
          actor.action = 'run';
        } else if (actor.cooldown <= 0 && actor.action !== 'attack') {
          actor.action = 'attack';
          actor.actionTime = 0;
          actor.hitDone = false;
          actor.cooldown = actor.role === 'boss' ? 0.86 : actor.role === 'brute' ? 1.35 : actor.role === 'archer' ? 1.9 + this.random() : 1.1 + this.random() * 0.45;
          if (actor.role === 'archer') this.audio.bow();
        }
      } else {
        const destination = this.getActorDestination(actor);
        const direction = this.temp.subVectors(destination, actor.rig.root.position);
        direction.y = 0;
        if (direction.lengthSq() > 1) {
          const separation = this.computeSeparation(actor).multiplyScalar(1.25);
          direction.normalize().add(separation);
          if (direction.lengthSq() > 1) direction.normalize();
          actor.rig.root.position.addScaledVector(direction, actor.speed * delta * 0.72);
          actor.rig.root.rotation.y = dampAngle(actor.rig.root.rotation.y, Math.atan2(direction.x, direction.z), 6, delta);
          actor.action = 'run';
          moving = true;
        } else actor.action = 'idle';
      }

      if (actor.action === 'attack') {
        const impactMoment = actor.role === 'archer' ? 0.52 : actor.role === 'brute' || actor.role === 'boss' ? 0.39 : 0.31;
        if (!actor.hitDone && actor.actionTime >= impactMoment) {
          actor.hitDone = true;
          if (actor.role === 'archer') this.fireArrow(actor);
          else this.actorMeleeHit(actor);
        }
        const duration = actor.role === 'archer' ? 0.78 : actor.role === 'brute' || actor.role === 'boss' ? 0.76 : 0.62;
        if (actor.actionTime >= duration) actor.action = 'idle';
      } else if (!moving && this.random() < delta * 0.08 && actor.role !== 'boss') {
        actor.action = 'block';
      } else if (actor.action === 'block' && actor.actionTime > 0.7) actor.action = 'idle';

      this.resolveWorldCollision(actor.rig.root.position);
      this.syncActorGround(actor, delta);
      actor.rig.setState(actor.action, moving ? 1 : 0, delta);
      actor.rig.update(time, delta);
    }
    this.player.rig.update(time, delta);
  }

  private findTarget(actor: Actor): Actor | undefined {
    let best: Actor | undefined;
    let bestDistance = actor.role === 'archer' ? 22 : 11;
    for (const candidate of this.actors) {
      if (candidate.dead || candidate.team === actor.team || candidate === this.boss && this.phase < 3) continue;
      if (Math.abs(candidate.rig.root.position.y - actor.rig.root.position.y) > 4.25) continue;
      const distance = distanceXZ(actor.rig.root.position, candidate.rig.root.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  private getActorDestination(actor: Actor): THREE.Vector3 {
    const index = Number(actor.id.split('-').at(-1));
    const lane = (index % 5 - 2) * 1.8;
    if (actor.team === 'allies') {
      if (this.phase < 2) {
        const escort = ramEscortOffset(index - 1);
        return new THREE.Vector3(this.ram.position.x + escort.x, 0, this.ram.position.z + escort.z);
      }
      if (actor.rig.root.position.z > CASTLE_LIMITS.firstStairEndZ) return new THREE.Vector3(lane, 0, -49);
      if (actor.rig.root.position.z > CASTLE_LIMITS.secondStairEndZ) return new THREE.Vector3(lane * 0.78, 0, -67);
      return new THREE.Vector3(lane * 1.15, 0, -69.5);
    }
    if (this.phase < 2 && actor.rig.root.position.z < -28) return actor.rig.root.position.clone();
    if (this.phase < 2) return new THREE.Vector3(lane * 1.2, 0, -8);
    if (actor.rig.root.position.z < CASTLE_LIMITS.secondStairEndZ) return new THREE.Vector3(lane, 0, -68.5);
    if (actor.rig.root.position.z < CASTLE_LIMITS.firstStairEndZ) return new THREE.Vector3(lane * 1.2, 0, -52);
    return new THREE.Vector3(lane * 1.3, 0, -34);
  }

  private computeSeparation(actor: Actor): THREE.Vector3 {
    const force = new THREE.Vector3();
    const minimumSpacing = actor.team === 'allies' && this.phase < 2 ? 1.35 : 1.05;
    for (const other of this.actors) {
      if (other === actor || other.dead) continue;
      if (Math.abs(actor.rig.root.position.y - other.rig.root.position.y) > 2.5) continue;
      const distance = distanceXZ(actor.rig.root.position, other.rig.root.position);
      if (distance > 0 && distance < minimumSpacing) {
        force.add(this.temp2.subVectors(actor.rig.root.position, other.rig.root.position).setY(0).normalize().multiplyScalar((minimumSpacing - distance) * 1.1));
      }
    }
    return force;
  }

  private actorMeleeHit(actor: Actor): void {
    const target = actor.target;
    if (!target || target.dead || !pointInAttackArc({ x: actor.rig.root.position.x, z: actor.rig.root.position.z, rotation: actor.rig.root.rotation.y }, target.rig.root.position, actor.attackRange + 0.45)) return;
    this.damageActor(target, actor.damage * (0.82 + this.random() * 0.34), actor);
  }

  private playerAttack(): void {
    if (this.mode !== 'running' || this.player.dead || this.jumpTimer > 0 || this.player.cooldown > 0 || this.player.stamina < 12) return;
    this.player.action = 'attack';
    this.player.actionTime = 0;
    this.player.hitDone = true;
    this.player.cooldown = 0.47;
    this.player.stamina -= 12;
    this.audio.sword();
    window.setTimeout(() => {
      if (this.mode !== 'running' || this.player.dead) return;
      const attacker = { x: this.player.rig.root.position.x, z: this.player.rig.root.position.z, rotation: this.yaw };
      let hit = false;
      for (const actor of this.actors) {
        if (actor.team !== 'enemies' || actor.dead || actor === this.boss && this.phase < 3) continue;
        if (pointInAttackArc(attacker, actor.rig.root.position, 3.25, Math.PI * 0.46)) {
          this.damageActor(actor, this.player.damage * (0.88 + this.random() * 0.32), this.player);
          hit = true;
        }
      }
      if (this.phase === 1 && distanceXZ(this.player.rig.root.position, this.gateGroup.position) < 5.2) {
        this.damageGate(3.5);
        hit = true;
      }
      for (const explosive of this.explosives) {
        if (!explosive.armed || !pointInAttackArc(attacker, explosive.group.position, 3.4, Math.PI * 0.52)) continue;
        this.detonateExplosive(explosive, 'allies');
        hit = true;
      }
      if (hit) this.audio.hit(false);
    }, 180);
  }

  private playerDodge(): void {
    if (this.mode !== 'running' || this.player.dead || this.jumpTimer > 0 || this.player.stamina < 26 || this.player.action === 'attack') return;
    this.player.stamina -= 26;
    const inputX = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) + this.joystick.x;
    const inputZ = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0) - this.joystick.y;
    const direction = movementDirection(inputX, inputZ, this.yaw);
    if (direction) this.jumpDirection.set(direction.x, 0, direction.z);
    else this.jumpDirection.set(Math.sin(this.player.rig.root.rotation.y), 0, Math.cos(this.player.rig.root.rotation.y));
    this.jumpDirection.normalize();
    this.jumpTimer = this.jumpDuration;
    this.jumpTrailTimer = 0;
    this.player.action = 'jump';
    this.player.actionTime = 0;
    this.player.rig.setState('jump', 1.35, 0.016);
    this.spawnJumpTrail(this.player.rig.root.position, this.jumpDirection);
  }

  private damageActor(target: Actor, rawDamage: number, attacker: Actor): void {
    if (target.dead) return;
    let damage = rawDamage;
    if (target === this.player && target.action === 'block' && target.stamina > 0) {
      const facing = Math.abs(angleDelta(target.rig.root.rotation.y, Math.atan2(attacker.rig.root.position.x - target.rig.root.position.x, attacker.rig.root.position.z - target.rig.root.position.z)));
      if (facing < Math.PI * 0.68) {
        damage *= 0.22;
        target.stamina = Math.max(0, target.stamina - rawDamage * 0.8);
        this.audio.block();
      }
    }
    target.health = Math.max(0, target.health - damage);
    target.lastAttacker = attacker;
    target.rig.flashDamage();
    const hitPosition = target.rig.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.spawnImpact(hitPosition, target.team === 'enemies' ? 0xc34025 : 0x4a8792, 6);
    if (attacker === this.player) this.damageDone += damage;
    if (target === this.player) {
      this.events.onDamage(clamp(damage / 45, 0.2, 1));
      this.cameraShake = Math.max(this.cameraShake, damage / 80);
    }
    if (target.health <= 0) this.killActor(target, attacker);
  }

  private killActor(target: Actor, attacker: Actor): void {
    target.dead = true;
    target.action = 'dead';
    target.actionTime = 0;
    target.rig.setState('dead', 0, 0.016);
    this.audio.hit(target.role === 'boss');
    if (attacker === this.player) {
      this.kills += 1;
      this.events.onFeed(`<b>${target.role === 'boss' ? 'Лорд Варгрим повержен' : 'Страж повержен'}</b> · ${Math.round(attacker.damage)} урона`);
    }
    if (target === this.player) {
      this.jumpTimer = 0;
      this.player.rig.setVerticalOffset(0);
      this.respawnTimer = 3.2;
      this.events.onFeed('<b>Вы пали.</b> Союзники возвращают вас в строй…');
    }
    if (target === this.boss) {
      this.events.onFeed('<b>Варгрим пал.</b> Поднимите знамя у донжона!');
      this.audio.horn();
    }
  }

  private updateRespawn(delta: number): void {
    if (!this.player.dead) return;
    this.respawnTimer -= delta;
    if (this.respawnTimer > 0) return;
    this.player.dead = false;
    this.player.health = this.player.maxHealth;
    this.player.stamina = 100;
    this.player.action = 'idle';
    this.jumpTimer = 0;
    this.player.rig.setVerticalOffset(0);
    const respawn = this.phase < 2
      ? PLAYER_START
      : this.phase === 2
        ? new THREE.Vector3(0, 0, -31)
        : new THREE.Vector3(0, CASTLE_LIMITS.summitHeight, CASTLE_LIMITS.secondStairEndZ - 1);
    this.player.rig.root.position.copy(respawn);
    this.player.rig.setGroundHeight(respawn.y);
  }

  private fireArrow(actor: Actor): void {
    const target = actor.target;
    if (!target || target.dead) return;
    const origin = actor.rig.root.position.clone().add(new THREE.Vector3(0, 1.45, 0));
    const targetPosition = target.rig.root.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    const distance = origin.distanceTo(targetPosition);
    const velocity = targetPosition.sub(origin).normalize().multiplyScalar(15);
    velocity.y += distance * 0.035;
    const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.85, 5), new THREE.MeshStandardMaterial({ color: 0x3b2719 }));
    arrow.position.copy(origin);
    arrow.quaternion.setFromUnitVectors(UP, velocity.clone().normalize());
    this.scene.add(arrow);
    this.projectiles.push({ mesh: arrow, velocity, team: actor.team, damage: actor.damage, life: 3, fire: false });
  }

  private launchFireball(): void {
    const target = this.player.rig.root.position.clone().add(new THREE.Vector3((this.random() - 0.5) * 9, 0, (this.random() - 0.5) * 9));
    const origin = this.phase < 2
      ? new THREE.Vector3((this.random() > 0.5 ? 1 : -1) * 22.2, 10.85, -22.05)
      : new THREE.Vector3((this.random() > 0.5 ? 1 : -1) * 14, 18.55, -61.5);
    const velocity = target.sub(origin).multiplyScalar(0.33);
    velocity.y += 5.5;
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 7),
      new THREE.MeshStandardMaterial({ color: 0x17191b, emissive: 0xff3a0b, emissiveIntensity: 1.65, metalness: 0.76, roughness: 0.3 }),
    );
    fire.position.copy(origin);
    const glow = new THREE.PointLight(0xff4a16, 6, 7, 2.2);
    fire.add(glow);
    this.scene.add(fire);
    this.spawnCannonMuzzle(origin, velocity);
    this.projectiles.push({ mesh: fire, velocity, team: 'enemies', damage: 42, life: 4, fire: true, trailTimer: 0 });
  }

  private updateProjectiles(delta: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= delta;
      if (projectile.fire) {
        projectile.velocity.y -= 9.8 * delta;
        projectile.trailTimer = (projectile.trailTimer ?? 0) - delta;
        if (projectile.trailTimer <= 0) {
          projectile.trailTimer = 0.045;
          this.spawnCannonTrail(projectile.mesh.position, projectile.velocity);
        }
      }
      projectile.mesh.position.addScaledVector(projectile.velocity, delta);
      if (!projectile.fire) projectile.mesh.quaternion.setFromUnitVectors(UP, projectile.velocity.clone().normalize());
      let remove = projectile.life <= 0;
      for (const explosive of this.explosives) {
        if (remove || !explosive.armed) continue;
        if (projectile.mesh.position.distanceTo(explosive.group.position.clone().add(new THREE.Vector3(0, 0.65, 0))) < explosive.triggerRadius) {
          this.detonateExplosive(explosive, projectile.team);
          remove = true;
        }
      }
      for (const actor of this.actors) {
        if (remove || actor.dead || actor.team === projectile.team) continue;
        if (projectile.mesh.position.distanceTo(actor.rig.root.position.clone().add(new THREE.Vector3(0, 1, 0))) < (projectile.fire ? 1.25 : 0.65)) {
          if (projectile.fire) this.explode(projectile.mesh.position, projectile.team, 5, 46, 'armor');
          else this.damageActor(actor, projectile.damage, this.findProjectileOwner(projectile.team));
          remove = true;
        }
      }
      if (projectile.fire && !remove) {
        const position = projectile.mesh.position;
        const ramHit = distanceXZ(position, this.ram.position) < 3.2 && position.y < 3.4;
        const gateHit = this.gateHealth > 0 && Math.abs(position.x) < 4.1 && Math.abs(position.z + 25.5) < 0.7 && position.y < 7.2;
        if (ramHit || gateHit) {
          this.explode(position, 'enemies', 5, 46, 'wood');
          remove = true;
        } else if (this.cannonHitsStone(position)) {
          this.explode(position, 'enemies', 5, 46, 'stone');
          remove = true;
        } else if (position.y <= castleGroundHeight(position.x, position.z) + 0.35) {
          this.explode(position, 'enemies', 5, 46, battlefieldSurfaceAt(position.x, position.z));
          remove = true;
        }
      } else if (!projectile.fire && projectile.mesh.position.y <= castleGroundHeight(projectile.mesh.position.x, projectile.mesh.position.z) + 0.12) {
        this.spawnImpact(projectile.mesh.position, 0xc9b28d, 2);
        remove = true;
      }
      if (remove) {
        this.scene.remove(projectile.mesh);
        this.projectiles.splice(index, 1);
      }
    }
  }

  private findProjectileOwner(team: Team): Actor {
    return this.actors.find((actor) => actor.team === team && !actor.dead) ?? this.player;
  }

  private explode(position: THREE.Vector3, sourceTeam: Team | 'neutral', radius: number, damage: number, surface: ImpactSurface = 'earth'): void {
    this.audio.explosion();
    this.cameraShake = Math.max(this.cameraShake, clamp(1 - position.distanceTo(this.player.rig.root.position) / 24, 0, 0.9));
    this.spawnExplosionEffect(position, surface);
    for (const actor of this.actors) {
      if (actor.dead || sourceTeam !== 'neutral' && actor.team === sourceTeam) continue;
      const distance = actor.rig.root.position.distanceTo(position);
      if (distance < radius) {
        const attacker = sourceTeam === 'allies' ? this.player : this.findProjectileOwner('enemies');
        this.damageActor(actor, (1 - distance / radius) * damage, attacker);
      }
    }
  }

  private updateExplosives(time: number): void {
    for (const explosive of this.explosives) {
      if (!explosive.armed) continue;
      const fuse = explosive.group.getObjectByName('mine-fuse');
      if (fuse) fuse.scale.setScalar(0.75 + Math.sin(time * 12 + explosive.group.id) * 0.22);
      if (explosive.kind !== 'mine') continue;
      const target = this.actors.find((actor) => !actor.dead && actor.team !== explosive.team && distanceXZ(actor.rig.root.position, explosive.group.position) < explosive.triggerRadius);
      if (target) this.detonateExplosive(explosive, explosive.team);
    }
  }

  private detonateExplosive(explosive: ExplosiveProp, sourceTeam: Team | 'neutral'): void {
    if (!explosive.armed) return;
    explosive.armed = false;
    explosive.group.visible = false;
    const origin = explosive.group.position.clone().add(new THREE.Vector3(0, explosive.kind === 'barrel' ? 0.7 : 0.18, 0));
    this.explode(origin, sourceTeam, explosive.blastRadius, explosive.damage, explosive.kind === 'barrel' ? 'wood' : battlefieldSurfaceAt(origin.x, origin.z));
    for (const other of this.explosives) {
      if (!other.armed || other === explosive || distanceXZ(other.group.position, origin) > explosive.blastRadius * 0.82) continue;
      window.setTimeout(() => this.detonateExplosive(other, sourceTeam), 90 + this.random() * 130);
    }
  }

  private cannonHitsStone(position: THREE.Vector3): boolean {
    const outerWall = position.z < -24.7 && position.z > -29.1
      && Math.abs(position.x) < 27.8 && Math.abs(position.x) > 4.05 && position.y < 9.4;
    const sideWall = Math.abs(position.x) > 25.35 && Math.abs(position.x) < 28.7
      && position.z < -28 && position.z > CASTLE_LIMITS.backWallZ - 1.8 && position.y < 10.2;
    const backWall = position.z < CASTLE_LIMITS.backWallZ + 1.8 && position.z > CASTLE_LIMITS.backWallZ - 1.8
      && Math.abs(position.x) < 27.5 && position.y < 13.2;
    return outerWall || sideWall || backWall;
  }

  private spawnCannonMuzzle(position: THREE.Vector3, velocity: THREE.Vector3): void {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff9b38, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    flash.position.copy(position);
    this.scene.add(flash);
    this.particles.push({ mesh: flash, velocity: velocity.clone().normalize().multiplyScalar(1.8), life: 0.16, maxLife: 0.16, gravity: 0, growth: 7 });
    this.spawnImpact(position, 0xff7a20, 12);
    this.spawnCannonTrail(position, velocity);
  }

  private spawnCannonTrail(position: THREE.Vector3, velocity: THREE.Vector3): void {
    const backward = velocity.clone().normalize().multiplyScalar(-0.7);
    const smoke = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12 + this.random() * 0.08, 1),
      new THREE.MeshBasicMaterial({ color: 0x34373a, transparent: true, opacity: 0.46, depthWrite: false }),
    );
    smoke.position.copy(position).add(new THREE.Vector3((this.random() - 0.5) * 0.16, (this.random() - 0.5) * 0.16, (this.random() - 0.5) * 0.16));
    this.scene.add(smoke);
    const smokeLife = 0.48 + this.random() * 0.2;
    this.particles.push({ mesh: smoke, velocity: backward.add(new THREE.Vector3(0, 0.5, 0)), life: smokeLife, maxLife: smokeLife, gravity: -0.45, drag: 2.2, growth: 2.4 });
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xff6a1c, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ember.position.copy(position);
    this.scene.add(ember);
    this.particles.push({ mesh: ember, velocity: backward.clone().multiplyScalar(2.4), life: 0.22, maxLife: 0.22, gravity: 1.5, drag: 1.2 });
  }

  private spawnExplosionEffect(position: THREE.Vector3, surface: ImpactSurface): void {
    const palette: Record<ImpactSurface, { spark: number; cloud: number; flash: number; count: number }> = {
      earth: { spark: 0xff8a32, cloud: 0x70563d, flash: 0xff5b18, count: 31 },
      stone: { spark: 0xffc16b, cloud: 0x8b8983, flash: 0xff7128, count: 36 },
      wood: { spark: 0xff942e, cloud: 0x5e301b, flash: 0xff4a12, count: 34 },
      armor: { spark: 0xe4f5ff, cloud: 0x687884, flash: 0xff8b34, count: 42 },
    };
    const colors = palette[surface];
    this.spawnImpact(position, colors.spark, colors.count);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 10, 7),
      new THREE.MeshBasicMaterial({ color: colors.flash, transparent: true, opacity: 0.94, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    flash.position.copy(position);
    this.scene.add(flash);
    this.particles.push({ mesh: flash, velocity: new THREE.Vector3(), life: 0.24, maxLife: 0.24, gravity: 0, growth: 8.5 });

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.58, 24),
      new THREE.MeshBasicMaterial({ color: colors.flash, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(position);
    if (surface === 'earth' || surface === 'stone') ring.position.y = castleGroundHeight(position.x, position.z) + 0.08;
    this.scene.add(ring);
    this.particles.push({ mesh: ring, velocity: new THREE.Vector3(), life: 0.38, maxLife: 0.38, gravity: 0, growth: 5.2 });

    const cloudCount = surface === 'armor' ? 7 : 13;
    for (let index = 0; index < cloudCount; index += 1) {
      const cloud = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.12 + this.random() * 0.22, 1),
        new THREE.MeshBasicMaterial({ color: colors.cloud, transparent: true, opacity: 0.62, depthWrite: false }),
      );
      cloud.position.copy(position).add(new THREE.Vector3((this.random() - 0.5) * 0.7, this.random() * 0.45, (this.random() - 0.5) * 0.7));
      this.scene.add(cloud);
      const life = 0.58 + this.random() * 0.48;
      this.particles.push({
        mesh: cloud,
        velocity: new THREE.Vector3((this.random() - 0.5) * 3.1, 1.1 + this.random() * 3.2, (this.random() - 0.5) * 3.1),
        life,
        maxLife: life,
        gravity: surface === 'earth' || surface === 'stone' ? 2.2 : 1.1,
        drag: 1.15,
        growth: 1.65,
        spin: new THREE.Vector3(this.random() * 2, this.random() * 2, this.random() * 2),
      });
    }

    if (surface === 'wood') {
      for (let index = 0; index < 18; index += 1) {
        const splinter = new THREE.Mesh(
          new THREE.BoxGeometry(0.045, 0.045, 0.38 + this.random() * 0.52),
          new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? 0xc47739 : 0x502718, transparent: true }),
        );
        splinter.position.copy(position);
        splinter.rotation.set(this.random() * Math.PI, this.random() * Math.PI, this.random() * Math.PI);
        this.scene.add(splinter);
        const life = 0.7 + this.random() * 0.55;
        this.particles.push({
          mesh: splinter,
          velocity: new THREE.Vector3((this.random() - 0.5) * 6.5, 2.5 + this.random() * 5.2, (this.random() - 0.5) * 6.5),
          life,
          maxLife: life,
          gravity: 8.4,
          drag: 0.22,
          spin: new THREE.Vector3(6 + this.random() * 8, 5 + this.random() * 9, 5 + this.random() * 8),
        });
      }
    }

    if (surface === 'earth' || surface === 'stone') {
      const scorch = new THREE.Mesh(
        new THREE.CircleGeometry(surface === 'earth' ? 1.35 : 0.92, 20),
        new THREE.MeshBasicMaterial({ color: surface === 'earth' ? 0x211a14 : 0x252422, transparent: true, opacity: 0.58, depthWrite: false }),
      );
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.set(position.x, castleGroundHeight(position.x, position.z) + 0.035, position.z);
      this.scene.add(scorch);
      this.particles.push({ mesh: scorch, velocity: new THREE.Vector3(), life: 4.5, maxLife: 4.5, gravity: 0, growth: 0.035 });
    }
  }

  private spawnJumpTrail(position: THREE.Vector3, direction: THREE.Vector3): void {
    const right = new THREE.Vector3(-direction.z, 0, direction.x);
    const windMaterial = new THREE.MeshBasicMaterial({
      color: 0xbcecff,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 12), windMaterial);
    ring.position.copy(position).addScaledVector(direction, -0.62).add(new THREE.Vector3(0, 0.78, 0));
    ring.quaternion.setFromUnitVectors(FORWARD, direction);
    ring.scale.set(0.85, 1.18, 0.85);
    this.scene.add(ring);
    this.particles.push({
      mesh: ring,
      velocity: direction.clone().multiplyScalar(-2.1).add(new THREE.Vector3(0, 0.25, 0)),
      life: 0.3,
      maxLife: 0.3,
      gravity: 0,
      drag: 3.5,
      growth: 2.4,
    });
    for (const side of [-1, 1]) {
      const streak = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.95), windMaterial.clone());
      streak.position.copy(position)
        .addScaledVector(direction, -0.5 - this.random() * 0.45)
        .addScaledVector(right, side * (0.22 + this.random() * 0.18))
        .add(new THREE.Vector3(0, 0.35 + this.random() * 0.75, 0));
      streak.quaternion.setFromUnitVectors(FORWARD, direction);
      this.scene.add(streak);
      const life = 0.2 + this.random() * 0.12;
      this.particles.push({
        mesh: streak,
        velocity: direction.clone().multiplyScalar(-3.5 - this.random() * 1.5),
        life,
        maxLife: life,
        gravity: 0,
        drag: 2.8,
        growth: 0.45,
      });
    }
  }

  private spawnImpact(position: THREE.Vector3, color: number, count: number): void {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let index = 0; index < count; index += 1) {
      const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035 + this.random() * 0.06, 0), material.clone());
      spark.position.copy(position);
      const velocity = new THREE.Vector3((this.random() - 0.5) * 4, this.random() * 4.5, (this.random() - 0.5) * 4);
      this.scene.add(spark);
      const life = 0.45 + this.random() * 0.55;
      this.particles.push({ mesh: spark, velocity, life, maxLife: life });
    }
  }

  private updateParticles(delta: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= delta;
      particle.velocity.multiplyScalar(Math.exp(-(particle.drag ?? 0) * delta));
      particle.velocity.y -= (particle.gravity ?? 5.5) * delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      if (particle.spin) {
        particle.mesh.rotation.x += particle.spin.x * delta;
        particle.mesh.rotation.y += particle.spin.y * delta;
        particle.mesh.rotation.z += particle.spin.z * delta;
      }
      if (particle.growth) particle.mesh.scale.multiplyScalar(1 + particle.growth * delta);
      const material = particle.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = clamp(particle.life / particle.maxLife, 0, 1);
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        this.particles.splice(index, 1);
      }
    }
  }

  private damageGate(amount: number): void {
    if (this.gateHealth <= 0) return;
    this.gateHealth = Math.max(0, this.gateHealth - amount);
    this.events.onBattleEvent('gate-hit', amount);
  }

  private breakGate(): void {
    if (this.phase >= 2) return;
    this.phase = 2;
    this.audio.explosion();
    this.audio.horn();
    this.cameraShake = 1;
    this.spawnImpact(new THREE.Vector3(0, 3, -25.5), 0xcf8b4c, 38);
    this.events.onFeed('<b>Врата открыты!</b> Легион, на первую лестницу!');
    this.events.onBattleEvent('phase', 2);
  }

  private updateGateVisual(delta: number): void {
    const opened = smoothstep(25, 0, this.gateHealth);
    this.gateLeft.rotation.y = dampAngle(this.gateLeft.rotation.y, opened * 1.48, 3.2, delta);
    this.gateRight.rotation.y = dampAngle(this.gateRight.rotation.y, -opened * 1.48, 3.2, delta);
    if (this.boss.dead) this.banner.rotation.z = damp(this.banner.rotation.z, 0, 1.4, delta);
  }

  private updateCamera(delta: number): void {
    const target = this.player.rig.root.position.clone().add(new THREE.Vector3(0, 1.45, 0));
    const forward = new THREE.Vector3(Math.sin(this.yaw), Math.sin(this.pitch), Math.cos(this.yaw)).normalize();
    const side = new THREE.Vector3(forward.z, 0, -forward.x).multiplyScalar(this.cameraShoulder * 1.05);
    const desired = target.clone().addScaledVector(forward, -5.2).add(side).add(new THREE.Vector3(0, 1.8, 0));
    if (this.cameraShake > 0.001) {
      desired.add(new THREE.Vector3((this.random() - 0.5) * this.cameraShake, (this.random() - 0.5) * this.cameraShake, (this.random() - 0.5) * this.cameraShake));
      this.cameraShake = Math.max(0, this.cameraShake - delta * 2.6);
    }
    this.camera.position.lerp(desired, 1 - Math.exp(-12 * delta));
    this.camera.lookAt(target.addScaledVector(forward, 6));
  }

  private updateRemotePlayers(time: number, delta: number): void {
    for (const remote of this.remotes.values()) {
      remote.rig.root.position.lerp(remote.targetPosition, 1 - Math.exp(-12 * delta));
      remote.rig.root.rotation.y = dampAngle(remote.rig.root.rotation.y, remote.targetRotation, 12, delta);
      remote.rig.setState(remote.action, remote.action === 'run' ? 1 : 0, delta);
      remote.rig.update(time, delta);
    }
  }

  private resolveWorldCollision(position: THREE.Vector3): void {
    position.x = clamp(position.x, -41.5, 41.5);
    position.z = clamp(position.z, -74, 43);
    const atWall = position.z < -24.3 && position.z > -29.8;
    const gatePassable = this.phase >= 2 && Math.abs(position.x) < 4.3;
    if (atWall && !gatePassable) {
      if (position.z > -27) position.z = -24.25;
      else position.z = -29.85;
    }
    if (position.z < -29 && Math.abs(position.x) > 25.2) position.x = Math.sign(position.x) * 25.2;
    if (position.z <= CASTLE_LIMITS.firstStairStartZ && position.z >= CASTLE_LIMITS.firstStairEndZ) {
      position.x = clamp(position.x, -6.8, 6.8);
    } else if (position.z < CASTLE_LIMITS.firstStairEndZ && position.z > CASTLE_LIMITS.secondStairStartZ) {
      position.x = clamp(position.x, -14.6, 14.6);
    } else if (position.z <= CASTLE_LIMITS.secondStairStartZ && position.z >= CASTLE_LIMITS.secondStairEndZ) {
      position.x = clamp(position.x, -5.4, 5.4);
    } else if (position.z < CASTLE_LIMITS.secondStairEndZ) {
      position.x = clamp(position.x, -11.5, 11.5);
    }
  }

  private syncActorGround(actor: Actor, delta: number): void {
    const targetHeight = castleGroundHeight(actor.rig.root.position.x, actor.rig.root.position.z);
    actor.rig.setGroundHeight(damp(actor.rig.root.position.y, targetHeight, 18, delta));
  }

  private resolveRamCollision(position: THREE.Vector3): void {
    const localX = position.x - this.ram.position.x;
    const localZ = position.z - this.ram.position.z;
    if (Math.abs(localX) >= 2.3 || Math.abs(localZ) >= 4.6) return;
    const horizontalDepth = 2.3 - Math.abs(localX);
    const verticalDepth = 4.6 - Math.abs(localZ);
    if (horizontalDepth < verticalDepth) position.x = this.ram.position.x + (localX >= 0 ? 2.3 : -2.3);
    else position.z = this.ram.position.z + (localZ >= 0 ? 4.6 : -4.6);
  }

  private lockPointer(): void {
    try {
      const result = this.canvas.requestPointerLock();
      void result.catch(() => undefined);
    } catch {
      // Pointer lock can be denied by embedded browsers; keyboard/touch controls still work.
    }
  }

  private emitHud(force = false): void {
    if (!force && this.elapsed - this.lastHud < 0.08) return;
    this.lastHud = this.elapsed;
    let objective = 'Сопровождайте таран к воротам';
    let progress = clamp((15 - this.ram.position.z) / 36.9 * 100, 0, 100);
    if (this.phase === 1) {
      objective = 'Защитите таран и сокрушите ворота';
      progress = 100 - this.gateHealth;
    } else if (this.phase === 2) {
      const summitAllies = this.actors.filter((actor) => actor.team === 'allies' && !actor.dead && actor.rig.root.position.z < -64).length;
      objective = `Прорвитесь на верхний ярус вместе с легионом · ${summitAllies}/3`;
      progress = clamp((-this.player.rig.root.position.z - 29) / 35 * 100, 0, 100);
    } else if (this.phase === 3) {
      objective = this.boss.dead ? 'Удерживайте E у знамени' : 'Сразите лорда Варгрима';
      progress = this.boss.dead ? this.captureProgress : 100 - this.boss.health / this.boss.maxHealth * 100;
    }
    this.events.onHud({
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      stamina: this.player.stamina,
      phase: this.phase,
      objective,
      progress,
      allies: this.actors.filter((actor) => actor.team === 'allies' && !actor.dead).length,
      enemies: this.actors.filter((actor) => actor.team === 'enemies' && !actor.dead && (actor !== this.boss || this.phase >= 3)).length,
      interaction: this.phase === 3 && this.boss.dead && distanceXZ(this.player.rig.root.position, this.banner.position) < 4.2,
    });
  }

  private victory(): void {
    if (this.mode === 'victory') return;
    this.mode = 'victory';
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.victory();
    this.events.onVictory({ kills: this.kills, duration: this.elapsed, damage: this.damageDone });
  }

  private resize(): void {
    const width = innerWidth;
    const height = innerHeight;
    const ratio = this.quality === 'high' ? Math.min(devicePixelRatio, 1.75) : this.quality === 'medium' ? Math.min(devicePixelRatio, 1.25) : 0.85;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private createGroundTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = '#635d49';
    context.fillRect(0, 0, 256, 256);
    for (let index = 0; index < 1800; index += 1) {
      const shade = 55 + Math.floor(this.random() * 60);
      context.fillStyle = `rgba(${shade + 15},${shade + 8},${shade - 8},${0.08 + this.random() * 0.12})`;
      const size = 1 + this.random() * 3;
      context.fillRect(this.random() * 256, this.random() * 256, size, size);
    }
    for (let index = 0; index < 45; index += 1) {
      context.strokeStyle = `rgba(35,30,22,${0.1 + this.random() * 0.18})`;
      context.beginPath();
      context.moveTo(this.random() * 256, this.random() * 256);
      context.lineTo(this.random() * 256, this.random() * 256);
      context.stroke();
    }
    return new THREE.CanvasTexture(canvas);
  }

  private createStoneTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = '#282a29';
    context.fillRect(0, 0, 512, 256);
    const rowHeight = 32;
    for (let row = 0; row < 8; row += 1) {
      const offset = row % 2 ? -32 : 0;
      for (let column = offset; column < 512; column += 64) {
        const shade = 72 + Math.floor(this.random() * 34);
        const gradient = context.createLinearGradient(column, row * rowHeight, column, (row + 1) * rowHeight);
        gradient.addColorStop(0, `rgb(${shade + 18},${shade + 15},${shade + 8})`);
        gradient.addColorStop(0.46, `rgb(${shade + 4},${shade + 2},${shade - 4})`);
        gradient.addColorStop(1, `rgb(${shade - 11},${shade - 10},${shade - 14})`);
        context.fillStyle = gradient;
        context.fillRect(column + 2, row * rowHeight + 2, 60, rowHeight - 4);
        context.strokeStyle = 'rgba(18,19,18,.72)';
        context.strokeRect(column + 1, row * rowHeight + 1, 62, rowHeight - 2);
        context.strokeStyle = 'rgba(222,214,187,.09)';
        context.beginPath();
        context.moveTo(column + 5, row * rowHeight + 5 + this.random() * 8);
        context.lineTo(column + 17 + this.random() * 25, row * rowHeight + 4 + this.random() * 13);
        context.stroke();
      }
    }
    for (let index = 0; index < 1400; index += 1) {
      const bright = this.random() > 0.58;
      context.fillStyle = bright
        ? `rgba(226,218,190,${0.02 + this.random() * 0.11})`
        : `rgba(8,12,10,${0.04 + this.random() * 0.16})`;
      const size = 0.6 + this.random() * 1.8;
      context.fillRect(this.random() * 512, this.random() * 256, size, size);
    }
    return new THREE.CanvasTexture(canvas);
  }

  private createWoodTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = '#3b1e12';
    context.fillRect(0, 0, 256, 256);
    for (let plank = 0; plank < 8; plank += 1) {
      const x = plank * 32;
      const shade = 72 + Math.floor(this.random() * 28);
      const gradient = context.createLinearGradient(x, 0, x + 32, 0);
      gradient.addColorStop(0, `rgb(${shade - 18},${Math.floor(shade * 0.56)},${Math.floor(shade * 0.3)})`);
      gradient.addColorStop(0.45, `rgb(${shade + 16},${Math.floor(shade * 0.68)},${Math.floor(shade * 0.38)})`);
      gradient.addColorStop(1, `rgb(${shade - 12},${Math.floor(shade * 0.5)},${Math.floor(shade * 0.27)})`);
      context.fillStyle = gradient;
      context.fillRect(x + 2, 0, 29, 256);
      context.fillStyle = 'rgba(18,8,4,.72)';
      context.fillRect(x, 0, 2, 256);
      for (let grain = 0; grain < 13; grain += 1) {
        context.strokeStyle = `rgba(38,15,7,${0.08 + this.random() * 0.18})`;
        context.beginPath();
        const startY = this.random() * 256;
        context.moveTo(x + 4 + this.random() * 20, startY);
        context.bezierCurveTo(x + 26, startY + 18, x + 5, startY + 34, x + 25, startY + 58);
        context.stroke();
      }
      for (let knot = 0; knot < 2; knot += 1) {
        context.strokeStyle = 'rgba(29,10,4,.38)';
        context.beginPath();
        context.ellipse(x + 8 + this.random() * 16, this.random() * 256, 3 + this.random() * 3, 7 + this.random() * 7, 0, 0, Math.PI * 2);
        context.stroke();
      }
    }
    return new THREE.CanvasTexture(canvas);
  }

  private createBanner(color: number, trim: number, torn: boolean): THREE.Group {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 8), new THREE.MeshStandardMaterial({ color: 0x46301d, roughness: 0.9 }));
    pole.position.y = 3.5;
    pole.castShadow = true;
    group.add(pole);
    const clothShape = new THREE.Shape();
    clothShape.moveTo(0, 0);
    clothShape.lineTo(2.4, 0);
    clothShape.lineTo(torn ? 2.08 : 2.4, -1.05);
    clothShape.lineTo(torn ? 2.35 : 2.4, -1.45);
    clothShape.lineTo(0, -1.45);
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(clothShape), new THREE.MeshStandardMaterial({ color, roughness: 0.92, side: THREE.DoubleSide }));
    cloth.position.set(0.04, 6.3, 0);
    cloth.castShadow = true;
    group.add(cloth);
    const mark = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 8), new THREE.MeshStandardMaterial({ color: trim, metalness: 0.5, roughness: 0.45 }));
    mark.position.set(1.02, 5.58, 0.025);
    group.add(mark);
    return group;
  }

  private createTorch(position: THREE.Vector3): void {
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x342519, roughness: 0.9 }));
    holder.position.copy(position).add(new THREE.Vector3(0, 0.7, 0));
    this.scene.add(holder);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), new THREE.MeshBasicMaterial({ color: 0xffa12e }));
    flame.name = 'torch-flame';
    flame.position.copy(position).add(new THREE.Vector3(0, 1.5, 0));
    flame.scale.y = 1.8;
    this.scene.add(flame);
    const light = new THREE.PointLight(0xff7b22, 2.3, 8, 2);
    light.position.copy(flame.position);
    light.name = 'torch-light';
    this.scene.add(light);
  }

  private updateTorches(time: number): void {
    this.scene.traverse((object) => {
      if (object.name === 'torch-flame') object.scale.y = 1.5 + Math.sin(time * 13 + object.id) * 0.35;
      if (object.name === 'torch-light' && object instanceof THREE.PointLight) object.intensity = 2.1 + Math.sin(time * 11 + object.id) * 0.35;
    });
  }
}
