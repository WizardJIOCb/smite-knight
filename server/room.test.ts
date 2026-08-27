import { describe, expect, it } from 'vitest';
import { createPlayer, createRoomCode, normalizeRoomCode, safePlayerUpdate, sanitizeChat, sanitizeName } from './room.js';

describe('room safety helpers', () => {
  it('normalizes names and chat without HTML control characters', () => {
    expect(sanitizeName('  <Sir>\u0000 Rodion  ')).toBe('Sir Rodion');
    expect(sanitizeChat('  hello   <b>army</b>  ')).toBe('hello barmy/b');
  });

  it('generates an allowed six-character code', () => {
    expect(createRoomCode(new Set(), () => 0)).toBe('AAAAAA');
    expect(normalizeRoomCode(' ab-c2!9 ')).toBe('ABC29');
  });

  it('clamps untrusted position and health updates', () => {
    const player = createPlayer('one', 'Knight', 0);
    const next = safePlayerUpdate(player, { x: 999, z: -999, health: -5, action: 'attack' });
    expect(next.x).toBe(44);
    expect(next.z).toBe(-45);
    expect(next.health).toBe(0);
    expect(next.action).toBe('attack');
    expect(next.name).toBe('Knight');
  });
});
