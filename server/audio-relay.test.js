const test = require('node:test');
const assert = require('node:assert/strict');
const { AudioRelay, validFramePacket, MAX_FRAME_BYTES } = require('./audio-relay');
const { canHear } = require('./voice');

// ---------- Quan ly cap ----------

test('bat duong vong cho mot cap la dung cho ca hai chieu', () => {
  const r = new AudioRelay();
  r.enable('P1', 'an', 'binh');
  assert.equal(r.isOn('P1', 'an', 'binh'), true);
  assert.equal(r.isOn('P1', 'binh', 'an'), true, 'hong ket noi thi hong ca hai phia');
  assert.deepEqual(r.partnersOf('P1', 'an'), ['binh']);
  assert.deepEqual(r.partnersOf('P1', 'binh'), ['an']);
});

test('tat duong vong thi khong con chuyen tiep', () => {
  const r = new AudioRelay();
  r.enable('P1', 'an', 'binh');
  r.disable('P1', 'binh', 'an');
  assert.equal(r.isOn('P1', 'an', 'binh'), false);
  assert.deepEqual(r.partnersOf('P1', 'an'), []);
});

test('chi bat cho dung cap bi hong, khong anh huong nguoi khac', () => {
  const r = new AudioRelay();
  r.enable('P1', 'an', 'binh');
  assert.deepEqual(r.partnersOf('P1', 'chi'), [], 'nguoi noi thang duoc thi khong ton bang thong');
});

test('cap o phong nay khong dinh sang phong khac', () => {
  const r = new AudioRelay();
  r.enable('P1', 'an', 'binh');
  assert.equal(r.isOn('P2', 'an', 'binh'), false);
});

test('nguoi roi phong thi bo het cap cua ho', () => {
  const r = new AudioRelay();
  r.enable('P1', 'an', 'binh');
  r.enable('P1', 'an', 'chi');
  r.enable('P1', 'binh', 'chi');
  r.clearPlayer('P1', 'an');
  assert.deepEqual(r.partnersOf('P1', 'an'), []);
  assert.deepEqual(r.partnersOf('P1', 'binh'), ['chi'], 'cap cua nguoi khac phai con nguyen');
});

test('don phong thi khong con gi sot lai trong bo nho', () => {
  const r = new AudioRelay();
  r.enable('P1', 'an', 'binh');
  r.enable('P2', 'x', 'y');
  r.clearRoom('P1');
  assert.equal(r.size, 1);
  r.disable('P2', 'x', 'y');
  assert.equal(r.size, 0);
  assert.equal(r.pairs.size, 0, 'khong de lai phong rong trong bo nho');
});

test('khong tu bat duong vong voi chinh minh', () => {
  const r = new AudioRelay();
  assert.equal(r.enable('P1', 'an', 'an'), false);
  assert.deepEqual(r.partnersOf('P1', 'an'), []);
});

// ---------- Kiem tra goi tin ----------

function packet(codec, seq, frames) {
  const total = 4 + frames.reduce((a, f) => a + 2 + f.length, 0);
  const buf = new Uint8Array(total);
  buf[0] = codec; buf[1] = seq >> 8; buf[2] = seq & 255; buf[3] = frames.length;
  let at = 4;
  for (const f of frames) { buf[at] = f.length >> 8; buf[at + 1] = f.length & 255; buf.set(f, at + 2); at += 2 + f.length; }
  return buf;
}
const frame = (n) => new Uint8Array(n).fill(7);

test('goi dung dinh dang thi duoc chap nhan', () => {
  assert.equal(validFramePacket(packet(1, 0, [frame(57)])), true);
  assert.equal(validFramePacket(packet(1, 65535, [frame(57), frame(60), frame(55)])), true);
  assert.equal(validFramePacket(packet(2, 5, [frame(160)])), true, 'mu-law cho may cu');
});

