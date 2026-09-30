const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('./Game');

const noop = () => {};
const io = { to: () => ({ emit() {} }) };

// Mot van dang o pha bo phieu ban ngay, khong dung timer that.
function setup(count = 4) {
  const g = new Game('TRIAL');
  const roles = ['werewolf', 'villager', 'villager', 'villager', 'villager', 'villager'];
  for (let i = 0; i < count; i++) {
    const p = g.addPlayer('s' + i, 'P' + i);
    Object.assign(p, { role: roles[i], biteCount: 0, doomedNight: null });
  }
  g._goToPhase = (_io, _fn, phase) => { g.phase = phase; g.actionVersion++; };
  g.enterNight = () => { g.phase = 'NIGHT_DONE'; };
  g.nightNumber = 1;
  g.dayNumber = 1;
  g.phase = PHASE.DAY_VOTE;
  g.phaseEndsAt = Date.now() + 30000;
  return [g, [...g.players.values()]];
}
const vote = (g, voter, target) => g.recordAction(io, noop, voter.id, 'day_vote', { targetId: target?.id ?? null });
const judge = (g, voter, verdict) => g.recordAction(io, noop, voter.id, 'judge_vote', { verdict });

test('bang phieu cong khai: ai neu ten ai deu thay duoc ngay', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  vote(g, a, c);
  vote(g, b, c);
  const state = g.publicState();
  assert.deepEqual(state.dayVotes, { [a.id]: c.id, [b.id]: c.id });
  assert.equal(g.phase, PHASE.DAY_VOTE, 'chua du phieu thi chua chuyen pha');
});

test('moi nguoi chi giu mot phieu, doi phieu thi phieu cu bi thay', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  assert.equal(vote(g, a, b).ok, true);
  assert.equal(vote(g, a, c).ok, true, 'phai cho doi phieu');
  assert.deepEqual(g.publicState().dayVotes, { [a.id]: c.id });
  assert.equal(Object.keys(g.dayVotes).length, 1, 'khong duoc cong don thanh 2 phieu');
});

test('bo phieu trang duoc, va van doi lai thanh neu ten duoc', (t) => {
  const [g, [a, b]] = setup();
  t.after(() => clearTimeout(g.timer));
  assert.equal(vote(g, a, null).ok, true);
  assert.equal(g.publicState().dayVotes[a.id], null);
  assert.equal(vote(g, a, b).ok, true);
  assert.equal(g.publicState().dayVotes[a.id], b.id);
});

test('du phieu thi khong chot ngay ma de lai vai giay doi y', (t) => {
  const [g, players] = setup(3);
  t.after(() => clearTimeout(g.timer));
  const [a, b, c] = players;
  const before = g.phaseEndsAt;
  vote(g, a, c); vote(g, b, c); vote(g, c, a);
  assert.equal(g.phase, PHASE.DAY_VOTE, 'van con o pha bo phieu de ai muon doi y');
  assert.ok(g.phaseEndsAt < before, 'nhung thoi gian con lai phai duoc rut ngan');
  assert.equal(vote(g, a, b).ok, true, 'trong luc cho van doi phieu duoc');
});

test('nguoi bi nhieu phieu nhat duoc dua ra bien ho, chua chet ngay', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  vote(g, a, c); vote(g, b, c);
  g._resolveDayVote(io, noop);
  assert.equal(g.phase, PHASE.DAY_DEFENSE);
  assert.equal(g.accusedId, c.id);
  assert.equal(c.alive, true, 'bi neu ten chua phai la chet');
  assert.equal(g.publicState().accusedId, c.id);
});

test('hoa phieu thi khong ai bi dua ra xu', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  vote(g, a, b); vote(g, b, c);
  g._resolveDayVote(io, noop);
  assert.equal(g.accusedId, null);
  assert.equal(b.alive, true);
  assert.equal(c.alive, true);
});

test('bien ho xong, phe treo co nhieu hon thi nguoi do chet', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  vote(g, a, c); vote(g, b, c);
  g._resolveDayVote(io, noop);
  g._goToPhase(io, noop, PHASE.DAY_JUDGEMENT);
  judge(g, a, 'kill'); judge(g, b, 'kill');
  g._resolveJudgement(io, noop);
  assert.equal(c.alive, false);
  assert.equal(g.lastVoteResult.eliminatedId, c.id);
  assert.equal(g.lastVoteResult.judgement.kill, 2);
});

