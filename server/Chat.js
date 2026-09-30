const { isWolfTeam } = require('./roles');

const PUBLIC_PHASES = new Set(['LOBBY', 'DAY_DISCUSSION', 'DAY_VOTE', 'GAME_OVER']);

class Chat {
  constructor() { this.reset(); }

  reset() {
    this.messages = [];
    this.lastSent = new Map();
    this.nextId = 1;
  }

  permissions(game, player) {
    const active = !['LOBBY', 'GAME_OVER'].includes(game.phase);
    const wolves = active && player.alive && isWolfTeam(player.role);
    const dead = !player.alive;
    return {
      public: {
        canRead: true,
        canSend: PUBLIC_PHASES.has(game.phase) && (!active || player.alive),
        reason: active && !player.alive ? 'Bạn đã mất, chỉ có thể đọc kênh chung.'
          : !PUBLIC_PHASES.has(game.phase) ? 'Kênh chung mở khi thảo luận và bỏ phiếu ban ngày.' : '',
      },
      wolves: {
        // Nguoi da mat nghe duoc bay Soi noi chuyen qua micro va da biet vai cua ca lang,
        // nen cho ho doc luon kenh chu de hai duong khong lech nhau.
        canRead: wolves || dead,
        canSend: wolves && game.phase.startsWith('NIGHT_'),
        reason: dead && !wolves ? 'Bạn đã mất nên chỉ có thể đọc kênh của bầy Sói.'
          : 'Kênh riêng của bầy Sói mở vào ban đêm.',
      },
      dead: {
        canRead: dead,
        canSend: dead,
        reason: 'Kênh Âm phủ chỉ dành cho người chơi đã mất, có thể trò chuyện bất cứ lúc nào.',
      },
    };
  }

  snapshot(game, player) {
    const permissions = this.permissions(game, player);
    // Nguoi da mat khong nam trong audience cua tin nhan Soi (audience chi gom Soi con song
    // luc gui), nen phai cho ho xem theo quyen doc thay vi theo audience.
    const dead = !player.alive;
    return {
      permissions,
      messages: this.messages.filter(m => {
        if (m.channel === 'public') return true;
        if (m.channel === 'wolves') return permissions.wolves.canRead && (dead || m.audience.includes(player.id));
        if (m.channel === 'dead') return permissions.dead.canRead && m.audience.includes(player.id);
        return false;
      }).map(({ audience, replyAudience, audio, ...message }) => {
          if (audio) message.audio = { mime: audio.mime };
          if (replyAudience && !replyAudience.includes(player.id)) return { ...message, replyTo: null };
          return message;
        }),
    };
  }

  send(game, player, data, now = Date.now()) {
    if (!data || !['public', 'wolves', 'dead'].includes(data.channel) || (typeof data.text !== 'string' && !data.audio)) {
      return { ok: false, error: 'Tin nhắn không hợp lệ.' };
    }
    const permission = this.permissions(game, player)[data.channel];
    if (!permission.canSend) return { ok: false, error: 'Bạn không thể gửi vào kênh này lúc này.' };
    let audio = null;
    if (data.audio) {
      const { mime, base64 } = data.audio;
      if (!['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].includes(mime) ||
          typeof base64 !== 'string' || base64.length > 180000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        return { ok: false, error: 'Ghi âm không hợp lệ hoặc quá lớn (tối đa 20 giây / 130 KB).' };
      }
      audio = { mime, base64 };
    }
    const text = audio ? '🎙 Tin nhắn thoại' : data.text.trim();
    if (!text || text.length > 500) return { ok: false, error: 'Tin nhắn cần từ 1 đến 500 ký tự.' };
    if (now - (this.lastSent.get(player.id) ?? -Infinity) < 800) {
      return { ok: false, error: 'Bạn gửi quá nhanh. Hãy chờ một chút.' };
    }
    let original = null;
    if (data.replyToId != null) {
      original = this.messages.find(m => m.id === data.replyToId && m.channel === data.channel &&
        (m.channel === 'public' || m.audience.includes(player.id)));
      if (!original) return { ok: false, error: 'Không thể trả lời tin này. Tin có thể đã hết lịch sử hoặc không thuộc kênh hiện tại.' };
    }
    this.lastSent.set(player.id, now);
    const audience = data.channel === 'wolves'
      ? [...game.players.values()].filter(p => p.alive && isWolfTeam(p.role)).map(p => p.id)
      : data.channel === 'dead'
      ? [...game.players.values()].filter(p => !p.alive).map(p => p.id)
      : null;
    const message = {
      id: this.nextId++, channel: data.channel, playerId: player.id,
      name: player.name, text, sentAt: now, audience, audio,
      replyTo: original ? { id: original.id, playerId: original.playerId, name: original.name, text: original.text } : null,
      replyAudience: original?.audience || null,
    };
    this.messages.push(message);
    // Bound each channel separately so public traffic cannot clear private history.
    const channelMessages = this.messages.filter(m => m.channel === data.channel);
    if (channelMessages.length > 100) this.messages = this.messages.filter(m => m.id !== channelMessages[0].id);
    return { ok: true };
  }
}

module.exports = { Chat };
