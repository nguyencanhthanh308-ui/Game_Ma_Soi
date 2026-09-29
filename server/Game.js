// server/Game.js
// Quan ly toan bo vong doi cua mot phong choi: lobby -> dem/ngay -> ket thuc.

const {
  ROLE_INFO,
  isWolfTeam,
  getDefaultRoleConfig,
  validateRoleConfig,
  expandRoleConfig,
} = require('./roles');

const PHASE = {
  LOBBY: 'LOBBY',
  NIGHT_CUPID: 'NIGHT_CUPID',
  NIGHT_GUARD: 'NIGHT_GUARD',
  NIGHT_WOLVES: 'NIGHT_WOLVES',
  NIGHT_WHITEWOLF: 'NIGHT_WHITEWOLF',
  NIGHT_SEER: 'NIGHT_SEER',
  NIGHT_WITCH: 'NIGHT_WITCH',
  DAY_ANNOUNCE: 'DAY_ANNOUNCE',
  HUNTER_SHOT: 'HUNTER_SHOT',
  DAY_DISCUSSION: 'DAY_DISCUSSION',
  DAY_VOTE: 'DAY_VOTE',
  DAY_RESOLVE: 'DAY_RESOLVE',
  GAME_OVER: 'GAME_OVER',
};

// Thoi luong moi pha (giay). Host co the chinh sua truoc khi bat dau game.
const DEFAULT_DURATIONS = {
  NIGHT_CUPID: 20,
  NIGHT_GUARD: 15,
  NIGHT_WOLVES: 30,
  NIGHT_WHITEWOLF: 15,
  NIGHT_SEER: 15,
  NIGHT_WITCH: 20,
  DAY_ANNOUNCE: 8,
  HUNTER_SHOT: 15,
  DAY_DISCUSSION: 90,
  DAY_VOTE: 30,
  DAY_RESOLVE: 5,
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

class Game {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.players = new Map(); // id -> player object
    this.hostId = null;
    this.phase = PHASE.LOBBY;
    this.phaseEndsAt = null;
    this.nightNumber = 0;
    this.dayNumber = 0;
    this.durations = { ...DEFAULT_DURATIONS };
    this.roleConfig = null;
    this.timer = null;

    this.night = this._emptyNightActions();
    this.lastDeaths = []; // ten nhung nguoi vua chet, de thong bao
    this.pendingHunterQueue = []; // hang doi tho san can ban
    this.afterHunterResume = null; // 'NIGHT' | 'DAY'
    this.doubleKillNextNight = false;
    this.lastProtectedId = null;
    this.dayVotes = {};
    this.skipDayVotes = new Set();
    this.winner = null;
  }

  _emptyNightActions() {
    return {
      cupidPairChosen: false,
      guardTarget: null,
      wolfVotes: {}, // socketId(wolf) -> targetId
      whiteWolfTarget: null, // null = chua quyet dinh, 'skip' = bo qua
      seerTarget: null,
      witchHeal: false,
      witchHealDecided: false,
      witchPoisonTarget: null,
      currentWolfVictim: null,
      wolfVictims: [],
      remainingBites: 1,
      wolfRound: 1,
    };
  }

  // ---------- Quan ly nguoi choi ----------

  addPlayer(socketId, name) {
    const id = makeId();
    const isHost = this.players.size === 0;
    const player = {
      id,
      socketId,
      name: name.trim().slice(0, 20) || 'Người chơi',
      isHost,
      connected: true,
      alive: true,
      role: null,
      loverId: null,
      hasUsedWhiteKill: false,
      hasUsedHeal: false,
      hasUsedPoison: false,
    };
    this.players.set(id, player);
    if (isHost) this.hostId = id;
    return player;
  }

  getBySocket(socketId) {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) return p;
    }
    return null;
  }

  removePlayerBySocket(socketId) {
    const p = this.getBySocket(socketId);
    if (!p) return null;
    if (this.phase === PHASE.LOBBY) {
      this.players.delete(p.id);
      if (this.hostId === p.id) {
        const next = this.players.values().next().value;
        this.hostId = next ? next.id : null;
        if (next) next.isHost = true;
      }
    } else {
      p.connected = false; // giu vai tro, cho phep reconnect trong khi choi
    }
    return p;
  }

  reconnectByName(socketId, name) {
    for (const p of this.players.values()) {
      if (!p.connected && p.name === name.trim().slice(0, 20)) {
        p.socketId = socketId;
        p.connected = true;
        return p;
      }
    }
    return null;
  }

  alivePlayers() {
    return [...this.players.values()].filter((p) => p.alive);
  }

  aliveWolves() {
    return this.alivePlayers().filter((p) => isWolfTeam(p.role));
  }

  // ---------- Bat dau game ----------

  getSuggestedRoleConfig() {
    return getDefaultRoleConfig(this.players.size);
  }

  validateConfig(config) {
    return validateRoleConfig(config, this.players.size);
  }

  startGame(roleConfig, durations) {
    const errors = this.validateConfig(roleConfig);
    if (errors.length) return { ok: false, errors };

    if (this.phase !== PHASE.LOBBY) return { ok: false, errors: ['Ván chơi đã bắt đầu'] };
    this.lastProtectedId = null;
    this.doubleKillNextNight = false;
    this.pendingHunterQueue = [];
    this.dayVotes = {};
    this.lastDeaths = [];
    this.lastVoteResult = null;
    this.afterHunterResume = null;
    this.roleConfig = roleConfig;
    if (durations) this.durations = { ...this.durations, ...durations };

    const roleList = expandRoleConfig(roleConfig);
    // Fisher-Yates shuffle
    for (let i = roleList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roleList[i], roleList[j]] = [roleList[j], roleList[i]];
    }
    const playerList = [...this.players.values()];
    playerList.forEach((p, idx) => {
      p.role = roleList[idx];
      p.alive = true;
      p.loverId = null;
      p.hasUsedWhiteKill = false;
      p.hasUsedHeal = false;
      p.hasUsedPoison = false;
      p.seerResults = [];
      p.biteCount = 0;
      p.doomedNight = null;
      p.revealedPrince = false;
    });

    this.nightNumber = 0;
    this.dayNumber = 0;
    this.winner = null;
    return { ok: true };
  }

  // ---------- May trang thai pha ----------

  // io duoc truyen vao de phat broadcast. onPhaseChange(io) la callback chinh
  // duoc goi tu server/index.js de gui du lieu qua socket.
  enterNight(io, broadcastFn) {
    this.skipDayVotes.clear();
    this.dayVotes = {};
    this.nightNumber += 1;
    this.night = this._emptyNightActions();
    this.night.remainingBites = this.doubleKillNextNight ? 2 : 1;
    this.doubleKillNextNight = false;
    this.lastDeaths = [];
    const firstPhase = this.nightNumber === 1 ? PHASE.NIGHT_CUPID : PHASE.NIGHT_GUARD;
    this._goToPhase(io, broadcastFn, firstPhase);
  }

  _hasAlivePlayerWithRole(roleId) {
    return this.alivePlayers().some((p) => p.role === roleId);
  }

  _goToPhase(io, broadcastFn, phase) {
    if (this.timer) clearTimeout(this.timer);

    // Tu dong bo qua cac pha khong co doi tuong tham gia
    if (phase === PHASE.NIGHT_CUPID && (this.nightNumber !== 1 || !this._hasAlivePlayerWithRole('cupid'))) {
      return this._goToPhase(io, broadcastFn, PHASE.NIGHT_GUARD);
    }
    if (phase === PHASE.NIGHT_GUARD && !this._hasAlivePlayerWithRole('guard')) {
      return this._goToPhase(io, broadcastFn, PHASE.NIGHT_WOLVES);
    }
    if (phase === PHASE.NIGHT_WHITEWOLF) {
      const ww = this.alivePlayers().find((p) => p.role === 'whitewolf');
      if (!ww || ww.hasUsedWhiteKill) {
        return this._goToPhase(io, broadcastFn, PHASE.NIGHT_SEER);
      }
    }
    if (phase === PHASE.NIGHT_SEER && !this._hasAlivePlayerWithRole('seer')) {
      return this._goToPhase(io, broadcastFn, PHASE.NIGHT_WITCH);
    }
    if (phase === PHASE.NIGHT_WITCH) {
      const witch = this.alivePlayers().find((p) => p.role === 'witch');
      if (!witch || (witch.hasUsedHeal && witch.hasUsedPoison)) {
        return this._resolveNight(io, broadcastFn);
      }
    }

    this.phase = phase;
    const duration = this.durations[phase] || 15;
    this.phaseEndsAt = Date.now() + duration * 1000;
    broadcastFn(io);

    this.timer = setTimeout(() => this._advanceFromTimer(io, broadcastFn), duration * 1000);
  }

  _advanceFromTimer(io, broadcastFn) {
    switch (this.phase) {
      case PHASE.NIGHT_CUPID:
        return this._goToPhase(io, broadcastFn, PHASE.NIGHT_GUARD);
      case PHASE.NIGHT_GUARD:
        return this._goToPhase(io, broadcastFn, PHASE.NIGHT_WOLVES);
      case PHASE.NIGHT_WOLVES:
        return this._finishWolfRound(io, broadcastFn);
      case PHASE.NIGHT_WHITEWOLF:
        return this._goToPhase(io, broadcastFn, PHASE.NIGHT_SEER);
      case PHASE.NIGHT_SEER:
        return this._goToPhase(io, broadcastFn, PHASE.NIGHT_WITCH);
      case PHASE.NIGHT_WITCH:
        return this._resolveNight(io, broadcastFn);
      case PHASE.DAY_ANNOUNCE:
        return this._afterAnnounce(io, broadcastFn);
      case PHASE.HUNTER_SHOT:
        this._resolveHunterShot(null); // khong chon -> ngau nhien
        return this._continueAfterHunter(io, broadcastFn);
      case PHASE.DAY_DISCUSSION:
        return this._goToPhase(io, broadcastFn, PHASE.DAY_VOTE);
      case PHASE.DAY_VOTE:
        return this._resolveDayVote(io, broadcastFn);
      default:
        return;
    }
  }

  // ---------- Ghi nhan hanh dong tu client ----------

  recordAction(io, broadcastFn, playerId, type, payload) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (this.phase === PHASE.HUNTER_SHOT && type === 'hunter_shoot') {
      if (player.id !== this.pendingHunterQueue[0]) return;
      if (!this.players.get(payload.targetId)?.alive) return;
      this._resolveHunterShot(payload.targetId);
      this._continueAfterHunter(io, broadcastFn);
      return;
    }
    if (!player.alive) return;
    if (type === 'skip_day') {
      if (this.phase !== PHASE.DAY_DISCUSSION || payload.dayNumber !== this.dayNumber) return;
      if (this.skipDayVotes.has(player.id)) return; // bam lai lan nua khong doi gi, dung phat lai state
      this.skipDayVotes.add(player.id);
      if (this.alivePlayers().every(p => this.skipDayVotes.has(p.id))) {
        this.lastVoteResult = { eliminatedId: null, tally: {} };
        this._afterDayFlow(io, broadcastFn); // ham nay tu broadcast khi sang pha moi
        return;
      }
      broadcastFn(); // cap nhat dem "x/y nguoi dong y" cho moi nguoi
      return;
    }
    const prompt = this.getPhasePrompt(player);
    if (prompt.action !== type) return;
    const validTarget = id => prompt.targets?.some(p => p.id === id);
    if (payload.targetId && !validTarget(payload.targetId)) return;
    if (payload.poisonTargetId && !validTarget(payload.poisonTargetId)) return;
    if (type === 'witch_action' && payload.heal && payload.poisonTargetId) return;

    if (this.phase === PHASE.NIGHT_CUPID && type === 'cupid_choose' && player.role === 'cupid') {
      const [a, b] = payload.targetIds || [];
      if (a && b && a !== b && this.players.has(a) && this.players.has(b)) {
        this.players.get(a).loverId = b;
        this.players.get(b).loverId = a;
        this.night.cupidPairChosen = true;
        this._goToPhase(io, broadcastFn, PHASE.NIGHT_GUARD);
      }
      return;
    }

    if (this.phase === PHASE.NIGHT_GUARD && type === 'guard_protect' && player.role === 'guard') {
      const target = payload.targetId;
      if (target === this.lastProtectedId) return; // khong duoc trung nguoi cu
      this.night.guardTarget = target || null;
      this._goToPhase(io, broadcastFn, PHASE.NIGHT_WOLVES);
      return;
    }

    if (this.phase === PHASE.NIGHT_WOLVES && type === 'wolf_vote' && isWolfTeam(player.role)) {
      if (!payload.targetId) return;
      this.night.wolfVotes[player.id] = payload.targetId;
      const wolves = this.aliveWolves();
      const allVoted = wolves.every((w) => this.night.wolfVotes[w.id] !== undefined);
      if (allVoted) {
        this._finishWolfRound(io, broadcastFn);
      }
      return;
    }

    if (this.phase === PHASE.NIGHT_WHITEWOLF && type === 'whitewolf_kill' && player.role === 'whitewolf') {
      if (!player.hasUsedWhiteKill) {
        this.night.whiteWolfTarget = payload.targetId || 'skip';
        if (payload.targetId) player.hasUsedWhiteKill = true;
      } else {
        this.night.whiteWolfTarget = 'skip';
      }
      this._goToPhase(io, broadcastFn, PHASE.NIGHT_SEER);
      return;
    }

    if (this.phase === PHASE.NIGHT_SEER && type === 'seer_check' && player.role === 'seer') {
      this.night.seerTarget = payload.targetId || null;
      const target = this.players.get(payload.targetId);
      if (target) {
        const result = {
          nightNumber: this.nightNumber,
          targetId: target.id,
          targetName: target.name,
          isWolf: isWolfTeam(target.role) || target.role === 'lycan',
        };
        player.seerResults = [...(player.seerResults || []), result];
        io.to(player.socketId).emit('seer_result', result);
      }
      this._goToPhase(io, broadcastFn, PHASE.NIGHT_WITCH);
      return;
    }

    if (this.phase === PHASE.NIGHT_WITCH && type === 'witch_action' && player.role === 'witch') {
      if (prompt.step === 'heal') {
        if (typeof payload.heal !== 'boolean' || payload.poisonTargetId) return;
        this.night.witchHealDecided = true;
        if (payload.heal && prompt.canHeal) {
          this.night.witchHeal = true;
          player.hasUsedHeal = true;
        }
        if (!player.hasUsedPoison) {
          // Con binh doc: phat lai state de phu thuy nhan prompt buoc 'poison'.
          // Thieu dong nay thi phu thuy dung yen o buoc 'heal' cho den khi het gio.
          broadcastFn();
          return;
        }
        this._resolveNight(io, broadcastFn);
        return;
      }
      if (payload.heal !== undefined) return;
      if (payload.poisonTargetId && !player.hasUsedPoison) {
        this.night.witchPoisonTarget = payload.poisonTargetId;
        player.hasUsedPoison = true;
      }
      this._resolveNight(io, broadcastFn);
      return;
    }

    if (this.phase === PHASE.DAY_VOTE && type === 'day_vote') {
      this.dayVotes[player.id] = payload.targetId || null; // null = bo phieu trang
      const alive = this.alivePlayers();
      const allVoted = alive.every((p) => this.dayVotes[p.id] !== undefined);
      if (allVoted) this._resolveDayVote(io, broadcastFn);
      return;
    }
  }

  _finishWolfRound(io, broadcastFn) {
    this._tallyWolfVotes();
    const victim = this.night.currentWolfVictim;
    if (victim) this.night.wolfVictims.push(victim);
    this.night.remainingBites -= 1;
    if (this.night.remainingBites > 0) {
      this.night.wolfVotes = {};
      this.night.wolfRound += 1;
      return this._goToPhase(io, broadcastFn, PHASE.NIGHT_WOLVES);
    }
    this.night.currentWolfVictim = this.night.wolfVictims[0] || null;
    return this._goToPhase(io, broadcastFn, PHASE.NIGHT_WHITEWOLF);
  }

  _tallyWolfVotes() {
    const tally = {};
    for (const targetId of Object.values(this.night.wolfVotes)) {
      if (!targetId) continue;
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
    this.night.currentWolfVictim = this._pickTopVoted(tally);
  }

  _pickTopVoted(tally) {
    const entries = Object.entries(tally);
    if (!entries.length) return null;
    const max = Math.max(...entries.map(([, v]) => v));
    const top = entries.filter(([, v]) => v === max).map(([k]) => k);
    return top[Math.floor(Math.random() * top.length)];
  }

  // ---------- Xu ly ket qua dem ----------

  _resolveNight(io, broadcastFn) {
    if (this.timer) clearTimeout(this.timer);
    const deaths = new Set();
    const n = this.night;

    for (const p of this.alivePlayers()) {
      if (p.doomedNight && p.doomedNight <= this.nightNumber) deaths.add(p.id);
    }
    for (const victimId of n.wolfVictims) {
      const victim = this.players.get(victimId);
      if (!victim?.alive || victimId === n.guardTarget || (n.witchHeal && victimId === n.currentWolfVictim)) continue;
      if (victim.role === 'cursed') { victim.role = 'werewolf'; continue; }
      if (victim.role === 'elder' && victim.biteCount++ === 0) continue;
      if (victim.role === 'toughguy') {
        if (!victim.doomedNight) victim.doomedNight = this.nightNumber + 1;
        continue;
      }
      deaths.add(victimId);
    }

    if (n.whiteWolfTarget && n.whiteWolfTarget !== 'skip' && n.whiteWolfTarget !== n.guardTarget) {
      deaths.add(n.whiteWolfTarget);
    }

    if (n.witchPoisonTarget) {
      deaths.add(n.witchPoisonTarget); // thuoc doc khong the can duoc bao ve chan
    }

    this.lastProtectedId = n.guardTarget || null;

    // Neu soi con chet dem nay -> dem sau soi duoc can 2 nguoi


    this._applyDeaths(io, [...deaths]);

    this.dayNumber += 1;
    this._goToPhase(io, broadcastFn, PHASE.DAY_ANNOUNCE);
  }

  // Ap dung tu vong: xu ly lan chuoi nguoi yeu (Cupid) va dua tho san vao hang doi
  _applyDeaths(io, ids) {
    const queue = [...ids];
    const processed = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (processed.has(id)) continue;
      const p = this.players.get(id);
      if (!p || !p.alive) continue;
      p.alive = false;
      if (p.role === 'wolfcub') this.doubleKillNextNight = true;
      processed.add(id);
      this.lastDeaths.push({ id: p.id, name: p.name, role: p.role });

      if (p.loverId) {
        const lover = this.players.get(p.loverId);
        if (lover && lover.alive) queue.push(lover.id);
      }
      if (p.role === 'hunter') {
        this.pendingHunterQueue.push(p.id);
      }
    }
  }

  _afterAnnounce(io, broadcastFn) {
    if (this.pendingHunterQueue.length) {
      this.afterHunterResume = 'NIGHT';
      return this._goToPhase(io, broadcastFn, PHASE.HUNTER_SHOT);
    }
    return this._afterNightFlow(io, broadcastFn);
  }

  _afterNightFlow(io, broadcastFn) {
    const result = this._checkWinCondition();
    if (result) return this._endGame(io, broadcastFn, result);
    this._goToPhase(io, broadcastFn, PHASE.DAY_DISCUSSION);
  }

  _resolveHunterShot(targetId) {
    const hunterId = this.pendingHunterQueue.shift();
    let finalTarget = targetId;
    if (!finalTarget) {
      const candidates = this.alivePlayers().filter((p) => p.id !== hunterId);
      if (candidates.length) {
        finalTarget = candidates[Math.floor(Math.random() * candidates.length)].id;
      }
    }
    if (finalTarget) this._applyDeaths(null, [finalTarget]);
  }

  _continueAfterHunter(io, broadcastFn) {
    if (this.pendingHunterQueue.length) {
      return this._goToPhase(io, broadcastFn, PHASE.HUNTER_SHOT);
    }
    if (this.afterHunterResume === 'NIGHT') {
      this.afterHunterResume = null;
      return this._afterNightFlow(io, broadcastFn);
    }
    this.afterHunterResume = null;
    return this._afterDayFlow(io, broadcastFn);
  }

  // ---------- Xu ly bo phieu ban ngay ----------

  _resolveDayVote(io, broadcastFn) {
    if (this.timer) clearTimeout(this.timer);
    const tally = {};
    for (const targetId of Object.values(this.dayVotes)) {
      if (!targetId) continue;
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
    const entries = Object.entries(tally);
    let eliminatedId = null;
    if (entries.length) {
      const max = Math.max(...entries.map(([, v]) => v));
      const top = entries.filter(([, v]) => v === max).map(([k]) => k);
      if (top.length === 1) eliminatedId = top[0]; // hoa phieu -> khong ai bi treo co
    }
    this.lastVoteResult = { eliminatedId, tally };
    this.dayVotes = {};

    const eliminated = this.players.get(eliminatedId);
    if (eliminated?.role === 'tanner') {
      this._applyDeaths(io, [eliminatedId]);
      return this._endGame(io, broadcastFn, { winner: 'tanner', reason: eliminated.name + ' đã đạt mục tiêu bị treo cổ.' });
    }
    if (eliminated?.role === 'prince' && !eliminated.revealedPrince) {
      eliminated.revealedPrince = true;
      this.lastVoteResult.eliminatedId = null;
    } else if (eliminatedId) this._applyDeaths(io, [eliminatedId]);

    if (this.pendingHunterQueue.length) {
      this.afterHunterResume = 'DAY';
      return this._goToPhase(io, broadcastFn, PHASE.HUNTER_SHOT);
    }
    this._afterDayFlow(io, broadcastFn);
  }

  _afterDayFlow(io, broadcastFn) {
    const result = this._checkWinCondition();
    if (result) return this._endGame(io, broadcastFn, result);
    this.enterNight(io, broadcastFn);
  }

  // ---------- Dieu kien thang thua ----------

  _checkWinCondition() {
    const alive = this.alivePlayers();
    const whitewolf = alive.find((p) => p.role === 'whitewolf');

    if (whitewolf && alive.length === 1) {
      return { winner: 'whitewolf', reason: 'Sói trắng là người sống sót cuối cùng' };
    }

    if (alive.length === 2 && alive[0].loverId === alive[1].id) {
      return { winner: 'lovers', reason: 'Cặp đôi yêu nhau là 2 người sống sót cuối cùng' };
    }

    const wolfTeam = alive.filter((p) => isWolfTeam(p.role));
    const villageTeam = alive.filter((p) => !isWolfTeam(p.role) && !this.night.wolfVictims.includes(p.id));

    if (wolfTeam.length === 0) {
      return { winner: 'village', reason: 'Tất cả Sói đã bị tiêu diệt' };
    }
    if (!whitewolf && wolfTeam.length >= villageTeam.length) {
      return { winner: 'wolves', reason: 'Số lượng Sói áp đảo Dân làng' };
    }
    return null;
  }

  _endGame(io, broadcastFn, result) {
    if (this.timer) clearTimeout(this.timer);
    this.phase = PHASE.GAME_OVER;
    this.winner = result;
    this.phaseEndsAt = null;
    broadcastFn(io);
  }

  // ---------- Serialize trang thai de gui qua socket ----------

  publicPlayerList() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      alive: p.alive,
      connected: p.connected,
      // Khi game ket thuc, lo het vai tro cho moi nguoi xem
      role: this.phase === PHASE.GAME_OVER || (p.alive && p.revealedPrince) ? p.role : undefined,
      roleName: (this.phase === PHASE.GAME_OVER || (p.alive && p.revealedPrince)) && p.role ? ROLE_INFO[p.role].name : undefined,
    }));
  }

  getPhasePrompt(player) {
    // Tra ve huong dan + danh sach muc tieu hop le rieng cho tung nguoi choi trong pha hien tai
    const alive = this.alivePlayers();
    const others = (excludeSelf) => alive.filter((p) => (excludeSelf ? p.id !== player.id : true));

    if (!player.alive && !(this.phase === PHASE.HUNTER_SHOT && player.id === this.pendingHunterQueue[0])) return { action: null, message: 'Bạn đã mất, chỉ có thể quan sát.' };
    switch (this.phase) {
      case PHASE.NIGHT_CUPID:
        if (player.role === 'cupid') {
          return { action: 'cupid_choose', message: 'Chọn 2 người để kết thành đôi tình nhân', targets: alive.map((p) => ({ id: p.id, name: p.name })) };
        }
        return { action: null, message: 'Thần tình yêu đang chọn cặp đôi...' };
      case PHASE.NIGHT_GUARD:
        if (player.role === 'guard') {
          return {
            action: 'guard_protect',
            message: 'Chọn một người để bảo vệ đêm nay',
            targets: others(false).filter((p) => p.id !== this.lastProtectedId).map((p) => ({ id: p.id, name: p.name })),
          };
        }
        return { action: null, message: 'Bảo vệ đang làm nhiệm vụ...' };
      case PHASE.NIGHT_WOLVES:
        if (isWolfTeam(player.role)) {
          const teammates = alive.filter((p) => isWolfTeam(p.role)).map((p) => ({ id: p.id, name: p.name, role: p.role }));
          return {
            action: 'wolf_vote',
            message: this.night.wolfRound === 2 ? 'Sói con trả thù: chọn nạn nhân thứ hai' : 'Cả bầy chọn một người để cắn',
            targets: others(true).filter((p) => !isWolfTeam(p.role) && !this.night.wolfVictims.includes(p.id)).map((p) => ({ id: p.id, name: p.name })),
            teammates,
          };
        }
        return { action: null, message: 'Bầy Sói đang săn mồi...' };
      case PHASE.NIGHT_WHITEWOLF:
        if (player.role === 'whitewolf') {
          const teammates = alive.filter((p) => isWolfTeam(p.role) && p.id !== player.id);
          return { action: 'whitewolf_kill', message: 'Bạn có thể giết một Sói đồng bọn (dùng 1 lần duy nhất)', targets: teammates.map((p) => ({ id: p.id, name: p.name })) };
        }
        return { action: null, message: '...' };
      case PHASE.NIGHT_SEER:
        if (player.role === 'seer') {
          return { action: 'seer_check', message: 'Chọn một người để soi', targets: others(true).map((p) => ({ id: p.id, name: p.name })) };
        }
        return { action: null, message: 'Tiên tri đang dò xem vận mệnh...' };
      case PHASE.NIGHT_WITCH:
        if (player.role === 'witch') {
          const victim = !player.hasUsedHeal && this.night.currentWolfVictim ? this.players.get(this.night.currentWolfVictim) : null;
          const step = !player.hasUsedHeal && !this.night.witchHealDecided ? 'heal' : 'poison';
          return {
            action: 'witch_action',
            step,
            message: step === 'heal' ? (victim ? `Sói cắn ${victim.name} trong đêm nay. Bạn có muốn cứu không?` : 'Đêm nay không có nạn nhân để cứu. Tiếp tục đến bước thuốc độc.') : 'Bạn có muốn dùng thuốc độc? Chọn một người hoặc bỏ qua.',
            victimName: step === 'heal' && victim ? victim.name : null,
            canHeal: !player.hasUsedHeal && !!victim,
            canPoison: !player.hasUsedPoison,
            targets: others(true).map((p) => ({ id: p.id, name: p.name })),
          };
        }
        return { action: null, message: 'Phù thủy đang bào chế thuốc...' };
      case PHASE.HUNTER_SHOT: {
        const hunterId = this.pendingHunterQueue[0];
        if (player.id === hunterId) {
          return { action: 'hunter_shoot', message: 'Bạn đã chết! Chọn một người để bắn hạ trước khi ra đi', targets: others(true).map((p) => ({ id: p.id, name: p.name })) };
        }
        return { action: null, message: 'Thợ săn đang trầm ngâm trước khi ra đi...' };
      }
      case PHASE.DAY_VOTE:
        if (player.alive) {
          return { action: 'day_vote', message: 'Bỏ phiếu cho người bạn nghi là Sói', targets: others(true).map((p) => ({ id: p.id, name: p.name })) };
        }
        return { action: null, message: 'Bạn đã mất, chỉ có thể quan sát' };
      default:
        return { action: null, message: null };
    }
  }

  publicState() {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      actionRound: this.night.wolfRound,
      nightNumber: this.nightNumber,
      dayNumber: this.dayNumber,
      skipDayVotes: this.phase === PHASE.DAY_DISCUSSION ? [...this.skipDayVotes] : [],
      players: this.publicPlayerList(),
      hostId: this.hostId,
      lastDeaths: this.phase === PHASE.DAY_ANNOUNCE || this.phase === PHASE.DAY_DISCUSSION ? this._recentDeathsSummary() : undefined,
      lastVoteResult: this.phase === PHASE.DAY_RESOLVE || this.phase === PHASE.NIGHT_GUARD ? this.lastVoteResult : undefined,
      winner: this.winner,
      roleConfig: this.roleConfig,
    };
  }

  _recentDeathsSummary() {
    // Chi lay nhung nguoi chet trong lan resolve gan nhat (dem hoac ban ngay)
    return this.lastDeaths.map((d) => ({ id: d.id, name: d.name }));
  }
}

module.exports = { Game, PHASE, DEFAULT_DURATIONS };
