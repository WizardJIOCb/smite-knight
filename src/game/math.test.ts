import { describe, expect, it } from 'vitest';
import { angleDelta, clamp, dampAngle, formationFollowVelocity, formationShouldMove, movementDirection, pointInAttackArc, ramEscortGateShift, ramEscortOffset, seededRandom, setRightPerpendicular, smoothstep } from './math';

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

  it('uses the movement input for a jump instead of always following the camera', () => {
    const cameraForward = Math.PI;
    const forward = movementDirection(0, 1, cameraForward);
    const left = movementDirection(-1, 0, cameraForward);
    const backwardRight = movementDirection(1, -1, cameraForward);
    expect(forward).toEqual(expect.objectContaining({ x: expect.closeTo(0, 5), z: expect.closeTo(-1, 5) }));
    expect(left).toEqual(expect.objectContaining({ x: expect.closeTo(-1, 5), z: expect.closeTo(0, 5) }));
    expect(backwardRight).toEqual(expect.objectContaining({ x: expect.closeTo(Math.SQRT1_2, 5), z: expect.closeTo(Math.SQRT1_2, 5) }));
    expect(movementDirection(0, 0, cameraForward)).toBeUndefined();
  });

  it('gives every ram escort a stable non-overlapping place beside the ram', () => {
    const slots = Array.from({ length: 22 }, (_, index) => ramEscortOffset(index));
    expect(new Set(slots.map(({ x, z }) => `${x}:${z}`)).size).toBe(22);
    expect(slots.filter(({ x }) => x < 0)).toHaveLength(11);
    expect(slots.filter(({ x }) => x > 0)).toHaveLength(11);
    expect(slots.every(({ x }) => Math.abs(x) > 2.3)).toBe(true);

    let minimumDistance = Number.POSITIVE_INFINITY;
    for (let first = 0; first < slots.length; first += 1) {
      for (let second = first + 1; second < slots.length; second += 1) {
        minimumDistance = Math.min(minimumDistance, Math.hypot(slots[first].x - slots[second].x, slots[first].z - slots[second].z));
      }
    }
    expect(minimumDistance).toBeGreaterThanOrEqual(1.75);
    expect(ramEscortGateShift(15)).toBe(0);
    expect(ramEscortGateShift(-21.875)).toBeCloseTo(2.375, 5);
  });

  it('keeps an escort running with a moving ram without chattering at the stop threshold', () => {
    expect(formationShouldMove(0.05, false, 1.25)).toBe(true);
    expect(formationShouldMove(0.5, true, 0)).toBe(true);
    expect(formationShouldMove(0.5, false, 0)).toBe(false);
    expect(formationShouldMove(0.2, true, 0)).toBe(false);

    const velocity = formationFollowVelocity(0, -0.04, 2.75, -1.25);
    expect(velocity.x).toBeCloseTo(0, 5);
    expect(velocity.z).toBeLessThanOrEqual(-1.25);
    expect(Math.hypot(velocity.x, velocity.z)).toBeLessThanOrEqual(2.75);
  });
});
