// public/app.js
// Toan bo logic phia client: ket noi socket, dieu huong man hinh, xu ly hanh dong.

const socket = io();

const PHASE_LABEL = {
  LOBBY: 'Sảnh chờ',
  NIGHT_CUPID: '🌙 Đêm - Cupid',
  NIGHT_GUARD: '🌙 Đêm - Bảo vệ',
  NIGHT_WOLVES: '🌙 Đêm - Bầy Sói',
  NIGHT_WHITEWOLF: '🌙 Đêm - Sói trắng',
  NIGHT_SEER: '🌙 Đêm - Tiên tri',
  NIGHT_WITCH: '🌙 Đêm - Phù thủy',
  DAY_ANNOUNCE: '☀️ Buổi sáng',
  HUNTER_SHOT: '🏹 Thợ săn bắn',
  DAY_DISCUSSION: '☀️ Thảo luận',
  DAY_VOTE: '☀️ Bỏ phiếu',
  DAY_RESOLVE: '☀️ Kiểm phiếu',
  GAME_OVER: '🏁 Kết thúc',
};

const WINNER_LABEL = {
  wolves: { title: '🐺 Phe Sói chiến thắng!', color: '#e8543e' },
  village: { title: '🧑‍🌾 Phe Dân làng chiến thắng!', color: '#4fb0a5' },
  whitewolf: { title: '❄️ Sói trắng chiến thắng một mình!', color: '#8ecae6' },
  tanner: { title: '🃏 Chán đời chiến thắng!', color: '#f2b134' },
  lovers: { title: '💘 Cặp đôi yêu nhau chiến thắng!', color: '#f2b134' },
};

const state = {
  roomCode: null,
  playerId: null,
  myName: null,
  isHost: false,
  roleConfig: null,
  roleConfigPlayerCount: null,
  roleConfigCustomized: false,
  roleSuggestionPending: false,
  lastGameState: null,
  lastPrivate: null,
  selected: [],
  submittedForPhase: null,
  hasSeenReveal: false,
  timerInterval: null,
};

// ---------- Helpers UI ----------

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
  window.gameChat?.mount(id);
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ---------- Man hinh Home ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

const params = new URLSearchParams(location.search);
if (params.get('room')) {
  document.querySelector('.tab-btn[data-tab="join"]').click();
  $('join-code').value = params.get('room').toUpperCase();
}

$('btn-create').addEventListener('click', () => {
  const name = $('create-name').value.trim();
  if (!name) return ($('home-error').textContent = 'Nhập tên của bạn trước đã.');
  socket.emit('create_room', { name }, (res) => {
    if (!res.ok) return ($('home-error').textContent = res.error || 'Có lỗi xảy ra.');
    onJoinedRoom(res.roomCode, res.playerId, name, true, res.sessionToken);
  });
});

$('btn-join').addEventListener('click', () => {
  const code = $('join-code').value.trim().toUpperCase();
  const name = $('join-name').value.trim();
  if (!code || !name) return ($('home-error').textContent = 'Nhập đủ mã phòng và tên của bạn.');
  socket.emit('join_room', { roomCode: code, name }, (res) => {
    if (!res.ok) return ($('home-error').textContent = res.error || 'Có lỗi xảy ra.');
    onJoinedRoom(res.roomCode, res.playerId, name, false, res.sessionToken);
  });
});

function onJoinedRoom(roomCode, playerId, name, isHostGuess, sessionToken) {
  state.roleConfig = null;
  state.roleConfigPlayerCount = null;
  state.roleConfigCustomized = false;
  state.lastPrivate = null;
  state.hasSeenReveal = false;
  state.roomCode = roomCode;
  state.playerId = playerId;
  state.myName = name;
  sessionStorage.setItem('masoi_session', JSON.stringify({ roomCode, name, sessionToken }));
  history.replaceState(null, '', '?room=' + roomCode);
  $('room-code-display').textContent = roomCode;
  showScreen('screen-lobby');
}

// Thu tu dong ket noi lai neu vua reload trang (giu phien choi)
socket.on('connect', function tryAutoRejoin() {
  const saved = sessionStorage.getItem('masoi_session');
  if (!saved) return;
  try {
    const { roomCode, name, sessionToken } = JSON.parse(saved);
    if (!roomCode || !name) return;
    socket.emit('join_room', { roomCode, name, sessionToken }, (res) => {
      if (res.ok) onJoinedRoom(res.roomCode, res.playerId, name, false, res.sessionToken);
      else {
        sessionStorage.removeItem('masoi_session');
        state.roomCode = null;
        showScreen('screen-home');
        $('home-error').textContent = res.error || 'Không thể vào lại phòng.';
      }
    });
  } catch (e) { /* bo qua */ }
});

