export type CitadelUnitRole = 'soldier' | 'archer' | 'brute';
export type CitadelTeam = 'allies' | 'enemies';

export interface CitadelPoint {
  x: number;
  z: number;
}

export const CITADEL_LANE_COUNT = 6;
export const CITADEL_MAX_HEALTH = 7000;
export const CITADEL_UNIT_CAP = 150;
export const CITADEL_CASTLE_Z = 76;
export const CITADEL_FRONT_Z = 66;
export const CITADEL_SPAWN_Z = 54;
export const CITADEL_OPEN_FRONT_HALF_WIDTH = 54;

const laneOffsets = [-45, -27, -9, 9, 27, 45] as const;
const laneBends = [-5.5, 4.2, -3.2, 3.2, -4.2, 5.5] as const;
const squadPatterns: readonly (readonly CitadelUnitRole[])[] = [
  ['soldier', 'soldier', 'archer'],
  ['soldier', 'brute', 'soldier'],
  ['archer', 'soldier', 'archer'],
  ['brute', 'soldier', 'archer'],
];

export function citadelLaneX(lane: number, z: number): number {
  const safeLane = Math.max(0, Math.min(CITADEL_LANE_COUNT - 1, Math.floor(lane)));
  const progress = Math.max(0, Math.min(1, (z + CITADEL_FRONT_Z) / (CITADEL_FRONT_Z * 2)));
  return laneOffsets[safeLane] + Math.sin(progress * Math.PI) * laneBends[safeLane];
}

export function citadelLanePoint(lane: number, z: number): CitadelPoint {
  return { x: citadelLaneX(lane, z), z };
}

export function citadelLaneGate(lane: number, target: CitadelTeam): CitadelPoint {
  const z = target === 'enemies' ? -CITADEL_FRONT_Z : CITADEL_FRONT_Z;
  return citadelLanePoint(lane, z);
}

export function citadelLaneAdvance(lane: number, team: CitadelTeam, currentZ: number, step = 10): CitadelPoint {
  const destinationZ = team === 'allies' ? -CITADEL_FRONT_Z + 3 : CITADEL_FRONT_Z - 3;
  const direction = team === 'allies' ? -1 : 1;
  const z = direction < 0
    ? Math.max(destinationZ, currentZ - step)
    : Math.min(destinationZ, currentZ + step);
  return citadelLanePoint(lane, z);
}

export function citadelOpenFrontAdvance(team: CitadelTeam, currentZ: number, anchorX: number, wanderTime: number, step = 10): CitadelPoint {
  const destinationZ = team === 'allies' ? -CITADEL_FRONT_Z + 3 : CITADEL_FRONT_Z - 3;
  const z = team === 'allies'
    ? Math.max(destinationZ, currentZ - step)
    : Math.min(destinationZ, currentZ + step);
  const x = Math.max(
    -CITADEL_OPEN_FRONT_HALF_WIDTH,
    Math.min(CITADEL_OPEN_FRONT_HALF_WIDTH, anchorX + Math.sin(wanderTime) * 4.5),
  );
  return { x, z };
}

export function citadelWaveSquad(wave: number, lane: number): readonly CitadelUnitRole[] {
  const index = Math.abs(Math.floor(wave) + Math.floor(lane)) % squadPatterns.length;
  return squadPatterns[index];
}

export function damageCitadel(health: number, damage: number): number {
  return Math.max(0, Math.min(CITADEL_MAX_HEALTH, health - Math.max(0, damage)));
}

export function citadelBattlePhase(enemyHealth: number): number {
  const ratio = Math.max(0, Math.min(1, enemyHealth / CITADEL_MAX_HEALTH));
  if (ratio > 0.75) return 0;
  if (ratio > 0.5) return 1;
  if (ratio > 0.25) return 2;
  return 3;
}
