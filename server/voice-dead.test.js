const test = require('node:test');
const assert = require('node:assert/strict');
const { voicePeersFor, canHear, canSignal } = require('./voice');

function fakeGame(phase, players) {
  const map = new Map(players.map((p, i) => [String(i), { id: String(i), socketId: 's' + i, connected: true, ...p }]));
  return { phase, players: map, get: (name) => [...map.values()].find((p) => p.name === name) };
}
const modeOf = (game, me, name) => voicePeersFor(game, me).find((p) => p.name === name)?.mode;

const day = () => fakeGame('DAY_DISCUSSION', [
  { name: 'Wolf', alive: true, role: 'werewolf' },
  { name: 'Villager', alive: true, role: 'villager' },
  { name: 'Ghost', alive: false, role: 'seer' },
]);
const night = () => fakeGame('NIGHT_WOLVES', [
  { name: 'Wolf', alive: true, role: 'werewolf' },
  { name: 'Villager', alive: true, role: 'villager' },
  { name: 'Ghost', alive: false, role: 'seer' },
]);

test('ban ngay: nguoi da mat nghe duoc nguoi con song', () => {
  const g = day();
  const ghost = g.get('Ghost');
  assert.equal(canHear(g, ghost, g.get('Wolf')), true);
  assert.equal(canHear(g, ghost, g.get('Villager')), true);
  assert.equal(modeOf(g, ghost, 'Villager'), 'listen', 'chi nghe, khong gui tieng sang');
});

test('ban dem: nguoi da mat nghe duoc ca bay Soi ban bac', () => {
  const g = night();
  const ghost = g.get('Ghost');
  assert.equal(canHear(g, ghost, g.get('Wolf')), true);
  assert.equal(modeOf(g, ghost, 'Wolf'), 'listen');
  // Dan lang ban dem khong duoc noi nen khong co gi de nghe
  assert.equal(canHear(g, ghost, g.get('Villager')), false);
  assert.equal(modeOf(g, ghost, 'Villager'), undefined);
});

test('nguoi con song KHONG BAO GIO nghe duoc Am phu', () => {
  for (const g of [day(), night()]) {
    const ghost = g.get('Ghost');
    for (const name of ['Wolf', 'Villager']) {
      const living = g.get(name);
      assert.equal(canHear(g, living, ghost), false, name + ' khong duoc nghe nguoi da mat');
      const mode = modeOf(g, living, 'Ghost');
      assert.ok(mode === undefined || mode === 'broadcast', name + ' chi duoc gui mot chieu, khong nhan');
    }
  }
});

test('ban dem Dan lang khong nghe duoc Soi va nguoc lai', () => {
  const g = night();
  assert.equal(canHear(g, g.get('Villager'), g.get('Wolf')), false);
  assert.equal(canHear(g, g.get('Wolf'), g.get('Villager')), false);
  assert.equal(modeOf(g, g.get('Villager'), 'Wolf'), undefined);
});

test('ban ngay nguoi con song noi chuyen hai chieu voi nhau', () => {
  const g = day();
  assert.equal(modeOf(g, g.get('Wolf'), 'Villager'), 'both');
  assert.equal(modeOf(g, g.get('Villager'), 'Wolf'), 'both');
});

test('hai nguoi da mat noi chuyen hai chieu trong Am phu', () => {
  const g = fakeGame('DAY_VOTE', [
    { name: 'GhostA', alive: false, role: 'villager' },
    { name: 'GhostB', alive: false, role: 'seer' },
  ]);
  assert.equal(modeOf(g, g.get('GhostA'), 'GhostB'), 'both');
});

test('nguoi mat ket noi khong nam trong danh sach peer', () => {
  const g = fakeGame('DAY_DISCUSSION', [
    { name: 'Here', alive: true, role: 'villager' },
    { name: 'Gone', alive: true, role: 'villager', connected: false },
  ]);
  assert.deepEqual(voicePeersFor(g, g.get('Here')).map((p) => p.name), []);
});

test('server chi relay tin hieu khi it nhat mot chieu duoc phep nghe', () => {
  const g = night();
  // Nguoi da mat <-> Soi: hop le vi nguoi da mat duoc nghe
  assert.equal(canSignal(g, g.get('Ghost'), g.get('Wolf')), true);
  // Dan lang <-> Soi luc dem: khong chieu nao duoc phep
  assert.equal(canSignal(g, g.get('Villager'), g.get('Wolf')), false);
});
