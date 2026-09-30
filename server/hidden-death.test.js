const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('./Game');

const io = { to: () => ({ emit() {} }) };

// Van that (khong gia lap _goToPhase) de kiem tra dung pha nao duoc goi va cho bao lau.
function realGame(config, t) {
  const g = new Game('HIDE');
  const roles = Object.entries(config).flatMap(([role, n]) => Array(n).fill(role));
  roles.forEach((_, i) => g.addPlayer('s' + i, 'P' + i));
  g.startGame(config, { NIGHT_CUPID: 20, NIGHT_GUARD: 20, NIGHT_WOLVES: 30, NIGHT_WHITEWOLF: 20, NIGHT_SEER: 20, NIGHT_WITCH: 20 });
  // Gan vai co dinh de biet ai giu vai nao
  [...g.players.values()].forEach((p, i) => { p.role = roles[i]; });
  t.after(() => clearTimeout(g.timer));
  return g;
}
const byRole = (g, role) => [...g.players.values()].find((p) => p.role === role);
const secondsLeft = (g) => Math.round((g.phaseEndsAt - Date.now()) / 1000);

test('Tien tri da chet: van co luot Tien tri, dan chuyen van goi', (t) => {
  const g = realGame({ werewolf: 1, seer: 1, villager: 3 }, t);
  byRole(g, 'seer').alive = false;
  g.nightNumber = 2;
  g._goToPhase(io, () => {}, PHASE.NIGHT_SEER);
  assert.equal(g.phase, PHASE.NIGHT_SEER, 'khong duoc bo qua luot Tien tri');
});

test('luot cua vai da chet keo dai 5-10 giay nhu co nguoi dang chon', (t) => {
  const g = realGame({ werewolf: 1, seer: 1, villager: 3 }, t);
  byRole(g, 'seer').alive = false;
  for (let i = 0; i < 30; i++) {
    g._goToPhase(io, () => {}, PHASE.NIGHT_SEER);
    const s = secondsLeft(g);
    assert.ok(s >= 5 && s <= 10, 'luot gia keo dai ' + s + 's');
  }
});

test('thoi gian luot gia khong co dinh (neu co dinh, nguoi choi doan ra duoc)', (t) => {
  const g = realGame({ werewolf: 1, seer: 1, villager: 3 }, t);
  byRole(g, 'seer').alive = false;
  const seen = new Set();
  for (let i = 0; i < 40; i++) { g._goToPhase(io, () => {}, PHASE.NIGHT_SEER); seen.add(secondsLeft(g)); }
  assert.ok(seen.size >= 3, 'phai co nhieu do dai khac nhau, thay ' + [...seen].join(','));
});

test('Tien tri con song thi luot keo dai binh thuong', (t) => {
  const g = realGame({ werewolf: 1, seer: 1, villager: 3 }, t);
  g.nightNumber = 2;
  g._goToPhase(io, () => {}, PHASE.NIGHT_SEER);
  assert.equal(secondsLeft(g), 20);
});

test('Bao ve, Phu thuy da chet cung van duoc goi', (t) => {
  const g = realGame({ werewolf: 1, guard: 1, witch: 1, villager: 3 }, t);
  byRole(g, 'guard').alive = false;
  byRole(g, 'witch').alive = false;
  g.nightNumber = 2;
  g._goToPhase(io, () => {}, PHASE.NIGHT_GUARD);
  assert.equal(g.phase, PHASE.NIGHT_GUARD);
  g._goToPhase(io, () => {}, PHASE.NIGHT_WITCH);
  assert.equal(g.phase, PHASE.NIGHT_WITCH);
});

test('Phu thuy da dung het thuoc van duoc goi (bo qua se lo la ba da dung het)', (t) => {
  const g = realGame({ werewolf: 1, witch: 1, villager: 3 }, t);
  const witch = byRole(g, 'witch');
  witch.hasUsedHeal = true;
  witch.hasUsedPoison = true;
  g.nightNumber = 3;
  g._goToPhase(io, () => {}, PHASE.NIGHT_WITCH);
  assert.equal(g.phase, PHASE.NIGHT_WITCH);
  assert.equal(secondsLeft(g), 20, 'ba con song nen luot dai binh thuong, tu bam bo qua');
});

test('vai KHONG co trong bo vai thi van bo qua (khong lo gi vi bo vai cong khai)', (t) => {
  const g = realGame({ werewolf: 1, villager: 4 }, t);
  g.nightNumber = 2;
  g._goToPhase(io, () => {}, PHASE.NIGHT_SEER);
  assert.notEqual(g.phase, PHASE.NIGHT_SEER, 'khong co Tien tri trong van thi khong goi');
});

test('het luot gia thi van tu sang luot tiep theo', (t) => {
  const g = realGame({ werewolf: 1, seer: 1, witch: 1, villager: 3 }, t);
  byRole(g, 'seer').alive = false;
  g.nightNumber = 2;
  g._goToPhase(io, () => {}, PHASE.NIGHT_SEER);
  g._advanceFromTimer(io, () => {});
  assert.equal(g.phase, PHASE.NIGHT_WITCH);
});

test('thong bao nguoi chet khong kem vai', (t) => {
  const g = realGame({ werewolf: 1, seer: 1, villager: 3 }, t);
  const seer = byRole(g, 'seer');
  g._applyDeaths(io, [seer.id]);
  g.phase = PHASE.DAY_ANNOUNCE;
  const state = g.publicState();
  assert.deepEqual(Object.keys(state.lastDeaths[0]).sort(), ['id', 'name']);
  assert.equal(state.players.find((p) => p.id === seer.id).role, undefined);
});
