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

  const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const CHANNEL_LABEL = {
    village: '🏘️ Kênh: Làng (ai còn sống cũng nghe được)',
    wolves: '🐺 Kênh: Bầy Sói (riêng tư, chỉ Sói còn sống)',
    dead: '👻 Kênh: Âm phủ (chỉ người đã mất)',
  };
  const CHANNEL_HINT = {
    village: 'Mọi người còn sống đều nghe và nói được ở đây.',
    wolves: 'Chỉ bầy Sói còn sống nghe được nhau lúc này.',
    dead: 'Chỉ những người đã mất mới vào được kênh này, có thể nói chuyện thoải mái.',
    null: 'Hiện không có kênh voice nào đang mở (đang là lượt riêng của một vai trò khác).',
  };

  const v = {
    micOn: false,
    localStream: null,
    peers: new Map(),      // playerId -> RTCPeerConnection
    audioEls: new Map(),   // playerId -> <audio>
    channel: null,
    roster: [],
  };

  function mount(id) {
    const active = id || document.querySelector('.screen.active')?.id;
    const visible = state.roomCode && ['screen-lobby', 'screen-game', 'screen-over'].includes(active);
    panel.classList.toggle('hidden', !visible);
    if (visible) {
      const target = document.querySelector(`#${active}`);
      if (panel.parentNode !== target) target.appendChild(panel);
    }
  }

  function updateLabels() {
    channelLabel.textContent = CHANNEL_LABEL[v.channel] || '🔇 Không có kênh voice lúc này';
    hint.textContent = CHANNEL_HINT[v.channel] || CHANNEL_HINT.null;
    micBtn.disabled = !v.channel;
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
      name.textContent = p.name;
      li.append(dot, name);
      peerListEl.appendChild(li);
    });
  }

  // Dong bo kenh + danh sach peer moi khi nhan private_state moi tu server (goi tu app.js)
  function syncVoiceChannel(priv) {
    v.channel = priv.voiceChannel || null;
    v.roster = priv.voicePeers || [];
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

    if (v.localStream) {
      v.localStream.getTracks().forEach((track) => pc.addTrack(track, v.localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('voice_signal', { toPlayerId: peerId, data: { type: 'candidate', candidate: e.candidate } });
    };

    pc.ontrack = (e) => {
      let audioEl = v.audioEls.get(peerId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
        v.audioEls.set(peerId, audioEl);
      }
      audioEl.srcObject = e.streams[0];
      setupSpeakingIndicator(peerId, e.streams[0]);
    };

    if (isInitiator) {
      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('voice_signal', { toPlayerId: peerId, data: { type: 'offer', sdp: pc.localDescription } });
        } catch (err) { console.error('Loi tao offer voice:', err); }
      })();
    }
    return pc;
  }

  function destroyVoicePeer(peerId) {
    const pc = v.peers.get(peerId);
    if (pc) { try { pc.close(); } catch (e) {} v.peers.delete(peerId); }
    const audioEl = v.audioEls.get(peerId);
    if (audioEl) { audioEl.srcObject = null; audioEl.remove(); v.audioEls.delete(peerId); }
  }

  function setupSpeakingIndicator(peerId, stream) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let stopped = false;
      const stop = () => { stopped = true; ctx.close().catch(() => {}); };
      stream.getTracks().forEach((t) => t.addEventListener('ended', stop));
      function loop() {
        if (stopped || !v.peers.has(peerId)) { ctx.close().catch(() => {}); return; }
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const el = document.getElementById('voice-peer-' + peerId);
        if (el) el.classList.toggle('speaking', avg > 12);
        requestAnimationFrame(loop);
      }
      loop();
    } catch (e) { /* Trinh duyet khong ho tro AnalyserNode - bo qua bao hieu dang noi */ }
  }

  // Nguoi vua doi trang thai mic luon dong vai "nguoi khoi tao" cho moi ket noi hien co,
  // dam bao track am thanh moi (hoac viec tat track) duoc lan truyen ngay lap tuc.
  function refreshAllPeersWithCurrentStream() {
    v.roster.forEach((p) => {
      destroyVoicePeer(p.playerId);
      createVoicePeer(p.playerId, true);
    });
  }

  micBtn.addEventListener('click', async () => {
    if (!v.micOn) {
      try {
        v.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e) {
        toast('Không thể mở micro: ' + (e.message || e.name));
        return;
      }
      v.micOn = true;
      micBtn.textContent = '🔴 Tắt mic';
    } else {
      v.micOn = false;
      micBtn.textContent = '🎤 Bật mic';
      if (v.localStream) {
        v.localStream.getTracks().forEach((t) => t.stop());
        v.localStream = null;
      }
    }
    refreshAllPeersWithCurrentStream();
  });

  socket.on('voice_signal', async ({ fromPlayerId, data }) => {
    if (data.type === 'offer') {
      destroyVoicePeer(fromPlayerId); // don sach ket noi cu neu co de tranh xung dot trang thai SDP
      const pc = createVoicePeer(fromPlayerId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice_signal', { toPlayerId: fromPlayerId, data: { type: 'answer', sdp: pc.localDescription } });
    } else if (data.type === 'answer') {
      const pc = v.peers.get(fromPlayerId);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'candidate') {
      const pc = v.peers.get(fromPlayerId);
      if (pc) { try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { /* bo qua candidate den tre */ } }
    }
  });

  socket.on('disconnect', () => {
    for (const pid of [...v.peers.keys()]) destroyVoicePeer(pid);
  });

  updateLabels();
  renderPeerList();
  window.gameVoice = { mount, syncVoiceChannel };
})();