test('hoa phieu phan quyet thi duoc tha', (t) => {
  const [g, [a, b, c, d]] = setup(4);
  t.after(() => clearTimeout(g.timer));
  vote(g, a, d); vote(g, b, d);
  g._resolveDayVote(io, noop);
  g._goToPhase(io, noop, PHASE.DAY_JUDGEMENT);
  judge(g, a, 'kill'); judge(g, b, 'spare'); judge(g, c, 'spare');
  g._resolveJudgement(io, noop);
  assert.equal(d.alive, true, 'it phieu treo co hon thi phai duoc tha');
  assert.equal(g.lastVoteResult.eliminatedId, null);
});

test('doi y trong luc phan quyet duoc, va nguoi bi xu khong duoc tu bo phieu', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  vote(g, a, c); vote(g, b, c);
  g._resolveDayVote(io, noop);
  g._goToPhase(io, noop, PHASE.DAY_JUDGEMENT);
  assert.equal(judge(g, a, 'kill').ok, true);
  assert.equal(judge(g, a, 'spare').ok, true, 'phai cho doi y');
  assert.equal(g.judgeVotes[a.id], 'spare');
  assert.equal(judge(g, c, 'spare').ok, false, 'nguoi bi xu khong duoc bo phieu');
  assert.equal(g.publicState().judgeVotes[c.id], undefined);
});

test('nem ca chua / tang hoa chi nham vao nguoi dang bien ho', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  const sent = [];
  const spy = { to: () => ({ emit: (event, data) => sent.push([event, data]) }) };
  vote(g, a, c); vote(g, b, c);
  g._resolveDayVote(io, noop);

  assert.equal(g.recordAction(spy, noop, a.id, 'react', { targetId: c.id, kind: 'tomato' }).ok, true);
  assert.equal(g.reactionCounts[c.id].tomato, 1);
  assert.ok(sent.some(([event, d]) => event === 'reaction' && d.kind === 'tomato' && d.fromName === a.name));

  // Nham vao nguoi khac thi bi tu choi
  assert.equal(g.recordAction(spy, noop, a.id, 'react', { targetId: b.id, kind: 'flower' }).ok, false);
  assert.equal(g.reactionCounts[b.id], undefined);
});

test('nem lien tuc bi chan bot, nhung cho nem lai sau khi het do tre', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  vote(g, a, c); vote(g, b, c);
  g._resolveDayVote(io, noop);
  assert.equal(g.recordAction(io, noop, a.id, 'react', { targetId: c.id, kind: 'tomato' }).ok, true);
  assert.equal(g.recordAction(io, noop, a.id, 'react', { targetId: c.id, kind: 'tomato' }).ok, false, 'nem lien tay bi chan');
  g.lastReactionAt.set(a.id, Date.now() - 1000);
  assert.equal(g.recordAction(io, noop, a.id, 'react', { targetId: c.id, kind: 'flower' }).ok, true);
  assert.equal(g.reactionCounts[c.id].tomato, 1);
  assert.equal(g.reactionCounts[c.id].flower, 1);
});

test('ngoai pha bien ho thi khong nem duoc', (t) => {
  const [g, [a, b]] = setup();
  t.after(() => clearTimeout(g.timer));
  g.accusedId = b.id;
  g.phase = PHASE.DAY_DISCUSSION;
  assert.equal(g.recordAction(io, noop, a.id, 'react', { targetId: b.id, kind: 'tomato' }).ok, false);
});

test('nguoi da mat khong duoc neu ten hay phan quyet', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  a.alive = false;
  assert.equal(vote(g, a, c).ok, false);
  vote(g, b, c);
  g._resolveDayVote(io, noop);
  g._goToPhase(io, noop, PHASE.DAY_JUDGEMENT);
  assert.equal(judge(g, a, 'kill').ok, false);
});

test('phieu neu ten va phieu phan quyet chi lo ra o dung pha cua no', (t) => {
  const [g, [a, b, c]] = setup();
  t.after(() => clearTimeout(g.timer));
  vote(g, a, c);
  assert.ok(g.publicState().dayVotes, 'dang bo phieu thi phai thay bang phieu');
  assert.equal(g.publicState().judgeVotes, undefined);
  g.phase = PHASE.DAY_DISCUSSION;
  assert.equal(g.publicState().dayVotes, undefined, 'het pha bo phieu thi khong lo phieu nua');
});
