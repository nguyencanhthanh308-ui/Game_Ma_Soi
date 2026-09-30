const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Mo server that va noi bang socket.io thuan (khong can thu vien client)
async function startServer(t) {
  const child = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', 'server/index.js'],
    { env: { ...process.env, PORT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { const m = String(chunk).match(/localhost:(\d+)/); if (m) resolve(Number(m[1])); });
    child.on('error', reject);
    child.on('exit', (code) => reject(Error('Server exit ' + code)));
  });
  const clients = [];
  t.after(() => clients.forEach((c) => c.ws.close()));
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    const c = { ws, events: [], acks: new Map(), seq: 0 };
    clients.push(c);
    await new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', (raw) => {
        const msg = String(raw);
        if (msg.startsWith('0{')) ws.send('40');
        else if (msg === '2') ws.send('3');
        else if (msg.startsWith('40')) resolve();
        else if (msg.startsWith('42')) c.events.push(JSON.parse(msg.slice(2)));
        else if (msg.startsWith('43')) { const m = msg.match(/^43(\d+)(.*)$/); c.acks.get(Number(m[1]))?.(JSON.parse(m[2])[0]); }
      });
    });
    c.emit = (name, data) => new Promise((resolve) => { const id = c.seq++; c.acks.set(id, resolve); ws.send('42' + id + JSON.stringify([name, data])); });
    return c;
  }
  const last = (c, name) => c.events.filter((e) => e[0] === name).at(-1)?.[1];
  return { connect, last };
}

test('chu phong moi nguoi khac roi phong o sanh cho', { timeout: 20000 }, async (t) => {
  const { connect, last } = await startServer(t);
  const host = await connect();
  const room = await host.emit('create_room', { name: 'Host' });
  const guest = await connect();
  const joined = await guest.emit('join_room', { roomCode: room.roomCode, name: 'Guest' });
  await pause(150);
  assert.equal(last(host, 'game_state').players.length, 2);

  const result = await host.emit('kick_player', { playerId: joined.playerId });
  assert.equal(result.ok, true);
  await pause(200);

  assert.deepEqual(last(host, 'game_state').players.map((p) => p.name), ['Host'], 'nguoi bi moi phai bien khoi danh sach');
  assert.ok(last(guest, 'kicked'), 'nguoi bi moi phai duoc bao');
});

test('nguoi thuong khong duoc moi ai roi phong', { timeout: 20000 }, async (t) => {
  const { connect, last } = await startServer(t);
  const host = await connect();
  const room = await host.emit('create_room', { name: 'Host' });
  const a = await connect();
  await a.emit('join_room', { roomCode: room.roomCode, name: 'A' });
  const b = await connect();
  const bJoined = await b.emit('join_room', { roomCode: room.roomCode, name: 'B' });
  await pause(150);

  const result = await a.emit('kick_player', { playerId: bJoined.playerId });
  assert.equal(result.ok, false);
  assert.match(result.error, /Chỉ chủ phòng/);
  await pause(150);
  assert.equal(last(host, 'game_state').players.length, 3, 'khong ai bi moi ra');
});

test('chu phong khong tu moi minh roi phong, va khong moi nguoi khong ton tai', { timeout: 20000 }, async (t) => {
  const { connect } = await startServer(t);
  const host = await connect();
  const room = await host.emit('create_room', { name: 'Host' });
  const guest = await connect();
  await guest.emit('join_room', { roomCode: room.roomCode, name: 'Guest' });
  await pause(150);

  const self = await host.emit('kick_player', { playerId: room.playerId });
  assert.equal(self.ok, false);
  const ghost = await host.emit('kick_player', { playerId: 'khong-co-that' });
  assert.equal(ghost.ok, false);
});

test('dang trong van thi khong moi ai roi phong duoc (tranh lech so vai da chia)', { timeout: 20000 }, async (t) => {
  const { connect, last } = await startServer(t);
  const host = await connect();
  const room = await host.emit('create_room', { name: 'Host' });
  const ids = [];
  for (const name of ['A', 'B']) {
    const c = await connect();
    ids.push((await c.emit('join_room', { roomCode: room.roomCode, name })).playerId);
  }
  await pause(150);
  const cfg = { werewolf: 1, villager: 2 };
  assert.ok((await host.emit('set_role_config', cfg)).ok);
  assert.ok((await host.emit('start_game', { roleConfig: cfg })).ok);
  await pause(250);
  assert.notEqual(last(host, 'game_state').phase, 'LOBBY');

  const result = await host.emit('kick_player', { playerId: ids[0] });
  assert.equal(result.ok, false);
  assert.match(result.error, /sảnh chờ|kết thúc/);
  await pause(150);
  assert.equal(last(host, 'game_state').players.length, 3, 'van con du nguoi');
});
