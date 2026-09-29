const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROLE_INFO } = require('./roles');

function client() {
  const nodes = new Map(), events = {}, requests = [];
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(), handlers = {};
    const el = { id, textContent:'', children:[], disabled:false,
      set innerHTML(value) { this.children = []; }, get innerHTML() { return ''; },
      classList:{ add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c);} },
      append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},
      addEventListener(name,fn){handlers[name]=fn;},click(){if(!this.disabled)handlers.click?.();},
      querySelectorAll(){return this.children;},
    };
    nodes.set(id,el);return el;
  }
  const socket = {connected:true,on:(name,fn)=>{events[name]=fn;},emit(){},timeout(){return {emit:(event,data,ack)=>requests.push({event,data,ack})};}};
  const context = vm.createContext({window:{},io:()=>socket,
    document:{getElementById:element,createElement:()=>element(Symbol()),querySelectorAll:()=>[],querySelector:()=>element('screen-game')},
    fetch:async()=>({ok:true,json:async()=>ROLE_INFO}),location:{search:''},URLSearchParams,
    sessionStorage:{getItem(){return null;},setItem(){}},history:{replaceState(){}},
    setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context);
  const run = code => vm.runInContext(code,context);
  run("state.playerId='wolf';state.hasSeenReveal=true");
  function update(version=1,submitted=false) {
    events.game_state({phase:'NIGHT_WOLVES',actionVersion:version,actionRound:version,players:[{id:'wolf',alive:true}],readyPlayers:[],hostId:'wolf'});
    events.private_state({actionVersion:version,submitted,role:ROLE_INFO.werewolf,prompt:{action:'wolf_vote',targets:[{id:'a',name:'An'},{id:'b',name:'Binh'}]}});
  }
  update();
  return {nodes,requests,run,update,select:()=>nodes.get('action-area').children[0].children[0].click()};
}

test('selection survives unrelated snapshots; rejection and acknowledgement timeout allow retry', () => {
  const c = client();c.select();c.update();
  assert.equal(c.run('state.selected[0]'),'a');
  assert.equal(c.nodes.get('action-area').children[0].children[0].classList.contains('selected'),true);
  c.run("send('wolf_vote',{targetId:'a'})");
  assert.equal(c.run('state.submittedForPhase'),null);
  assert.match(c.nodes.get('action-area').children[0].textContent,/Đang gửi/);
  c.requests[0].ack(null,{ok:false,error:'Mục tiêu không hợp lệ'});
  assert.equal(c.run('state.pendingAction'),null);assert.equal(c.run('state.selected[0]'),'a');
  assert.match(c.nodes.get('toast').textContent,/không hợp lệ/);
  c.run("send('wolf_vote',{targetId:'a'})");
  c.requests[1].ack(new Error('timeout'));
  assert.equal(c.run('state.submittedForPhase'),null);assert.equal(c.run('state.selected[0]'),'a');
  c.run("send('wolf_vote',{targetId:'a'})");
  c.requests[2].ack(null,{ok:true});
  assert.match(c.nodes.get('action-area').children[0].textContent,/Server đã nhận/);
});

test('late acknowledgements cannot lock a new round; accepted server snapshots restore submitted state', () => {
  const c = client();c.select();c.run("send('wolf_vote',{targetId:'a'})");
  c.update(2);c.select();c.run("send('wolf_vote',{targetId:'a'})");
  c.requests[0].ack(null,{ok:true});
  assert.equal(c.run('state.pendingAction.version'),2);
  assert.equal(c.run('state.submittedForPhase'),null);
  c.update(2,true);
  c.requests[1].ack(new Error('ack lost'));
  assert.equal(c.run('state.submittedForPhase'),2);
  assert.match(c.nodes.get('action-area').children[0].textContent,/Server đã nhận/);
});
