import './style.css';
import { SiegeGame, type HudState } from './game/game';
import { preloadKnightAssets } from './game/models';
import { NetworkClient } from './network';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing UI element: ${selector}`);
  return found;
}

const canvas = element<HTMLCanvasElement>('#game');
const landing = element('#landing');
const lobby = element('#lobby');
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
let multiplayer = false;
let damageTimer = 0;

const network = new NetworkClient({
  onSnapshot: (players, localId) => game.syncRemotePlayers(players, localId),
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
    hud.classList.add('hidden');
    mobileControls.classList.remove('game-active');
    element('#ending-stats').innerHTML = `Врагов повержено: <b>${stats.kills}</b><br>Нанесено урона: <b>${Math.round(stats.damage)}</b><br>Время штурма: <b>${formatTime(stats.duration)}</b>`;
    ending.classList.add('active');
  },
  onDamage: (strength) => {
    damageVignette.style.opacity = String(Math.min(0.9, strength));
    window.clearTimeout(damageTimer);
    damageTimer = window.setTimeout(() => { damageVignette.style.opacity = '0'; }, 160);
  },
  onNetworkState: (state) => network.sendPlayer(state),
  onBattleEvent: (type, value) => network.sendBattleEvent(type, value),
});

const minimumLoadingTime = new Promise<void>((resolve) => window.setTimeout(resolve, 700));
void Promise.all([preloadKnightAssets(), minimumLoadingTime]).finally(() => loading.classList.add('ready'));

element<HTMLButtonElement>('#play-solo').addEventListener('click', () => {
  multiplayer = false;
  void game.audio.start();
  showBriefing();
});

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
element<HTMLButtonElement>('#play-again').addEventListener('click', () => {
  ending.classList.remove('active');
  hud.classList.remove('hidden');
  game.restart();
});
element<HTMLInputElement>('#volume').addEventListener('input', (event) => {
  game.setVolume(Number((event.currentTarget as HTMLInputElement).value) / 100);
});
element<HTMLSelectElement>('#quality').addEventListener('change', (event) => {
  game.setQuality((event.currentTarget as HTMLSelectElement).value as 'high' | 'medium' | 'low');
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
  briefing.classList.add('active');
}

function showPause(): void { pause.classList.add('active'); }

function activateRoom(code: string): void {
  element('#active-room-code').textContent = code;
  lobbyStatus.textContent = '';
}

function updateHud(state: HudState): void {
  element('#health-fill').style.width = `${state.health / state.maxHealth * 100}%`;
  element('#health-text').textContent = String(Math.ceil(state.health));
  element('#stamina-fill').style.width = `${state.stamina}%`;
  element('#phase-label').textContent = `ФАЗА ${['I · ПОДЪЁМ', 'II · ПРОЛОМ', 'III · ДВОР'][state.phase] ?? 'III · ДВОР'}`;
  element('#objective').textContent = state.objective;
  element('#objective-fill').style.width = `${state.progress}%`;
  element('#ally-count').textContent = String(state.allies);
  element('#enemy-count').textContent = String(state.enemies);
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
