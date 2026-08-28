import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS, loadGameSettings, saveGameSettings, SETTINGS_STORAGE_KEY } from './settings';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (key: string) => key === SETTINGS_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => {
      if (key === SETTINGS_STORAGE_KEY) value = next;
    },
    value: () => value,
  };
}

describe('game settings', () => {
  it('uses defaults when nothing has been saved', () => {
    expect(loadGameSettings(memoryStorage())).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('restores every saved setting', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, volume: 0.27, quality: 'medium' }));
    expect(loadGameSettings(storage)).toEqual({ volume: 0.27, quality: 'medium' });
  });

  it('repairs malformed and out-of-range values', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, volume: 3, quality: 'cinematic' }));
    expect(loadGameSettings(storage)).toEqual({ volume: 1, quality: 'high' });
    expect(loadGameSettings(memoryStorage('{broken'))).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('saves one versioned settings object and tolerates unavailable storage', () => {
    const storage = memoryStorage();
    expect(saveGameSettings({ volume: -0.5, quality: 'low' }, storage)).toBe(true);
    expect(JSON.parse(storage.value() ?? '')).toEqual({ version: 1, volume: 0, quality: 'low' });

    const unavailable = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    expect(saveGameSettings({ volume: 0.5, quality: 'high' }, unavailable)).toBe(false);
  });
});
