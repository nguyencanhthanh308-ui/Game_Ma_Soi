const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('./Game');
const { getDefaultRoleConfig, suggestedWolfCount, validateRoleConfig, expandRoleConfig } = require('./roles');

const wolvesIn = (c) => c.werewolf + c.wolfcub + c.whitewolf;

test('so Soi goi y bam theo bang chuan cua Ma Soi', () => {
  // 6 nguoi tro xuong: 1 Soi (2 Soi o co nay Dan lang gan nhu khong the thang)
  for (const n of [3, 4, 5, 6]) assert.equal(suggestedWolfCount(n), 1, n + ' nguoi');
  // 7 la co nho nhat ma 2 Soi choi duoc
  for (const n of [7, 8, 9, 10, 11]) assert.equal(suggestedWolfCount(n), 2, n + ' nguoi');
  for (const n of [12, 15]) assert.equal(suggestedWolfCount(n), 3, n + ' nguoi');
  for (const n of [16, 19]) assert.equal(suggestedWolfCount(n), 4, n + ' nguoi');
  assert.equal(suggestedWolfCount(20), 5);
});

test('ty le Soi luon nam trong khoang hop ly, khong bao gio ap dao', () => {
  for (let n = 3; n <= 20; n++) {
    const wolves = wolvesIn(getDefaultRoleConfig(n));
    const share = wolves / n;
    assert.ok(share >= 0.15 && share <= 0.34, `${n} nguoi: ${wolves} Soi = ${(share * 100).toFixed(0)}%`);
    assert.ok(wolves * 2 < n, `${n} nguoi: ${wolves} Soi khong duoc bang hoac hon nua phong`);
  }
});

test('bo vai goi y luon hop le va dung tong so nguoi', () => {
  for (let n = 1; n <= 20; n++) {
    const config = getDefaultRoleConfig(n);
    assert.deepEqual(validateRoleConfig(config, n), [], n + ' nguoi');
    assert.equal(expandRoleConfig(config).length, n, n + ' nguoi phai du ' + n + ' la bai');
  }
});

test('Soi con va Soi trang thay cho Soi thuong chu khong cong them', () => {
  for (let n = 9; n <= 20; n++) {
    const c = getDefaultRoleConfig(n);
    assert.equal(wolvesIn(c), suggestedWolfCount(n), n + ' nguoi');
  }
  assert.equal(getDefaultRoleConfig(8).wolfcub, 0, 'phong nho chua co Soi con');
});

test('chia vai cong bang: khong vi tri nguoi choi nao duoc uu ai', () => {
  const n = 8;
  const config = getDefaultRoleConfig(n);
  const RUNS = 12000;
  const counts = Array.from({ length: n }, () => ({}));
  for (let r = 0; r < RUNS; r++) {
    const g = new Game('T');
    for (let i = 0; i < n; i++) g.addPlayer('s' + i, 'P' + i);
    g.startGame(config);
    [...g.players.values()].forEach((p, i) => { counts[i][p.role] = (counts[i][p.role] || 0) + 1; });
    if (g.timer) clearTimeout(g.timer);
  }
  // Moi vai phai roi vao moi vi tri voi ty le xap xi nhau (sai so thong ke < 4%)
  for (const role of Object.keys(config).filter((r) => config[r] > 0)) {
    const expected = config[role] / n;
    for (let i = 0; i < n; i++) {
      const actual = (counts[i][role] || 0) / RUNS;
      assert.ok(Math.abs(actual - expected) < 0.04,
        `vai ${role} o vi tri ${i}: thuc te ${(actual * 100).toFixed(1)}% vs ly thuyet ${(expected * 100).toFixed(1)}%`);
    }
  }
});
