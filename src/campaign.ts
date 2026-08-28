import { CAMPAIGN_LEVELS, LEVELS, type LevelId } from './game/levels';

export interface CampaignProgress {
  completed: LevelId[];
  selected: LevelId;
}

const STORAGE_KEY = 'smite-knight:campaign:v1';

export function defaultCampaignProgress(): CampaignProgress {
  return { completed: [], selected: LEVELS[0].id };
}

export function normalizeCampaignProgress(value: unknown): CampaignProgress {
  if (!value || typeof value !== 'object') return defaultCampaignProgress();
  const candidate = value as Partial<CampaignProgress>;
  const validIds = new Set<LevelId>(LEVELS.map((level) => level.id));
  const campaignIds = new Set<LevelId>(CAMPAIGN_LEVELS.map((level) => level.id));
  const completed = Array.isArray(candidate.completed)
    ? [...new Set(candidate.completed.filter((id): id is LevelId => typeof id === 'string' && campaignIds.has(id as LevelId)))]
    : [];
  const selected = typeof candidate.selected === 'string' && validIds.has(candidate.selected as LevelId)
    ? candidate.selected as LevelId
    : LEVELS[0].id;
  return { completed, selected };
}

export function loadCampaignProgress(storage: Pick<Storage, 'getItem'> = localStorage): CampaignProgress {
  try {
    const value = storage.getItem(STORAGE_KEY);
    return value ? normalizeCampaignProgress(JSON.parse(value)) : defaultCampaignProgress();
  } catch {
    return defaultCampaignProgress();
  }
}

export function saveCampaignProgress(progress: CampaignProgress, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(normalizeCampaignProgress(progress))); } catch { /* Storage may be unavailable in embedded/private contexts. */ }
}

export function completeCampaignLevel(progress: CampaignProgress, levelId: LevelId): CampaignProgress {
  if (!CAMPAIGN_LEVELS.some((level) => level.id === levelId)) return { ...progress, selected: levelId };
  const completed = progress.completed.includes(levelId) ? progress.completed : [...progress.completed, levelId];
  const levelIndex = CAMPAIGN_LEVELS.findIndex((level) => level.id === levelId);
  const selected = CAMPAIGN_LEVELS[Math.min(levelIndex + 1, CAMPAIGN_LEVELS.length - 1)]?.id ?? levelId;
  return { completed, selected };
}

export function nextCampaignLevel(progress: CampaignProgress): LevelId {
  return CAMPAIGN_LEVELS.find((level) => !progress.completed.includes(level.id))?.id ?? CAMPAIGN_LEVELS[CAMPAIGN_LEVELS.length - 1].id;
}
