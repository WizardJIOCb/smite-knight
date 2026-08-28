import type { NetworkPlayer, RoomSnapshot } from '../shared/protocol.js';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;

export interface ServerRoom {
  code: string;
  players: Map<string, NetworkPlayer>;
  phase: number;
  gateHealth: number;
  createdAt: number;
}

export function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return 'Рыцарь';
  const clean = value.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20);
  return clean || 'Рыцарь';
}

export function sanitizeChat(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function normalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6) : '';
}

export function createRoomCode(existing: Set<string>, random = Math.random): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error('Не удалось создать уникальный код комнаты');
}

export function createPlayer(id: string, name: string, index: number): NetworkPlayer {
  return {
    id,
    name: sanitizeName(name),
    x: (index % 3 - 1) * 2.4,
    y: 0,
    z: 29 + Math.floor(index / 3) * 2.2,
    rotation: Math.PI,
    health: 180,
    action: 'idle',
  };
}

export function canJoin(room: ServerRoom): boolean {
  return room.players.size < MAX_PLAYERS;
}

export function snapshotRoom(room: ServerRoom): RoomSnapshot {
  return {
    code: room.code,
    players: [...room.players.values()],
    phase: room.phase,
    gateHealth: room.gateHealth,
    createdAt: room.createdAt,
  };
}

export function safePlayerUpdate(previous: NetworkPlayer, payload: Partial<NetworkPlayer>): NetworkPlayer {
  const clamp = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const actions: NetworkPlayer['action'][] = ['idle', 'run', 'jump', 'attack', 'block', 'dead'];
  return {
    ...previous,
    x: clamp(payload.x, -44, 44, previous.x),
    y: clamp(payload.y, -2, 12, previous.y),
    z: clamp(payload.z, -76, 44, previous.z),
    rotation: clamp(payload.rotation, -Math.PI * 4, Math.PI * 4, previous.rotation),
    health: clamp(payload.health, 0, 180, previous.health),
    action: actions.includes(payload.action as NetworkPlayer['action']) ? payload.action as NetworkPlayer['action'] : previous.action,
  };
}
