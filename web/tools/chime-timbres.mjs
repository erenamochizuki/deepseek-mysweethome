// 用小屋实际的挂件、碰撞和音色离线录制试听，尺寸单位为毫米。
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, serveFiles, WEB_DIR } from './mc-lib.mjs';

function wav(samples, rate) {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(out.length - 44, 40);
  samples.forEach((s,i) => out.writeInt16LE(s, 44 + 2 * i)); return out;
}

const output = path.resolve(WEB_DIR, '../tmp/chime-timbres');
const server = await serveFiles({ '/cabin.html': path.join(WEB_DIR, 'dist/cabin.html') });
let browser;
try {
  browser = await launchBrowser({ gpu: 'swiftshader', args: process.argv.includes('--isolated-runner') ? ['--no-sandbox'] : [] });
  const page = await browser.newPage(); await page.goto(server.url + '/cabin.html?auto=0', {waitUntil:'load'});
  await page.waitForFunction(() => window.__READY && V3.chimes && V3.game.kind('wreck_compass'));
  await mkdir(output, {recursive:true});
  const examples = [ ['贝壳轻碰','shell'], ['海玻璃轻碰','glass'], ['浮木轻碰','wood'], ['卵石轻碰','stone'], ['金属轻碰','metal'],
    ['风吹整串·全贝壳',['scallop','cowrie','mussel']], ['风吹整串·玻璃木头和金属',['blue_glass_float','driftwood','wreck_compass']] ];
  for (const [name, design] of examples) {
    const {samples,rate,peak,hits} = await page.evaluate(async design => {
      const solo = typeof design === 'string', rate = 44100, secs = solo ? 2.8 : 6, c = new OfflineAudioContext(1, rate * secs, rate);
      const C = V3.chimeCraft, S = V3.chimes, hits = [];
      if (solo) {
        for (const [time,size] of [[.06,60],[.83,135]]) S.materialHit(c,time,{chime:design,size},.95,0);
      } else {
        const own = new Map(), strands = design.map((kind,i) => {
          const uid = '试听' + i; own.set(uid,{kind,item:{size:100,pat:'plain'}}); return [{uid,gap:12}];
        });
        const model = C.build('window',{strands},own); let last = -Infinity;
        for (let frame = 0; frame < 4 * 120; frame++) {
          const time = frame / 120, gust = Math.floor(time / 1.35);
          C.swing(model,time * 1.4,.43,time % 1.35,gust % 2 ? -1 : 1,.1);
          const pair = C.contact(model); if (!pair || time - last < 1) continue;
          last = time; for (const bead of pair) { S.materialHit(c,.05 + time,bead,.88,0); hits.push(bead.chime); }
        }
      }
      const d = (await c.startRendering()).getChannelData(0); let peak = 0;
      const samples = Array.from(d,x => { peak = Math.max(peak,Math.abs(x)); return Math.round(x * 32767); });
      return {samples,rate,peak,hits};
    }, design);
    assert.ok(peak > .02 && peak <= .72, `${name} 峰值 ${peak}`);
    if (Array.isArray(design)) {
      assert.ok(hits.length >= 4, name + ' 至少两次碰撞');
      if (design.includes('driftwood')) assert.deepEqual([...new Set(hits)].sort(), ['glass','metal','wood']);
    }
    await writeFile(path.join(output,name+'.wav'),wav(samples,rate));
    console.log(`${name} ${(samples.length/rate).toFixed(1)} 秒，峰值 ${peak.toFixed(3)}，${hits.length ? hits.join(' / ') : '小、大各一声'}`);
  }
} finally { await browser?.close(); await server.close(); }
