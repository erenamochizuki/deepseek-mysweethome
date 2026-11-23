// A3 帧时实测：在这台机器的真实核显上跑真实构建页，逐项单变量对比。
//
//   node haibian-test/cabin-perf-gpu.mjs                    默认：暂存构建 web/dist
//   CABIN_TEST_STAGE=<dir> node haibian-test/cabin-perf-gpu.mjs
//   PERF_ONLY=baseline,nopost node …                       只跑某几项
//   PERF_SECONDS=12 PERF_WARMUP=5 node …
//
// 做法：有界面（非 headless）的 Edge + ANGLE/D3D11，窗口与设备像素比按这台机器的实际显示设置
// （1920×1080 物理像素、125% 缩放 → DPR 1.25、内部画布约 1920×1080）。每个变体重新打开页面、预热、
// 再在页面里用 requestAnimationFrame 的时间戳记帧间隔。
//
// 两种读数：
//   · vsync：正常显示，受刷新率上限约束。看的是「掉帧」——p95/p99、超过 1.5 个刷新周期的帧占比。
//   · uncapped（--disable-gpu-vsync --disable-frame-rate-limit）：不受刷新率限制，看的是每帧真实成本，
//     这样小于一个刷新周期的优化也能量出来。
// 不连真实服务：/api/* 全部本地应答；页面带 live=0&auto=0（不跑游戏时钟、她不自己走动），场景可复现。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

import { stage, stageFile } from './browser-files.mjs';
const SECONDS = Number(process.env.PERF_SECONDS) || 12, WARMUP = Number(process.env.PERF_WARMUP) || 6;
const DPR = Number(process.env.PERF_DPR) || 1.25, CSS_W = Math.round(1920 / DPR), CSS_H = Math.round(1080 / DPR);
const only = process.env.PERF_ONLY ? new Set(process.env.PERF_ONLY.split(',')) : null;
const outFile = process.env.PERF_OUT || path.join(stage, 'perf-gpu.json');

const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'home.html';
  if (name !== 'home.html' || !fs.existsSync(stageFile(name))) return res.writeHead(204).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(stageFile(name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// 固定镜头：整栋房子 + 海，晴天正午（阴影、水面、云都在画面里），和默认开场视角同一类。
const SCENE = 'live=0&auto=0&wx=clear&time=noon';
// 每个变体：query = 追加的地址参数；setup = 页面就绪后在页面里执行；pointer = 鼠标放哪
const VARIANTS = [
  { id: 'baseline', label: '默认（后处理开、4096 阴影、DPR 1.25）' },
  { id: 'nopost', label: '关后处理（?nopost=1）', query: 'nopost=1' },
  { id: 'bloom-off', label: '只关 Bloom', setup: () => { V3.post.params.bloom.on = false; } },
  { id: 'msaa-0', label: '只关后处理 MSAA', setup: () => { V3.post.params.msaa = 0; } },
  { id: 'dpr-1', label: '渲染像素比 1（同一窗口，画布 1536×864）', setup: () => { V3.R.renderer.setPixelRatio(1); window.dispatchEvent(new Event('resize')); } },
  { id: 'night', label: '夜晚（灯光 + 月亮阴影 + Bloom 最强）', scene: 'live=0&auto=0&wx=clear&time=night' },
  { id: 'storm', label: '雷雨黄昏', scene: 'live=0&auto=0&wx=storm&time=dusk' },
  { id: 'snow', label: '下雪白天', scene: 'live=0&auto=0&wx=snow&time=noon' },
  { id: 'night-lowtier', label: '夜晚 + 低配组合（后处理 MSAA 0、阴影 2048²、像素比 1）', scene: 'live=0&auto=0&wx=clear&time=night',
    setup: () => { V3.post.params.msaa = 0; V3.R.renderer.setPixelRatio(1); window.dispatchEvent(new Event('resize'));
      V3.R.scene.traverse(o => { if (o.isLight && o.shadow && o.castShadow) { o.shadow.mapSize.set(2048, 2048); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } }); } },
  { id: 'lowtier', label: '白天 + 低配组合', setup: () => { V3.post.params.msaa = 0; V3.R.renderer.setPixelRatio(1); window.dispatchEvent(new Event('resize'));
      V3.R.scene.traverse(o => { if (o.isLight && o.shadow && o.castShadow) { o.shadow.mapSize.set(2048, 2048); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } }); } },
  { id: 'shadow-off', label: '关阴影', setup: () => { V3.R.renderer.shadowMap.enabled = false; V3.R.scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; }); } },
  { id: 'cutshadow-off', label: '只关剖切投影（一楼视角）', view: 'floor=ground', setup: () => { V3.sky.params.cutShadow = false; } },
  { id: 'ground', label: '一楼剖切视角（对照）', view: 'floor=ground' },
  { id: 'shadow-2048', label: '阴影 2048²', setup: () => { V3.R.scene.traverse(o => { if (o.isLight && o.shadow && o.castShadow) { o.shadow.mapSize.set(2048, 2048); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } }); } },
  { id: 'hover-target', label: '鼠标停在家具上（描边通道）', view: 'floor=ground', pointer: 'target' },
  { id: 'hover-empty', label: '鼠标停在画布空处（只有 80ms 拾取）', view: 'floor=ground', pointer: 'empty' },
];

