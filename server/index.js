// server/index.js
// Server chinh: phuc vu frontend tinh + xu ly toan bo su kien Socket.io.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, PHASE, CHANGEABLE_ACTIONS } = require('./Game');
const { ROLE_INFO, isWolfTeam } = require('./roles');
const { Chat } = require('./Chat');
const { voiceChannelFor, voicePeersFor, canSignal, canHear } = require('./voice');
const { randomUUID } = require('crypto');
const { TokenBucket, RoomCleanup, HostRecovery, validSocketData } = require('./Security');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
});

app.get('/api/roles', (_req, res) => res.json(ROLE_INFO));

app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new Map(); // roomCode -> Game
const cleanup = new RoomCleanup(rooms);
const recovery = new HostRecovery(rooms, game => broadcastRoom(io, game));

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcastRoom(io, game) {
  cleanup.update(game);
  recovery.update(game);
  const publicState = game.publicState();
  io.to(game.roomCode).emit('game_state', publicState);

  // Gui thong tin rieng tu (vai tro, goi y hanh dong) cho tung nguoi choi con ket noi
  for (const player of game.players.values()) {
    if (!player.connected) continue;
    const payload = { role: null, prompt: null, actionVersion: game.actionVersion,
      // Bo phieu va nem ca chua thi doi y duoc, nen khong danh dau la "da chot" -
      // neu danh dau, giao dien se khoa lai va khong the doi phieu nua.
      submitted: player.lastAction?.version === game.actionVersion && !CHANGEABLE_ACTIONS.has(player.lastAction.type),
      seerResults: player.role === 'seer' ? (player.seerResults || []) : [] };
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
    // Nguoi da mat thi khong con gi de giau: cho ho xem vai cua ca lang de theo doi van dau.
    if (!player.alive && game.phase !== PHASE.LOBBY) {
      payload.revealedRoles = [...game.players.values()]
        .filter((p) => p.role)
        .map((p) => ({ id: p.id, role: p.role, roleName: ROLE_INFO[p.role].name, alive: p.alive }));
    }
    payload.voiceChannel = voiceChannelFor(game, player);
    // Nguoi da mat van co peer de nghe du ho o kenh Am phu, nen danh sach nay tinh rieng
    payload.voicePeers = voicePeersFor(game, player);
    io.to(player.socketId).emit('private_state', payload);
    io.to(player.socketId).emit('chat_state', game.chat.snapshot(game, player));
  }
}

