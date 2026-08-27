export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function damp(current: number, target: number, smoothing: number, delta: number): number {
  return lerp(current, target, 1 - Math.exp(-smoothing * delta));
}

export function smoothstep(min: number, max: number, value: number): number {
  const t = clamp((value - min) / (max - min || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

export function distanceXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function pointInAttackArc(
  attacker: { x: number; z: number; rotation: number },
  target: { x: number; z: number },
  range: number,
  halfArc = Math.PI * 0.48,
): boolean {
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  if (dx * dx + dz * dz > range * range) return false;
  const targetAngle = Math.atan2(dx, dz);
  return Math.abs(angleDelta(attacker.rotation, targetAngle)) <= halfArc;
}
