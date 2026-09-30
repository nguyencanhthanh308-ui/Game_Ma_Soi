// public/voice-relay.js
// Duong thoai du phong khi khong noi thang duoc voi ai do (xem server/audio-relay.js).
// Tieng noi di vong qua server bang chinh duong WebSocket cua game.
//
// Toi uu de nghe cho do tre va do ton bang thong:
//   - Ma hoa Opus thanh tung khung 20ms (do duoc: ~57 byte/khung, ~23 kbps).
//     May cu khong co WebCodecs thi lui ve mu-law 8kHz (~64 kbps) - van nghe duoc.
//   - Gom 3 khung moi lan gui, de bot phan bao goi cua WebSocket.
//   - Chi gui khi dang noi. Im lang thi gan nhu khong ton gi.
//   - Chi gui LEN MOT BAN, server nhan ban cho nguoi khac. Quan trong voi may dung 4G
//     vi mang di dong tai len yeu hon tai xuong nhieu.

(() => {
  const SAMPLE_RATE = 16000;
  const FRAME_SAMPLES = 320;        // 20ms
  const FRAMES_PER_PACKET = 3;      // gui moi 60ms
  const CODEC_OPUS = 1;
  const CODEC_MULAW = 2;
  // Duoi nguong nay coi nhu im lang. Van gui them mot doan ngan sau khi ngung noi
  // de khong bi cut duoi cau.
  const SPEAK_THRESHOLD = 0.012;
  const TAIL_FRAMES = 12;           // ~240ms

  const r = {
    peers: new Set(),        // nhung nguoi dang phai nghe qua duong vong
    ctx: null,
    captureNode: null,
    source: null,
    encoder: null,
    codec: null,
    seq: 0,
    pending: [],
    tail: 0,
    starting: null,
    players: new Map(),      // playerId -> { decoder, node, codec }
    dem: { goiGui: 0, khungGui: 0, byteGui: 0, goiNhan: 0, khungNhan: 0, mauPhat: 0 },
    peerOpus: new Map(),     // peerId -> nguoi do co giai ma duoc Opus khong
  };

  const hasWebCodecs = () => typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined';
  // Chon ma hoa: chi dung Opus khi MINH ma hoa duoc va MOI nguoi nghe deu giai ma duoc.
  // Chi can mot nguoi dung may cu la ca nhom phai lui ve mu-law, khong thi ho khong nghe thay gi.
  function codecMuonDung() {
    if (!hasWebCodecs()) return CODEC_MULAW;
    for (const id of r.peers) if (r.peerOpus.get(id) === false) return CODEC_MULAW;
    return CODEC_OPUS;
  }

  // ---------- mu-law: duong lui cho may khong co WebCodecs ----------
  function encodeMulaw(samples) {
    const out = new Uint8Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      let s = Math.max(-1, Math.min(1, samples[i])) * 32767;
      const sign = s < 0 ? 0x80 : 0;
      if (s < 0) s = -s;
      s = Math.min(s + 132, 32767);
      let exp = 7;
      for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
      const mantissa = (s >> (exp + 3)) & 0x0f;
      out[i] = ~(sign | (exp << 4) | mantissa) & 0xff;
    }
    return out;
  }
  function decodeMulaw(bytes) {
    const out = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      const u = ~bytes[i] & 0xff;
      const sign = u & 0x80;
      const exp = (u >> 4) & 0x07;
      const mantissa = u & 0x0f;
      let s = ((mantissa << 3) + 132) << exp;
      s -= 132;
      out[i] = (sign ? -s : s) / 32768;
    }
    return out;
  }

  // ---------- Dong goi ----------
  function buildPacket(codec, seq, frames) {
    const total = 4 + frames.reduce((a, f) => a + 2 + f.length, 0);
    const buf = new Uint8Array(total);
    buf[0] = codec; buf[1] = (seq >> 8) & 255; buf[2] = seq & 255; buf[3] = frames.length;
    let at = 4;
    for (const f of frames) {
      buf[at] = (f.length >> 8) & 255; buf[at + 1] = f.length & 255;
      buf.set(f, at + 2); at += 2 + f.length;
    }
    return buf;
  }
  function parsePacket(buf) {
    const data = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
    if (data.length < 4) return null;
    const frames = [];
    let at = 4;
    for (let i = 0; i < data[3]; i++) {
      const len = (data[at] << 8) | data[at + 1];
      at += 2;
      if (at + len > data.length) return null;
      frames.push(data.subarray(at, at + len));
      at += len;
    }
    return { codec: data[0], seq: (data[1] << 8) | data[2], frames };
  }

  // ---------- Thu tieng va gui ----------
  async function ensureContext() {
    if (r.ctx) return r.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Trình duyệt không hỗ trợ xử lý âm thanh.');
    // Xin dung 16kHz de khoi phai tu ha tan so; trinh duyet nao khong chieu thi dung mac dinh
    let ctx;
    try { ctx = new AC({ sampleRate: SAMPLE_RATE }); } catch (e) { ctx = new AC(); }
    await ctx.audioWorklet.addModule('voice-worklet.js');
    r.ctx = ctx;
    return ctx;
  }

  function flushPacket() {
    if (!r.pending.length) return;
    const packet = buildPacket(r.codec, r.seq++ & 0xffff, r.pending);
    r.dem.goiGui++; r.dem.khungGui += r.pending.length; r.dem.byteGui += packet.length;
    r.pending = [];
    if (socket.connected) socket.emit('voice_frame', packet);
  }

  function onCapturedFrame(samples) {
    // Chi gui khi dang noi: im lang thi gan nhu khong ton bang thong
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const loud = Math.sqrt(sum / samples.length) > SPEAK_THRESHOLD;
    if (loud) r.tail = TAIL_FRAMES;
    else if (r.tail > 0) r.tail--;
    else { r.pending = []; return; }

    if (r.codec === CODEC_MULAW) {
      r.pending.push(encodeMulaw(samples));
      if (r.pending.length >= FRAMES_PER_PACKET) flushPacket();
      return;
    }
    if (!r.encoder || r.encoder.state !== 'configured') return;
    const rate = r.ctx.sampleRate;
    r.encoder.encode(new AudioData({
      format: 'f32-planar', sampleRate: rate, numberOfFrames: samples.length,
      numberOfChannels: 1, timestamp: (r.seq * FRAMES_PER_PACKET + r.pending.length) * 20000, data: samples,
    }));
  }

  async function startCapture() {
    if (r.captureNode || r.starting) return r.starting;
    r.starting = (async () => {
      const stream = window.gameVoice?.micStream?.();
      if (!stream) return;
      const ctx = await ensureContext();
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      const frameSize = Math.round(ctx.sampleRate * 0.02);

      if (codecMuonDung() === CODEC_OPUS) {
        r.codec = CODEC_OPUS;
        r.encoder = new AudioEncoder({
          output: (chunk) => {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            r.pending.push(bytes);
            if (r.pending.length >= FRAMES_PER_PACKET) flushPacket();
          },
          error: () => { r.codec = CODEC_MULAW; r.encoder = null; },
        });
        try {
          r.encoder.configure({ codec: 'opus', sampleRate: ctx.sampleRate, numberOfChannels: 1, bitrate: 24000 });
        } catch (e) { r.codec = CODEC_MULAW; r.encoder = null; }
      } else {
        r.codec = CODEC_MULAW;
      }

      r.source = ctx.createMediaStreamSource(stream);
      r.captureNode = new AudioWorkletNode(ctx, 'voice-capture', { processorOptions: { frameSize } });
      r.captureNode.port.onmessage = (e) => onCapturedFrame(e.data);
      r.source.connect(r.captureNode);
      // Noi toi dich voi am luong 0: mot so trinh duyet khong chay worklet neu no khong noi ra dau
      const mute = ctx.createGain();
      mute.gain.value = 0;
      r.captureNode.connect(mute).connect(ctx.destination);
    })().catch(() => {}).finally(() => { r.starting = null; });
    return r.starting;
  }

  function stopCapture() {
    try { r.source?.disconnect(); r.captureNode?.disconnect(); } catch (e) {}
    try { if (r.encoder?.state === 'configured') r.encoder.close(); } catch (e) {}
    r.source = null; r.captureNode = null; r.encoder = null; r.pending = [];
  }

  // ---------- Nhan va phat ----------
  async function playerFor(id, codec) {
    let p = r.players.get(id);
    if (p) return p;
    const ctx = await ensureContext();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const node = new AudioWorkletNode(ctx, 'voice-playback', {
      processorOptions: { minStart: Math.round(ctx.sampleRate * 0.08), maxQueued: Math.round(ctx.sampleRate * 0.5) },
    });
    node.connect(ctx.destination);
    p = { node, decoder: null, codec };
    if (codec === CODEC_OPUS && hasWebCodecs()) {
      p.decoder = new AudioDecoder({
        output: (audio) => {
          const buf = new Float32Array(audio.numberOfFrames);
          try { audio.copyTo(buf, { planeIndex: 0, format: 'f32-planar' }); } catch (e) {}
          audio.close();
          r.dem.mauPhat += buf.length;
          node.port.postMessage(buf);
        },
        error: () => {},
      });
      try { p.decoder.configure({ codec: 'opus', sampleRate: ctx.sampleRate, numberOfChannels: 1 }); }
      catch (e) { p.decoder = null; }
    }
    r.players.set(id, p);
    return p;
  }

  function dropPlayer(id) {
    const p = r.players.get(id);
    if (!p) return;
    try { p.decoder?.state === 'configured' && p.decoder.close(); } catch (e) {}
    try { p.node.port.postMessage('reset'); p.node.disconnect(); } catch (e) {}
    r.players.delete(id);
  }

  socket.on('voice_frame', async ({ from, buf }) => {
    if (!r.peers.has(from)) return; // chi nghe nguoi minh that su dang can duong vong
    const packet = parsePacket(buf);
    if (!packet) return;
    r.dem.goiNhan++; r.dem.khungNhan += packet.frames.length;
    const p = await playerFor(from, packet.codec);
    if (packet.codec === CODEC_MULAW) {
      for (const f of packet.frames) { const pcm = decodeMulaw(f); r.dem.mauPhat += pcm.length; p.node.port.postMessage(pcm); }
      return;
    }
    if (!p.decoder || p.decoder.state !== 'configured') return;
    for (const f of packet.frames) {
      try {
        p.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: performance.now() * 1000, data: f }));
      } catch (e) { /* goi hong - bo qua, khung sau van phat duoc */ }
    }
  });

  // ---------- Bat / tat cho tung nguoi ----------
  // Doi ma hoa giua chung thi phai dung thu lai tu dau (encoder da chot cau hinh)
  async function apDungCodec() {
    const muon = codecMuonDung();
    if (!r.captureNode || muon === r.codec) return;
    stopCapture();
    await startCapture();
  }

  function setPeer(peerId, on) {
    if (on === r.peers.has(peerId)) return;
    if (on) r.peers.add(peerId); else { r.peers.delete(peerId); dropPlayer(peerId); r.peerOpus.delete(peerId); }
    socket.emit('relay_set', { peerId, on, opus: hasWebCodecs() }, () => {});
    if (r.peers.size) startCapture().then(apDungCodec); else stopCapture();
  }

  // Nguoi kia bao ho co giai ma duoc Opus khong
  socket.on('relay_peer', ({ peerId, on, opus }) => {
    if (on) r.peerOpus.set(peerId, !!opus); else r.peerOpus.delete(peerId);
    apDungCodec();
  });

  function reset() {
    for (const id of [...r.peers]) { r.peers.delete(id); dropPlayer(id); }
    r.peerOpus.clear();
    stopCapture();
  }

  socket.on('disconnect', reset);

  window.voiceRelay = {
    setPeer,
    reset,
    active: () => [...r.peers],
    // Thong tin chan doan cho nguoi dung bam F12 xem
    info: () => ({
      dangDiVong: [...r.peers],
      maHoa: r.codec === CODEC_OPUS ? 'opus' : r.codec === CODEC_MULAW ? 'mu-law' : 'chua bat',
      nguoiNgheGiaiMaOpus: Object.fromEntries(r.peerOpus),
      dangThuTieng: !!r.captureNode,
      tanSo: r.ctx?.sampleRate || null,
      dem: { ...r.dem },
    }),
  };
})();
