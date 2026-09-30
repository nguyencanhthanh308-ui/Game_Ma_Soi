const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createIceProvider, coturnCredentials, STUN_SERVERS } = require('./ice');

const quiet = { warn() {} };
const turnOnly = (r) => r.iceServers.filter((s) => s.username);

test('chua cau hinh TURN: chi co STUN va bao ro la khong co duong trung gian', async () => {
  const ice = createIceProvider({ env: {}, log: quiet });
  const r = await ice.getIceServers();
  assert.equal(r.relay, false);
  assert.equal(r.source, 'none');
  assert.deepEqual(r.iceServers, STUN_SERVERS);
});

test('Cloudflare: goi dung API va tra ve may chu TURN kem STUN', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({ iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
      ] }),
    };
  };
  const ice = createIceProvider({ env: { CF_TURN_KEY_ID: 'KEY', CF_TURN_API_TOKEN: 'TOKEN' }, fetchFn, log: quiet });
  const r = await ice.getIceServers();
  assert.equal(calls[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/KEY/credentials/generate-ice-servers');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer TOKEN');
  assert.equal(JSON.parse(calls[0].opts.body).ttl, 86400);
  assert.equal(r.relay, true);
  assert.equal(r.source, 'cloudflare');
  assert.equal(turnOnly(r).length, 1);
  assert.ok(turnOnly(r)[0].urls.some((u) => u.startsWith('turns:')), 'phai giu ca TURN qua TLS cong 443 cho mang chan UDP');
  assert.ok(r.iceServers.some((s) => !s.username), 'van giu STUN');
});

test('Cloudflare: dung lai tai khoan da lay, khong goi API moi lan co nguoi vao', async () => {
  let n = 0;
  let clock = 1_000_000_000_000;
  const fetchFn = async () => { n++; return { ok: true, json: async () => ({ iceServers: [{ urls: 'turn:x', username: 'u' + n, credential: 'c' }] }) }; };
  const ice = createIceProvider({ env: { CF_TURN_KEY_ID: 'K', CF_TURN_API_TOKEN: 'T' }, fetchFn, now: () => clock, log: quiet });
  await ice.getIceServers(); await ice.getIceServers(); await ice.getIceServers();
  assert.equal(n, 1);
  // Gan het han (con duoi 2 gio) thi lay tai khoan moi
  clock += 23 * 60 * 60 * 1000;
  const r = await ice.getIceServers();
  assert.equal(n, 2);
  assert.equal(turnOnly(r)[0].username, 'u2');
});

test('Cloudflare loi: van tra STUN de voice chay duoc o mang de, va lan sau thu lai', async () => {
  let n = 0;
  const fetchFn = async () => { n++; return { ok: false, status: 401, json: async () => ({}) }; };
  const ice = createIceProvider({ env: { CF_TURN_KEY_ID: 'K', CF_TURN_API_TOKEN: 'sai' }, fetchFn, log: quiet });
  const r = await ice.getIceServers();
  assert.equal(r.relay, false);
  assert.deepEqual(r.iceServers, STUN_SERVERS);
  await ice.getIceServers();
  assert.equal(n, 2, 'khong duoc luu cache ket qua loi');
});

test('coturn: tai khoan tam thoi dung chuan TURN REST API', async () => {
  const nowMs = 1_700_000_000_000;
  const { username, credential } = coturnCredentials('bi-mat', nowMs);
  assert.equal(username, `${1_700_000_000 + 86400}:masoi`);
  assert.equal(credential, crypto.createHmac('sha1', 'bi-mat').update(username).digest('base64'));

  const ice = createIceProvider({ env: { TURN_URLS: 'turn:a.vn:3478, turns:a.vn:5349', TURN_SECRET: 'bi-mat' }, now: () => nowMs, log: quiet });
  const r = await ice.getIceServers();
  assert.equal(r.source, 'coturn');
  assert.deepEqual(turnOnly(r)[0].urls, ['turn:a.vn:3478', 'turns:a.vn:5349']);
  assert.equal(turnOnly(r)[0].username, username);
});

test('TURN co tai khoan co dinh', async () => {
  const ice = createIceProvider({ env: { TURN_URLS: 'turn:b.vn:3478', TURN_USERNAME: 'user', TURN_CREDENTIAL: 'pass' }, log: quiet });
  const r = await ice.getIceServers();
  assert.equal(r.source, 'static');
  assert.deepEqual(turnOnly(r)[0], { urls: ['turn:b.vn:3478'], username: 'user', credential: 'pass' });
});

test('Cloudflare duoc uu tien khi cau hinh nhieu loai cung luc', async () => {
  const ice = createIceProvider({ env: { CF_TURN_KEY_ID: 'K', CF_TURN_API_TOKEN: 'T', TURN_URLS: 'turn:x', TURN_SECRET: 's' }, log: quiet });
  assert.equal(ice.source(), 'cloudflare');
});
