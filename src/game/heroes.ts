export type HeroId =
  | 'aegis'
  | 'ember'
  | 'frost'
  | 'thorn'
  | 'shade'
  | 'pyre'
  | 'dawn'
  | 'storm'
  | 'grave'
  | 'crown';

export type HeroAbilityEffect = 'burst' | 'heal' | 'dash' | 'buff' | 'siphon' | 'aura';

export interface HeroAbility {
  name: string;
  icon: string;
  description: string;
  cooldown: number;
  effect: HeroAbilityEffect;
  damage?: number;
  heal?: number;
  radius?: number;
  distance?: number;
  duration?: number;
  damageBuff?: number;
  defenseBuff?: number;
  speedBuff?: number;
  regen?: number;
  auraDamage?: number;
}

export interface HeroDefinition {
  id: HeroId;
  name: string;
  title: string;
  className: string;
  icon: string;
  accent: number;
  unlockCost: number;
  starter: boolean;
  description: string;
  passive: string;
  stats: {
    maxHealth: number;
    attackDamage: number;
    moveSpeed: number;
    damageReduction: number;
    lifesteal: number;
    healthRegen: number;
  };
  ability: HeroAbility;
  ultimate: HeroAbility;
}

export interface HeroProgress {
  crowns: number;
  unlockedHeroIds: HeroId[];
  selectedHeroId: HeroId;
  masteryXp: Partial<Record<HeroId, number>>;
}

export interface HeroReward {
  crowns: number;
  masteryXp: number;
}

export interface HeroUnlockResult {
  ok: boolean;
  progress: HeroProgress;
  message: string;
}

export const HERO_PROGRESS_STORAGE_KEY = 'smite-knight-heroes-v1';
export const STARTING_CROWNS = 400;

