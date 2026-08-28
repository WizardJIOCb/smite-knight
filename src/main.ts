import './style.css';
import { completeCampaignLevel, loadCampaignProgress, nextCampaignLevel, saveCampaignProgress } from './campaign';
import { SiegeGame, type HudState } from './game/game';
import { LEVELS, getLevel, getNextLevel, type LevelDefinition, type LevelId } from './game/levels';
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
const pause = element('#pause');
const ending = element('#ending');
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
volumeInput.value = String(Math.round(settings.volume * 100));
qualitySelect.value = settings.quality;
let multiplayer = false;
let damageTimer = 0;

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
    campaign = completeCampaignLevel(campaign, currentLevel.id);
    saveCampaignProgress(campaign);
    renderLevelCards();
    hud.classList.add('hidden');
    mobileControls.classList.remove('game-active');
    element('#ending-eyebrow').textContent = currentLevel.endingEyebrow;
    element('#ending-title').textContent = currentLevel.endingTitle;
    element('#ending-stats').innerHTML = `Врагов повержено: <b>${stats.kills}</b><br>Нанесено урона: <b>${Math.round(stats.damage)}</b><br>Время штурма: <b>${formatTime(stats.duration)}</b>`;
    const next = getNextLevel(currentLevel);
    const nextButton = element<HTMLButtonElement>('#next-level');
    nextButton.classList.toggle('hidden', !next);
    element('#next-level-name').textContent = next ? `${next.operation} · ${next.title}` : '';
    ending.classList.add('active');
  },
  onDefeat: (stats) => {
    hud.classList.add('hidden');
    mobileControls.classList.remove('game-active');
    element('#ending-eyebrow').textContent = 'НАША ЦИТАДЕЛЬ ПАЛА';
    element('#ending-title').textContent = 'Красный фронт прорвался';
    element('#ending-stats').innerHTML = `Врагов повержено: <b>${stats.kills}</b><br>Нанесено урона: <b>${Math.round(stats.damage)}</b><br>Время обороны: <b>${formatTime(stats.duration)}</b>`;
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
game.setVolume(settings.volume);
game.setQuality(settings.quality);
if (import.meta.env.DEV) Object.assign(window, { __smiteGame: game, __smiteLevel: currentLevel, __smiteCampaign: campaign });

renderLevelUi();
renderLevelCards();
if (new URLSearchParams(location.search).get('briefing') === '1') showBriefing();

const minimumLoadingTime = new Promise<void>((resolve) => window.setTimeout(resolve, 700));
void Promise.all([preloadKnightAssets(), minimumLoadingTime]).finally(() => loading.classList.add('ready'));

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
joystick.addEventListener('pointerup', (event) => {
  if (event.pointerId !== joystickPointer) return;
  joystickPointer = undefined;
  joystickKnob.style.transform = '';
  game.setJoystick(0, 0);
});
element('#mobile-attack').addEventListener('pointerdown', () => game.attack());
element('#mobile-block').addEventListener('pointerdown', () => game.setBlock(true));
element('#mobile-block').addEventListener('pointerup', () => game.setBlock(false));
element('#mobile-dodge').addEventListener('pointerdown', () => game.dodge());

function updateJoystick(event: PointerEvent): void {
  const bounds = joystick.getBoundingClientRect();
  const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left - bounds.width / 2) / (bounds.width * 0.35)));
  const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top - bounds.height / 2) / (bounds.height * 0.35)));
  const length = Math.hypot(x, y);
  const scale = length > 1 ? 1 / length : 1;
  const normalizedX = x * scale;
  const normalizedY = y * scale;
  joystickKnob.style.transform = `translate(${normalizedX * 28}px, ${normalizedY * 28}px)`;
  game.setJoystick(normalizedX, normalizedY);
}

function showBriefing(): void {
  landing.classList.remove('active');
  lobby.classList.remove('active');
  mapSelect.classList.remove('active');
  briefing.classList.add('active');
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
  element('#health-fill').style.width = `${state.health / state.maxHealth * 100}%`;
  element('#health-text').textContent = String(Math.ceil(state.health));
  element('#stamina-fill').style.width = `${state.stamina}%`;
  element('#phase-label').textContent = `ФАЗА ${currentLevel.phaseNames[state.phase] ?? currentLevel.phaseNames[3]}`;
  element('#objective').textContent = state.objective;
  element('#objective-fill').style.width = `${state.progress}%`;
  element('#ally-count').textContent = String(state.allies);
  element('#enemy-count').textContent = String(state.enemies);
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
