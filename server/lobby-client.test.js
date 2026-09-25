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
  let count = 1;
  let requests = 0;
  const context = vm.createContext({
    window: {},
    document: { getElementById: element, createElement: () => element(Symbol()), querySelectorAll: () => [], querySelector: () => element('screen-lobby') },
    io: () => ({ on(name, cb) { events[name] = cb; }, emit(name, data, cb) {
      if (name === 'get_role_suggestion') { requests++; cb({ ok: true, config: getDefaultRoleConfig(count), playerCount: count }); }
    } }),
    fetch: async () => ({ ok: true, json: async () => ROLE_INFO }),
    location: { search: '' }, URLSearchParams,
    sessionStorage: { getItem() { return null; }, setItem() {} },
    history: { replaceState() {} },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), context);
  vm.runInContext("state.playerId = 'host'", context);
  return {
    nodes, context, get requests() { return requests; },
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
  assert.equal(c.nodes.get('btn-start').disabled, true);
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
