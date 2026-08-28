export type LevelId = 'ashen-gate' | 'frostbound-pass' | 'verdant-ruins' | 'sunken-foundry' | 'eclipse-citadel';
export type LevelEnvironment = 'ash' | 'frost' | 'verdant' | 'foundry' | 'eclipse';
export type BossAbility = 'ember-roar' | 'frost-nova' | 'thorn-call' | 'magma-quake' | 'void-step';

export interface LevelObjective {
  title: string;
  text: string;
}

export interface LevelTheme {
  background: number;
  fog: number;
  fogDensity: number;
  sky: number;
  groundLight: number;
  sun: number;
  ground: number;
  stone: number;
  darkStone: number;
  paleStone: number;
  wood: number;
  rock: number;
  mountain: number;
  moon: number;
  accent: number;
  hazard: number;
}

export interface BossDefinition {
  name: string;
  title: string;
  abilityName: string;
  ability: BossAbility;
  health: number;
  speed: number;
  attackRange: number;
  damage: number;
  abilityCooldown: number;
  color: number;
}

export interface LevelDefinition {
  id: LevelId;
  order: number;
  seed: number;
  environment: LevelEnvironment;
  operation: string;
  title: string;
  subtitle: string;
  cardLine: string;
  briefing: string;
  objectives: readonly [LevelObjective, LevelObjective, LevelObjective];
  phaseNames: readonly [string, string, string, string];
  boss: BossDefinition;
  enemyCount: number;
  allyCount: number;
  playerHealth: number;
  playerDamage: number;
  artilleryDelay: readonly [number, number];
  endingEyebrow: string;
  endingTitle: string;
  theme: LevelTheme;
}

