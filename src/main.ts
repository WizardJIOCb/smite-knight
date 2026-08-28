import './style.css';
import { completeCampaignLevel, loadCampaignProgress, nextCampaignLevel, saveCampaignProgress } from './campaign';
import {
  INVENTORY_CAPACITY,
  SHOP_ITEMS,
  getShopItem,
  inventoryItemCount,
  purchaseItem as previewPurchase,
  totalItemCost,
  type EconomyState,
  type InventorySlot,
  type ShopItem,
} from './game/economy';
import { SiegeGame, type HudState } from './game/game';
import {
  HEROES,
  calculateHeroReward,
  getHero,
  grantHeroReward,
  loadHeroProgress,
  masteryLevel,
  saveHeroProgress,
  selectHero,
  unlockHero,
  type HeroId,
  type HeroReward,
} from './game/heroes';
import { LEVELS, getLevel, getNextLevel, type LevelDefinition, type LevelId } from './game/levels';
import { mobileCameraDrag, normalizeMobileJoystick } from './game/mobileControls';
import { preloadKnightAssets } from './game/models';
import { NetworkClient } from './network';
import { loadGameSettings, saveGameSettings } from './settings';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing UI element: ${selector}`);
  return found;
}

const canvas = element<HTMLCanvasElement>('#game');
const landing = element('#landing');
const lobby = element('#lobby');
const mapSelect = element('#map-select');
const briefing = element('#briefing');
const heroSelect = element('#hero-select');
const pause = element('#pause');
const ending = element('#ending');
const shop = element('#shop');
const hud = element('#hud');
const loading = element('#loading');
const mobileControls = element('#mobile-controls');
const damageVignette = element('#damage-vignette');
const interaction = element('#interaction');
const killFeed = element('#kill-feed');
const chat = element('#chat');
const chatToggle = element<HTMLButtonElement>('#chat-toggle');
const chatMessages = element('#chat-messages');
const roomBadge = element('#room-badge');
const lobbyStatus = element('#lobby-status');
const volumeInput = element<HTMLInputElement>('#volume');
const qualitySelect = element<HTMLSelectElement>('#quality');
const requestedLevel = new URLSearchParams(location.search).get('level');
let campaign = loadCampaignProgress();
const currentLevel = getLevel(requestedLevel ?? campaign.selected);
campaign = { ...campaign, selected: currentLevel.id };
saveCampaignProgress(campaign);
let settings = loadGameSettings();
let heroProgress = loadHeroProgress();
let highlightedHeroId: HeroId = heroProgress.selectedHeroId;
volumeInput.value = String(Math.round(settings.volume * 100));
qualitySelect.value = settings.quality;
let multiplayer = false;
let damageTimer = 0;
let inventorySignature = '__initial__';

const network = new NetworkClient({
  onSnapshot: (snapshot, localId) => {
    game.syncRemotePlayers(snapshot.players, localId);
    game.applyNetworkBattleEvent('gate-hit', snapshot.gateHealth);
    game.applyNetworkBattleEvent('phase', snapshot.phase);
  },
  onPlayerUpdate: (player) => game.updateRemotePlayer(player),
  onPlayerLeft: (id) => game.removeRemotePlayer(id),
  onBattleEvent: (type, value) => game.applyNetworkBattleEvent(type, value),
  onChat: ({ name, message }) => addChatLine(name, message),
  onCount: (count) => { element('#online-count').textContent = `${count} ${count === 1 ? 'рыцарь' : count < 5 ? 'рыцаря' : 'рыцарей'}`; },
});

const game = new SiegeGame(canvas, {
  onHud: updateHud,
  onFeed: addFeed,
  onPause: showPause,
  onVictory: (stats) => {
    shop.classList.remove('active');
    campaign = completeCampaignLevel(campaign, currentLevel.id);
    saveCampaignProgress(campaign);
    renderLevelCards();
    hud.classList.add('hidden');
    mobileControls.classList.remove('game-active');
    element('#ending-eyebrow').textContent = currentLevel.endingEyebrow;
    element('#ending-title').textContent = currentLevel.endingTitle;
    const reward = awardHeroProgress(stats.heroId, true, stats.kills, stats.damage);
    element('#ending-stats').innerHTML = `Герой: <b>${getHero(stats.heroId).name}</b> · уровень боя: <b>${stats.matchLevel}</b><br>Врагов повержено: <b>${stats.kills}</b> · нанесено урона: <b>${Math.round(stats.damage)}</b><br>Время штурма: <b>${formatTime(stats.duration)}</b><br><span class="ending-reward">Награда: +${reward.crowns} 👑 · +${reward.masteryXp} мастерства</span>`;
    const next = getNextLevel(currentLevel);
    const nextButton = element<HTMLButtonElement>('#next-level');
    nextButton.classList.toggle('hidden', !next);
    element('#next-level-name').textContent = next ? `${next.operation} · ${next.title}` : '';
    ending.classList.add('active');
  },
  onDefeat: (stats) => {
    shop.classList.remove('active');
    hud.classList.add('hidden');
    mobileControls.classList.remove('game-active');
    element('#ending-eyebrow').textContent = 'НАША ЦИТАДЕЛЬ ПАЛА';
    element('#ending-title').textContent = 'Красный фронт прорвался';
    const reward = awardHeroProgress(stats.heroId, false, stats.kills, stats.damage);
    element('#ending-stats').innerHTML = `Герой: <b>${getHero(stats.heroId).name}</b> · уровень боя: <b>${stats.matchLevel}</b><br>Врагов повержено: <b>${stats.kills}</b> · нанесено урона: <b>${Math.round(stats.damage)}</b><br>Время обороны: <b>${formatTime(stats.duration)}</b><br><span class="ending-reward">Награда за оборону: +${reward.crowns} 👑 · +${reward.masteryXp} мастерства</span>`;
    element<HTMLButtonElement>('#next-level').classList.add('hidden');
    ending.classList.add('active');
  },
  onDamage: (strength) => {
    damageVignette.style.opacity = String(Math.min(0.9, strength));
    window.clearTimeout(damageTimer);
    damageTimer = window.setTimeout(() => { damageVignette.style.opacity = '0'; }, 160);
  },
  onNetworkState: (state) => network.sendPlayer(state),
  onBattleEvent: (type, value) => network.sendBattleEvent(type, value),
}, currentLevel);
game.setHero(heroProgress.selectedHeroId);
game.setVolume(settings.volume);
game.setQuality(settings.quality);
if (import.meta.env.DEV) Object.assign(window, { __smiteGame: game, __smiteLevel: currentLevel, __smiteCampaign: campaign });

renderLevelUi();
renderLevelCards();
renderHeroSelect();
if (new URLSearchParams(location.search).get('briefing') === '1') showBriefing();

const minimumLoadingTime = new Promise<void>((resolve) => window.setTimeout(resolve, 700));
void preloadKnightAssets();
void minimumLoadingTime.finally(() => loading.classList.add('ready'));

element<HTMLButtonElement>('#play-solo').addEventListener('click', () => {
  multiplayer = false;
  void game.audio.start();
  const campaignLevel = nextCampaignLevel(campaign);
  if (campaignLevel === currentLevel.id) showBriefing();
  else navigateToLevel(campaignLevel);
});

element<HTMLButtonElement>('#open-maps').addEventListener('click', () => showMapSelect(landing));
element('[data-close="maps"]').addEventListener('click', () => closeMapSelect());

element<HTMLButtonElement>('#open-multiplayer').addEventListener('click', () => {
  multiplayer = true;
  landing.classList.remove('active');
  lobby.classList.add('active');
});

element('[data-close="lobby"]').addEventListener('click', () => {
  lobby.classList.remove('active');
  landing.classList.add('active');
});

element<HTMLButtonElement>('#create-room').addEventListener('click', async () => {
  lobbyStatus.textContent = 'Создаём боевой отряд…';
  try {
    const result = await network.createRoom(element<HTMLInputElement>('#player-name').value);
    if (!result.ok) throw new Error(result.error);
    activateRoom(result.room.code);
    void game.audio.start();
    showBriefing();
  } catch (error) {
    lobbyStatus.textContent = error instanceof Error ? error.message : 'Не удалось создать комнату';
  }
});

element<HTMLButtonElement>('#join-room').addEventListener('click', async () => {
  lobbyStatus.textContent = 'Ищем комнату…';
  try {
    const result = await network.joinRoom(element<HTMLInputElement>('#player-name').value, element<HTMLInputElement>('#room-code').value);
    if (!result.ok) throw new Error(result.error);
    activateRoom(result.room.code);
    void game.audio.start();
    showBriefing();
  } catch (error) {
    lobbyStatus.textContent = error instanceof Error ? error.message : 'Не удалось войти';
  }
});

element<HTMLButtonElement>('#deploy').addEventListener('click', () => {
  briefing.classList.remove('active');
  highlightedHeroId = heroProgress.selectedHeroId;
  renderHeroSelect();
  heroSelect.classList.add('active');
});

element<HTMLButtonElement>('#hero-select-back').addEventListener('click', () => {
  heroSelect.classList.remove('active');
  briefing.classList.add('active');
});

element<HTMLButtonElement>('#hero-deploy').addEventListener('click', () => {
  if (!heroProgress.unlockedHeroIds.includes(highlightedHeroId)) return;
  heroProgress = selectHero(heroProgress, highlightedHeroId);
  saveHeroProgress(heroProgress);
  game.setHero(heroProgress.selectedHeroId);
  heroSelect.classList.remove('active');
  hud.classList.remove('hidden');
  if (multiplayer) {
    roomBadge.classList.remove('hidden');
    chatToggle.classList.remove('hidden');
  }
  mobileControls.classList.add('game-active');
  game.start();
});

element<HTMLButtonElement>('#settings-toggle').addEventListener('click', () => {
  game.pause();
  showPause();
});
element<HTMLButtonElement>('#resume').addEventListener('click', () => {
  pause.classList.remove('active');
  game.resume();
});
element<HTMLButtonElement>('#restart').addEventListener('click', () => {
  pause.classList.remove('active');
  ending.classList.remove('active');
  hud.classList.remove('hidden');
  game.restart();
});
element<HTMLButtonElement>('#pause-map-select').addEventListener('click', () => showMapSelect(pause));
element<HTMLButtonElement>('#play-again').addEventListener('click', () => {
  ending.classList.remove('active');
  hud.classList.remove('hidden');
  game.restart();
});
element<HTMLButtonElement>('#next-level').addEventListener('click', () => {
  const next = getNextLevel(currentLevel);
  if (next) navigateToLevel(next.id);
});
element<HTMLButtonElement>('#ending-map-select').addEventListener('click', () => showMapSelect(ending));
volumeInput.addEventListener('input', () => {
  settings = { ...settings, volume: Number(volumeInput.value) / 100 };
  game.setVolume(settings.volume);
  saveGameSettings(settings);
});
qualitySelect.addEventListener('change', () => {
  settings = { ...settings, quality: qualitySelect.value as typeof settings.quality };
  game.setQuality(settings.quality);
  saveGameSettings(settings);
});

chatToggle.addEventListener('click', () => {
  chat.classList.toggle('hidden');
  if (!chat.classList.contains('hidden')) element<HTMLInputElement>('#chat-input').focus();
});
element<HTMLFormElement>('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = element<HTMLInputElement>('#chat-input');
  const message = input.value.trim();
  if (message) network.sendChat(message);
  input.value = '';
  canvas.focus();
});
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'KeyB' && !event.repeat) {
    event.preventDefault();
    if (shop.classList.contains('active')) closeShop();
    else openShop();
    return;
  }
  if (event.code === 'KeyH' && !event.repeat) {
    event.preventDefault();
    usePotion();
    return;
  }
  if (event.code === 'Escape' && shop.classList.contains('active')) {
    event.preventDefault();
    closeShop();
    return;
  }
  if (event.code === 'Enter' && multiplayer && !pause.classList.contains('active')) {
    const input = element<HTMLInputElement>('#chat-input');
    if (document.activeElement === input) return;
    event.preventDefault();
    chat.classList.remove('hidden');
    input.focus();
  }
});

const joystick = element('#joystick');
const joystickKnob = element('#joystick i');
let joystickPointer: number | undefined;
joystick.addEventListener('pointerdown', (event) => {
  joystickPointer = event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  updateJoystick(event);
});
joystick.addEventListener('pointermove', (event) => { if (event.pointerId === joystickPointer) updateJoystick(event); });
const releaseJoystick = (event: PointerEvent): void => {
  if (event.pointerId !== joystickPointer) return;
  joystickPointer = undefined;
  joystickKnob.style.transform = '';
  game.setJoystick(0, 0);
};
joystick.addEventListener('pointerup', releaseJoystick);
joystick.addEventListener('pointercancel', releaseJoystick);
joystick.addEventListener('lostpointercapture', releaseJoystick);

bindHoldControl('#mobile-attack', (held) => game.setAttackHeld(held));
bindHoldControl('#mobile-block', (held) => game.setBlock(held));
bindHoldControl('#mobile-sprint', (held) => game.setSprint(held));
bindHoldControl('#mobile-interact', (held) => game.setInteract(held));
element('#mobile-dodge').addEventListener('pointerdown', (event) => { event.preventDefault(); game.dodge(); });
element('#mobile-shop').addEventListener('pointerdown', (event) => { event.preventDefault(); openShop(); });
element('#mobile-potion').addEventListener('pointerdown', (event) => { event.preventDefault(); usePotion(); });
element('#mobile-ability').addEventListener('pointerdown', (event) => { event.preventDefault(); game.useHeroAbility('ability'); });
element('#mobile-ultimate').addEventListener('pointerdown', (event) => { event.preventDefault(); game.useHeroAbility('ultimate'); });
element('#mobile-camera').addEventListener('pointerdown', (event) => { event.preventDefault(); game.switchCameraShoulder(); });
element('#shop-toggle').addEventListener('click', () => openShop());
element('#potion-quick').addEventListener('click', () => usePotion());
element('#ability-toggle').addEventListener('click', () => game.useHeroAbility('ability'));
element('#ultimate-toggle').addEventListener('click', () => game.useHeroAbility('ultimate'));
element('#shop-close').addEventListener('click', () => closeShop());

const mobileLook = element('#mobile-look');
let lookPointer: number | undefined;
let lookX = 0;
let lookY = 0;
mobileLook.addEventListener('pointerdown', (event) => {
  if (!game.isRunning()) return;
  event.preventDefault();
  lookPointer = event.pointerId;
  lookX = event.clientX;
  lookY = event.clientY;
  mobileLook.setPointerCapture(event.pointerId);
  mobileLook.classList.add('active');
});
mobileLook.addEventListener('pointermove', (event) => {
  if (event.pointerId !== lookPointer) return;
  event.preventDefault();
  const camera = mobileCameraDrag(event.clientX - lookX, event.clientY - lookY);
  game.rotateCamera(camera.yawDelta, camera.pitchDelta);
  lookX = event.clientX;
  lookY = event.clientY;
});
const releaseMobileLook = (event: PointerEvent): void => {
  if (event.pointerId !== lookPointer) return;
  lookPointer = undefined;
  mobileLook.classList.remove('active');
};
mobileLook.addEventListener('pointerup', releaseMobileLook);
mobileLook.addEventListener('pointercancel', releaseMobileLook);
mobileLook.addEventListener('lostpointercapture', releaseMobileLook);

function updateJoystick(event: PointerEvent): void {
  const bounds = joystick.getBoundingClientRect();
  const normalized = normalizeMobileJoystick(event.clientX, event.clientY, bounds);
  joystickKnob.style.transform = `translate(${normalized.x * 34}px, ${normalized.y * 34}px)`;
  game.setJoystick(normalized.x, normalized.y);
}

function bindHoldControl(selector: string, onChange: (held: boolean) => void): void {
  const button = element<HTMLButtonElement>(selector);
  let pointerId: number | undefined;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    pointerId = event.pointerId;
    button.setPointerCapture(event.pointerId);
    button.classList.add('pressed');
    onChange(true);
  });
  const release = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;
    button.classList.remove('pressed');
    onChange(false);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

function showBriefing(): void {
  landing.classList.remove('active');
  lobby.classList.remove('active');
  mapSelect.classList.remove('active');
  heroSelect.classList.remove('active');
  briefing.classList.add('active');
}

function renderHeroSelect(): void {
  element('#hero-crowns').textContent = String(heroProgress.crowns);
  const cards = HEROES.map((hero) => {
    const unlocked = heroProgress.unlockedHeroIds.includes(hero.id);
    const selected = highlightedHeroId === hero.id;
    const card = document.createElement('article');
    card.className = `hero-card${selected ? ' selected' : ''}${unlocked ? ' unlocked' : ' locked'}`;
    card.style.setProperty('--hero-color', colorHex(hero.accent));
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${hero.name}, ${hero.className}${unlocked ? '' : `, открыть за ${hero.unlockCost} корон`}`);

    const top = document.createElement('div');
    top.className = 'hero-card-top';
    const icon = document.createElement('span');
    icon.textContent = hero.icon;
    const heading = document.createElement('div');
    const className = document.createElement('small');
    className.textContent = hero.className;
    const name = document.createElement('h3');
    name.textContent = hero.name;
    heading.append(className, name);
    top.append(icon, heading);

    const description = document.createElement('p');
    description.textContent = hero.description;
    const mastery = document.createElement('div');
    mastery.className = 'hero-card-mastery';
    mastery.textContent = `МАСТЕРСТВО ${masteryLevel(heroProgress.masteryXp[hero.id] ?? 0)}`;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'hero-unlock';
    action.disabled = unlocked;
    action.textContent = unlocked ? selected ? 'ВЫБРАН' : 'ДОСТУПЕН' : `ОТКРЫТЬ · ${hero.unlockCost} 👑`;
    action.addEventListener('click', (event) => {
      event.stopPropagation();
      if (unlocked) return;
      const result = unlockHero(heroProgress, hero.id);
      heroProgress = result.progress;
      if (result.ok) highlightedHeroId = hero.id;
      saveHeroProgress(heroProgress);
      renderHeroSelect();
      const status = element('#hero-status');
      status.textContent = result.message;
      status.className = `hero-status ${result.ok ? 'success' : 'error'}`;
    });
    card.append(top, description, mastery, action);

    const choose = (): void => {
      highlightedHeroId = hero.id;
      if (unlocked) {
        heroProgress = selectHero(heroProgress, hero.id);
        saveHeroProgress(heroProgress);
      }
      renderHeroSelect();
    };
    card.addEventListener('click', choose);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });
    return card;
  });
  element('#hero-grid').replaceChildren(...cards);

  const hero = getHero(highlightedHeroId);
  const unlocked = heroProgress.unlockedHeroIds.includes(hero.id);
  const stats = [
    ['ЗДОРОВЬЕ', signed(hero.stats.maxHealth)],
    ['УРОН', signed(hero.stats.attackDamage)],
    ['СКОРОСТЬ', signed(hero.stats.moveSpeed, 2)],
    ['ЗАЩИТА', `${Math.round(hero.stats.damageReduction * 100)}%`],
    ['ВАМПИРИЗМ', `${Math.round(hero.stats.lifesteal * 100)}%`],
    ['РЕГЕНЕРАЦИЯ', signed(hero.stats.healthRegen, 1)],
  ];
  const masteryXp = heroProgress.masteryXp[hero.id] ?? 0;
  element('#hero-detail').innerHTML = `
    <div class="hero-detail-portrait" style="--hero-color:${colorHex(hero.accent)}"><span>${hero.icon}</span><small>${hero.className}</small><h3>${hero.name}</h3><p>${hero.title}</p></div>
    <p class="hero-passive"><b>ПАССИВНОЕ</b>${hero.passive}</p>
    <div class="hero-stats">${stats.map(([label, value]) => `<span>${label}<b>${value}</b></span>`).join('')}</div>
    <div class="hero-skill"><span>${hero.ability.icon}</span><div><small>Q · ${hero.ability.cooldown} СЕК</small><b>${hero.ability.name}</b><p>${hero.ability.description}</p></div></div>
    <div class="hero-skill ultimate"><span>${hero.ultimate.icon}</span><div><small>R · УЛЬТИМЕЙТ · ${hero.ultimate.cooldown} СЕК</small><b>${hero.ultimate.name}</b><p>${hero.ultimate.description}</p></div></div>
    <div class="hero-mastery">МАСТЕРСТВО <b>${masteryLevel(masteryXp)}</b><span>${masteryXp} XP</span></div>`;
  const deploy = element<HTMLButtonElement>('#hero-deploy');
  deploy.disabled = !unlocked;
  element('#hero-deploy-name').textContent = unlocked ? `${hero.name} · ${hero.className}` : `Нужно открыть за ${hero.unlockCost} корон`;
  element('#hero-status').className = 'hero-status';
  element('#hero-status').textContent = unlocked
    ? `${hero.name} готов к бою. Умение доступно сразу, ультимейт — с 3 уровня матча.`
    : `${hero.name} пока закрыт. Заработайте ${hero.unlockCost} корон в боях или откройте сейчас.`;
}

