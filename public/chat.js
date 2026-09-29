(() => {
  const panel = $('room-chat');
  const list = $('chat-messages');
  const input = $('chat-input');
  let channel = 'public';
  let snapshot = null;
  let pending = false;
  let renderedKey = '';
  let drafts = { public: '', wolves: '', dead: '' };
  let replies = { public: null, wolves: null, dead: null };
  let unread = { wolves: 0, dead: 0 };
  let lastSeenId = { wolves: 0, dead: 0 };
  const rows = new Map();
  let recording = null;
  let askingMic = false;

  function stopRecording(cancel = false) {
    if (!recording) return;
    recording.cancelled ||= cancel;
    if (recording.recorder.state !== 'inactive') recording.recorder.stop();
    recording.stream.getTracks().forEach(t => t.stop());
  }
  $('chat-record-cancel').addEventListener('click', () => stopRecording(true));
  $('chat-record').addEventListener('click', async () => {
    if (recording) return stopRecording();
    if (askingMic || !snapshot?.permissions[channel]?.canSend) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      $('chat-error').textContent = 'Ghi voice cần HTTPS và trình duyệt hỗ trợ micro.'; return;
    }
    askingMic = true;
    const sentChannel = channel;
    const sentPhase = state.lastGameState?.phase;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (channel !== sentChannel || state.lastGameState?.phase !== sentPhase || !snapshot.permissions[channel].canSend || !socket.connected) {
        stream.getTracks().forEach(t => t.stop()); return;
      }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
      if (!mime) throw new Error('Trình duyệt không hỗ trợ định dạng voice phù hợp.');
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 });
      const job = { recorder, stream, cancelled: false, channel: sentChannel, phase: sentPhase };
      recording = job;
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => stopRecording(true);
      recorder.onstop = async () => {
        clearTimeout(job.timer);
        stream.getTracks().forEach(t => t.stop());
        recording = null;
        $('chat-record').textContent = '🎙 Ghi voice (20 giây)';
        $('chat-record-cancel').classList.add('hidden');
        if (job.cancelled || !socket.connected || !snapshot.permissions[sentChannel]?.canSend) return;
        const blob = new Blob(chunks, { type: mime });
        if (!blob.size || blob.size > 130000) { $('chat-error').textContent = 'Voice quá lớn hoặc rỗng. Hãy ghi ngắn hơn.'; return; }
        const reader = new FileReader();
        reader.onload = () => socket.timeout(8000).emit('chat_send', {
          channel: sentChannel, audio: { mime, base64: reader.result.split(',')[1] },
        }, (error, result) => { $('chat-error').textContent = error ? 'Chưa xác nhận gửi voice.' : result?.ok ? '' : result?.error || 'Không gửi được voice.'; });
        reader.readAsDataURL(blob);
      };
      recorder.start();
      job.timer = setTimeout(() => stopRecording(), 20000);
      $('chat-record').textContent = '⏹ Dừng và gửi voice';
      $('chat-record-cancel').classList.remove('hidden');
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      $('chat-error').textContent = 'Không ghi được voice: ' + error.message;
    } finally { askingMic = false; }
  });

  function mount(id) {
    const active = id || document.querySelector('.screen.active')?.id;
    const visible = snapshot && ['screen-lobby', 'screen-game', 'screen-over'].includes(active);
    panel.classList.toggle('hidden', !visible);
    if (visible) {
      const target = document.querySelector(`#${active}`);
      // Khung voice va khung chat nam chung mot cot, nen di chuyen ca cot.
      const side = $('room-side');
      // Moving a focused input, even within the same parent, can dismiss the keyboard.
      if (side.parentNode !== target) {
        target.appendChild(side);
        list.scrollTop = list.scrollHeight;
      }
    }
  }

  function render() {
    if (!snapshot) return;
    const wolves = snapshot.permissions.wolves.canRead;
    const dead = snapshot.permissions.dead?.canRead || false;
    if (!wolves && channel === 'wolves') { channel = 'public'; }
    if (!dead && channel === 'dead') { channel = 'public'; }
    if (!wolves) { drafts.wolves = ''; replies.wolves = null; unread.wolves = 0; }
    if (!dead) { drafts.dead = ''; replies.dead = null; unread.dead = 0; }
    const permission = snapshot.permissions[channel];
    if (recording && (recording.channel !== channel || !permission.canSend || recording.phase !== state.lastGameState?.phase)) stopRecording(true);
    $('chat-record').disabled = !permission.canSend || !socket.connected;
    const reply = replies[channel];
    $('chat-reply-preview').classList.toggle('hidden', !reply);
    $('chat-reply-text').textContent = reply ? `Trả lời @${reply.name}: ${reply.text}` : '';
    $('chat-wolves').classList.toggle('hidden', !wolves);
    $('chat-dead').classList.toggle('hidden', !dead);
    $('chat-public').setAttribute('aria-pressed', String(channel === 'public'));
    $('chat-wolves').setAttribute('aria-pressed', String(channel === 'wolves'));
    $('chat-dead').setAttribute('aria-pressed', String(channel === 'dead'));
    $('chat-wolves').textContent = '🐺 Bầy Sói · riêng tư' + (unread.wolves ? ` (${unread.wolves} mới)` : '');
    $('chat-dead').textContent = '👻 Âm phủ · riêng tư' + (unread.dead ? ` (${unread.dead} mới)` : '');
    $('chat-hint').textContent = permission.canSend
      ? channel === 'wolves' ? 'Chỉ Sói còn sống nhận được tin nhắn này, bao gồm Sói trắng.'
      : channel === 'dead' ? 'Chỉ người chơi đã mất mới đọc và gửi được tin trong kênh này.'
      : 'Mọi người trong phòng đều đọc được tin nhắn này.'
      : permission.reason;
    input.disabled = !permission.canSend || !socket.connected;
    $('chat-send').disabled = pending || input.disabled;
    document.querySelector('label[for="chat-input"]').textContent = channel === 'wolves' ? 'Tin nhắn riêng cho bầy Sói' : channel === 'dead' ? 'Tin nhắn riêng cho Âm phủ' : 'Tin nhắn vào phòng chung';
    const messages = snapshot.messages.filter(m => m.channel === channel);
    const key = channel + ':' + messages.map(m => m.id).join(',');
    const messagesChanged = key !== renderedKey;
    if (messagesChanged) {
      if (!renderedKey.startsWith(channel + ':') || !rows.size || !messages.length) {
        list.replaceChildren();
        rows.clear();
      }
      for (const [id, row] of rows) if (!messages.some(m => m.id === id)) { row.remove(); rows.delete(id); }
      if (!messages.length) {
        const empty = document.createElement('li');
        empty.className = 'hint-text';
        empty.textContent = 'Chưa có tin nhắn trong kênh này.';
        list.appendChild(empty);
      }
      for (const message of messages) {
        if (rows.has(message.id)) continue;
        const row = document.createElement('li');
        row.className = 'chat-message';
        const author = document.createElement('strong');
        author.textContent = message.name + (message.playerId === state.playerId ? ' (bạn)' : '');
        const time = document.createElement('time');
        time.textContent = new Date(message.sentAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const body = document.createElement('p');
        body.textContent = message.text;
        row.append(author, time);
        if (message.replyTo) {
          const quote = document.createElement('blockquote');
          quote.className = 'chat-quote';
          quote.textContent = `↪ @${message.replyTo.name}: ${message.replyTo.text}`;
          row.appendChild(quote);
        }
        row.appendChild(body);
        if (message.audio) {
          const play = document.createElement('button');
          play.className = 'btn-secondary small';
          play.textContent = '▶ Nghe voice';
          play.addEventListener('click', () => {
            play.disabled = true;
            socket.timeout(8000).emit('chat_audio', message.id, (error, result) => {
              if (error || !result?.ok) { play.disabled = false; play.textContent = 'Thử tải voice lại'; return; }
              const audio = document.createElement('audio');
              audio.controls = true;
              audio.src = `data:${result.audio.mime};base64,${result.audio.base64}`;
              row.appendChild(audio);
              play.remove();
              audio.play().catch(() => {});
            });
          });
          row.appendChild(play);
        }
        const replyButton = document.createElement('button');
        replyButton.type = 'button';
        replyButton.className = 'chat-reply-button';
        replyButton.textContent = '↪ Trả lời';
        replyButton.addEventListener('click', () => {
          if (!snapshot.permissions[channel].canSend || !socket.connected) {
            $('chat-error').textContent = 'Bạn chưa thể gửi tin trong kênh này lúc này.';
            return;
          }
          const previous = replies[channel];
          if (previous && input.value.startsWith(`@${previous.name} `)) input.value = input.value.slice(previous.name.length + 2);
          replies[channel] = message;
          const mention = `@${message.name} `;
          if (!input.value.startsWith(mention)) input.value = mention + input.value;
          render();
          input.focus({ preventScroll: true });
        });
        row.appendChild(replyButton);
        list.appendChild(row);
        rows.set(message.id, row);
      }
      renderedKey = key;
    }
    mount();
    if (messagesChanged) list.scrollTop = list.scrollHeight;
  }

  function select(next) {
    if (recording) stopRecording(true);
    drafts[channel] = input.value;
    channel = next;
    input.value = drafts[channel];
    if (channel === 'wolves') unread.wolves = 0;
    if (channel === 'dead') unread.dead = 0;
    $('chat-error').textContent = '';
    render();
  }
  $('chat-public').addEventListener('click', () => select('public'));
  $('chat-wolves').addEventListener('click', () => select('wolves'));
  $('chat-dead').addEventListener('click', () => select('dead'));
  $('chat-reply-cancel').addEventListener('click', () => {
    const reply = replies[channel];
    if (reply && input.value.startsWith(`@${reply.name} `)) input.value = input.value.slice(reply.name.length + 2);
    replies[channel] = null;
    render();
  });
  $('chat-form').addEventListener('submit', event => {
    event.preventDefault();
    const submittedDraft = input.value;
    const text = submittedDraft.trim();
    if (pending || !text || !snapshot?.permissions[channel].canSend) return;
    if (!socket.connected) { $('chat-error').textContent = 'Mất kết nối. Chờ kết nối lại để gửi tin.'; return; }
    const sentChannel = channel;
    const sentReply = replies[channel];
    pending = true;
    $('chat-error').textContent = '';
    render();
    socket.timeout(5000).emit('chat_send', { channel: sentChannel, text, replyToId: sentReply?.id || null }, (error, result) => {
      pending = false;
      if (error || !result?.ok) $('chat-error').textContent = error ? 'Chưa nhận được xác nhận. Kiểm tra lịch sử trước khi gửi lại.' : result.error;
      else {
        if (replies[sentChannel] === sentReply) replies[sentChannel] = null;
        if (drafts[sentChannel] === submittedDraft) drafts[sentChannel] = '';
        if (channel === sentChannel && input.value === submittedDraft) input.value = '';
      }
      render();
    });
  });
  socket.on('chat_state', data => {
    for (const ch of ['wolves', 'dead']) {
      const latest = data.messages.filter(m => m.channel === ch).at(-1)?.id || 0;
      if (latest > lastSeenId[ch] && channel !== ch) unread[ch] += data.messages.filter(m => m.channel === ch && m.id > lastSeenId[ch]).length;
      lastSeenId[ch] = latest;
    }
    if (snapshot?.messages.length && !data.messages.length) {
      drafts = { public: '', wolves: '', dead: '' };
      replies = { public: null, wolves: null, dead: null };
      input.value = '';
      renderedKey = '';
      unread = { wolves: 0, dead: 0 };
    }
    if (snapshot?.permissions.wolves.canRead && !data.permissions.wolves.canRead && channel === 'wolves') input.value = drafts.public;
    if (snapshot?.permissions.dead?.canRead && !data.permissions.dead?.canRead && channel === 'dead') input.value = drafts.public;
    snapshot = data;
    render();
  });
  socket.on('disconnect', () => {
    stopRecording(true);
    $('chat-error').textContent = 'Mất kết nối. Đang kết nối lại…';
    render();
  });
  window.gameChat = { mount };
})()