export const LEVELS: readonly LevelDefinition[] = [
  {
    id: 'ashen-gate', order: 1, seed: 0x5a17e, environment: 'ash', operation: 'ОПЕРАЦИЯ I',
    title: 'Чёрные врата', subtitle: 'ASHEN SIEGE', cardLine: 'Классический штурм сквозь огонь, мины и град ядер.',
    briefing: 'Северный легион держит последнюю переправу. Наш таран уже на склоне. За стенами ждёт лорд Варгрим.',
    objectives: [
      { title: 'Провести таран', text: 'Держись рядом и сметай завалы прыжком или оружием.' },
      { title: 'Проломить ворота', text: 'Прикрывай расчёт от стражи и огненных стрел.' },
      { title: 'Взять внутренний двор', text: 'Срази Варгрима и подними наше знамя.' },
    ],
    phaseNames: ['I · ПОДЪЁМ', 'II · ПРОЛОМ', 'III · ВОСХОЖДЕНИЕ', 'IV · ВЕРШИНА'],
    boss: { name: 'Варгрим', title: 'Пепельный лорд', abilityName: 'Рёв углей', ability: 'ember-roar', health: 760, speed: 3.55, attackRange: 3.5, damage: 42, abilityCooldown: 6.5, color: 0xff5d27 },
    enemyCount: 34, allyCount: 22, playerHealth: 180, playerDamage: 36, artilleryDelay: [5.5, 9.5],
    endingEyebrow: 'ЧЁРНЫЕ ВРАТА ПАЛИ', endingTitle: 'Пепел помнит',
    theme: { background: 0x222a32, fog: 0x2c3338, fogDensity: 0.015, sky: 0xa8bdd0, groundLight: 0x392317, sun: 0xffd4a8, ground: 0x655e4b, stone: 0x86837b, darkStone: 0x505457, paleStone: 0xa19a8e, wood: 0x5a2f18, rock: 0x57554d, mountain: 0x20272b, moon: 0xf5c990, accent: 0xdf6a26, hazard: 0xff6a21 },
  },
  {
    id: 'frostbound-pass', order: 2, seed: 0xf2057, environment: 'frost', operation: 'ОПЕРАЦИЯ II',
    title: 'Ледяной перевал', subtitle: 'FROSTBOUND MARCH', cardLine: 'Метель, скользкие ледяные поля и кристаллы, которые можно разбить.',
    briefing: 'За Чёрными вратами начинается перевал Белого Безмолвия. Мороз высасывает силы, а бастионом правит Хельда Морозная Клятва.',
    objectives: [
      { title: 'Пробить метель', text: 'Веди таран между ледяными шпилями и не задерживайся на промёрзших кругах.' },
      { title: 'Расколоть ледяные врата', text: 'Разбивай кристаллы — осколки открывают короткие пути.' },
      { title: 'Пережить Белую волну', text: 'Уклоняйся от ледяного кольца Хельды и возьми её знамя.' },
    ],
    phaseNames: ['I · МЕТЕЛЬ', 'II · ЛЕДОЛОМ', 'III · БЕЛЫЙ ПОДЪЁМ', 'IV · КЛЯТВА'],
    boss: { name: 'Хельда', title: 'Морозная Клятва', abilityName: 'Белая волна', ability: 'frost-nova', health: 880, speed: 3.38, attackRange: 3.7, damage: 45, abilityCooldown: 7.2, color: 0x79dcff },
    enemyCount: 37, allyCount: 23, playerHealth: 190, playerDamage: 38, artilleryDelay: [5.1, 8.8],
    endingEyebrow: 'ЛЁД ТРЕСНУЛ', endingTitle: 'Перевал отвечает эхом',
    theme: { background: 0x172936, fog: 0xb9d9e5, fogDensity: 0.019, sky: 0xd8efff, groundLight: 0x213a51, sun: 0xc8eeff, ground: 0xa8bec4, stone: 0x718995, darkStone: 0x354b59, paleStone: 0xb8d0d5, wood: 0x3c5260, rock: 0x819aa4, mountain: 0x253d4b, moon: 0xdaf6ff, accent: 0x62cfee, hazard: 0x74dcff },
  },
  {
    id: 'verdant-ruins', order: 3, seed: 0x7e2da, environment: 'verdant', operation: 'ОПЕРАЦИЯ III',
    title: 'Зелёные руины', subtitle: 'THORNWAKE', cardLine: 'Заросший город, ядовитые омуты и живые корни среди стен.',
    briefing: 'Дорога ушла под корни древнего города. Здесь камень дышит, лес отращивает стены обратно, а королева Мора собирает павших в новый легион.',
    objectives: [
      { title: 'Разрубить чащу', text: 'Ломай стволы, повозки и корни, чтобы расчистить дорогу тарану.' },
      { title: 'Обойти ядовитые омуты', text: 'Зелёные круги отнимают здоровье; взрывы расчищают пространство.' },
      { title: 'Остановить призыв', text: 'Мора зовёт подкрепления — дави её быстро и держи союзников рядом.' },
    ],
    phaseNames: ['I · ЧАЩА', 'II · КОРНИ', 'III · ЗАРОСШИЙ ДВОР', 'IV · ПРОБУЖДЕНИЕ'],
    boss: { name: 'Мора', title: 'Королева Терний', abilityName: 'Зов чащи', ability: 'thorn-call', health: 940, speed: 3.72, attackRange: 3.35, damage: 43, abilityCooldown: 8.3, color: 0x7bd14d },
    enemyCount: 40, allyCount: 24, playerHealth: 200, playerDamage: 40, artilleryDelay: [5.4, 8.4],
    endingEyebrow: 'КОРНИ ОТПУСТИЛИ КАМЕНЬ', endingTitle: 'Лес запомнил сталь',
    theme: { background: 0x14251f, fog: 0x355b42, fogDensity: 0.018, sky: 0x8eb89b, groundLight: 0x182714, sun: 0xffd18a, ground: 0x4d6040, stone: 0x66705d, darkStone: 0x384238, paleStone: 0x8b947e, wood: 0x49351f, rock: 0x53604c, mountain: 0x20372c, moon: 0xd2e3a7, accent: 0x78bd4c, hazard: 0x7ad13f },
  },
  {
    id: 'sunken-foundry', order: 4, seed: 0xf0a6e, environment: 'foundry', operation: 'ОПЕРАЦИЯ IV',
    title: 'Затонувшая кузня', subtitle: 'IRONFALL', cardLine: 'Лавовые каналы, пороховые склады и тяжёлая осадная техника.',
    briefing: 'Под руинами грохочет древняя кузня. По каналам течёт металл, бочки детонируют цепью, а Железный Колосс ждёт у работающего горна.',
    objectives: [
      { title: 'Провести таран над лавой', text: 'Держи центральный мост и используй взрывы против плотных рядов врага.' },
      { title: 'Сорвать плавку', text: 'Разрушай механику кузни и пороховые склады по пути к воротам.' },
      { title: 'Выдержать землетрясение', text: 'Колосс бьёт по площади — уходи из светящегося кольца.' },
    ],
    phaseNames: ['I · ЛИТЕЙНАЯ', 'II · ЖЕЛЕЗНЫЕ ВРАТА', 'III · ГОРН', 'IV · КОЛОСС'],
    boss: { name: 'Феррум', title: 'Железный Колосс', abilityName: 'Магмовый удар', ability: 'magma-quake', health: 1120, speed: 3.05, attackRange: 4.1, damage: 55, abilityCooldown: 6.8, color: 0xff9d32 },
    enemyCount: 43, allyCount: 25, playerHealth: 215, playerDamage: 43, artilleryDelay: [4.7, 7.8],
    endingEyebrow: 'ГОРН ПОГАС', endingTitle: 'Железо склонилось',
    theme: { background: 0x211514, fog: 0x4d251b, fogDensity: 0.017, sky: 0xc27854, groundLight: 0x32100b, sun: 0xff9b5a, ground: 0x4a3a31, stone: 0x5f5650, darkStone: 0x302b2b, paleStone: 0x81756c, wood: 0x4b2518, rock: 0x493d37, mountain: 0x24191a, moon: 0xff8a55, accent: 0xff7a2a, hazard: 0xff4b18 },
  },
  {
    id: 'eclipse-citadel', order: 5, seed: 0xec1e5, environment: 'eclipse', operation: 'ОПЕРАЦИЯ V',
    title: 'Цитадель затмения', subtitle: 'THE LAST CROWN', cardLine: 'Парящие обелиски, разломы пустоты и финальный король, меняющий позицию.',
    briefing: 'Все дороги сходятся в цитадели над бездной. Пространство ломается вокруг башен, а король Ноктарион носит корону пяти павших крепостей.',
    objectives: [
      { title: 'Пересечь разломы', text: 'Не стой в фиолетовых печатях и разбивай обелиски, закрывающие путь.' },
      { title: 'Поднять легион к небу', text: 'Проведи союзников через оба яруса до последней площадки.' },
      { title: 'Сорвать Пустотный шаг', text: 'Ноктарион телепортируется за спину — следи за вспышкой и сразу блокируй.' },
    ],
    phaseNames: ['I · РАЗЛОМ', 'II · ПЕЧАТЬ', 'III · НЕБЕСНЫЙ ДВОР', 'IV · ЗАТМЕНИЕ'],
    boss: { name: 'Ноктарион', title: 'Король Затмения', abilityName: 'Пустотный шаг', ability: 'void-step', health: 1280, speed: 4.05, attackRange: 3.75, damage: 58, abilityCooldown: 5.4, color: 0xb073ff },
    enemyCount: 46, allyCount: 26, playerHealth: 230, playerDamage: 46, artilleryDelay: [4.4, 7.2],
    endingEyebrow: 'ПЯТАЯ КОРОНА РАЗБИТА', endingTitle: 'Рассвет над цитаделью',
    theme: { background: 0x100d24, fog: 0x251849, fogDensity: 0.02, sky: 0x8c75c2, groundLight: 0x110d22, sun: 0xbc9bff, ground: 0x38334e, stone: 0x5b5572, darkStone: 0x29233f, paleStone: 0x817a9b, wood: 0x332842, rock: 0x504965, mountain: 0x17122e, moon: 0xc7a8ff, accent: 0xa866ff, hazard: 0x9b48ff },
  },
] as const;

export function getLevel(id: string | null | undefined): LevelDefinition {
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}

export function getNextLevel(level: LevelDefinition): LevelDefinition | undefined {
  return LEVELS[level.order];
}
