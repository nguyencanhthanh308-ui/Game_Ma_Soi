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
  listenBtn.className='btn-secondary small listen-btn';
  listenBtn.textContent='🔊 Nghe trò chuyện';
  // Xuong hang rieng: de chung hang voi nut micro va camera thi ba nut bi gay chu
  (camBtn.parentNode||micBtn).after(listenBtn);
  function playRemote(audio) {
    audio.play().catch(()=>{hint.textContent='Bấm Nghe trò chuyện để phát tiếng. Không cần bật mic.';});
  }
  function unlockRemote() { v.audioEls.forEach(playRemote);sharedAudioContext?.resume().catch(()=>{}); }
  listenBtn.addEventListener('click',unlockRemote);
  document.addEventListener('pointerdown',unlockRemote);
  document.addEventListener('keydown',unlockRemote);

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
  function syncGridVisibility() {
    const hasVideo = videoGrid.childElementCount > 0;
    videoGrid.classList.toggle('hidden', !hasVideo);
    // Bao cho bo cuc biet khung thoai dang cao han binh thuong (xem style.css)
    panel.classList.toggle('has-video', hasVideo);
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
      name.textContent = p.name;
      li.append(dot, name);
      peerListEl.appendChild(li);
    });
  }

  // Dong bo kenh + danh sach peer moi khi nhan private_state moi tu server (goi tu app.js)
  function syncVoiceChannel(priv) {
    if(!window.RTCPeerConnection){micBtn.disabled=true;hint.textContent='Trình duyệt không hỗ trợ trò chuyện thoại.';return;}
    const nextChannel=priv.voiceChannel||null;
    const nextRoster=priv.voicePeers||[];
    if(nextChannel!==v.channel) {v.epoch++;for(const pid of [...v.peers.keys()])destroyVoicePeer(pid);}
    for(const old of v.roster) {
      if(!nextRoster.some(p=>p.playerId===old.playerId&&p.socketId===old.socketId))destroyVoicePeer(old.playerId);
    }
    v.channel = priv.voiceChannel || null;
    v.roster = priv.voicePeers || [];
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

  function destroyVoicePeer(peerId) {
    const pc = v.peers.get(peerId);
    if (pc) { try { pc.close(); } catch (e) {} v.peers.delete(peerId); }
    pc?.stopIndicator?.();
    v.senders.delete(peerId);v.videoSenders.delete(peerId);v.ice.delete(peerId);v.chains.delete(peerId);
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

  micBtn.addEventListener('click', async () => {
    if(v.busy||!v.channel)return;
    v.busy=true;micBtn.disabled=true;
    const epoch=v.epoch;
    try {
    if (!v.micOn) {
      try {
        v.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if(epoch!==v.epoch||!v.channel){v.localStream.getTracks().forEach(t=>t.stop());v.localStream=null;return;}
      } catch (e) {
        toast('Không thể mở micro: ' + (e.message || e.name));
        return;
      }
      v.micOn = true;
      micBtn.textContent = '🔴 Tắt micro';
    } else {
      v.micOn = false;
      micBtn.textContent = '🎤 Bật micro';
      if (v.localStream) {
        v.localStream.getTracks().forEach((t) => t.stop());
        v.localStream = null;
      }
    }
    await refreshAllPeersWithCurrentStream();
    } catch(e) {toast('Không thể cập nhật micro: '+e.message);}
    finally {v.busy=false;micBtn.disabled=!v.channel;}
  });

  camBtn.addEventListener('click', async () => {
    if (v.busy || !v.channel) return;
    v.busy = true; camBtn.disabled = true;
    const epoch = v.epoch;
    try {
      if (!v.camOn) {
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
    v.localStream?.getTracks().forEach(t=>t.stop());v.localStream=null;v.micOn=false;
    v.camStream?.getTracks().forEach(t=>t.stop());v.camStream=null;v.camOn=false;
    syncLocalVideo();
    micBtn.textContent='🎤 Bật micro';micBtn.disabled=true;
    camBtn.textContent='📷 Bật camera';camBtn.disabled=true;
    sharedAudioContext?.close().catch(()=>{});sharedAudioContext=null;
  });

  updateLabels();
  renderPeerList();
  window.gameVoice = { mount, syncVoiceChannel };
})();
