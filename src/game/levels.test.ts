import { describe, expect, it } from 'vitest';
import { LEVELS, getLevel, getNextLevel } from './levels';

describe('level campaign', () => {
  it('contains five ordered, selectable operations', () => {
    expect(LEVELS).toHaveLength(5);
    expect(LEVELS.map((level) => level.order)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(LEVELS.map((level) => level.id)).size).toBe(5);
  });

  it('gives every operation a unique boss and special ability', () => {
    expect(new Set(LEVELS.map((level) => level.boss.name)).size).toBe(5);
    expect(new Set(LEVELS.map((level) => level.boss.ability)).size).toBe(5);
  });

  it('moves through the campaign and stops after the finale', () => {
    expect(getNextLevel(LEVELS[0])?.id).toBe('frostbound-pass');
    expect(getNextLevel(LEVELS[3])?.id).toBe('eclipse-citadel');
    expect(getNextLevel(LEVELS[4])).toBeUndefined();
  });

  it('falls back to the first operation for an unknown map id', () => {
    expect(getLevel('missing').id).toBe('ashen-gate');
  });
});
