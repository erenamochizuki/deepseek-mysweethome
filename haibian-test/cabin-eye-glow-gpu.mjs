// 冬装小鲸鱼的眼睛在夜里还亮不亮：真实核显 + 真实构建页 + 真正的导入路径（V3.ysmUI.import，和玩家点「导入 zip」是同一个函数）。
//
//   node haibian/test/cabin-eye-glow-gpu.mjs                       默认暂存构建 _work/cabin-b-20261112/web
//   CABIN_TEST_STAGE=<dir> YSM_WINTER_ZIP=<zip> node …
//
// 量的是画面：把镜头对准她的脸，夜里（time=night）分别在「眼睛发光」关 / 开时截图，只在眼睛全亮叠层覆盖的那些像素上
// 取平均亮度。关 = 眼睛和脸一样受夜里的光；开 = 作者原样全亮。再和正午比，确认关掉以后眼睛确实跟着昼夜变。
// 用的是一次性的浏览器配置目录，不碰玩家自己的浏览器数据；不连真实服务。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'file:///D:/Dafeiyu/surfcore/node_modules/playwright/index.mjs';

const stage = process.env.CABIN_TEST_STAGE || 'D:/Dafeiyu/_work/cabin-b-20261112/web';
const zip = process.env.YSM_WINTER_ZIP || 'C:/Users/MoonCell3/Documents/Tencent Files/657972120/FileRecv/蓝色大肥鱼(冬装)_1.2.zip';
const shots = process.env.EYE_SHOTS || 'D:/Dafeiyu/_work/cabin-b-20261112/eye-glow';
const expectFixed = process.env.EYE_EXPECT !== 'old';
fs.mkdirSync(shots, { recursive: true });
const zipB64 = fs.readFileSync(zip).toString('base64');

