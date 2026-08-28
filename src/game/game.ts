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
  distanceXZ,
  pointInAttackArc,
  seededRandom,
  setRightPerpendicular,
  smoothstep,
} from './math';

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
type Role = 'soldier' | 'archer' | 'boss' | 'player';

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
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface RemoteRig {
  rig: KnightRig;
  targetPosition: THREE.Vector3;
  targetRotation: number;
  action: RigAction;
}

const UP = new THREE.Vector3(0, 1, 0);
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
  private readonly remotes = new Map<string, RemoteRig>();
  private readonly temp = new THREE.Vector3();
  private readonly temp2 = new THREE.Vector3();
  private player!: Actor;
  private boss!: Actor;
  private gateLeft!: THREE.Mesh;
  private gateRight!: THREE.Mesh;
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
    this.phase = 0;
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
    this.ram.position.set(0, 0, 15);
    this.gateLeft.rotation.y = 0;
    this.gateRight.rotation.y = 0;
    this.gateLeft.visible = true;
    this.gateRight.visible = true;
    this.banner.rotation.z = 0;
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
  setBlock(blocking: boolean): void { if (!this.player.dead) this.player.action = blocking ? 'block' : 'idle'; }
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
    else this.phase = Math.max(this.phase, Math.floor(value));
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
    groundTexture.repeat.set(18, 18);
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120, 48, 48),
      new THREE.MeshStandardMaterial({ map: groundTexture, color: 0x655e4b, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
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
    stoneTexture.repeat.set(3, 2);
    stoneTexture.colorSpace = THREE.SRGBColorSpace;
    const stone = new THREE.MeshStandardMaterial({ map: stoneTexture, color: 0x77746e, roughness: 0.93, metalness: 0.03 });
    const darkStone = new THREE.MeshStandardMaterial({ map: stoneTexture, color: 0x4b4c4c, roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3d2415, roughness: 0.9, metalness: 0.04 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x242629, metalness: 0.82, roughness: 0.3 });

    const makeBox = (size: THREE.Vector3, position: THREE.Vector3, material: THREE.Material, cast = true): THREE.Mesh => {
      const item = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
      item.position.copy(position);
      item.castShadow = cast;
      item.receiveShadow = true;
      this.scene.add(item);
      return item;
    };

    makeBox(new THREE.Vector3(21, 8, 3.2), new THREE.Vector3(-15.5, 4, -27), stone);
    makeBox(new THREE.Vector3(21, 8, 3.2), new THREE.Vector3(15.5, 4, -27), stone);
    makeBox(new THREE.Vector3(3.2, 8, 24), new THREE.Vector3(-27, 4, -37), stone);
    makeBox(new THREE.Vector3(3.2, 8, 24), new THREE.Vector3(27, 4, -37), stone);
    makeBox(new THREE.Vector3(54, 8, 3.2), new THREE.Vector3(0, 4, -49), darkStone);

    for (const x of [-24, -21, -18, -15, -12, -9, 9, 12, 15, 18, 21, 24]) {
      makeBox(new THREE.Vector3(1.7, 1.4, 2.3), new THREE.Vector3(x, 8.7, -27), stone);
    }
    for (const z of [-31, -35, -39, -43, -47]) {
      makeBox(new THREE.Vector3(2.3, 1.4, 1.7), new THREE.Vector3(-27, 8.7, z), stone);
      makeBox(new THREE.Vector3(2.3, 1.4, 1.7), new THREE.Vector3(27, 8.7, z), stone);
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

    const gateArch = new THREE.Mesh(new THREE.TorusGeometry(5.1, 1.7, 6, 16, Math.PI), stone);
    gateArch.position.set(0, 6.1, -25.7);
    gateArch.rotation.z = Math.PI;
    gateArch.castShadow = true;
    this.scene.add(gateArch);
    this.gateGroup = new THREE.Group();
    this.gateGroup.position.set(0, 0, -25.5);
    this.scene.add(this.gateGroup);
    this.gateLeft = new THREE.Mesh(new THREE.BoxGeometry(3.9, 7, 0.45), wood);
    this.gateRight = this.gateLeft.clone();
    this.gateLeft.geometry = this.gateLeft.geometry.clone();
    this.gateLeft.position.set(-2, 3.5, 0);
    this.gateRight.position.set(2, 3.5, 0);
    this.gateLeft.castShadow = this.gateRight.castShadow = true;
    this.gateGroup.add(this.gateLeft, this.gateRight);
    for (const door of [this.gateLeft, this.gateRight]) {
      for (const y of [-2.5, -0.8, 0.9, 2.6]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(4.05, 0.16, 0.56), iron);
        brace.position.y = y;
        door.add(brace);
      }
    }

    const keep = makeBox(new THREE.Vector3(19, 15, 7), new THREE.Vector3(0, 7.5, -44), darkStone);
    for (const x of [-8, -4, 0, 4, 8]) {
      const merlon = makeBox(new THREE.Vector3(2, 1.7, 1.6), new THREE.Vector3(x, 15.8, -42), darkStone);
      merlon.castShadow = true;
    }
    const keepDoor = makeBox(new THREE.Vector3(4, 5.8, 0.35), new THREE.Vector3(0, 2.9, -40.35), wood);
    keepDoor.castShadow = true;

    this.banner = this.createBanner(0xa52922, 0xd6ae60, true);
    this.banner.position.set(0, 0, -38.3);
    this.banner.rotation.z = Math.PI / 2;
    this.scene.add(this.banner);

    for (const position of [new THREE.Vector3(-5.2, 1.5, -25), new THREE.Vector3(5.2, 1.5, -25), new THREE.Vector3(-8, 2, -40), new THREE.Vector3(8, 2, -40)]) {
      this.createTorch(position);
    }
    void keep;
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
  }

  private buildSkyline(): void {
    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x20272b, roughness: 1, flatShading: true });
    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2;
      const radius = 70 + this.random() * 18;
      const height = 14 + this.random() * 27;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(10 + this.random() * 12, height, 5), mountainMaterial);
      mountain.position.set(Math.sin(angle) * radius, height * 0.5 - 1, Math.cos(angle) * radius);
      mountain.rotation.y = this.random() * Math.PI;
      this.scene.add(mountain);
    }
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 12), new THREE.MeshBasicMaterial({ color: 0xf5c990 }));
    moon.position.set(42, 34, -72);
    this.scene.add(moon);
  }

  private spawnBattle(): void {
    this.player = this.createActor('player', 'allies', 180, 4.9, 3.1, 36);
    this.player.rig.root.position.copy(PLAYER_START);

    for (let index = 0; index < 18; index += 1) {
      const role: Role = index % 7 === 0 ? 'archer' : 'soldier';
      const actor = this.createActor(role, 'allies', role === 'archer' ? 72 : 105, role === 'archer' ? 3.2 : 3.8, role === 'archer' ? 15 : 2.4, role === 'archer' ? 13 : 18);
      actor.rig.root.position.set((index % 6 - 2.5) * 2.4 + (this.random() - 0.5), 0, 11 + Math.floor(index / 6) * 3.1);
    }

    for (let index = 0; index < 28; index += 1) {
      const role: Role = index % 8 === 0 ? 'archer' : 'soldier';
      const actor = this.createActor(role, 'enemies', role === 'archer' ? 66 : 92, role === 'archer' ? 3.1 : 3.65, role === 'archer' ? 16 : 2.3, role === 'archer' ? 11 : 16);
      const inside = index >= 17;
      actor.rig.root.position.set((index % 7 - 3) * 3.1 + (this.random() - 0.5) * 1.6, 0, inside ? -33 - Math.floor((index - 17) / 7) * 3.2 : -5 - Math.floor(index / 7) * 3.2);
    }

    this.boss = this.createActor('boss', 'enemies', 540, 3.45, 3.25, 34);
    this.boss.rig.root.position.set(0, 0, -38);
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
    const input = new THREE.Vector2(inputX, inputZ);
    if (input.lengthSq() > 1) input.normalize();
    const sprint = this.keys.has('ShiftLeft') && this.player.stamina > 8 ? 1.38 : 1;
    if (sprint > 1 && input.lengthSq() > 0.01) this.player.stamina = Math.max(0, this.player.stamina - delta * 12);
    const moveSpeed = this.player.speed * sprint * (this.player.action === 'block' ? 0.38 : 1);
    const forward = this.temp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = setRightPerpendicular(this.temp2, forward);
    const move = new THREE.Vector3().addScaledVector(forward, input.y).addScaledVector(right, input.x);
    if (move.lengthSq() > 0.01) {
      move.normalize();
      this.player.rig.root.position.addScaledVector(move, moveSpeed * delta);
      if (this.player.action !== 'attack' && this.player.action !== 'block') this.player.action = 'run';
      this.player.rig.root.rotation.y = damp(this.player.rig.root.rotation.y, Math.atan2(move.x, move.z), 12, delta);
    } else if (this.player.action === 'run') this.player.action = 'idle';
    this.resolveWorldCollision(this.player.rig.root.position);
    this.resolveRamCollision(this.player.rig.root.position);
    this.player.rig.setState(this.player.action, input.length(), delta);
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
      if (this.boss.dead) {
        const near = distanceXZ(this.player.rig.root.position, this.banner.position) < 4.2;
        if (near && this.keys.has('KeyE')) this.captureProgress = Math.min(100, this.captureProgress + delta * 34);
        else this.captureProgress = Math.max(0, this.captureProgress - delta * 5);
        if (this.captureProgress >= 100) this.victory();
      }
    }
    this.fireballTimer -= delta;
    if (this.fireballTimer <= 0 && this.phase < 2) {
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
      if (actor === this.boss && this.phase < 2) continue;
      actor.decisionTimer -= delta;
      if (actor.decisionTimer <= 0) {
        actor.decisionTimer = 0.22 + this.random() * 0.26;
        actor.target = this.findTarget(actor);
      }
      const target = actor.target;
      let moving = false;
      if (target && !target.dead) {
        const distance = distanceXZ(actor.rig.root.position, target.rig.root.position);
        const desiredRange = actor.role === 'archer' ? 11.5 : actor.attackRange * 0.78;
        const direction = this.temp.subVectors(target.rig.root.position, actor.rig.root.position);
        direction.y = 0;
        if (direction.lengthSq() > 0.01) direction.normalize();
        actor.rig.root.rotation.y = damp(actor.rig.root.rotation.y, Math.atan2(direction.x, direction.z), 9, delta);
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
          actor.cooldown = actor.role === 'boss' ? 0.86 : actor.role === 'archer' ? 1.9 + this.random() : 1.1 + this.random() * 0.45;
          if (actor.role === 'archer') this.audio.bow();
        }
      } else {
        const destination = this.getActorDestination(actor);
        const direction = this.temp.subVectors(destination, actor.rig.root.position);
        direction.y = 0;
        if (direction.lengthSq() > 1) {
          direction.normalize();
          actor.rig.root.position.addScaledVector(direction, actor.speed * delta * 0.72);
          actor.rig.root.rotation.y = damp(actor.rig.root.rotation.y, Math.atan2(direction.x, direction.z), 6, delta);
          actor.action = 'run';
          moving = true;
        } else actor.action = 'idle';
      }

      if (actor.action === 'attack') {
        const impactMoment = actor.role === 'archer' ? 0.52 : 0.31;
        if (!actor.hitDone && actor.actionTime >= impactMoment) {
          actor.hitDone = true;
          if (actor.role === 'archer') this.fireArrow(actor);
          else this.actorMeleeHit(actor);
        }
        const duration = actor.role === 'archer' ? 0.78 : 0.62;
        if (actor.actionTime >= duration) actor.action = 'idle';
      } else if (!moving && this.random() < delta * 0.08 && actor.role !== 'boss') {
        actor.action = 'block';
      } else if (actor.action === 'block' && actor.actionTime > 0.7) actor.action = 'idle';

      this.resolveWorldCollision(actor.rig.root.position);
      actor.rig.setState(actor.action, moving ? 1 : 0, delta);
      actor.rig.update(time, delta);
    }
    this.player.rig.update(time, delta);
  }

  private findTarget(actor: Actor): Actor | undefined {
    let best: Actor | undefined;
    let bestDistance = actor.role === 'archer' ? 22 : 11;
    for (const candidate of this.actors) {
      if (candidate.dead || candidate.team === actor.team || candidate === this.boss && this.phase < 2) continue;
      const distance = distanceXZ(actor.rig.root.position, candidate.rig.root.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  private getActorDestination(actor: Actor): THREE.Vector3 {
    if (actor.team === 'allies') {
      if (this.phase < 2) return new THREE.Vector3((Number(actor.id.split('-').at(-1)) % 5 - 2) * 1.5, 0, this.ram.position.z + 4);
      return new THREE.Vector3((Number(actor.id.split('-').at(-1)) % 7 - 3) * 2.2, 0, -37);
    }
    if (this.phase < 2 && actor.rig.root.position.z < -28) return actor.rig.root.position.clone();
    return new THREE.Vector3((Number(actor.id.split('-').at(-1)) % 7 - 3) * 2.1, 0, this.phase < 2 ? -8 : -32);
  }

  private computeSeparation(actor: Actor): THREE.Vector3 {
    const force = new THREE.Vector3();
    for (const other of this.actors) {
      if (other === actor || other.dead) continue;
      const distance = distanceXZ(actor.rig.root.position, other.rig.root.position);
      if (distance > 0 && distance < 0.95) {
        force.add(this.temp2.subVectors(actor.rig.root.position, other.rig.root.position).setY(0).normalize().multiplyScalar((0.95 - distance) * 0.8));
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
    if (this.mode !== 'running' || this.player.dead || this.player.cooldown > 0 || this.player.stamina < 12) return;
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
        if (actor.team !== 'enemies' || actor.dead || actor === this.boss && this.phase < 2) continue;
        if (pointInAttackArc(attacker, actor.rig.root.position, 3.25, Math.PI * 0.46)) {
          this.damageActor(actor, this.player.damage * (0.88 + this.random() * 0.32), this.player);
          hit = true;
        }
      }
      if (this.phase === 1 && distanceXZ(this.player.rig.root.position, this.gateGroup.position) < 5.2) {
        this.damageGate(3.5);
        hit = true;
      }
      if (hit) this.audio.hit(false);
    }, 180);
  }

  private playerDodge(): void {
    if (this.mode !== 'running' || this.player.dead || this.player.stamina < 26 || this.player.action === 'attack') return;
    this.player.stamina -= 26;
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.player.rig.root.position.addScaledVector(forward, 3.3);
    this.resolveWorldCollision(this.player.rig.root.position);
    this.spawnImpact(this.player.rig.root.position.clone().add(new THREE.Vector3(0, 0.15, 0)), 0x8b7656, 7);
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
    this.player.rig.root.position.copy(this.phase < 2 ? PLAYER_START : new THREE.Vector3(0, 0, -30));
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
    const origin = new THREE.Vector3((this.random() > 0.5 ? 1 : -1) * 23, 10.8, -26);
    const velocity = target.sub(origin).multiplyScalar(0.33);
    velocity.y += 5.5;
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff8a28, emissive: 0xff3300, emissiveIntensity: 5, roughness: 0.4 }),
    );
    fire.position.copy(origin);
    this.scene.add(fire);
    this.projectiles.push({ mesh: fire, velocity, team: 'enemies', damage: 42, life: 4, fire: true });
  }

  private updateProjectiles(delta: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= delta;
      if (projectile.fire) projectile.velocity.y -= 9.8 * delta;
      projectile.mesh.position.addScaledVector(projectile.velocity, delta);
      if (!projectile.fire) projectile.mesh.quaternion.setFromUnitVectors(UP, projectile.velocity.clone().normalize());
      let remove = projectile.life <= 0;
      for (const actor of this.actors) {
        if (remove || actor.dead || actor.team === projectile.team) continue;
        if (projectile.mesh.position.distanceTo(actor.rig.root.position.clone().add(new THREE.Vector3(0, 1, 0))) < (projectile.fire ? 1.25 : 0.65)) {
          this.damageActor(actor, projectile.damage, this.findProjectileOwner(projectile.team));
          remove = true;
        }
      }
      if (projectile.fire && projectile.mesh.position.y <= 0.35) {
        this.explode(projectile.mesh.position);
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

  private explode(position: THREE.Vector3): void {
    this.audio.explosion();
    this.cameraShake = Math.max(this.cameraShake, clamp(1 - position.distanceTo(this.player.rig.root.position) / 24, 0, 0.9));
    this.spawnImpact(position, 0xff6a19, 25);
    for (const actor of this.actors) {
      if (actor.dead || actor.team === 'enemies') continue;
      const distance = actor.rig.root.position.distanceTo(position);
      if (distance < 5) this.damageActor(actor, (1 - distance / 5) * 46, this.findProjectileOwner('enemies'));
    }
  }

  private spawnImpact(position: THREE.Vector3, color: number, count: number): void {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let index = 0; index < count; index += 1) {
      const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035 + this.random() * 0.06, 0), material.clone());
      spark.position.copy(position);
      const velocity = new THREE.Vector3((this.random() - 0.5) * 4, this.random() * 4.5, (this.random() - 0.5) * 4);
      this.scene.add(spark);
      this.particles.push({ mesh: spark, velocity, life: 0.45 + this.random() * 0.55, maxLife: 1 });
    }
  }

  private updateParticles(delta: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= delta;
      particle.velocity.y -= 5.5 * delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
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
    this.boss.rig.root.visible = true;
    this.audio.explosion();
    this.audio.horn();
    this.cameraShake = 1;
    this.spawnImpact(new THREE.Vector3(0, 3, -25.5), 0xcf8b4c, 38);
    this.events.onFeed('<b>Врата разрушены!</b> Вперёд, во внутренний двор!');
    this.events.onBattleEvent('phase', 2);
  }

  private updateGateVisual(delta: number): void {
    const opened = smoothstep(25, 0, this.gateHealth);
    this.gateLeft.rotation.y = damp(this.gateLeft.rotation.y, -opened * 1.35, 2.5, delta);
    this.gateRight.rotation.y = damp(this.gateRight.rotation.y, opened * 1.35, 2.5, delta);
    this.gateLeft.position.x = -2 - opened * 1.2;
    this.gateRight.position.x = 2 + opened * 1.2;
    if (this.phase >= 2) {
      this.gateLeft.rotation.z = damp(this.gateLeft.rotation.z, -0.25, 1.3, delta);
      this.gateRight.rotation.z = damp(this.gateRight.rotation.z, 0.25, 1.3, delta);
    }
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
      remote.rig.root.rotation.y = damp(remote.rig.root.rotation.y, remote.targetRotation, 12, delta);
      remote.rig.setState(remote.action, remote.action === 'run' ? 1 : 0, delta);
      remote.rig.update(time, delta);
    }
  }

  private resolveWorldCollision(position: THREE.Vector3): void {
    position.x = clamp(position.x, -41.5, 41.5);
    position.z = clamp(position.z, -46, 43);
    const atWall = position.z < -24.3 && position.z > -29.8;
    const gatePassable = this.phase >= 2 && Math.abs(position.x) < 4.3;
    if (atWall && !gatePassable) {
      if (position.z > -27) position.z = -24.25;
      else position.z = -29.85;
    }
    if (position.z < -29 && Math.abs(position.x) > 25.2) position.x = Math.sign(position.x) * 25.2;
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
      enemies: this.actors.filter((actor) => actor.team === 'enemies' && !actor.dead && (actor !== this.boss || this.phase >= 2)).length,
      interaction: this.phase === 2 && this.boss.dead && distanceXZ(this.player.rig.root.position, this.banner.position) < 4.2,
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
    context.fillStyle = '#77746c';
    context.fillRect(0, 0, 512, 256);
    const rowHeight = 32;
    for (let row = 0; row < 8; row += 1) {
      const offset = row % 2 ? -32 : 0;
      for (let column = offset; column < 512; column += 64) {
        const shade = 87 + Math.floor(this.random() * 32);
        context.fillStyle = `rgb(${shade},${shade - 2},${shade - 7})`;
        context.fillRect(column + 2, row * rowHeight + 2, 60, rowHeight - 4);
        context.strokeStyle = 'rgba(28,28,27,.55)';
        context.strokeRect(column + 1, row * rowHeight + 1, 62, rowHeight - 2);
      }
    }
    for (let index = 0; index < 900; index += 1) {
      context.fillStyle = `rgba(255,255,255,${this.random() * 0.08})`;
      context.fillRect(this.random() * 512, this.random() * 256, 1, 1);
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
