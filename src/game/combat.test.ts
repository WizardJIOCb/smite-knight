import { describe, expect, it } from 'vitest';
import { attackPhaseAt, bladeSweepAngle, meleeAttackProfile, sweptBladeContact } from './combat';

describe('melee attack contact window', () => {
  const profile = meleeAttackProfile('soldier');
  const attacker = { x: 0, z: 0, rotation: 0 };

  it('separates windup, active blade and recovery phases', () => {
    expect(attackPhaseAt(0.12, profile)).toBe('windup');
    expect(attackPhaseAt(0.34, profile)).toBe('active');
    expect(attackPhaseAt(0.55, profile)).toBe('recovery');
    expect(attackPhaseAt(0.71, profile)).toBe('finished');
  });

  it('does not apply damage during the windup', () => {
    expect(sweptBladeContact(attacker, { x: 0, z: 2 }, 0.18, profile, 3)).toBe(false);
  });

  it('contacts a target only when the blade sweeps across its angle', () => {
    const middle = (profile.activeStart + profile.activeEnd) * 0.5;
    expect(bladeSweepAngle(middle, profile)).toBeCloseTo(0, 5);
    expect(sweptBladeContact(attacker, { x: 0, z: 2 }, middle, profile, 3)).toBe(true);
    expect(sweptBladeContact(attacker, { x: 2, z: 0 }, middle, profile, 3, 0.2)).toBe(false);
  });

  it('cannot skip a contact when a slow frame crosses the target angle', () => {
    expect(sweptBladeContact(attacker, { x: 0, z: 2 }, 0.38, profile, 3, 0.2, 0.32)).toBe(true);
  });

  it('misses targets outside the blade reach or behind the attacker', () => {
    const middle = (profile.activeStart + profile.activeEnd) * 0.5;
    expect(sweptBladeContact(attacker, { x: 0, z: 4.2 }, middle, profile, 3)).toBe(false);
    expect(sweptBladeContact(attacker, { x: 0, z: -2 }, middle, profile, 3)).toBe(false);
  });
});
