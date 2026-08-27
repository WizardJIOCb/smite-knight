export type Team = 'allies' | 'enemies';

export interface NetworkPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  health: number;
  action: 'idle' | 'run' | 'attack' | 'block' | 'dead';
}

export interface RoomSnapshot {
  code: string;
  players: NetworkPlayer[];
  phase: number;
  gateHealth: number;
  createdAt: number;
}

export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, reply: (result: RoomReply) => void) => void;
  'room:join': (payload: { name: string; code: string }, reply: (result: RoomReply) => void) => void;
  'player:update': (payload: Omit<NetworkPlayer, 'id' | 'name'>) => void;
  'battle:event': (payload: { type: 'gate-hit' | 'phase'; value: number }) => void;
  'chat:send': (payload: { message: string }) => void;
}

export interface ServerToClientEvents {
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'player:joined': (player: NetworkPlayer) => void;
  'player:left': (id: string) => void;
  'player:update': (player: NetworkPlayer) => void;
  'battle:event': (payload: { type: 'gate-hit' | 'phase'; value: number }) => void;
  'chat:message': (payload: { id: string; name: string; message: string; at: number }) => void;
}

export type RoomReply =
  | { ok: true; room: RoomSnapshot; playerId: string }
  | { ok: false; error: string };
