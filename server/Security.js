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
    if (this.rooms.get(game.roomCode) !== game || [...game.players.values()].some(p => p.connected)) {
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
    if (this.rooms.get(game.roomCode) !== game || !host || host.connected) {
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

const { ROLE_INFO } = require('./roles');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, max = 100) => typeof value === 'string' && value.length > 0 && value.length <= max;
const optionalTarget = value => value == null || string(value);
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));

function validActionPayload(type, payload) {
  if (!object(payload)) return false;
  switch (type) {
    case 'ready': return onlyKeys(payload, []);
    case 'skip_day': return onlyKeys(payload, ['dayNumber']) && Number.isSafeInteger(payload.dayNumber) && payload.dayNumber >= 0;
    case 'cupid_choose': return onlyKeys(payload, ['targetIds']) && Array.isArray(payload.targetIds) && payload.targetIds.length === 2 && payload.targetIds.every(id => string(id));
    case 'witch_action': return onlyKeys(payload, ['heal', 'poisonTargetId']) && (payload.heal === undefined || typeof payload.heal === 'boolean') && optionalTarget(payload.poisonTargetId);
    case 'guard_protect': case 'wolf_vote': case 'whitewolf_kill': case 'seer_check': case 'hunter_shoot': case 'day_vote':
      return onlyKeys(payload, ['targetId']) && optionalTarget(payload.targetId);
    case 'judge_vote': return onlyKeys(payload, ['verdict']) && ['kill', 'spare'].includes(payload.verdict);
    case 'react': return onlyKeys(payload, ['targetId', 'kind']) && string(payload.targetId) && ['tomato', 'flower'].includes(payload.kind);
    default: return false;
  }
}

function validRoleConfig(config) {
  return object(config) && Object.entries(config).every(([id, count]) =>
    Object.hasOwn(ROLE_INFO, id) && Number.isInteger(count) && count >= 0 && count <= ROLE_INFO[id].maxCount);
}

function validVoiceSignal(value) {
  if (!object(value) || !string(value.toPlayerId) || !object(value.data)) return false;
  const d = value.data;
  if (!['village', 'wolves', 'dead'].includes(d.channel) || !string(d.toSocketId)) return false;
  if (d.type === 'offer' || d.type === 'answer') {
    return object(d.sdp) && d.sdp.type === d.type && string(d.sdp.sdp, 64000);
  }
  if (d.type !== 'candidate' || !object(d.candidate)) return false;
  const c = d.candidate;
  return typeof c.candidate === 'string' && c.candidate.length <= 2048 &&
    (c.sdpMid == null || string(c.sdpMid, 128)) &&
    (c.sdpMLineIndex == null || (Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex <= 32)) &&
    (c.usernameFragment == null || string(c.usernameFragment, 128));
}

function validSocketData(event, data) {
  switch (event) {
    case 'create_room': return object(data) && string(data.name) && !!data.name.trim();
    case 'join_room': return object(data) && string(data.name) && !!data.name.trim() && string(data.roomCode, 32) && (data.sessionToken === undefined || string(data.sessionToken));
    case 'start_game': return object(data) && validRoleConfig(data.roleConfig) && (data.durations === undefined || object(data.durations));
    case 'set_role_config': return validRoleConfig(data);
    case 'player_action': return object(data) && Number.isSafeInteger(data.actionVersion) && data.actionVersion >= 0 && validActionPayload(data.type, data.payload);
    case 'voice_signal': return validVoiceSignal(data);
    case 'chat_audio': return Number.isSafeInteger(data) && data > 0;
    case 'chat_send': return object(data); // Chat.send validates content, size and channel permissions.
    case 'kick_player': return object(data) && string(data.playerId);
    case 'cam_state': return object(data) && typeof data.on === 'boolean' && onlyKeys(data, ['on']);
    case 'get_role_suggestion': case 'restart_to_lobby': case 'leave_room': case 'get_ice_servers': return data == null;
    default: return false;
  }
}

module.exports = { TokenBucket, RoomCleanup, HostRecovery, validActionPayload, validSocketData };
