const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('chat UI switches channels, renders text safely and removes wolf history after death', () => {
  const elements = new Map();
  function get(id) {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', textContent: '', children: [], handlers: {}, attrs: {},
      scrollHeight: 0, scrollTop: 0, clientHeight: 250,
      classList: { toggle() {} },
      focus() {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(node) { this.children.push(node); node.parentNode = this; },
      replaceChildren() { this.children = []; },
      setAttribute(k,v) { this.attrs[k] = v; },
      addEventListener(k,cb) { this.handlers[k] = cb; },
    });
    return elements.get(id);
  }
  const handlers = {};
  let sent;
  let acknowledge;
  const context = vm.createContext({
    $: get, window: {}, state: { playerId: 'me' },
    document: { querySelector: selector => selector === '.screen.active' ? {id:'screen-game'} : get(selector), createElement: () => get(Symbol()) },
    socket: { connected: true, on(k,cb) { handlers[k] = cb; }, timeout() { return this; }, emit(event, data, cb) { sent = data; acknowledge = cb; } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/chat.js'),'utf8'),context);
  const permissions = { public: {canRead:true,canSend:false,reason:'Night'}, wolves: {canRead:true,canSend:true} };
  handlers.chat_state({permissions,messages:[]});
  get('chat-wolves').handlers.click();
  get('chat-input').value = 'Draft before first message';
  handlers.chat_state({permissions,messages:[]});
  assert.equal(get('chat-input').value, 'Draft before first message');
  assert.equal(get('#screen-game').children.length, 1, 'Repeated snapshots must not remount the input');
  get('chat-public').handlers.click();
  const messages = [{id:1,channel:'public',name:'<img onerror=alert(1)>',text:'<script>alert(1)</script>',playerId:'me',sentAt:1000},
    {id:2,channel:'wolves',name:'Wolf',text:'Secret plan',playerId:'wolf',sentAt:2000}];
  handlers.chat_state({permissions,messages});
  get('chat-messages').scrollHeight = 900;
  get('chat-messages').scrollTop = 0;
  const incoming = {id:3,channel:'public',name:'New',text:'Latest message',sentAt:3000};
  handlers.chat_state({permissions,messages:[...messages,incoming]});
  assert.equal(get('chat-messages').scrollTop,0,'New messages must preserve the position while reading history');
  get('chat-latest').handlers.click();
  assert.equal(get('chat-messages').scrollTop,900);
  assert.equal(get('#screen-game').children.length,1);
  assert.equal(get('chat-input').disabled,true);
  assert.equal(get('chat-messages').children[0].children[0].textContent,'<img onerror=alert(1)> (bạn)');
  assert.equal(get('chat-messages').children[0].children[2].textContent,'<script>alert(1)</script>');
  get('chat-wolves').handlers.click();
  assert.equal(get('chat-input').disabled,false);
  assert.equal(get('chat-messages').children[0].children[2].textContent,'Secret plan');
  get('chat-input').value = '';
  get('chat-messages').children[0].children[3].handlers.click();
  assert.equal(get('chat-input').value, '@Wolf ');
  assert.match(get('chat-reply-text').textContent, /Secret plan/);
  get('chat-form').handlers.submit({preventDefault(){}});
  assert.equal(sent.replyToId, 2);
  acknowledge(null,{ok:true});
  get('chat-messages').children[0].children[3].handlers.click();
  get('chat-reply-cancel').handlers.click();
  assert.equal(get('chat-input').value, '');
  get('chat-input').value='Pack reply';
  get('chat-form').handlers.submit({preventDefault(){}});
  assert.equal(sent.channel,'wolves');assert.equal(sent.text,'Pack reply');
  assert.equal(get('chat-input').disabled,false,'Waiting for acknowledgement must not blur input');
  acknowledge(null,{ok:true});
  assert.equal(get('chat-input').value,'');
  get('chat-input').value='Second reply';
  get('chat-form').handlers.submit({preventDefault(){}});
  get('chat-input').value='Still typing while waiting';
  acknowledge(null,{ok:true});
  assert.equal(get('chat-input').value,'Still typing while waiting');
  handlers.chat_state({permissions:{public:permissions.public,wolves:{canRead:false,canSend:false}},messages:[messages[0]]});
  assert.equal(get('chat-public').attrs['aria-pressed'],'true');
  assert.equal(get('chat-messages').children.length,1);
  assert.equal(get('chat-messages').children[0].children[2].textContent,messages[0].text);
});
