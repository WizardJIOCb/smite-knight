import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { NetworkPlayer } from '../../shared/protocol';
import { BattleAudio } from './audio';
import { attackPhaseAt, bladeSweepAngle, meleeAttackProfile, sweptBladeContact, type MeleeAttackProfile } from './combat';
import { applyDestructibleDamage, pointHitsObstacle, radialDestructibleDamage, segmentHitsObstacle } from './destruction';
import { LEVELS, type LevelDefinition } from './levels';
import { KnightRig, createRemoteKnight, type RigAction } from './models';
import {
  angleDelta,
  clamp,
  damp,
  dampAngle,
  distanceXZ,
  formationFollowVelocity,
  formationShouldMove,
  movementDirection,
  ramEscortGateShift,
  ramEscortOffset,
  seededRandom,
  smoothstep,
} from './math';
import {
  battlefieldSurfaceAt,
  CASTLE_LIMITS,
  castleGroundHeight,
  summitAllyRequirement,
  summitAssaultReady,
} from './world';

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
  swingStarted: boolean;
  attackTrailTimer: number;
  trailSweepAngle?: number;
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
  baseOpacity?: number;
  gravity?: number;
  drag?: number;
  growth?: number;
  spin?: THREE.Vector3;
}

type ImpactSurface = 'earth' | 'stone' | 'wood' | 'armor';
type DamageKind = 'melee' | 'projectile' | 'explosion';

interface ExplosiveProp {
  group: THREE.Group;
  kind: 'barrel' | 'mine';
  armed: boolean;
  triggerRadius: number;
  blastRadius: number;
  damage: number;
  team: Team | 'neutral';
}

type DestructibleKind = 'rock' | 'stake' | 'tent' | 'tree' | 'crates' | 'barricade' | 'cart' | 'logs' | 'urns' | 'weapon-rack';

interface DestructibleProp {
  root: THREE.Object3D;
  kind: DestructibleKind;
  surface: Extract<ImpactSurface, 'wood' | 'stone'>;
  health: number;
  maxHealth: number;
  radius: number;
  height: number;
  centerOffsetY: number;
  debrisColor: number;
  destroyed: boolean;
}

