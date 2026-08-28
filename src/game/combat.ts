import { angleDelta, clamp, smoothstep } from './math';

export type MeleeRole = 'soldier' | 'brute' | 'boss';
export type AttackPhase = 'windup' | 'active' | 'recovery' | 'finished';

export interface MeleeAttackProfile {
  windupEnd: number;
  activeStart: number;
  activeEnd: number;
  duration: number;
  sweepStart: number;
  sweepEnd: number;
  contactWidth: number;
}

const attackProfiles: Record<MeleeRole, MeleeAttackProfile> = {
  soldier: { windupEnd: 0.26, activeStart: 0.26, activeEnd: 0.44, duration: 0.7, sweepStart: -1.02, sweepEnd: 1.02, contactWidth: 0.16 },
  brute: { windupEnd: 0.38, activeStart: 0.38, activeEnd: 0.7, duration: 1.02, sweepStart: -1.22, sweepEnd: 1.22, contactWidth: 0.2 },
  boss: { windupEnd: 0.34, activeStart: 0.34, activeEnd: 0.72, duration: 1.06, sweepStart: -1.34, sweepEnd: 1.34, contactWidth: 0.24 },
};

export function meleeAttackProfile(role: MeleeRole): MeleeAttackProfile {
  return attackProfiles[role];
}

export function attackPhaseAt(time: number, profile: MeleeAttackProfile): AttackPhase {
  if (time < profile.activeStart) return 'windup';
  if (time <= profile.activeEnd) return 'active';
  if (time < profile.duration) return 'recovery';
  return 'finished';
}

export function bladeSweepAngle(time: number, profile: MeleeAttackProfile): number | undefined {
  if (attackPhaseAt(time, profile) !== 'active') return undefined;
  const progress = smoothstep(profile.activeStart, profile.activeEnd, time);
  return profile.sweepStart + (profile.sweepEnd - profile.sweepStart) * progress;
}

export function sweptBladeContact(
  attacker: { x: number; z: number; rotation: number },
  target: { x: number; z: number },
  time: number,
  profile: MeleeAttackProfile,
  range: number,
  targetRadius = 0.55,
  previousTime = time,
): boolean {
  const sweepAngle = bladeSweepAngle(time, profile);
  if (sweepAngle === undefined) return false;
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  const distance = Math.hypot(dx, dz);
  if (distance > range + targetRadius || distance < 0.05) return false;
  const targetAngle = angleDelta(attacker.rotation, Math.atan2(dx, dz));
  const angularRadius = Math.asin(clamp(targetRadius / distance, 0, 1));
  const previousSweep = bladeSweepAngle(Math.max(previousTime, profile.activeStart), profile) ?? sweepAngle;
  const contactRadius = profile.contactWidth + angularRadius;
  const sweepMin = Math.min(previousSweep, sweepAngle) - contactRadius;
  const sweepMax = Math.max(previousSweep, sweepAngle) + contactRadius;
  return targetAngle >= sweepMin && targetAngle <= sweepMax;
}
