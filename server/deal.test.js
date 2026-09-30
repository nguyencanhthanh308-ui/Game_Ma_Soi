const test = require('node:test');
const assert = require('node:assert');
const { Game, PHASE } = require('./Game');

function lobbyWith(count) {
  const game = new Game('DEAL1');
  for (let i = 0; i < count; i++) game.addPlayer('s' + i, 'P' + i);
  return game;
}

test('choi lai nhieu van: vai dac biet khong roi lai dung nguoi van truoc', () => {
  const game = lobbyWith(6);
  const config = { werewolf: 1, seer: 1, witch: 1, guard: 1, hunter: 1, cupid: 1 };
  let repeats = 0;
  for (let round = 0; round < 20; round++) {
    const before = new Map([...game.players.values()].map((p) => [p.id, p.role]));
    game.phase = PHASE.LOBBY;
    assert.ok(game.startGame(config).ok);
    for (const p of game.players.values()) if (before.get(p.id) === p.role) repeats++;
  }
  // Moi vai chi co mot, nen luon co cach chia khong ai trung vai van truoc
  assert.strictEqual(repeats, 0);
});

test('lich su vai chi giu 3 van gan nhat', () => {
  const game = lobbyWith(5);
  for (let round = 0; round < 5; round++) {
    game.phase = PHASE.LOBBY;
    assert.ok(game.startGame({ werewolf: 1, seer: 1, villager: 3 }).ok);
  }
  for (const p of game.players.values()) {
    assert.strictEqual(p.roleHistory.length, 3);
    assert.strictEqual(p.roleHistory[0], p.role);
  }
});
