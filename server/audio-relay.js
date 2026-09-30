// server/audio-relay.js
// Duong thoai du phong: khi hai nguoi khong noi thang duoc voi nhau (NAT doi xung, hay gap
// khi mot ben dung 4G/5G), tieng noi di vong qua chinh server nay - dung duong WebSocket
// ma game van dang dung de chat, nen mang nao vao duoc phong la nghe duoc nhau.
//
// Chi bat cho TUNG CAP nguoi bi hong, khong bat cho ca phong: ai noi thang duoc thi van
// noi thang, server khong ton bang thong cho ho.
//
// Goi tin do client tu dong goi (xem public/voice-relay.js):
//   [0]      loai ma hoa: 1 = Opus, 2 = mu-law
//   [1..2]   so thu tu goi (de ben nhan sap lai dung thu tu)
//   [3]      so khung trong goi
//   sau do moi khung: [2 byte do dai][du lieu]

const MAX_FRAME_BYTES = 4096;   // mot goi ~3 khung Opus 20ms chi khoang 180 byte
const MAX_FRAMES_PER_PACKET = 10;

const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

class AudioRelay {
  constructor() {
    this.pairs = new Map(); // roomCode -> Set<"a|b">
  }

  _room(roomCode) {
    let set = this.pairs.get(roomCode);
    if (!set) { set = new Set(); this.pairs.set(roomCode, set); }
    return set;
  }

  // Bat duong vong cho mot cap. Bat mot chieu la dung cho ca hai chieu:
  // hong ket noi thi bao gio cung hong ca hai phia.
  enable(roomCode, a, b) {
    if (a === b) return false;
    this._room(roomCode).add(pairKey(a, b));
    return true;
  }

  disable(roomCode, a, b) {
    const set = this.pairs.get(roomCode);
    if (!set) return;
    set.delete(pairKey(a, b));
    if (!set.size) this.pairs.delete(roomCode);
  }

  isOn(roomCode, a, b) {
    return !!this.pairs.get(roomCode)?.has(pairKey(a, b));
  }

  // Nhung nguoi dang can nghe qua duong vong voi nguoi nay
  partnersOf(roomCode, id) {
    const set = this.pairs.get(roomCode);
    if (!set) return [];
    const out = [];
    for (const key of set) {
      const [a, b] = key.split('|');
      if (a === id) out.push(b);
      else if (b === id) out.push(a);
    }
    return out;
  }

  // Nguoi roi phong / mat ket noi thi bo het cap cua ho
  clearPlayer(roomCode, id) {
    const set = this.pairs.get(roomCode);
    if (!set) return;
    for (const key of [...set]) {
      const [a, b] = key.split('|');
      if (a === id || b === id) set.delete(key);
    }
    if (!set.size) this.pairs.delete(roomCode);
  }

  clearRoom(roomCode) {
    this.pairs.delete(roomCode);
  }

  get size() {
    let n = 0;
    for (const set of this.pairs.values()) n += set.size;
    return n;
  }
}

// Goi tin hop le chua: dung dinh dang, khong qua lon, do dai cac khung khop nhau.
// Server khong giai ma tieng noi, chi kiem tra hinh dang goi roi chuyen tiep.
function validFramePacket(buf) {
  if (!(buf instanceof Uint8Array) && !Buffer.isBuffer(buf)) return false;
  if (buf.length < 4 || buf.length > MAX_FRAME_BYTES) return false;
  const codec = buf[0];
  if (codec !== 1 && codec !== 2) return false;
  const count = buf[3];
  if (count < 1 || count > MAX_FRAMES_PER_PACKET) return false;
  let at = 4;
  for (let i = 0; i < count; i++) {
    if (at + 2 > buf.length) return false;
    const len = (buf[at] << 8) | buf[at + 1];
    if (len < 1) return false;
    at += 2 + len;
    if (at > buf.length) return false;
  }
  return at === buf.length;
}

module.exports = { AudioRelay, validFramePacket, pairKey, MAX_FRAME_BYTES, MAX_FRAMES_PER_PACKET };
