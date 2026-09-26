(() => {
  const panel = $('room-chat');
  const list = $('chat-messages');
  const input = $('chat-input');
  let channel = 'public';
  let snapshot = null;
  let pending = false;
  let renderedKey = '';
  let drafts = { public: '', wolves: '' };
  let replies = { public: null, wolves: null };
  let unread = 0;
  let lastWolfId = 0;

  function mount(id) {
    const active = id || document.querySelector('.screen.active')?.id;
    const visible = snapshot && ['screen-lobby', 'screen-game', 'screen-over'].includes(active);
    panel.classList.toggle('hidden', !visible);
    if (visible) {
      const target = document.querySelector(`#${active}`);
      // Moving a focused input, even within the same parent, can dismiss the keyboard.
      if (panel.parentNode !== target) {
        target.appendChild(panel);
        list.scrollTop = list.scrollHeight;
      }
    }
  }

  function render() {
    if (!snapshot) return;
    const wolves = snapshot.permissions.wolves.canRead;
    if (!wolves) {
      channel = 'public';
      drafts.wolves = '';
      replies.wolves = null;
      unread = 0;
    }
    const permission = snapshot.permissions[channel];
    const reply = replies[channel];
    $('chat-reply-preview').classList.toggle('hidden', !reply);
    $('chat-reply-text').textContent = reply ? `Trả lời @${reply.name}: ${reply.text}` : '';
    $('chat-wolves').classList.toggle('hidden', !wolves);
    $('chat-public').setAttribute('aria-pressed', String(channel === 'public'));
    $('chat-wolves').setAttribute('aria-pressed', String(channel === 'wolves'));
    $('chat-wolves').textContent = '🐺 Bầy Sói · riêng tư' + (unread ? ` (${unread} mới)` : '');
    $('chat-hint').textContent = permission.canSend
      ? channel === 'wolves' ? 'Chỉ Sói còn sống nhận được tin nhắn này, bao gồm Sói trắng.' : 'Mọi người trong phòng đều đọc được tin nhắn này.'
      : permission.reason;
    input.disabled = !permission.canSend || !socket.connected;
    $('chat-send').disabled = pending || input.disabled;
    document.querySelector('label[for="chat-input"]').textContent = channel === 'wolves' ? 'Tin nhắn riêng cho bầy Sói' : 'Tin nhắn vào phòng chung';
    const messages = snapshot.messages.filter(m => m.channel === channel);
    const key = channel + ':' + messages.map(m => m.id).join(',');
    const messagesChanged = key !== renderedKey;
    const previousScrollTop = list.scrollTop;
    const followLatest = list.scrollHeight - list.scrollTop - list.clientHeight < 48 ||
      !renderedKey.startsWith(channel + ':');
    if (messagesChanged) {
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
        row.append(author, time);
        if (message.replyTo) {
          const quote = document.createElement('blockquote');
          quote.className = 'chat-quote';
          quote.textContent = `↪ @${message.replyTo.name}: ${message.replyTo.text}`;
          row.appendChild(quote);
        }
        row.appendChild(body);
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
      }
      renderedKey = key;
    }
    mount();
    if (messagesChanged) {
      list.scrollTop = followLatest ? list.scrollHeight : previousScrollTop;
      $('chat-latest').classList.toggle('hidden', followLatest);
    }
  }

  $('chat-latest').addEventListener('click', () => {
    list.scrollTop = list.scrollHeight;
    $('chat-latest').classList.toggle('hidden', true);
  });
  list.addEventListener('scroll', () => {
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 48) $('chat-latest').classList.toggle('hidden', true);
  });

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
    const latestWolf = data.messages.filter(m => m.channel === 'wolves').at(-1)?.id || 0;
    if (latestWolf > lastWolfId && channel !== 'wolves') unread += data.messages.filter(m => m.channel === 'wolves' && m.id > lastWolfId).length;
    lastWolfId = latestWolf;
    if (snapshot?.messages.length && !data.messages.length) {
      drafts = { public: '', wolves: '' };
      replies = { public: null, wolves: null };
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