const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'home.html';
  if (name !== 'home.html') return res.writeHead(204).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(path.join(stage, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-eye-'));
const context = await chromium.launchPersistentContext(userDataDir, { channel: 'msedge', headless: false, viewport: { width: 1100, height: 760 },
  args: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--window-position=0,0'] });
try {
  const page = context.pages()[0] || await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
    return route.continue();
  });

  async function open(time) {
    await page.goto(`${base}/home.html?live=0&auto=0&wx=overcast&time=${time}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__READY && V3.actor && V3.houseBlocks && V3.houseBlocks.live(), null, { timeout: 120000 });
    await page.evaluate(async () => { await V3.houseBlocks.live().ready; V3.actor.hold(true); await V3.nextFrames(10); });
  }
  // 眼睛全亮叠层覆盖哪些屏幕像素：把叠层单独画成白色、其它全黑（不管当前开没开），读回这张遮罩。
  // 再读正常画面在这些像素上的平均亮度。两步都用同一帧姿态（她被 hold 住，不走动）。
  async function sample(label) {
    const r = await page.evaluate(async () => {
      // 站在门廊外、面朝镜头，镜头对脸
      await V3.view('girl=at_0_4_0'); await V3.nextFrames(6);
      const a = V3.actor, head = a.head();
      V3.R.ctl.set({ az: 0, el: 0.05, dist: 1.6, target: [head.x, head.y - 0.42, head.z] }, false);
      await V3.nextFrames(12);
      const inst = a.inst, R = V3.R, gl = R.renderer.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const read = () => { R.render(0); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const was = inst.getEyeGlow ? inst.getEyeGlow() : null;
      // mask: force the overlay on and paint it pure white, everything else hidden
      let glow = null; inst.root.traverse(o => { if (o.name === 'ysm-glow') glow = o; });
      if (!glow) return { error: 'no ysm-glow mesh' };
      if (inst.setEyeGlow) inst.setEyeGlow(true);
      const count = glow.geometry.index.count;
      const saved = { mat: glow.material, vis: glow.visible, bg: R.scene.background, post: R.post };
      const hidden = [];
      R.scene.traverse(o => { if (o !== glow && (o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible) { hidden.push(o); o.visible = false; } });
      glow.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); glow.visible = true;
      R.scene.background = new THREE.Color(0x000000); R.post = null;
      const tone = R.renderer.toneMapping; R.renderer.toneMapping = THREE.NoToneMapping;
      const mask = read();
      R.renderer.toneMapping = tone;
      glow.material.dispose(); glow.material = saved.mat; glow.visible = saved.vis; R.scene.background = saved.bg; R.post = saved.post;
      for (const o of hidden) o.visible = true;
      if (inst.setEyeGlow) inst.setEyeGlow(was);
      const idx = []; for (let i = 0; i < w * h; i++) if (mask[i * 4] > 200 && mask[i * 4 + 1] > 200 && mask[i * 4 + 2] > 200) idx.push(i);
      const lum = (px) => { let s = 0; for (const i of idx) s += 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]; return idx.length ? s / idx.length : 0; };
      await V3.nextFrames(3);
      const out = { pixels: idx.length, count, canToggle: !!inst.setEyeGlow, default: was };
      if (inst.setEyeGlow) {
        inst.setEyeGlow(false); await V3.nextFrames(3); out.off = +lum(read()).toFixed(1);
        inst.setEyeGlow(true); await V3.nextFrames(3); out.on = +lum(read()).toFixed(1);
        inst.setEyeGlow(was); await V3.nextFrames(3);
      }
      out.asShipped = +lum(read()).toFixed(1);
      out.body = a.bodyId; out.name = inst.label;
      return out;
    });
    await page.screenshot({ path: path.join(shots, `${label}.png`) });
    return r;
  }

  // 导入冬装版（和「设置 → 角色 → 导入 zip」同一个函数），并选用它
  await open('night');
  const rec = await page.evaluate(async (b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], '蓝色大肥鱼(冬装)_1.2.zip', { type: 'application/zip' });
    const rec = await V3.ysmUI.import([file], { use: true });
    return rec && { id: rec.id, name: rec.name, builtin: V3.ysmUI.isBuiltin(rec.id) };
  }, zipB64);
  assert.ok(rec && rec.name.includes('冬装') && rec.builtin === false, '冬装版必须作为导入模型装上：' + JSON.stringify(rec));
  await page.waitForFunction((id) => V3.actor.bodyId === id, rec.id, { timeout: 30000 });

  const result = { stage, model: rec, gpu: await page.evaluate(() => { const gl = V3.R.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }) };
  await page.evaluate(async () => { await V3.nextFrames(20); });
  result.night = await sample('winter-night');
  // 重新打开页面：选择和导入的模型存在这个（一次性的）浏览器里，刷新后应当还是冬装、还是不亮
  await open('noon');
  await page.waitForFunction((id) => V3.actor.bodyId === id, rec.id, { timeout: 30000 });
  result.noon = await sample('winter-noon');
  await open('night');
  await page.waitForFunction((id) => V3.actor.bodyId === id, rec.id, { timeout: 30000 });
  result.nightAfterReload = await sample('winter-night-reload');
  result.errors = errors;
  console.log(JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(shots, 'result.json'), JSON.stringify(result, null, 1));

  assert.ok(!/SwiftShader|Basic Render/i.test(result.gpu), '要在真实显卡上测：' + result.gpu);
  assert.deepEqual(errors, []);
  for (const k of ['night', 'noon', 'nightAfterReload']) assert.ok(result[k].pixels > 150, `${k}: 眼睛在画面里要有足够的像素（${result[k].pixels}）`);
  if (expectFixed) {
    assert.equal(result.night.default, false, '导入的冬装版默认不开眼睛发光');
    // 她在呼吸、眨眼，相邻几帧的读数差一两个单位；和「全亮」差着一百多，容差给到 15% 仍然分得清。
    assert.ok(Math.abs(result.night.asShipped - result.night.off) <= Math.max(3, result.night.off * 0.15), `默认画面应当等于关掉全亮的画面：${result.night.asShipped} vs ${result.night.off}`);
    assert.ok(result.night.on > result.night.off * 1.5, `夜里：全亮(${result.night.on}) 应当明显亮于受光(${result.night.off})，否则这个测试量不出区别`);
    assert.ok(result.noon.off > result.night.off * 1.5, `关掉以后眼睛跟着昼夜变：正午 ${result.noon.off} 应当明显亮于夜里 ${result.night.off}`);
    assert.ok(result.night.on >= result.noon.on * 0.75, `全亮的眼睛夜里并不变暗（这正是问题所在）：夜 ${result.night.on} / 午 ${result.noon.on}`);
    assert.equal(result.nightAfterReload.default, false, '刷新后仍然默认不亮');
    console.log(`PASS 冬装小鲸鱼：夜里眼睛亮度 ${result.night.off}（受光）对比全亮 ${result.night.on}；正午受光 ${result.noon.off}。默认不再全亮。`);
  } else {
    console.log(`旧构建对照：夜里默认画面眼睛亮度 ${result.night.asShipped}，正午 ${result.noon.asShipped}（没有开关：canToggle=${result.night.canToggle}）`);
  }
} finally {
  await context.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* temp profile */ }
  await new Promise(resolve => server.close(resolve));
}
