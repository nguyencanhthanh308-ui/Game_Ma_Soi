// public/app.js
// Toan bo logic phia client: ket noi socket, dieu huong man hinh, xu ly hanh dong.

const socket = io();

const PHASE_LABEL = {
  LOBBY: 'Sảnh chờ',
  ROLE_REVEAL: 'Đọc vai và sẵn sàng',
  NIGHT_CUPID: '🌙 Đêm - Cupid',
  NIGHT_GUARD: '🌙 Đêm - Bảo vệ',
  NIGHT_WOLVES: '🌙 Đêm - Bầy Sói',
  NIGHT_WHITEWOLF: '🌙 Đêm - Sói trắng',
  NIGHT_SEER: '🌙 Đêm - Tiên tri',
  NIGHT_WITCH: '🌙 Đêm - Phù thủy',
  DAY_ANNOUNCE: '☀️ Buổi sáng',
  HUNTER_SHOT: '🏹 Thợ săn bắn',
  DAY_DISCUSSION: '☀️ Thảo luận',
  DAY_VOTE: '☀️ Nêu tên',
  DAY_DEFENSE: '⚖️ Biện hộ',
  DAY_JUDGEMENT: '⚖️ Phán quyết',
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
  pendingAction: null,
  selectionKey: null,
  hasSeenReveal: false,
  timerInterval: null,
};

// ---------- Helpers UI ----------

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
  window.villageArt?.refresh();
  window.gameChat?.mount(id);
  window.gameVoice?.mount(id);
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
  state.pendingAction = null;
  state.submittedForPhase = null;
  state.selected = [];
  state.selectionKey = null;
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
  navigator.clipboard?.writeText(url).then(() => toast('Đã sao chép liên kết mời!')).catch(() => toast(url));
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
      publishRoleConfig();
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
  renderSharedRoles(state.lastGameState?.roleConfig);
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
      publishRoleConfig();
      renderRoleConfig();
    });
  });
  const sum = Object.values(state.roleConfig).reduce((a, b) => a + b, 0);
  $('role-config-error').textContent = !ROLE_STEP_ORDER.length ? 'Đang tải danh sách vai. Nếu chờ lâu, hãy khởi động lại server rồi tải lại trang.'
    : sum === total ? '' : `Tổng vai trò: ${sum} / ${total} người chơi. Bấm “Gợi ý lại theo số người” để cân bằng.`;
  $('btn-start').disabled = !ROLE_STEP_ORDER.length || sum !== total;
}

function kickPlayer(player) {
  if (!confirm(`Mời ${player.name} rời phòng?`)) return;
  socket.timeout(5000).emit('kick_player', { playerId: player.id }, (err, result) => {
    if (err || !result?.ok) toast(result?.error || 'Chưa mời được người này rời phòng.');
    else toast(`Đã mời ${player.name} rời phòng.`);
  });
}