io.on('connection', (socket) => {
  const controlLimit = new TokenBucket(60, 15);
  // ICE bursts grow with room size; do not let them consume gameplay capacity.
  const voiceLimit = new TokenBucket(600, 150);
  const roomLimit = new TokenBucket(5, 0.5);
  socket.use((packet,next)=>{
    const [event, data, cb] = packet;
    const ack = typeof packet.at(-1) === 'function' ? packet.at(-1) : null;
    const limit = event === 'voice_signal' ? voiceLimit : controlLimit;
    if (!limit.take() || (['create_room', 'join_room'].includes(event) && !roomLimit.take())) {
      ack?.({ ok: false, error: 'Bạn gửi quá nhanh. Hãy thử lại sau một chút.' });
      return;
    }
    if (packet.length > 3 || (cb !== undefined && typeof cb !== 'function') || !validSocketData(event, data)) {
      ack?.({ ok: false, error: 'Dữ liệu không hợp lệ.' });
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

    // Restore a saved session in both the lobby and an active game.
    let player = null;
    const returning = [...game.players.values()].find(p => p.sessionToken === sessionToken && sessionToken);
    if (returning) {
      if (returning.name !== (name || '').trim().slice(0, 20)) {
        return cb && cb({ ok: false, error: 'Không thể vào lại: phiên người chơi không hợp lệ.' });
      }
      clearTimeout(returning.disconnectTimer);
      const previousSocket=io.sockets.sockets.get(returning.socketId);
      if(previousSocket&&previousSocket.id!==socket.id){previousSocket.leave(code);delete previousSocket.data.roomCode;delete previousSocket.data.playerId;previousSocket.disconnect(true);}
      returning.socketId=socket.id;returning.connected=true;player=returning;
    } else {
      if(game.phase!==PHASE.LOBBY)return cb&&cb({ok:false,error:'Không thể vào lại: phiên người chơi không hợp lệ.'});
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
    if (!game.startWhenReady(io, () => broadcastRoom(io, game))) broadcastRoom(io, game);
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
    if([...game.players.values()].some(p=>!p.connected))return cb&&cb({ok:false,error:'Chờ người mất kết nối vào lại hoặc hết thời gian giữ chỗ.'});

    const result = game.startGame(roleConfig, durations);
    if (!result.ok) return cb && cb({ ok: false, error: result.errors.join('; ') });
    game.chat.reset();

    cb && cb({ ok: true });
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

  socket.on('player_action', ({ type, payload, actionVersion }, cb) => {
    const game = rooms.get(socket.data.roomCode);
    const player = game?.players.get(socket.data.playerId);
    if (!player?.connected || player.socketId !== socket.id) return cb?.({ ok: false, error: 'Bạn chưa kết nối vào phòng.' });
    const result = game.recordAction(io, () => broadcastRoom(io, game), player.id, type, payload, actionVersion);
    cb?.(result);
  });

  // Relay tin hieu WebRTC (offer/answer/ICE candidate) giua 2 nguoi choi trong cung mot kenh voice.
  // Server khong xu ly noi dung am thanh, chi chuyen tiep goi tin bao mat theo playerId that (khong tin client).
  socket.on('voice_signal', ({ toPlayerId, data }) => {
    const game = rooms.get(socket.data.roomCode);
    if (!game || !data) return;
    const me = game.players.get(socket.data.playerId);
    const target = game.players.get(toPlayerId);
    if (!me || !me.connected || me.socketId !== socket.id || !target || !target.connected) return;
    // Chi relay khi it nhat mot chieu duoc phep nghe (chong gia mao ket noi ngoai y muon).
    // Nguoi da mat nghe duoc nguoi con song nen hai ben o hai kenh khac nhau van hop le.
    if (!canSignal(game, me, target)) return;
    const myChannel = voiceChannelFor(game, me) || 'dead';
    if(data.channel!==undefined&&data.channel!==myChannel)return;
    if(data.toSocketId!==undefined&&data.toSocketId!==target.socketId)return;
    if(!['offer','answer','candidate'].includes(data.type))return;
    io.to(target.socketId).emit('voice_signal', { fromPlayerId: me.id, fromSocketId:socket.id, data });
  });

  // Bao cho nhung nguoi duoc phep thay minh biet camera vua bat hay tat.
  // WebRTC khong bao dam bao su kien 'mute' khi ngung gui hinh, nen phai bao tay.
  socket.on('cam_state', ({ on }) => {
    const game = rooms.get(socket.data.roomCode);
    const me = game?.players.get(socket.data.playerId);
    if (!me || !me.connected || me.socketId !== socket.id) return;
    for (const other of game.players.values()) {
      if (!other.connected || other.id === me.id) continue;
      if (canHear(game, other, me)) io.to(other.socketId).emit('cam_state', { playerId: me.id, on: !!on });
    }
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

  // Chu phong moi duoc duoi nguoi. Chi cho duoi luc o sanh cho hoac da ket thuc van:
  // duoi giua van se lam lech so vai da chia va hong the can bang cua ca phong.
  socket.on('kick_player', ({ playerId }, cb) => {
    const game = rooms.get(socket.data.roomCode);
    if (!game) return cb?.({ ok: false, error: 'Phòng không tồn tại.' });
    const host = game.players.get(socket.data.playerId);
    if (!host?.isHost) return cb?.({ ok: false, error: 'Chỉ chủ phòng mới được mời người khác rời phòng.' });
    if (game.phase !== PHASE.LOBBY && game.phase !== PHASE.GAME_OVER) {
      return cb?.({ ok: false, error: 'Chỉ mời rời phòng được lúc ở sảnh chờ hoặc sau khi ván kết thúc.' });
    }
    if (playerId === host.id) return cb?.({ ok: false, error: 'Bạn không thể tự mời mình rời phòng.' });
    const target = game.players.get(playerId);
    if (!target) return cb?.({ ok: false, error: 'Người chơi không còn trong phòng.' });

    clearTimeout(target.disconnectTimer);
    const targetSocket = io.sockets.sockets.get(target.socketId);
    game.removePlayerBySocket(target.socketId);
    game.readyPlayers.delete(playerId);
    if (targetSocket) {
      targetSocket.emit('kicked', { reason: 'Chủ phòng đã mời bạn rời phòng.' });
      targetSocket.leave(game.roomCode);
      delete targetSocket.data.roomCode;
      delete targetSocket.data.playerId;
    }
    cb?.({ ok: true });
    broadcastRoom(io, game);
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
      p.lastAction = null;
    }
    game.phase = PHASE.LOBBY;
    for (const p of [...game.players.values()]) {
      if (!p.connected) {
        clearTimeout(p.disconnectTimer);
        game.removePlayerBySocket(p.socketId);
      }
    }
    game.actionVersion++;
    game.readyPlayers.clear();
    game.phaseEndsAt = null;
    game.winner = null;
    game.lastDeaths = [];
    game.nightNumber = 0;
    game.dayNumber = 0;
    game.chat.reset();
    cb && cb({ ok: true });
    broadcastRoom(io, game);
  });

  socket.on('leave_room', () => handleLeave(socket,true));
  socket.on('disconnect', () => handleLeave(socket));
});

function handleLeave(socket, explicit=false) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;
  const game = rooms.get(roomCode);
  if (!game) return;
  const player=game.getBySocket(socket.id);
  if(!explicit&&game.phase===PHASE.LOBBY&&player){
    player.connected=false;
    player.disconnectTimer=setTimeout(()=>{
      if(!player.connected&&game.phase===PHASE.LOBBY){
        game.removePlayerBySocket(player.socketId);
        if(!game.players.size){rooms.delete(roomCode);cleanup.update(game);recovery.update(game);}
        else broadcastRoom(io,game);
      }
    },30000);
    player.disconnectTimer.unref?.();
  }else game.removePlayerBySocket(socket.id);
  socket.leave(roomCode);
  delete socket.data.roomCode;
  delete socket.data.playerId;
  if (game.players.size === 0) {
    if (game.timer) clearTimeout(game.timer);
    rooms.delete(roomCode);
    cleanup.update(game);
    recovery.update(game);
  } else {
    broadcastRoom(io, game);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ma Sói Online server đang chạy tại http://localhost:${server.address().port}`);
});