// ---------- Lobby ----------

$('btn-share').addEventListener('click', () => {
  const url = location.origin + '?room=' + state.roomCode;
  navigator.clipboard?.writeText(url).then(() => toast('Đã copy link mời!')).catch(() => toast(url));
});

$('btn-suggest').addEventListener('click', () => {
  state.roleConfigCustomized = false;
  requestRoleSuggestion();
});

function requestRoleSuggestion() {
  if (state.roleSuggestionPending) return;
  state.roleSuggestionPending = true;
  socket.emit('get_role_suggestion', null, (res) => {
    state.roleSuggestionPending = false;
    if (res.ok) {
      state.roleConfig = res.config;
      state.roleConfigPlayerCount = res.playerCount;
      if (!state.roleConfigCustomized && state.lastGameState?.phase === 'LOBBY' && res.playerCount !== state.lastGameState.players.length) {
        requestRoleSuggestion();
        return;
      }
      renderRoleConfig();
    }
  });
}

$('btn-start').addEventListener('click', () => {
  socket.emit('start_game', { roleConfig: state.roleConfig }, (res) => {
    if (!res.ok) $('role-config-error').textContent = res.error;
  });
});

$('btn-restart').addEventListener('click', () => {
  socket.emit('restart_to_lobby', null, (res) => {
    if (!res.ok) toast(res.error || 'Không thể làm mới');
  });
});

let roleCatalog = {};
let ROLE_STEP_ORDER = [];
let SINGLE_ROLES = [];
let ROLE_NAMES = {};
fetch('/api/roles').then(res => { if (!res.ok) throw new Error(); return res.json(); }).then(roles => {
  roleCatalog = roles;
  ROLE_STEP_ORDER = Object.keys(roles);
  SINGLE_ROLES = ROLE_STEP_ORDER.filter(id => roles[id].maxCount === 1);
  ROLE_NAMES = Object.fromEntries(ROLE_STEP_ORDER.map(id => [id, roles[id].name]));
  if (state.roleConfig) renderRoleConfig();
}).catch(() => {
  $('btn-start').disabled = true;
  $('role-config-error').textContent = 'Không tải được danh sách vai. Hãy khởi động lại server bằng npm start, rồi tải lại trang.';
  toast('Server chưa có danh sách vai. Hãy khởi động lại server rồi tải lại trang.');
});

function renderRoleConfig() {
  const grid = $('role-config-grid');
  grid.innerHTML = '';
  const total = state.lastGameState ? state.lastGameState.players.length : 0;
  ROLE_STEP_ORDER.forEach((roleId) => {
    const count = state.roleConfig[roleId] || 0;
    const max = SINGLE_ROLES.includes(roleId) ? 1 : total;
    const row = document.createElement('div');
    row.className = 'role-label';
    const details = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = roleCatalog[roleId].icon + ' ' + ROLE_NAMES[roleId];
    const description = document.createElement('p');
    description.textContent = roleCatalog[roleId].desc;
    details.append(title, description);
    row.appendChild(details);
    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    stepper.innerHTML = `<button data-role="${roleId}" data-delta="-1">−</button><span>${count}</span><button data-role="${roleId}" data-delta="1">+</button>`;
    grid.appendChild(row);
    grid.appendChild(stepper);
  });
  grid.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const roleId = btn.dataset.role;
      const delta = Number(btn.dataset.delta);
      const cur = state.roleConfig[roleId] || 0;
      const max = SINGLE_ROLES.includes(roleId) ? 1 : total;
      const next = Math.max(0, Math.min(max, cur + delta));
      state.roleConfig[roleId] = next;
      state.roleConfigCustomized = true;
      renderRoleConfig();
    });
  });
  const sum = Object.values(state.roleConfig).reduce((a, b) => a + b, 0);
  $('role-config-error').textContent = !ROLE_STEP_ORDER.length ? 'Đang tải danh sách vai. Nếu chờ lâu, hãy khởi động lại server rồi tải lại trang.'
    : total < 6 ? `Cần ít nhất 6 người để bắt đầu (hiện có ${total}).`
    : sum === total ? '' : `Tổng vai trò: ${sum} / ${total} người chơi. Bấm “Gợi ý lại theo số người” để cân bằng.`;
  $('btn-start').disabled = !ROLE_STEP_ORDER.length || total < 6 || sum !== total;
}

