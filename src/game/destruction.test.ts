import { describe, expect, it } from 'vitest';
import { applyDestructibleDamage, pointHitsObstacle, radialDestructibleDamage, segmentHitsObstacle } from './destruction';

describe('destructible battlefield props', () => {
  it('accumulates damage until the obstacle is destroyed', () => {
    const damaged = applyDestructibleDamage({ health: 80, destroyed: false }, 35);
    expect(damaged).toEqual({ health: 45, destroyed: false });
    expect(applyDestructibleDamage(damaged, 60)).toEqual({ health: 0, destroyed: true });
  });

  it('does not damage an already destroyed obstacle', () => {
    const destroyed = { health: 0, destroyed: true };
    expect(applyDestructibleDamage(destroyed, 100)).toBe(destroyed);
  });

  it('scales explosion damage down toward the blast edge', () => {
    expect(radialDestructibleDamage(0, 5, 100)).toBe(100);
    expect(radialDestructibleDamage(2.5, 5, 100)).toBe(50);
    expect(radialDestructibleDamage(5, 5, 100)).toBe(0);
  });

  it('detects a fast jump or projectile inside a padded obstacle volume', () => {
    const bounds = { x: 2, y: 1, z: -3, radius: 0.55, height: 2 };
    expect(pointHitsObstacle({ x: 2.9, y: 1.7, z: -3 }, bounds, 0.4)).toBe(true);
    expect(pointHitsObstacle({ x: 3.2, y: 1, z: -3 }, bounds, 0.4)).toBe(false);
    expect(pointHitsObstacle({ x: 2, y: 2.6, z: -3 }, bounds, 0.4)).toBe(false);
    expect(segmentHitsObstacle(
      { x: 2, y: 1, z: -1.8 },
      { x: 2, y: 1, z: -4.2 },
      { x: 2, y: 1, z: -3, radius: 0.2, height: 1 },
      0.08,
    )).toBe(true);
  });
});
