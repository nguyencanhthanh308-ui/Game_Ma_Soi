// server/voice.js
// Tinh kenh voice chat (WebRTC) cho tung nguoi choi dua tren trang thai game hien tai.
// 3 kenh NOI: 'village' (ban ngay, ai con song), 'wolves' (rieng cua bay Soi vao ban dem),
// 'dead' (Am phu, danh cho nguoi da mat, noi chuyen duoc bat cu luc nao).
// Nguoi da mat con NGHE duoc ca lang va bay Soi - ho da ra khoi van dau va duoc biet het.
// Chieu nguoc lai thi khong: nguoi con song khong bao gio nghe duoc Am phu.

const { isWolfTeam } = require('./roles');

function voiceChannelFor(game, player) {
  if (!player.alive) return 'dead';
  if (game.phase.startsWith('NIGHT_')) {
    return isWolfTeam(player.role) ? 'wolves' : null; // ban dem: chi bay Soi duoc noi, nguoi khac im lang nghe dan chuyen
  }
  return 'village'; // LOBBY, cac pha ban ngay, HUNTER_SHOT, GAME_OVER: ai con song deu noi chuyen chung duoc
}

// listener co nghe duoc speaker khong
function canHear(game, listener, speaker) {
  const speaking = voiceChannelFor(game, speaker);
  if (!speaking) return false; // nguoi kia dang khong duoc noi thi khong co gi de nghe
  if (!listener.alive) return true; // da mat -> theo doi duoc tat ca
  return voiceChannelFor(game, listener) === speaking;
}

// Hai nguoi co duoc phep trao doi tin hieu WebRTC voi nhau khong (du chi mot chieu)
function canSignal(game, a, b) {
  return canHear(game, a, b) || canHear(game, b, a);
}

// Danh sach nguoi can ket noi toi, kem huong ket noi:
//   'both'      - nghe va noi voi nhau
//   'listen'    - chi nghe ho, minh khong gui gi (nguoi da mat hong ve nguoi con song)
//   'broadcast' - chi gui cho ho, khong nhan gi (nguoi con song bi nguoi da mat nghe)
function voicePeersFor(game, player) {
  const peers = [];
  for (const other of game.players.values()) {
    if (!other.connected || other.id === player.id) continue;
    const iHearThem = canHear(game, player, other);
    const theyHearMe = canHear(game, other, player);
    if (!iHearThem && !theyHearMe) continue;
    peers.push({
      playerId: other.id,
      socketId: other.socketId,
      name: other.name,
      alive: other.alive,
      // Kenh ma nguoi kia dang noi - client dung de loc tin hieu cu sau khi doi pha
      channel: voiceChannelFor(game, other) || 'dead',
      mode: iHearThem && theyHearMe ? 'both' : iHearThem ? 'listen' : 'broadcast',
    });
  }
  return peers;
}

// Nhom nguoi choi dang ket noi theo kenh NOI cua ho. Dung cho cac kiem tra tong quan.
function voiceRoster(game) {
  const groups = { village: [], wolves: [], dead: [] };
  for (const p of game.players.values()) {
    if (!p.connected) continue;
    const ch = voiceChannelFor(game, p);
    if (!ch) continue;
    groups[ch].push({ playerId: p.id, socketId: p.socketId, name: p.name });
  }
  return groups;
}

module.exports = { voiceChannelFor, voiceRoster, voicePeersFor, canHear, canSignal };
