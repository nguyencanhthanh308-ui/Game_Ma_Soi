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
      id, textContent: '', innerHTML: '', children: [], disabled: false, handlers: {}, attrs: {},
      setAttribute(name, value) { this.attrs[name] = value; },
      focus() {}, select() {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      addEventListener(name, cb) { this.handlers[name] = cb; }, querySelectorAll() { return []; },
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
    location: { search: '', origin: 'http://localhost:3000' }, navigator: {}, URLSearchParams,
    sessionStorage: { getItem() { return null; }, setItem() {} },
    history: { replaceState() {} },
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), context);
  vm.runInContext("state.playerId = 'host'", context);
  return {
    nodes, context, events, get requests() { return requests; },
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

test('host reconnecting directly into a game retains restart controls', () => {
  const c = client();
  c.events.game_state({ phase: 'GAME_OVER', players: [{ id: 'host', isHost: true }], winner: { winner: 'village' } });
  assert.equal(vm.runInContext('state.isHost', c.context), true);
  assert.equal(c.nodes.get('restart-hint').textContent, '');
  c.events.game_state({ phase: 'GAME_OVER', players: [{ id: 'host', isHost: false }], winner: { winner: 'village' } });
  assert.equal(vm.runInContext('state.isHost', c.context), false);
  assert.match(c.nodes.get('restart-hint').textContent, /chủ phòng/);
});

test('target selection survives broadcasts, filters invalid targets and resets for a new round', () => {
  const c = client();
  const gs = {phase:'NIGHT_WOLVES',nightNumber:1,actionRound:1,players:[{id:'host',isHost:true,alive:true}]};
  const priv = {role:null,prompt:{action:'wolf_vote',targets:[{id:'a',name:'A'},{id:'b',name:'B'}]}};
  c.events.game_state(gs);
  c.events.private_state(priv);
  vm.runInContext("state.selected = ['a']", c.context);
  c.events.game_state(gs);
  c.events.private_state(priv);
  assert.equal(vm.runInContext('JSON.stringify(state.selected)',c.context),'["a"]');
  const targets = c.nodes.get('action-area').children.at(-2);
  assert.equal(targets.children[0].attrs['aria-pressed'],'true');
  c.events.private_state({...priv,prompt:{...priv.prompt,targets:[{id:'b',name:'B'}]}});
  assert.equal(vm.runInContext('state.selected.length',c.context),0);
  vm.runInContext("state.selected = ['b']", c.context);
  c.events.game_state({...gs,actionRound:2});
  assert.equal(vm.runInContext('state.selected.length',c.context),0);
});

test('share link remains selectable when clipboard is unavailable or denied', async () => {
  const c = client();
  vm.runInContext("state.roomCode = 'ABCDE'", c.context);
  await c.nodes.get('btn-share').handlers.click();
  assert.equal(c.nodes.get('share-url').value,'http://localhost:3000?room=ABCDE');
  vm.runInContext("navigator.clipboard = {writeText: async () => {throw new Error('Denied')}}",c.context);
  await c.nodes.get('btn-share').handlers.click();
  assert.equal(c.nodes.get('share-url').value,'http://localhost:3000?room=ABCDE');
});
