const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('./Game');

const io = { to: () => ({ emit() {} }) };

// Dung mot van dang o pha phu thuy, voi nan nhan cua Soi da duoc chot.
function witchNight(t) {
  const game = new Game('WITCH');
  const witch = game.addPlayer('s1', 'Witch');
  const wolf = game.addPlayer('s2', 'Wolf');
  const victim = game.addPlayer('s3', 'Victim');
  const other = game.addPlayer('s4', 'Other');
  game.startGame({ witch: 1, werewolf: 1, villager: 2 });
  witch.role = 'witch'; wolf.role = 'werewolf';
  victim.role = 'villager'; other.role = 'villager';
  game.phase = PHASE.NIGHT_WITCH;
  game.night.currentWolfVictim = victim.id;
  game.night.wolfVictims = [victim.id]; // _resolveNight doc danh sach nay khi tinh nguoi chet
  t.after(() => { if (game.timer) clearTimeout(game.timer); });
  return { game, witch, wolf, victim, other };
}

test('con binh cuu: phu thuy thay ten nguoi bi Soi can va duoc hoi co cuu khong', (t) => {
  const { game, witch, victim } = witchNight(t);
  const prompt = game.getPhasePrompt(witch);
  assert.equal(prompt.action, 'witch_action');
  assert.equal(prompt.step, 'heal');
  assert.equal(prompt.canHeal, true);
  assert.equal(prompt.victimName, 'Victim');
  assert.match(prompt.message, /Victim/);
  assert.equal(victim.alive, true);
});

test('het binh cuu: khong lo ten nan nhan, vao thang buoc thuoc doc', (t) => {
  const { game, witch } = witchNight(t);
  witch.hasUsedHeal = true;
  const prompt = game.getPhasePrompt(witch);
  assert.equal(prompt.step, 'poison');
  assert.equal(prompt.victimName, null);
  assert.equal(prompt.canHeal, false);
});

test('chon cuu xong thi phat lai state va chuyen sang buoc hoi thuoc doc', (t) => {
  const { game, witch } = witchNight(t);
  let broadcasts = 0;
  game.recordAction(io, () => broadcasts++, witch.id, 'witch_action', { heal: true });
  assert.equal(witch.hasUsedHeal, true);
  assert.equal(game.night.witchHeal, true);
  // Khong broadcast thi client ket o buoc 'heal' cho den khi het gio.
  assert.equal(broadcasts, 1);
  assert.equal(game.phase, PHASE.NIGHT_WITCH);
  const next = game.getPhasePrompt(witch);
  assert.equal(next.step, 'poison');
  assert.equal(next.canPoison, true);
});

test('khong cuu cung phat lai state va chuyen sang buoc thuoc doc', (t) => {
  const { game, witch } = witchNight(t);
  let broadcasts = 0;
  game.recordAction(io, () => broadcasts++, witch.id, 'witch_action', { heal: false });
  assert.equal(witch.hasUsedHeal, false);
  assert.equal(game.night.witchHealDecided, true);
  assert.equal(broadcasts, 1);
  assert.equal(game.getPhasePrompt(witch).step, 'poison');
});

test('cuu roi doc: nan nhan cua Soi song, nguoi bi doc chet', (t) => {
  const { game, witch, victim, other } = witchNight(t);
  const broadcast = () => {};
  game.recordAction(io, broadcast, witch.id, 'witch_action', { heal: true });
  game.recordAction(io, broadcast, witch.id, 'witch_action', { poisonTargetId: other.id });
  game._advanceFromTimer(io, broadcast);   // pha chay het gio roi moi tong ket dem
  assert.equal(victim.alive, true, 'nan nhan da duoc binh cuu');
  assert.equal(other.alive, false, 'nguoi bi quang binh doc phai chet');
  assert.equal(witch.hasUsedPoison, true);
});

test('bo qua ca hai buoc thi nan nhan cua Soi chet', (t) => {
  const { game, witch, victim, other } = witchNight(t);
  const broadcast = () => {};
  game.recordAction(io, broadcast, witch.id, 'witch_action', { heal: false });
  game.recordAction(io, broadcast, witch.id, 'witch_action', {});
  game._advanceFromTimer(io, broadcast);
  assert.equal(victim.alive, false);
  assert.equal(other.alive, true);
  assert.equal(witch.hasUsedPoison, false, 'bo qua thi van con binh doc');
});

test('het ca hai binh thi phu thuy khong con duoc hoi gi', (t) => {
  const { game, witch } = witchNight(t);
  witch.hasUsedHeal = true;
  witch.hasUsedPoison = true;
  const prompt = game.getPhasePrompt(witch);
  assert.equal(prompt.canHeal, false);
  assert.equal(prompt.canPoison, false);
});