function renderLobby(gs) {
  $('room-code-display').textContent = gs.roomCode;
  $('player-count').textContent = gs.players.length;
  const list = $('player-list');
  list.innerHTML = '';
  gs.players.forEach((p) => {
    const li = document.createElement('li');
    if (p.id === state.playerId) li.classList.add('me');
    const label = document.createElement('span');
    label.textContent = p.name + (p.id === state.playerId ? ' (bạn)' : '');
    li.appendChild(label);
    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'tag';
      badge.textContent = 'Chủ phòng';
      li.appendChild(badge);
    }
    list.appendChild(li);
  });

  const me = gs.players.find((p) => p.id === state.playerId);
  state.isHost = !!(me && me.isHost);

  if (state.isHost) {
    $('host-controls').classList.remove('hidden');
    $('waiting-text').classList.add('hidden');
    if (!state.roleConfig || (!state.roleConfigCustomized && state.roleConfigPlayerCount !== gs.players.length)) {
      requestRoleSuggestion();
    } else {
      renderRoleConfig();
    }
  } else {
    $('host-controls').classList.add('hidden');
    $('waiting-text').classList.remove('hidden');
  }
}

// ---------- Man hinh lo vai tro ----------

function showReveal(privateState) {
  const role = privateState.role;
  $('role-icon').textContent = role.icon;
  $('role-name').textContent = role.name;
  $('role-desc').textContent = role.desc;
  $('role-team').textContent = ({ village: 'Phe Dân làng', wolf: 'Phe Sói', solo: 'Phe độc lập' })[role.team];
  $('role-play').textContent = role.play;
  $('role-win').textContent = role.win;
  const extra = $('role-extra');
  extra.innerHTML = '';
  if (privateState.teammates && privateState.teammates.length) {
    extra.textContent = 'Đồng bọn của bạn: ' + privateState.teammates.map((t) => t.name).join(', ');
  }
  if (privateState.allies?.length) extra.textContent += ' Hội Tam điểm: ' + privateState.allies.join(', ');
  if (privateState.loverName) extra.textContent += ' Người yêu: ' + privateState.loverName + '. Hai bạn thắng riêng nếu là hai người cuối cùng.';
  showScreen('screen-reveal');
}

$('btn-continue').addEventListener('click', () => {
  showScreen('screen-game');
});

// ---------- Man hinh trong game ----------

$('btn-toggle-role').addEventListener('click', () => {
  if (state.lastPrivate && state.lastPrivate.role) showReveal(state.lastPrivate);
});

function startTimerLoop() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (!state.lastGameState || !state.lastGameState.phaseEndsAt) {
      $('phase-timer').textContent = '';
      return;
    }
    const remain = Math.max(0, Math.round((state.lastGameState.phaseEndsAt - Date.now()) / 1000));
    $('phase-timer').textContent = remain + 's';
  }, 250);
}
startTimerLoop();

function renderGamePlayerList(gs) {
  const list = $('game-player-list');
  list.innerHTML = '';
  gs.players.forEach((p) => {
    const li = document.createElement('li');
    if (!p.alive) li.classList.add('dead');
    if (p.id === state.playerId) li.classList.add('me');
    const label = document.createElement('span');
    label.textContent = `${p.alive ? '💚' : '💀'} ${p.name}${p.alive && p.roleName ? ' (' + p.roleName + ')' : ''}`;
    li.appendChild(label);
    list.appendChild(li);
  });
}

function renderDeathsBanner(gs) {
  if (gs.lastDeaths && gs.lastDeaths.length) {
    const names = gs.lastDeaths.map((d) => d.name).join(', ');
    return `Đêm qua đã mất: ${names}.`;
  }
  if (gs.lastDeaths && gs.lastDeaths.length === 0) return 'Đêm qua bình yên vô sự, không ai chết.';
  return '';
}

