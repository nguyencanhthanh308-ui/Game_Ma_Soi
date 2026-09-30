// public/voice.js
// Voice chat thoi gian thuc bang WebRTC (ket noi truc tiep giua cac trinh duyet).
// Server chi lam nhiem vu "buu ta" chuyen tiep tin hieu offer/answer/ICE candidate (xem server/index.js),
// khong xu ly hay luu am thanh. Kenh (village/wolves/dead) do server tinh toan va gui qua private_state.

(() => {
  const panel = $('room-voice');
  const channelLabel = $('voice-channel-label');
  const micBtn = $('btn-toggle-mic');
  const hint = $('voice-hint');
  const peerListEl = $('voice-peer-list');

  // Nhieu may chu STUN de con duong du phong khi mot may khong tra loi.
  // Luu y: chi co STUN thi mot so mang (NAT doi xung, wifi cong ty) van khong noi duoc
  // truc tiep voi nhau - truong hop do can them may chu TURN.
  const RTC_CONFIG = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    iceCandidatePoolSize: 4,
  };
  const RETRY_DELAY_MS = 2500;
  const CHANNEL_LABEL = {
    village: '🏘️ Kênh: Làng (ai còn sống cũng nghe được)',
    wolves: '🐺 Kênh: Bầy Sói (riêng tư, chỉ Sói còn sống)',
    dead: '👻 Kênh: Âm phủ (bạn nghe được cả làng)',
  };
  const CHANNEL_HINT = {
    village: 'Mọi người còn sống đều nghe và nói được ở đây.',
    wolves: 'Chỉ bầy Sói còn sống nghe được nhau lúc này.',
    dead: 'Bạn đã mất: nói chuyện thoải mái trong Âm phủ, và vẫn nghe được người còn sống. Họ không nghe được bạn.',
    null: 'Hiện không có kênh thoại nào đang mở (đang là lượt riêng của một vai trò khác).',
  };

  const camBtn = $('btn-toggle-cam');
  const videoGrid = $('video-grid');

  const v = {
    micOn: false,
    camOn: false,
    localStream: null,     // luong micro
    camStream: null,       // luong camera
    peers: new Map(),      // playerId -> RTCPeerConnection
    audioEls: new Map(),   // playerId -> <audio>
    videoEls: new Map(),   // playerId -> <video>
    channel: null,
    roster: [],
    senders: new Map(),      // playerId -> sender am thanh
    videoSenders: new Map(), // playerId -> sender hinh anh
    ice: new Map(),
    chains: new Map(),
    busy: false,
    epoch: 0,
  };
  // Huong ket noi cho tung kieu peer. Nguoi da mat chi nghe (recvonly), nguoi con song
  // bi nguoi da mat nghe thi chi gui (sendonly).
  const DIRECTION = { both: 'sendrecv', listen: 'recvonly', broadcast: 'sendonly' };
  const modeOf = (peerId) => v.roster.find((p) => p.playerId === peerId)?.mode || 'both';
  const sends = (peerId) => DIRECTION[modeOf(peerId)] !== 'recvonly';
  const listenBtn=document.createElement('button');
  // Chi hien khi trinh duyet that su chan tieng (chinh sach tu dong phat).
  // Phan lon truong hop khong can, va de san thi no chiem han mot hang trong khung thoai.
  listenBtn.className='btn-secondary small listen-btn hidden';
  listenBtn.textContent='🔊 Bấm để nghe mọi người';
  (camBtn.parentNode||micBtn).after(listenBtn);
  function playRemote(audio) {
    audio.play().then(()=>{
      listenBtn.classList.add('hidden');
    }).catch(()=>{
      listenBtn.classList.remove('hidden');
      hint.textContent='Trình duyệt đang chặn tiếng. Bấm "Bấm để nghe mọi người" một lần là nghe được.';
    });
  }
  function unlockRemote() { v.audioEls.forEach(playRemote);sharedAudioContext?.resume().catch(()=>{}); }
  listenBtn.addEventListener('click',unlockRemote);
  document.addEventListener('pointerdown',unlockRemote);
  document.addEventListener('keydown',unlockRemote);

  // Du phong cho :has() (Safari/Firefox cu chua ho tro): tu bat/tat class khi ca hai khung deu an
  function syncSideEmpty() {
    const side = $('room-side');
    if (!side) return;
    const anyVisible = [...side.children].some((el) => !el.classList.contains('hidden'));
    side.classList.toggle('side-empty', !anyVisible);
  }

  function mount(id) {
    const active = id || document.querySelector('.screen.active')?.id;
    const visible = state.roomCode && ['screen-lobby', 'screen-game', 'screen-over'].includes(active);
    panel.classList.toggle('hidden', !visible);
    if (visible) {
      const target = document.querySelector(`#${active}`);
      // Khung voice va khung chat nam chung mot cot, nen di chuyen ca cot.
      const side = $('room-side');
      if (side.parentNode !== target) target.appendChild(side);
    }
    syncSideEmpty();
  }

  // ---------- Luoi camera ----------
  function videoTile(id, label) {
    let tile = document.getElementById('video-tile-' + id);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile';
      tile.id = 'video-tile-' + id;
      const el = document.createElement('video');
      el.autoplay = true; el.playsInline = true; el.muted = true; // tieng di theo the <audio> rieng
      const name = document.createElement('span');
      name.className = 'video-name';
      name.textContent = label;
      tile.append(el, name);
      videoGrid.appendChild(tile);
    }
    tile.querySelector('.video-name').textContent = label;
    return tile.querySelector('video');
  }
  // Ban ngay ca lang nhin mat nhau ma noi chuyen, nen luoi cam duoc dua ra giua man hinh,
  // dung cho khung tranh ngoi lang (von chi de trang tri) thay vi de o cot ben phai.
  // Cac pha khac thi tra lai cot ben phai de khong choan cho.
  const STAGE_PHASES = ['DAY_DISCUSSION', 'DAY_VOTE', 'DAY_DEFENSE', 'DAY_JUDGEMENT', 'DAY_ANNOUNCE'];
  function placeVideoGrid() {
    const stage = $('video-stage');
    const hasVideo = videoGrid.childElementCount > 0;
    const phase = state.lastGameState?.phase;
    const onStage = hasVideo && stage && STAGE_PHASES.includes(phase)
      && document.querySelector('.screen.active')?.id === 'screen-game';

    if (onStage && videoGrid.parentNode !== stage) stage.appendChild(videoGrid);
    else if (!onStage && videoGrid.parentNode !== panel) {
      // Tra ve dung cho cu trong khung thoai: ngay sau doan goi y
      panel.insertBefore(videoGrid, $('voice-peer-list'));
    }
    stage?.classList.toggle('hidden', !onStage);
    videoGrid.classList.toggle('on-stage', onStage);
    panel.classList.toggle('has-video', videoGrid.childElementCount > 0 && !onStage);
    // Khung tranh ngoi lang nhuong cho cho luoi cam
    document.querySelector('.game-village')?.classList.toggle('hidden', onStage);
    sizeStageGrid();
  }

  // Chon so cot sao cho moi o to nhat co the trong khung cho san (cach lam quen thuoc
  // cua cac ung dung hop truc tuyen). O giu ty le 4:3.
  function sizeStageGrid() {
    if (!videoGrid.classList.contains('on-stage')) {
      videoGrid.style.removeProperty('--cols');
      videoGrid.style.removeProperty('--tile-w');
      return;
    }
    const n = videoGrid.childElementCount;
    if (!n) return;
    const gap = 10;
    const width = videoGrid.clientWidth - 24; // tru padding hai ben
    const height = Math.min(innerHeight * 0.46, 380) - 24;
    if (width <= 0 || height <= 0) return;
    let bestCols = 1;
    let bestArea = 0;
    let bestWidth = width;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const tileW = (width - gap * (cols - 1)) / cols;
      const tileH = (height - gap * (rows - 1)) / rows;
      if (tileW <= 0 || tileH <= 0) continue;
      // O giu ty le 4:3 nen canh nao be hon se quyet dinh kich thuoc that
      const w = Math.min(tileW, tileH * 4 / 3);
      const area = w * (w * 3 / 4);
      if (area > bestArea) { bestArea = area; bestCols = cols; bestWidth = w; }
    }
    videoGrid.style.setProperty('--cols', bestCols);
    // Dat be ngang o cu the de hang cuoi (neu thieu o) van duoc can giua
    videoGrid.style.setProperty('--tile-w', Math.floor(bestWidth) + 'px');
  }
  addEventListener('resize', sizeStageGrid);

  function syncGridVisibility() {
    const hasVideo = videoGrid.childElementCount > 0;
    videoGrid.classList.toggle('hidden', !hasVideo);
    placeVideoGrid();
    // Chi danh dau khung thoai la "cao hon binh thuong" khi luoi cam THUC SU nam trong no.
    // Luoi da chuyen ra giua man hinh ma van danh dau thi khung thoai bi co lai va cat mat chu.
    panel.classList.toggle('has-video', hasVideo && videoGrid.parentNode === panel);
    sizeStageGrid();
  }
  function attachRemoteVideo(peerId, stream) {
    const name = v.roster.find((p) => p.playerId === peerId)?.name || 'Người chơi';
    const el = videoTile(peerId, name);
    el.srcObject = stream;
    el.play().catch(() => {});
    v.videoEls.set(peerId, el);
    syncGridVisibility();
  }
  function removeRemoteVideo(peerId) {
    const el = v.videoEls.get(peerId);
    if (el) el.srcObject = null;
    v.videoEls.delete(peerId);
    document.getElementById('video-tile-' + peerId)?.remove();
    syncGridVisibility();
  }
  function syncLocalVideo() {
    if (v.camStream) {
      const el = videoTile('me', 'Bạn');
      el.srcObject = v.camStream;
      el.play().catch(() => {});
      document.getElementById('video-tile-me')?.classList.add('mine');
    } else {
      document.getElementById('video-tile-me')?.remove();
    }
    syncGridVisibility();
  }

  function updateLabels() {
    channelLabel.textContent = CHANNEL_LABEL[v.channel] || '🔇 Không có kênh thoại lúc này';
    hint.textContent = CHANNEL_HINT[v.channel] || CHANNEL_HINT.null;
    micBtn.disabled = !v.channel || v.busy;
    camBtn.disabled = !v.channel || v.busy;
  }

  function renderPeerList() {
    peerListEl.innerHTML = '';
    if (!v.roster.length) {
      const li = document.createElement('li');
      li.className = 'hint-text';
      li.textContent = 'Chưa có ai khác trong kênh này.';
      peerListEl.appendChild(li);
      return;
    }
    v.roster.forEach((p) => {
      const li = document.createElement('li');
      li.id = 'voice-peer-' + p.playerId;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      const st = peerStatus.get(p.playerId);
      // Bao ro khi khong noi duoc voi ai do, thay vi im lang de nguoi choi tu doan
      const label = st === 'gave-up' ? ' · không kết nối được'
        : st === 'failed' || st === 'disconnected' ? ' · đang kết nối lại…'
        : st === 'connected' || st === undefined ? '' : ' · đang kết nối…';
      name.textContent = p.name + label;
      if (st === 'gave-up') li.classList.add('peer-failed');
      li.append(dot, name);
      peerListEl.appendChild(li);
    });
  }

  // Dong bo kenh + danh sach peer moi khi nhan private_state moi tu server (goi tu app.js)
  function syncVoiceChannel(priv) {
    if(!window.RTCPeerConnection){micBtn.disabled=true;camBtn.disabled=true;hint.textContent='Trình duyệt này không hỗ trợ trò chuyện thoại. Hãy dùng Chrome, Edge, Firefox hoặc Safari bản mới.';return;}
    const blocked=mediaUnavailableReason();
    if(blocked){micBtn.disabled=true;camBtn.disabled=true;hint.textContent=blocked;}
    const nextChannel=priv.voiceChannel||null;
    const nextRoster=priv.voicePeers||[];
    if(nextChannel!==v.channel) {v.epoch++;for(const pid of [...v.peers.keys()])destroyVoicePeer(pid);}
    for(const old of v.roster) {
      if(!nextRoster.some(p=>p.playerId===old.playerId&&p.socketId===old.socketId))destroyVoicePeer(old.playerId);
    }
    v.channel = priv.voiceChannel || null;
    v.roster = priv.voicePeers || [];
    if (v.channel) autoEnableMic();
    placeVideoGrid();
    v.localStream?.getAudioTracks().forEach(t=>{t.enabled=!!v.channel;});
    updateLabels();
    renderPeerList();

    const newIds = new Set(v.roster.map((p) => p.playerId));
    for (const pid of [...v.peers.keys()]) {
      if (!newIds.has(pid)) destroyVoicePeer(pid);
    }
    v.roster.forEach((p) => {
      if (!v.peers.has(p.playerId)) {
        const iShouldInitiate = state.playerId < p.playerId;
        createVoicePeer(p.playerId, iShouldInitiate);
      }
    });
  }

  function createVoicePeer(peerId, isInitiator) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    v.peers.set(peerId, pc);

    // Only the offerer creates the media sections. The answerer reuses them
    // after setRemoteDescription, so both directions share the negotiated senders.
    // Kenh video duoc mo san ngay tu dau (chua co track) de bat/tat camera sau nay
    // chi can replaceTrack, khong phai thoa thuan lai ket noi.
    let trackReady=Promise.resolve();
    if(isInitiator){
      const direction=DIRECTION[modeOf(peerId)];
      const audioSender=pc.addTransceiver('audio',{direction}).sender;
      const videoSender=pc.addTransceiver('video',{direction}).sender;
      v.senders.set(peerId,audioSender);
      v.videoSenders.set(peerId,videoSender);
      trackReady=Promise.all([
        audioSender.replaceTrack(sends(peerId)?v.localStream?.getAudioTracks()[0]||null:null),
        videoSender.replaceTrack(sends(peerId)?v.camStream?.getVideoTracks()[0]||null:null),
      ]);
    }

    // Ket noi WebRTC co the hong giua chung (doi mang, NAT, wifi chap chon).
    // Truoc day khong co gi bat lai nen hong la mat tieng/mat hinh vinh vien.
    pc.onconnectionstatechange = () => {
      if (v.peers.get(peerId) !== pc) return;
      const st = pc.connectionState;
      peerStatus.set(peerId, st);
      renderPeerList();
      if (st === 'failed' || st === 'disconnected') scheduleRetry(peerId, pc);
      if (st === 'connected') { retryCount.delete(peerId); clearTimeout(retryTimers.get(peerId)); retryTimers.delete(peerId); }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && v.peers.get(peerId)===pc) socket.emit('voice_signal', { toPlayerId: peerId, data: { type: 'candidate', candidate: e.candidate, channel:v.channel, toSocketId:v.roster.find(p=>p.playerId===peerId)?.socketId } });
    };

    pc.ontrack = (e) => {
      if(v.peers.get(peerId)!==pc)return;
      if(e.track.kind==='video'){
        // Kenh video luon duoc mo san du chua ai bat camera, nen o day se co mot track "cam".
        // Chi hien o hinh khi track thuc su co hinh, neu khong ai cung thay mot o den.
        const stream=e.streams[0]||new MediaStream([e.track]);
        const show=()=>attachRemoteVideo(peerId,stream);
        const hide=()=>removeRemoteVideo(peerId);
        e.track.addEventListener('unmute',show);
        e.track.addEventListener('mute',hide);
        e.track.addEventListener('ended',hide);
        if(!e.track.muted) show();
        return;
      }
      let audioEl = v.audioEls.get(peerId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        // iOS Safari chan phat media toan man hinh; playsinline cho phep phat ngay trong trang
        audioEl.playsInline = true;
        audioEl.setAttribute('playsinline', '');
        document.body.appendChild(audioEl);
        v.audioEls.set(peerId, audioEl);
      }
      audioEl.srcObject = e.streams[0] || new MediaStream([e.track]);
      playRemote(audioEl);
      setupSpeakingIndicator(peerId, audioEl.srcObject, pc);
    };

    if (isInitiator) {
      (async () => {
        try {
          await trackReady;
          if(v.peers.get(peerId)!==pc)return;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if(v.peers.get(peerId)!==pc)return;
          socket.emit('voice_signal', { toPlayerId: peerId, data: { type: 'offer', sdp: pc.localDescription, channel:v.channel, toSocketId:v.roster.find(p=>p.playerId===peerId)?.socketId } });
        } catch (err) { console.error('Lỗi tạo kết nối thoại:', err); }
      })();
    }
    return pc;
  }

  // Dung lai ket noi voi mot nguoi sau khi hong. Gian cach tang dan, toi da 5 lan.
  const retryTimers = new Map();
  const retryCount = new Map();
  const peerStatus = new Map();
  function scheduleRetry(peerId, pc) {
    if (retryTimers.has(peerId)) return;
    const tries = retryCount.get(peerId) || 0;
    if (tries >= 5) { peerStatus.set(peerId, 'gave-up'); renderPeerList(); return; }
    const epoch = v.epoch;
    const timer = setTimeout(() => {
      retryTimers.delete(peerId);
      if (epoch !== v.epoch || v.peers.get(peerId) !== pc) return;
      const peer = v.roster.find((p) => p.playerId === peerId);
      if (!peer) return;
      retryCount.set(peerId, tries + 1);
      destroyVoicePeer(peerId);
      createVoicePeer(peerId, state.playerId < peerId);
    }, RETRY_DELAY_MS * (tries + 1));
    timer.unref?.();
    retryTimers.set(peerId, timer);
  }

  function destroyVoicePeer(peerId) {
    const pc = v.peers.get(peerId);
    if (pc) { try { pc.close(); } catch (e) {} v.peers.delete(peerId); }
    pc?.stopIndicator?.();
    v.senders.delete(peerId);v.videoSenders.delete(peerId);v.ice.delete(peerId);v.chains.delete(peerId);
    clearTimeout(retryTimers.get(peerId));retryTimers.delete(peerId);
    const audioEl = v.audioEls.get(peerId);
    if (audioEl) { audioEl.srcObject = null; audioEl.remove(); v.audioEls.delete(peerId); }
    removeRemoteVideo(peerId);
  }

  let sharedAudioContext=null;
  function setupSpeakingIndicator(peerId, stream, pc) {
    try {
      const ctx = sharedAudioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let stopped = false;
      pc.stopIndicator?.();
      const stop = () => { stopped = true; src.disconnect();analyser.disconnect(); };
      pc.stopIndicator=stop;
      stream.getTracks().forEach((t) => t.addEventListener('ended', stop));
      function loop() {
        if (stopped || v.peers.get(peerId)!==pc) { stop(); return; }
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const el = document.getElementById('voice-peer-' + peerId);
        if (el) el.classList.toggle('speaking', avg > 12);
        setTimeout(loop,150);
      }
      loop();
    } catch (e) { /* Trinh duyet khong ho tro AnalyserNode - bo qua bao hieu dang noi */ }
  }

  // Toggle only the audio source, preserving the already negotiated connections.
  async function refreshAllPeersWithCurrentStream() {
    const audio=v.localStream?.getAudioTracks()[0]||null;
    const video=v.camStream?.getVideoTracks()[0]||null;
    await Promise.all([
      ...[...v.senders.entries()].map(([pid,sender])=>sender.replaceTrack(sends(pid)?audio:null)),
      ...[...v.videoSenders.entries()].map(([pid,sender])=>sender.replaceTrack(sends(pid)?video:null)),
    ]);
  }

  // Trinh duyet chi cho lay micro/camera khi trang chay tren HTTPS hoac localhost.
  function mediaUnavailableReason() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return window.isSecureContext === false
        ? 'Trang đang chạy qua HTTP nên trình duyệt chặn micro và camera. Hãy mở bằng địa chỉ HTTPS hoặc localhost.'
        : 'Trình duyệt này không hỗ trợ micro và camera.';
    }
    return null;
  }

  async function setMic(on, { quiet = false } = {}) {
    if (v.busy || !v.channel || v.micOn === on) return false;
    const blocked = mediaUnavailableReason();
    if (on && blocked) { if (!quiet) toast(blocked); return false; }
    v.busy = true; micBtn.disabled = true;
    const epoch = v.epoch;
    try {
      if (on) {
        try {
          v.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (epoch !== v.epoch || !v.channel) { v.localStream.getTracks().forEach(t => t.stop()); v.localStream = null; return false; }
        } catch (e) {
          // Tu bat luc vao phong ma bi tu choi quyen thi khong lam phien bang thong bao loi
          if (!quiet) toast('Không thể mở micro: ' + (e.message || e.name));
          return false;
        }
        v.micOn = true;
      } else {
        v.micOn = false;
        v.localStream?.getTracks().forEach((t) => t.stop());
        v.localStream = null;
      }
      micBtn.textContent = v.micOn ? '🔴 Tắt micro' : '🎤 Bật micro';
      micBtn.classList.toggle('mic-live', v.micOn);
      await refreshAllPeersWithCurrentStream();
      return true;
    } catch (e) { if (!quiet) toast('Không thể cập nhật micro: ' + e.message); return false; }
    finally { v.busy = false; micBtn.disabled = !v.channel; }
  }

  micBtn.addEventListener('click', () => setMic(!v.micOn));

  // Vao phong la mic bat san (nhu cac ung dung hop truc tuyen), ai muon thi tu tat.
  // Chi thu dung mot lan moi phien de khong hoi quyen lien tuc.
  let autoMicTried = false;
  async function autoEnableMic() {
    if (autoMicTried || v.micOn || !v.channel || mediaUnavailableReason()) return;
    autoMicTried = true;
    const ok = await setMic(true, { quiet: true });
    if (!ok) hint.textContent = 'Chưa bật được micro tự động. Bấm "Bật micro" để nói.';
  }

  camBtn.addEventListener('click', async () => {
    if (v.busy || !v.channel) return;
    v.busy = true; camBtn.disabled = true;
    const epoch = v.epoch;
    try {
      if (!v.camOn) {
        const blocked = mediaUnavailableReason();
        if (blocked) { toast(blocked); return; }
        try {
          v.camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
            audio: false,
          });
          if (epoch !== v.epoch || !v.channel) { v.camStream.getTracks().forEach(t => t.stop()); v.camStream = null; return; }
        } catch (e) {
          toast('Không thể mở camera: ' + (e.message || e.name));
          return;
        }
        v.camOn = true;
        camBtn.textContent = '🔴 Tắt camera';
      } else {
        v.camOn = false;
        camBtn.textContent = '📷 Bật camera';
        v.camStream?.getTracks().forEach(t => t.stop());
        v.camStream = null;
      }
      syncLocalVideo();
      await refreshAllPeersWithCurrentStream();
      socket.emit('cam_state', { on: v.camOn });
    } catch (e) { toast('Không thể cập nhật camera: ' + e.message); }
    finally { v.busy = false; camBtn.disabled = !v.channel; }
  });

  socket.on('cam_state', ({ playerId, on }) => {
    if (!on) removeRemoteVideo(playerId);
    // Bat camera thi cho su kien 'unmute' cua track lo o hinh ra, vi luc do moi co khung hinh that
  });

  socket.on('voice_signal', ({ fromPlayerId, fromSocketId, data }) => {
    // Nguoi da mat nghe nguoi con song thi hai ben o hai kenh khac nhau, nen doi chieu
    // voi kenh cua nguoi gui chu khong phai kenh cua minh.
    const peer=v.roster.find(p=>p.playerId===fromPlayerId&&p.socketId===fromSocketId);
    if(!data || !peer || data.channel!==peer.channel)return;
    const epoch=v.epoch;
    const job=(v.chains.get(fromPlayerId)||Promise.resolve()).then(async()=>{
    if(epoch!==v.epoch||!v.roster.some(p=>p.playerId===fromPlayerId&&p.socketId===fromSocketId))return;
    if (data.type === 'offer') {
      if(state.playerId<fromPlayerId)return;
      const pc = v.peers.get(fromPlayerId)||createVoicePeer(fromPlayerId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if(epoch!==v.epoch||v.peers.get(fromPlayerId)!==pc)return;
      // Huong phai khop voi quyen nghe cua minh: nguoi da mat chi nhan, khong gui gi sang.
      const direction=DIRECTION[modeOf(fromPlayerId)];
      const canSend=direction!=='recvonly';
      const audioT=pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');
      const videoT=pc.getTransceivers().find(t=>t.receiver.track.kind==='video');
      if(!audioT)return;
      audioT.direction=direction;
      v.senders.set(fromPlayerId,audioT.sender);
      await audioT.sender.replaceTrack(canSend?v.localStream?.getAudioTracks()[0]||null:null);
      if(videoT){
        videoT.direction=direction;
        v.videoSenders.set(fromPlayerId,videoT.sender);
        await videoT.sender.replaceTrack(canSend?v.camStream?.getVideoTracks()[0]||null:null);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if(epoch!==v.epoch||v.peers.get(fromPlayerId)!==pc)return;
      socket.emit('voice_signal', { toPlayerId: fromPlayerId, data: { type: 'answer', sdp: pc.localDescription, channel:v.channel, toSocketId:fromSocketId } });
    } else if (data.type === 'answer') {
      const pc = v.peers.get(fromPlayerId);
      if (pc && pc.signalingState==='have-local-offer') await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'candidate') {
      const pc = v.peers.get(fromPlayerId);
      if (!pc?.remoteDescription) {const pending=v.ice.get(fromPlayerId)||[];if(pending.length<64)pending.push(data.candidate);v.ice.set(fromPlayerId,pending);return;}
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
    const pc=v.peers.get(fromPlayerId);
    if(pc?.remoteDescription){for(const candidate of v.ice.get(fromPlayerId)||[])await pc.addIceCandidate(new RTCIceCandidate(candidate));v.ice.delete(fromPlayerId);}
    }).catch(()=>{hint.textContent='Kết nối thoại bị gián đoạn. Thử vào lại phòng nếu không nghe được.';});
    v.chains.set(fromPlayerId,job);
  });

  socket.on('disconnect', () => {
    v.epoch++;v.channel=null;v.roster=[];
    for (const pid of [...v.peers.keys()]) destroyVoicePeer(pid);
    v.localStream?.getTracks().forEach(t=>t.stop());v.localStream=null;v.micOn=false;autoMicTried=false;
    micBtn.classList.remove('mic-live');
    v.camStream?.getTracks().forEach(t=>t.stop());v.camStream=null;v.camOn=false;
    syncLocalVideo();
    micBtn.textContent='🎤 Bật micro';micBtn.disabled=true;
    camBtn.textContent='📷 Bật camera';camBtn.disabled=true;
    sharedAudioContext?.close().catch(()=>{});sharedAudioContext=null;
  });

  updateLabels();
  renderPeerList();
  window.gameVoice = { mount, syncVoiceChannel, placeVideoGrid };
})();