export const HEROES: readonly HeroDefinition[] = [
  {
    id: 'aegis', name: 'Эйрик', title: 'Клятва бастиона', className: 'Страж', icon: '🛡️', accent: 0x4da9ff,
    unlockCost: 0, starter: true,
    description: 'Несокрушимый защитник передовой. Прощает ошибки и держит строй под огнём.',
    passive: 'Крепостная клятва: +70 здоровья и 12% защиты.',
    stats: { maxHealth: 70, attackDamage: -2, moveSpeed: -0.12, damageReduction: 0.12, lifesteal: 0, healthRegen: 0.5 },
    ability: { name: 'Удар щита', icon: '🛡️', description: 'Взрывной удар по врагам вокруг и краткая броня.', cooldown: 9, effect: 'burst', damage: 48, radius: 5.2, duration: 3, defenseBuff: 0.18 },
    ultimate: { name: 'Последний бастион', icon: '🏰', description: 'Восстанавливает здоровье и на 8 секунд делает Эйрика почти неуязвимым.', cooldown: 42, effect: 'heal', heal: 120, duration: 8, defenseBuff: 0.42, regen: 5 },
  },
  {
    id: 'ember', name: 'Рагна', title: 'Пепельная ярость', className: 'Берсерк', icon: '🔥', accent: 0xff5a24,
    unlockCost: 0, starter: true,
    description: 'Ближний боец с чудовищным уроном. Выживает за счёт натиска и вампиризма.',
    passive: 'Жажда боя: +11 урона и 8% вампиризма.',
    stats: { maxHealth: 15, attackDamage: 11, moveSpeed: 0.08, damageReduction: 0, lifesteal: 0.08, healthRegen: 0 },
    ability: { name: 'Огненный раскол', icon: '🔥', description: 'Поджигает землю и поражает всех врагов в широком радиусе.', cooldown: 8, effect: 'burst', damage: 72, radius: 6 },
    ultimate: { name: 'Рагнарёк', icon: '☄️', description: 'На 9 секунд резко усиливает урон, скорость и вампиризм.', cooldown: 44, effect: 'buff', duration: 9, damageBuff: 0.6, speedBuff: 0.24, regen: 3 },
  },
  {
    id: 'frost', name: 'Илва', title: 'Северный прицел', className: 'Следопыт', icon: '❄️', accent: 0x75d9ff,
    unlockCost: 0, starter: true,
    description: 'Быстрый охотник, который безопасно прореживает плотные группы врагов.',
    passive: 'Лёгкий шаг: +0.38 скорости и +5 урона.',
    stats: { maxHealth: -20, attackDamage: 5, moveSpeed: 0.38, damageReduction: 0, lifesteal: 0, healthRegen: 0.6 },
    ability: { name: 'Ледяной залп', icon: '🧊', description: 'Замораживающий взрыв перед героем поражает отряд целиком.', cooldown: 7, effect: 'burst', damage: 58, radius: 7 },
    ultimate: { name: 'Белая буря', icon: '🌨️', description: 'На 10 секунд окружает Илву снежной бурей, наносящей постоянный урон.', cooldown: 40, effect: 'aura', duration: 10, radius: 8, auraDamage: 22, speedBuff: 0.18 },
  },
  {
    id: 'thorn', name: 'Торн', title: 'Сердце рощи', className: 'Друид', icon: '🌿', accent: 0x64d477,
    unlockCost: 0, starter: true,
    description: 'Живучий целитель для долгих осад. Возвращает здоровье прямо в гуще боя.',
    passive: 'Живая кора: +2.2 здоровья в секунду.',
    stats: { maxHealth: 35, attackDamage: 0, moveSpeed: 0, damageReduction: 0.04, lifesteal: 0, healthRegen: 2.2 },
    ability: { name: 'Дикий рост', icon: '🌱', description: 'Мгновенно лечит Торна и укрепляет защиту.', cooldown: 11, effect: 'heal', heal: 82, duration: 4, defenseBuff: 0.12, regen: 4 },
    ultimate: { name: 'Древо жизни', icon: '🌳', description: 'Создаёт священную рощу: мощное лечение и регенерация на 12 секунд.', cooldown: 46, effect: 'heal', heal: 165, duration: 12, defenseBuff: 0.18, regen: 8 },
  },
  {
    id: 'shade', name: 'Ноктис', title: 'Клинок сумерек', className: 'Убийца', icon: '🌑', accent: 0xb887ff,
    unlockCost: 350, starter: false,
    description: 'Мобильный дуэлянт. Мгновенно сокращает дистанцию и добивает ослабленных врагов.',
    passive: 'Теневая сталь: высокая скорость и 12% вампиризма, но меньше здоровья.',
    stats: { maxHealth: -35, attackDamage: 14, moveSpeed: 0.48, damageReduction: 0, lifesteal: 0.12, healthRegen: 0 },
    ability: { name: 'Шаг сквозь тень', icon: '🗡️', description: 'Рывок вперёд с режущей волной в точке выхода.', cooldown: 6, effect: 'dash', damage: 78, radius: 4.4, distance: 8 },
    ultimate: { name: 'Полночная жатва', icon: '🌘', description: 'На 8 секунд превращает героя в вихрь скорости и смертоносных ударов.', cooldown: 38, effect: 'buff', duration: 8, damageBuff: 0.72, speedBuff: 0.48, regen: 2 },
  },
  {
    id: 'pyre', name: 'Сольвейг', title: 'Голос пламени', className: 'Пиромант', icon: '☄️', accent: 0xff9d31,
    unlockCost: 450, starter: false,
    description: 'Маг осадного огня. Лучший выбор против больших волн и тяжёлой пехоты.',
    passive: 'Искра разрушения: +13 урона, но снижено здоровье.',
    stats: { maxHealth: -30, attackDamage: 13, moveSpeed: 0.04, damageReduction: 0, lifesteal: 0, healthRegen: 0.4 },
    ability: { name: 'Кольцо углей', icon: '♨️', description: 'Взрыв пламени вокруг героя с большим уроном по толпе.', cooldown: 9, effect: 'burst', damage: 92, radius: 7.5 },
    ultimate: { name: 'Падение солнца', icon: '☀️', description: 'Обрушивает огромный огненный удар и очищает фронт вокруг героя.', cooldown: 48, effect: 'burst', damage: 245, radius: 12 },
  },
  {
    id: 'dawn', name: 'Авелин', title: 'Щит рассвета', className: 'Паладин', icon: '☀️', accent: 0xffdb70,
    unlockCost: 550, starter: false,
    description: 'Универсальный воитель света: выдерживает натиск, лечится и держит позицию.',
    passive: 'Сияющая броня: +45 здоровья, 8% защиты и регенерация.',
    stats: { maxHealth: 45, attackDamage: 3, moveSpeed: -0.05, damageReduction: 0.08, lifesteal: 0, healthRegen: 1.4 },
    ability: { name: 'Карающий свет', icon: '✨', description: 'Световая волна ранит врагов и восстанавливает здоровье.', cooldown: 10, effect: 'siphon', damage: 62, heal: 48, radius: 6.5 },
    ultimate: { name: 'Непреклонный рассвет', icon: '🌅', description: 'Мощно лечит героя и дарует почти абсолютную защиту на 6 секунд.', cooldown: 45, effect: 'heal', heal: 145, duration: 6, defenseBuff: 0.58, regen: 6 },
  },
  {
    id: 'storm', name: 'Хальвар', title: 'Наследник грома', className: 'Заклинатель', icon: '⚡', accent: 0x52dcff,
    unlockCost: 650, starter: false,
    description: 'Контролирует середину фронта разрядами, которые бьют сразу по нескольким целям.',
    passive: 'Грозовой шаг: +0.2 скорости и +8 урона.',
    stats: { maxHealth: -5, attackDamage: 8, moveSpeed: 0.2, damageReduction: 0.02, lifesteal: 0, healthRegen: 0.5 },
    ability: { name: 'Цепная молния', icon: '⚡', description: 'Электрический импульс поражает всех ближайших противников.', cooldown: 8, effect: 'burst', damage: 76, radius: 8.5 },
    ultimate: { name: 'Око бури', icon: '🌩️', description: 'Грозовая аура 11 секунд непрерывно поражает врагов вокруг.', cooldown: 43, effect: 'aura', duration: 11, radius: 9, auraDamage: 27, speedBuff: 0.12 },
  },
  {
    id: 'grave', name: 'Морвен', title: 'Хранитель могил', className: 'Некромант', icon: '💀', accent: 0x9bd36a,
    unlockCost: 750, starter: false,
    description: 'Высасывает жизнь из толпы. Чем плотнее фронт, тем сложнее его остановить.',
    passive: 'Печать крови: 16% вампиризма и сниженный запас здоровья.',
    stats: { maxHealth: -25, attackDamage: 7, moveSpeed: 0.06, damageReduction: 0, lifesteal: 0.16, healthRegen: 0.8 },
    ability: { name: 'Похищение души', icon: '👻', description: 'Ранит окружающих врагов и мгновенно возвращает здоровье.', cooldown: 9, effect: 'siphon', damage: 68, heal: 55, radius: 6.8 },
    ultimate: { name: 'Врата преисподней', icon: '🕯️', description: 'Аура смерти высасывает жизнь из всего вражеского строя 12 секунд.', cooldown: 47, effect: 'aura', duration: 12, radius: 9.5, auraDamage: 25, regen: 5 },
  },
  {
    id: 'crown', name: 'Сигрун', title: 'Пятая корона', className: 'Полководец', icon: '👑', accent: 0xe8b84f,
    unlockCost: 900, starter: false,
    description: 'Элитный командир без явных слабостей. Превращает любой прорыв в лавину.',
    passive: 'Воля короны: усилены здоровье, урон, защита и скорость.',
    stats: { maxHealth: 35, attackDamage: 10, moveSpeed: 0.18, damageReduction: 0.07, lifesteal: 0.05, healthRegen: 1 },
    ability: { name: 'Командный клич', icon: '📯', description: 'На 7 секунд усиливает урон, скорость и восстановление героя.', cooldown: 12, effect: 'buff', duration: 7, damageBuff: 0.32, speedBuff: 0.25, regen: 4 },
    ultimate: { name: 'Великая война', icon: '👑', description: 'Королевская волна сокрушает фронт и оставляет героя усиленным.', cooldown: 50, effect: 'burst', damage: 185, radius: 11, duration: 9, damageBuff: 0.38, defenseBuff: 0.18, speedBuff: 0.2 },
  },
] as const;

