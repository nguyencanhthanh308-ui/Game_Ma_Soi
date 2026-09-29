// Original short ambient loops, synthesized locally; no external music assets.
const fs = require('node:fs');
const path = require('node:path');
const rate = 16000, seconds = 16, count = rate * seconds;
for (const [name, notes] of Object.entries({day:[261.63,329.63,392,329.63,293.66,349.23,440,349.23],night:[130.81,155.56,196,155.56,116.54,146.83,174.61,146.83]})) {
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);
  buffer.write('data',36);buffer.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++) {
    const t=i/rate, beat=Math.floor(t/2), local=t%2;
    const envelope=Math.sin(Math.PI*local/2)**2;
    const f=notes[beat];
    const sample=envelope*(Math.sin(2*Math.PI*f*t)+.3*Math.sin(2*Math.PI*f*1.5*t))*.12;
    buffer.writeInt16LE(Math.round(sample*32767),44+i*2);
  }
  fs.writeFileSync(path.join(__dirname,'../public/sounds',`bgm-${name}.wav`),buffer);
}
