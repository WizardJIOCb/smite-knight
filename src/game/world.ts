import { clamp } from './math';

export const CASTLE_LIMITS = {
  outerGateZ: -25.5,
  firstStairStartZ: -40,
  firstStairEndZ: -46,
  firstTerraceHeight: 3,
  secondStairStartZ: -58,
  secondStairEndZ: -64,
  summitHeight: 6,
  summitZ: -70,
  backWallZ: -82,
} as const;

export function castleGroundHeight(x: number, z: number): number {
  if (Math.abs(x) > 17 || z > CASTLE_LIMITS.firstStairStartZ || z < CASTLE_LIMITS.backWallZ) return 0;
  if (z >= CASTLE_LIMITS.firstStairEndZ) {
    if (Math.abs(x) > 7.2) return 0;
    const progress = clamp(
      (CASTLE_LIMITS.firstStairStartZ - z) / (CASTLE_LIMITS.firstStairStartZ - CASTLE_LIMITS.firstStairEndZ),
      0,
      1,
    );
    return progress * CASTLE_LIMITS.firstTerraceHeight;
  }
  if (z > CASTLE_LIMITS.secondStairStartZ) return CASTLE_LIMITS.firstTerraceHeight;
  if (z >= CASTLE_LIMITS.secondStairEndZ) {
    if (Math.abs(x) > 5.8) return CASTLE_LIMITS.firstTerraceHeight;
    const progress = clamp(
      (CASTLE_LIMITS.secondStairStartZ - z) / (CASTLE_LIMITS.secondStairStartZ - CASTLE_LIMITS.secondStairEndZ),
      0,
      1,
    );
    return CASTLE_LIMITS.firstTerraceHeight + progress * (CASTLE_LIMITS.summitHeight - CASTLE_LIMITS.firstTerraceHeight);
  }
  return CASTLE_LIMITS.summitHeight;
}