const HERO_IDS = new Set<HeroId>(HEROES.map((hero) => hero.id));
const STARTER_HERO_IDS = HEROES.filter((hero) => hero.starter).map((hero) => hero.id);

export function getHero(id: HeroId | string): HeroDefinition {
  return HEROES.find((hero) => hero.id === id) ?? HEROES[0];
}

export function createHeroProgress(): HeroProgress {
  return { crowns: STARTING_CROWNS, unlockedHeroIds: [...STARTER_HERO_IDS], selectedHeroId: HEROES[0].id, masteryXp: {} };
}

export function sanitizeHeroProgress(value: unknown): HeroProgress {
  const fallback = createHeroProgress();
  if (!value || typeof value !== 'object') return fallback;
  const candidate = value as Partial<HeroProgress>;
  const unlocked = Array.isArray(candidate.unlockedHeroIds)
    ? candidate.unlockedHeroIds.filter((id): id is HeroId => typeof id === 'string' && HERO_IDS.has(id as HeroId))
    : [];
  const unlockedHeroIds = [...new Set<HeroId>([...STARTER_HERO_IDS, ...unlocked])];
  const selectedHeroId = typeof candidate.selectedHeroId === 'string'
    && HERO_IDS.has(candidate.selectedHeroId as HeroId)
    && unlockedHeroIds.includes(candidate.selectedHeroId as HeroId)
    ? candidate.selectedHeroId as HeroId
    : fallback.selectedHeroId;
  const masteryXp: Partial<Record<HeroId, number>> = {};
  if (candidate.masteryXp && typeof candidate.masteryXp === 'object') {
    for (const hero of HEROES) {
      const xp = candidate.masteryXp[hero.id];
      if (typeof xp === 'number' && Number.isFinite(xp) && xp > 0) masteryXp[hero.id] = Math.floor(xp);
    }
  }
  return {
    crowns: typeof candidate.crowns === 'number' && Number.isFinite(candidate.crowns) ? Math.max(0, Math.floor(candidate.crowns)) : fallback.crowns,
    unlockedHeroIds,
    selectedHeroId,
    masteryXp,
  };
}