function signed(value: number, precision = 0): string {
  if (value === 0) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(precision)}`;
}

function awardHeroProgress(heroId: HeroId, victory: boolean, kills: number, damage: number): HeroReward {
  const reward = calculateHeroReward(victory, kills, damage);
  heroProgress = grantHeroReward(heroProgress, heroId, reward);
  saveHeroProgress(heroProgress);
  renderHeroSelect();
  return reward;
}

function showPause(): void { pause.classList.add('active'); }

function activateRoom(code: string): void {
  element('#active-room-code').textContent = code;
  lobbyStatus.textContent = '';
}

let mapReturnScreen: HTMLElement = landing;

function showMapSelect(returnScreen: HTMLElement): void {
  mapReturnScreen = returnScreen;
  returnScreen.classList.remove('active');
  renderLevelCards();
  mapSelect.classList.add('active');
}

function closeMapSelect(): void {
  mapSelect.classList.remove('active');
  mapReturnScreen.classList.add('active');
}

function navigateToLevel(levelId: LevelId): void {
  campaign = { ...campaign, selected: levelId };
  saveCampaignProgress(campaign);
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('level', levelId);
  url.searchParams.set('briefing', '1');
  location.assign(url);
}

function renderLevelUi(): void {
  document.title = `SMITE KNIGHT — ${currentLevel.title}`;
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', `${currentLevel.title}: ${currentLevel.cardLine}`);
  document.documentElement.style.setProperty('--ember', colorHex(currentLevel.theme.accent));
  element('.subtitle').textContent = 'FIVE CROWNS';
  element('.pitch').innerHTML = 'Пять крепостей и две Великие войны.<br />Проходи кампанию подряд или выбирай любой фронт.';
  element('#campaign-continue').textContent = `${campaign.completed.length}/5 завершено · продолжить: ${getLevel(nextCampaignLevel(campaign)).title}`;
  element('#mission-number').textContent = currentLevel.operation;
  element('#briefing-title').textContent = currentLevel.title;
  element('#briefing-copy').textContent = currentLevel.briefing;
  element('#deploy span').textContent = currentLevel.citadelLayout === 'open-front'
    ? 'Открытое поле ждёт командира'
    : currentLevel.mode === 'citadel-war' ? 'Шесть фронтов ждут командира' : 'Пусть пепел запомнит имя';
  const objectives = element('#mission-objectives');
  objectives.replaceChildren(...currentLevel.objectives.map((objective, index) => {
    const item = document.createElement('div');
    const number = document.createElement('span');
    const copy = document.createElement('p');
    const title = document.createElement('b');
    number.textContent = String(index + 1).padStart(2, '0');
    title.textContent = objective.title;
    copy.append(title, document.createTextNode(objective.text));
    item.append(number, copy);
    return item;
  }));
}

function renderLevelCards(): void {
  const grid = element('#level-grid');
  grid.replaceChildren(...LEVELS.map((level) => createLevelCard(level)));
}

function createLevelCard(level: LevelDefinition): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'level-card';
  card.style.setProperty('--level-accent', colorHex(level.theme.accent));
  card.setAttribute('aria-label', `Играть: ${level.title}`);
  const operation = document.createElement('small');
  operation.textContent = level.operation;
  const title = document.createElement('h3');
  title.textContent = level.title;
  const copy = document.createElement('p');
  copy.textContent = level.cardLine;
  const boss = document.createElement('span');
  boss.className = 'boss-line';
  boss.textContent = level.citadelLayout === 'open-front'
    ? 'Без дорог · свободное движение · живая линия фронта'
    : level.mode === 'citadel-war'
      ? '6 троп · волны пехоты, стрелков и тяжёлых бойцов'
    : `${level.boss.title} · ${level.boss.name}`;
  const completion = document.createElement('span');
  completion.className = 'completion';
  completion.textContent = level.id === currentLevel.id
    ? 'Выбрано'
    : level.mode === 'citadel-war'
      ? 'Большая битва'
      : campaign.completed.includes(level.id) ? 'Пройдено' : 'Играть';
  card.append(operation, title, copy, boss, completion);
  card.addEventListener('click', () => navigateToLevel(level.id));
  return card;
}

function colorHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function updateHud(state: HudState): void {
  const hero = getHero(state.heroId);
  const heroColor = colorHex(state.heroAccent);
  element<HTMLElement>('.bars').style.setProperty('--hero-color', heroColor);
  element<HTMLElement>('#ability-bar').style.setProperty('--hero-color', heroColor);
  element('#combat-hero-icon').textContent = state.heroIcon;
  element('#combat-hero-name').textContent = state.heroName;
  element('#match-level').textContent = String(state.matchLevel);
  element('#hero-xp-fill').style.width = `${state.matchXpNext > 0 ? state.matchXp / state.matchXpNext * 100 : 100}%`;
  element('#hero-xp-text').textContent = state.matchLevel >= 20 ? 'МАКС. УРОВЕНЬ' : `${state.matchXp} / ${state.matchXpNext} XP`;
  element('#health-fill').style.width = `${state.health / state.maxHealth * 100}%`;
  element('#health-text').textContent = String(Math.ceil(state.health));
  element('#stamina-fill').style.width = `${state.stamina}%`;
  element('#phase-label').textContent = `ФАЗА ${currentLevel.phaseNames[state.phase] ?? currentLevel.phaseNames[3]}`;
  element('#objective').textContent = state.objective;
  element('#objective-fill').style.width = `${state.progress}%`;
  element('#ally-count').textContent = String(state.allies);
  element('#enemy-count').textContent = String(state.enemies);
  element('#gold-count').textContent = String(state.gold);
  element('#gold-rate').textContent = String(state.goldPerSecond);
  element('#potion-count').textContent = String(inventoryItemCount(state.inventory, 'healing-potion'));
  element('#ability-icon').textContent = state.abilityIcon;
  element('#ability-name').textContent = state.abilityName;
  element('#ability-state').textContent = state.abilityCooldown > 0 ? `${Math.ceil(state.abilityCooldown)} СЕК` : 'ГОТОВО';
  element('#ability-cooldown-fill').style.width = `${state.abilityCooldown / hero.ability.cooldown * 100}%`;
  element('#ability-toggle').classList.toggle('cooldown', state.abilityCooldown > 0);
  element('#ultimate-icon').textContent = state.ultimateIcon;
  element('#ultimate-name').textContent = state.ultimateName;
  element('#ultimate-state').textContent = !state.ultimateUnlocked ? 'ОТКРОЕТСЯ НА УРОВНЕ 3' : state.ultimateCooldown > 0 ? `${Math.ceil(state.ultimateCooldown)} СЕК` : 'ГОТОВО';
  element('#ultimate-cooldown-fill').style.width = `${state.ultimateCooldown / hero.ultimate.cooldown * 100}%`;
  element('#ultimate-toggle').classList.toggle('locked', !state.ultimateUnlocked);
  element('#ultimate-toggle').classList.toggle('cooldown', state.ultimateCooldown > 0);
  element('#mobile-ability').textContent = `${state.abilityIcon} Q`;
  element('#mobile-ultimate').textContent = `${state.ultimateIcon} R`;
  element('#mobile-ultimate').classList.toggle('locked', !state.ultimateUnlocked);
  renderInventory(state.inventory);
  const signatureItem = state.inventory.find((slot) => getShopItem(slot.itemId).tier === 'unique');
  element('#weapon-name').textContent = signatureItem ? getShopItem(signatureItem.itemId).name : 'Меч пепла';
  const bonuses = [
    state.itemStats.attackDamage ? `+${state.itemStats.attackDamage} урон` : '',
    state.itemStats.maxHealth ? `+${state.itemStats.maxHealth} здоровье` : '',
    state.itemStats.moveSpeed ? `+${state.itemStats.moveSpeed.toFixed(2)} скорость` : '',
    state.itemStats.damageReduction ? `${Math.round(state.itemStats.damageReduction * 100)}% защита` : '',
    state.itemStats.lifesteal ? `${Math.round(state.itemStats.lifesteal * 100)}% вампиризм` : '',
    state.itemStats.healthRegen ? `+${state.itemStats.healthRegen.toFixed(1)} регенерация` : '',
  ].filter(Boolean);
  element('#weapon-hint').textContent = bonuses.length ? bonuses.join(' · ') : 'Удерживайте ЛКМ — серия атак · ПКМ — блок';
  const citadelScore = element('#citadel-score');
  const isCitadelWar = state.allyCitadelHealth !== undefined && state.enemyCitadelHealth !== undefined;
  citadelScore.classList.toggle('hidden', !isCitadelWar);
  if (isCitadelWar) {
    const maximum = currentLevel.boss.health;
    element('#ally-citadel-health').textContent = String(Math.ceil(state.allyCitadelHealth ?? maximum));
    element('#enemy-citadel-health').textContent = String(Math.ceil(state.enemyCitadelHealth ?? maximum));
    element<HTMLElement>('#ally-citadel-fill').style.width = `${(state.allyCitadelHealth ?? maximum) / maximum * 100}%`;
    element<HTMLElement>('#enemy-citadel-fill').style.width = `${(state.enemyCitadelHealth ?? maximum) / maximum * 100}%`;
    element('#citadel-wave').textContent = `ВОЛНА ${state.citadelWave ?? 1}`;
  }
  interaction.classList.toggle('hidden', !state.interaction);
  element('#mobile-interact').classList.toggle('hidden', !state.interaction);
}

function renderInventory(inventory: readonly InventorySlot[]): void {
  const signature = inventory.map((slot) => `${slot.itemId}:${slot.quantity}`).join('|');
  if (signature === inventorySignature) return;
  inventorySignature = signature;
  const slots = Array.from({ length: INVENTORY_CAPACITY }, (_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-slot';
    const slot = inventory[index];
    if (!slot) {
      button.classList.add('empty');
      button.disabled = true;
      button.setAttribute('aria-label', `Пустой слот ${index + 1}`);
      return button;
    }
    const item = getShopItem(slot.itemId);
    button.classList.add(item.tier);
    button.textContent = item.icon;
    button.title = `${item.name}: ${item.description}`;
    button.setAttribute('aria-label', `${item.name}, ${slot.quantity}`);
    if (slot.quantity > 1) {
      const quantity = document.createElement('em');
      quantity.textContent = String(slot.quantity);
      button.append(quantity);
    }
    if (slot.itemId === 'healing-potion') button.addEventListener('click', () => usePotion());
    return button;
  });
  element('#inventory-bar').replaceChildren(...slots);
}

function openShop(): void {
  if (!game.isRunning() || hud.classList.contains('hidden')) return;
  game.pause();
  renderShop();
  element('#shop-status').className = 'shop-status';
  element('#shop-status').textContent = 'Обычные предметы занимают слот. При сборке уникального предмета его компоненты исчезнут.';
  shop.classList.add('active');
}

function closeShop(): void {
  if (!shop.classList.contains('active')) return;
  shop.classList.remove('active');
  game.resume();
}

function usePotion(): void {
  const result = game.useHealingPotion();
  if (shop.classList.contains('active')) {
    setShopStatus(result.message, result.ok);
    renderShop();
  }
}

function renderShop(): void {
  const state = game.getEconomyState();
  element('#shop-gold').textContent = String(state.gold);
  element('#shop-slots').textContent = `${state.inventory.length}/${INVENTORY_CAPACITY}`;
  const common = SHOP_ITEMS.filter((item) => item.tier !== 'unique').map((item) => createShopCard(item, state));
  const unique = SHOP_ITEMS.filter((item) => item.tier === 'unique').map((item) => createShopCard(item, state));
  element('#shop-common').replaceChildren(...common);
  element('#shop-unique').replaceChildren(...unique);
}

function createShopCard(item: ShopItem, state: EconomyState): HTMLElement {
  const card = document.createElement('article');
  card.className = `shop-item ${item.tier}`;
  card.dataset.itemId = item.id;
  const icon = document.createElement('span');
  icon.className = 'shop-item-icon';
  icon.textContent = item.icon;
  const title = document.createElement('h3');
  title.textContent = item.name;
  const description = document.createElement('p');
  description.textContent = item.description;
  const recipe = document.createElement('div');
  recipe.className = 'shop-recipe';
  if (item.recipe) {
    recipe.textContent = `Нужно: ${item.recipe.map((id) => `${getShopItem(id).icon} ${getShopItem(id).name}`).join(' + ')} · полная цена ${totalItemCost(item)}`;
  } else {
    recipe.textContent = item.tier === 'consumable' ? 'Расходуемый предмет' : 'Компонент для уникальных сборок';
  }
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'shop-buy';
  buy.textContent = `${item.recipe ? 'СОБРАТЬ' : 'КУПИТЬ'} · ${item.cost} 🜚`;
  const preview = previewPurchase(state, item.id);
  buy.disabled = !preview.ok;
  buy.title = preview.ok ? `${item.recipe ? 'Собрать' : 'Купить'} ${item.name}` : preview.message;
  buy.addEventListener('click', () => {
    const result = game.purchaseItem(item.id);
    setShopStatus(result.message, result.ok);
    renderShop();
  });
  card.append(icon, title, description, recipe, buy);
  return card;
}

function setShopStatus(message: string, success: boolean): void {
  const status = element('#shop-status');
  status.textContent = message;
  status.className = `shop-status ${success ? 'success' : 'error'}`;
}

function addFeed(message: string): void {
  const line = document.createElement('div');
  line.className = 'feed-line';
  line.innerHTML = message;
  killFeed.prepend(line);
  window.setTimeout(() => line.remove(), 4600);
}

function addChatLine(name: string, message: string): void {
  const line = document.createElement('div');
  line.className = 'chat-line';
  const author = document.createElement('b');
  author.textContent = `${name}: `;
  line.append(author, document.createTextNode(message));
  chatMessages.append(line);
  while (chatMessages.childElementCount > 8) chatMessages.firstElementChild?.remove();
  chat.classList.remove('hidden');
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
