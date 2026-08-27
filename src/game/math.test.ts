import { describe, expect, it } from 'vitest';
import { angleDelta, clamp, pointInAttackArc, seededRandom, smoothstep } from './math';

describe('game math', () => {
  it('clamps and smooths normalized values', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(smoothstep(0, 10, 0)).toBe(0);
    expect(smoothstep(0, 10, 10)).toBe(1);
  });

  it('wraps angles over the -pi/pi boundary', () => {
    expect(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2)).toBeLessThan(0.0001);
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
});
