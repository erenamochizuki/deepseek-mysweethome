// tools/mc-shot.mjs — 用无头 Edge 打开查看页，给方块场景拍一张图（开发用）
//   node tools/mc-shot.mjs --out <png> [--jar <客户端 jar>] [--model <鲸图 PNG / .schem / dump JSON / 方块 JSON>] [--cam x,y,z,yaw,pitch[,fov]] [--w 1280 --h 720] [--ao 0] [--light 0] [--ui]
// jar 也可以用环境变量 MC_JAR 给；不给 jar 就用我们自己的近似颜色。
// 给了 --cam：对比模式（MC 相机、背景透明、只截画布）；没给：整页截图（带工具栏和天空底色）。
// 注意：用 MC 真贴图拍出来的图只能放 tmp/，不能进 git。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';
import { launchBrowser, serveFiles } from './mc-lib.mjs';

// 打开查看页并一直开着：v.snap(cam) 换相机再拍（cam 是 'x,y,z,yaw,pitch[,fov]'），v.close() 关掉。
export async function openViewer({ jar, model, cam, w = 1280, h = 720, ao = true, light = true, ui = false, gpu, bright, mip } = {}) {
  const b = build('mcview');
  if (b.errors.length) throw new Error('mcview 编译失败：' + b.errors[0]);
  const routes = { '/mcview.html': b.out };
  if (jar) routes['/client.jar'] = jar;
  // model：鲸图 PNG / .schem / dump JSON / 方块 JSON 的路径（页面按内容判断格式），或者直接给模型对象
  const mname = !model ? null : typeof model === 'string' ? path.basename(model) : 'model.json';
  const mroute = !model ? null : '/model/' + encodeURIComponent(mname);
  if (model) routes['/model/' + mname] = typeof model === 'string' ? model : Buffer.from(JSON.stringify(model));
  const srv = await serveFiles(routes);
  const browser = await launchBrowser({ width: w, height: h, gpu });
  const errors = [];
  const close = async () => { await browser.close().catch(() => {}); srv.close(); };
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const q = new URLSearchParams({ cache: '0' });
    if (jar) q.set('jar', '/client.jar');
    if (model) q.set('model', mroute);
    if (!ao) q.set('ao', '0');
    if (!light) q.set('light', '0');
    if (bright != null) q.set('bright', bright);
    if (mip != null) q.set('mip', mip);
    if (cam) { q.set('cam', cam); q.set('w', w); q.set('h', h); if (!ui) q.set('compare', '1'); }
    await page.goto(srv.url + '/mcview.html?' + q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mcview && window.__mcview.started && window.__mcview.ready, { timeout: 120000 });
    const info = await page.evaluate(() => ({ stats: window.__mcview.stats, pack: window.__mcview.pack, warnings: window.__mcview.warnings.slice(0, 20), error: window.__mcview.error || (window.__mcview.lastError && window.__mcview.lastError.message) || null, model: window.__mcview.model || null, view: window.__mcview.info() }));
    const snap = async (c) => {
      if (c) await page.evaluate((s) => { const a = s.split(',').map(Number); window.__mcview.setCamera({ pos: [a[0], a[1], a[2]], yaw: a[3], pitch: a[4], fov: a[5] || 70 }); }, String(c));
      if (cam && !ui) return Buffer.from((await page.evaluate(() => window.__mcview.snapshot())).split(',')[1], 'base64');
      await page.evaluate(() => window.__mcview.render());
      return page.screenshot({ type: 'png' });
    };
    return { page, ...info, errors, snap, close };
  } catch (e) { await close(); throw e; }
}

export async function shoot({ out, ...opts } = {}) {
  const v = await openViewer(opts);
  try {
    const png = await v.snap();
    if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, png); }
    return { png, stats: v.stats, pack: v.pack, warnings: v.warnings, error: v.error, view: v.view, errors: v.errors };
  } finally { await v.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const jarPath = arg('jar') || process.env.MC_JAR;
  if (jarPath && !fs.existsSync(jarPath)) { console.error('找不到 jar：' + jarPath); process.exit(2); }
  const out = arg('out');
  if (!out) { console.error('用法：node tools/mc-shot.mjs --out <png> [--jar <jar>] [--model <json>] [--cam x,y,z,yaw,pitch[,fov]] [--w 1280 --h 720] [--ao 0] [--light 0] [--ui]'); process.exit(2); }
  const r = await shoot({ out, jar: jarPath ? path.resolve(jarPath) : null, model: arg('model') ? path.resolve(arg('model')) : null, cam: arg('cam'),
    w: +(arg('w') || 1280), h: +(arg('h') || 720), ao: arg('ao') !== '0', light: arg('light') !== '0', ui: a.includes('--ui') });
  console.log(JSON.stringify({ out, pack: r.pack && { key: r.pack.key, counts: r.pack.counts, ms: r.pack.ms }, stats: r.stats, warnings: r.warnings, error: r.error, errors: r.errors, view: r.view }));
  if (r.error || r.errors.length) process.exit(1);
}
