'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const GameRoom = require('./src/GameRoom');

const PORT = process.env.PORT || 3000;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1 ambiguity
const STALE_ROOM_SWEEP_MS = 5 * 60 * 1000;
const STALE_ROOM_MAX_AGE_MS = 30 * 60 * 1000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/** @type {Map<string, GameRoom>} */
const rooms = new Map();
/** socket.id -> { roomCode, playerId, isSpectator } */
const sessions = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function destroyRoomIfEmpty(code) {
  const room = rooms.get(code);
  if (room && room._isEmpty()) {
    room.destroy();
    rooms.delete(code);
  }
}

io.on('connection', (socket) => {
  function joinAsPlayerOrSpectator(room, code, playerId, name) {
    const result = room.addPlayer(playerId, name, socket);
    if (result.success) {
      sessions.set(socket.id, { roomCode: code, playerId, isSpectator: false });
      socket.emit('roomJoined', { roomCode: code, playerId, state: room.getPublicState() });
      room._broadcastState();
      return;
    }
    // Room full or in-progress — fall back to spectating so nobody hits a dead end.
    room.addSpectator(socket);
    sessions.set(socket.id, { roomCode: code, playerId, isSpectator: true });
    socket.emit('spectating', { roomCode: code, playerId, reason: result.error, state: room.getPublicState() });
  }

  socket.on('createRoom', ({ name, playerId } = {}) => {
    try {
      const code = generateRoomCode();
      const room = new GameRoom(code, io);
      rooms.set(code, room);
      const pid = playerId || uuidv4();
      joinAsPlayerOrSpectator(room, code, pid, name);
    } catch (err) {
      socket.emit('actionError', { error: 'Could not create room. Please try again.' });
    }
  });

  socket.on('joinRoom', ({ code, name, playerId } = {}) => {
    try {
      const roomCode = String(code || '').toUpperCase().trim();
      const room = rooms.get(roomCode);
      if (!room) { socket.emit('actionError', { error: 'No arena found with that code.' }); return; }
      const pid = playerId || uuidv4();
      joinAsPlayerOrSpectator(room, roomCode, pid, name);
    } catch (err) {
      socket.emit('actionError', { error: 'Could not join room. Please try again.' });
    }
  });

  socket.on('selectClass', ({ className } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.selectClass(session.playerId, className);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('setReady', ({ ready } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.setReady(session.playerId, !!ready);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('startGame', () => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.startGame(session.playerId);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('buyItem', ({ itemId } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.buyItem(session.playerId, itemId);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('allocateTalent', ({ talentId } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.allocateTalent(session.playerId, talentId);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('respecTalents', () => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.respecTalents(session.playerId);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('endGame', () => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.endGame(session.playerId);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('playAgain', () => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.playAgain(session.playerId);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('openCrate', () => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.openCrate(session.playerId);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('rollForLoot', () => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    const result = room.rollForLoot(session.playerId);
    if (!result.success) socket.emit('actionError', { error: result.error });
  });

  socket.on('chatMessage', ({ text } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const session = sessions.get(socket.id);
    room.addChatMessage(session.playerId, text, socket.id);
  });

  socket.on('requestState', () => {
    const room = currentRoom();
    if (!room) return;
    socket.emit('roomState', room.getPublicState());
  });

  socket.on('disconnect', () => {
    const session = sessions.get(socket.id);
    if (!session) return;
    sessions.delete(socket.id);
    const room = rooms.get(session.roomCode);
    if (!room) return;
    if (session.isSpectator) {
      room.removeSpectator(socket.id);
      destroyRoomIfEmpty(session.roomCode);
    } else {
      room.handleDisconnect(session.playerId, () => destroyRoomIfEmpty(session.roomCode));
    }
  });

  function currentRoom() {
    const session = sessions.get(socket.id);
    if (!session) return null;
    return rooms.get(session.roomCode) || null;
  }
});

/* Defensive cleanup sweep in case any room slips through normal teardown */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room._isEmpty() && now - room.lastActivity > STALE_ROOM_MAX_AGE_MS) {
      room.destroy();
      rooms.delete(code);
    }
  }
}, STALE_ROOM_SWEEP_MS);

server.listen(PORT, () => {
  console.log(`Arena Battler server listening on port ${PORT}`);
});
