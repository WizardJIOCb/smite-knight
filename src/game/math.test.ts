import { describe, expect, it } from 'vitest';
import { angleDelta, clamp, dampAngle, pointInAttackArc, seededRandom, setRightPerpendicular, smoothstep } from './math';

describe('game math', () => {
  it('clamps and smooths normalized values', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(smoothstep(0, 10, 0)).toBe(0);
    expect(smoothstep(0, 10, 10)).toBe(1);
  });

  it('wraps angles over the -pi/pi boundary', () => {
    expect(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2)).toBeLessThan(0.0001);
  });

  it('smooths rotations through the shortest arc without snapping', () => {
    const start = Math.PI - 0.08;
    const target = -Math.PI + 0.08;
    const next = dampAngle(start, target, 9, 1 / 60);
    expect(angleDelta(start, next)).toBeGreaterThan(0);
    expect(Math.abs(angleDelta(next, target))).toBeLessThan(Math.abs(angleDelta(start, target)));
    expect(Math.abs(angleDelta(start, next))).toBeLessThan(0.05);
  });

  it('detects targets inside an attack arc', () => {
    expect(pointInAttackArc({ x: 0, z: 0, rotation: 0 }, { x: 0, z: 2 }, 3)).toBe(true);
    expect(pointInAttackArc({ x: 0, z: 0, rotation: 0 }, { x: 0, z: -2 }, 3)).toBe(false);
  });

  it('returns reproducible random sequences', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('maps D to the player right and A to the player left', () => {
    const target = {
      x: 0,
      y: 0,
      z: 0,
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
      },
    };

    const right = setRightPerpendicular(target, { x: 0, z: -1 });
    expect({ x: right.x, z: right.z }).toEqual({ x: 1, z: 0 });
    expect({ x: -right.x, z: -right.z }).toEqual({ x: -1, z: -0 });
  });
});
