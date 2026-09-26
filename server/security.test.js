const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket, RoomCleanup } = require('./Security');
const { Game, PHASE } = require('./Game');
const { validateRoleConfig } = require('./roles');

test('invalid role counts cannot invoke object coercion or throw', () => {
  for (const value of [null, {}, [], '1', -1, 1.5, {valueOf:null,toString:null}]) {
    for (const role of ['werewolf', 'wolfcub', 'whitewolf']) {
      assert.ok(validateRoleConfig({[role]:value,villager:2},3).length);
    }
  }
  assert.deepEqual(validateRoleConfig({werewolf:1,villager:2},3),[]);
});

test('rate limit bounds bursts and recovers without accumulating unlimited credit', () => {
  let now = 0;
  const bucket = new TokenBucket(3, 2, () => now);
  assert.deepEqual(Array.from({length:4}, () => bucket.take()),[true,true,true,false]);
  now = 500;
  assert.equal(bucket.take(),true);
  assert.equal(bucket.take(),false);
  now = 100000;
  assert.deepEqual(Array.from({length:4}, () => bucket.take()),[true,true,true,false]);
});

test('no-op, duplicate and out-of-phase actions do not broadcast', () => {
  const g = new Game('CHECK');
  const a = g.addPlayer('a','A');
  g.addPlayer('b','B');
  let broadcasts = 0;
  const broadcast = () => broadcasts++;
  const io = {to: () => ({emit() {}})};
  g.recordAction(io,broadcast,a.id,'unknown',{});
  g.recordAction(io,broadcast,a.id,'ready',{});
  assert.equal(broadcasts,0);
  g.phase = PHASE.ROLE_REVEAL;
  g.recordAction(io,broadcast,a.id,'ready',{});
  g.recordAction(io,broadcast,a.id,'ready',{});
  assert.equal(broadcasts,1);
  g.phase = PHASE.DAY_DISCUSSION;
  g.recordAction(io,broadcast,a.id,'skip_day',{dayNumber:0});
  g.recordAction(io,broadcast,a.id,'skip_day',{dayNumber:0});
  assert.equal(broadcasts,2);
});

test('empty-room cleanup preserves reconnect grace, cancels on return and stops game timers', async () => {
  const rooms = new Map();
  const jobs = new Map();
  let seq = 0;
  const cleanup = new RoomCleanup(rooms, {
    schedule(fn, delay) { assert.equal(delay,300000); jobs.set(++seq,fn); return seq; },
    cancel(id) { jobs.delete(id); },
  });
  const g = new Game('ROOM');
  const p = g.addPlayer('p','Player');
  g.phase = PHASE.ROLE_REVEAL;
  rooms.set(g.roomCode,g);
  g.removePlayerBySocket('p');
  cleanup.update(g); cleanup.update(g);
  assert.equal(jobs.size,1);
  assert.equal(rooms.size,1);
  g.reconnectByName('new','Player');
  cleanup.update(g);
  assert.equal(jobs.size,0);
  assert.equal(cleanup.pending.size,0);
  g.removePlayerBySocket('new');
  cleanup.update(g);
  let timerFired = false;
  g.timer = setTimeout(() => { timerFired = true; },20);
  jobs.values().next().value();
  assert.equal(rooms.size,0);
  assert.equal(cleanup.pending.size,0);
  await new Promise(resolve => setTimeout(resolve,35));
  assert.equal(timerFired,false);
  assert.equal(p.connected,false);
});