function renderActionArea(gs, priv) {
  const area = $('action-area');
  area.innerHTML = '';
  const prompt = priv.prompt;
  let messageText = prompt && prompt.message ? prompt.message : '';

  if (gs.phase === 'DAY_ANNOUNCE' || gs.phase === 'DAY_DISCUSSION') {
    const banner = renderDeathsBanner(gs);
    if (banner) messageText = banner + (messageText ? ' ' + messageText : '');
  }
  $('phase-message').textContent = messageText || '...';

  if (gs.phase === 'DAY_DISCUSSION') {
    const alive = gs.players.filter(p => p.alive);
    const votes = gs.skipDayVotes || [];
    const agreed = alive.filter(p => votes.includes(p.id)).length;
    const hint = document.createElement('p');
    hint.className = 'hint-text';
    hint.textContent = `Bỏ qua ngày: ${agreed}/${alive.length} người đồng ý. Tất cả người còn sống đồng ý thì vào đêm ngay, không treo cổ ai. Nếu chưa đủ, thảo luận và bỏ phiếu vẫn diễn ra bình thường.`;
    area.appendChild(hint);
    if (alive.some(p => p.id === state.playerId)) {
      const skip = document.createElement('button');
      skip.className = 'btn-secondary';
      skip.textContent = votes.includes(state.playerId) ? 'Bạn đã đồng ý bỏ qua ngày' : 'Bỏ qua ngày → Đêm tiếp theo';
      skip.disabled = votes.includes(state.playerId);
      skip.addEventListener('click', () => {
        socket.emit('player_action', { type: 'skip_day', payload: { dayNumber: gs.dayNumber } });
      });
      area.appendChild(skip);
    }
  }

  if (!prompt || !prompt.action) return;

  if (state.submittedForPhase === gs.phase) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = 'Đã gửi lựa chọn của bạn, đang chờ những người khác...';
    area.appendChild(p);
    return;
  }

  state.selected = [];

  const maxSelect = prompt.action === 'cupid_choose' ? 2 : 1;
  const targets = prompt.targets || [];

  const listEl = document.createElement('div');
  targets.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = 'target-btn';
    btn.textContent = t.name;
    btn.addEventListener('click', () => {
      if (state.selected.includes(t.id)) {
        state.selected = state.selected.filter((x) => x !== t.id);
      } else {
        if (state.selected.length >= maxSelect) state.selected.shift();
        state.selected.push(t.id);
      }
      listEl.querySelectorAll('.target-btn').forEach((b) => b.classList.remove('selected'));
      [...listEl.children].forEach((b, i) => {
        if (state.selected.includes(targets[i].id)) b.classList.add('selected');
      });
    });
    listEl.appendChild(btn);
  });
  area.appendChild(listEl);

  // Rieng witch: them tuy chon giai doc / doc
  if (prompt.action === 'witch_action') {
    const btns = document.createElement('div');
    btns.className = 'action-buttons';
    if (prompt.canHeal) {
      const healBtn = document.createElement('button');
      healBtn.className = 'btn-secondary';
      healBtn.textContent = '💊 Dùng thuốc giải cứu nạn nhân';
      healBtn.addEventListener('click', () => {
        send('witch_action', { heal: true });
      });
      btns.appendChild(healBtn);
    }
    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn-secondary';
    skipBtn.textContent = 'Không dùng thuốc';
    skipBtn.addEventListener('click', () => send('witch_action', {}));
    btns.appendChild(skipBtn);
    area.appendChild(btns);

    const confirmPoison = document.createElement('button');
    confirmPoison.className = 'btn-primary';
    confirmPoison.textContent = '☠️ Đầu độc người đã chọn ở trên';
    confirmPoison.addEventListener('click', () => {
      if (!state.selected.length) return toast('Chọn một người để đầu độc trước.');
      send('witch_action', { poisonTargetId: state.selected[0] });
    });
    if (prompt.canPoison) area.appendChild(confirmPoison);
    return;
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-primary';
  confirmBtn.textContent = 'Xác nhận';
  confirmBtn.addEventListener('click', () => {
    if (prompt.action === 'cupid_choose') {
      if (state.selected.length !== 2) return toast('Chọn đủ 2 người.');
      send('cupid_choose', { targetIds: state.selected });
    } else if (prompt.action === 'guard_protect') {
      send('guard_protect', { targetId: state.selected[0] });
    } else if (prompt.action === 'wolf_vote') {
      if (!state.selected.length) return toast('Chọn một người.');
      send('wolf_vote', { targetId: state.selected[0] });
    } else if (prompt.action === 'whitewolf_kill') {
      send('whitewolf_kill', { targetId: state.selected[0] || null });
    } else if (prompt.action === 'seer_check') {
      if (!state.selected.length) return toast('Chọn một người.');
      send('seer_check', { targetId: state.selected[0] });
    } else if (prompt.action === 'hunter_shoot') {
      if (!state.selected.length) return toast('Chọn một người.');
      send('hunter_shoot', { targetId: state.selected[0] });
    } else if (prompt.action === 'day_vote') {
      send('day_vote', { targetId: state.selected[0] || null });
    }
  });
  area.appendChild(confirmBtn);

  if (prompt.action === 'whitewolf_kill' || prompt.action === 'day_vote' || prompt.action === 'guard_protect') {
    const skip = document.createElement('button');
    skip.className = 'btn-secondary';
    skip.textContent = prompt.action === 'day_vote' ? 'Bỏ phiếu trắng' : 'Bỏ qua';
    skip.addEventListener('click', () => {
      if (prompt.action === 'whitewolf_kill') send('whitewolf_kill', { targetId: null });
      if (prompt.action === 'day_vote') send('day_vote', { targetId: null });
      if (prompt.action === 'guard_protect') send('guard_protect', { targetId: null });
    });
    area.appendChild(skip);
  }
}

