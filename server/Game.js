// server/Game.js
// Quan ly toan bo vong doi cua mot phong choi: lobby -> dem/ngay -> ket thuc.

const {
  ROLE_INFO,
  isWolfTeam,
  getDefaultRoleConfig,
  validateRoleConfig,
  expandRoleConfig,
} = require('./roles');
const { validActionPayload } = require('./Security');

const PHASE = {
  LOBBY: 'LOBBY',
  ROLE_REVEAL: 'ROLE_REVEAL',
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
  DAY_DEFENSE: 'DAY_DEFENSE',
  DAY_JUDGEMENT: 'DAY_JUDGEMENT',
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
  DAY_DEFENSE: 30,
  DAY_JUDGEMENT: 20,
  DAY_RESOLVE: 5,
};

// Khi tat ca da bo phieu, khong chot ngay ma de lai ngan nay giay cho ai muon doi y.
const CHANGE_VOTE_GRACE_MS = 5000;

// Cac hanh dong duoc phep gui lai nhieu lan trong cung mot luot (doi phieu, nem ca chua/tang hoa).
// Cac hanh dong con lai van chot mot lan de tranh doi y sau khi da biet ket qua.
const CHANGEABLE_ACTIONS = new Set(['day_vote', 'judge_vote', 'react']);

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
    this.accusedId = null;   // nguoi bi nhieu phieu nhat, dang duoc bien ho
    this.judgeVotes = {};    // voterId -> 'kill' | 'spare'
    this.reactionCounts = {};// playerId -> { tomato, flower }
    this.lastReactionAt = new Map();
    this.winner = null;
    this.actionVersion = 0;
    this.readyPlayers = new Set();
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
    if (durations !== undefined && (!durations || typeof durations !== 'object' || Array.isArray(durations) ||
      Object.entries(durations).some(([phase, seconds]) => !Object.hasOwn(DEFAULT_DURATIONS, phase) || !Number.isInteger(seconds) || seconds < 1 || seconds > 600))) {
      return { ok: false, errors: ['Thời gian mỗi lượt phải là số nguyên từ 1 đến 600 giây.'] };
    }
    this.lastProtectedId = null;
    this.doubleKillNextNight = false;
    this.pendingHunterQueue = [];
    this.dayVotes = {};
    this.lastDeaths = [];
    this.lastVoteResult = null;
    this.afterHunterResume = null;
    this.readyPlayers.clear();
    this.skipDayVotes.clear();
    this.night = this._emptyNightActions();
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
      p.lastAction = null;
    });

    this.nightNumber = 0;
    this.dayNumber = 0;
    this.winner = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.phase = PHASE.ROLE_REVEAL;
    this.phaseEndsAt = null;
    this.actionVersion++;
    return { ok: true };
  }

  startWhenReady(io, broadcastFn) {
    if (this.phase !== PHASE.ROLE_REVEAL || !this.players.size) return false;
    if (![...this.players.values()].every(p => p.connected && this.readyPlayers.has(p.id))) return false;
    this.enterNight(io, broadcastFn);
    return true;
  }

  // ---------- May trang thai pha ----------

  // io duoc truyen vao de phat broadcast. onPhaseChange(io) la callback chinh
  // duoc goi tu server/index.js de gui du lieu qua socket.
  enterNight(io, broadcastFn) {
    this.skipDayVotes.clear();
    this.dayVotes = {};
    this.judgeVotes = {};
    this.accusedId = null;
    this.reactionCounts = {};
    this.nightNumber += 1;
    this.night = this._emptyNightActions();
    this.night.remainingBites = this.doubleKillNextNight ? 2 : 1;
    this.doubleKillNextNight = false;
    this.lastDeaths = [];
    const firstPhase = this.nightNumber === 1 ? PHASE.NIGHT_CUPID : PHASE.NIGHT_GUARD;
    this._goToPhase(io, broadcastFn, firstPhase);
  }

  // Luat chuan: Soi trang thuc day CACH MOT DEM, bat dau tu dem thu hai.
  // Lich nay ai cung biet, nen bo qua dem le khong lo gi; con Soi trang da chet thi
  // van phai goi dung lich de khong ai biet no da chet.
  _whiteWolfActsTonight() {
    return this.nightNumber >= 2 && this.nightNumber % 2 === 0 && this._roleInGame('whitewolf');
  }

  // Vai nay co nam trong bo vai cua van (bo vai cong khai cho ca phong) hay khong.
  _roleInGame(roleId) {
    if (this.roleConfig) return (this.roleConfig[roleId] || 0) > 0;
    return [...this.players.values()].some((p) => p.role === roleId);
  }

  // Nguoi thuc hien luot dem nay con song khong. Cac pha khong phai luot cua mot vai thi coi nhu co.
  _phaseActorAlive(phase) {
    const actor = { NIGHT_CUPID: 'cupid', NIGHT_GUARD: 'guard', NIGHT_WHITEWOLF: 'whitewolf', NIGHT_SEER: 'seer', NIGHT_WITCH: 'witch' }[phase];
    return !actor || this._hasAlivePlayerWithRole(actor);
  }

  // Luot gia khi nguoi giu vai da chet: 5-10 giay nhu mot nguoi that dang chon, khong dai hon luot that.
  _fakeTurnSeconds(max) {
    const low = Math.min(5, max);
    const high = Math.min(10, max);
    return low + Math.round(Math.random() * (high - low));
  }

  _hasAlivePlayerWithRole(roleId) {
    return this.alivePlayers().some((p) => p.role === roleId);
  }

  _goToPhase(io, broadcastFn, phase) {
    if (this.timer) clearTimeout(this.timer);

    // Chi bo qua pha cua vai KHONG CO trong van. Bo vai duoc cong khai cho ca phong, nen
    // bo qua mot vai CO trong van (vi nguoi giu vai da chet, hay Phu thuy da het thuoc)
    // se lam lo ngay nguoi do da chet: dan chuyen khong goi toi vai do nua.
    if (phase === PHASE.NIGHT_CUPID && (this.nightNumber !== 1 || !this._roleInGame('cupid'))) {
      return this._goToPhase(io, broadcastFn, PHASE.NIGHT_GUARD);
    }
    if (phase === PHASE.NIGHT_GUARD && !this._roleInGame('guard')) {
      return this._goToPhase(io, broadcastFn, PHASE.NIGHT_WOLVES);
    }
    if (phase === PHASE.NIGHT_WHITEWOLF && !this._whiteWolfActsTonight()) {
      return this._goToPhase(io, broadcastFn, PHASE.NIGHT_SEER);
    }
    if (phase === PHASE.NIGHT_SEER && !this._roleInGame('seer')) {
      return this._goToPhase(io, broadcastFn, PHASE.NIGHT_WITCH);
    }
    if (phase === PHASE.NIGHT_WITCH && !this._roleInGame('witch')) {
      return this._resolveNight(io, broadcastFn);
    }

    this.phase = phase;
    this.actionVersion++;
    let duration = this.durations[phase] || 15;
    // Vai co trong van nhung nguoi giu vai da chet: van goi vai (dan chuyen doc binh thuong)
    // va cho mot khoang ngau nhien giong nhu co nguoi dang chon, roi moi sang luot sau.
    if (!this._phaseActorAlive(phase)) duration = this._fakeTurnSeconds(duration);
    this.phaseEndsAt = Date.now() + duration * 1000;
    broadcastFn(io);

    this.timer = setTimeout(() => this._advanceFromTimer(io, broadcastFn), duration * 1000);
  }

  // Rut ngan pha dang chay xuong con ms mili giay (khong bao gio keo dai them).
  _shortenPhase(io, broadcastFn, ms, onEnd) {
    const endsAt = Date.now() + ms;
    if (this.phaseEndsAt !== null && this.phaseEndsAt <= endsAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.phaseEndsAt = endsAt;
    this.timer = setTimeout(onEnd, ms);
    this.timer.unref?.();
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
      case PHASE.DAY_DEFENSE:
        return this._goToPhase(io, broadcastFn, PHASE.DAY_JUDGEMENT);
      case PHASE.DAY_JUDGEMENT:
        return this._resolveJudgement(io, broadcastFn);
      default:
        return;
    }
  }

  // ---------- Ghi nhan hanh dong tu client ----------

  recordAction(io, broadcastFn, playerId, type, payload, actionVersion = this.actionVersion) {
    const player = this.players.get(playerId);
    if (!player?.connected || !validActionPayload(type, payload)) return { ok: false, error: 'Hành động không hợp lệ.' };
    // A retry of an accepted request must never execute the action a second time.
    const payloadKey = JSON.stringify(payload);
    const repeat = player.lastAction?.version === actionVersion && player.lastAction.type === type;
    // Gui lai y het = client thu lai goi tin cu, khong duoc chay hanh dong lan hai.
    // Rieng 'react' thi lan gui thu hai la mot cu nem moi that su, da co do tre 700ms chan spam.
    if (repeat && player.lastAction.payloadKey === payloadKey && type !== 'react') {
      return { ok: true, actionVersion };
    }
    if (repeat && !CHANGEABLE_ACTIONS.has(type)) {
      return { ok: false, error: 'Bạn đã xác nhận lựa chọn khác trong lượt này.' };
    }
    if (actionVersion !== this.actionVersion) return { ok: false, error: 'Lượt đã thay đổi. Hãy chọn lại ở lượt hiện tại.' };
    let changed = false;
    const broadcast = () => { changed = true; broadcastFn(io); };
    const previousAction = player.lastAction;
    player.lastAction = { version: actionVersion, type, payloadKey };
    const accepted = this._recordAction(io, broadcast, playerId, type, payload);
    if (!accepted) {
      player.lastAction = previousAction;
      return { ok: false, error: 'Không thể thực hiện lựa chọn này. Hãy kiểm tra lượt và mục tiêu.' };
    }
    if (!changed) broadcastFn(io);
    return { ok: true, actionVersion };
  }

  _recordAction(io, broadcastFn, playerId, type, payload) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (type === 'ready') {
      if (this.phase !== PHASE.ROLE_REVEAL || this.readyPlayers.has(player.id)) return false;
      this.readyPlayers.add(player.id);
      this.startWhenReady(io, broadcastFn);
      return true;
    }
    if (this.phase === PHASE.HUNTER_SHOT && type === 'hunter_shoot') {
      if (player.id !== this.pendingHunterQueue[0]) return;
      if (!this.players.get(payload.targetId)?.alive) return;
      this._resolveHunterShot(payload.targetId);
      this._continueAfterHunter(io, broadcastFn);
      return true;
    }
    if (!player.alive) return;
    if (type === 'skip_day') {
      if (this.phase !== PHASE.DAY_DISCUSSION || payload.dayNumber !== this.dayNumber) return;
      if (this.skipDayVotes.has(player.id)) return; // bam lai lan nua khong doi gi, dung phat lai state
      this.skipDayVotes.add(player.id);
      if (this.alivePlayers().every(p => this.skipDayVotes.has(p.id))) {
        this.lastVoteResult = { eliminatedId: null, tally: {} };
        this._afterDayFlow(io, broadcastFn); // ham nay tu broadcast khi sang pha moi
        return true;
      }
      broadcastFn(); // cap nhat dem "x/y nguoi dong y" cho moi nguoi
      return true;
    }
    const prompt = this.getPhasePrompt(player);
    if (prompt.action !== type) return;
    const validTarget = id => prompt.targets?.some(p => p.id === id);
    if (payload.targetId && !validTarget(payload.targetId)) return;
    if (payload.poisonTargetId && !validTarget(payload.poisonTargetId)) return;
    if (type === 'witch_action' && payload.heal && payload.poisonTargetId) return;

    if (this.phase === PHASE.NIGHT_CUPID && type === 'cupid_choose' && player.role === 'cupid') {
      const [a, b] = payload.targetIds || [];
      if (a && b && a !== b && validTarget(a) && validTarget(b)) {
        this.players.get(a).loverId = b;
        this.players.get(b).loverId = a;
        this.night.cupidPairChosen = true;
        this._goToPhase(io, broadcastFn, PHASE.NIGHT_GUARD);
        return true;
      }
      return;
    }

    if (this.phase === PHASE.NIGHT_GUARD && type === 'guard_protect' && player.role === 'guard') {
      const target = payload.targetId;
      if (target && target === this.lastProtectedId) return; // khong duoc trung nguoi cu
      this.night.guardTarget = target || null;
      this._goToPhase(io, broadcastFn, PHASE.NIGHT_WOLVES);
      return true;
    }

    if (this.phase === PHASE.NIGHT_WOLVES && type === 'wolf_vote' && isWolfTeam(player.role)) {
      if (!payload.targetId) return;
      this.night.wolfVotes[player.id] = payload.targetId;
      const wolves = this.aliveWolves();
      const allVoted = wolves.every((w) => this.night.wolfVotes[w.id] !== undefined);
      if (allVoted) {
        this._finishWolfRound(io, broadcastFn);
      }
      return true;
    }

    if (this.phase === PHASE.NIGHT_WHITEWOLF && type === 'whitewolf_kill' && player.role === 'whitewolf') {
      this.night.whiteWolfTarget = payload.targetId || 'skip';
      if (payload.targetId) player.hasUsedWhiteKill = true; // chi de hien thi, khong con chan luot sau
      this._goToPhase(io, broadcastFn, PHASE.NIGHT_SEER);
      return true;
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
      return true;
    }

    if (this.phase === PHASE.NIGHT_WITCH && type === 'witch_action' && player.role === 'witch') {
      if (prompt.step === 'heal') {
        if (typeof payload.heal !== 'boolean' || payload.poisonTargetId) return;
        if (payload.heal && !prompt.canHeal) return;
        this.night.witchHealDecided = true;
        if (payload.heal && prompt.canHeal) {
          this.night.witchHeal = true;
          player.hasUsedHeal = true;
        }
        if (!player.hasUsedPoison) {
          // Con binh doc: phat lai state de phu thuy nhan prompt buoc 'poison'.
          // Thieu dong nay thi phu thuy dung yen o buoc 'heal' cho den khi het gio.
          this.actionVersion++;
          broadcastFn();
          return true;
        }
        this._resolveNight(io, broadcastFn);
        return true;
      }
      if (payload.heal !== undefined) return;
      if (payload.poisonTargetId && !player.hasUsedPoison) {
        this.night.witchPoisonTarget = payload.poisonTargetId;
        player.hasUsedPoison = true;
      }
      this._resolveNight(io, broadcastFn);
      return true;
    }

    if (this.phase === PHASE.DAY_VOTE && type === 'day_vote') {
      this.dayVotes[player.id] = payload.targetId || null; // null = bo phieu trang
      // Du phieu roi thi khong chot ngay: de lai vai giay cho ai muon doi y.
      if (this.alivePlayers().every((p) => this.dayVotes[p.id] !== undefined)) {
        this._shortenPhase(io, broadcastFn, CHANGE_VOTE_GRACE_MS, () => this._resolveDayVote(io, broadcastFn));
      }
      broadcastFn(); // cap nhat bang phieu truc tiep cho ca phong
      return true;
    }

    if (this.phase === PHASE.DAY_JUDGEMENT && type === 'judge_vote') {
      if (player.id === this.accusedId) return; // nguoi bi xu khong duoc tu bo phieu
      if (player.loverId === this.accusedId && payload.verdict === 'kill') return; // khong bo phieu treo co nguoi minh yeu
      this.judgeVotes[player.id] = payload.verdict;
      const voters = this.alivePlayers().filter((p) => p.id !== this.accusedId);
      if (voters.every((p) => this.judgeVotes[p.id] !== undefined)) {
        this._shortenPhase(io, broadcastFn, CHANGE_VOTE_GRACE_MS, () => this._resolveJudgement(io, broadcastFn));
      }
      broadcastFn();
      return true;
    }

    if (type === 'react') {
      if (this.phase !== PHASE.DAY_DEFENSE && this.phase !== PHASE.DAY_JUDGEMENT) return;
      if (payload.targetId !== this.accusedId) return; // chi nem/tang cho nguoi dang bien ho
      const now = Date.now();
      if (now - (this.lastReactionAt.get(player.id) ?? -Infinity) < 700) return; // chong spam
      this.lastReactionAt.set(player.id, now);
      const counts = this.reactionCounts[payload.targetId] ||= { tomato: 0, flower: 0 };
      counts[payload.kind] += 1;
      io.to(this.roomCode).emit('reaction', { kind: payload.kind, targetId: payload.targetId, fromName: player.name });
      broadcastFn();
      return true;
    }
  }

  _finishWolfRound(io, broadcastFn) {
    this._tallyWolfVotes();
    const victim = this.night.currentWolfVictim;
    // Preserve the slot even when a round has no eligible victim.
    this.night.wolfVictims[this.night.wolfRound - 1] = victim || null;
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
    if(!this.night.currentWolfVictim && this.aliveWolves().length){
      const targets=this.alivePlayers().filter(p=>!isWolfTeam(p.role)&&!this.night.wolfVictims.includes(p.id));
      if(targets.length)this.night.currentWolfVictim=targets[Math.floor(Math.random()*targets.length)].id;
    }
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

  _tally(votes) {
    const tally = {};
    for (const targetId of Object.values(votes)) {
      if (!targetId) continue;
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
    return tally;
  }

  // Nguoi bi nhieu phieu nhat. Hoa phieu -> khong ai bi dua ra bien ho.
  _topVoted(tally) {
    const entries = Object.entries(tally);
    if (!entries.length) return null;
    const max = Math.max(...entries.map(([, v]) => v));
    const top = entries.filter(([, v]) => v === max).map(([k]) => k);
    return top.length === 1 ? top[0] : null;
  }

  // Buoc 1: het gio neu ten. Ai bi nhieu phieu nhat thi duoc bien ho truoc khi lang phan quyet.
  _resolveDayVote(io, broadcastFn) {
    if (this.timer) clearTimeout(this.timer);
    const tally = this._tally(this.dayVotes);
    const accusedId = this._topVoted(tally);
    this.lastVoteResult = { eliminatedId: null, tally, accusedId, judgement: null };

    if (!accusedId) {
      this.dayVotes = {};
      return this._afterDayFlow(io, broadcastFn); // hoa phieu hoac khong ai bi neu ten
    }
    this.accusedId = accusedId;
    this.judgeVotes = {};
    this.reactionCounts = {};
    this._goToPhase(io, broadcastFn, PHASE.DAY_DEFENSE);
  }

  // Buoc 3: dem phieu "treo co" / "tha". Hoa phieu hoac it phieu treo co hon -> duoc tha.
  _resolveJudgement(io, broadcastFn) {
    if (this.timer) clearTimeout(this.timer);
    const accusedId = this.accusedId;
    const votes = Object.values(this.judgeVotes);
    const kill = votes.filter((v) => v === 'kill').length;
    const spare = votes.filter((v) => v === 'spare').length;
    const judgement = { kill, spare, votes: { ...this.judgeVotes } };
    this.lastVoteResult = { ...(this.lastVoteResult || {}), accusedId, judgement, eliminatedId: null };
    this.dayVotes = {};
    this.judgeVotes = {};
    this.accusedId = null;

    if (kill <= spare) return this._afterDayFlow(io, broadcastFn); // duoc tha
    this.lastVoteResult.eliminatedId = accusedId;
    return this._eliminateByVote(io, broadcastFn, accusedId);
  }

  _eliminateByVote(io, broadcastFn, eliminatedId) {
    const eliminated = this.players.get(eliminatedId);
    if (eliminated?.role === 'tanner') {
      this._applyDeaths(io, [eliminatedId]);
      return this._endGame(io, broadcastFn, { winner: 'tanner', reason: eliminated.name + ' đã đạt mục tiêu bị treo cổ.' });
    }
    if (eliminated?.role === 'prince' && !eliminated.revealedPrince) {
      eliminated.revealedPrince = true;
      this.lastVoteResult.eliminatedId = null;
      this.lastVoteResult.princeSaved = true;
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
    const villageTeam = alive.filter((p) => !isWolfTeam(p.role));

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
    this.actionVersion++;
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
          return { action: 'whitewolf_kill', message: 'Bạn có thể giết một Sói đồng bọn (lượt này diễn ra cách một đêm)', targets: teammates.map((p) => ({ id: p.id, name: p.name })) };
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
          return {
            action: 'day_vote',
            // Luat chuan: nguoi yeu khong duoc bo phieu chong lai nhau, nen an ho khoi danh sach
            message: 'Nêu tên người bạn nghi là Sói. Bạn có thể đổi phiếu cho tới khi hết giờ.',
            targets: others(true).filter((p) => p.id !== player.loverId).map((p) => ({ id: p.id, name: p.name })),
          };
        }
        return { action: null, message: 'Bạn đã mất, chỉ có thể quan sát' };
      case PHASE.DAY_DEFENSE: {
        const accused = this.players.get(this.accusedId);
        if (!accused) return { action: null, message: null };
        if (player.id === this.accusedId) {
          return { action: null, message: 'Bạn bị nêu tên. Hãy biện hộ cho mình trước khi cả làng phán quyết.' };
        }
        return {
          action: 'react',
          message: `${accused.name} đang biện hộ. Hãy lắng nghe, ném cà chua hoặc tặng hoa.`,
          targets: [{ id: accused.id, name: accused.name }],
        };
      }
      case PHASE.DAY_JUDGEMENT: {
        const accused = this.players.get(this.accusedId);
        if (!accused) return { action: null, message: null };
        if (player.id === this.accusedId) {
          return { action: null, message: 'Cả làng đang phán quyết số phận của bạn.' };
        }
        if (!player.alive) return { action: null, message: `Cả làng đang phán quyết ${accused.name}.` };
        // Nguoi yeu khong duoc gop phieu treo co nguoi minh yeu
        const isLover = player.loverId === accused.id;
        return {
          action: 'judge_vote',
          message: isLover
            ? `${accused.name} là người yêu của bạn. Bạn chỉ có thể xin tha.`
            : `Treo cổ ${accused.name} hay tha? Bạn có thể đổi ý cho tới khi hết giờ.`,
          accusedName: accused.name,
          onlySpare: isLover,
          targets: [{ id: accused.id, name: accused.name }],
        };
      }
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
      actionVersion: this.actionVersion,
      readyPlayers: this.phase === PHASE.ROLE_REVEAL ? [...this.readyPlayers] : [],
      nightNumber: this.nightNumber,
      dayNumber: this.dayNumber,
      skipDayVotes: this.phase === PHASE.DAY_DISCUSSION ? [...this.skipDayVotes] : [],
      // Bang phieu cong khai: ai neu ten ai, cap nhat ngay khi co nguoi bo phieu.
      dayVotes: this.phase === PHASE.DAY_VOTE ? { ...this.dayVotes } : undefined,
      accusedId: this.phase === PHASE.DAY_DEFENSE || this.phase === PHASE.DAY_JUDGEMENT ? this.accusedId : undefined,
      judgeVotes: this.phase === PHASE.DAY_JUDGEMENT ? { ...this.judgeVotes } : undefined,
      reactionCounts: this.phase === PHASE.DAY_DEFENSE || this.phase === PHASE.DAY_JUDGEMENT ? this.reactionCounts : undefined,
      players: this.publicPlayerList(),
      hostId: this.hostId,
      lastDeaths: this.phase === PHASE.DAY_ANNOUNCE || this.phase === PHASE.DAY_DISCUSSION ? this._recentDeathsSummary() : undefined,
      lastVoteResult: [PHASE.DAY_RESOLVE, PHASE.NIGHT_GUARD, PHASE.HUNTER_SHOT, PHASE.GAME_OVER].includes(this.phase) || this.phase.startsWith('NIGHT_') ? this.lastVoteResult : undefined,
      winner: this.winner,
      roleConfig: this.roleConfig,
    };
  }

  _recentDeathsSummary() {
    // Chi lay nhung nguoi chet trong lan resolve gan nhat (dem hoac ban ngay)
    return this.lastDeaths.map((d) => ({ id: d.id, name: d.name }));
  }
}

module.exports = { Game, PHASE, DEFAULT_DURATIONS, CHANGEABLE_ACTIONS };
