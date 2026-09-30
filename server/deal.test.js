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

// Chi nho van ngay truoc: nho nhieu hon thi nguoi choi suy ra duoc vai cua minh van nay
test('lich su vai chi giu dung van gan nhat', () => {
  const game = lobbyWith(5);
  for (let round = 0; round < 5; round++) {
    game.phase = PHASE.LOBBY;
    assert.ok(game.startGame({ werewolf: 1, seer: 1, villager: 3 }).ok);
  }
  for (const p of game.players.values()) {
    assert.strictEqual(p.roleHistory.length, 1);
    assert.strictEqual(p.roleHistory[0], p.role);
  }
});

// Nho 2 van thi ai lam Soi 2 van lien se biet chac van nay minh khong phai Soi.
test('vai cua hai van truoc van co the quay lai', () => {
  const game = lobbyWith(4);
  const config = { werewolf: 1, seer: 1, villager: 2 };
  const seen = new Map();
  let repeatedAfterGap = 0;
  for (let round = 0; round < 60; round++) {
    game.phase = PHASE.LOBBY;
    assert.ok(game.startGame(config).ok);
    for (const p of game.players.values()) {
      const history = seen.get(p.id) || [];
      if (history[1] === p.role) repeatedAfterGap++;
      seen.set(p.id, [p.role, ...history].slice(0, 2));
    }
  }
  assert.ok(repeatedAfterGap > 0, 'cach mot van thi vai cu phai quay lai duoc, neu khong la doan duoc');
});