function send(type, payload) {
  state.submittedForPhase = state.lastGameState.phase;
  socket.emit('player_action', { type, payload });
  renderActionArea(state.lastGameState, state.lastPrivate);
}

// ---------- Man hinh ket thuc ----------

function renderGameOver(gs) {
  const w = gs.winner;
  const info = WINNER_LABEL[w.winner] || { title: 'Kết thúc ván chơi' };
  $('winner-title').textContent = info.title;
  $('winner-reason').textContent = w.reason || '';
  const list = $('final-role-list');
  list.innerHTML = '';
  gs.players.forEach((p) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${p.alive ? '💚' : '💀'} ${p.name}`;
    const badge = document.createElement('span');
    badge.className = 'tag';
    badge.textContent = p.roleName || '?';
    li.append(label, badge);
    list.appendChild(li);
  });
  if (state.isHost) {
    $('btn-restart').classList.remove('hidden');
    $('restart-hint').textContent = '';
  } else {
    $('btn-restart').classList.add('hidden');
    $('restart-hint').textContent = 'Đang chờ chủ phòng bắt đầu ván mới...';
  }
  showScreen('screen-over');
}

// ---------- Socket events ----------

socket.on('game_state', (gs) => {
  const previousRound = state.lastGameState?.actionRound;
  const prevPhase = state.lastGameState ? state.lastGameState.phase : null;
  state.lastGameState = gs;

  if (gs.phase === 'LOBBY') {
    state.lastPrivate = null;
    state.hasSeenReveal = false;
    state.submittedForPhase = null;
    renderLobby(gs);
    if (document.querySelector('.screen.active').id !== 'screen-lobby') showScreen('screen-lobby');
    return;
  }

  if (gs.phase === 'GAME_OVER') {
    renderGameOver(gs);
    return;
  }

  if (prevPhase !== gs.phase || previousRound !== gs.actionRound) state.submittedForPhase = null;

  $('phase-title').textContent = PHASE_LABEL[gs.phase] || gs.phase;
  renderGamePlayerList(gs);

  if (state.lastPrivate) renderActionArea(gs, state.lastPrivate);

  if (document.querySelector('.screen.active').id === 'screen-lobby' || document.querySelector('.screen.active').id === 'screen-home') {
    // Vua tu lobby chuyen sang dem dau tien -> hien man hinh lo vai neu co
    if (state.lastPrivate && state.lastPrivate.role && !state.hasSeenReveal) {
      state.hasSeenReveal = true;
      showReveal(state.lastPrivate);
    } else {
      showScreen('screen-game');
    }
  }
});

socket.on('private_state', (priv) => {
  if (state.lastPrivate?.role && priv.role && state.lastPrivate.role.id !== priv.role.id) state.hasSeenReveal = false;
  state.lastPrivate = priv;
  if (priv.role && !state.hasSeenReveal && state.lastGameState && state.lastGameState.phase !== 'LOBBY' && state.lastGameState.phase !== 'GAME_OVER') {
    state.hasSeenReveal = true;
    showReveal(priv);
  } else if (state.lastGameState && state.lastGameState.phase !== 'LOBBY' && state.lastGameState.phase !== 'GAME_OVER') {
    renderActionArea(state.lastGameState, priv);
    if ($('screen-reveal').classList.contains('active') && priv.role) showReveal(priv);
  }
});

socket.on('seer_result', (res) => {
  toast(`🔮 ${res.targetName} ${res.isWolf ? 'LÀ SÓI 🐺' : 'không phải là Sói'}`);
});
