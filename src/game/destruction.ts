import { clamp } from './math';

export interface DestructibleState {
  health: number;
  destroyed: boolean;
}

export interface ObstacleBounds {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export function applyDestructibleDamage(state: DestructibleState, damage: number): DestructibleState {
  if (state.destroyed || damage <= 0 || !Number.isFinite(damage)) return state;
  const health = Math.max(0, state.health - damage);
  return { health, destroyed: health <= 0 };
}

export function radialDestructibleDamage(distance: number, radius: number, damage: number): number {
  if (radius <= 0 || distance >= radius || damage <= 0) return 0;
  return damage * (1 - clamp(distance / radius, 0, 1));
}

export function pointHitsObstacle(point: Point3, bounds: ObstacleBounds, padding = 0): boolean {
  const horizontalDistance = Math.hypot(point.x - bounds.x, point.z - bounds.z);
  const halfHeight = bounds.height * 0.5 + padding;
  return horizontalDistance <= bounds.radius + padding && Math.abs(point.y - bounds.y) <= halfHeight;
}

export function segmentHitsObstacle(start: Point3, end: Point3, bounds: ObstacleBounds, padding = 0): boolean {
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const samples = Math.max(1, Math.ceil(length / Math.max(0.18, bounds.radius + padding)));
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples;
    if (pointHitsObstacle({
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
      z: start.z + (end.z - start.z) * progress,
    }, bounds, padding)) return true;
  }
  return false;
}
