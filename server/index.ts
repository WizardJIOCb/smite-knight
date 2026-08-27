import express from 'express';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.js';
import {
  canJoin,
  createPlayer,
  createRoomCode,
  normalizeRoomCode,
  safePlayerUpdate,
  sanitizeChat,
  sanitizeName,
  snapshotRoom,
  type ServerRoom,
} from './room.js';

const app = express();
app.disable('x-powered-by');
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: true, credentials: false },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 16_384,
});

const rooms = new Map<string, ServerRoom>();
const socketRooms = new Map<string, string>();
const chatRate = new Map<string, number>();

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'smite-knight', rooms: rooms.size, players: socketRooms.size });
});

io.on('connection', (socket) => {
  socket.on('room:create', ({ name }, reply) => {
    leaveCurrentRoom(socket.id);
    const code = createRoomCode(new Set(rooms.keys()));
    const room: ServerRoom = { code, players: new Map(), phase: 0, gateHealth: 100, createdAt: Date.now() };
    const player = createPlayer(socket.id, sanitizeName(name), 0);
    room.players.set(socket.id, player);
    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    reply({ ok: true, room: snapshotRoom(room), playerId: socket.id });
  });

  socket.on('room:join', ({ name, code: rawCode }, reply) => {
    const code = normalizeRoomCode(rawCode);
    const room = rooms.get(code);
    if (!room) {
      reply({ ok: false, error: 'Комната не найдена' });
      return;
    }
    if (!canJoin(room)) {
      reply({ ok: false, error: 'В комнате уже восемь рыцарей' });
      return;
    }
    leaveCurrentRoom(socket.id);
    const player = createPlayer(socket.id, sanitizeName(name), room.players.size);
    room.players.set(socket.id, player);
    socketRooms.set(socket.id, code);
    void socket.join(code);
    socket.to(code).emit('player:joined', player);
    reply({ ok: true, room: snapshotRoom(room), playerId: socket.id });
  });

  socket.on('player:update', (payload) => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player) return;
    const next = safePlayerUpdate(player, payload);
    room.players.set(socket.id, next);
    socket.to(room.code).emit('player:update', next);
  });

  socket.on('battle:event', (payload) => {
    const room = getSocketRoom(socket.id);
    if (!room) return;
    if (payload.type === 'gate-hit') {
      const damage = Number.isFinite(payload.value) ? Math.min(8, Math.max(0, payload.value)) : 0;
      room.gateHealth = Math.max(0, room.gateHealth - damage);
      io.to(room.code).emit('battle:event', { type: 'gate-hit', value: room.gateHealth });
    } else if (payload.type === 'phase') {
      room.phase = Math.min(3, Math.max(room.phase, Math.floor(payload.value)));
      io.to(room.code).emit('battle:event', { type: 'phase', value: room.phase });
    }
  });

  socket.on('chat:send', ({ message }) => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    const clean = sanitizeChat(message);
    if (!room || !player || !clean) return;
    const now = Date.now();
    if (now - (chatRate.get(socket.id) ?? 0) < 500) return;
    chatRate.set(socket.id, now);
    io.to(room.code).emit('chat:message', { id: socket.id, name: player.name, message: clean, at: now });
  });

  socket.on('disconnect', () => leaveCurrentRoom(socket.id));
});

function getSocketRoom(socketId: string): ServerRoom | undefined {
  const code = socketRooms.get(socketId);
  return code ? rooms.get(code) : undefined;
}

function leaveCurrentRoom(socketId: string): void {
  const code = socketRooms.get(socketId);
  if (!code) return;
  const room = rooms.get(code);
  room?.players.delete(socketId);
  void io.sockets.sockets.get(socketId)?.leave(code);
  socketRooms.delete(socketId);
  chatRate.delete(socketId);
  io.to(code).emit('player:left', socketId);
  if (room?.players.size === 0) rooms.delete(code);
}

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../../dist');
app.use(express.static(publicDir, { maxAge: '1h', etag: true }));
app.get('*path', (_request, response) => response.sendFile(resolve(publicDir, 'index.html')));

const port = Number.parseInt(process.env.PORT ?? '3018', 10);
httpServer.listen(port, '127.0.0.1', () => {
  process.stdout.write(`SMITE KNIGHT listening on http://127.0.0.1:${port}\n`);
});

const shutdown = () => httpServer.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
