// A3 integration check in a real browser (Edge + SwiftShader) against an isolated staging build.
// No live services: every /api/* call is answered by a local fixture. Nothing is written outside the page.
//
// What it verifies on the real concatenated page (things the Node tests could only infer):
//   1. P1-a  full house rebuild releases the house's GPU textures/geometries (renderer.info stays flat).
//   2. P1-b  V3.parts holds no object detached from the live scene after cutaway changes,
//            setHidden drag/cancel churn and rebuilds.
//   3. P2    photo-frame refresh releases the previous quads' geometry.
//   4. P2    fish / footprint InstancedMesh.dispose() is called on rebuild (dispose event observed).
//   5. hover outline still renders a pass for a real target and the page reports no errors.
//   6. tick  furniture storage is not rewritten while idle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'file:///D:/Dafeiyu/surfcore/node_modules/playwright/index.mjs';

const stage = process.env.CABIN_TEST_STAGE || 'D:/Dafeiyu/_work/cabin-a3-20261112/web';
// Same injection the real server does (cabin-bridge / cabin-gallery), so the bookshelf is a real hover target.
const assets = { 'home.html': 'text/html', 'cabin-gallery.js': 'text/javascript', 'cabin-bridge.js': 'text/javascript', 'cabin-gallery.css': 'text/css', 'cabin-bridge.css': 'text/css' };
const inject = '<link rel="stylesheet" href="/cabin-bridge.css"><link rel="stylesheet" href="/cabin-gallery.css"><script defer src="/cabin-bridge.js"></script><script defer src="/cabin-gallery.js"></script>';
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'home.html';
  if (!Object.hasOwn(assets, name) || !fs.existsSync(path.join(stage, name))) return res.writeHead(204).end();
  let data = fs.readFileSync(path.join(stage, name), 'utf8');
  if (name.endsWith('.html')) data = data.replace('</body>', inject + '</body>');
  res.writeHead(200, { 'content-type': assets[name] + '; charset=utf-8' }).end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = {};
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== base) return route.abort();
    if (u.pathname === '/api/cabin/art') return route.fulfill({ json: { ok: true, drawings: [], diaries: [{ day: '2026-11-11', chars: 4, text: '夹具日记' }] } });
    if (u.pathname === '/api/cabin/timeline') return route.fulfill({ json: { ok: true, day: '2026-11-11', events: [], nextAfter: 0, hasMore: false } });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
    return req.method() === 'GET' ? route.continue() : route.abort();
  });
  await page.goto(`${base}/home.html?live=0&auto=0&wx=clear&time=noon`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__READY && V3.houseBlocks && V3.houseBlocks.grid && V3.houseBlocks.live(), null, { timeout: 90000 });
  out.build = await page.evaluate(() => V3.build || document.querySelector('meta[name=build]')?.content || '');

  // ---- helpers living in the page ----
  await page.evaluate(() => {
    window.__a3 = {
      info() { const m = V3.R.renderer.info.memory; return { geometries: m.geometries, textures: m.textures }; },
      async settle(n = 12) { await V3.houseBlocks.live().ready; await V3.nextFrames(n); },
      // Objects registered under 小屋 that are not attached to the current scene.
      // 'vox:root' meshes are a separate, pre-existing case (parent-less voxel templates registered by
      // 03-vox tagFaces: a fixed set that does not grow), so they are counted apart from house-mesh groups.
      detached() {
        const scene = V3.R.scene; let total = 0, bad = 0, vox = 0;
        const seen = new Set();
        for (const item of V3.parts.objects('小屋')) {
          const o = item && item.obj;
          if (!o || seen.has(o)) continue; seen.add(o); total++;
          let r = o; while (r.parent) r = r.parent;
          if (r === scene) continue;
          if (o.name === 'vox:root' && !o.parent) vox++; else bad++;
        }
        return { total, bad, vox };
      },
    };
  });

  out.baselineVox = await page.evaluate(async () => { await window.__a3.settle(20); return window.__a3.detached().vox; });

  // ---- 1 + 4: repeated full rebuilds ----
  out.rebuild = await page.evaluate(async () => {
    const A = window.__a3, HB = V3.houseBlocks;
    await A.settle(20);
    // warm up one rebuild so one-time lazy resources are already allocated
    await HB.rebuildScene({ keepGirl: true }); await A.settle(20);
    const before = A.info();
    let instDisposed = 0, instSeen = 0;
    const hook = () => V3.R.scene.traverse(o => {
      if (o.isInstancedMesh && !o.__a3) { o.__a3 = true; instSeen++; o.addEventListener('dispose', () => { instDisposed++; }); }
    });
    const samples = [];
    for (let i = 0; i < 4; i++) {
      hook();
      await HB.rebuildScene({ keepGirl: true }); await A.settle(20);
      samples.push(A.info());
    }
    return { before, samples, instSeen, instDisposed, detached: A.detached(), cached: HB.stats().cached };
  });

  // ---- 2: cutaway + setHidden churn ----
  out.churn = await page.evaluate(async () => {
    const A = window.__a3, HB = V3.houseBlocks, me = HB.live();
    for (const f of ['ground', 'loft', 'all', 'ground', 'all']) { await V3.view('floor=' + f); await A.settle(6); }
    // orbit so several cutaway side variants get built and evicted
    for (const f of ['ground', 'loft']) for (let i = 0; i < 16; i++) {
      V3.R.ctl.set({ az: i * Math.PI / 8, el: 0.5 }, false); await V3.nextFrames(2);
      await me.setFloor(f); await A.settle(3);
    }
    const cells = [];
    const g = HB.grid, b = g.bounds;
    // any three occupied cells are fine (world block coordinates): setHidden just re-meshes without them
    outer: for (let y = b.y0; y < b.y1; y++) for (let z = b.z0; z < b.z1; z++) for (let x = b.x0; x < b.x1; x++) {
      if (g.at(x, y, z)) { cells.push([x, y, z]); if (cells.length === 3) break outer; }
    }
    for (let i = 0; i < 6; i++) {
      const p = me.setHidden(cells.slice(0, 1 + (i % 3)));   // overlapping calls on purpose
      const q = me.setHidden(null);
      await Promise.all([p, q]); await A.settle(4);
    }
    await V3.view('floor=all'); await A.settle(10);
    return { detached: A.detached(), cached: HB.stats().cached, cells: cells.length, info: A.info(), shown: HB.stats().shown };
  });

  // ---- 3: photo frame refresh ----
  out.photos = await page.evaluate(async () => {
    const A = window.__a3, live = V3.photoFrames && V3.photoFrames.live && V3.photoFrames.live();
    if (!live || typeof live.refresh !== 'function') return { skipped: 'no photo frames in this house' };
    await A.settle(6);
    live.refresh(); await A.settle(6);
    const before = A.info();
    for (let i = 0; i < 10; i++) { live.refresh(); await A.settle(3); }
    return { before, after: A.info(), items: live.items ? live.items.length : null };
  });

  // ---- 5: hover outline on a real target ----
  {
    const points = await page.evaluate(async () => {
      await V3.view('floor=ground'); await V3.nextFrames(10);
      let shelf;
      V3.models.current().root.traverse(o => {
        if (o.userData.clickable !== 'diaryShelf') return;
        for (let p = o; p; p = p.parent) if (!p.visible) return;
        shelf ||= o;
      });
      if (!shelf) return [];
      const box = new THREE.Box3().setFromObject(shelf), mid = box.getCenter(new THREE.Vector3());
      V3.R.ctl.set({ az: 0, el: .3, dist: 3.1, target: mid.toArray() }, false);
      await V3.nextFrames(5);
      const r = V3.R.canvas.getBoundingClientRect(), pts = [];
      for (const x of [.5, .3, .7]) for (const y of [.6, .4, .8]) for (const z of [.95, .65, .4]) {
        const p = new THREE.Vector3(box.min.x + x * (box.max.x - box.min.x), box.min.y + y * (box.max.y - box.min.y), box.min.z + z * (box.max.z - box.min.z)).project(V3.R.camera);
        pts.push([r.left + (p.x + 1) * r.width / 2, r.top + (1 - p.y) * r.height / 2]);
      }
      return pts;
    });
    let hit = null;
    for (const pt of points) {
      await page.mouse.move(...pt);
      await page.waitForTimeout(150);
      if (await page.evaluate(() => { const h = document.querySelector('.interaction-hover'); return h && !h.hidden; })) { hit = pt; break; }
    }
    if (!hit) out.hover = { skipped: 'no hoverable target found', points: points.length };
    else {
      const during = await page.evaluate(async () => {
        const H = V3.hoverOutline, f0 = H.stats.frames;
        await V3.nextFrames(12);
        return { frames: H.stats.frames - f0, passes: H.stats.passes, meshes: H.stats.meshes };
      });
      await page.mouse.move(2, 2);                       // park the pointer where nothing is pickable
      await page.waitForTimeout(300);
      const idleFrames = await page.evaluate(async () => { const H = V3.hoverOutline, f1 = H.stats.frames; await V3.nextFrames(12); return H.stats.frames - f1; });
      out.hover = { during, idleFrames };
    }
  }

  // ---- 6: idle furniture persistence ----
  out.storage = await page.evaluate(async () => {
    const proto = Storage.prototype, orig = proto.setItem; let writes = 0; const keys = new Set();
    const key = V3.furniturePlay.houseKey(V3.houseBlocks.model);
    proto.setItem = function (k, v) { if (this === localStorage && String(k) === key) { writes++; keys.add(String(k)); } return orig.call(this, k, v); };
    try {
      // 5 s autosave cadence is in simulation time; advance well past three periods
      const t0 = performance.now();
      while (performance.now() - t0 < 17000) await V3.nextFrames(30);
    } finally { proto.setItem = orig; }
    return { writes, keys: [...keys], key, stored: localStorage.getItem(key) != null };
  });

  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));

  // ---- assertions ----
  const flat = (a, b, slack, what) => assert.ok(Math.abs(a - b) <= slack, `${what}: ${a} vs ${b} (slack ${slack})`);
  const last = out.rebuild.samples.at(-1), first = out.rebuild.samples[0];
  flat(last.textures, first.textures, 2, 'textures must not grow across full rebuilds');
  flat(last.geometries, first.geometries, 8, 'geometries must not grow across full rebuilds');
  assert.ok(out.rebuild.instSeen > 0, 'expected InstancedMesh (fish/footprints) in the scene');
  assert.ok(out.rebuild.instDisposed > 0, 'InstancedMesh.dispose() must fire on rebuild');
  assert.equal(out.rebuild.detached.bad, 0, 'no detached house objects registered after rebuilds');
  assert.ok(out.rebuild.detached.vox <= out.baselineVox, 'pre-existing detached voxel templates must not grow');
  assert.ok(out.rebuild.detached.total > 0, 'registry audit must actually see house parts');
  assert.equal(out.churn.detached.bad, 0, 'no detached house objects registered after cutaway/setHidden churn');
  assert.ok(out.churn.detached.vox <= out.baselineVox, 'pre-existing detached voxel templates must not grow under churn');
  assert.ok(out.churn.cached <= 17, 'variant cache bounded');
  if (!out.photos.skipped) flat(out.photos.after.geometries, out.photos.before.geometries, 0, 'photo refresh must not leak geometries');
  assert.ok(!out.hover.skipped, 'hover check must run: ' + JSON.stringify(out.hover));
  assert.ok(out.hover.during.frames > 0 && out.hover.during.meshes > 0, 'outline must still render for a hovered target');
  assert.equal(out.hover.idleFrames, 0, 'no outline passes without a target');
  assert.ok(out.storage.writes <= 1, `idle furniture state must not be rewritten periodically (writes=${out.storage.writes})`);
  assert.deepEqual(errors, []);
  console.log('PASS A3 browser: rebuild/registry/photo/instanced/hover/idle-storage on the real page, no page errors.');
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
