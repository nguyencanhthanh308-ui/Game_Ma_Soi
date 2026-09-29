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
  let host=await connect();const room=await host.emit('create_room',{name:'Host'});
  assert.ok((await host.emit('chat_send',{channel:'public',text:'Lobby hello'})).ok);
  for(let i=1;i<16;i++){const c=await connect();assert.ok((await c.emit('join_room',{roomCode:room.roomCode,name:'P'+i})).ok);}
  const roleConfig=Object.fromEntries(Object.keys(ROLE_INFO).map(id=>[id,1]));
  assert.equal((await clients[1].emit('set_role_config',roleConfig)).ok,false);
  assert.ok((await host.emit('set_role_config',roleConfig)).ok);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.deepEqual(clients[1].events.filter(e=>e[0]==='role_config').at(-1)[1],roleConfig);
  assert.ok((await host.emit('start_game',{roleConfig,durations:{NIGHT_CUPID:60}})).ok);
  await new Promise(resolve=>setTimeout(resolve,100));
  for (const c of clients) {
    const gs=c.events.filter(e=>e[0]==='game_state').at(-1)[1];
    assert.equal(gs.phase,'ROLE_REVEAL');assert.equal(gs.phaseEndsAt,null);
    assert.ok((await c.emit('player_action',{type:'ready',payload:{},actionVersion:gs.actionVersion})).ok);
  }
  await new Promise(resolve=>setTimeout(resolve,50));
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
  const audio={mime:'audio/webm',base64:Buffer.from('test voice').toString('base64')};
  assert.ok((await wolf.emit('chat_send',{channel:'wolves',audio})).ok);
  await new Promise(resolve=>setTimeout(resolve,100));
  const audioMessage=wolf.events.filter(e=>e[0]==='chat_state').at(-1)[1].messages.find(m=>m.audio);
  assert.ok(audioMessage);
  assert.equal(audioMessage.audio.base64,undefined);
  assert.equal((await villager.emit('chat_audio',audioMessage.id)).ok,false);
  assert.deepEqual((await wolf.emit('chat_audio',audioMessage.id)).audio,audio);
  await new Promise(resolve=>setTimeout(resolve,800));
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
  await new Promise(resolve=>{host.ws.once('close',resolve);host.ws.close();});
  await new Promise(resolve=>setTimeout(resolve,100));
  const intruder=await connect();
  assert.equal((await intruder.emit('join_room',{roomCode:room.roomCode,name:'Host'})).ok,false);
  host=await connect();
  assert.ok((await host.emit('join_room',{roomCode:room.roomCode,name:'Host',sessionToken:room.sessionToken})).ok);
  assert.ok((await host.emit('restart_to_lobby',null)).ok);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(clients.filter(c=>c.ws.readyState===WebSocket.OPEN && c.events.some(e=>e[0]==='private_state')).every(c=>c.events.filter(e=>e[0]==='private_state').at(-1)[1].role===null));
  assert.equal(host.events.filter(e=>e[0]==='chat_state').at(-1)[1].messages.length,0);

  // A reconnect can arrive before the server has detected the old connection's loss.
  const oldHost=host;
  host=await connect();
  const restored=await host.emit('join_room',{roomCode:room.roomCode,name:'Host',sessionToken:room.sessionToken});
  assert.ok(restored.ok);
  assert.equal(restored.playerId,room.playerId);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.notEqual(oldHost.ws.readyState,WebSocket.OPEN);
  assert.equal(host.events.filter(e=>e[0]==='game_state').at(-1)[1].players.length,16);

  // Network loss in the lobby must preserve the seat and host identity.
  await new Promise(resolve=>{host.ws.once('close',resolve);host.ws.close();});
  host=await connect();
  assert.equal((await host.emit('join_room',{roomCode:room.roomCode,name:'Host',sessionToken:room.sessionToken})).playerId,room.playerId);
  for(const event of ['create_room','join_room','start_game','player_action','voice_signal']){
    assert.equal((await host.emit(event,null)).ok,false,event+' rejects malformed payload');
  }
  assert.equal((await host.emit('join_room',{roomCode:[],name:'Bad'})).ok,false);
  assert.ok((await host.emit('get_role_suggestion',null)).ok,'server still responds after invalid packets');
  for (const payload of [{targetIds:{}},{targetIds:['a',{}]},{targetIds:'ab'}]) {
    const version=host.events.filter(e=>e[0]==='game_state').at(-1)[1].actionVersion;
    assert.equal((await host.emit('player_action',{type:'cupid_choose',payload,actionVersion:version})).ok,false);
  }
  assert.equal((await host.emit('start_game',{roleConfig,durations:{NIGHT_WOLVES:{toString:null}}})).ok,false);
  const spammer=await connect();
  const burst=await Promise.all(Array.from({length:100},()=>spammer.emit('get_role_suggestion',null)));
  assert.ok(burst.some(r=>r.error?.includes('quá nhanh')));
  assert.ok((await host.emit('get_role_suggestion',null)).ok,'rate limiting another socket does not eject the room');
  assert.ok((await host.emit('start_game',{roleConfig})).ok);
  await new Promise(resolve=>setTimeout(resolve,50));
  const revealVersion=host.events.filter(e=>e[0]==='game_state').at(-1)[1].actionVersion;
  assert.ok((await host.emit('player_action',{type:'ready',payload:{},actionVersion:revealVersion})).ok);
  await new Promise(resolve=>{clients[1].ws.once('close',resolve);clients[1].ws.close();});
  assert.ok((await host.emit('restart_to_lobby',null)).ok,'host can cancel while a reader is disconnected');
  await new Promise(resolve=>setTimeout(resolve,50));
  const lobby=host.events.filter(e=>e[0]==='game_state').at(-1)[1];
  assert.equal(lobby.phase,'LOBBY');assert.equal(lobby.players.length,15);
  assert.deepEqual(lobby.readyPlayers,[]);
  assert.equal((await host.emit('player_action',{type:'ready',payload:{},actionVersion:revealVersion})).ok,false);
  assert.equal((await host.emit('get_role_suggestion',null)).playerCount,15);
});
