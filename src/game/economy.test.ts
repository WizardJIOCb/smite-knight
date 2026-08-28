import { describe, expect, it } from 'vitest';
import {
  GOLD_PER_SECOND,
  INVENTORY_CAPACITY,
  STARTING_GOLD,
  advanceEconomy,
  consumeHealingPotion,
  createEconomyState,
  getInventoryStats,
  killBounty,
  purchaseItem,
} from './economy';

describe('match economy', () => {
  it('starts with gold and grants passive income for elapsed match time', () => {
    const start = createEconomyState();
    const advanced = advanceEconomy(start, 10.5);
    expect(start.gold).toBe(STARTING_GOLD);
    expect(advanced.gold).toBe(STARTING_GOLD + Math.floor(10.5 * GOLD_PER_SECOND));
    expect(advanced.passiveRemainder).toBeCloseTo(0.5);
  });

  it('pays larger bounties for dangerous enemies', () => {
    expect(killBounty('soldier')).toBe(55);
    expect(killBounty('archer')).toBeGreaterThan(killBounty('soldier'));
    expect(killBounty('brute')).toBeGreaterThan(killBounty('archer'));
    expect(killBounty('boss')).toBe(600);
  });

  it('buys components and combines them into a unique item', () => {
    let state = { ...createEconomyState(), gold: 2_000 };
    state = purchaseItem(state, 'iron-blade').state;
    state = purchaseItem(state, 'iron-blade').state;
    const crafted = purchaseItem(state, 'warbrand');
    expect(crafted.ok).toBe(true);
    expect(crafted.state.inventory).toEqual([{ itemId: 'warbrand', quantity: 1 }]);
    expect(getInventoryStats(crafted.state.inventory).attackDamage).toBe(28);
    expect(purchaseItem(crafted.state, 'warbrand').ok).toBe(false);
  });

  it('uses stacked healing potions without wasting them at full health', () => {
    let state = { ...createEconomyState(), gold: 1_000 };
    state = purchaseItem(state, 'healing-potion').state;
    state = purchaseItem(state, 'healing-potion').state;
    expect(state.inventory).toEqual([{ itemId: 'healing-potion', quantity: 2 }]);
    expect(consumeHealingPotion(state, 0).ok).toBe(false);
    const used = consumeHealingPotion(state, 45);
    expect(used.ok).toBe(true);
    expect(used.healed).toBe(45);
    expect(used.state.inventory).toEqual([{ itemId: 'healing-potion', quantity: 1 }]);
  });

  it('does not exceed the six-slot inventory capacity', () => {
    let state = { ...createEconomyState(), gold: 9_999 };
    for (let index = 0; index < INVENTORY_CAPACITY; index += 1) state = purchaseItem(state, 'iron-blade').state;
    const overflow = purchaseItem(state, 'oak-shield');
    expect(state.inventory).toHaveLength(INVENTORY_CAPACITY);
    expect(overflow.ok).toBe(false);
    expect(overflow.message).toContain('заполнен');
  });
});
