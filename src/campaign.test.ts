import { describe, expect, it } from 'vitest';
import { completeCampaignLevel, defaultCampaignProgress, nextCampaignLevel, normalizeCampaignProgress } from './campaign';

describe('campaign progress', () => {
  it('starts at the first operation', () => {
    const progress = defaultCampaignProgress();
    expect(progress.selected).toBe('ashen-gate');
    expect(nextCampaignLevel(progress)).toBe('ashen-gate');
  });

  it('advances after a completed level without duplicating completion', () => {
    const once = completeCampaignLevel(defaultCampaignProgress(), 'ashen-gate');
    const twice = completeCampaignLevel(once, 'ashen-gate');
    expect(twice.completed).toEqual(['ashen-gate']);
    expect(twice.selected).toBe('frostbound-pass');
    expect(nextCampaignLevel(twice)).toBe('frostbound-pass');
  });

  it('discards unknown or malformed saved values', () => {
    expect(normalizeCampaignProgress({ completed: ['ashen-gate', 'twin-citadels', 'unknown'], selected: 'unknown' })).toEqual({
      completed: ['ashen-gate'],
      selected: 'ashen-gate',
    });
  });

  it('keeps the citadel war selectable without adding it to campaign completion', () => {
    const progress = completeCampaignLevel(defaultCampaignProgress(), 'twin-citadels');
    expect(progress.completed).toEqual([]);
    expect(progress.selected).toBe('twin-citadels');
    expect(normalizeCampaignProgress(progress).selected).toBe('twin-citadels');
  });
});