interface LevelHazard {
  position: THREE.Vector3;
  radius: number;
  damage: number;
  staminaDrain: number;
  color: number;
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
  readonly level: LevelDefinition;
  private readonly canvas: HTMLCanvasElement;
  private readonly events: GameEvents;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.08, 180);
  private readonly clock = new THREE.Clock();
  private readonly random: () => number;
  private readonly keys = new Set<string>();
  private readonly actors: Actor[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly particles: Particle[] = [];
  private readonly explosives: ExplosiveProp[] = [];
  private readonly destructibles: DestructibleProp[] = [];
  private readonly hazards: LevelHazard[] = [];
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
  private reservesDeployed = false;
  private yaw = Math.PI;
  private pitch = -0.13;
  private cameraShoulder = 1;
  private cameraShake = 0;
  private elapsed = 0;
  private kills = 0;
  private damageDone = 0;
  private ramStrikeTimer = 0;
  private ramVelocityZ = 0;
  private fireballTimer = 2.5;
  private bossAbilityTimer = 5;
  private hazardDamageTimer = 0;
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

  constructor(canvas: HTMLCanvasElement, events: GameEvents, level: LevelDefinition = LEVELS[0]) {
    this.canvas = canvas;
    this.events = events;
    this.level = level;
    this.random = seededRandom(level.seed);
    this.fireballTimer = level.artilleryDelay[0];
    this.bossAbilityTimer = level.boss.abilityCooldown;
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
    this.reservesDeployed = false;
    this.kills = 0;
    this.damageDone = 0;
    this.elapsed = 0;
    this.respawnTimer = 0;
    this.jumpTimer = 0;
    this.jumpTrailTimer = 0;
    this.ramVelocityZ = 0;
    this.fireballTimer = this.level.artilleryDelay[0];
    this.bossAbilityTimer = this.level.boss.abilityCooldown;
    this.hazardDamageTimer = 0;
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
    for (const prop of this.destructibles) {
      prop.health = prop.maxHealth;
      prop.destroyed = false;
      prop.root.visible = true;
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
      const previousPhase = this.phase;
      this.phase = Math.max(this.phase, Math.floor(value));
      if (this.phase >= 2) this.gateHealth = 0;
      if (this.phase >= 3) this.boss.rig.root.visible = true;
      if (previousPhase < 2 && this.phase === 2) this.deployAssaultReserves();
    }
  }

  private buildWorld(): void {
    const { theme } = this.level;
    this.scene.background = new THREE.Color(theme.background);
    this.scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);

    const hemisphere = new THREE.HemisphereLight(theme.sky, theme.groundLight, 1.8);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight(theme.sun, 4.15);
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
      new THREE.MeshStandardMaterial({ map: groundTexture, bumpMap: groundTexture, bumpScale: 0.09, color: theme.ground, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.03, -20);
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.buildCastle();
    this.buildBattlefield();
    this.buildLevelEnvironment();
    this.buildSkyline();
    this.camera.position.set(19, 10, 46);
    this.camera.lookAt(0, 5, -24);
  }

  private buildCastle(): void {
    const { theme } = this.level;
    const stoneTexture = this.createStoneTexture();
    stoneTexture.wrapS = stoneTexture.wrapT = THREE.RepeatWrapping;
    stoneTexture.repeat.set(3.5, 2.5);
    stoneTexture.colorSpace = THREE.SRGBColorSpace;
    const woodTexture = this.createWoodTexture();
    woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
    woodTexture.repeat.set(2, 3);
    woodTexture.colorSpace = THREE.SRGBColorSpace;
    const stone = new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.12, color: theme.stone, roughness: 0.88, metalness: 0.03 });
    const darkStone = new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.15, color: theme.darkStone, roughness: 0.93 });
    const paleStone = new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.1, color: theme.paleStone, roughness: 0.86 });
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture, bumpMap: woodTexture, bumpScale: 0.09, color: theme.wood, roughness: 0.84, metalness: 0.04 });
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

    this.banner = this.createBanner(this.level.boss.color, this.level.theme.paleStone, true);
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
    const wood = new THREE.MeshStandardMaterial({ color: this.level.theme.wood, roughness: 0.94 });
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
      const radius = 0.18 + this.random() * 0.75;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(radius, 0),
        new THREE.MeshStandardMaterial({ color: this.level.theme.rock, roughness: 1 }),
      );
      rock.position.set(x, rock.geometry.boundingSphere?.radius ?? 0.2, z);
      const heightScale = 0.45 + this.random() * 0.6;
      rock.scale.y = heightScale;
      rock.rotation.set(this.random(), this.random() * Math.PI, this.random());
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
      this.registerDestructible(rock, 'rock', 'stone', 16 + radius * 38, Math.max(0.22, radius * 0.86), radius * 2 * heightScale, 0, this.level.theme.rock);
    }

    for (let index = 0; index < 14; index += 1) {
      const x = (index % 2 ? 1 : -1) * (10 + this.random() * 25);
      const z = 4 + this.random() * 32;
      const height = 3 + this.random() * 2.8;
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, height, 5), new THREE.MeshStandardMaterial({ color: 0x211a14, roughness: 1 }));
      stake.position.set(x, 1.2, z);
      stake.rotation.z = (this.random() - 0.5) * 0.3;
      stake.castShadow = true;
      this.scene.add(stake);
      this.registerDestructible(stake, 'stake', 'wood', 18, 0.28, height, 0, 0x3b2819);
    }

    for (const [x, z] of [[-14, 28], [15, 32], [-23, 20], [25, 12]] as [number, number][]) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.7, 3.1, 4), new THREE.MeshStandardMaterial({ color: 0x3d4e4c, roughness: 1, side: THREE.DoubleSide }));
      tent.position.set(x, 1.55, z);
      tent.rotation.y = Math.PI / 4;
      tent.scale.z = 1.35;
      tent.castShadow = true;
      this.scene.add(tent);
      this.registerDestructible(tent, 'tent', 'wood', 78, 2.45, 3.1, 0, 0x405957);
      this.createTorch(new THREE.Vector3(x + 3.3, 0.2, z));
    }

    for (const [x, z, scale] of [
      [-34, 30, 1.25], [-29, 12, 0.95], [33, 26, 1.2], [37, 4, 0.9],
      [-36, -12, 1.1], [36, -18, 1.25], [-22, -63, 0.85], [22, -70, 0.9],
    ] as [number, number, number][]) this.createBattleTree(x, z, scale);

    for (const [x, z, layers] of [
      [-11, 7, 2], [12, -7, 3], [-18, -17, 2], [9, -35, 3], [-10, -51, 2], [7, -68, 2],
      [19, 17, 2], [-15, -38, 2],
    ] as [number, number, number][]) this.createCrateStack(x, z, layers);

    for (const [x, z, rotation] of [
      [-8, 1, 0.18], [9, -14, -0.2], [-12, -33, 0.08], [10, -55, -0.12],
      [17, 9, -0.3], [-8, -48, 0.24], [-8, -72, -0.18],
    ] as [number, number, number][]) this.createBarricade(x, z, rotation);

    for (const [x, z, rotation] of [
      [-18, 23, 0.2], [20, -4, -0.35], [-12, -52, 0.15],
    ] as [number, number, number][]) this.createSupplyCart(x, z, rotation);

    for (const [x, z, rotation] of [
      [10, 13, 0.12], [-21, -5, -0.18], [12, -37, 0.08], [-9, -56, -0.1], [10, -73, 0.2],
    ] as [number, number, number][]) this.createLogPile(x, z, rotation);

    for (const [x, z] of [
      [-7, -31], [8, -48], [-12, -55], [-3, -68], [-3, -74],
    ] as [number, number][]) this.createUrnCluster(x, z);

    for (const [x, z, rotation] of [
      [-14, -10, 0.15], [15, -35, -0.22], [-9, -50, 0.1], [9, -65, -0.2],
    ] as [number, number, number][]) this.createWeaponRack(x, z, rotation);

    for (const [x, z] of [
      [-6, -9], [7, -15], [-13, -34], [11, -49], [-8, -67], [8, -70],
    ] as [number, number][]) this.createExplosiveBarrel(x, z);

    for (const [x, z] of [[-10, 5], [11, -4], [-7, -36], [6, -54], [-5, -65]] as [number, number][]) {
      this.createMine(x, z, 'enemies');
    }
  }

  private buildLevelEnvironment(): void {
    const environment = this.level.environment;
    if (environment === 'ash') {
      for (const [x, z] of [[-18, 2], [18, -18], [-16, -45], [15, -63]] as [number, number][]) {
        this.createEmberVent(x, z);
      }
      return;
    }
    if (environment === 'frost') {
      for (const [x, z, scale] of [
        [-9, 7, 1.25], [10, -4, 1], [-15, -17, 1.4], [14, -37, 1.2], [-8, -52, 0.95], [8, -67, 1.3], [-18, -70, 1.1], [17, 22, 1.5],
      ] as [number, number, number][]) this.createCrystalCluster(x, z, scale, 0x8ce9ff);
      for (const [x, z, radius] of [[-5, 0, 2.5], [7, -35, 2.7], [-5, -55, 2.3], [5, -69, 2.2]] as [number, number, number][]) {
        this.createHazardPool(x, z, radius, 7, 14, 0x70d8ff);
      }
      return;
    }
    if (environment === 'verdant') {
      for (const [x, z, scale] of [[-8, 4, 0.75], [13, -10, 0.9], [-17, -36, 0.8], [15, -51, 0.72], [-9, -64, 0.7], [10, -73, 0.64]] as [number, number, number][]) {
        this.createBattleTree(x, z, scale);
      }
      for (const [x, z] of [[-5, -7], [7, -40], [-6, -59], [6, -69]] as [number, number][]) {
        this.createHazardPool(x, z, 2.45, 10, 4, 0x6fcf3f);
        this.createMushroomCluster(x + 2.5, z - 0.8);
      }
      return;
    }
    if (environment === 'foundry') {
      for (const [x, z, radius] of [[-7, 4, 2.9], [8, -19, 2.7], [-7, -42, 2.6], [7, -58, 2.35], [-5, -70, 2.2]] as [number, number, number][]) {
        this.createHazardPool(x, z, radius, 15, 0, 0xff4c17);
      }
      for (const [x, z] of [[-14, 1], [15, -24], [-14, -49], [13, -66]] as [number, number][]) this.createForgePylon(x, z);
      for (const [x, z] of [[-4, -19], [5, -45], [-6, -67]] as [number, number][]) this.createExplosiveBarrel(x, z);
      return;
    }
    for (const [x, z, radius] of [[-6, 2, 2.6], [7, -22, 2.8], [-7, -43, 2.45], [6, -58, 2.4], [-5, -69, 2.15]] as [number, number, number][]) {
      this.createHazardPool(x, z, radius, 12, 10, 0xa14cff);
    }
    for (const [x, z, scale] of [[-12, 8, 1], [13, -12, 1.2], [-14, -38, 1.1], [13, -55, 0.9], [-9, -68, 0.86], [9, -72, 0.9]] as [number, number, number][]) {
      this.createVoidObelisk(x, z, scale);
    }
  }

  private createHazardPool(x: number, z: number, radius: number, damage: number, staminaDrain: number, color: number): void {
    const y = castleGroundHeight(x, z) + 0.035;
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 28),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.45, transparent: true, opacity: 0.58, roughness: 0.28, side: THREE.DoubleSide }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, y, z);
    this.scene.add(pool);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.72, radius, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.015, z);
    this.scene.add(ring);
    this.hazards.push({ position: new THREE.Vector3(x, y, z), radius, damage, staminaDrain, color });
  }

  private createCrystalCluster(x: number, z: number, scale: number, color: number): void {
    const group = new THREE.Group();
    const y = castleGroundHeight(x, z);
    group.position.set(x, y, z);
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.32, metalness: 0.18, roughness: 0.24, transparent: true, opacity: 0.88 });
    for (const [ox, oz, height, tilt] of [[0, 0, 3.8, 0], [-0.7, 0.3, 2.7, -0.2], [0.65, 0.45, 2.3, 0.22], [0.2, -0.65, 1.9, 0.12]] as [number, number, number, number][]) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.48 * scale, height * scale, 6), material);
      shard.position.set(ox * scale, height * scale * 0.5, oz * scale);
      shard.rotation.z = tilt;
      shard.castShadow = true;
      group.add(shard);
    }
    this.scene.add(group);
    this.registerDestructible(group, 'rock', 'stone', 84 * scale, 1.05 * scale, 4 * scale, 1.8 * scale, color);
  }

  private createMushroomCluster(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    const stemMaterial = new THREE.MeshStandardMaterial({ color: 0xd5c5a3, roughness: 0.8 });
    const capMaterial = new THREE.MeshStandardMaterial({ color: 0x74c947, emissive: 0x3d7d22, emissiveIntensity: 0.5, roughness: 0.65 });
    for (let index = 0; index < 6; index += 1) {
      const height = 0.28 + this.random() * 0.55;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.065, height, 6), stemMaterial);
      stem.position.set((this.random() - 0.5) * 1.25, height * 0.5, (this.random() - 0.5) * 1.25);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15 + this.random() * 0.16, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), capMaterial);
      cap.position.copy(stem.position).setY(height);
      group.add(stem, cap);
    }
    this.scene.add(group);
  }

  private createForgePylon(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    const iron = new THREE.MeshStandardMaterial({ color: 0x292b2d, metalness: 0.82, roughness: 0.34 });
    const heat = new THREE.MeshStandardMaterial({ color: 0x66210f, emissive: 0xff4b16, emissiveIntensity: 1.5, roughness: 0.48 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.05, 4.2, 10), iron);
    body.position.y = 2.1;
    body.castShadow = true;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 2.8, 10), heat);
    core.position.y = 2.05;
    group.add(body, core);
    for (const y of [0.45, 2.05, 3.65]) {
      const brace = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.12, 6, 12), iron);
      brace.rotation.x = Math.PI / 2;
      brace.position.y = y;
      group.add(brace);
    }
    this.scene.add(group);
    this.registerDestructible(group, 'rock', 'stone', 145, 1.1, 4.2, 2.1, 0x393a3c);
  }

  private createVoidObelisk(x: number, z: number, scale: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    group.scale.setScalar(scale);
    const stone = new THREE.MeshStandardMaterial({ color: 0x241b3b, emissive: 0x5e25a8, emissiveIntensity: 0.38, metalness: 0.22, roughness: 0.52 });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.44, 0), new THREE.MeshBasicMaterial({ color: 0xc290ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.76, 5.3, 5), stone);
    pillar.position.y = 2.65;
    pillar.rotation.y = Math.PI / 5;
    pillar.castShadow = true;
    core.position.y = 4.2;
    group.add(pillar, core);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.06, 7, 22), new THREE.MeshBasicMaterial({ color: 0xa95cff, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending }));
    halo.position.y = 4.2;
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    this.scene.add(group);
    this.registerDestructible(group, 'rock', 'stone', 128 * scale, 0.8 * scale, 5.3 * scale, 2.6 * scale, 0x6c3b9c);
  }

  private createEmberVent(x: number, z: number): void {
    const y = castleGroundHeight(x, z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.74, 0.14, 7, 12),
      new THREE.MeshStandardMaterial({ color: 0x452016, emissive: 0xff4818, emissiveIntensity: 0.9, roughness: 0.65 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y + 0.08, z);
    this.scene.add(ring);
  }

  private createBattleTree(x: number, z: number, scale: number): void {
    const ground = castleGroundHeight(x, z);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: this.level.theme.wood, roughness: 1 });
    const foliage = this.level.environment === 'frost' ? 0xb7d8dd : this.level.environment === 'verdant' ? 0x315f35 : this.level.environment === 'eclipse' ? 0x332551 : 0x263f34;
    const crownMaterial = new THREE.MeshStandardMaterial({ color: foliage, roughness: 0.96, flatShading: true });
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
    this.registerDestructible(tree, 'tree', 'wood', 118 * scale, 0.82 * scale, 6.8 * scale, 3.2 * scale, 0x3f2d1e);
  }

  private createCrateStack(x: number, z: number, layers: number): void {
    const material = new THREE.MeshStandardMaterial({ map: this.createWoodTexture(), color: 0x704526, roughness: 0.9 });
    const ground = castleGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, ground, z);
    for (let layer = 0; layer < layers; layer += 1) {
      const count = Math.max(1, layers - layer);
      for (let index = 0; index < count; index += 1) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), material);
        crate.position.set((index - (count - 1) / 2) * 1.08, 0.54 + layer * 1.06, 0);
        crate.rotation.y = (this.random() - 0.5) * 0.18;
        crate.castShadow = crate.receiveShadow = true;
        group.add(crate);
      }
    }
    this.scene.add(group);
    this.registerDestructible(group, 'crates', 'wood', 42 + layers * 30, 0.7 + layers * 0.48, layers * 1.08, layers * 0.54, 0x784729);
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
    this.registerDestructible(group, 'barricade', 'wood', 82, 2.35, 2.75, 1.2, 0x4f2c18);
  }

  private createSupplyCart(x: number, z: number, rotation: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    group.rotation.y = rotation;
    const wood = new THREE.MeshStandardMaterial({ map: this.createWoodTexture(), color: 0x654024, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2c3032, metalness: 0.76, roughness: 0.36 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.42, 2.8), wood);
    bed.position.y = 1.05;
    bed.castShadow = bed.receiveShadow = true;
    group.add(bed);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 2.9), wood);
      wall.position.set(side * 1.02, 1.55, 0);
      wall.castShadow = true;
      group.add(wall);
      for (const zOffset of [-0.9, 0.9]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 10), iron);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 1.16, 0.62, zOffset);
        wheel.castShadow = true;
        group.add(wheel);
      }
    }
    for (const xOffset of [-0.62, 0.62]) {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), wood);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(xOffset, 0.82, 2.45);
      group.add(handle);
    }
    this.scene.add(group);
    this.registerDestructible(group, 'cart', 'wood', 112, 1.75, 2.2, 1.1, 0x684124);
  }

  private createLogPile(x: number, z: number, rotation: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    group.rotation.y = rotation;
    const bark = new THREE.MeshStandardMaterial({ color: 0x4d2d1b, roughness: 1 });
    const cut = new THREE.MeshStandardMaterial({ color: 0xa0784b, roughness: 0.92 });
    for (let index = 0; index < 7; index += 1) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 2.8, 8), index % 3 === 0 ? cut : bark);
      log.rotation.x = Math.PI / 2;
      log.position.set((index % 3 - 1) * 0.48, 0.28 + Math.floor(index / 3) * 0.43, 0);
      log.castShadow = log.receiveShadow = true;
      group.add(log);
    }
    this.scene.add(group);
    this.registerDestructible(group, 'logs', 'wood', 68, 1.45, 1.25, 0.62, 0x57311c);
  }

  private createUrnCluster(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    const clay = new THREE.MeshStandardMaterial({ color: 0x8a6545, roughness: 0.84, flatShading: true });
    for (const [ox, oz, scale] of [[-0.42, 0.1, 0.88], [0.25, -0.2, 1.1], [0.5, 0.42, 0.72]] as [number, number, number][]) {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.38 * scale, 9, 6), clay);
      body.scale.y = 1.18;
      body.position.set(ox, 0.42 * scale, oz);
      body.castShadow = body.receiveShadow = true;
      group.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.22 * scale, 0.32 * scale, 8), clay);
      neck.position.set(ox, 0.77 * scale, oz);
      neck.castShadow = true;
      group.add(neck);
    }
    this.scene.add(group);
    this.registerDestructible(group, 'urns', 'stone', 26, 0.9, 1.3, 0.65, 0x9a7655);
  }

  private createWeaponRack(x: number, z: number, rotation: number): void {
    const group = new THREE.Group();
    group.position.set(x, castleGroundHeight(x, z), z);
    group.rotation.y = rotation;
    const wood = new THREE.MeshStandardMaterial({ color: 0x4b2e1d, roughness: 0.94 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2a6, metalness: 0.82, roughness: 0.28 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 0.18), wood);
      post.position.set(side * 0.9, 1.1, 0);
      post.castShadow = true;
      group.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.2, 0.22), wood);
    rail.position.y = 1.25;
    rail.castShadow = true;
    group.add(rail);
    for (const offset of [-0.58, 0, 0.58]) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.35, 5), wood);
      shaft.position.set(offset, 1.25, 0.12);
      shaft.rotation.z = offset * 0.08;
      group.add(shaft);
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 5), steel);
      blade.position.set(offset, 2.52, 0.12);
      blade.rotation.z = offset * 0.08;
      blade.castShadow = true;
      group.add(blade);
    }
    this.scene.add(group);
    this.registerDestructible(group, 'weapon-rack', 'wood', 54, 1.2, 2.85, 1.42, 0x5a3520);
  }

  private registerDestructible(
    root: THREE.Object3D,
    kind: DestructibleKind,
    surface: Extract<ImpactSurface, 'wood' | 'stone'>,
    maxHealth: number,
    radius: number,
    height: number,
    centerOffsetY: number,
    debrisColor: number,
  ): void {
    root.userData.destructibleKind = kind;
    this.destructibles.push({
      root,
      kind,
      surface,
      health: maxHealth,
      maxHealth,
      radius,
      height,
      centerOffsetY,
      debrisColor,
      destroyed: false,
    });
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
    const mountainMaterial = new THREE.MeshStandardMaterial({ color: this.level.theme.mountain, roughness: 1, flatShading: true });
    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2;
      const radius = 118 + this.random() * 30;
      const height = 20 + this.random() * 34;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(10 + this.random() * 12, height, 5), mountainMaterial);
      mountain.position.set(Math.sin(angle) * radius, height * 0.5 - 1, Math.cos(angle) * radius);
      mountain.rotation.y = this.random() * Math.PI;
      this.scene.add(mountain);
    }
    const moon = new THREE.Mesh(new THREE.SphereGeometry(this.level.environment === 'eclipse' ? 6.2 : 4.5, 20, 12), new THREE.MeshBasicMaterial({ color: this.level.theme.moon }));
    moon.position.set(58, 45, -126);
    this.scene.add(moon);
    if (this.level.environment === 'eclipse') {
      const shadow = new THREE.Mesh(new THREE.SphereGeometry(5.4, 20, 12), new THREE.MeshBasicMaterial({ color: 0x090713 }));
      shadow.position.set(56.7, 45.8, -123.5);
      this.scene.add(shadow);
    }
  }

  private spawnBattle(): void {
    this.player = this.createActor('player', 'allies', this.level.playerHealth, 4.9, 3.1, this.level.playerDamage);
    this.player.rig.root.position.copy(PLAYER_START);
    this.player.rig.setGroundHeight(0);

    for (let index = 0; index < this.level.allyCount; index += 1) {
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

    const difficulty = 1 + (this.level.order - 1) * 0.075;
    for (let index = 0; index < this.level.enemyCount; index += 1) {
      const role: Role = index % 11 === 0 ? 'brute' : index % 7 === 0 ? 'archer' : 'soldier';
      const actor = this.createActor(
        role,
        'enemies',
        (role === 'brute' ? 190 : role === 'archer' ? 70 : 96) * difficulty,
        (role === 'brute' ? 3.05 : role === 'archer' ? 3.12 : 3.66) + (this.level.order - 1) * 0.035,
        role === 'archer' ? 16 : role === 'brute' ? 2.9 : 2.3,
        (role === 'brute' ? 34 : role === 'archer' ? 12 : 17) * (1 + (this.level.order - 1) * 0.055),
      );
      let x: number;
      let z: number;
      const frontCount = Math.ceil(this.level.enemyCount * 0.44);
      const terraceEnd = frontCount + Math.ceil(this.level.enemyCount * 0.29);
      if (index < frontCount) {
        x = (index % 7 - 3) * 3.1 + (this.random() - 0.5) * 1.2;
        z = -5 - Math.floor(index / 7) * 3.3;
      } else if (index < terraceEnd) {
        const localIndex = index - frontCount;
        x = (localIndex % 5 - 2) * 3.2;
        z = -49 - Math.floor(localIndex / 5) * 4.2;
      } else {
        const localIndex = index - terraceEnd;
        x = (localIndex % 5 - 2) * 2.8;
        z = -66.5 - Math.floor(localIndex / 5) * 4;
      }
      const height = castleGroundHeight(x, z);
      actor.rig.root.position.set(x, height, z);
      actor.rig.setGroundHeight(height);
    }

    const boss = this.level.boss;
    this.boss = this.createActor('boss', 'enemies', boss.health, boss.speed, boss.attackRange, boss.damage);
    this.boss.rig.root.position.set(0, CASTLE_LIMITS.summitHeight, CASTLE_LIMITS.summitZ - 2);
    this.boss.rig.setGroundHeight(CASTLE_LIMITS.summitHeight);
    this.boss.rig.root.visible = false;
    this.boss.dead = false;
    this.decorateBoss();
    this.emitHud(true);
  }

  private decorateBoss(): void {
    const signature = new THREE.Group();
    signature.name = `boss-signature-${this.level.id}`;
    const color = this.level.boss.color;
    const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: this.level.theme.darkStone, emissive: color, emissiveIntensity: 0.26, metalness: 0.72, roughness: 0.34 });
    const aura = new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.055, 7, 30), glow);
    aura.rotation.x = Math.PI / 2;
    aura.position.y = 0.08;
    signature.add(aura);

    if (this.level.environment === 'frost') {
      for (const [x, y, tilt] of [[-0.82, 2.25, -0.42], [0.82, 2.25, 0.42], [-0.48, 2.78, -0.18], [0.48, 2.78, 0.18]] as [number, number, number][]) {
        const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 6), glow);
        crystal.position.set(x, y, 0);
        crystal.rotation.z = tilt;
        signature.add(crystal);
      }
    } else if (this.level.environment === 'verdant') {
      for (const side of [-1, 1]) {
        const antler = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 6, 12, Math.PI * 1.2), metal);
        antler.position.set(side * 0.56, 2.62, -0.05);
        antler.rotation.set(Math.PI / 2, side * 0.28, side * 0.55);
        signature.add(antler);
      }
      const crownVine = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 6, 18), glow);
      crownVine.rotation.x = Math.PI / 2;
      crownVine.position.y = 2.38;
      signature.add(crownVine);
    } else if (this.level.environment === 'foundry') {
      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.52, 0.92), metal);
        shoulder.position.set(side * 0.86, 2.05, 0);
        shoulder.rotation.z = side * 0.18;
        const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.8, 8), glow);
        chimney.position.set(side * 0.9, 2.72, 0.1);
        signature.add(shoulder, chimney);
      }
    } else if (this.level.environment === 'eclipse') {
      for (const [radius, tilt] of [[0.72, 0.22], [0.98, -0.35]] as [number, number][]) {
        const halo = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.055, 7, 30), glow);
        halo.position.set(0, 2.62, -0.22);
        halo.rotation.set(Math.PI / 2, tilt, 0);
        signature.add(halo);
      }
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glow);
      core.position.set(0, 2.63, -0.25);
      signature.add(core);
    } else {
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.88, 6), metal);
        horn.position.set(side * 0.62, 2.68, 0);
        horn.rotation.z = side * -0.5;
        signature.add(horn);
      }
    }
    this.boss.rig.root.add(signature);
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
      swingStarted: false,
      attackTrailTimer: 0,
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
    this.updateLevelHazards(delta);
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
    if (this.player.action === 'attack') {
      const profile = meleeAttackProfile('soldier');
      this.updateMeleeAttack(this.player, profile, delta);
      if (this.player.actionTime >= profile.duration) this.player.action = 'idle';
    }
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
      this.damageJumpObstacles();
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
    const moveSpeed = this.player.speed * sprint * (this.player.action === 'block' ? 0.38 : this.player.action === 'attack' ? 0.32 : 1);
    const direction = movementDirection(inputX, inputZ, this.yaw);
    if (direction) {
      this.temp.set(direction.x, 0, direction.z);
      this.player.rig.root.position.addScaledVector(this.temp, moveSpeed * delta);
      if (this.player.action !== 'attack' && this.player.action !== 'block') this.player.action = 'run';
      if (this.player.action !== 'attack') this.player.rig.root.rotation.y = dampAngle(this.player.rig.root.rotation.y, Math.atan2(direction.x, direction.z), 12, delta);
    } else if (this.player.action === 'run') this.player.action = 'idle';
    this.resolveWorldCollision(this.player.rig.root.position);
    this.resolveRamCollision(this.player.rig.root.position);
    this.resolveDestructibleCollision(this.player.rig.root.position);
    this.syncActorGround(this.player, delta);
    this.player.rig.setState(this.player.action, inputStrength, delta);
  }

  private updateObjectives(delta: number): void {
    this.ramVelocityZ = 0;
    if (this.phase === 0) {
      const playerNear = distanceXZ(this.player.rig.root.position, this.ram.position) < 16;
      const nearbyAllies = this.actors.filter((actor) => !actor.dead && actor.team === 'allies' && distanceXZ(actor.rig.root.position, this.ram.position) < 8).length;
      if (playerNear && nearbyAllies >= 2) {
        const previousZ = this.ram.position.z;
        this.ram.position.z = Math.max(-21.9, previousZ - delta * 1.25);
        if (delta > 0) this.ramVelocityZ = (this.ram.position.z - previousZ) / delta;
      }
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
      const assault = this.summitAssaultState();
      if (summitAssaultReady(assault.playerAtSummit, assault.summitAllies, assault.livingAllies)) {
        this.phase = 3;
        this.boss.rig.root.visible = true;
        this.bossAbilityTimer = Math.max(2.8, this.level.boss.abilityCooldown * 0.62);
        this.audio.horn();
        this.events.onFeed(`<b>Верхний двор взят.</b> ${this.level.boss.title} ${this.level.boss.name} выходит на бой!`);
        this.events.onBattleEvent('phase', 3);
      }
    } else if (this.phase === 3) {
      if (this.boss.dead) {
        const near = distanceXZ(this.player.rig.root.position, this.banner.position) < 4.2;
        if (near && this.keys.has('KeyE')) this.captureProgress = Math.min(100, this.captureProgress + delta * 34);
        else this.captureProgress = Math.max(0, this.captureProgress - delta * 5);
        if (this.captureProgress >= 100) this.victory();
      } else this.updateBossAbility(delta);
    }
    this.fireballTimer -= delta;
    if (this.fireballTimer <= 0 && this.phase < 3) {
      const [minimum, maximum] = this.level.artilleryDelay;
      this.fireballTimer = minimum + this.random() * (maximum - minimum);
      this.launchFireball();
    }
  }

  private updateBossAbility(delta: number): void {
    this.bossAbilityTimer -= delta;
    if (this.bossAbilityTimer > 0 || this.boss.dead || !this.boss.rig.root.visible) return;
    this.bossAbilityTimer = this.level.boss.abilityCooldown * (0.86 + this.random() * 0.28);
    const bossPosition = this.boss.rig.root.position.clone();
    const color = this.level.boss.color;
    this.events.onFeed(`<b>${this.level.boss.abilityName}</b> · ${this.level.boss.name} применяет особую способность`);
    if (this.level.boss.ability === 'ember-roar') {
      this.spawnBossPulse(bossPosition, color, 5.2);
      this.explode(bossPosition.clone().add(new THREE.Vector3(0, 0.7, 0)), 'enemies', 5.2, 30, 'armor');
      return;
    }
    if (this.level.boss.ability === 'frost-nova') {
      this.spawnBossPulse(bossPosition, color, 7);
      if (distanceXZ(this.player.rig.root.position, bossPosition) < 7) this.player.stamina = Math.max(0, this.player.stamina - 32);
      this.explode(bossPosition.clone().add(new THREE.Vector3(0, 0.3, 0)), 'enemies', 7, 23, 'stone');
      return;
    }
    if (this.level.boss.ability === 'thorn-call') {
      this.spawnBossPulse(bossPosition, color, 4.5);
      for (const side of [-1, 1]) {
        const guard = this.createActor('soldier', 'enemies', 118, 3.82, 2.45, 22);
        const x = bossPosition.x + side * (2.2 + this.random());
        const z = bossPosition.z + 1.4 + this.random() * 1.4;
        const y = castleGroundHeight(x, z);
        guard.rig.root.position.set(x, y, z);
        guard.rig.setGroundHeight(y);
        guard.target = this.player;
        guard.cooldown = 0.35;
        this.spawnImpact(guard.rig.root.position.clone().add(new THREE.Vector3(0, 1, 0)), color, 8);
      }
      return;
    }
    if (this.level.boss.ability === 'magma-quake') {
      this.spawnBossPulse(bossPosition, color, 7.8);
      this.explode(bossPosition.clone().add(new THREE.Vector3(0, 0.25, 0)), 'enemies', 7.8, 42, 'stone');
      return;
    }
    const oldPosition = bossPosition.clone();
    const playerFacing = this.player.rig.root.rotation.y;
    const behind = new THREE.Vector3(-Math.sin(playerFacing), 0, -Math.cos(playerFacing)).multiplyScalar(2.8);
    const nextPosition = this.player.rig.root.position.clone().add(behind);
    nextPosition.x = clamp(nextPosition.x, -9.2, 9.2);
    nextPosition.z = clamp(nextPosition.z, CASTLE_LIMITS.summitZ - 7, CASTLE_LIMITS.secondStairEndZ - 0.8);
    nextPosition.y = castleGroundHeight(nextPosition.x, nextPosition.z);
    this.spawnBossPulse(oldPosition, color, 3.2);
    this.boss.rig.root.position.copy(nextPosition);
    this.boss.rig.setGroundHeight(nextPosition.y);
    this.boss.rig.root.rotation.y = Math.atan2(
      this.player.rig.root.position.x - nextPosition.x,
      this.player.rig.root.position.z - nextPosition.z,
    );
    this.boss.action = 'attack';
    this.boss.actionTime = 0;
    this.boss.hitDone = false;
    this.boss.swingStarted = false;
    this.boss.attackTrailTimer = 0;
    this.boss.trailSweepAngle = undefined;
    this.boss.target = this.player;
    this.spawnBossPulse(nextPosition, color, 3.2);
    this.spawnImpact(nextPosition.clone().add(new THREE.Vector3(0, 1.3, 0)), color, 14);
  }

  private spawnBossPulse(position: THREE.Vector3, color: number, radius: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.68, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(position).add(new THREE.Vector3(0, 0.12, 0));
    const initialScale = 0.72;
    const life = 0.72;
    ring.scale.setScalar(initialScale);
    this.scene.add(ring);
    this.particles.push({
      mesh: ring,
      velocity: new THREE.Vector3(),
      life,
      maxLife: life,
      baseOpacity: 0.78,
      gravity: 0,
      growth: Math.log(radius / (0.68 * initialScale)) / life,
    });
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
          direction.add(strafe).addScaledVector(separation, 1.65);
          if (direction.lengthSq() > 1) direction.normalize();
          actor.rig.root.position.addScaledVector(direction, actor.speed * delta);
          moving = true;
          actor.action = 'run';
        } else if (actor.cooldown <= 0 && actor.action !== 'attack') {
          actor.action = 'attack';
          actor.actionTime = 0;
          actor.hitDone = false;
          actor.swingStarted = false;
          actor.attackTrailTimer = 0;
          actor.trailSweepAngle = undefined;
          actor.cooldown = actor.role === 'boss' ? 0.86 : actor.role === 'brute' ? 1.35 : actor.role === 'archer' ? 1.9 + this.random() : 1.1 + this.random() * 0.45;
          if (actor.role === 'archer') this.audio.bow();
        }
      } else {
        const destination = this.getActorDestination(actor);
        const direction = this.temp.subVectors(destination, actor.rig.root.position);
        direction.y = 0;
        const distance = direction.length();
        const escortingRam = actor.team === 'allies' && this.phase < 2;
        const formationPinnedAtGate = ramEscortGateShift(this.ram.position.z) > 0;
        const anchorVelocityZ = escortingRam && this.phase === 0 && !formationPinnedAtGate ? this.ramVelocityZ : 0;
        if (formationShouldMove(distance, actor.action === 'run', Math.abs(anchorVelocityZ))) {
          const maxSpeed = actor.speed * 0.72;
          const velocity = escortingRam
            ? formationFollowVelocity(direction.x, direction.z, maxSpeed, anchorVelocityZ)
            : { x: distance > 0.001 ? direction.x / distance * maxSpeed : 0, z: distance > 0.001 ? direction.z / distance * maxSpeed : 0 };
          const separation = this.computeSeparation(actor);
          direction.set(velocity.x, 0, velocity.z).addScaledVector(separation, actor.speed * 0.82);
          if (direction.lengthSq() > maxSpeed * maxSpeed) direction.setLength(maxSpeed);
          actor.rig.root.position.addScaledVector(direction, delta);
          if (direction.lengthSq() > 0.0025) actor.rig.root.rotation.y = dampAngle(actor.rig.root.rotation.y, Math.atan2(direction.x, direction.z), 6, delta);
          actor.action = 'run';
          moving = direction.lengthSq() > 0.0025;
        } else actor.action = 'idle';
      }

      if (actor.action === 'attack') {
        if (actor.role === 'archer') {
          if (!actor.hitDone && actor.actionTime >= 0.52) {
            actor.hitDone = true;
            this.fireArrow(actor);
          }
          if (actor.actionTime >= 0.78) actor.action = 'idle';
        } else {
          const profile = meleeAttackProfile(actor.role === 'player' ? 'soldier' : actor.role);
          this.updateMeleeAttack(actor, profile, delta);
          if (actor.actionTime >= profile.duration) actor.action = 'idle';
        }
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
    const escortPosition = actor.team === 'allies' && this.phase < 2 ? this.getActorDestination(actor) : undefined;
    for (const candidate of this.actors) {
      if (candidate.dead || candidate.team === actor.team || candidate === this.boss && this.phase < 3) continue;
      if (Math.abs(candidate.rig.root.position.y - actor.rig.root.position.y) > 4.25) continue;
      const separatedByClosedGate = this.phase < 2
        && ((actor.rig.root.position.z > -24.3 && candidate.rig.root.position.z < -29.8)
          || (actor.rig.root.position.z < -29.8 && candidate.rig.root.position.z > -24.3));
      if (separatedByClosedGate) continue;
      if (escortPosition && distanceXZ(candidate.rig.root.position, escortPosition) > 7.5) continue;
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
        const gateShift = ramEscortGateShift(this.ram.position.z);
        return new THREE.Vector3(this.ram.position.x + escort.x, 0, this.ram.position.z + escort.z + gateShift);
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
    const friendlySpacing = actor.team === 'allies' && this.phase < 2 ? 1.65 : 1.12;
    for (const other of this.actors) {
      if (other === actor || other.dead) continue;
      if (Math.abs(actor.rig.root.position.y - other.rig.root.position.y) > 2.5) continue;
      const distance = distanceXZ(actor.rig.root.position, other.rig.root.position);
      const minimumSpacing = other.team === actor.team ? friendlySpacing : 1.02;
      if (distance < 0.001) {
        force.x += actor.id.localeCompare(other.id) > 0 ? minimumSpacing : -minimumSpacing;
      } else if (distance < minimumSpacing) {
        force.add(this.temp2.subVectors(actor.rig.root.position, other.rig.root.position).setY(0).normalize().multiplyScalar((minimumSpacing - distance) * 1.7));
      }
    }
    return force;
  }

  private updateMeleeAttack(actor: Actor, profile: MeleeAttackProfile, delta: number): void {
    const phase = attackPhaseAt(actor.actionTime, profile);
    if (phase === 'active') {
      if (!actor.swingStarted) {
        actor.swingStarted = true;
        if (actor === this.player || distanceXZ(actor.rig.root.position, this.player.rig.root.position) < 16) this.audio.sword();
      }
      actor.attackTrailTimer -= delta;
      if (actor.attackTrailTimer <= 0) {
        actor.attackTrailTimer = 0.035;
        this.spawnBladeTrail(actor, profile);
      }
      if (!actor.hitDone && this.applyMeleeContact(actor, profile, delta)) actor.hitDone = true;
    } else if ((phase === 'recovery' || phase === 'finished') && !actor.hitDone) {
      actor.hitDone = true;
    }
  }

  private applyMeleeContact(actor: Actor, profile: MeleeAttackProfile, delta: number): boolean {
    const position = actor.rig.root.position;
    const attacker = { x: position.x, z: position.z, rotation: actor.rig.root.rotation.y };
    const range = actor.attackRange + 0.42;
    let target: Actor | undefined;
    let targetDistance = Number.POSITIVE_INFINITY;
    const candidates = actor === this.player ? this.actors : actor.target ? [actor.target] : [];
    for (const candidate of candidates) {
      if (candidate === actor || candidate.dead || candidate.team === actor.team || candidate === this.boss && this.phase < 3) continue;
      if (Math.abs(candidate.rig.root.position.y - position.y) > 3.2) continue;
      const radius = candidate.role === 'boss' ? 1.05 : candidate.role === 'brute' ? 0.78 : 0.6;
      if (!sweptBladeContact(attacker, candidate.rig.root.position, actor.actionTime, profile, range, radius, actor.actionTime - delta)) continue;
      const distance = distanceXZ(position, candidate.rig.root.position);
      if (distance < targetDistance) {
        target = candidate;
        targetDistance = distance;
      }
    }
    if (target) {
      this.damageActor(target, actor.damage * (0.88 + this.random() * 0.28), actor, 'melee');
      return true;
    }

    if (actor === this.player && this.phase === 1 && sweptBladeContact(attacker, this.gateGroup.position, actor.actionTime, profile, range, 2.35, actor.actionTime - delta)) {
      this.damageGate(3.5);
      this.spawnArmorHitEffect(new THREE.Vector3(attacker.x, position.y + 1.15, attacker.z).add(new THREE.Vector3(Math.sin(attacker.rotation), 0, Math.cos(attacker.rotation)).multiplyScalar(2.6)), true);
      this.audio.hit(false);
      return true;
    }

    for (const explosive of this.explosives) {
      if (!explosive.armed || !sweptBladeContact(attacker, explosive.group.position, actor.actionTime, profile, range, explosive.triggerRadius, actor.actionTime - delta)) continue;
      this.detonateExplosive(explosive, actor.team);
      return true;
    }

    let closestProp: DestructibleProp | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const prop of this.destructibles) {
      if (prop.destroyed || Math.abs(prop.root.position.y - position.y) > 3.4) continue;
      if (!sweptBladeContact(attacker, prop.root.position, actor.actionTime, profile, range, prop.radius * 0.72, actor.actionTime - delta)) continue;
      const distance = distanceXZ(position, prop.root.position);
      if (distance < closestDistance) {
        closestProp = prop;
        closestDistance = distance;
      }
    }
    if (!closestProp) return false;
    const force = new THREE.Vector3(Math.sin(attacker.rotation), 0.22, Math.cos(attacker.rotation)).normalize();
    const impact = new THREE.Vector3(
      closestProp.root.position.x,
      closestProp.root.position.y + Math.min(closestProp.centerOffsetY, 1.25),
      closestProp.root.position.z,
    );
    this.damageDestructible(closestProp, actor.damage * (actor === this.player ? 1.18 : 0.9), impact, force);
    this.audio.hit(false);
    return true;
  }

  private playerAttack(): void {
    if (this.mode !== 'running' || this.player.dead || this.jumpTimer > 0 || this.player.action === 'attack' || this.player.cooldown > 0 || this.player.stamina < 12) return;
    const profile = meleeAttackProfile('soldier');
    this.player.action = 'attack';
    this.player.actionTime = 0;
    this.player.hitDone = false;
    this.player.swingStarted = false;
    this.player.attackTrailTimer = 0;
    this.player.trailSweepAngle = undefined;
    this.player.cooldown = profile.duration + 0.06;
    this.player.stamina -= 12;
    this.player.rig.root.rotation.y = this.yaw;
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

  private damageJumpObstacles(): void {
    const playerPosition = this.player.rig.root.position;
    const contact = new THREE.Vector3(playerPosition.x, playerPosition.y + 0.82, playerPosition.z);
    let smashed = false;
    for (const prop of this.destructibles) {
      if (prop.destroyed || !pointHitsObstacle(contact, {
        x: prop.root.position.x,
        y: prop.root.position.y + prop.centerOffsetY,
        z: prop.root.position.z,
        radius: prop.radius,
        height: prop.height,
      }, 0.72)) continue;
      smashed = this.damageDestructible(prop, prop.maxHealth + 1, contact, this.jumpDirection) || smashed;
    }
    for (const explosive of this.explosives) {
      if (!explosive.armed || distanceXZ(playerPosition, explosive.group.position) > explosive.triggerRadius + 0.72) continue;
      this.detonateExplosive(explosive, explosive.kind === 'mine' ? explosive.team : 'allies');
      smashed = true;
    }
    if (smashed) {
      this.cameraShake = Math.max(this.cameraShake, 0.24);
      this.audio.hit(false);
    }
  }

  private damageDestructible(prop: DestructibleProp, damage: number, impact: THREE.Vector3, force: THREE.Vector3): boolean {
    const next = applyDestructibleDamage(prop, damage);
    if (next === prop || next.health === prop.health && next.destroyed === prop.destroyed) return false;
    prop.health = next.health;
    prop.destroyed = next.destroyed;
    if (!prop.destroyed) {
      this.spawnImpact(impact, prop.surface === 'stone' ? 0xb7aa91 : 0xb87942, 4);
      return true;
    }
    prop.root.visible = false;
    this.spawnDestructibleDebris(prop, impact, force);
    this.cameraShake = Math.max(this.cameraShake, clamp(prop.radius * 0.12, 0.08, 0.38));
    return true;
  }

  private spawnDestructibleDebris(prop: DestructibleProp, impact: THREE.Vector3, force: THREE.Vector3): void {
    const fragmentCount = Math.min(22, 7 + Math.round(prop.radius * 5));
    const size = clamp(prop.radius * 0.12, 0.07, 0.24);
    this.spawnImpact(impact, prop.surface === 'stone' ? 0xd1c2a5 : 0xc77a3d, 8 + Math.round(prop.radius * 3));
    for (let index = 0; index < fragmentCount; index += 1) {
      const geometry = prop.surface === 'stone'
        ? new THREE.DodecahedronGeometry(size * (0.55 + this.random() * 0.8), 0)
        : new THREE.BoxGeometry(size * (0.45 + this.random()), size * (0.35 + this.random() * 0.7), size * (1 + this.random() * 1.6));
      const fragment = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: prop.debrisColor, transparent: true }));
      fragment.position.copy(impact).addScaledVector(force, 0.42).add(new THREE.Vector3((this.random() - 0.5) * prop.radius, this.random() * Math.min(prop.height, 1.6), (this.random() - 0.5) * prop.radius));
      fragment.rotation.set(this.random() * Math.PI, this.random() * Math.PI, this.random() * Math.PI);
      this.scene.add(fragment);
      const life = 0.72 + this.random() * 0.72;
      this.particles.push({
        mesh: fragment,
        velocity: force.clone().multiplyScalar(2.2 + this.random() * 4.4).add(new THREE.Vector3((this.random() - 0.5) * 4.8, 2.2 + this.random() * 4.8, (this.random() - 0.5) * 4.8)),
        life,
        maxLife: life,
        gravity: prop.surface === 'stone' ? 9.8 : 7.8,
        drag: 0.24,
        spin: new THREE.Vector3(4 + this.random() * 9, 4 + this.random() * 9, 4 + this.random() * 9),
      });
    }
  }

  private damageActor(target: Actor, rawDamage: number, attacker: Actor, kind: DamageKind = 'melee'): void {
    if (target.dead) return;
    let damage = rawDamage;
    let blocked = false;
    if (target === this.player && target.action === 'block' && target.stamina > 0) {
      const facing = Math.abs(angleDelta(target.rig.root.rotation.y, Math.atan2(attacker.rig.root.position.x - target.rig.root.position.x, attacker.rig.root.position.z - target.rig.root.position.z)));
      if (facing < Math.PI * 0.68) {
        blocked = true;
        damage *= 0.22;
        target.stamina = Math.max(0, target.stamina - rawDamage * 0.8);
        this.audio.block();
      }
    }
    target.health = Math.max(0, target.health - damage);
    target.lastAttacker = attacker;
    target.rig.flashDamage();
    const hitPosition = target.rig.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const hitDirection = target.rig.root.position.clone().sub(attacker.rig.root.position).setY(0.18);
    if (hitDirection.lengthSq() < 0.01) hitDirection.set(0, 0.18, 1);
    else hitDirection.normalize();
    if (kind !== 'explosion') {
      this.spawnArmorHitEffect(hitPosition, blocked, hitDirection);
      if (!blocked) this.spawnBloodEffect(hitPosition, hitDirection, damage);
    }
    if (!blocked && kind !== 'explosion') this.audio.hit(target.role === 'boss' || target.role === 'brute');
    if (attacker === this.player) {
      this.damageDone += damage;
      if (kind === 'melee') this.cameraShake = Math.max(this.cameraShake, blocked ? 0.1 : 0.16);
    }
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
    if (attacker === this.player) {
      this.kills += 1;
      this.events.onFeed(`<b>${target.role === 'boss' ? `${this.level.boss.title} ${this.level.boss.name} повержен` : 'Страж повержен'}</b> · ${Math.round(attacker.damage)} урона`);
    }
    if (target === this.player) {
      this.jumpTimer = 0;
      this.player.rig.setVerticalOffset(0);
      this.respawnTimer = 3.2;
      this.events.onFeed('<b>Вы пали.</b> Союзники возвращают вас в строй…');
    }
    if (target === this.boss) {
      this.events.onFeed(`<b>${this.level.boss.name} пал.</b> Поднимите знамя у донжона!`);
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
      const previousPosition = projectile.mesh.position.clone();
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
      for (const prop of this.destructibles) {
        if (remove || prop.destroyed || !segmentHitsObstacle(previousPosition, projectile.mesh.position, {
          x: prop.root.position.x,
          y: prop.root.position.y + prop.centerOffsetY,
          z: prop.root.position.z,
          radius: prop.radius,
          height: prop.height,
        }, projectile.fire ? 0.48 : 0.12)) continue;
        if (projectile.fire) {
          this.damageDestructible(prop, prop.maxHealth + 1, projectile.mesh.position, projectile.velocity.clone().normalize());
          this.explode(projectile.mesh.position, projectile.team, 5, 46, prop.surface);
        } else {
          this.damageDestructible(prop, projectile.damage * 1.45, projectile.mesh.position, projectile.velocity.clone().normalize());
        }
        remove = true;
      }
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
          else this.damageActor(actor, projectile.damage, this.findProjectileOwner(projectile.team), 'projectile');
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
        this.damageActor(actor, (1 - distance / radius) * damage, attacker, 'explosion');
      }
    }
    for (const prop of this.destructibles) {
      if (prop.destroyed) continue;
      const edgeDistance = Math.max(0, distanceXZ(prop.root.position, position) - prop.radius * 0.55);
      const propDamage = radialDestructibleDamage(edgeDistance, radius, damage * 1.75);
      if (propDamage <= 0) continue;
      const force = new THREE.Vector3(prop.root.position.x - position.x, 0.3, prop.root.position.z - position.z);
      if (force.lengthSq() < 0.01) force.set(0, 1, 0);
      else force.normalize();
      const impact = new THREE.Vector3(prop.root.position.x, prop.root.position.y + Math.min(prop.centerOffsetY, 1.25), prop.root.position.z);
      this.damageDestructible(prop, propDamage, impact, force);
    }
    for (const explosive of this.explosives) {
      if (!explosive.armed || distanceXZ(explosive.group.position, position) > radius * 0.84) continue;
      window.setTimeout(() => this.detonateExplosive(explosive, sourceTeam), 70 + this.random() * 120);
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

  private updateLevelHazards(delta: number): void {
    if (this.player.dead || this.hazards.length === 0) return;
    this.hazardDamageTimer = Math.max(0, this.hazardDamageTimer - delta);
    const hazard = this.hazards.find((candidate) =>
      Math.abs(this.player.rig.root.position.y - candidate.position.y) < 2.1
      && distanceXZ(this.player.rig.root.position, candidate.position) < candidate.radius * 0.82,
    );
    if (!hazard) return;
    this.player.stamina = Math.max(0, this.player.stamina - hazard.staminaDrain * delta);
    if (hazard.damage <= 0 || this.hazardDamageTimer > 0) return;
    this.hazardDamageTimer = 0.58;
    this.spawnImpact(this.player.rig.root.position.clone().add(new THREE.Vector3(0, 0.35, 0)), hazard.color, 7);
    this.damageActor(this.player, hazard.damage, this.boss, 'explosion');
  }

  private detonateExplosive(explosive: ExplosiveProp, sourceTeam: Team | 'neutral'): void {
    if (!explosive.armed) return;
    explosive.armed = false;
    explosive.group.visible = false;
    const origin = explosive.group.position.clone().add(new THREE.Vector3(0, explosive.kind === 'barrel' ? 0.7 : 0.18, 0));
    this.explode(origin, sourceTeam, explosive.blastRadius, explosive.damage, explosive.kind === 'barrel' ? 'wood' : battlefieldSurfaceAt(origin.x, origin.z));
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

  private spawnBladeTrail(actor: Actor, profile: MeleeAttackProfile): void {
    const sweep = bladeSweepAngle(actor.actionTime, profile);
    if (sweep === undefined) return;
    const facing = actor.rig.root.rotation.y;
    const scale = actor.role === 'boss' ? 1.42 : actor.role === 'brute' ? 1.2 : 1;
    const previousSweep = actor.trailSweepAngle ?? profile.sweepStart;
    actor.trailSweepAngle = sweep;
    if (Math.abs(sweep - previousSweep) < 0.012) return;
    const steps = Math.max(3, Math.ceil(Math.abs(sweep - previousSweep) / 0.1));
    const positions: number[] = [];
    const innerRadius = 0.48 * scale;
    const outerRadius = 2.18 * scale;
    const vertex = (angle: number, radius: number, outer: boolean): [number, number, number] => {
      const worldAngle = facing + angle;
      return [
        Math.sin(worldAngle) * radius,
        (outer ? 1.38 : 0.92) * scale + Math.cos(angle * 0.72) * (outer ? 0.16 : 0.04),
        Math.cos(worldAngle) * radius,
      ];
    };
    for (let index = 0; index < steps; index += 1) {
      const start = previousSweep + (sweep - previousSweep) * (index / steps);
      const end = previousSweep + (sweep - previousSweep) * ((index + 1) / steps);
      const innerStart = vertex(start, innerRadius, false);
      const outerStart = vertex(start, outerRadius, true);
      const innerEnd = vertex(end, innerRadius, false);
      const outerEnd = vertex(end, outerRadius, true);
      positions.push(...innerStart, ...outerStart, ...outerEnd, ...innerStart, ...outerEnd, ...innerEnd);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const trail = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: actor.team === 'allies' ? 0x67cfff : 0xff6d32,
        transparent: true,
        opacity: actor === this.player ? 0.27 : 0.2,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    trail.position.copy(actor.rig.root.position);
    trail.renderOrder = 12;
    this.scene.add(trail);
    this.particles.push({
      mesh: trail,
      velocity: new THREE.Vector3(),
      life: 0.24,
      maxLife: 0.24,
      baseOpacity: actor === this.player ? 0.27 : 0.2,
      gravity: 0,
      drag: 0,
      growth: 0.18,
    });
  }

  private spawnArmorHitEffect(position: THREE.Vector3, blocked: boolean, direction: THREE.Vector3 = FORWARD): void {
    const sparkColor = blocked ? 0xfff1b0 : 0xffb24e;
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(blocked ? 0.19 : 0.13, 8, 5),
      new THREE.MeshBasicMaterial({ color: sparkColor, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    flash.position.copy(position);
    this.scene.add(flash);
    this.particles.push({ mesh: flash, velocity: direction.clone().multiplyScalar(0.35), life: 0.14, maxLife: 0.14, gravity: 0, growth: blocked ? 6 : 4 });

    const sparkCount = blocked ? 17 : 10;
    for (let index = 0; index < sparkCount; index += 1) {
      const spark = new THREE.Mesh(
        new THREE.BoxGeometry(0.026, 0.026, 0.18 + this.random() * 0.3),
        new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? 0xffffff : sparkColor, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      spark.position.copy(position);
      const velocity = direction.clone().multiplyScalar(1.5 + this.random() * 3.8).add(new THREE.Vector3((this.random() - 0.5) * 5.5, (this.random() - 0.15) * 5.2, (this.random() - 0.5) * 5.5));
      spark.quaternion.setFromUnitVectors(FORWARD, velocity.clone().normalize());
      this.scene.add(spark);
      const life = 0.25 + this.random() * 0.3;
      this.particles.push({ mesh: spark, velocity, life, maxLife: life, gravity: 5.4, drag: 0.55 });
    }

    if (blocked) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.28, 16),
        new THREE.MeshBasicMaterial({ color: 0xffe7a0, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      ring.position.copy(position);
      ring.quaternion.setFromUnitVectors(FORWARD, direction.clone().normalize());
      this.scene.add(ring);
      this.particles.push({ mesh: ring, velocity: direction.clone().multiplyScalar(0.5), life: 0.2, maxLife: 0.2, gravity: 0, growth: 5.5 });
    }
  }

  private spawnBloodEffect(position: THREE.Vector3, direction: THREE.Vector3, damage: number): void {
    const mist = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 1),
      new THREE.MeshBasicMaterial({ color: 0x9f111c, transparent: true, opacity: 0.62, depthWrite: false }),
    );
    mist.position.copy(position).addScaledVector(direction, 0.12);
    this.scene.add(mist);
    this.particles.push({ mesh: mist, velocity: direction.clone().multiplyScalar(1.2), life: 0.2, maxLife: 0.2, gravity: 0.8, drag: 2.8, growth: 3.8 });

    const count = Math.round(clamp(5 + damage * 0.14, 7, 13));
    for (let index = 0; index < count; index += 1) {
      const droplet = new THREE.Mesh(
        new THREE.SphereGeometry(0.025 + this.random() * 0.035, 5, 4),
        new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? 0x4e050a : 0xa70d17, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      droplet.position.copy(position).add(new THREE.Vector3((this.random() - 0.5) * 0.16, (this.random() - 0.5) * 0.2, (this.random() - 0.5) * 0.16));
      this.scene.add(droplet);
      const life = 0.48 + this.random() * 0.42;
      this.particles.push({
        mesh: droplet,
        velocity: direction.clone().multiplyScalar(1.2 + this.random() * 2.7).add(new THREE.Vector3((this.random() - 0.5) * 2.8, 0.8 + this.random() * 2.8, (this.random() - 0.5) * 2.8)),
        life,
        maxLife: life,
        gravity: 7.2,
        drag: 0.35,
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
      material.opacity = (particle.baseOpacity ?? 1) * clamp(particle.life / particle.maxLife, 0, 1);
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
    this.deployAssaultReserves();
    this.audio.explosion();
    this.audio.horn();
    this.cameraShake = 1;
    this.spawnImpact(new THREE.Vector3(0, 3, -25.5), 0xcf8b4c, 38);
    this.events.onFeed('<b>Врата открыты!</b> Легион, на первую лестницу!');
    this.events.onBattleEvent('phase', 2);
  }

  private deployAssaultReserves(): void {
    if (this.reservesDeployed) return;
    this.reservesDeployed = true;
    for (const x of [-2.5, 2.5]) {
      const reserve = this.createActor(
        'soldier',
        'allies',
        116 + this.level.order * 5,
        3.92,
        2.45,
        20 + this.level.order,
      );
      reserve.rig.root.position.set(x, 0, -31.5);
      reserve.rig.setGroundHeight(0);
      reserve.cooldown = 0.25 + this.random() * 0.35;
    }
    this.events.onFeed('<b>Резерв у пролома.</b> Двое гвардейцев продолжают штурм вместе с вами.');
  }

  private summitAssaultState(): { summitAllies: number; livingAllies: number; requiredAllies: number; playerAtSummit: boolean } {
    const summitZ = CASTLE_LIMITS.secondStairEndZ + 0.5;
    const livingAllies = this.actors.filter((actor) => actor.team === 'allies' && !actor.dead).length;
    const summitAllies = this.actors.filter(
      (actor) => actor.team === 'allies' && !actor.dead && actor.rig.root.position.z < summitZ,
    ).length;
    return {
      summitAllies,
      livingAllies,
      requiredAllies: summitAllyRequirement(livingAllies),
      playerAtSummit: !this.player.dead && this.player.rig.root.position.z < summitZ,
    };
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

  private resolveDestructibleCollision(position: THREE.Vector3): void {
    const actorRadius = 0.56;
    const contact = { x: position.x, y: position.y + 0.82, z: position.z };
    for (const prop of this.destructibles) {
      if (prop.destroyed || !pointHitsObstacle(contact, {
        x: prop.root.position.x,
        y: prop.root.position.y + prop.centerOffsetY,
        z: prop.root.position.z,
        radius: prop.radius,
        height: prop.height,
      }, actorRadius)) continue;
      const dx = position.x - prop.root.position.x;
      const dz = position.z - prop.root.position.z;
      const distance = Math.hypot(dx, dz);
      const minimumDistance = prop.radius + actorRadius;
      if (distance >= minimumDistance) continue;
      if (distance < 0.001) {
        position.x = prop.root.position.x + minimumDistance;
      } else {
        position.x = prop.root.position.x + dx / distance * minimumDistance;
        position.z = prop.root.position.z + dz / distance * minimumDistance;
      }
      contact.x = position.x;
      contact.z = position.z;
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
    let objective = `Проведите таран · ${this.level.title}`;
    let progress = clamp((15 - this.ram.position.z) / 36.9 * 100, 0, 100);
    if (this.phase === 1) {
      objective = 'Защитите таран и сокрушите ворота';
      progress = 100 - this.gateHealth;
    } else if (this.phase === 2) {
      const assault = this.summitAssaultState();
      objective = assault.requiredAllies === 1
        ? `Последний рыцарь: доберитесь до верхнего яруса · ${assault.summitAllies}/1`
        : `Прорвитесь на верхний ярус вместе с легионом · ${assault.summitAllies}/${assault.requiredAllies}`;
      progress = clamp((-this.player.rig.root.position.z - 29) / 35 * 100, 0, 100);
    } else if (this.phase === 3) {
      objective = this.boss.dead ? 'Удерживайте E у знамени' : `Сразите: ${this.level.boss.title} ${this.level.boss.name}`;
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
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), new THREE.MeshBasicMaterial({ color: this.level.theme.accent }));
    flame.name = 'torch-flame';
    flame.position.copy(position).add(new THREE.Vector3(0, 1.5, 0));
    flame.scale.y = 1.8;
    this.scene.add(flame);
    const light = new THREE.PointLight(this.level.theme.accent, 2.3, 8, 2);
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
