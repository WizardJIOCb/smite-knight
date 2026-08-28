import { describe, expect, it } from 'vitest';
import {
  CITADEL_FRONT_Z,
  CITADEL_LANE_COUNT,
  CITADEL_MAX_HEALTH,
  CITADEL_OPEN_FRONT_HALF_WIDTH,
  CITADEL_UNIT_CAP,
  citadelBattlePhase,
  citadelLaneAdvance,
  citadelLaneGate,
  citadelLaneX,
  citadelOpenFrontAdvance,
  citadelWaveSquad,
  damageCitadel,
} from './citadelWar';

describe('war of two citadels', () => {
  it('defines six distinct curved paths between both castle fronts', () => {
    expect(CITADEL_LANE_COUNT).toBe(6);
    const middle = Array.from({ length: CITADEL_LANE_COUNT }, (_, lane) => citadelLaneX(lane, 0));
    expect(new Set(middle.map((x) => x.toFixed(2))).size).toBe(6);
    for (let lane = 0; lane < CITADEL_LANE_COUNT; lane += 1) {
      expect(citadelLaneGate(lane, 'allies').z).toBe(CITADEL_FRONT_Z);
      expect(citadelLaneGate(lane, 'enemies').z).toBe(-CITADEL_FRONT_Z);
    }
  });

  it('advances opposing armies toward the other castle', () => {
    expect(citadelLaneAdvance(2, 'allies', 20).z).toBe(10);
    expect(citadelLaneAdvance(2, 'enemies', -20).z).toBe(-10);
    expect(citadelLaneAdvance(2, 'allies', -62).z).toBe(-63);
  });

  it('advances a free army across the field with bounded lateral wandering', () => {
    expect(citadelOpenFrontAdvance('allies', 20, 7, 0).z).toBe(10);
    expect(citadelOpenFrontAdvance('enemies', -20, -7, Math.PI / 2).z).toBe(-10);
    expect(citadelOpenFrontAdvance('allies', 20, 7, 0).x).not.toBe(citadelOpenFrontAdvance('allies', 20, 7, Math.PI / 2).x);
    expect(citadelOpenFrontAdvance('allies', 0, 100, Math.PI / 2).x).toBe(CITADEL_OPEN_FRONT_HALF_WIDTH);
    expect(citadelOpenFrontAdvance('enemies', 0, -100, -Math.PI / 2).x).toBe(-CITADEL_OPEN_FRONT_HALF_WIDTH);
  });

  it('rotates varied squads across lanes and waves', () => {
    const roles = new Set(Array.from({ length: 12 }, (_, index) => citadelWaveSquad(Math.floor(index / 6), index % 6)).flat());
    expect(roles).toEqual(new Set(['soldier', 'archer', 'brute']));
  });

  it('keeps the large battle inside a bounded live-unit budget', () => {
    expect(CITADEL_UNIT_CAP).toBeGreaterThanOrEqual(CITADEL_LANE_COUNT * 20);
    expect(CITADEL_UNIT_CAP).toBeLessThanOrEqual(180);
  });

  it('clamps castle damage and exposes four pressure phases', () => {
    expect(damageCitadel(CITADEL_MAX_HEALTH, 400)).toBe(CITADEL_MAX_HEALTH - 400);
    expect(damageCitadel(100, 500)).toBe(0);
    expect(citadelBattlePhase(CITADEL_MAX_HEALTH)).toBe(0);
    expect(citadelBattlePhase(CITADEL_MAX_HEALTH * 0.7)).toBe(1);
    expect(citadelBattlePhase(CITADEL_MAX_HEALTH * 0.4)).toBe(2);
    expect(citadelBattlePhase(CITADEL_MAX_HEALTH * 0.1)).toBe(3);
  });
});
