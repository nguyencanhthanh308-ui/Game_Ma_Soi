// Original, code-drawn pixel art. No remote assets or game-role data on public scenery.
(() => {
  const canvases = [...document.querySelectorAll('.village-canvas')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let game = null;
  let lastFrame = 0;
  let currentRole = null;
  let animationFrame = null;
  let revealAnimation = null;
  let phaseAnimation = null;
  const random = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function rect(ctx, color, x, y, w, h) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function poly(ctx, color, points) {
    ctx.fillStyle = color;
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.fill();
  }
  function pine(ctx, x, y, size, color, light) {
    rect(ctx, '#243631', x - size * .06, y - size * .5, size * .12, size * .6);
    for (let k = 0; k < 4; k++) {
      const top = y - size + k * size * .17;
      const spread = size * (.16 + k * .07);
      // Stepped branches rather than smooth triangles.
      for (let j = 0; j < 5; j++) {
        const width = spread * (j + 1) / 5;
        rect(ctx, color, x - width, top + j * size * .048, width * 2, size * .05 + 1);
        if (light) rect(ctx, light, x - width, top + j * size * .048, Math.max(2, width * .35), 2);
      }
    }
  }
  function house(ctx, x, y, scale, time, variant) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    poly(ctx, '#091719', [[-9,43],[63,43],[83,54],[10,55]]);
    rect(ctx, '#715749', 0, 0, 48, 42);
    rect(ctx, '#493e37', 48, 0, 18, 42);
    for (let i=0;i<7;i++) rect(ctx, '#564438', 0, i*6, 48, 1);
    rect(ctx, '#9a7854', 0, 0, 3, 42); rect(ctx, '#392f2a', 43, 0, 5, 42);
    poly(ctx, '#243938', [[-9,4],[22,-26],[53,4]]);
    poly(ctx, '#172829', [[22,-26],[39,-27],[75,4],[53,4]]);
    for(let row=0;row<6;row++) {
      const half=5+row*5;
      rect(ctx,row%2 ? '#3f5550':'#374c47',22-half,-23+row*5,half*2,3);
    }
    rect(ctx, '#75917b', -8, 3, 63, 3);
    rect(ctx, '#23312c', 49, 6, 21, 3);
    rect(ctx, '#242b28', 19, 17, 14, 25); rect(ctx, '#414037', 21, 19, 10, 23);
    rect(ctx, '#d9b775', 28, 29, 2, 2);
    for(const wx of [5,35]) {
      rect(ctx, '#201f20', wx-1, 12, 10, 13);
      rect(ctx, Math.sin(time*2+variant)>0 ? '#edc475':'#dca85f', wx, 13, 8, 10);
      rect(ctx, '#67482c', wx+3, 13, 2, 10); rect(ctx, '#67482c', wx, 17, 8, 2);
      rect(ctx, '#99714c', wx-2, 25, 12, 2);
    }
    rect(ctx, '#745e4d', 47, -24, 7, 18); rect(ctx, '#ad8d6b', 45, -26, 11, 3);
    for(let i=0;i<3;i++) {
      const drift=(time*5+i*9)%28;
      ctx.globalAlpha=.18*(1-drift/30);
      rect(ctx,'#c4c8b0',48+Math.sin(drift/6)*3,-30-drift,6+drift/3,4);
    }
    ctx.restore();
  }
  function person(ctx, x, y, coat, face, wolf=false) {
    rect(ctx, '#071013', x-5,y+9,13,3);
    rect(ctx, '#17202a', x-3,y+4,3,6); rect(ctx,'#17202a',x+2,y+4,3,6);
    rect(ctx,coat,x-4,y-4,10,10); rect(ctx,coat,x-6,y-2,2,6);
    rect(ctx,'#bdb094',x+6,y-2,2,5);
    rect(ctx,wolf?'#78908f':face,x-3,y-12,8,8);
    rect(ctx,wolf?'#415b60':'#473834',x-4,y-14,10,4);
    if(wolf) { rect(ctx,'#78908f',x-4,y-17,3,5); rect(ctx,'#78908f',x+3,y-17,3,5); }
    rect(ctx,wolf?'#efbb69':'#282c2d',x-1,y-8,1,2); rect(ctx,wolf?'#efbb69':'#282c2d',x+3,y-8,1,2);
    rect(ctx,'#dab575',x-3,y+3,9,1);
  }
  function paint(canvas, time) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const home = canvas.closest('#screen-home');
    const day = !home && game && game.phase.startsWith('DAY_');
    ctx.imageSmoothingEnabled=false;
    rect(ctx,day?'#718e89':'#0c1e2a',0,0,480,280);
    rect(ctx,day?'#8caaa0':'#132b36',0,65,480,80);
    for(let i=0;i<58;i++) {
      const alpha=.25+random(i+30)*.6;
      ctx.globalAlpha=day?.12:alpha;
      rect(ctx,'#d1dec5',random(i)*480,random(i+8)*100,i%7===0?2:1,1);
    }
    ctx.globalAlpha=1;
    for(let y=-20;y<=20;y+=2) {
      const w=Math.floor(Math.sqrt(400-y*y));
      rect(ctx,day?'#eee2ad':'#d8dfba',371-w,44+y,w*2,2);
    }
    rect(ctx,day?'#e5d799':'#abbfac',361,34,6,6); rect(ctx,day?'#e5d799':'#bdcdb1',375,48,9,4);
    poly(ctx,day?'#668d82':'#1e4046',[[0,131],[0,98],[48,65],[105,114],[164,55],[236,129],[306,86],[366,117],[422,66],[480,102],[480,150]]);
    poly(ctx,day?'#547c70':'#193a3e',[[0,142],[64,101],[142,140],[222,82],[304,137],[388,91],[480,149]]);
    for(let i=0;i<28;i++) pine(ctx,i*19-10,157+random(i+9)*12,48+random(i+15)*42,day?'#355d50':'#112d30');
    poly(ctx,day?'#496a4c':'#253f34',[[0,183],[64,164],[136,148],[231,161],[320,150],[405,178],[480,162],[480,280],[0,280]]);
    poly(ctx,day?'#627950':'#38523d',[[55,217],[146,165],[257,181],[349,164],[439,223],[400,280],[82,280]]);
    poly(ctx,day?'#8b805d':'#5b5b42',[[240,173],[253,173],[259,209],[336,231],[343,242],[249,223],[187,252],[167,280],[136,280],[170,238],[231,206]]);
    for(let i=0;i<270;i++) {
      const x=random(i+70)*480,y=170+random(i+500)*110;
      rect(ctx,i%3===0?'#6b7450':day?'#536d46':'#294533',x,y,2+random(i+8)*3,1);
    }
    house(ctx,112,146,.72,time,0); house(ctx,300,146,.78,time,1);
    house(ctx,56,192,.95,time,2); house(ctx,358,197,.92,time,3);
    // Campfire at the heart of the composition.
    ctx.globalAlpha=.09;
    for(let i=4;i>0;i--) {ctx.fillStyle='#f6b35c';ctx.beginPath();ctx.ellipse(249,225,i*13,i*6,0,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
    const coats=['#aa795b','#638b8e','#a4986b','#a56158','#718365','#7a7797','#698699','#ac855c'];
    const players=home||!game ? Array.from({length:7},(_,i)=>({alive:true,id:String(i)})) : game.players;
    players.slice(0,20).forEach((p,i)=>{
      const angle=i/Math.max(players.length,1)*Math.PI*2;
      const x=248+Math.cos(angle)*53,y=218+Math.sin(angle)*23;
      if(!p.alive) {rect(ctx,'#667370',x-3,y-7,7,11);rect(ctx,'#919d8b',x-2,y-8,5,2);return;}
      ctx.globalAlpha=p.connected===false?.45:1;
      person(ctx,Math.round(x),Math.round(y),coats[i%coats.length],'#cead84');
      ctx.globalAlpha=1;
    });
    rect(ctx,'#493629',238,228,23,4);rect(ctx,'#a37546',241,227,17,2);
    for(let i=0;i<5;i++) {
      const height=10+Math.sin(time*8+i*2)*4;
      rect(ctx,i%2?'#ed9c43':'#ce6838',241+i*3,225-height,4,height);
    }
    rect(ctx,'#f6d384',247,215,5,11);
    for(let i=0;i<5;i++){const rise=(time*12+i*7)%35;rect(ctx,'#dcb463',246+Math.sin(i+rise)*7,212-rise,1,2);}
    // Foreground trees give the village a framed, diorama-like depth.
    pine(ctx,19,258,128,day?'#224b3c':'#0c2427','#25423a');
    pine(ctx,466,267,143,day?'#214939':'#0a2023','#243f36');
    pine(ctx,440,291,94,'#0a2023'); pine(ctx,48,300,93,'#10292a');
    for(let i=0;i<12;i++) {
      ctx.globalAlpha=.2+.3*Math.sin(time+i);
      rect(ctx,'#e1c97d',70+random(i+1)*330,175+random(i+10)*80,2,2);
    }
    ctx.globalAlpha=1;
  }
  function portrait(role, time=0) {
    const canvas=document.getElementById('role-portrait');
    const ctx=canvas?.getContext('2d');
    if(!ctx || !role) return;
    rect(ctx,'#152a2c',0,0,96,96);
    for(let i=0;i<20;i++) rect(ctx,'#304843',random(i)*96,random(i+12)*96,2,2);
    const id=role.id;
    const wolf=['werewolf','wolfcub','whitewolf'].includes(id);
    const palettes={werewolf:['#587278','#ecac62'],wolfcub:['#8d7965','#efc78b'],whitewolf:['#c4d8d7','#cbeaf4'],seer:['#8b7d9d','#c5a0eb'],witch:['#628168','#a7d783'],guard:['#658c99','#a6d5dd'],hunter:['#7f8760','#d1bc85'],cupid:['#b97888','#f1a6b7'],lycan:['#85777e','#afb6d6'],cursed:['#6f5969','#cf8299'],elder:['#83916a','#c0d392'],toughguy:['#a07d62','#e5be8b'],prince:['#8d718c','#f0d18a'],tanner:['#977367','#d8b698'],mason:['#6a8b9a','#b0d2dd'],villager:['#b19860','#e7c88b']};
    const [coat,accent]=palettes[id]||palettes.villager;
    // Slow particles and a dim aura, never rapid flashing.
    ctx.globalAlpha=.08;
    ctx.fillStyle=accent;ctx.beginPath();ctx.ellipse(48,47,30+Math.sin(time)*2,33,0,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;
    for(let i=0;i<8;i++) {
      const rise=(time*6+i*13)%78;
      ctx.globalAlpha=.25+Math.sin(i+time)*.15;
      rect(ctx,accent,12+random(i+45)*72,87-rise,2,i%2?2:3);
    }
    ctx.globalAlpha=1;
    const bob=Math.sin(time*2)>0?1:0;
    ctx.save(); ctx.translate(47,65-bob); ctx.scale(id==='wolfcub'?2.6:3,id==='wolfcub'?2.6:3);
    person(ctx,0,0,coat,'#d4b58f',wolf);
    // Blink once every few seconds; eyes never flash on/off repeatedly.
    if(time%4.8>4.58) rect(ctx,wolf?'#78908f':'#d4b58f',-1,-8,5,2);
    if(id==='whitewolf') {rect(ctx,'#c4d8d7',-3,-12,8,4);rect(ctx,'#e9f3eb',-4,-17,3,5);rect(ctx,'#e9f3eb',3,-17,3,5);}
    if(id==='seer'||id==='witch') {poly(ctx,id==='witch'?'#466951':'#857797',[[-6,-13],[0,-23],[7,-13]]);rect(ctx,accent,-7,-13,15,2);}
    if(id==='seer') {
      rect(ctx,'#626c9d',7,-3,7,7);rect(ctx,accent,8,-2,5,5);rect(ctx,'#ece0ff',9,-1,2,2);rect(ctx,'#ab965b',6,4,9,2);
      rect(ctx,accent,10,-8-Math.round(Math.sin(time)*2),1,3);rect(ctx,accent,9,-7-Math.round(Math.sin(time)*2),3,1);
    } else if(id==='witch') {
      rect(ctx,'#99bbb2',8,-2,7,8);rect(ctx,'#adcd86',9,1,5,4);rect(ctx,'#9c795c',10,-5,3,3);
      for(let i=0;i<3;i++){const drift=(time*3+i*4)%12;ctx.globalAlpha=(1-drift/12)*.65;rect(ctx,accent,10+Math.sin(drift)*2,-6-drift,2,2);}ctx.globalAlpha=1;
    } else if(id==='guard') {
      poly(ctx,'#405564',[[5,-5],[14,-5],[14,2],[9,7],[5,2]]);poly(ctx,accent,[[6,-4],[12,-4],[12,1],[9,4],[6,1]]);rect(ctx,'#648b97',9,-4,1,7);
    } else if(id==='hunter') {
      poly(ctx,'#b79661',[[8,-12],[13,-8],[15,-2],[13,4],[8,8],[10,3],[12,-2],[10,-7]]);rect(ctx,'#dfd6af',8,-12,1,20);rect(ctx,'#c6b898',4,-2,13,1);
    } else if(id==='cupid') {
      poly(ctx,'#efc3bf',[[-6,-3],[-13,-10],[-15,-3],[-9,4],[-6,3]]);
      const hy=-17-Math.round(Math.sin(time*2)*2);rect(ctx,accent,8,hy,3,3);rect(ctx,accent,12,hy,3,3);rect(ctx,accent,9,hy+3,5,2);rect(ctx,accent,10,hy+5,3,2);rect(ctx,accent,11,hy+7,1,1);
    } else if(id==='prince') {
      rect(ctx,'#d4b361',-5,-15,12,3);for(const x of [-5,0,5])rect(ctx,'#efd389',x,-18,2,4);rect(ctx,'#9a6474',0,-14,2,2);poly(ctx,'#785971',[[-5,-4],[-9,8],[-5,8]]);
    } else if(id==='elder') {
      poly(ctx,'#c5c5ad',[[-3,-5],[5,-5],[2,1],[0,2]]);rect(ctx,'#997a50',10,-12,2,22);rect(ctx,'#a7bb82',7,-15,7,4);
    } else if(id==='toughguy') {
      rect(ctx,'#d4b58f',-7,-3,3,7);rect(ctx,'#d4b58f',6,-3,3,7);rect(ctx,'#ded0ac',-7,0,3,2);rect(ctx,'#ded0ac',6,0,3,2);
    } else if(id==='mason') {
      rect(ctx,'#d1c6a2',-2,-1,6,6);rect(ctx,'#6c6256',10,-8,2,16);rect(ctx,'#a9bfba',7,-10,8,4);
    } else if(id==='villager') {
      rect(ctx,'#b99a62',-4,-16,10,4);rect(ctx,'#d6b978',-7,-12,16,2);rect(ctx,'#9b7f50',11,-10,1,19);for(const x of [9,11,13])rect(ctx,'#bdab7d',x,-13,1,7);rect(ctx,'#bdab7d',9,-7,5,1);
    } else if(id==='tanner') {
      poly(ctx,'#b29277',[[-5,-12],[-3,-19],[0,-15],[5,-20],[6,-12]]);rect(ctx,'#e0c39b',-3,-20,2,2);rect(ctx,'#e0c39b',5,-21,2,2);
    } else if(id==='lycan'||id==='cursed') {
      ctx.globalAlpha=.4+.15*Math.sin(time);
      if(id==='lycan') {poly(ctx,accent,[[8,-15],[10,-21],[12,-15],[15,-21],[17,-12],[13,-8]]);}
      else {rect(ctx,accent,9,-14,1,10);rect(ctx,accent,6,-9,7,1);rect(ctx,accent,8,-12,3,1);}
      ctx.globalAlpha=1;
    }
    ctx.restore();
  }
  function redraw(time=0) {
    canvases.forEach(c=>{if(c.offsetParent!==null)paint(c,time);});
    if(currentRole && document.getElementById('role-portrait')?.offsetParent!==null) portrait(currentRole,time);
  }
  function animate(now) {
    animationFrame=null;
    if(!document.hidden && now-lastFrame>110) {redraw(reducedMotion.matches?0:now/1000);lastFrame=now;}
    if(!document.hidden && !reducedMotion.matches) animationFrame=requestAnimationFrame(animate);
  }
  function syncMotion() {
    if(animationFrame!==null) cancelAnimationFrame(animationFrame);
    animationFrame=null;
    if(reducedMotion.matches) {revealAnimation?.cancel();phaseAnimation?.cancel();redraw();}
    if(!document.hidden && !reducedMotion.matches) animationFrame=requestAnimationFrame(animate);
  }
  function setRole(role) {
    const changed=role?.id!==currentRole?.id;
    currentRole=role;
    if(!role) return;
    portrait(role);
    if(changed && !reducedMotion.matches) {
      revealAnimation?.cancel();
      revealAnimation=document.getElementById('role-portrait')?.animate?.([
        {opacity:0,transform:'translateY(10px) scale(.94)'},
        {opacity:1,transform:'translateY(0) scale(1)'}
      ],{duration:420,easing:'ease-out'});
    }
  }
  window.villageArt={update(gs){
    if(game && game.phase!==gs.phase && !reducedMotion.matches) {
      phaseAnimation?.cancel();
      phaseAnimation=document.querySelector('.phase-badge')?.animate?.([
        {boxShadow:'0 0 0 1px #e4bc7c88'}, {boxShadow:'0 0 18px 2px #e4bc7c22'}, {boxShadow:'0 0 0 0 #e4bc7c00'}
      ],{duration:900,easing:'ease-out'});
    }
    game=gs;if(gs.phase==='LOBBY')currentRole=null;redraw();
  },role:setRole,refresh:()=>redraw()};
  document.addEventListener('visibilitychange',syncMotion);
  reducedMotion.addEventListener('change',syncMotion);
  if(typeof state!=='undefined') {game=state.lastGameState;setRole(state.lastPrivate?.role);}
  redraw(); syncMotion();
})();
