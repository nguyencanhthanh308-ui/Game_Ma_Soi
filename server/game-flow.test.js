const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('./Game');
const io = { to: () => ({ emit() {} }) };
const noop = () => {};
// Moi pha deu chay het dong ho moi chuyen, nen test phai tu bao "het gio".
const hetGio = (g, broadcast = noop) => g._advanceFromTimer(io, broadcast);

function room(t, roles) {
  const g = new Game('FLOW');
  const players = roles.map((role, i) => Object.assign(g.addPlayer('s' + i, 'P' + i), { role }));
  t.after(() => clearTimeout(g.timer));
  return [g, players];
}

test('role reveal has no timer and waits for every reader, including a disconnected ready player', t => {
  const [g, [a, b, c]] = room(t, ['werewolf', 'villager', 'villager']);
  assert.ok(g.startGame({ werewolf: 1, villager: 2 }).ok);
  assert.equal(g.phase, PHASE.ROLE_REVEAL);
  assert.equal(g.timer, null); assert.equal(g.phaseEndsAt, null);
  const version = g.actionVersion;
  for (const p of [a, b]) assert.ok(g.recordAction(io, noop, p.id, 'ready', {}, version).ok);
  b.connected = false;
  assert.ok(g.recordAction(io, noop, c.id, 'ready', {}, version).ok);
  assert.equal(g.readyPlayers.size, 3);
  assert.equal(g.phase, PHASE.ROLE_REVEAL); assert.equal(g.nightNumber, 0);
  g._advanceFromTimer(io, noop); // No timeout may bypass reading or connectivity.
  assert.equal(g.phase, PHASE.ROLE_REVEAL);
  b.connected = true;
  assert.equal(g.startWhenReady(io, noop), true);
  assert.equal(g.phase, PHASE.NIGHT_WOLVES); assert.equal(g.nightNumber, 1);
  assert.ok(g.phaseEndsAt > Date.now());
  assert.equal(g.startWhenReady(io, noop), false);
  assert.ok(g.recordAction(io, noop, c.id, 'ready', {}, version).ok); // Lost-ack retry.
  assert.equal(g.nightNumber, 1);
});

test('invalid actions remain retryable; accepted votes are acknowledged once and old rounds cannot act', t => {
  const [g, [wolf, otherWolf, a, b]] = room(t, ['werewolf', 'werewolf', 'villager', 'villager']);
  g.phase = PHASE.NIGHT_WOLVES;
  g.night.remainingBites = 2;
  let broadcasts = 0;
  const broadcast = () => broadcasts++;
  const version = g.actionVersion;
  assert.equal(g.recordAction(io, broadcast, wolf.id, 'wolf_vote', { targetId: otherWolf.id }, version).ok, false);
  assert.equal(wolf.lastAction, undefined); assert.equal(broadcasts, 0);
  assert.ok(g.recordAction(io, broadcast, wolf.id, 'wolf_vote', { targetId: a.id }, version).ok);
  assert.equal(broadcasts, 1);
  assert.ok(g.recordAction(io, broadcast, wolf.id, 'wolf_vote', { targetId: a.id }, version).ok);
  assert.equal(broadcasts, 1);
  assert.equal(g.recordAction(io, broadcast, wolf.id, 'wolf_vote', { targetId: b.id }, version).ok, false);
  assert.ok(g.recordAction(io, broadcast, otherWolf.id, 'wolf_vote', { targetId: a.id }, version).ok);
  hetGio(g, broadcast);
  assert.equal(g.night.wolfRound, 2);
  assert.deepEqual(g.night.wolfVictims, [a.id]);
  assert.equal(g.recordAction(io, broadcast, wolf.id, 'wolf_vote', { targetId: b.id }, version).ok, false);
  assert.deepEqual(g.night.wolfVotes, {});
  assert.ok(g.recordAction(io, broadcast, wolf.id, 'wolf_vote', { targetId: b.id }, g.actionVersion).ok);
});

test('late witch heal does not consume poison or resolve the night again', t => {
  const [g, [witch, a, b]] = room(t, ['witch', 'villager', 'werewolf']);
  g.phase = PHASE.NIGHT_WITCH;
  g.night.wolfVictims = [a.id]; g.night.currentWolfVictim = a.id;
  const version = g.actionVersion;
  assert.ok(g.recordAction(io, noop, witch.id, 'witch_action', { heal: true }, version).ok);
  assert.ok(g.recordAction(io, noop, witch.id, 'witch_action', { heal: true }, version).ok);
  assert.equal(g.phase, PHASE.NIGHT_WITCH); assert.equal(witch.hasUsedPoison, false);
  assert.equal(g.recordAction(io, noop, witch.id, 'witch_action', { poisonTargetId: b.id }, version).ok, false);
  assert.ok(g.recordAction(io, noop, witch.id, 'witch_action', { poisonTargetId: b.id }, g.actionVersion).ok);
  hetGio(g);
  assert.equal(a.alive, true); assert.equal(b.alive, false);
});

test('an empty first bite keeps its slot; the second victim is never offered as the first heal target', t => {
  const [g, [wolf, witch, victim]] = room(t, ['werewolf', 'witch', 'villager']);
  g.phase = PHASE.NIGHT_WOLVES;
  g.night.wolfVictims = [null]; g.night.wolfRound = 2;
  g.night.wolfVotes[wolf.id] = victim.id;
  g._finishWolfRound(io, noop);
  assert.deepEqual(g.night.wolfVictims, [null, victim.id]);
  assert.equal(g.night.currentWolfVictim, null);
  assert.equal(g.phase, PHASE.NIGHT_WITCH);
  assert.equal(g.getPhasePrompt(witch).canHeal, false);
  assert.equal(g.getPhasePrompt(witch).victimName, null);
  assert.equal(g.recordAction(io, noop, witch.id, 'witch_action', { heal: true }).ok, false);
  assert.equal(witch.hasUsedHeal, false);
  g._advanceFromTimer(io, noop);
  assert.equal(victim.alive, false);
});

test('witch healing saves only the first of two wolf victims', t => {
  const [g, [wolf, witch, first, second]] = room(t, ['werewolf', 'witch', 'villager', 'villager']);
  g.phase = PHASE.NIGHT_WOLVES; g.night.remainingBites = 2;
  assert.ok(g.recordAction(io, noop, wolf.id, 'wolf_vote', { targetId: first.id }).ok);
  hetGio(g);   // het luot can thu nhat, sang luot thu hai cua Soi con
  assert.ok(g.recordAction(io, noop, wolf.id, 'wolf_vote', { targetId: second.id }).ok);
  hetGio(g);   // het dem Soi, sang cac vai con lai
  g.phase = PHASE.NIGHT_WITCH;
  assert.equal(g.getPhasePrompt(witch).victimName, first.name);
  assert.ok(g.recordAction(io, noop, witch.id, 'witch_action', { heal: true }).ok);
  assert.ok(g.recordAction(io, noop, witch.id, 'witch_action', {}).ok);
  hetGio(g);
  assert.equal(first.alive, true); assert.equal(second.alive, false);
});

test('invalid durations cannot mutate roles or start a game', t => {
  const [g, players] = room(t, [null, null, null]);
  for (const durations of [null, [], { NIGHT_WOLVES: {} }, { NIGHT_WOLVES: '30' }, { NIGHT_WOLVES: -1 }, { NIGHT_WOLVES: 601 }, { LOBBY: 30 }]) {
    assert.equal(g.startGame({ werewolf: 1, villager: 2 }, durations).ok, false);
    assert.equal(g.phase, PHASE.LOBBY); assert.ok(players.every(p => p.role === null));
  }
});
