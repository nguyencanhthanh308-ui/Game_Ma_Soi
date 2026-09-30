const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('./Game');

const io = { to: () => ({ emit() {} }) };

function setup(roles, t) {
  const g = new Game('CAUSE');
  roles.forEach((_, i) => g.addPlayer('s' + i, 'P' + i));
  const config = {};
  roles.forEach((r) => { config[r] = (config[r] || 0) + 1; });
  assert.ok(g.startGame(config).ok);
  const players = [...g.players.values()];
  players.forEach((p, i) => { p.role = roles[i]; });
  g.nightNumber = 1;
  g._goToPhase = () => {};
  t?.after(() => clearTimeout(g.timer));
  return [g, players];
}

test('bi Soi can: nguoi chet biet ly do, nguoi yeu chet theo cung biet', (t) => {
  const [g, [wolf, victim, lover]] = setup(['werewolf', 'villager', 'villager', 'villager'], t);
  victim.loverId = lover.id; lover.loverId = victim.id;
  g.night.wolfVictims = [victim.id];
  g._resolveNight(io, () => {});
  assert.equal(victim.deathCause, 'Bị Sói cắn trong đêm');
  assert.equal(lover.deathCause, 'Đau lòng chết theo người yêu P1');
  assert.match(g.getPhasePrompt(victim).message, /Bị Sói cắn trong đêm/);
  assert.equal(wolf.deathCause, null);
});

test('vua bi can vua bi doc: ghi ca hai ly do', (t) => {
  const [g, [, victim]] = setup(['werewolf', 'villager', 'witch', 'villager'], t);
  g.night.wolfVictims = [victim.id];
  g.night.witchPoisonTarget = victim.id;
  g._resolveNight(io, () => {});
  assert.equal(victim.deathCause, 'Bị Sói cắn trong đêm và bị Phù thủy đầu độc');
});

test('bi treo co va bi Tho san ban', (t) => {
  const [g, [hunter, target]] = setup(['hunter', 'werewolf', 'villager', 'villager'], t);
  g.lastVoteResult = {};
  g._eliminateByVote(io, () => {}, hunter.id);
  assert.equal(hunter.deathCause, 'Bị dân làng bỏ phiếu treo cổ');
  assert.equal(g.phase === PHASE.HUNTER_SHOT || g.pendingHunterQueue.length === 1, true);
  g._resolveHunterShot(target.id);
  assert.equal(target.deathCause, 'Bị Thợ săn P0 bắn trước khi chết');
});

test('Tho san bo qua hoac het gio thi khong ban ai', (t) => {
  const [g, [hunter, , other]] = setup(['hunter', 'werewolf', 'villager', 'villager'], t);
  g.lastVoteResult = {};
  g._eliminateByVote(io, () => {}, hunter.id);
  const aliveBefore = g.alivePlayers().length;
  g._resolveHunterShot(null); // het gio ma khong chon
  assert.equal(g.alivePlayers().length, aliveBefore, 'khong duoc giet oan ai');
  assert.equal(other.alive, true);
  assert.equal(g.pendingHunterQueue.length, 0, 'van phai roi hang doi de khong ket o pha nay');
});
