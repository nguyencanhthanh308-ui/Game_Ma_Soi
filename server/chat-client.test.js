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
      append(...nodes) { this.children.push(...nodes); },
      appendChild(node) { this.children.push(node); },
      replaceChildren() { this.children = []; },
      setAttribute(k,v) { this.attrs[k] = v; },
      addEventListener(k,cb) { this.handlers[k] = cb; },
    });
    return elements.get(id);
  }
  const handlers = {};
  let sent;
  const context = vm.createContext({
    $: get, window: {}, state: { playerId: 'me' },
    document: { querySelector: selector => selector === '.screen.active' ? {id:'screen-game'} : get(selector), createElement: () => get(Symbol()) },
    socket: { connected: true, on(k,cb) { handlers[k] = cb; }, timeout() { return this; }, emit(event, data, cb) { sent = data; cb(null,{ok:true}); } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/chat.js'),'utf8'),context);
  const permissions = { public: {canRead:true,canSend:false,reason:'Night'}, wolves: {canRead:true,canSend:true} };
  const messages = [{id:1,channel:'public',name:'<img onerror=alert(1)>',text:'<script>alert(1)</script>',playerId:'me',sentAt:1000},
    {id:2,channel:'wolves',name:'Wolf',text:'Secret plan',playerId:'wolf',sentAt:2000}];
  handlers.chat_state({permissions,messages});
  assert.equal(get('chat-input').disabled,true);
  assert.equal(get('chat-messages').children[0].children[0].textContent,'<img onerror=alert(1)> (bạn)');
  assert.equal(get('chat-messages').children[0].children[2].textContent,'<script>alert(1)</script>');
  get('chat-wolves').handlers.click();
  assert.equal(get('chat-input').disabled,false);
  assert.equal(get('chat-messages').children[0].children[2].textContent,'Secret plan');
  get('chat-input').value='Pack reply';
  get('chat-form').handlers.submit({preventDefault(){}});
  assert.equal(sent.channel,'wolves');assert.equal(sent.text,'Pack reply');
  assert.equal(get('chat-input').value,'');
  handlers.chat_state({permissions:{public:permissions.public,wolves:{canRead:false,canSend:false}},messages:[messages[0]]});
  assert.equal(get('chat-public').attrs['aria-pressed'],'true');
  assert.equal(get('chat-messages').children.length,1);
  assert.equal(get('chat-messages').children[0].children[2].textContent,messages[0].text);
});
