const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('./Game');

const io = { to: () => ({ emit() {} }) };
const noop = () => {};

// Bo vai phai qua duoc luat can bang (Soi khong duoc chiem tu nua lang tro len),
// nen can du Dan lang ngay tu dau roi moi cho ho chet dan trong tung kich ban.
function setup(roles, t) {
  const g = new Game('WWEND');
  roles.forEach((_, i) => g.addPlayer('s' + i, 'P' + i));
  const config = {};
  roles.forEach((r) => { config[r] = (config[r] || 0) + 1; });
  const started = g.startGame(config);
  assert.deepEqual(started.errors, undefined, 'bo vai dung de dung test');
  const players = [...g.players.values()];
  players.forEach((p, i) => { p.role = roles[i]; });
  t.after(() => clearTimeout(g.timer));
  return [g, players];
}

const PACK = ['whitewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager'];
const killVillagers = (players) => players.filter((p) => p.role === 'villager').forEach((p) => { p.alive = false; });

// Truoc khi sua: van treo o day. Bay Soi khong con ai de can, ban ngay chi con Soi bo phieu
// lan nhau, con Soi trang thi phai cho den dem chan moi duoc ra tay.
test('het Dan lang thi Soi trang duoc san ca dem le, van khong treo', (t) => {
  const [g, players] = setup(PACK, t);
  killVillagers(players);
  g.nightNumber = 3; // dem le
  g._goToPhase(io, noop, PHASE.NIGHT_WHITEWOLF);
  assert.equal(g.phase, PHASE.NIGHT_WHITEWOLF, 'luot Soi trang khong duoc bo qua khi het Dan lang');
});

// Lich cach mot dem la de giau thong tin voi Dan lang, nen con Dan lang thi phai giu nguyen
test('con Dan lang thi Soi trang van giu dung lich cach mot dem', (t) => {
  const [g] = setup(PACK, t);
  g.nightNumber = 3;
  g._goToPhase(io, noop, PHASE.NIGHT_WHITEWOLF);
  assert.notEqual(g.phase, PHASE.NIGHT_WHITEWOLF, 'dem le van phai bo qua luot Soi trang');
});

test('Soi trang giet not dong bon cuoi cung thi thang mot minh', (t) => {
  const [g, players] = setup(PACK, t);
  const [white, grey] = players;
  killVillagers(players);
  assert.equal(g._checkWinCondition(), null, 'con hai Soi thi chua ai thang');
  g._applyDeaths(io, [grey.id]);
  assert.equal(g._checkWinCondition()?.winner, 'whitewolf');
  assert.equal(white.alive, true);
});

// Khong co Soi trang thi luat cu van dung: het Dan lang la phe Soi thang ngay
test('khong co Soi trang: het Dan lang thi phe Soi thang ngay', (t) => {
  const [g, players] = setup(['werewolf', 'werewolf', 'villager', 'villager', 'villager'], t);
  killVillagers(players);
  assert.equal(g._checkWinCondition()?.winner, 'wolves');
});
