export type GraphicsQuality = 'high' | 'medium' | 'low';

export interface GameSettings {
  volume: number;
  quality: GraphicsQuality;
}

interface StoredGameSettings extends GameSettings {
  version: 1;
}

interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_STORAGE_KEY = 'smite-knight:settings:v1';
export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = {
  volume: 0.65,
  quality: 'high',
};

const qualityValues = new Set<GraphicsQuality>(['high', 'medium', 'low']);

function browserStorage(): SettingsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeSettings(value: unknown): GameSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_GAME_SETTINGS };
  const candidate = value as Partial<StoredGameSettings>;
  if (candidate.version !== 1) return { ...DEFAULT_GAME_SETTINGS };

  const volume = typeof candidate.volume === 'number' && Number.isFinite(candidate.volume)
    ? Math.max(0, Math.min(1, candidate.volume))
    : DEFAULT_GAME_SETTINGS.volume;
  const quality = typeof candidate.quality === 'string' && qualityValues.has(candidate.quality as GraphicsQuality)
    ? candidate.quality as GraphicsQuality
    : DEFAULT_GAME_SETTINGS.quality;

  return { volume, quality };
}

export function loadGameSettings(storage = browserStorage()): GameSettings {
  if (!storage) return { ...DEFAULT_GAME_SETTINGS };
  try {
    const saved = storage.getItem(SETTINGS_STORAGE_KEY);
    return saved ? normalizeSettings(JSON.parse(saved)) : { ...DEFAULT_GAME_SETTINGS };
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

export function saveGameSettings(settings: GameSettings, storage = browserStorage()): boolean {
  if (!storage) return false;
  try {
    const normalized = normalizeSettings({ version: 1, ...settings });
    const value: StoredGameSettings = { version: 1, ...normalized };
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
