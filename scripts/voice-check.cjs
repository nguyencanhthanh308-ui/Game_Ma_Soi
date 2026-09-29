// Optional local browser smoke check. Uses installed Edge and the project's ws dependency.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const WS=require('ws');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'masoi-pixel-'));
  const server=spawn(process.execPath,['server/index.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:'0'},windowsHide:true});
  let browser,ws;
  const watchdog=setTimeout(()=>{console.error('Browser smoke check timed out');server.kill();browser?.kill();process.exitCode=1;},180000);
  try {
    const port=await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{const m=String(d).match(/localhost:(\d+)/);if(m)resolve(m[1]);});server.on('error',reject);server.on('exit',c=>reject(Error('Server exited '+c)));});
    browser=spawn(process.env.EDGE_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--no-first-run','--remote-debugging-port=0','--user-data-dir='+path.join(dir,'profile'),'about:blank'],{windowsHide:true});
    const endpoint=await new Promise((resolve,reject)=>{browser.stderr.on('data',d=>{const m=String(d).match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});browser.on('error',reject);browser.on('exit',c=>reject(Error('Browser exited '+c)));});
    ws=new WS(endpoint);await new Promise(r=>ws.once('open',r));
    let seq=0;const pending=new Map();const exceptions=[];
    ws.on('message',d=>{const m=JSON.parse(d);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
    const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
    async function page() {
      const {targetId}=await call('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
      const c=(method,params)=>call(method,params,sessionId);
      const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
      await c('Page.enable');await c('Runtime.enable');await c('Page.addScriptToEvaluateOnNewDocument',{source:'window.__rtcPeers=[];const NativePC=window.RTCPeerConnection;window.RTCPeerConnection=class extends NativePC{constructor(...args){super(...args);window.__rtcPeers.push(this);}};'});await c('Page.navigate',{url:'http://localhost:'+port});
      let ready=false;
      for(let i=0;i<300;i++) {if(await evaluate("typeof state !== 'undefined' && socket.connected && Object.keys(roleCatalog).length === 16")){ready=true;break;}await pause(100);}
      assert.ok(ready,'Page must load the socket and all 16 role definitions');
      return {c,evaluate};
    }
    async function snapshot(p,name,width,height=900) {
      await p.c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await pause(150);
      const dimensions=await p.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
      assert.ok(dimensions.scroll<=dimensions.width,`${name} overflows at ${width}px`);
      const shot=await p.c('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(dir,name+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      console.log(name,width,dimensions);
    }

    const host=await page();
    await host.evaluate("$('create-name').value='Host';$('btn-create').click()");await pause(100);
    const code=await host.evaluate('state.roomCode');assert.ok(code);
    const pages=[host];
    for(let i=1;i<9;i++){
      const p=await page();pages.push(p);
      assert.ok(await p.evaluate('new Promise(resolve=>socket.emit("join_room",{roomCode:'+JSON.stringify(code)+',name:"P'+i+'"},res=>{if(res.ok)onJoinedRoom(res.roomCode,res.playerId,"P'+i+'",false,res.sessionToken);resolve(res.ok)}))'));
    }
    async function until(check,label){for(let i=0;i<150;i++){if(await check())return;await pause(200);}throw Error(label);}
    const connected=p=>p.evaluate('__rtcPeers.filter(p=>p.connectionState==="connected").length');
    await until(async()=> (await Promise.all(pages.map(connected))).every(n=>n===8),'All 9 browsers must connect to 8 peers');
    const counts=await Promise.all(pages.map(p=>p.evaluate('__rtcPeers.length')));
    await host.c('Page.bringToFront');
    await host.evaluate("$('btn-toggle-mic').click()");
    await until(()=>host.evaluate('__rtcPeers.some(p=>p.getSenders().some(s=>s.track?.readyState==="live"))'),'Microphone permission');
    const incoming=p=>p.evaluate('(async()=>{let bytes=0;for(const pc of __rtcPeers){for(const s of (await pc.getStats()).values())if(s.type==="inbound-rtp"&&s.kind==="audio")bytes+=s.bytesReceived||0;}return bytes;})()');
    await until(async()=> (await Promise.all(pages.slice(1).map(incoming))).every(n=>n>0),'All 8 listeners receive RTP with microphone off');
    for(const p of pages.slice(1))assert.equal(await p.evaluate('__rtcPeers.some(p=>p.getSenders().some(s=>s.track))'),false);
    await host.evaluate("$('btn-toggle-mic').click()");await pause(300);
    assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate('__rtcPeers.length'))),counts,'Mic toggling must not recreate any connections');
    await host.evaluate("$('btn-toggle-mic').click()");await pause(500);
    const listener=pages[1];const oldId=await listener.evaluate('state.playerId');
    await listener.evaluate('socket.disconnect();socket.connect();void 0');
    await until(()=>listener.evaluate('socket.connected && state.playerId==='+JSON.stringify(oldId)+' && state.lastGameState.players.filter(p=>p.connected).length===9'),'Lobby reconnect keeps player identity');
    await until(()=>connected(listener).then(n=>n===8),'Listener voice reconnect');
    assert.equal(await host.evaluate('state.lastGameState.players.length'),9);
    for(const p of pages.slice(1))await p.evaluate("$('btn-toggle-mic').click()");
    const sources=p=>p.evaluate('(async()=>{let count=0;for(const pc of __rtcPeers.filter(p=>p.connectionState==="connected")){for(const s of (await pc.getStats()).values())if(s.type==="inbound-rtp"&&s.kind==="audio"&&s.bytesReceived>0)count++;}return count;})()');
    await until(async()=> (await Promise.all(pages.map(sources))).every(n=>n===8),'All 9 microphones send to all 8 peers');
    assert.ok(await host.evaluate('new Promise(resolve=>socket.emit("start_game",{roleConfig:{werewolf:3,villager:6},durations:{NIGHT_WOLVES:60}},res=>resolve(res.ok)))'));
    await until(async()=> (await Promise.all(pages.map(p=>p.evaluate('state.lastGameState.phase==="ROLE_REVEAL" && !!state.lastPrivate?.role')))).every(Boolean),'All players receive role cards before night starts');
    for(const p of pages.slice(0,8))await p.evaluate("$('btn-continue').click()");
    await until(()=>host.evaluate('state.lastGameState.readyPlayers.length===8'),'Eight players ready');
    assert.equal(await host.evaluate('state.lastGameState.phaseEndsAt'),null);
    assert.equal(await host.evaluate('state.lastGameState.phase'),'ROLE_REVEAL');
    await pages[8].evaluate("$('btn-continue').click()");
    await until(async()=> (await Promise.all(pages.map(p=>p.evaluate('state.lastGameState.phase==="NIGHT_WOLVES" && !!state.lastPrivate?.role && __rtcPeers.filter(p=>p.connectionState==="connected").length===(state.lastPrivate.role.id==="werewolf"?2:0)')))).every(Boolean),'Night separates wolf voice from villagers');
    for(const p of pages){
      if(await p.evaluate('state.lastPrivate.role.id==="werewolf"'))await until(()=>sources(p).then(n=>n===2),'Wolves continue receiving audio at night');
    }
    const wolves=[];
    for(const p of pages)if(await p.evaluate('state.lastPrivate.role.id==="werewolf"'))wolves.push(p);
    const actor=wolves[0];
    await actor.evaluate("document.querySelector('.target-btn').click()");
    const selected=await actor.evaluate('state.selected[0]');
    await actor.evaluate("send('wolf_vote',{targetId:state.playerId})");
    await until(()=>actor.evaluate('state.pendingAction===null'),'Rejected action becomes retryable');
    assert.equal(await actor.evaluate('state.submittedForPhase'),null);
    assert.equal(await actor.evaluate('state.selected[0]'),selected);
    await wolves[1].evaluate('send("wolf_vote",{targetId:'+JSON.stringify(selected)+'})');
    await until(()=>wolves[1].evaluate('state.submittedForPhase===state.lastGameState.actionVersion'),'Accepted action confirmed');
    assert.equal(await actor.evaluate('state.selected[0]'),selected,'Another player voting must not clear the current selection');
    await actor.evaluate('send("wolf_vote",{targetId:'+JSON.stringify(selected)+'})');
    await until(()=>actor.evaluate('state.submittedForPhase===state.lastGameState.actionVersion'),'Retry after rejection succeeds');
    assert.ok(await host.evaluate('new Promise(resolve=>socket.emit("restart_to_lobby",null,res=>resolve(res.ok)))'));
    await until(async()=> (await Promise.all(pages.map(sources))).every(n=>n===8),'All 9 microphones reconnect after leaving the private night channels');
    assert.equal(exceptions.length,0,JSON.stringify(exceptions));
    console.log('PASS: 9 browser tabs; readiness blocks night until all 9 confirm; rejected actions are retryable and selections survive updates; 36 voice links, mic-off reception, reconnect and night channel isolation.');
    await call('Browser.close');
  } finally {clearTimeout(watchdog);ws?.close();browser?.kill();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
