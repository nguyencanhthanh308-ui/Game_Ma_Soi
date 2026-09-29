// server/index.js
// Server chinh: phuc vu frontend tinh + xu ly toan bo su kien Socket.io.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, PHASE } = require('./Game');
const { ROLE_INFO, isWolfTeam } = require('./roles');
const { Chat } = require('./Chat');
const { voiceChannelFor, voiceRoster } = require('./voice');
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
  const voiceGroups = voiceRoster(game);

  // Gui thong tin rieng tu (vai tro, goi y hanh dong) cho tung nguoi choi con ket noi
  for (const player of game.players.values()) {
    if (!player.connected) continue;
    const payload = { role: null, prompt: null, seerResults: player.role === 'seer' ? (player.seerResults || []) : [] };
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
    const myVoiceChannel = voiceChannelFor(game, player);
    payload.voiceChannel = myVoiceChannel;
    payload.voicePeers = myVoiceChannel ? voiceGroups[myVoiceChannel].filter((p) => p.playerId !== player.id) : [];
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
    const player = game.addPlayer(socket.id, name || 'Chủ phòng');
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
    if (!game) return cb && cb({ ok: false, error: 'Không tìm thấy phòng. Kiểm tra lại mã phòng.' });

    // Cho phep vao lai neu dang trong ban choi va bi rot mang truoc do
    let player = null;
    if (game.phase !== PHASE.LOBBY) {
      const returning = [...game.players.values()].find(p => p.sessionToken === sessionToken && sessionToken);
      if (!returning || returning.name !== (name || '').trim().slice(0, 20)) {
        return cb && cb({ ok: false, error: 'Không thể vào lại: phiên người chơi không hợp lệ.' });
      }
      player = game.reconnectByName(socket.id, name);
      if (!player) return cb && cb({ ok: false, error: 'Ván chơi đã bắt đầu, không thể tham gia mới.' });
    } else {
      if (game.players.size >= 20) return cb && cb({ ok: false, error: 'Phòng đã đầy (tối đa 20 người).' });
      const dup = [...game.players.values()].some((p) => p.name === (name || '').trim().slice(0, 20));
      if (dup) return cb && cb({ ok: false, error: 'Tên này đã có người dùng, chọn tên khác.' });
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
    if (!game) return cb && cb({ ok: false, error: 'Phòng không tồn tại' });
    const player = game.players.get(socket.data.playerId);
    if (!player || !player.isHost) return cb && cb({ ok: false, error: 'Chỉ chủ phòng mới được bắt đầu ván chơi' });

    const result = game.startGame(roleConfig, durations);
    if (!result.ok) return cb && cb({ ok: false, error: result.errors.join('; ') });
    game.chat.reset();

    cb && cb({ ok: true });
    game.enterNight(io, () => broadcastRoom(io, game));
    broadcastRoom(io, game);
  });

  socket.on('set_role_config', (config, cb) => {
    const game = rooms.get(socket.data.roomCode);
    const player = game?.players.get(socket.data.playerId);
    if (!player?.isHost || game.phase !== PHASE.LOBBY) return cb?.({ ok: false });
    if (!config || Array.isArray(config) || typeof config !== 'object' || Object.keys(config).some(id =>
      !Object.hasOwn(ROLE_INFO, id) || !Number.isInteger(config[id]) || config[id] < 0 || config[id] > ROLE_INFO[id].maxCount)) return cb?.({ ok: false });
    game.roleConfig = { ...config };
    io.to(game.roomCode).emit('role_config', game.roleConfig);
    cb?.({ ok: true });
  });

  socket.on('chat_audio', (id, cb) => {
    if (typeof cb !== 'function') return;
    const game = rooms.get(socket.data.roomCode);
    const player = game?.players.get(socket.data.playerId);
    if (!player || player.socketId !== socket.id) return cb({ ok: false });
    if (!game.chat.snapshot(game, player).messages.some(m => m.id === id && m.audio)) return cb({ ok: false });
    cb({ ok: true, audio: game.chat.messages.find(m => m.id === id).audio });
  });

  socket.on('player_action', ({ type, payload }) => {
    const game = rooms.get(socket.data.roomCode);
    if (!game) return;
    game.recordAction(io, () => broadcastRoom(io, game), socket.data.playerId, type, payload || {});
    broadcastRoom(io, game);
  });

  // Relay tin hieu WebRTC (offer/answer/ICE candidate) giua 2 nguoi choi trong cung mot kenh voice.
  // Server khong xu ly noi dung am thanh, chi chuyen tiep goi tin bao mat theo playerId that (khong tin client).
  socket.on('voice_signal', ({ toPlayerId, data }) => {
    const game = rooms.get(socket.data.roomCode);
    if (!game || !data) return;
    const me = game.players.get(socket.data.playerId);
    const target = game.players.get(toPlayerId);
    if (!me || !me.connected || me.socketId !== socket.id || !target || !target.connected) return;
    // Chi cho relay neu ca 2 dang cung o mot kenh voice hop le (chong gia mao ket noi ngoai y muon)
    const myChannel = voiceChannelFor(game, me);
    const targetChannel = voiceChannelFor(game, target);
    if (!myChannel || myChannel !== targetChannel) return;
    io.to(target.socketId).emit('voice_signal', { fromPlayerId: me.id, data });
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
    if (!player || !player.isHost) return cb && cb({ ok: false, error: 'Chỉ chủ phòng mới được làm mới' });
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
  console.log(`Ma Sói Online server đang chạy tại http://localhost:${server.address().port}`);
});
