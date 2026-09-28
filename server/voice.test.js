const test = require('node:test');
const assert = require('node:assert/strict');
const { voiceChannelFor, voiceRoster } = require('./voice');

function fakeGame(phase, players) {
  return { phase, players: new Map(players.map((p, i) => [String(i), { id: String(i), connected: true, ...p }])) };
}

test('living players get the village channel outside of night phases', () => {
  for (const phase of ['LOBBY', 'DAY_ANNOUNCE', 'DAY_DISCUSSION', 'DAY_VOTE', 'DAY_RESOLVE', 'HUNTER_SHOT', 'GAME_OVER']) {
    const game = fakeGame(phase, []);
    const villager = { alive: true, role: 'villager' };
    const wolf = { alive: true, role: 'werewolf' };
    assert.equal(voiceChannelFor(game, villager), 'village', phase);
    assert.equal(voiceChannelFor(game, wolf), 'village', phase);
  }
});

test('at night only the wolf team gets a channel, everyone else is silent', () => {
  for (const phase of ['NIGHT_CUPID', 'NIGHT_GUARD', 'NIGHT_WOLVES', 'NIGHT_WHITEWOLF', 'NIGHT_SEER', 'NIGHT_WITCH']) {
    const game = fakeGame(phase, []);
    assert.equal(voiceChannelFor(game, { alive: true, role: 'werewolf' }), 'wolves', phase);
    assert.equal(voiceChannelFor(game, { alive: true, role: 'whitewolf' }), 'wolves', phase);
    assert.equal(voiceChannelFor(game, { alive: true, role: 'wolfcub' }), 'wolves', phase);
    assert.equal(voiceChannelFor(game, { alive: true, role: 'villager' }), null, phase);
    assert.equal(voiceChannelFor(game, { alive: true, role: 'seer' }), null, phase);
  }
});

test('dead players always get the underworld channel regardless of phase or role', () => {
  for (const phase of ['LOBBY', 'NIGHT_WOLVES', 'DAY_DISCUSSION', 'GAME_OVER']) {
    const game = fakeGame(phase, []);
    assert.equal(voiceChannelFor(game, { alive: false, role: 'werewolf' }), 'dead', phase);
    assert.equal(voiceChannelFor(game, { alive: false, role: 'villager' }), 'dead', phase);
  }
});

test('voiceRoster groups only connected players by channel, excludes silenced ones', () => {
  const game = fakeGame('NIGHT_WOLVES', [
    { alive: true, role: 'werewolf', name: 'Wolf', socketId: 's0', connected: true },
    { alive: true, role: 'villager', name: 'Villager', socketId: 's1', connected: true },
    { alive: false, role: 'seer', name: 'DeadSeer', socketId: 's2', connected: true },
    { alive: true, role: 'wolfcub', name: 'Disconnected', socketId: 's3', connected: false },
  ]);
  const groups = voiceRoster(game);
  assert.deepEqual(groups.wolves.map(p => p.name), ['Wolf']);
  assert.deepEqual(groups.village, []);
  assert.deepEqual(groups.dead.map(p => p.name), ['DeadSeer']);
});

test('voiceRoster reflects village channel by day, closing wolves and dead lists appropriately', () => {
  const game = fakeGame('DAY_DISCUSSION', [
    { alive: true, role: 'werewolf', name: 'Wolf', socketId: 's0', connected: true },
    { alive: true, role: 'villager', name: 'Villager', socketId: 's1', connected: true },
    { alive: false, role: 'seer', name: 'DeadSeer', socketId: 's2', connected: true },
  ]);
  const groups = voiceRoster(game);
  assert.deepEqual(groups.village.map(p => p.name).sort(), ['Villager', 'Wolf']);
  assert.deepEqual(groups.wolves, []);
  assert.deepEqual(groups.dead.map(p => p.name), ['DeadSeer']);
});
