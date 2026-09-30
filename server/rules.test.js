const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('./Game');

const io = { to: () => ({ emit() {} }) };
const noop = () => {};
function setup(roles) {
  const g = new Game('RULE');
  roles.forEach((role, i) => {
    const p = g.addPlayer('s' + i, 'P' + i);
    Object.assign(p, { role, biteCount: 0, doomedNight: null });
  });
  g._goToPhase = (_io, _fn, phase) => { g.phase = phase; g.actionVersion++; };
  g.nightNumber = 1;
  return [g, [...g.players.values()]];
}

// ---- Soi trang: luat chuan la thuc day CACH MOT DEM, tu dem thu hai ----
test('Soi trang khong co luot o dem dau', (t) => {
  const [g] = setup(['whitewolf', 'werewolf', 'villager', 'villager']);
  g.nightNumber = 1;
  assert.equal(g._whiteWolfActsTonight(), false);
});

test('Soi trang co luot o dem chan, nghi o dem le', (t) => {
  const [g] = setup(['whitewolf', 'werewolf', 'villager', 'villager']);
  for (const [night, expected] of [[1, false], [2, true], [3, false], [4, true], [5, false], [6, true]]) {
    g.nightNumber = night;
    assert.equal(g._whiteWolfActsTonight(), expected, 'dem ' + night);
  }
});

test('Soi trang giet duoc nhieu lan chu khong chi mot lan ca van', (t) => {
  const [g, [ww, wolfA, wolfB]] = setup(['whitewolf', 'werewolf', 'werewolf', 'villager', 'villager']);
  g.nightNumber = 2;
  g.phase = PHASE.NIGHT_WHITEWOLF;
  assert.equal(g.recordAction(io, noop, ww.id, 'whitewolf_kill', { targetId: wolfA.id }).ok, true);
  assert.equal(g.night.whiteWolfTarget, wolfA.id);

  // Dem thu tu: van con luot, van giet duoc
  g.nightNumber = 4;
  g.night = g._emptyNightActions();
  g.phase = PHASE.NIGHT_WHITEWOLF;
  assert.equal(g._whiteWolfActsTonight(), true, 'da dung 1 lan van con luot');
  assert.equal(g.recordAction(io, noop, ww.id, 'whitewolf_kill', { targetId: wolfB.id }).ok, true);
  assert.equal(g.night.whiteWolfTarget, wolfB.id);
});

test('Soi trang chet roi van duoc goi dung lich (de khong lo no da chet), nhung khong ai hanh dong', (t) => {
  const [g, [ww]] = setup(['whitewolf', 'werewolf', 'villager', 'villager']);
  g.nightNumber = 2;
  ww.alive = false;
  assert.equal(g._whiteWolfActsTonight(), true, 'dem chan van phai co luot Soi trang');
  assert.equal(g._phaseActorAlive(PHASE.NIGHT_WHITEWOLF), false, 'nhung khong con ai de hanh dong');
});

// ---- Nguoi yeu khong duoc bo phieu chong lai nhau ----
test('nguoi yeu khong hien trong danh sach neu ten', (t) => {
  const [g, [a, b, c]] = setup(['villager', 'villager', 'werewolf', 'villager']);
  a.loverId = b.id; b.loverId = a.id;
  g.phase = PHASE.DAY_VOTE;
  const names = g.getPhasePrompt(a).targets.map((x) => x.id);
  assert.ok(!names.includes(b.id), 'khong duoc neu ten nguoi minh yeu');
  assert.ok(names.includes(c.id), 'nguoi khac van neu ten binh thuong');
});

test('nguoi yeu chi duoc xin tha, khong duoc bo phieu treo co', (t) => {
  const [g, [a, b, c, d]] = setup(['villager', 'villager', 'werewolf', 'villager']);
  a.loverId = b.id; b.loverId = a.id;
  g.accusedId = b.id;
  g.phase = PHASE.DAY_JUDGEMENT;

  const prompt = g.getPhasePrompt(a);
  assert.equal(prompt.onlySpare, true);
  assert.match(prompt.message, /chỉ có thể xin tha/);

  assert.equal(g.recordAction(io, noop, a.id, 'judge_vote', { verdict: 'kill' }).ok, false, 'phieu treo co phai bi tu choi');
  assert.equal(g.judgeVotes[a.id], undefined);
  assert.equal(g.recordAction(io, noop, a.id, 'judge_vote', { verdict: 'spare' }).ok, true);
  assert.equal(g.judgeVotes[a.id], 'spare');

  // Nguoi khong phai nguoi yeu thi bo phieu treo co binh thuong
  assert.ok(!g.getPhasePrompt(c).onlySpare, 'nguoi khong phai nguoi yeu thi khong bi han che');
  assert.equal(g.recordAction(io, noop, c.id, 'judge_vote', { verdict: 'kill' }).ok, true);
});

test('nguoi yeu chet theo nhau', (t) => {
  const [g, [a, b]] = setup(['villager', 'villager', 'werewolf', 'villager']);
  a.loverId = b.id; b.loverId = a.id;
  g._applyDeaths(io, [a.id]);
  assert.equal(a.alive, false);
  assert.equal(b.alive, false, 'nguoi con lai phai chet theo');
});