export function loadHeroProgress(storage: Pick<Storage, 'getItem'> = localStorage): HeroProgress {
  try {
    const saved = storage.getItem(HERO_PROGRESS_STORAGE_KEY);
    return saved ? sanitizeHeroProgress(JSON.parse(saved)) : createHeroProgress();
  } catch {
    return createHeroProgress();
  }
}

export function saveHeroProgress(progress: HeroProgress, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(HERO_PROGRESS_STORAGE_KEY, JSON.stringify(sanitizeHeroProgress(progress)));
}

export function unlockHero(progress: HeroProgress, heroId: HeroId): HeroUnlockResult {
  const safe = sanitizeHeroProgress(progress);
  const hero = getHero(heroId);
  if (safe.unlockedHeroIds.includes(hero.id)) return { ok: true, progress: safe, message: `${hero.name} уже в ростере.` };
  if (safe.crowns < hero.unlockCost) return { ok: false, progress: safe, message: `Нужно ещё ${hero.unlockCost - safe.crowns} корон.` };
  return {
    ok: true,
    progress: { ...safe, crowns: safe.crowns - hero.unlockCost, unlockedHeroIds: [...safe.unlockedHeroIds, hero.id], selectedHeroId: hero.id },
    message: `${hero.name} присоединяется к войне.`,
  };
}

export function selectHero(progress: HeroProgress, heroId: HeroId): HeroProgress {
  const safe = sanitizeHeroProgress(progress);
  return safe.unlockedHeroIds.includes(heroId) ? { ...safe, selectedHeroId: heroId } : safe;
}

export function matchXpThreshold(level: number): number {
  return 100 + Math.max(0, level - 1) * 75;
}

export function killExperience(role: 'soldier' | 'archer' | 'brute' | 'boss' | 'player'): number {
  if (role === 'boss') return 250;
  if (role === 'brute') return 60;
  if (role === 'archer') return 35;
  return role === 'soldier' ? 30 : 0;
}

export function masteryLevel(xp: number): number {
  return Math.min(30, 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 180)));
}

export function calculateHeroReward(victory: boolean, kills: number, damage: number): HeroReward {
  return {
    crowns: (victory ? 120 : 45) + Math.max(0, kills) * (victory ? 4 : 2) + Math.floor(Math.max(0, damage) / 500),
    masteryXp: (victory ? 150 : 70) + Math.max(0, kills) * 12 + Math.floor(Math.max(0, damage) / 80),
  };
}

export function grantHeroReward(progress: HeroProgress, heroId: HeroId, reward: HeroReward): HeroProgress {
  const safe = sanitizeHeroProgress(progress);
  return {
    ...safe,
    crowns: safe.crowns + Math.max(0, Math.floor(reward.crowns)),
    masteryXp: { ...safe.masteryXp, [heroId]: (safe.masteryXp[heroId] ?? 0) + Math.max(0, Math.floor(reward.masteryXp)) },
  };
}
