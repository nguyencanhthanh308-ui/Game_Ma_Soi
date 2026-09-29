const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

test('voice channel assignment and signal relay isolation work end-to-end over real sockets', { timeout: 15000 }, async t => {
  const child = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', 'server/index.js'], { env: { ...process.env, PORT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { const m = String(chunk).match(/localhost:(\d+)/); if (m) resolve(Number(m[1])); });
    child.on('error', reject); child.on('exit', code => reject(Error('Server exit ' + code)));
  });

  const clients = [];
  t.after(() => clients.forEach(c => c.ws.close()));
  async function connect() {
    const ws = new WebSocket(`ws://localhost:${port}/socket.io/?EIO=4&transport=websocket`);
    const c = { ws, events: [], acks: new Map(), seq: 0 }; clients.push(c);
    await new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', raw => {
        const msg = String(raw);
        if (msg.startsWith('0')) ws.send('40');
        else if (msg === '2') ws.send('3');
        else if (msg.startsWith('40')) resolve();
        else if (msg.startsWith('42')) c.events.push(JSON.parse(msg.slice(2)));
        else if (msg.startsWith('43')) { const m = msg.match(/^43(\d+)(.*)$/); c.acks.get(Number(m[1]))?.(JSON.parse(m[2])[0]); }
      });
    });
    c.emit = (name, data) => new Promise(resolve => { const id = c.seq++; c.acks.set(id, resolve); ws.send('42' + id + JSON.stringify([name, data])); });
    // voice_signal la su kien "ban va quen" (khong co callback) giong nhu client that su dung - khong gui kem ack id
    c.emitNoAck = (name, data) => ws.send('42' + JSON.stringify([name, data]));
    return c;
  }
  function latestPrivate(c) { return c.events.filter(e => e[0] === 'private_state').at(-1)[1]; }
  function voiceSignalsReceived(c) { return c.events.filter(e => e[0] === 'voice_signal'); }

  // --- Thiet lap phong 8 nguoi: 2 Soi thuong, 6 Dan lang ---
  const host = await connect();
  const room = await host.emit('create_room', { name: 'Host' });
  host.playerId = room.playerId;
  const others = [];
  for (let i = 1; i < 8; i++) {
    const c = await connect();
    const res = await c.emit('join_room', { roomCode: room.roomCode, name: 'P' + i });
    assert.ok(res.ok);
    c.playerId = res.playerId;
    others.push(c);
  }
  const allClients = [host, ...others];
  const roleConfig = { villager: 6, werewolf: 2, wolfcub: 0, whitewolf: 0, seer: 0, guard: 0, witch: 0, hunter: 0, cupid: 0, lycan: 0, cursed: 0, elder: 0, toughguy: 0, prince: 0, tanner: 0, mason: 0 };
  const started = await host.emit('start_game', { roleConfig, durations: { NIGHT_CUPID: 1, NIGHT_GUARD: 1, NIGHT_WOLVES: 60, NIGHT_WHITEWOLF: 1, NIGHT_SEER: 1, NIGHT_WITCH: 1 } });
  assert.ok(started.ok, JSON.stringify(started));

  // Cho troi qua Cupid(1s)+Guard(1s) de vao dung pha NIGHT_WOLVES
  await new Promise(resolve => setTimeout(resolve, 1300));

  const wolves = allClients.filter(c => latestPrivate(c).role.id === 'werewolf');
  const villagers = allClients.filter(c => latestPrivate(c).role.id === 'villager');
  assert.equal(wolves.length, 2, 'Phai co dung 2 Soi');
  assert.equal(villagers.length, 6, 'Phai co dung 6 Dan lang');

  // --- Kiem tra kenh voice duoc gan dung: Soi -> 'wolves', Dan lang -> null (im lang ban dem) ---
  for (const w of wolves) assert.equal(latestPrivate(w).voiceChannel, 'wolves');
  for (const v of villagers) assert.equal(latestPrivate(v).voiceChannel, null);

  // --- Soi A gui tin hieu WebRTC toi Soi B (cung kenh) -> phai duoc relay ---
  const [wolfA, wolfB] = wolves;
  const wolfBRoster = latestPrivate(wolfB).voicePeers;
  assert.deepEqual(wolfBRoster.map(p => p.playerId).sort(), [wolfA.playerId].sort(), 'wolfB phai thay dung wolfA trong roster');

  await wolfA.emitNoAck('voice_signal', { toPlayerId: wolfB.playerId, data: { type: 'candidate', candidate: { fake: true } } });
  await new Promise(resolve => setTimeout(resolve, 200));
  const received = voiceSignalsReceived(wolfB);
  assert.equal(received.length, 1, 'wolfB phai nhan duoc dung 1 tin hieu tu wolfA');
  assert.equal(received[0][1].fromPlayerId, wolfA.playerId);
  assert.deepEqual(received[0][1].data, { type: 'candidate', candidate: { fake: true } });

  // --- Dan lang co gang gui tin hieu den mot Soi that (khac kenh voice) -> server PHAI TU CHOI khong relay ---
  const villagerX = villagers[0];
  const beforeCount = voiceSignalsReceived(wolfA).length;
  await villagerX.emitNoAck('voice_signal', { toPlayerId: wolfA.playerId, data: { type: 'offer', sdp: 'fake-should-be-blocked' } });
  await new Promise(resolve => setTimeout(resolve, 200));
  const afterCount = voiceSignalsReceived(wolfA).length;
  assert.equal(afterCount, beforeCount, 'Tin hieu tu nguoi khac kenh voice (Dan lang -> Soi luc dem) khong duoc relay');

  console.log('OK: voice channel assignment + signaling isolation verified end-to-end');
});
