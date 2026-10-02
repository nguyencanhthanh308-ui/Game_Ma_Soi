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
    browser=spawn(process.env.EDGE_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+path.join(dir,'profile'),'about:blank'],{windowsHide:true});
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
      await c('Page.enable');await c('Runtime.enable');await c('Page.navigate',{url:'http://localhost:'+port});
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
    for(const width of [320,390,1366]) await snapshot(host,'home',width,width<500?1400:960);
    await host.evaluate("$('create-name').value='An';$('btn-create').click()");await pause(150);
    const code=await host.evaluate('state.roomCode');assert.ok(code);
    const pages=[host];
    for(const name of ['Bình','Chi']){
      const p=await page();pages.push(p);
      await p.evaluate(`new Promise(resolve=>socket.emit('join_room',{roomCode:${JSON.stringify(code)},name:${JSON.stringify(name)}},res=>{if(res.ok)onJoinedRoom(res.roomCode,res.playerId,${JSON.stringify(name)},false,res.sessionToken);resolve(res.ok)}))`);
    }
    await pause(200);
    for(const width of [320,390,1366])await snapshot(host,'lobby',width);
    await host.evaluate("$('btn-start').click()");await pause(150);
    for(const width of [390,1366])await snapshot(host,'reveal',width);
    for(const p of pages)await p.evaluate("$('btn-continue').click()");await pause(200);
    assert.equal(await host.evaluate('state.lastGameState.phase'),'NIGHT_WOLVES');
    for(const width of [320,390,1366])await snapshot(host,'game',width);
    let wolf;
    for(const p of pages)if(await p.evaluate("state.lastPrivate.role.id === 'werewolf'"))wolf=p;
    await wolf.evaluate("document.querySelector('.target-btn').click();document.querySelector('#action-area > .btn-primary').click()");await pause(200);
    // Moi pha deu chay het dong ho moi chuyen, khong con chot som khi ai cung bam xong.
    // Nen o day cu bam het cac luot roi CHO den khi troi sang, thay vi doi doi ngay.
    // Phong 3 nguoi mac dinh co ca Tien tri, nen dem con luot sau luot Soi.
    const hetDem=Date.now()+150000;
    let phase=await host.evaluate('state.lastGameState.phase');
    while(String(phase).startsWith('NIGHT_')&&Date.now()<hetDem){
      for(const p of pages)if(await p.evaluate("!!document.querySelector('.target-btn')"))
        await p.evaluate("document.querySelector('.target-btn').click();document.querySelector('#action-area > .btn-primary').click()");
      await pause(1000);
      phase=await host.evaluate('state.lastGameState.phase');
    }
    assert.match(phase,/^(DAY_|HUNTER_SHOT|GAME_OVER)/,'het dem phai sang ngay, dang o '+phase);
    await snapshot(host,'day',1366);
    const preview=await page();
    await preview.c('Page.bringToFront');
    await preview.evaluate(`(async () => {
      for(const role of Object.values(roleCatalog)) {
        window.villageArt.role(role);
        const image=new Image();image.src='/assets/roles/'+role.id+'-retro.png';
        await image.decode();
        await new Promise(resolve=>setTimeout(resolve,30));
        window.villageArt.role(role);
        if($('role-portrait').width!==512) throw Error('Artwork not rendered: '+role.id);
      }
    })()`);
    await preview.evaluate("showReveal({role:roleCatalog.seer})");
    await pause(200);
    const frameA=await preview.evaluate("$('role-portrait').toDataURL()");
    await pause(450);
    const frameB=await preview.evaluate("$('role-portrait').toDataURL()");
    assert.equal(frameA,frameB,'Role artwork remains static');
    await snapshot(preview,'seer',390);
    for(const role of ['werewolf','wolfcub','whitewolf']) {
      await preview.evaluate(`showReveal({role:roleCatalog[${JSON.stringify(role)}]})`);
      await snapshot(preview,role,390);
    }
    await preview.c('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await pause(150);
    const stillA=await preview.evaluate("$('role-portrait').toDataURL()");
    await pause(450);
    assert.equal(await preview.evaluate("$('role-portrait').toDataURL()"),stillA,'Reduced motion must freeze the portrait');
    const sheet=await preview.evaluate(`(() => {
      const sheet=document.createElement('canvas');sheet.width=576;sheet.height=576;const ctx=sheet.getContext('2d');
      ctx.fillStyle='#0b1417';ctx.fillRect(0,0,576,576);ctx.imageSmoothingEnabled=false;
      Object.values(roleCatalog).forEach((role,i)=>{window.villageArt.role(role);ctx.drawImage($('role-portrait'),i%4*144,Math.floor(i/4)*144,144,120);ctx.font='12px sans-serif';ctx.fillStyle='#ece8d9';ctx.fillText(role.name,i%4*144+5,Math.floor(i/4)*144+136);});
      return sheet.toDataURL().split(',')[1];
    })()`);
    fs.writeFileSync(path.join(dir,'all-role-portraits.png'),Buffer.from(sheet,'base64'));
    assert.equal(exceptions.length,0,JSON.stringify(exceptions));
    console.log('PASS: game flow, all 16 role assets loaded and rendered, reduced motion; no browser exceptions. Screenshots:',dir);
    await call('Browser.close');
  } finally {clearTimeout(watchdog);ws?.close();browser?.kill();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
