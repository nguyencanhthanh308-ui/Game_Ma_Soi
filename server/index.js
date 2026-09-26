// server/index.js
// Server chinh: phuc vu frontend tinh + xu ly toan bo su kien Socket.io.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, PHASE, DEFAULT_DURATIONS } = require('./Game');
const { ROLE_INFO, isWolfTeam } = require('./roles');
const { Chat } = require('./Chat');
const { randomUUID } = require('crypto');
const { TokenBucket, RoomCleanup, HostRecovery } = require('./Security');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.get('/api/roles', (_req, res) => res.json(ROLE_INFO));

app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new Map(); // roomCode -> Game
const roomCleanup = new RoomCleanup(rooms);
const hostRecovery = new HostRecovery(rooms, game => broadcastRoom(io, game));
const ipLimits = new Map();
const ipSweep = setInterval(() => {
  const cutoff = Date.now() - 60 * 1000;
  for (const [ip, bucket] of ipLimits) if (bucket.updatedAt < cutoff) ipLimits.delete(ip);
}, 60 * 1000);
ipSweep.unref();

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
    const payload = { role: null, prompt: null, seerHistory: player.role === 'seer' ? (player.seerHistory || []) : [] };
    payload.actionContext = game.actionContext();
    payload.submitted = game.hasSubmitted(player);
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
  const eventLimit = new TokenBucket(30, 10);
  // Validate packets before destructuring or invoking client-supplied callbacks.
  socket.use((packet, next) => {
    const [event, data] = packet;
    const cb = packet[2];
    if (!eventLimit.take()) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Bạn thao tác quá nhanh. Hãy chờ một chút.' });
      return;
    }
    if (event === 'create_room' || event === 'join_room') {
      // Use the transport address, never a client-supplied forwarded header.
      const ip = socket.handshake.address;
      let bucket = ipLimits.get(ip);
      if (!bucket) {
        if (ipLimits.size >= 10000) {
          if (typeof cb === 'function') cb({ ok: false, error: 'Server đang bận. Hãy thử lại sau.' });
          return;
        }
        bucket = new TokenBucket(60, 2);
        ipLimits.set(ip, bucket);
      }
      if (!bucket.take()) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Có quá nhiều lượt vào phòng. Hãy thử lại sau.' });
        return;
      }
    }
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const name = value => typeof value === 'string' && value.trim().length > 0;
    const validators = {
      create_room: () => object(data) && name(data.name),
      join_room: () => object(data) && name(data.name) && typeof data.roomCode === 'string',
      start_game: () => object(data) && object(data.roleConfig) && (data.durations === undefined ||
        (object(data.durations) && Object.entries(data.durations).every(([key, value]) =>
          Object.hasOwn(DEFAULT_DURATIONS, key) && Number.isFinite(value) && value >= 1 && value <= 3600))),
      player_action: () => object(data) && typeof data.type === 'string' &&
        (data.payload === undefined || (object(data.payload) &&
          (data.payload.targetIds === undefined || Array.isArray(data.payload.targetIds)))),
    };
    if ((cb !== undefined && typeof cb !== 'function') ||
        (Object.hasOwn(validators, event) && !validators[event]())) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Dữ liệu không hợp lệ.' });
      return;
    }
    next();
  });
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
    roomCleanup.update(game);
    hostRecovery.update(game);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    cb && cb({ ok: true, roomCode: code, playerId: player.id, sessionToken: player.sessionToken });
    if (game.phase === PHASE.ROLE_REVEAL && [...game.players.values()].every(p => p.ready && p.connected)) {
      game.enterNight(io, () => broadcastRoom(io, game));
    }
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

    const result = game.startGame(roleConfig, durations);
    if (!result.ok) return cb && cb({ ok: false, error: result.errors.join('; ') });
    game.chat.reset();

    cb && cb({ ok: true });
    broadcastRoom(io, game);
  });

  socket.on('player_action', ({ type, payload, actionContext }, cb) => {
    const reply = result => { if (typeof cb === 'function') cb(result); };
    const game = rooms.get(socket.data.roomCode);
    if (!game) return reply({ ok: false, error: 'Bạn chưa ở trong phòng.' });
    const player = game.players.get(socket.data.playerId);
    if (!player?.connected || player.socketId !== socket.id) return reply({ ok: false, error: 'Phiên kết nối không hợp lệ.' });
    if (actionContext !== undefined && actionContext !== game.actionContext()) {
      return reply({ ok: false, error: 'Lượt chơi đã thay đổi. Hãy chọn lại ở lượt hiện tại.' });
    }
    const accepted = game.recordAction(io, () => broadcastRoom(io, game), socket.data.playerId, type, payload || {});
    reply(accepted ? { ok: true } : { ok: false, error: 'Lựa chọn không hợp lệ hoặc đã hết lượt. Hãy thử lại.' });
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
      if (!p.connected) game.players.delete(p.id);
    }
    for (const p of game.players.values()) {
      p.role = null;
      p.alive = true;
      p.loverId = null;
      p.ready = false;
      p.seerHistory = [];
    }
    game.phase = PHASE.LOBBY;
    game.phaseEndsAt = null;
    game.winner = null;
    game.lastDeaths = [];
    game.voteHistory = [];
    game.lastVoteResult = null;
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
  hostRecovery.update(game);
  socket.leave(roomCode);
  delete socket.data.roomCode;
  delete socket.data.playerId;
  if (game.players.size === 0) {
    if (game.timer) clearTimeout(game.timer);
    rooms.delete(roomCode);
  } else {
    roomCleanup.update(game);
    broadcastRoom(io, game);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ma Soi Online server dang chay tai http://localhost:${server.address().port}`);
});