async function measure(mode, v) {
  const args = ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', `--force-device-scale-factor=${v.dpr || DPR}`,
    '--window-position=0,0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  if (mode === 'uncapped') args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-perf-'));
  // persistent context + viewport:null：视口就是真实窗口，设备像素比来自 --force-device-scale-factor（不是模拟出来的）
  const context = await chromium.launchPersistentContext(userDataDir, { channel: 'msedge', headless: false, viewport: null, args: [...args, '--start-fullscreen'] });
  try {
    const page = context.pages()[0] || await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.abort();
      if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
      return route.continue();
    });
    await page.goto(`${base}/home.html?${v.scene || SCENE}${v.query ? '&' + v.query : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__READY && V3.houseBlocks && V3.houseBlocks.grid && V3.houseBlocks.live(), null, { timeout: 120000 });
    await page.evaluate(async () => { await V3.houseBlocks.live().ready; await V3.nextFrames(10); });
    if (v.view) await page.evaluate(async (view) => { await V3.view(view); await V3.houseBlocks.live().ready; await V3.nextFrames(10); }, v.view);
    if (v.setup) await page.evaluate(v.setup);
    if (v.pointer) {
      const pts = await page.evaluate(async () => {
        let shelf; V3.models.current().root.traverse(o => { if (o.userData.furnitureKey && !shelf) { let ok = true; for (let p = o; p; p = p.parent) if (!p.visible) ok = false; if (ok) shelf = o; } });
        const r = V3.R.canvas.getBoundingClientRect(), out = [];
        if (shelf) {
          const box = new THREE.Box3().setFromObject(shelf);
          for (const x of [.5, .3, .7]) for (const y of [.5, .3, .7]) for (const z of [.5, .9, .1]) {
            const p = new THREE.Vector3(box.min.x + x * (box.max.x - box.min.x), box.min.y + y * (box.max.y - box.min.y), box.min.z + z * (box.max.z - box.min.z)).project(V3.R.camera);
            out.push([r.left + (p.x + 1) * r.width / 2, r.top + (1 - p.y) * r.height / 2]);
          }
        }
        return out;
      });
      if (v.pointer === 'target') {
        let hit = false;
        for (const pt of pts) { await page.mouse.move(...pt); await page.waitForTimeout(200); if (await page.evaluate(() => V3.hoverOutline.stats.meshes > 0)) { hit = true; break; } }
        if (!hit) return { skipped: 'no hover target' };
      } else {
        // 画布上找一处什么都点不到的地方（天空）
        await page.mouse.move(CSS_W * 0.5, 6); await page.waitForTimeout(300);
      }
    } else await page.mouse.move(2, 2);
    await page.waitForTimeout(WARMUP * 1000);
    const result = await page.evaluate(async (seconds) => {
      const gl = V3.R.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const info0 = { ...V3.R.renderer.info.render };
      const H = V3.hoverOutline, f0 = H ? H.stats.frames : 0;
      const dts = [];
      await new Promise(resolve => {
        let last = 0; const t0 = performance.now();
        const step = (t) => { if (last) dts.push(t - last); last = t; if (t - t0 < seconds * 1000) requestAnimationFrame(step); else resolve(); };
        requestAnimationFrame(step);
      });
      dts.sort((a, b) => a - b);
      const q = (p) => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))];
      const mean = dts.reduce((s, x) => s + x, 0) / dts.length;
      const size = V3.R.renderer.getDrawingBufferSize(new THREE.Vector2());
      return {
        frames: dts.length, fps: +(1000 / mean).toFixed(1), mean: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +dts[dts.length - 1].toFixed(1),
        over20ms: +(dts.filter(x => x > 20).length / dts.length * 100).toFixed(1), over33ms: +(dts.filter(x => x > 33.4).length / dts.length * 100).toFixed(1),
        buffer: [size.x, size.y], dpr: window.devicePixelRatio, inner: [innerWidth, innerHeight],
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
        post: V3.post ? { active: V3.post.active, samples: V3.post.stats.samples, ms: +(+V3.post.stats.ms).toFixed(2) } : null,
        draws: V3.R.renderer.info.render.calls, tris: V3.R.renderer.info.render.triangles,
        outlineFrames: H ? H.stats.frames - f0 : 0, shadows: V3.R.renderer.shadowMap.enabled,
      };
    }, SECONDS);
    result.errors = errors;
    return result;
  } finally {
    await context.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* temp profile */ }
  }
}

const results = { at: new Date().toISOString(), stage, seconds: SECONDS, warmup: WARMUP, dpr: DPR, runs: [] };
try {
  for (const mode of (process.env.PERF_MODES || 'uncapped,vsync').split(',')) {
    for (const v of VARIANTS) {
      if (only && !only.has(v.id)) continue;
      if (mode === 'vsync' && !['baseline', 'night', 'storm', 'hover-target'].includes(v.id) && !only) continue;
      const r = await measure(mode, v);
      results.runs.push({ mode, id: v.id, label: v.label, ...r });
      console.log(`${mode.padEnd(8)} ${v.id.padEnd(14)} ` + (r.skipped ? 'SKIP ' + r.skipped
        : `fps ${String(r.fps).padStart(6)}  mean ${String(r.mean).padStart(6)}ms  p50 ${String(r.p50).padStart(6)}  p95 ${String(r.p95).padStart(6)}  p99 ${String(r.p99).padStart(6)}  >20ms ${String(r.over20ms).padStart(4)}%  buf ${r.buffer.join('x')} dpr ${r.dpr} post ${r.post && r.post.active ? 'on msaa' + r.post.samples : 'off'} draws ${r.draws} outline ${r.outlineFrames}${r.errors.length ? ' ERR ' + r.errors[0] : ''}`));
      fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
    }
  }
  const first = results.runs.find(r => r.gpu);
  console.log('GPU: ' + (first ? first.gpu : 'unknown'));
  assert.ok(first && !/SwiftShader|llvmpipe|Basic Render/i.test(first.gpu), '必须跑在真实显卡上，而不是软件渲染：' + (first && first.gpu));
} finally {
  await new Promise(resolve => server.close(resolve));
}
