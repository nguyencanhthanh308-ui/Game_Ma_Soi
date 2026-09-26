const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { ROLE_INFO } = require('./roles');

test('real server deals all 16 roles privately, sends descriptions and restarts', {timeout:15000}, async t => {
  const child=spawn(process.execPath,['--preserve-symlinks','--preserve-symlinks-main','server/index.js'],{env:{...process.env,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const port=await new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{ const m=String(chunk).match(/localhost:(\d+)/); if(m)resolve(Number(m[1])); });
    child.on('error',reject);child.on('exit',code=>reject(Error('Server exit '+code)));
  });
  const catalog=await (await fetch(`http://localhost:${port}/api/roles`)).json();
  assert.equal(Object.keys(catalog).length,16);
  const clients=[];
  t.after(()=>clients.forEach(c=>c.ws.close()));
  async function connect() {
    const ws=new WebSocket(`ws://localhost:${port}/socket.io/?EIO=4&transport=websocket`);
    const c={ws,events:[],acks:new Map(),seq:0};clients.push(c);
    await new Promise((resolve,reject)=>{
      ws.on('error',reject);
      ws.on('message',raw=>{
        const msg=String(raw);
        if(msg.startsWith('0'))ws.send('40');
        else if(msg==='2')ws.send('3');
        else if(msg.startsWith('40'))resolve();
        else if(msg.startsWith('42'))c.events.push(JSON.parse(msg.slice(2)));
        else if(msg.startsWith('43')){const m=msg.match(/^43(\d+)(.*)$/);c.acks.get(Number(m[1]))?.(JSON.parse(m[2])[0]);}
      });
    });
    c.emit=(name,data)=>new Promise(resolve=>{const id=c.seq++;c.acks.set(id,resolve);ws.send('42'+id+JSON.stringify([name,data]));});
    return c;
  }
  let host=await connect();
  for (const [event, data] of [['create_room', null], ['create_room', {name:{}}], ['join_room', {name:'Bad',roomCode:42}], ['start_game', null], ['player_action', {type:'cupid_choose',payload:{targetIds:{}}}]]) {
    assert.equal((await host.emit(event, data)).ok, false);
  }
  const room=await host.emit('create_room',{name:'Host'});
  assert.equal((await host.emit('start_game',{roleConfig:{werewolf:{valueOf:null,toString:null},villager:1}})).ok,false);
  assert.ok((await host.emit('chat_send',{channel:'public',text:'Lobby hello'})).ok);
  for(let i=1;i<16;i++){const c=await connect();assert.ok((await c.emit('join_room',{roomCode:room.roomCode,name:'P'+i})).ok);}
  const roleConfig=Object.fromEntries(Object.keys(ROLE_INFO).map(id=>[id,1]));
  assert.ok((await host.emit('start_game',{roleConfig,durations:{NIGHT_CUPID:60}})).ok);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(host.events.filter(e=>e[0]==='game_state').at(-1)[1].phase,'ROLE_REVEAL');
  assert.equal(host.events.filter(e=>e[0]==='game_state').at(-1)[1].phaseEndsAt,null);
  for (const c of clients) c.ws.send('42'+JSON.stringify(['player_action',{type:'ready',payload:{}}]));
  await new Promise(resolve=>setTimeout(resolve,100));
  const assigned=[];
  for(const c of clients){
    const priv=c.events.filter(e=>e[0]==='private_state'&&e[1].role).at(-1)[1];
    assigned.push(priv.role.id);
    assert.equal(priv.role.desc,ROLE_INFO[priv.role.id].desc);assert.ok(priv.role.play&&priv.role.win);
    const state=c.events.filter(e=>e[0]==='game_state').at(-1)[1];assert.equal(state.phase,'NIGHT_CUPID');
    assert.ok(state.players.every(p=>!p.role));
    if(priv.role.id==='mason')assert.deepEqual(priv.allies,[]);
  }
  assert.equal(new Set(assigned).size,16);
  const roleOf=c=>c.events.filter(e=>e[0]==='private_state'&&e[1].role).at(-1)[1].role.id;
  const wolf=clients.find(c=>roleOf(c)==='werewolf');
  const villager=clients.find(c=>roleOf(c)==='villager');
  const wolfMessage='Private pack discussion';
  assert.equal((await villager.emit('chat_send',{channel:'wolves',text:'Sneaking in'})).ok,false);
  assert.equal((await villager.emit('chat_send',{channel:'public',text:'Night discussion'})).ok,false);
  assert.ok((await wolf.emit('chat_send',{channel:'wolves',text:wolfMessage})).ok);
  await new Promise(resolve=>setTimeout(resolve,100));
  for(const c of clients) {
    const chat=c.events.filter(e=>e[0]==='chat_state').at(-1)[1];
    const isWolf=['werewolf','wolfcub','whitewolf'].includes(roleOf(c));
    assert.equal(chat.messages.some(m=>m.text===wolfMessage),isWolf);
    assert.equal(chat.messages.some(m=>m.text==='Lobby hello'),false);
  }
  const outsider=await connect();
  assert.equal((await outsider.emit('chat_send',{channel:'wolves',text:'Outsider'})).ok,false);
  assert.ok((await outsider.emit('create_room',{name:'Other room'})).ok);
  assert.ok((await outsider.emit('chat_send',{channel:'public',text:'Separate room'})).ok);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(wolf.events.filter(e=>e[0]==='chat_state').at(-1)[1].messages.some(m=>m.text==='Separate room'),false);
  const privateOf = c => c.events.filter(e=>e[0]==='private_state').at(-1)[1];
  async function act(c, type, payload) {
    c.ws.send('42'+JSON.stringify(['player_action',{type,payload}]));
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const cupid = clients.find(c=>privateOf(c)?.role?.id==='cupid');
  await act(cupid,'cupid_choose',{targetIds:privateOf(cupid).prompt.targets.slice(0,2).map(p=>p.id)});
  const guard = clients.find(c=>privateOf(c)?.role?.id==='guard');
  await act(guard,'guard_protect',{});
  for (const c of clients.filter(c=>['werewolf','wolfcub','whitewolf'].includes(privateOf(c)?.role?.id))) {
    await act(c,'wolf_vote',{targetId:privateOf(c).prompt.targets[0].id});
  }
  const whitewolf = clients.find(c=>privateOf(c)?.role?.id==='whitewolf');
  await act(whitewolf,'whitewolf_kill',{});
  const seer = clients.find(c=>privateOf(c)?.role?.id==='seer');
  await act(seer,'seer_check',{targetId:privateOf(seer).prompt.targets[0].id});
  assert.equal(privateOf(seer).seerHistory.length,1);
  for (const c of clients.filter(c=>c!==seer && privateOf(c))) assert.deepEqual(privateOf(c).seerHistory,[]);
  await new Promise(resolve=>{host.ws.once('close',resolve);host.ws.close();});
  await new Promise(resolve=>setTimeout(resolve,100));
  const intruder=await connect();
  assert.equal((await intruder.emit('join_room',{roomCode:room.roomCode,name:'Host'})).ok,false);
  host=await connect();
  assert.ok((await host.emit('join_room',{roomCode:room.roomCode,name:'Host',sessionToken:room.sessionToken})).ok);
  const offline = clients[1];
  await new Promise(resolve=>{offline.ws.once('close',resolve);offline.ws.close();});
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok((await host.emit('restart_to_lobby',null)).ok);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(clients.filter(c=>c.ws.readyState===WebSocket.OPEN && c.events.some(e=>e[0]==='private_state')).every(c=>c.events.filter(e=>e[0]==='private_state').at(-1)[1].role===null));
  assert.equal(host.events.filter(e=>e[0]==='chat_state').at(-1)[1].messages.length,0);
  assert.deepEqual(privateOf(host).seerHistory,[]);
  assert.equal(host.events.filter(e=>e[0]==='game_state').at(-1)[1].players.length,15);
  const returning = await connect();
  assert.ok((await returning.emit('join_room',{roomCode:room.roomCode,name:'P1'})).ok);
  assert.equal((await host.emit('get_role_suggestion',null)).playerCount,16);
  // A separate room demonstrates bounded abuse without interfering with the game above.
  const spammer = await connect();
  const spamRoom = await spammer.emit('create_room',{name:'Rate test'});
  const observer = await connect();
  assert.ok((await observer.emit('join_room',{roomCode:spamRoom.roomCode,name:'Observer'})).ok);
  await new Promise(resolve=>setTimeout(resolve,30));
  const before = observer.events.filter(e=>e[0]==='game_state').length;
  for(let i=0;i<5;i++) spammer.ws.send('42'+JSON.stringify(['player_action',{type:'unknown',payload:{}}]));
  assert.ok((await spammer.emit('get_role_suggestion',null)).ok);
  for(let i=0;i<40;i++) spammer.ws.send('42'+JSON.stringify(['player_action',{type:'unknown',payload:{}}]));
  assert.equal((await spammer.emit('get_role_suggestion',null)).ok,false);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(observer.events.filter(e=>e[0]==='game_state').length,before);
  assert.ok((await spammer.emit('get_role_suggestion',null)).ok);
});
