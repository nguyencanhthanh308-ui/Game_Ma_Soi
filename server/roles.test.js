const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('./Game');
const { ROLE_INFO, validateRoleConfig, getDefaultRoleConfig } = require('./roles');
const io = { to: () => ({ emit() {} }) };
const noop = () => {};
function setup(roles) {
  const g = new Game('TEST');
  roles.forEach((role, i) => {
    const p = g.addPlayer('socket'+i, 'Player'+i);
    Object.assign(p, {role, biteCount:0, doomedNight:null});
  });
  // Keep phase transitions deterministic without real timers.
  g._goToPhase = (_io, _fn, phase) => { g.phase = phase; };
  g.nightNumber = 1;
  return [g, [...g.players.values()]];
}
function bite(g, p) { g.night = g._emptyNightActions(); g.night.wolfVictims = [p.id]; g.night.currentWolfVictim = p.id; g._resolveNight(io, noop); }
test('death announcements and public players hide dead roles until game over', () => {
  const [g, players] = setup(['werewolf', 'seer', 'witch', 'guard', 'hunter', 'prince']);
  players[5].revealedPrince = true;
  g._applyDeaths(io, players.map(p => p.id));
  for (const phase of [PHASE.DAY_ANNOUNCE, PHASE.DAY_DISCUSSION, PHASE.DAY_VOTE]) {
    g.phase = phase;
    const state = JSON.parse(JSON.stringify(g.publicState()));
    assert.ok(state.players.every(p => !('role' in p) && !('roleName' in p)));
    if (state.lastDeaths) {
      assert.equal(state.lastDeaths.length, 6);
      assert.ok(state.lastDeaths.every(p => !('role' in p) && !('roleName' in p)));
    }
  }
  g.phase = PHASE.GAME_OVER;
  assert.ok(g.publicPlayerList().every(p => p.role && p.roleName));
});
test('unanimous skip moves directly to night without killing and resets votes', () => {
  const [g, players] = setup(['werewolf', 'villager', 'villager', 'villager', 'villager']);
  players[4].alive = false;
  g.phase = PHASE.DAY_DISCUSSION; g.dayNumber = 1;
  const vote = p => g.recordAction(io, noop, p.id, 'skip_day', {dayNumber: 1});
  vote(players[4]); assert.equal(g.skipDayVotes.size, 0);
  vote(players[0]); vote(players[0]); assert.equal(g.skipDayVotes.size, 1);
  vote(players[1]); vote(players[2]); assert.equal(g.phase, PHASE.DAY_DISCUSSION);
  vote(players[3]); assert.equal(g.phase, PHASE.NIGHT_GUARD);
  assert.equal(g.nightNumber, 2); assert.equal(g.alivePlayers().length, 4);
  assert.equal(g.skipDayVotes.size, 0); assert.equal(g.lastVoteResult.eliminatedId, null);
});
test('skip rejects wrong phases and stale day requests; incomplete vote preserves normal timer flow', () => {
  const [g, [p]] = setup(['werewolf', 'villager', 'villager', 'villager']);
  g.dayNumber = 2;
  for (const phase of [PHASE.NIGHT_WOLVES, PHASE.DAY_VOTE, PHASE.HUNTER_SHOT]) {
    g.phase = phase;
    g.recordAction(io, noop, p.id, 'skip_day', {dayNumber: 2});
    assert.equal(g.skipDayVotes.size, 0);
  }
  g.phase = PHASE.DAY_DISCUSSION;
  g.recordAction(io, noop, p.id, 'skip_day', {dayNumber: 1});
  assert.equal(g.skipDayVotes.size, 0);
  g.recordAction(io, noop, p.id, 'skip_day', {dayNumber: 2});
  g._advanceFromTimer(io, noop);
  assert.equal(g.phase, PHASE.DAY_VOTE);
});
test('16 role cards have complete instructions; defaults valid for 6–20 players', () => {
  assert.equal(Object.keys(ROLE_INFO).length,16);
  for (const r of Object.values(ROLE_INFO)) for (const field of ['name','desc','play','win','team','icon']) assert.ok(r[field]);
  for(let n=6;n<=20;n++) assert.deepEqual(validateRoleConfig(getDefaultRoleConfig(n),n),[]);
  for(const value of [-1,1.5,Infinity,'2']) assert.ok(validateRoleConfig({werewolf:value,villager:4},6).length);
  assert.ok(validateRoleConfig(null,6).length);
});
test('cursed changes into wolf only for an unprotected bite', () => {
  const [g,[p]] = setup(['cursed']);
  g.night.wolfVictims=[p.id];g.night.guardTarget=p.id;g._resolveNight(io,noop);
  assert.equal(p.role,'cursed');bite(g,p);assert.equal(p.role,'werewolf');assert.ok(p.alive);
});
test('elder survives first bite, dies on second', () => {
  const [g,[p]]=setup(['elder']);bite(g,p);assert.ok(p.alive);bite(g,p);assert.equal(p.alive,false);
});
test('tough guy dies next morning even with protection', () => {
  const [g,[p]]=setup(['toughguy']);bite(g,p);assert.ok(p.alive);
  g.nightNumber++;g.night=g._emptyNightActions();g.night.guardTarget=p.id;g._resolveNight(io,noop);assert.equal(p.alive,false);
});
test('poison bypasses passive bite resistance', () => {
  for(const role of ['elder','cursed','toughguy']) {const [g,[p]]=setup([role]);g.night.witchPoisonTarget=p.id;g._resolveNight(io,noop);assert.equal(p.alive,false);}
});
test('prince survives first execution and is publicly revealed', () => {
  const [g,[p]]=setup(['prince','werewolf','villager','villager']);
  g.dayVotes={v:p.id};g._resolveDayVote(io,noop);assert.ok(p.alive);assert.equal(g.publicPlayerList()[0].roleName,'Hoàng tử');
  g.dayVotes={v:p.id};g._resolveDayVote(io,noop);assert.equal(p.alive,false);
});
test('tanner wins on execution but not on bite', () => {
  const [g,[p]]=setup(['tanner','werewolf','villager']);g.dayVotes={v:p.id};g._resolveDayVote(io,noop);assert.equal(g.winner.winner,'tanner');
  const [h,[q]]=setup(['tanner','werewolf','villager']);bite(h,q);assert.equal(h.winner,null);
});
test('lycan appears as wolf to seer', () => {
  const [g,[seer,target]]=setup(['seer','lycan']);g.phase=PHASE.NIGHT_SEER;let result;
  g.recordAction({to:()=>({emit:(_event,data)=>result=data})},noop,seer.id,'seer_check',{targetId:target.id});assert.equal(result.isWolf,true);
});
test('dead hunter can shoot; another player cannot take the shot', () => {
  const [g,[hunter,target,other]]=setup(['hunter','werewolf','villager']);g._applyDeaths(io,[hunter.id]);g.phase=PHASE.HUNTER_SHOT;
  g.recordAction(io,noop,other.id,'hunter_shoot',{targetId:target.id});assert.ok(target.alive);
  g.recordAction(io,noop,hunter.id,'hunter_shoot',{targetId:target.id});assert.equal(target.alive,false);
});
test('cub killed by lover chain triggers two distinct bites next night', () => {
  const [g,[cub,lover,wolf,a,b]]=setup(['wolfcub','villager','werewolf','villager','villager']);lover.loverId=cub.id;
  g._applyDeaths(io,[lover.id]);g.enterNight(io,noop);g.phase=PHASE.NIGHT_WOLVES;
  g.recordAction(io,noop,wolf.id,'wolf_vote',{targetId:a.id});assert.equal(g.night.wolfRound,2);
  g.recordAction(io,noop,wolf.id,'wolf_vote',{targetId:a.id});assert.equal(g.night.wolfVictims.length,1);
  g.recordAction(io,noop,wolf.id,'wolf_vote',{targetId:b.id});assert.deepEqual(g.night.wolfVictims,[a.id,b.id]);
  g._resolveNight(io,noop);assert.equal(a.alive,false);assert.equal(b.alive,false);
});
test('white wolf participates in pack but prevents ordinary wolf victory', () => {
  const [g,[white,wolf,v]]=setup(['whitewolf','werewolf','villager']);g.phase=PHASE.NIGHT_WOLVES;
  assert.equal(g.getPhasePrompt(white).action,'wolf_vote');assert.equal(g._checkWinCondition(),null);
  wolf.alive=false;v.alive=false;assert.equal(g._checkWinCondition().winner,'whitewolf');
});
test('starting a new game clears previous role abilities and private roles remain hidden', () => {
  const [g,players]=setup(['elder','prince','werewolf','villager','villager','villager']);
  g.doubleKillNextNight=true;g.lastProtectedId='old';players[0].doomedNight=2;players[1].revealedPrince=true;
  assert.ok(g.startGame(getDefaultRoleConfig(6)).ok);assert.equal(g.doubleKillNextNight,false);assert.equal(g.lastProtectedId,null);
  assert.ok(players.every(p=>p.doomedNight===null&&!p.revealedPrince));assert.ok(g.publicPlayerList().every(p=>p.role===undefined));
});
