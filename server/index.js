// server/index.js
// Server chinh: phuc vu frontend tinh + xu ly toan bo su kien Socket.io.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, PHASE } = require('./Game');
const { ROLE_INFO, isWolfTeam } = require('./roles');
const { Chat } = require('./Chat');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.get('/api/roles', (_req, res) => res.json(ROLE_INFO));

app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new Map(); // roomCode -> Game

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcastRoom(io, game) {
  const publicState = game.publicState();
  io.to(game.roomCode).emit('game_state', publicState);

  // Gui thong tin rieng tu (vai tro, goi y hanh dong) cho tung nguoi choi con ket noi
  for (const player of game.players.values()) {
    if (!player.connected) continue;
    const payload = { role: null, prompt: null };
    if (player.role) {
      const info = ROLE_INFO[player.role];
      payload.role = { ...info };
      if (player.role === 'mason') {
        payload.allies = [...game.players.values()].filter(p => p.role === 'mason' && p.id !== player.id).map(p => p.name);
      }
      if (player.loverId && game.players.has(player.loverId)) {
        payload.loverName = game.players.get(player.loverId).name;
      }
      if (isWolfTeam(player.role)) {
        payload.teammates = [...game.players.values()]
          .filter((p) => isWolfTeam(p.role) && p.id !== player.id)
          .map((p) => ({ name: p.name, role: p.role, alive: p.alive }));
      }
    }
    if (game.phase !== PHASE.LOBBY && game.phase !== PHASE.GAME_OVER) {
      payload.prompt = game.getPhasePrompt(player);
    }
    io.to(player.socketId).emit('private_state', payload);
    io.to(player.socketId).emit('chat_state', game.chat.snapshot(game, player));
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name }, cb) => {
    if (socket.data.roomCode) return cb && cb({ ok: false, error: 'Bạn đã ở trong một phòng.' });
    const roomCode = generateRoomCode();
    const game = new Game(roomCode);
    game.chat = new Chat();
    rooms.set(roomCode, game);
    const player = game.addPlayer(socket.id, name || 'Chu phong');
    player.sessionToken = randomUUID();
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = player.id;
    cb && cb({ ok: true, roomCode, playerId: player.id, sessionToken: player.sessionToken });
    broadcastRoom(io, game);
  });

  socket.on('join_room', ({ roomCode, name, sessionToken }, cb) => {
    if (socket.data.roomCode) return cb && cb({ ok: false, error: 'Bạn đã ở trong một phòng.' });
    const code = (roomCode || '').toUpperCase().trim();
    const game = rooms.get(code);
    if (!game) return cb && cb({ ok: false, error: 'Khong tim thay phong. Kiem tra lai ma phong.' });

    // Cho phep vao lai neu dang trong ban choi va bi rot mang truoc do
    let player = null;
    if (game.phase !== PHASE.LOBBY) {
      const returning = [...game.players.values()].find(p => p.sessionToken === sessionToken && sessionToken);
      if (!returning || returning.name !== (name || '').trim().slice(0, 20)) {
        return cb && cb({ ok: false, error: 'Không thể vào lại: phiên người chơi không hợp lệ.' });
      }
      player = game.reconnectByName(socket.id, name);
      if (!player) return cb && cb({ ok: false, error: 'Ban choi da bat dau, khong the tham gia moi.' });
    } else {
      if (game.players.size >= 20) return cb && cb({ ok: false, error: 'Phong da day (toi da 20 nguoi).' });
      const dup = [...game.players.values()].some((p) => p.name === (name || '').trim().slice(0, 20));
      if (dup) return cb && cb({ ok: false, error: 'Ten nay da co nguoi dung, chon ten khac.' });
      player = game.addPlayer(socket.id, name);
      player.sessionToken = randomUUID();
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    cb && cb({ ok: true, roomCode: code, playerId: player.id, sessionToken: player.sessionToken });
    broadcastRoom(io, game);
  });

  socket.on('get_role_suggestion', (_, cb) => {
    const game = rooms.get(socket.data.roomCode);
    if (!game) return cb && cb({ ok: false });
    cb && cb({ ok: true, config: game.getSuggestedRoleConfig(), playerCount: game.players.size });
  });

  socket.on('start_game', ({ roleConfig, durations }, cb) => {
    const game = rooms.get(socket.data.roomCode);
    if (!game) return cb && cb({ ok: false, error: 'Phong khong ton tai' });
    const player = game.players.get(socket.data.playerId);
    if (!player || !player.isHost) return cb && cb({ ok: false, error: 'Chi chu phong moi duoc bat dau game' });
    if (game.players.size < 6) return cb && cb({ ok: false, error: 'Can it nhat 6 nguoi choi de bat dau' });

    const result = game.startGame(roleConfig, durations);
    if (!result.ok) return cb && cb({ ok: false, error: result.errors.join('; ') });
    game.chat.reset();

    cb && cb({ ok: true });
    game.enterNight(io, () => broadcastRoom(io, game));
    broadcastRoom(io, game);
  });

  socket.on('player_action', ({ type, payload }) => {
    const game = rooms.get(socket.data.roomCode);
    if (!game) return;
    game.recordAction(io, () => broadcastRoom(io, game), socket.data.playerId, type, payload || {});
    broadcastRoom(io, game);
  });

  socket.on('chat_send', (data, cb) => {
    const game = rooms.get(socket.data.roomCode);
    const player = game?.players.get(socket.data.playerId);
    if (!player || !player.connected || player.socketId !== socket.id) {
      return typeof cb === 'function' && cb({ ok: false, error: 'Bạn chưa kết nối vào phòng.' });
    }
    const result = game.chat.send(game, player, data);
    if (result.ok) {
      for (const recipient of game.players.values()) {
        if (recipient.connected) io.to(recipient.socketId).emit('chat_state', game.chat.snapshot(game, recipient));
      }
    }
    if (typeof cb === 'function') cb(result);
  });

  socket.on('restart_to_lobby', (_, cb) => {
    const game = rooms.get(socket.data.roomCode);
    if (!game) return cb && cb({ ok: false });
    const player = game.players.get(socket.data.playerId);
    if (!player || !player.isHost) return cb && cb({ ok: false, error: 'Chi chu phong moi duoc lam moi' });
    if (game.timer) clearTimeout(game.timer);
    for (const p of game.players.values()) {
      p.role = null;
      p.alive = true;
      p.loverId = null;
    }
    game.phase = PHASE.LOBBY;
    game.phaseEndsAt = null;
    game.winner = null;
    game.lastDeaths = [];
    game.nightNumber = 0;
    game.dayNumber = 0;
    game.chat.reset();
    cb && cb({ ok: true });
    broadcastRoom(io, game);
  });

  socket.on('leave_room', () => handleLeave(socket));
  socket.on('disconnect', () => handleLeave(socket));
});

function handleLeave(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;
  const game = rooms.get(roomCode);
  if (!game) return;
  game.removePlayerBySocket(socket.id);
  socket.leave(roomCode);
  delete socket.data.roomCode;
  delete socket.data.playerId;
  if (game.players.size === 0) {
    if (game.timer) clearTimeout(game.timer);
    rooms.delete(roomCode);
  } else {
    broadcastRoom(io, game);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ma Soi Online server dang chay tai http://localhost:${server.address().port}`);
});
