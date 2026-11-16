// tools/shell-compare.mjs — render the 12 classic shells from a staged studio.html with one fixed camera/light rig.
//   node tools/shell-compare.mjs --stage <dir with studio.html> --tag old|new [--out <dir>]
//   node tools/shell-compare.mjs --sheet [--out <dir>]      (old vs new comparison sheets from saved renders)
//   --ids a,b,c  （也可写潮汐拾物 id，如 sea_urchin_test）只渲染 / 只拼这几种（--sheet 时只出一张合并图 <out>/<--name 默认 compare-ids.png>，每行 旧4视图 | 新4视图，每格 --cell 默认150px）
// Renders 3 views per kind (3/4, top, flipped underside) at 360 px with ACES + sRGB, a hemisphere + key + fill rig.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('--out', '../_work/cabin-shells-20261112'));
const VIEWS = ['three-quarter', 'top', 'underside', 'side'];
const IDS = arg('--ids') ? arg('--ids').split(',') : null;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  if (process.argv.includes('--sheet')) {
    const meta = { old: JSON.parse(fs.readFileSync(path.join(out, 'render-old.json'))), new: JSON.parse(fs.readFileSync(path.join(out, 'render-new.json'))) };
    const img = (tag, id, v) => 'data:image/png;base64,' + fs.readFileSync(path.join(out, 'render', tag + '-' + id + '-' + v + '.png')).toString('base64');
    const page = await browser.newPage({ viewport: { width: 1480, height: 400 } });
    const cell = (tag, r, v, w) => '<div style="position:relative"><img width="' + w + '" height="' + w + '" src="' + img(tag, r.id, v) + '"><span style="position:absolute;left:6px;top:4px;font-size:12px;opacity:.7">' + v + '</span></div>';
    const rows = IDS ? meta.new.rows.filter(r => IDS.includes(r.id)) : meta.new.rows;
    if (IDS) {                                                       // 一张合并图：每行 旧 4 视图 | 新 4 视图
      const W = +arg('--cell', 150);
      const html = '<body style="margin:0;background:#e9eef2;font:12px system-ui;color:#1d3340">' + rows.map(r => {
        const o = meta.old.rows.find(x => x.id === r.id);
        return '<div style="display:flex;align-items:center;gap:6px;padding:2px 4px"><div style="width:70px">' + r.id + '<br>' + o.tris + '→' + r.tris + '</div>' +
          VIEWS.map(v => cell('old', r, v, W)).join('') + '<div style="width:6px;align-self:stretch;background:#1d3340"></div>' + VIEWS.map(v => cell('new', r, v, W)).join('') + '</div>';
      }).join('') + '</body>';
      await page.setViewportSize({ width: 90 + 8 * W + 40, height: 300 });
      await page.setContent(html); const p = path.join(out, arg('--name', 'compare-ids.png'));
      await page.screenshot({ path: p, fullPage: true }); console.log('sheet ' + p);
      process.exitCode = 0;
    } else {
    for (const r of rows) {
      const o = meta.old.rows.find(x => x.id === r.id);
      const html = '<body style="margin:0;background:#e9eef2;font:15px system-ui;color:#1d3340"><header style="padding:6px 10px">' + r.name + ' / ' + r.id +
        '</header><div style="display:flex;gap:16px;padding:0 10px 10px"><div><div>旧 voxel · ' + o.tris + ' tris</div><div style="display:flex">' + VIEWS.map(v => cell('old', r, v, 180)).join('') +
        '</div></div><div><div>新 sculpt · ' + r.tris + ' tris</div><div style="display:flex">' + VIEWS.map(v => cell('new', r, v, 180)).join('') + '</div></div></div></body>';
      await page.setContent(html); await page.screenshot({ path: path.join(out, 'compare-' + r.id + '.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 1500, height: 1000 });
    const big = '<body style="margin:0;background:#e9eef2;font:14px system-ui;color:#1d3340"><div style="display:grid;grid-template-columns:repeat(4,370px);gap:4px;padding:6px">' + rows.map(r => {
      const o = meta.old.rows.find(x => x.id === r.id);
      return '<div style="background:#fff;border-radius:6px;padding:4px"><div>' + r.name + ' · ' + o.tris + ' → ' + r.tris + '</div><div style="display:flex">' + cell('old', r, 'three-quarter', 180) + cell('new', r, 'three-quarter', 180) + '</div></div>';
    }).join('') + '</div></body>';
    await page.setContent(big); await page.screenshot({ path: path.join(out, 'compare-all-12.png'), fullPage: true });
    console.log('sheets written to ' + out);
    }
  } else {
    const stage = path.resolve(arg('--stage')), tag = arg('--tag', 'new');
    const server = http.createServer((req, res) => {
      const name = new URL(req.url, 'http://x').pathname.slice(1);
      if (name !== 'studio.html') return res.writeHead(204).end();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(path.join(stage, 'studio.html')));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/studio.html?model=shells', { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__READY && window.V3 && V3.shells, null, { timeout: 90000 });
    const data = await page.evaluate((IDS) => {
      const N = 360, r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      r.setSize(N, N); r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1;
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#9aa7b4');
      scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6f8fb5, 0.9));
      const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1.2, 2, 1.6); scene.add(key);
      const fill = new THREE.DirectionalLight(0xcfe8ff, 0.5); fill.position.set(-1.5, 0.6, -1); scene.add(fill);
      const views = [
        { p: [0.35, 0.8], flip: 0 }, { p: [0, 1.5707], flip: 0 }, { p: [0.35, 0.8], flip: Math.PI }, { p: [1.5707, 0.15], flip: 0 },
      ];
      const rows = [];
      // --ids 也可以是潮汐拾物（31-washup-catalog）：V3.shells.build 会转给 washupCatalog
      const pool = V3.shells.KINDS.concat(V3.washupCatalog ? V3.washupCatalog.collectibles : []);
      for (const k of IDS ? IDS.map(id => pool.find(x => x.id === id)).filter(Boolean) : V3.shells.KINDS) {
        const t0 = performance.now(); const o = V3.shells.build(k.id, { tag: false }); const ms = performance.now() - t0;
        const mesh = o.children[0], g = mesh.geometry;
        let bytes = 0; for (const n in g.attributes) bytes += g.attributes[n].array.byteLength; if (g.index) bytes += g.index.array.byteLength;
        const holder = new THREE.Group(); holder.add(o); scene.add(holder);
        const imgs = [];
        for (const v of views) {
          holder.rotation.set(v.flip, 0, 0); holder.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(holder), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
          const span = Math.max(s.x, s.y, s.z) * 0.62, cam = new THREE.OrthographicCamera(-span, span, span, -span, 0.001, 10);
          const [az, el] = v.p; cam.position.set(c.x + Math.sin(az) * Math.cos(el), c.y + Math.sin(el), c.z + Math.cos(az) * Math.cos(el));
          cam.up.set(0, 1, 0); if (el > 1.5) cam.up.set(0, 0, -1); cam.lookAt(c); cam.updateMatrixWorld(); r.render(scene, cam);
          imgs.push(r.domElement.toDataURL('image/png'));
        }
        scene.remove(holder);
        rows.push({ id: k.id, name: k.name, tris: o.userData.tris, bytes, firstBuildMs: ms, imgs });
      }
      r.dispose(); return { build: window.__V3_BUILD, rows };
    }, IDS);
    fs.mkdirSync(path.join(out, 'render'), { recursive: true });
    for (const row of data.rows) row.imgs.forEach((u, i) => fs.writeFileSync(path.join(out, 'render', tag + '-' + row.id + '-' + VIEWS[i] + '.png'), Buffer.from(u.split(',')[1], 'base64')));
    fs.writeFileSync(path.join(out, 'render-' + tag + '.json'), JSON.stringify({ build: data.build, errors, rows: data.rows.map(({ imgs, ...r }) => r) }, null, 2));
    console.log(tag, data.build, 'errors', errors.length); console.table(data.rows.map(({ imgs, ...r }) => r));
    server.close();
  }
} finally { await browser.close(); }
