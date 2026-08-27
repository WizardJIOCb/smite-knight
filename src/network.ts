import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, NetworkPlayer, RoomReply, ServerToClientEvents } from '../shared/protocol';

export interface NetworkCallbacks {
  onSnapshot: (players: NetworkPlayer[], localId: string) => void;
  onPlayerUpdate: (player: NetworkPlayer) => void;
  onPlayerLeft: (id: string) => void;
  onBattleEvent: (type: 'gate-hit' | 'phase', value: number) => void;
  onChat: (payload: { name: string; message: string }) => void;
  onCount: (count: number) => void;
}

export class NetworkClient {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private readonly callbacks: NetworkCallbacks;
  private playerIds = new Set<string>();
  roomCode?: string;
  localId?: string;

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
    this.socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });
    this.socket.on('room:snapshot', (snapshot) => this.applySnapshot(snapshot.players));
    this.socket.on('player:joined', (player) => {
      this.playerIds.add(player.id);
      this.callbacks.onPlayerUpdate(player);
      this.callbacks.onCount(this.playerIds.size);
    });
    this.socket.on('player:left', (id) => {
      this.playerIds.delete(id);
      this.callbacks.onPlayerLeft(id);
      this.callbacks.onCount(this.playerIds.size);
    });
    this.socket.on('player:update', (player) => this.callbacks.onPlayerUpdate(player));
    this.socket.on('battle:event', ({ type, value }) => this.callbacks.onBattleEvent(type, value));
    this.socket.on('chat:message', (payload) => this.callbacks.onChat(payload));
  }

  async createRoom(name: string): Promise<RoomReply> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket.emit('room:create', { name }, (result) => {
        this.handleReply(result);
        resolve(result);
      });
    });
  }

  async joinRoom(name: string, code: string): Promise<RoomReply> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket.emit('room:join', { name, code }, (result) => {
        this.handleReply(result);
        resolve(result);
      });
    });
  }

  sendPlayer(state: Omit<NetworkPlayer, 'id' | 'name'>): void {
    if (this.roomCode) this.socket.emit('player:update', state);
  }

  sendBattleEvent(type: 'gate-hit' | 'phase', value: number): void {
    if (this.roomCode) this.socket.emit('battle:event', { type, value });
  }

  sendChat(message: string): void {
    if (this.roomCode) this.socket.emit('chat:send', { message });
  }

  private connect(): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    this.socket.connect();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Сервер не ответил')), 7000);
      this.socket.once('connect', () => {
        window.clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', () => {
        window.clearTimeout(timer);
        reject(new Error('Не удалось подключиться к игровому серверу'));
      });
    });
  }

  private handleReply(result: RoomReply): void {
    if (!result.ok) return;
    this.roomCode = result.room.code;
    this.localId = result.playerId;
    this.applySnapshot(result.room.players);
  }

  private applySnapshot(players: NetworkPlayer[]): void {
    this.playerIds = new Set(players.map((player) => player.id));
    if (this.localId) this.callbacks.onSnapshot(players, this.localId);
    this.callbacks.onCount(this.playerIds.size);
  }
}
