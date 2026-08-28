import { describe, expect, it } from 'vitest';
import {
  HEROES,
  STARTING_CROWNS,
  calculateHeroReward,
  createHeroProgress,
  grantHeroReward,
  killExperience,
  masteryLevel,
  matchXpThreshold,
  sanitizeHeroProgress,
  selectHero,
  unlockHero,
} from './heroes';

describe('hero roster and progression', () => {
  it('ships ten distinct heroes and four starters', () => {
    expect(HEROES).toHaveLength(10);
    expect(new Set(HEROES.map((hero) => hero.id)).size).toBe(10);
    expect(HEROES.filter((hero) => hero.starter)).toHaveLength(4);
    for (const hero of HEROES) {
      expect(hero.ability.name).toBeTruthy();
      expect(hero.ultimate.name).toBeTruthy();
      expect(hero.ability.cooldown).toBeGreaterThan(0);
      expect(hero.ultimate.cooldown).toBeGreaterThan(hero.ability.cooldown);
    }
  });

  it('starts with four heroes and a separate crown wallet', () => {
    const progress = createHeroProgress();
    expect(progress.unlockedHeroIds).toHaveLength(4);
    expect(progress.crowns).toBe(STARTING_CROWNS);
    expect(progress.unlockedHeroIds).toContain(progress.selectedHeroId);
  });

  it('unlocks affordable heroes and never selects locked ones', () => {
    const progress = createHeroProgress();
    const locked = HEROES.find((hero) => !hero.starter)!;
    expect(selectHero(progress, locked.id).selectedHeroId).not.toBe(locked.id);
    const unlocked = unlockHero(progress, locked.id);
    expect(unlocked.ok).toBe(true);
    expect(unlocked.progress.selectedHeroId).toBe(locked.id);
    expect(unlocked.progress.crowns).toBe(STARTING_CROWNS - locked.unlockCost);
  });

  it('rejects purchases without enough crowns', () => {
    const progress = { ...createHeroProgress(), crowns: 0 };
    const locked = HEROES.find((hero) => !hero.starter)!;
    const result = unlockHero(progress, locked.id);
    expect(result.ok).toBe(false);
    expect(result.progress.unlockedHeroIds).not.toContain(locked.id);
  });

  it('repairs invalid saved progress and preserves starter access', () => {
    const repaired = sanitizeHeroProgress({ crowns: -4, unlockedHeroIds: ['unknown'], selectedHeroId: 'unknown', masteryXp: { aegis: 99.8, bad: 50 } });
    expect(repaired.crowns).toBe(0);
    expect(repaired.unlockedHeroIds).toHaveLength(4);
    expect(repaired.selectedHeroId).toBe('aegis');
    expect(repaired.masteryXp.aegis).toBe(99);
  });

  it('scales match xp, mastery and post-match rewards', () => {
    expect(killExperience('soldier')).toBe(30);
    expect(killExperience('boss')).toBe(250);
    expect(matchXpThreshold(2)).toBeGreaterThan(matchXpThreshold(1));
    expect(masteryLevel(0)).toBe(1);
    expect(masteryLevel(10_000)).toBeGreaterThan(1);
    const reward = calculateHeroReward(true, 10, 1_500);
    const progress = grantHeroReward(createHeroProgress(), 'aegis', reward);
    expect(progress.crowns).toBe(STARTING_CROWNS + reward.crowns);
    expect(progress.masteryXp.aegis).toBe(reward.masteryXp);
  });
});