test('tu choi goi hong, goi qua lon hoac do dai khong khop', () => {
  assert.equal(validFramePacket(new Uint8Array(0)), false);
  assert.equal(validFramePacket(new Uint8Array([1, 0, 0])), false, 'thieu phan than');
  assert.equal(validFramePacket(packet(9, 0, [frame(10)])), false, 'loai ma hoa la');
  assert.equal(validFramePacket(new Uint8Array(MAX_FRAME_BYTES + 1)), false, 'qua lon');
  assert.equal(validFramePacket('khong phai nhi phan'), false);
  assert.equal(validFramePacket(null), false);

  const thua = packet(1, 0, [frame(10)]);
  assert.equal(validFramePacket(new Uint8Array([...thua, 0, 0])), false, 'thua byte o cuoi');

  const noiDoi = packet(1, 0, [frame(10)]);
  noiDoi[4] = 0xff; // khai do dai khung lon hon du lieu that
  assert.equal(validFramePacket(noiDoi), false, 'khai do dai lon hon thuc te');

  const khongKhung = packet(1, 0, [frame(10)]);
  khongKhung[3] = 0;
  assert.equal(validFramePacket(khongKhung), false, 'khong co khung nao');
});

// ---------- Luat choi van phai duoc ton trong ----------

function fakeGame(phase, players) {
  const map = new Map(players.map((p, i) => [String(i), { id: String(i), socketId: 's' + i, connected: true, ...p }]));
  return { phase, roomCode: 'P1', players: map, get: (name) => [...map.values()].find((p) => p.name === name) };
}

// Ai thuc su nhan duoc tieng, theo dung cach server/index.js quyet dinh
function nguoiNhan(relay, game, sender) {
  return relay.partnersOf(game.roomCode, sender.id)
    .map((id) => game.players.get(id))
    .filter((p) => p?.connected && canHear(game, p, sender))
    .map((p) => p.name);
}

test('ban dem Dan lang KHONG nghe duoc Soi du da bat duong vong', () => {
  const g = fakeGame('NIGHT_WOLVES', [
    { name: 'Soi', alive: true, role: 'werewolf' },
    { name: 'Dan', alive: true, role: 'villager' },
  ]);
  const r = new AudioRelay();
  r.enable('P1', g.get('Soi').id, g.get('Dan').id);
  assert.deepEqual(nguoiNhan(r, g, g.get('Soi')), [], 'bat duong vong cung khong duoc pha luat');
});

test('nguoi con song KHONG nghe duoc Am phu du da bat duong vong', () => {
  const g = fakeGame('DAY_DISCUSSION', [
    { name: 'Ma', alive: false, role: 'seer' },
    { name: 'Song', alive: true, role: 'villager' },
  ]);
  const r = new AudioRelay();
  r.enable('P1', g.get('Ma').id, g.get('Song').id);
  assert.deepEqual(nguoiNhan(r, g, g.get('Ma')), [], 'nguoi da mat noi thi nguoi song khong duoc nghe');
  assert.deepEqual(nguoiNhan(r, g, g.get('Song')), ['Ma'], 'nguoc lai thi nguoi da mat van nghe duoc');
});

test('ban ngay hai nguoi con song nghe duoc nhau qua duong vong', () => {
  const g = fakeGame('DAY_DISCUSSION', [
    { name: 'An', alive: true, role: 'villager' },
    { name: 'Binh', alive: true, role: 'werewolf' },
  ]);
  const r = new AudioRelay();
  r.enable('P1', g.get('An').id, g.get('Binh').id);
  assert.deepEqual(nguoiNhan(r, g, g.get('An')), ['Binh']);
  assert.deepEqual(nguoiNhan(r, g, g.get('Binh')), ['An']);
});

test('nguoi mat ket noi thi khong nhan goi', () => {
  const g = fakeGame('DAY_DISCUSSION', [
    { name: 'An', alive: true, role: 'villager' },
    { name: 'Roi', alive: true, role: 'villager', connected: false },
  ]);
  const r = new AudioRelay();
  r.enable('P1', g.get('An').id, g.get('Roi').id);
  assert.deepEqual(nguoiNhan(r, g, g.get('An')), []);
});
