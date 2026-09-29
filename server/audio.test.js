const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  let now=0, seq=0, cancels=0;
  const timers=new Map(), stored=new Map(), spoken=[], listeners=new Map(), elements=new Map();
  const document={hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn)};
  const synth={
    getVoices:()=>[{lang:'vi-VN',localService:false},{lang:'vi-VN',localService:true}],
    addEventListener(){}, resume(){}, cancel(){cancels++;},
    speak(utter){spoken.push(utter);utter.onstart?.();},
  };
  const window={speechSynthesis:synth};
  const context={window,document,navigator:{},state:{},toast(){},
    $:id=>{if(!elements.has(id))elements.set(id,{textContent:'',setAttribute(){},addEventListener(name,fn){this[name]=fn;},pause(){},play:()=>Promise.resolve()});return elements.get(id);},
    localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},
    SpeechSynthesisUtterance:class {constructor(text){this.text=text;}},
    Date:{now:()=>now},setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,at:now+ms});return id;},
    clearTimeout:id=>timers.delete(id),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/audio.js'),'utf8'),context);
  async function tick(ms){
    const end=now+ms;
    for(let loops=0;loops<500;loops++){
      await Promise.resolve();await Promise.resolve();
      const entry=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!entry)break;
      now=entry[1].at;timers.delete(entry[0]);entry[1].fn();
    }
    now=end;await Promise.resolve();
  }
  const phase=(name,prev='NIGHT_GUARD',round=1)=>window.gameAudio.onPhaseChange(name,prev,{roomCode:'ROOM',phaseEndsAt:1234,actionRound:round});
  return {document,listeners,spoken,stored,tick,phase,get cancels(){return cancels;}};
}

test('narration waits for user interaction; hidden tabs cannot claim a phase',async()=>{
  const h=harness();h.document.hidden=true;h.listeners.get('pointerdown')();
  h.phase('NIGHT_WOLVES');await h.tick(2000);
  assert.equal(h.spoken.length,0);assert.equal(h.stored.has('masoi_narrated'),false);
  h.document.hidden=false;h.listeners.get('visibilitychange')();await h.tick(700);
  assert.equal(h.spoken.length,1);assert.equal(h.spoken[0].voice.localService,true);
  assert.ok(h.stored.get('masoi_narrated').includes('NIGHT_WOLVES'));
  const locked=harness();locked.phase('NIGHT_WOLVES');await locked.tick(2000);
  assert.equal(locked.spoken.length,0);
  locked.listeners.get('pointerdown')();await locked.tick(700);assert.equal(locked.spoken.length,1);
});

test('phase changes discard stale delayed narration without cancelling another tab',async()=>{
  const h=harness();h.listeners.get('pointerdown')();
  h.phase('NIGHT_WOLVES');await h.tick(100);
  h.phase('DAY_VOTE','DAY_DISCUSSION');await h.tick(700);
  assert.equal(h.cancels,0);assert.equal(h.spoken.length,1);
  assert.match(h.spoken[0].text,/bỏ phiếu/);
  const stale=h.spoken[0];
  h.phase('LOBBY','DAY_VOTE');stale.onend();await h.tick(30000);
  assert.equal(h.cancels,1);assert.equal(h.spoken.length,1);
});
