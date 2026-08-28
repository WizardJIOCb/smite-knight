import { describe, expect, it } from 'vitest';
import {
  battlefieldSurfaceAt,
  CASTLE_LIMITS,
  castleGroundHeight,
  summitAllyRequirement,
  summitAssaultReady,
} from './world';

describe('multi-tier castle terrain', () => {
  it('raises actors smoothly across both staircases', () => {
    expect(castleGroundHeight(0, CASTLE_LIMITS.firstStairStartZ)).toBe(0);
    expect(castleGroundHeight(0, -43)).toBeCloseTo(1.5);
    expect(castleGroundHeight(0, CASTLE_LIMITS.firstStairEndZ)).toBe(3);
    expect(castleGroundHeight(0, -61)).toBeCloseTo(4.5);
    expect(castleGroundHeight(0, CASTLE_LIMITS.secondStairEndZ)).toBe(6);
    expect(castleGroundHeight(0, CASTLE_LIMITS.summitZ)).toBe(6);
  });

  it('keeps the ground outside the castle terraces at battlefield height', () => {
    expect(castleGroundHeight(20, -50)).toBe(0);
    expect(castleGroundHeight(0, -90)).toBe(0);
  });

  it('distinguishes stone courtyards from the earthen battlefield', () => {
    expect(battlefieldSurfaceAt(0, -52)).toBe('stone');
    expect(battlefieldSurfaceAt(0, -12)).toBe('earth');
    expect(battlefieldSurfaceAt(30, -52)).toBe('earth');
  });
});

describe('summit assault objective', () => {
  it('normally asks for three living allies at the summit', () => {
    expect(summitAllyRequirement(24)).toBe(3);
    expect(summitAssaultReady(true, 2, 24)).toBe(false);
    expect(summitAssaultReady(true, 3, 24)).toBe(true);
  });

  it('adapts to two survivors', () => {
    expect(summitAllyRequirement(2)).toBe(2);
    expect(summitAssaultReady(true, 2, 2)).toBe(true);
  });

  it('lets the last surviving player continue alone', () => {
    expect(summitAllyRequirement(1)).toBe(1);
    expect(summitAssaultReady(true, 1, 1)).toBe(true);
  });

  it('still requires the player to reach the summit', () => {
    expect(summitAssaultReady(false, 3, 3)).toBe(false);
  });
});
