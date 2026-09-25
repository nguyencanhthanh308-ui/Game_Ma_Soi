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
  const host=await connect();const room=await host.emit('create_room',{name:'Host'});
  for(let i=1;i<16;i++){const c=await connect();assert.ok((await c.emit('join_room',{roomCode:room.roomCode,name:'P'+i})).ok);}
  const roleConfig=Object.fromEntries(Object.keys(ROLE_INFO).map(id=>[id,1]));
  assert.ok((await host.emit('start_game',{roleConfig,durations:{NIGHT_CUPID:60}})).ok);
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
  assert.ok((await host.emit('restart_to_lobby',null)).ok);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(clients.every(c=>c.events.filter(e=>e[0]==='private_state').at(-1)[1].role===null));
});
