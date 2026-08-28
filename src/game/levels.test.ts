import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS, LEVELS, getLevel, getNextLevel } from './levels';

describe('level campaign', () => {
  it('contains five campaign operations and two selectable large-scale modes', () => {
    expect(LEVELS).toHaveLength(7);
    expect(CAMPAIGN_LEVELS).toHaveLength(5);
    expect(LEVELS.map((level) => level.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(LEVELS.map((level) => level.id)).size).toBe(7);
    expect(getLevel('twin-citadels').mode).toBe('citadel-war');
    expect(getLevel('open-front').citadelLayout).toBe('open-front');
  });

  it('gives every operation a unique boss and special ability', () => {
    expect(new Set(CAMPAIGN_LEVELS.map((level) => level.boss.name)).size).toBe(5);
    expect(new Set(CAMPAIGN_LEVELS.map((level) => level.boss.ability)).size).toBe(5);
  });

  it('moves through the campaign and stops after the finale', () => {
    expect(getNextLevel(LEVELS[0])?.id).toBe('frostbound-pass');
    expect(getNextLevel(LEVELS[3])?.id).toBe('eclipse-citadel');
    expect(getNextLevel(LEVELS[4])).toBeUndefined();
    expect(getNextLevel(LEVELS[5])).toBeUndefined();
    expect(getNextLevel(LEVELS[6])).toBeUndefined();
  });

  it('falls back to the first operation for an unknown map id', () => {
    expect(getLevel('missing').id).toBe('ashen-gate');
  });
});
