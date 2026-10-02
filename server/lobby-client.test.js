const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_INFO, getDefaultRoleConfig, validateRoleConfig } = require('./roles');

function client() {
  const nodes = new Map();
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, textContent: '', innerHTML: '', children: [], disabled: false,
      classList: { add() {}, remove() {}, contains() { return false; } },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      addEventListener() {}, querySelectorAll() { return []; },
    });
    return nodes.get(id);
  }
  const events = {};
  const sent = [];
  const historyCalls = [];
  const location = { search: '' };
  let count = 1;
  let requests = 0;
  let confirmAnswer = true;
  const context = vm.createContext({
    window: {},
    document: { getElementById: element, createElement: () => element(Symbol()), querySelectorAll: () => [], querySelector: () => element('screen-lobby') },
    io: () => ({ on(name, cb) { events[name] = cb; }, emit(name, data, cb) {
      sent.push(name);
      if (name === 'get_role_suggestion') { requests++; cb({ ok: true, config: getDefaultRoleConfig(count), playerCount: count }); }
    } }),
    fetch: async () => ({ ok: true, json: async () => ROLE_INFO }),
    location, URLSearchParams,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    history: {
      replaceState(_s, _t, url) { historyCalls.push('replace ' + url); location.search = url; },
      pushState(_s, _t, url) { historyCalls.push('push ' + url); location.search = url; },
    },
    // Trinh duyet that co san hai thu nay o pham vi toan cuc; app.js dung chung de bat
    // nut Quay lai va de hoi truoc khi roi phong giua van.
    addEventListener(name, fn) { events['@' + name] = fn; },
    confirm: () => confirmAnswer,
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), context);
  vm.runInContext("state.playerId = 'host'", context);
  return {
    nodes, context, sent, historyCalls, location, get requests() { return requests; },
    join(code) { vm.runInContext(`onJoinedRoom(${JSON.stringify(code)}, 'host', 'Toi', true, 'tok')`, context); },
    answerConfirm(value) { confirmAnswer = value; },
    // Gia lap nut Quay lai cua trinh duyet
    back() { events['@popstate'](); },
    enterRoom(code = 'TEST') { vm.runInContext(`state.roomCode = ${JSON.stringify(code)}`, context); },
    roomCode() { return JSON.parse(vm.runInContext('JSON.stringify(state.roomCode)', context)); },
    lobby(n) {
      count = n;
      events.game_state({ roomCode: 'TEST', phase: 'LOBBY', players: Array.from({ length: n }, (_, i) => ({ id: i ? 'p'+i : 'host', name: 'Player'+i, isHost: !i })) });
    },
    config() { return JSON.parse(vm.runInContext('JSON.stringify(state.roleConfig)', context)); },
  };
}

test('lobby automatically replaces one-player setup with valid six-player roles', async () => {
  const c = client();
  await new Promise(resolve => setImmediate(resolve));
  c.lobby(1);
  assert.equal(c.nodes.get('btn-start').disabled, false);
  c.lobby(6);
  assert.deepEqual(validateRoleConfig(c.config(), 6), []);
  assert.equal(c.nodes.get('btn-start').disabled, false);
  assert.equal(c.nodes.get('role-config-error').textContent, '');
  assert.equal(c.requests, 2);
  c.lobby(7);
  assert.deepEqual(validateRoleConfig(c.config(), 7), []);
});

test('player-count updates preserve customized roles and explain mismatched totals', async () => {
  const c = client();
  await new Promise(resolve => setImmediate(resolve));
  c.lobby(6);
  vm.runInContext('state.roleConfigCustomized = true', c.context);
  const config = c.config();
  c.lobby(7);
  assert.deepEqual(c.config(), config);
  assert.equal(c.nodes.get('btn-start').disabled, true);
  assert.match(c.nodes.get('role-config-error').textContent, /Gợi ý lại/);
});

// Bam Quay lai trong sanh cho: roi phong han va ve trang chu, chu khong thoat khoi web.
test('browser back leaves the room and returns to the home screen', async () => {
  const c = client();
  await new Promise(resolve => setImmediate(resolve));
  c.enterRoom('ABCDE');
  c.lobby(3);
  c.back();
  assert.ok(c.sent.includes('leave_room'), 'phai bao server biet da roi phong');
  assert.equal(c.roomCode(), null);
});

// Dang choi do thi hoi lai; tra loi khong thi van o nguyen trong phong.
test('browser back mid-game keeps the player in the room when the prompt is declined', async () => {
  const c = client();
  await new Promise(resolve => setImmediate(resolve));
  c.enterRoom('ABCDE');
  c.lobby(6);
  vm.runInContext("state.lastGameState.phase = 'NIGHT_WOLVES'", c.context);
  c.answerConfirm(false);
  c.back();
  assert.ok(!c.sent.includes('leave_room'), 'tu choi thi khong duoc roi phong');
  assert.equal(c.roomCode(), 'ABCDE');
});

// Da o trang chu thi nut Quay lai khong duoc gui gi len server.
test('browser back on the home screen does nothing', async () => {
  const c = client();
  await new Promise(resolve => setImmediate(resolve));
  c.back();
  assert.ok(!c.sent.includes('leave_room'));
});

// Vao phong phai them mot muc vao lich su, co the thi nut Quay lai moi ve duoc trang chu
// thay vi thoat han khoi web.
test('entering a room pushes a history entry so back returns to the home screen', async () => {
  const c = client();
  await new Promise(resolve => setImmediate(resolve));
  c.join('ABCDE');
  assert.deepEqual(c.historyCalls, ['push ?room=ABCDE']);
});

// Mo tu link moi hoac vua tai lai trang: dia chi da san ?room=... nen chi thay cho,
// khong them muc moi - neu khong bam Quay lai mot cai se khong di dau ca.
test('opening an invite link replaces the history entry instead of adding one', async () => {
  const c = client();
  await new Promise(resolve => setImmediate(resolve));
  c.location.search = '?room=ABCDE';
  c.join('ABCDE');
  assert.deepEqual(c.historyCalls, ['replace ?room=ABCDE']);
});
