const test = require('node:test');
const assert = require('node:assert/strict');
const { Chat } = require('./Chat');

function setup() {
  const players = ['werewolf', 'wolfcub', 'whitewolf', 'villager', 'cursed'].map((role, i) => ({ id: String(i), name: 'Player'+i, role, alive: true }));
  return { chat: new Chat(), game: { phase: 'NIGHT_WOLVES', players: new Map(players.map(p => [p.id, p])) }, players };
}

test('wolf chat is delivered only to eligible wolves, never villagers or dead wolves', () => {
  const { chat, game, players: [wolf, cub, white, villager] } = setup();
  assert.ok(chat.send(game, wolf, { channel: 'wolves', text: 'Bite target' }).ok);
  for (const p of [wolf, cub, white]) assert.equal(chat.snapshot(game, p).messages.length, 1);
  assert.equal(chat.snapshot(game, villager).messages.length, 0);
  assert.equal(chat.send(game, villager, { channel: 'wolves', text: 'intruder' }).ok, false);
  cub.alive = false;
  assert.equal(chat.snapshot(game, cub).messages.length, 0);
  assert.equal(chat.send(game, cub, { channel: 'wolves', text: 'dead' }).ok, false);
  assert.equal('audience' in chat.snapshot(game, wolf).messages[0], false);
});

test('cursed sees wolf messages only after joining the pack', () => {
  const { chat, game, players: [wolf, , , , cursed] } = setup();
  chat.send(game, wolf, { channel: 'wolves', text: 'Before conversion' }, 1000);
  cursed.role = 'werewolf';
  assert.equal(chat.snapshot(game, cursed).messages.length, 0);
  chat.send(game, wolf, { channel: 'wolves', text: 'After conversion' }, 2000);
  assert.deepEqual(chat.snapshot(game, cursed).messages.map(m => m.text), ['After conversion']);
});

test('public discussion is gated by phase and death, and wolves talk only at night', () => {
  const { chat, game, players: [wolf, , , villager] } = setup();
  for (const phase of ['LOBBY', 'DAY_DISCUSSION', 'DAY_VOTE', 'GAME_OVER']) {
    game.phase = phase;
    assert.equal(chat.permissions(game, villager).public.canSend, true);
    assert.equal(chat.permissions(game, wolf).wolves.canSend, false);
  }
  for (const phase of ['NIGHT_SEER', 'DAY_ANNOUNCE', 'HUNTER_SHOT']) {
    game.phase = phase;
    assert.equal(chat.send(game, villager, { channel: 'public', text: 'Too early' }).ok, false);
  }
  game.phase = 'DAY_DISCUSSION'; villager.alive = false;
  assert.equal(chat.permissions(game, villager).public.canSend, false);
  assert.equal(chat.permissions(game, villager).public.canRead, true);
  game.phase = 'GAME_OVER';
  assert.equal(chat.permissions(game, villager).public.canSend, true);
});

test('chat validates input, derives author on server, limits spam and history, clears on reset', () => {
  const { chat, game, players: [wolf] } = setup();
  for (const data of [null, {}, {channel:'other',text:'hi'}, {channel:'wolves',text:5}, {channel:'wolves',text:' '}, {channel:'wolves',text:'a'.repeat(501)}]) {
    assert.equal(chat.send(game, wolf, data).ok, false);
  }
  assert.ok(chat.send(game, wolf, {channel:'wolves',text:'  hello  ',name:'fake'},1000).ok);
  assert.equal(chat.send(game, wolf, {channel:'wolves',text:'spam'},1100).ok,false);
  assert.equal(chat.snapshot(game,wolf).messages[0].name,wolf.name);
  for(let i=0;i<105;i++) chat.send(game,wolf,{channel:'wolves',text:'Message '+i},2000+i*1000);
  assert.equal(chat.snapshot(game,wolf).messages.length,100);
  chat.reset();assert.equal(chat.snapshot(game,wolf).messages.length,0);
});
