// server/voice.js
// Tinh kenh voice chat (WebRTC) cho tung nguoi choi dua tren trang thai game hien tai.
// 3 kenh: 'village' (ban ngay, ai con song), 'wolves' (rieng cua bay Soi vao ban dem),
// 'dead' (Am phu, danh cho nguoi da mat, noi chuyen duoc bat cu luc nao).

const { isWolfTeam } = require('./roles');

function voiceChannelFor(game, player) {
  if (!player.alive) return 'dead';
  if (game.phase.startsWith('NIGHT_')) {
    return isWolfTeam(player.role) ? 'wolves' : null; // ban dem: chi bay Soi duoc noi, nguoi khac im lang nghe dan chuyen
  }
  return 'village'; // LOBBY, cac pha ban ngay, HUNTER_SHOT, GAME_OVER: ai con song deu noi chuyen chung duoc
}

// Nhom nguoi choi dang ket noi theo kenh voice cua ho, dung de gui roster (danh sach peer) cho tung client.
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

module.exports = { voiceChannelFor, voiceRoster };
