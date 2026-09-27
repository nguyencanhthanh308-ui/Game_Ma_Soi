// Original, code-drawn pixel art. No remote assets or game-role data on public scenery.
(() => {
  const canvases = [...document.querySelectorAll('.village-canvas')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let game = null;
  let lastFrame = 0;
  let currentRole = null;
  let animationFrame = null;
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
  // Draw at native pixel resolution, then enlarge by exactly 2x in CSS.
  // Angular muzzle, digitigrade legs and layered fur distinguish wolves from villagers.
  function wolfPortrait(ctx, id) {
    const white=id==='whitewolf', cub=id==='wolfcub';
    const ink='#101c24', dark=white?'#627f87':'#293c49';
    const mid=white?'#a0b8b9':'#506b79', light=white?'#dfebe1':'#91acaf';
    const fur=white?'#f5f3d9':'#bdccbd', eye=white?'#ef796c':'#ffd27e';
    const shape=(c,p)=>poly(ctx,c,p);
    rect(ctx,'#14282b',0,0,128,128);
    for(let y=-27;y<=27;y++) {
      const w=Math.floor(Math.sqrt(729-y*y));
      rect(ctx,'#253f40',65-w,43+y,w*2,1);
    }
    for(let i=0;i<32;i++)rect(ctx,'#42605a',random(i)*124+2,random(i+12)*118+3,1,1);
    rect(ctx,'#0d1d21',27,117,77,4);rect(ctx,'#102125',20,119,89,2);
    // Tail, tucked behind the silhouette, with a pale fur tip.
    shape(ink,[[82,83],[96,88],[108,80],[115,65],[119,76],[117,93],[105,105],[86,105]]);
    shape(dark,[[87,89],[99,94],[110,86],[115,76],[113,93],[103,101],[87,101]]);
    shape(light,[[110,86],[115,76],[113,91],[108,96],[104,94]]);
    // Bent hocks and broad clawed feet.
    for(const dx of [0,27]) {
      shape(ink,[[40+dx,82],[59+dx,84],[56+dx,100],[51+dx,109],[58+dx,113],[58+dx,119],[34+dx,119],[34+dx,113],[40+dx,104],[37+dx,96]]);
      shape(dark,[[43+dx,86],[55+dx,87],[52+dx,99],[47+dx,109],[53+dx,114],[38+dx,114],[45+dx,103],[41+dx,96]]);
      shape(mid,[[43+dx,89],[47+dx,91],[46+dx,101],[41+dx,108],[39+dx,107],[43+dx,99]]);
      for(let j=0;j<3;j++)shape(fur,[[38+dx+j*5,114],[40+dx+j*5,117],[36+dx+j*5,117]]);
    }
    // Ragged leather waist wrap and torn belt.
    shape(ink,[[43,65],[81,65],[88,91],[79,88],[73,96],[61,90],[52,94],[38,88]]);
    shape('#574442',[[46,71],[78,71],[82,87],[73,91],[63,85],[52,89],[43,85]]);
    shape('#89634b',[[47,73],[53,74],[50,86],[45,84]]);
    shape('#342c32',[[66,74],[77,73],[78,87],[72,90]]);
    // Powerful shoulders and hanging arms; tufts break the outline.
    shape(ink,[[47,39],[36,43],[30,53],[25,58],[28,60],[23,73],[26,83],[35,87],[42,78],[42,67],[49,72],[76,72],[83,64],[85,78],[92,86],[102,82],[104,72],[99,57],[101,54],[91,43],[78,39]]);
    shape(dark,[[46,43],[35,49],[33,58],[28,72],[30,80],[35,79],[39,63],[46,59],[47,68],[76,68],[84,57],[89,62],[91,77],[98,80],[100,73],[94,55],[86,46],[76,43]]);
    shape(mid,[[40,45],[34,53],[36,55],[32,65],[37,62],[44,52],[48,54],[51,66],[70,68],[77,56],[87,53],[83,47],[72,43]]);
    shape(light,[[42,44],[35,51],[40,50],[38,55],[45,51],[51,57],[54,65],[58,60],[64,69],[70,61],[74,63],[75,52],[83,50],[76,43]]);
    shape(fur,[[49,45],[55,49],[61,48],[70,45],[73,51],[68,54],[67,60],[62,57],[60,63],[57,55],[52,55]]);
    for(const dx of [0,65])for(let j=0;j<3;j++)shape(fur,[[28+dx+j*3,78],[30+dx+j*3,78],[29+dx+j*3,85]]);
    rect(ctx,'#342d30',43,69,37,5);rect(ctx,'#a57e4d',57,69,8,6);rect(ctx,'#302c30',59,71,4,2);
    // Tall triangular ears, cheek ruff and a projecting canine muzzle.
    shape(ink,[[43,30],[39,12],[43,7],[55,21],[67,19],[82,7],[86,11],[82,31],[88,39],[81,40],[84,45],[74,48],[66,53],[53,48],[42,45],[45,40],[38,38]]);
    shape(mid,[[46,30],[43,13],[54,26],[67,23],[81,12],[78,32],[83,37],[77,38],[79,42],[68,48],[55,44],[46,41],[49,37],[43,36]]);
    shape(light,[[43,13],[47,16],[50,26],[46,25]]);
    shape(light,[[78,17],[81,13],[78,28],[73,29]]);
    shape('#72565c',[[46,18],[51,27],[47,28]]);shape('#72565c',[[78,19],[77,29],[72,30]]);
    shape(dark,[[54,25],[60,23],[65,25],[69,23],[72,30],[68,33],[61,30],[55,33],[49,31]]);
    shape(light,[[47,33],[52,31],[58,33],[55,35],[49,35]]);
    shape(light,[[66,33],[72,30],[77,31],[76,34],[69,35]]);
    rect(ctx,ink,49,34,9,3);rect(ctx,ink,67,33,9,3);
    rect(ctx,eye,51,34,5,2);rect(ctx,eye,69,33,5,2);
    rect(ctx,ink,54,34,1,2);rect(ctx,ink,71,33,1,2);
    shape(fur,[[59,35],[66,34],[69,38],[76,40],[73,46],[65,49],[55,44],[53,40]]);
    shape(light,[[55,40],[63,42],[73,41],[73,45],[65,47],[57,44]]);
    shape(ink,[[64,37],[73,37],[75,40],[70,43],[65,41]]);
    rect(ctx,'#829c9d',66,37,4,1);
    shape(ink,[[56,43],[64,46],[72,44],[69,49],[62,49]]);
    rect(ctx,'#f4e8ca',58,44,2,3);rect(ctx,'#f4e8ca',68,45,2,3);
    // A cub's rust-red scarf; the white wolf wears a moon-silver clasp.
    if(cub) {shape('#8e4841',[[47,47],[60,53],[75,48],[71,54],[60,57],[49,52]]);shape('#b16950',[[49,51],[45,62],[48,67],[54,54]]);}
    if(white) {rect(ctx,'#d6c696',62,54,3,6);rect(ctx,'#f5eed1',61,56,5,2);}
  }
  function portrait(role) {
    const canvas=document.getElementById('role-portrait');
    const ctx=canvas?.getContext('2d');
    if(!ctx || !role) return;
    const wolf=['werewolf','wolfcub','whitewolf'].includes(role.id);
    const size=wolf?128:96;
    if(canvas.width!==size) {canvas.width=size;canvas.height=size;}
    ctx.imageSmoothingEnabled=false;
    if(wolf) {wolfPortrait(ctx,role.id);return;}
    rect(ctx,'#152a2c',0,0,96,96);
    for(let i=0;i<20;i++) rect(ctx,'#304843',random(i)*96,random(i+12)*96,2,2);
    ctx.save(); ctx.translate(47,65); ctx.scale(3,3);
    person(ctx,0,0,wolf?'#587278':role.id==='seer'?'#8b7d9d':'#b19860','#d4b58f',wolf);
    if(role.id==='seer'||role.id==='witch') {poly(ctx,'#857797',[[-6,-13],[0,-23],[7,-13]]);rect(ctx,'#dfbd77',-7,-13,15,2);}
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
    if(reducedMotion.matches) {redraw();}
    if(!document.hidden && !reducedMotion.matches) animationFrame=requestAnimationFrame(animate);
  }
  function setRole(role) {
    currentRole=role;
    if(role) portrait(role);
  }
  window.villageArt={update(gs){game=gs;if(gs.phase==='LOBBY')currentRole=null;redraw();},role:setRole,refresh:()=>redraw()};
  document.addEventListener('visibilitychange',syncMotion);
  reducedMotion.addEventListener('change',syncMotion);
  if(typeof state!=='undefined') {game=state.lastGameState;setRole(state.lastPrivate?.role);}
  redraw(); syncMotion();
})();
