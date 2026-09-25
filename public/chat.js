(() => {
  const panel = $('room-chat');
  const list = $('chat-messages');
  const input = $('chat-input');
  let channel = 'public';
  let snapshot = null;
  let pending = false;
  let renderedKey = '';
  let drafts = { public: '', wolves: '' };
  let unread = 0;
  let lastWolfId = 0;

  function mount(id) {
    const active = id || document.querySelector('.screen.active')?.id;
    const visible = snapshot && ['screen-lobby', 'screen-game', 'screen-over'].includes(active);
    panel.classList.toggle('hidden', !visible);
    if (visible) document.querySelector(`#${active} .card, #${active} .game-layout`).appendChild(panel);
  }

  function render() {
    if (!snapshot) return;
    const wolves = snapshot.permissions.wolves.canRead;
    if (!wolves) {
      channel = 'public';
      drafts.wolves = '';
      unread = 0;
    }
    const permission = snapshot.permissions[channel];
    $('chat-wolves').classList.toggle('hidden', !wolves);
    $('chat-public').setAttribute('aria-pressed', String(channel === 'public'));
    $('chat-wolves').setAttribute('aria-pressed', String(channel === 'wolves'));
    $('chat-wolves').textContent = '🐺 Bầy Sói · riêng tư' + (unread ? ` (${unread} mới)` : '');
    $('chat-hint').textContent = permission.canSend
      ? channel === 'wolves' ? 'Chỉ Sói còn sống nhận được tin nhắn này, bao gồm Sói trắng.' : 'Mọi người trong phòng đều đọc được tin nhắn này.'
      : permission.reason;
    input.disabled = pending || !permission.canSend || !socket.connected;
    $('chat-send').disabled = input.disabled;
    document.querySelector('label[for="chat-input"]').textContent = channel === 'wolves' ? 'Tin nhắn riêng cho bầy Sói' : 'Tin nhắn vào phòng chung';
    const messages = snapshot.messages.filter(m => m.channel === channel);
    const key = channel + ':' + messages.map(m => m.id).join(',');
    if (key !== renderedKey) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 50;
      const switched = !renderedKey.startsWith(channel + ':');
      list.replaceChildren();
      if (!messages.length) {
        const empty = document.createElement('li');
        empty.className = 'hint-text';
        empty.textContent = 'Chưa có tin nhắn trong kênh này.';
        list.appendChild(empty);
      }
      for (const message of messages) {
        const row = document.createElement('li');
        row.className = 'chat-message';
        const author = document.createElement('strong');
        author.textContent = message.name + (message.playerId === state.playerId ? ' (bạn)' : '');
        const time = document.createElement('time');
        time.textContent = new Date(message.sentAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const body = document.createElement('p');
        body.textContent = message.text;
        row.append(author, time, body);
        list.appendChild(row);
      }
      if (atBottom || switched) list.scrollTop = list.scrollHeight;
      renderedKey = key;
    }
    mount();
  }

  function select(next) {
    drafts[channel] = input.value;
    channel = next;
    input.value = drafts[channel];
    if (channel === 'wolves') unread = 0;
    $('chat-error').textContent = '';
    render();
  }
  $('chat-public').addEventListener('click', () => select('public'));
  $('chat-wolves').addEventListener('click', () => select('wolves'));
  $('chat-form').addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (pending || !text || !snapshot?.permissions[channel].canSend) return;
    if (!socket.connected) { $('chat-error').textContent = 'Mất kết nối. Chờ kết nối lại để gửi tin.'; return; }
    const sentChannel = channel;
    pending = true;
    $('chat-error').textContent = '';
    render();
    socket.timeout(5000).emit('chat_send', { channel: sentChannel, text }, (error, result) => {
      pending = false;
      if (error || !result?.ok) $('chat-error').textContent = error ? 'Chưa nhận được xác nhận. Kiểm tra lịch sử trước khi gửi lại.' : result.error;
      else {
        drafts[sentChannel] = '';
        if (channel === sentChannel) input.value = '';
      }
      render();
    });
  });
  socket.on('chat_state', data => {
    const latestWolf = data.messages.filter(m => m.channel === 'wolves').at(-1)?.id || 0;
    if (latestWolf > lastWolfId && channel !== 'wolves') unread += data.messages.filter(m => m.channel === 'wolves' && m.id > lastWolfId).length;
    lastWolfId = latestWolf;
    if (!data.messages.length) {
      drafts = { public: '', wolves: '' };
      input.value = '';
      renderedKey = '';
      unread = 0;
    }
    if (snapshot?.permissions.wolves.canRead && !data.permissions.wolves.canRead && channel === 'wolves') input.value = drafts.public;
    snapshot = data;
    render();
  });
  socket.on('disconnect', () => {
    $('chat-error').textContent = 'Mất kết nối. Đang kết nối lại…';
    render();
  });
  window.gameChat = { mount };
})();