function renderLobby(gs) {
  renderSharedRoles(gs.roleConfig);
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
    if (state.isHost && p.id !== state.playerId) {
      const kick = document.createElement('button');
      kick.className = 'btn-secondary small kick-btn';
      kick.textContent = '✕ Mời rời phòng';
      kick.title = `Mời ${p.name} rời phòng`;
      kick.addEventListener('click', () => kickPlayer(p));
      li.appendChild(kick);
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
  window.villageArt?.role(role);
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
  renderReadyStatus();
}

function renderReadyStatus() {
  const gs = state.lastGameState;
  const waiting = gs?.phase === 'ROLE_REVEAL';
  const ready = gs?.readyPlayers || [];
  const confirmed = ready.includes(state.playerId);
  $('btn-continue').disabled = waiting && (confirmed || !!state.pendingAction);
  $('btn-continue').textContent = waiting
    ? (confirmed ? 'Bạn đã sẵn sàng' : state.pendingAction ? 'Đang gửi xác nhận…' : 'Tôi đã đọc vai, sẵn sàng!')
    : 'Vào ván chơi';
  const remaining = waiting ? gs.players.filter(p => !ready.includes(p.id) || !p.connected) : [];
  $('ready-status').textContent = waiting
    ? `${ready.length}/${gs.players.length} người đã đọc vai. Chờ tất cả sẵn sàng và kết nối.${remaining.length ? ' Còn chờ: ' + remaining.map(p => p.name + (!p.connected ? ' (mất kết nối)' : '')).join(', ') + '.' : ''}` : '';
  $('btn-cancel-ready').classList.toggle('hidden', !waiting || !state.isHost);
}

$('btn-continue').addEventListener('click', () => {
  if (state.lastGameState?.phase === 'ROLE_REVEAL') return send('ready', {});
  showScreen('screen-game');
});
$('btn-cancel-ready').addEventListener('click', () => {
  socket.timeout(5000).emit('restart_to_lobby', null, (err, result) => {
    if (err || !result?.ok) toast(result?.error || 'Chưa nhận được xác nhận từ server. Hãy thử lại.');
  });
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
  const votes = gs.dayVotes || {};
  const byName = Object.fromEntries(gs.players.map((p) => [p.id, p.name]));
  // Dem so phieu dang nham vao tung nguoi, de ai cung thay ngay ai dang bi nghi nhieu nhat
  const tally = {};
  for (const targetId of Object.values(votes)) if (targetId) tally[targetId] = (tally[targetId] || 0) + 1;
  // Nguoi da mat duoc biet vai cua ca lang (server gui rieng qua private_state)
  const revealed = Object.fromEntries((state.lastPrivate?.revealedRoles || []).map((r) => [r.id, r.roleName]));
  // ... va ca ly do tung nguoi da chet
  const deathCauses = Object.fromEntries((state.lastPrivate?.revealedRoles || []).filter((r) => r.deathCause).map((r) => [r.id, r.deathCause]));

  gs.players.forEach((p) => {
    const li = document.createElement('li');
    if (!p.alive) li.classList.add('dead');
    if (p.id === state.playerId) li.classList.add('me');
    if (p.id === gs.accusedId) li.classList.add('accused');
    const roleName = p.roleName || revealed[p.id];
    const label = document.createElement('span');
    label.textContent = `${p.alive ? '💚' : '💀'} ${p.name}${roleName ? ' (' + roleName + ')' : ''}`;
    li.appendChild(label);
    if (!p.alive && deathCauses[p.id]) {
      const cause = document.createElement('small');
      cause.className = 'death-cause';
      cause.textContent = deathCauses[p.id];
      li.appendChild(cause);
    }

    const marks = document.createElement('span');
    marks.className = 'vote-marks';
    let hasMarks = false;
    if (tally[p.id]) {
      const count = document.createElement('span');
      count.className = 'vote-count';
      count.textContent = `🗳 ${tally[p.id]}`;
      marks.appendChild(count);
      hasMarks = true;
    }
    if (votes[p.id] !== undefined && p.alive) {
      const target = document.createElement('span');
      target.className = 'vote-target';
      target.textContent = votes[p.id] ? `→ ${byName[votes[p.id]] || '?'}` : '→ phiếu trắng';
      marks.appendChild(target);
      hasMarks = true;
    }
    if (hasMarks) li.appendChild(marks);
    list.appendChild(li);
  });
}

// Bang tom tat: con bao nhieu nguoi chua bo phieu, ai dang dan dau
function renderVoteSummary(gs, area) {
  const alive = gs.players.filter((p) => p.alive);
  const votes = gs.dayVotes || {};
  const voted = alive.filter((p) => votes[p.id] !== undefined).length;
  const hint = document.createElement('p');
  hint.className = 'hint-text';
  hint.textContent = `${voted}/${alive.length} người đã nêu tên. Phiếu hiện trực tiếp ở danh sách người chơi. Bạn đổi phiếu được cho tới khi hết giờ.`;
  area.appendChild(hint);
}

// Nut nem ca chua / tang hoa, dung chung cho pha bien ho va pha phan quyet
function renderReactionButtons(gs, accusedName, area) {
  const row = document.createElement('div');
  row.className = 'reaction-row';
  const counts = (gs.reactionCounts || {})[gs.accusedId] || { tomato: 0, flower: 0 };
  [['tomato', '🍅 Ném cà chua'], ['flower', '💐 Tặng hoa']].forEach(([kind, text]) => {
    const btn = document.createElement('button');
    btn.className = 'btn-secondary reaction-btn';
    btn.textContent = `${text}${counts[kind] ? ' · ' + counts[kind] : ''}`;
    btn.addEventListener('click', () => sendReaction(kind, gs.accusedId));
    row.appendChild(btn);
  });
  area.appendChild(row);
  const hint = document.createElement('p');
  hint.className = 'hint-text';
  hint.textContent = `${accusedName} đang biện hộ: 🍅 ${counts.tomato || 0} · 💐 ${counts.flower || 0}`;
  area.appendChild(hint);
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
  if (!priv || priv.actionVersion !== gs.actionVersion) return;
  const prompt = priv.prompt;
  const selectionKey = `${gs.actionVersion}:${prompt?.action}:${prompt?.step}`;
  if (state.selectionKey !== selectionKey) {
    state.selected = [];
    state.selectionKey = selectionKey;
  }
  state.selected = state.selected.filter(id => prompt?.targets?.some(p => p.id === id));
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
      skip.disabled = votes.includes(state.playerId) || !!state.pendingAction;
      skip.addEventListener('click', () => {
        send('skip_day', { dayNumber: gs.dayNumber });
      });
      area.appendChild(skip);
    }
  }

  if (gs.phase === 'DAY_VOTE') renderVoteSummary(gs, area);

  if (!prompt || !prompt.action) {
    // Nguoi bi neu ten va nguoi da mat khong bam gi duoc, nhung van cho xem so ca chua / hoa
    if (gs.accusedId && (gs.phase === 'DAY_DEFENSE' || gs.phase === 'DAY_JUDGEMENT')) {
      const accused = gs.players.find((p) => p.id === gs.accusedId);
      if (accused) renderJudgeTally(gs, area);
    }
    return;
  }

  // Bo phieu va nem ca chua thi doi y duoc, nen khong khoa giao dien lai sau khi gui
  const changeable = ['day_vote', 'judge_vote', 'react'].includes(prompt.action);
  if (!changeable && (state.submittedForPhase === gs.actionVersion || state.pendingAction?.version === gs.actionVersion)) {
    const p = document.createElement('p');
    p.className = 'hint-text';
    p.textContent = state.submittedForPhase === gs.actionVersion
      ? 'Server đã nhận lựa chọn của bạn, đang chờ những người khác...'
      : 'Đang gửi, chờ server xác nhận…';
    area.appendChild(p);
    return;
  }

  if (prompt.action === 'react') {
    const accused = gs.players.find((p) => p.id === gs.accusedId);
    renderReactionButtons(gs, accused?.name || '', area);
    return;
  }

  if (prompt.action === 'judge_vote') {
    renderJudgement(gs, prompt, area);
    return;
  }

  const maxSelect = prompt.action === 'cupid_choose' ? 2 : 1;
  const targets = prompt.targets || [];

  const listEl = document.createElement('div');
  targets.forEach((t) => {
    const btn = document.createElement('button');
    btn.className = 'target-btn';
    btn.classList.toggle('selected', state.selected.includes(t.id));
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
    if (prompt.step === 'heal' && prompt.canHeal) {
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
    skipBtn.textContent = prompt.step === 'heal' ? 'Không cứu → Tiếp tục' : 'Không dùng thuốc độc';
    skipBtn.addEventListener('click', () => send('witch_action', prompt.step === 'heal' ? { heal: false } : {}));
    btns.appendChild(skipBtn);
    area.appendChild(btns);

    const confirmPoison = document.createElement('button');
    confirmPoison.className = 'btn-primary';
    confirmPoison.textContent = '☠️ Đầu độc người đã chọn ở trên';
    confirmPoison.addEventListener('click', () => {
      if (!state.selected.length) return toast('Chọn một người để đầu độc trước.');
      send('witch_action', { poisonTargetId: state.selected[0] });
    });
    if (prompt.step === 'poison' && prompt.canPoison) area.appendChild(confirmPoison);
    return;
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-primary';
  confirmBtn.textContent = prompt.action === 'seer_check' ? '🔮 Soi người đã chọn' : 'Xác nhận';
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
  if (prompt.action === 'day_vote') {
    const mine = (gs.dayVotes || {})[state.playerId];
    confirmBtn.textContent = mine !== undefined ? 'Đổi phiếu sang người đã chọn' : 'Nêu tên người đã chọn';
  }
  area.appendChild(confirmBtn);

  if (prompt.action === 'whitewolf_kill' || prompt.action === 'day_vote' || prompt.action === 'guard_protect') {
    const skip = document.createElement('button');
    skip.className = 'btn-secondary';
    skip.textContent = prompt.action === 'day_vote'
      ? ((gs.dayVotes || {})[state.playerId] ? 'Hủy phiếu (bỏ phiếu trắng)' : 'Bỏ phiếu trắng')
      : 'Bỏ qua';
    skip.addEventListener('click', () => {
      if (prompt.action === 'whitewolf_kill') send('whitewolf_kill', { targetId: null });
      if (prompt.action === 'day_vote') send('day_vote', { targetId: null });
      if (prompt.action === 'guard_protect') send('guard_protect', { targetId: null });
    });
    area.appendChild(skip);
  }
}

// Dem phieu treo co / tha, ai cung xem duoc trong luc phan quyet
function renderJudgeTally(gs, area) {
  const judge = gs.judgeVotes || {};
  const byName = Object.fromEntries(gs.players.map((p) => [p.id, p.name]));
  const kill = Object.entries(judge).filter(([, v]) => v === 'kill');
  const spare = Object.entries(judge).filter(([, v]) => v === 'spare');
  const box = document.createElement('div');
  box.className = 'judge-tally';
  const line = (icon, label, list) => {
    const row = document.createElement('p');
    row.innerHTML = '';
    row.textContent = `${icon} ${label}: ${list.length}${list.length ? ' — ' + list.map(([id]) => byName[id] || '?').join(', ') : ''}`;
    box.appendChild(row);
  };
  line('⚰️', 'Treo cổ', kill);
  line('🕊️', 'Tha', spare);
  area.appendChild(box);
  if (gs.phase === 'DAY_JUDGEMENT') {
    const hint = document.createElement('p');
    hint.className = 'hint-text';
    hint.textContent = 'Hòa phiếu hoặc ít phiếu treo cổ hơn thì người bị nêu tên được tha.';
    area.appendChild(hint);
  }
}

function renderJudgement(gs, prompt, area) {
  const mine = (gs.judgeVotes || {})[state.playerId];
  const row = document.createElement('div');
  row.className = 'action-buttons judge-buttons';
  // Nguoi yeu khong duoc gop phieu treo co nguoi minh yeu (luat chuan)
  const choices = prompt.onlySpare ? [['spare', '🕊️ Xin tha']] : [['kill', '⚰️ Treo cổ'], ['spare', '🕊️ Tha']];
  choices.forEach(([verdict, text]) => {
    const btn = document.createElement('button');
    btn.className = verdict === 'kill' ? 'btn-primary' : 'btn-secondary';
    btn.classList.toggle('selected', mine === verdict);
    btn.textContent = text + (mine === verdict ? ' ✓' : '');
    btn.addEventListener('click', () => send('judge_vote', { verdict }));
    row.appendChild(btn);
  });
  area.appendChild(row);
  renderJudgeTally(gs, area);
  renderReactionButtons(gs, prompt.accusedName || '', area);
}

// Nem ca chua / tang hoa: gui thang, khong di qua send() vi send() chan gui lien tiep
function sendReaction(kind, targetId) {
  if (!socket.connected || !targetId) return;
  const version = state.lastGameState?.actionVersion;
  if (version == null) return;
  socket.emit('player_action', { type: 'react', payload: { kind, targetId }, actionVersion: version });
}

// Hieu ung bay ngang man hinh khi co nguoi nem ca chua hoac tang hoa
socket.on('reaction', ({ kind, fromName }) => {
  const el = document.createElement('div');
  el.className = 'reaction-fly';
  el.textContent = kind === 'tomato' ? '🍅' : '💐';
  el.style.left = (10 + Math.random() * 70) + '%';
  el.title = `${fromName} ${kind === 'tomato' ? 'ném cà chua' : 'tặng hoa'}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
});

socket.on('kicked', ({ reason }) => {
  state.roomCode = null;
  try { sessionStorage.removeItem('masoi_session'); } catch (e) { /* che do an danh */ }
  toast(reason || 'Bạn đã bị mời rời phòng.');
  setTimeout(() => location.reload(), 1500);
});

function send(type, payload) {
  if (!socket.connected) return toast('Đang mất kết nối. Hãy chờ kết nối lại rồi gửi.');
  if (state.pendingAction) return;
  const version = state.lastGameState?.actionVersion;
  if (version == null || state.lastPrivate?.actionVersion !== version) return toast('Đang cập nhật lượt. Hãy thử lại.');
  const request = { version };
  state.pendingAction = request;
  const render = () => {
    renderReadyStatus();
    if (state.lastGameState) renderActionArea(state.lastGameState, state.lastPrivate);
  };
  render();
  socket.timeout(5000).emit('player_action', { type, payload, actionVersion: version }, (err, result) => {
    if (state.pendingAction !== request) return;
    state.pendingAction = null;
    if (state.lastGameState?.actionVersion !== version) return;
    if (!err && result?.ok) state.submittedForPhase = version;
    else if (state.submittedForPhase !== version) toast(result?.error || 'Chưa nhận được xác nhận. Bạn có thể gửi lại lựa chọn.');
    render();
  });
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
  const previousVersion = state.lastGameState?.actionVersion;
  const previousRound = state.lastGameState?.actionRound;
  const prevPhase = state.lastGameState ? state.lastGameState.phase : null;
  state.lastGameState = gs;
  state.isHost = gs.hostId === state.playerId;
  if (previousVersion !== gs.actionVersion) {
    state.pendingAction = null;
    state.submittedForPhase = null;
    state.selected = [];
    state.selectionKey = null;
  }
  window.villageArt?.update(gs);

  // Ban ngay nen sang, ban dem nen toi + doc dan chuyen khi vua chuyen sang mot pha moi
  // Cung mot moc "ban ngay" voi tranh pixel trong village.js (chi cac pha DAY_* la sang).
  // Sanh cho va man ket thuc khong mang class nao, giu nguyen tong toi cua giao dien.
  const isDay = gs.phase.startsWith('DAY_');
  const inGame = gs.phase !== 'LOBBY' && gs.phase !== 'GAME_OVER';
  document.documentElement?.classList?.toggle('theme-day', inGame && isDay);
  document.documentElement?.classList?.toggle('theme-night', inGame && !isDay);
  if (prevPhase !== gs.phase || previousRound !== gs.actionRound) window.gameAudio?.onPhaseChange(gs.phase, prevPhase, gs);

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

  if (gs.phase === 'ROLE_REVEAL') {
    if (state.lastPrivate?.role && state.lastPrivate.actionVersion === gs.actionVersion) showReveal(state.lastPrivate);
    renderReadyStatus();
    return;
  }
  if (prevPhase === 'ROLE_REVEAL') showScreen('screen-game');

  if (prevPhase !== gs.phase || previousRound !== gs.actionRound) state.submittedForPhase = null;

  $('phase-title').textContent = PHASE_LABEL[gs.phase] || gs.phase;
  window.gameVoice?.placeVideoGrid();
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
  if (priv.actionVersion !== state.lastGameState?.actionVersion) return;
  if (priv.submitted) state.submittedForPhase = priv.actionVersion;
  window.gameVoice?.syncVoiceChannel(priv);
  renderSeerResults(priv.seerResults || []);
  if (state.lastPrivate?.role && priv.role && state.lastPrivate.role.id !== priv.role.id) state.hasSeenReveal = false;
  state.lastPrivate = priv;
  if (state.lastGameState?.phase === 'ROLE_REVEAL' && priv.role) {
    state.hasSeenReveal = true;
    showReveal(priv);
    return;
  }
  if (priv.role && !state.hasSeenReveal && state.lastGameState && state.lastGameState.phase !== 'LOBBY' && state.lastGameState.phase !== 'GAME_OVER') {
    state.hasSeenReveal = true;
    showReveal(priv);
  } else if (state.lastGameState && state.lastGameState.phase !== 'LOBBY' && state.lastGameState.phase !== 'GAME_OVER') {
    renderActionArea(state.lastGameState, priv);
    if ($('screen-reveal').classList.contains('active') && priv.role) showReveal(priv);
  }
});

socket.on('seer_result', (res) => {
  const results = state.lastPrivate?.seerResults || [];
  renderSeerResults([...results, res]);
  toast(`🔮 ${res.targetName} ${res.isWolf ? 'LÀ SÓI 🐺' : 'không phải là Sói'}`);
});

function renderSeerResults(results) {
  for (const id of ['seer-results', 'seer-results-over']) {
    const panel = $(id);
    panel.classList.toggle('hidden', !results.length);
    const list = $(id + '-list');
    list.innerHTML = '';
    for (const result of [...results].reverse()) {
      const item = document.createElement('li');
      item.textContent = `Đêm ${result.nightNumber}: ${result.targetName} — ${result.isWolf ? 'LÀ SÓI 🐺' : 'KHÔNG PHẢI SÓI'}`;
      list.appendChild(item);
    }
  }
}

function publishRoleConfig() {
  socket.emit('set_role_config', state.roleConfig);
  renderSharedRoles(state.roleConfig);
}
function renderSharedRoles(config) {
  $('shared-role-config').textContent = config ? Object.entries(config).filter(([, count]) => count > 0)
    .map(([id, count]) => `${ROLE_NAMES[id] || id}: ${count}`).join(' · ') || 'Chưa chọn vai.' : 'Đang chờ chủ phòng chọn vai…';
}
socket.on('role_config', config => {
  if (state.lastGameState) state.lastGameState.roleConfig = config;
  renderSharedRoles(config);
});
