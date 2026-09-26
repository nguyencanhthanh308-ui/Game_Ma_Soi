class TokenBucket {
  constructor(capacity, perSecond, now = Date.now) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.now = now;
    this.tokens = capacity;
    this.updatedAt = now();
  }

  take() {
    const now = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.updatedAt) * this.perSecond / 1000);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

class RoomCleanup {
  constructor(rooms, { graceMs = 5 * 60 * 1000, schedule = setTimeout, cancel = clearTimeout } = {}) {
    this.rooms = rooms;
    this.graceMs = graceMs;
    this.schedule = schedule;
    this.cancel = cancel;
    this.pending = new Map();
  }

  update(game) {
    if ([...game.players.values()].some(p => p.connected)) {
      const timer = this.pending.get(game);
      if (timer !== undefined) this.cancel(timer);
      this.pending.delete(game);
      return;
    }
    if (this.pending.has(game)) return;
    const timer = this.schedule(() => {
      this.pending.delete(game);
      if (this.rooms.get(game.roomCode) !== game || [...game.players.values()].some(p => p.connected)) return;
      if (game.timer) clearTimeout(game.timer);
      this.rooms.delete(game.roomCode);
    }, this.graceMs);
    timer.unref?.();
    this.pending.set(game, timer);
  }
}

class HostRecovery {
  constructor(rooms, broadcast, { graceMs = 30000, now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
    Object.assign(this, { rooms, broadcast, graceMs, now, schedule, cancel });
    this.pending = new Map();
    this.offlineSince = new WeakMap();
  }

  update(game) {
    const host = game.players.get(game.hostId);
    if (!host || host.connected) {
      const timer = this.pending.get(game);
      if (timer !== undefined) this.cancel(timer);
      this.pending.delete(game);
      this.offlineSince.delete(game);
      return;
    }
    if (this.pending.has(game)) return;
    if (!this.offlineSince.has(game)) this.offlineSince.set(game, this.now());
    const delay = Math.max(0, this.graceMs - (this.now() - this.offlineSince.get(game)));
    const timer = this.schedule(() => {
      this.pending.delete(game);
      if (this.rooms.get(game.roomCode) !== game || game.players.get(game.hostId)?.connected) return;
      const next = [...game.players.values()].find(p => p.connected);
      if (!next) return;
      for (const p of game.players.values()) p.isHost = p.id === next.id;
      game.hostId = next.id;
      this.offlineSince.delete(game);
      this.broadcast(game);
    }, delay);
    timer.unref?.();
    this.pending.set(game, timer);
  }
}

module.exports = { TokenBucket, RoomCleanup, HostRecovery };
