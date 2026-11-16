// Wind chime + crab click interactions in a real browser (Edge + SwiftShader) against an isolated staging build.
// No live services: every /api/* call is answered by a local fixture. Nothing is written outside the page and the
// screenshot folder. Real page.mouse moves / clicks only (no synthetic events, no V3.viewTokens.tap).
//
//   CABIN_TEST_STAGE=<dir with home.html + cabin-bridge/gallery assets>   (default ../_work/cabin-toys-20261112/web)
//   CABIN_TEST_SHOTS=<dir for screenshots + toys-result.json>             (default: the parent of the stage dir)
//
// What it verifies on the real concatenated page:
//   chime  hover → tooltip 「贝壳风铃 · 点击摇一摇」 + outline pass; one real click = +1 ring, +1 kick of the voxel chime;
//          a second click 0.6 s later rings again; two clicks < 0.4 s apart ring once; 「风铃声」 off → swings, no sound;
//          blocked while arrange mode is on; not clickable while the floor cutaway hides it; still works after a rebuild.
//   crab   hover → tooltip 「小螃蟹 · 点一下」 + outline pass; one real click → it runs (continuous path on clear sand) into
//          its hole, is not hoverable / clickable while hidden, comes back out and is hoverable again; reset by a rebuild.
//   no page errors, no new V3.err entries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const stage = process.env.CABIN_TEST_STAGE || '../_work/cabin-toys-20261112/web';
const shots = process.env.CABIN_TEST_SHOTS || path.dirname(path.resolve(stage));
fs.mkdirSync(shots, { recursive: true });
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
const out = { stage, shots: {} };
const CHIME_TIP = '贝壳风铃 · 点击摇一摇', CRAB_TIP = '小螃蟹 · 点一下';
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage(), errors = [], posted = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== base) return route.abort();
    if (req.method() !== 'GET') posted.push(req.method() + ' ' + u.pathname + ' ' + (req.postData() || '').slice(0, 200));
    if (u.pathname === '/api/cabin/art') return route.fulfill({ json: { ok: true, drawings: [], diaries: [] } });
    if (u.pathname === '/api/cabin/timeline') return route.fulfill({ json: { ok: true, day: '2026-11-12', events: [], nextAfter: 0, hasMore: false } });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
    return req.method() === 'GET' ? route.continue() : route.abort();
  });
  // wind=0: no gusts, so every ring counted below comes from a click. auto=0: she stays where she is.
  await page.goto(`${base}/home.html?live=0&auto=0&wx=clear&time=noon&wind=0`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__READY && V3.houseBlocks && V3.houseBlocks.grid && V3.houseBlocks.live() && V3.sealife && V3.sealife.crab, null, { timeout: 90000 });
  out.build = await page.evaluate(() => window.__V3_BUILD);

  await page.evaluate(() => {
    const px = (v) => { const p = v.clone().project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
    const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    window.__toys = {
      px, shown,
      async settle(n = 10) { await V3.houseBlocks.live().ready; await V3.nextFrames(n); },
      chimes() { const a = []; V3.models.current().root.traverse(o => { if (o.name === 'house2:chime') a.push(o); }); return a; },
      // camera in front of the chime (on the side it hangs on), slightly above eye level
      async aimChime(i = 0) {
        const gr = this.chimes()[i]; if (!gr) return null;
        const pick = gr.children.find(o => o.name === 'house2:chime:pick'), mid = pick.getWorldPosition(new THREE.Vector3());
        const outward = new THREE.Vector3(0, 0, 1).transformDirection(gr.matrixWorld);
        V3.R.ctl.set({ az: Math.atan2(outward.x, outward.z), el: 0.12, dist: 4.2, target: mid.toArray() }, false);
        await V3.nextFrames(6);
        window.__chime = gr;
        return Object.assign(px(mid), { n: this.chimes().length, cell: gr.userData.cell || null, shown: shown(gr), clickable: gr.userData.clickable, always: gr.userData.clickAlways });
      },
      chimeStats() { const s = V3.chimes.stats(); return { rings: s.rings, clicks: s.clicks, played: s.played, hits: s.hits, audio: s.audio, on: s.on, last: s.last, clinks: window.__chime ? window.__chime.userData.clinks : -1 }; },
      // camera north of the crab looking south-and-down at it (the reef is to the south)
      async aimCrab(move = true) {
        const c = V3.sealife.crab, p = c.now();
        if (move) { V3.R.ctl.set({ az: Math.PI, el: 0.8, dist: 4.2, target: [p.x, p.y + 0.1, p.z] }, false); await V3.nextFrames(4); }
        const q = c.now();
        return Object.assign(px(new THREE.Vector3(q.x, q.y + 0.13, q.z)), { can: c.canStartle(), state: c.state(), pos: [q.x, q.y, q.z] });
      },
      tip() { const h = document.querySelector('.interaction-hover'); return h && !h.hidden ? { text: h.querySelector('.interaction-hover-tip').textContent, target: h.dataset.target } : null; },
      async outline(n = 6) { const H = V3.hoverOutline, f0 = H.stats.frames; await V3.nextFrames(n); return { frames: H.stats.frames - f0, passes: H.stats.passes, meshes: H.stats.meshes }; },
    };
    window.__ups = []; V3.R.canvas.addEventListener('pointerup', () => window.__ups.push(performance.now()), true);
  });
  const sleep = (ms) => page.waitForTimeout(ms);
  const tip = () => page.evaluate(() => window.__toys.tip());
  const hover = async (p) => { await page.mouse.move(p.x - 4, p.y - 2); await page.mouse.move(p.x, p.y); };
  const waitTip = (text, timeout = 4000) => page.waitForFunction(t => { const h = window.__toys.tip(); return h && h.text === t; }, text, { timeout });
  const noTip = async (what, ms = 500) => { await sleep(ms); const t = await tip(); assert.ok(!t || t.target !== what, `no ${what} tooltip expected, got ${JSON.stringify(t)}`); return t; };
  const shot = async (name) => { const f = path.join(shots, name); await page.screenshot({ path: f }); out.shots[name] = f; };
  const errs0 = await page.evaluate(() => (window.__errors || []).length);
  await page.evaluate(() => window.__toys.settle(20));

  // ================= wind chime =================
  {
    const c = out.chime = {};
    await page.evaluate(async () => { await V3.view('floor=all'); await window.__toys.settle(8); });
    const p = await page.evaluate(() => window.__toys.aimChime(0));
    assert.ok(p && p.n >= 1, 'the house has a wind chime');
    assert.equal(p.clickable, 'chime'); assert.equal(p.always, true); assert.equal(p.shown, true);
    c.count = p.n; c.cell = p.cell; c.at = [Math.round(p.x), Math.round(p.y)];
    c.wind = await page.evaluate(() => ({ speed: V3.env.state.wind.speed, gust: V3.env.state.wind.gust }));

    await hover(p); await waitTip(CHIME_TIP);
    c.tip = await tip();
    assert.deepEqual(c.tip, { text: CHIME_TIP, target: 'chime' });
    assert.equal(await page.evaluate(() => getComputedStyle(V3.R.canvas).cursor), 'pointer');
    c.outline = await page.evaluate(() => window.__toys.outline());
    assert.ok(c.outline.frames > 0 && c.outline.meshes > 0, 'outline pass for the hovered chime: ' + JSON.stringify(c.outline));
    await shot('chime-hover.png');

    const stats = () => page.evaluate(() => window.__toys.chimeStats());
    const s0 = await stats();
    await page.mouse.click(p.x, p.y); await sleep(150);
    const s1 = await stats();
    assert.equal(s1.clicks - s0.clicks, 1, 'one real click = one chime click');
    assert.equal(s1.rings - s0.rings, 1, 'rings +1'); assert.equal(s1.clinks - s0.clinks, 1, 'the voxel chime is kicked once');
    assert.ok(s1.hits - s0.hits === 2 || s1.hits - s0.hits === 3, 'the usual 2–3 hit burst');
    if (p.cell) assert.deepEqual(s1.last, p.cell);
    c.first = { audio: s1.audio, played: s1.played - s0.played, hits: s1.hits - s0.hits };
    if (s1.audio === 'running') assert.equal(s1.played - s0.played, 1, 'audio is running after the click gesture: the burst was scheduled');
    c.swing = await page.evaluate(async () => { await V3.nextFrames(3); let a = 0; window.__chime.traverse(b => { if (/^s\d$/.test(b.name)) a = Math.max(a, Math.abs(b.rotation.z), Math.abs(b.rotation.x)); }); return a; });
    assert.ok(c.swing > 0.005, 'the strings swing after the click (no wind): ' + c.swing);
    await shot('chime-clicked.png');

    await sleep(600);
    await page.mouse.click(p.x, p.y); await sleep(150);
    const s2 = await stats();
    assert.equal(s2.rings - s1.rings, 1, 'a second click 0.6 s later rings again'); assert.equal(s2.clinks - s1.clinks, 1);
    if (s2.audio === 'running') assert.equal(s2.played - s1.played, 1);

    await sleep(600);
    await page.evaluate(() => { window.__ups.length = 0; });
    await page.mouse.click(p.x, p.y); await page.mouse.click(p.x, p.y); await sleep(150);
    const s3 = await stats(), ups = await page.evaluate(() => window.__ups.slice());
    c.rapid = { gapMs: Math.round(ups[1] - ups[0]), rings: s3.rings - s2.rings };
    assert.equal(ups.length, 2);
    if (ups[1] - ups[0] < 400) assert.equal(s3.rings - s2.rings, 1, 'two clicks ' + c.rapid.gapMs + ' ms apart ring once');
    else assert.equal(s3.rings - s2.rings, 2, 'the two clicks arrived ' + c.rapid.gapMs + ' ms apart (slow page): both count');

    // 「风铃声」 off: still swings, nothing played
    await sleep(600);
    await page.evaluate(() => V3.game.set('chimeSound', false));
    await page.mouse.click(p.x, p.y); await sleep(150);
    const s4 = await stats();
    c.muted = { on: s4.on, rings: s4.rings - s3.rings, clinks: s4.clinks - s3.clinks, played: s4.played - s3.played };
    assert.deepEqual(c.muted, { on: false, rings: 1, clinks: 1, played: 0 });
    await page.evaluate(() => V3.game.set('chimeSound', true));

    // arrange mode on: neither hover nor click
    await sleep(600);
    await page.evaluate(() => { window.__savedArrange = V3.arrange; V3.arrange = { on: true }; });
    await hover(p); await noTip('chime');
    await page.mouse.click(p.x, p.y); await sleep(150);
    const s5 = await stats();
    assert.equal(s5.clicks - s4.clicks, 0, 'no chime click while arrange mode is on');
    await page.evaluate(() => { V3.arrange = window.__savedArrange; });
    await hover(p); await waitTip(CHIME_TIP);

    // floor cutaway seen from the chime's side: the wall it hangs on is cut away and the chime with it → not a target
    const cut = await page.evaluate(async () => {
      await V3.view('floor=ground'); await window.__toys.settle(8);
      const p = await window.__toys.aimChime(0); await V3.nextFrames(6);
      return { shown: window.__toys.shown(window.__chime), x: p.x, y: p.y };
    });
    c.cutaway = { chimeShown: cut.shown };
    if (!cut.shown) {
      await hover(cut); await noTip('chime');
      const a = await stats(); await page.mouse.click(cut.x, cut.y); await sleep(150); const b = await stats();
      assert.equal(b.clicks - a.clicks, 0, 'a chime hidden by the cutaway is not clickable');
      c.cutaway.clicks = b.clicks - a.clicks;
      await shot('chime-cutaway.png');
    }
    await page.evaluate(async () => { await V3.view('floor=all'); await window.__toys.settle(8); });
    c.total = await stats();
  }

  // ================= crab =================
  {
    const c = out.crab = {};
    c.plan = await page.evaluate(() => { const k = V3.sealife.crab; return { mouth: k.plan.M, hides: k.plan.seg.filter(s => s.k === 'hide').map(s => s.p0), T: k.T, RUN: k.RUN }; });
    // wait until it is out on the sand and clickable (not in / on its way into the hole)
    await page.waitForFunction(() => { const k = V3.sealife.crab, p = k.now(); return k.canStartle() && p.z <= k.plan.MZ + 0.02; }, null, { timeout: 90000 });
    let p = null, hovered = false;
    for (let i = 0; i < 10 && !hovered; i++) {
      p = await page.evaluate(() => window.__toys.aimCrab(true));
      if (!p.can) { await sleep(500); continue; }
      await hover(p);
      hovered = await waitTip(CRAB_TIP, 1500).then(() => true, () => false);
    }
    assert.ok(hovered, 'the crab shows its tooltip under the real pointer');
    c.tip = await tip();
    assert.deepEqual(c.tip, { text: CRAB_TIP, target: 'crab' });
    c.outline = await page.evaluate(() => window.__toys.outline());
    assert.ok(c.outline.frames > 0 && c.outline.meshes > 0, 'outline pass for the hovered crab: ' + JSON.stringify(c.outline));
    await shot('crab-hover.png');

    // log its pose every frame from now on, then click it where it is right now
    await page.evaluate(() => {
      const k = V3.sealife.crab; window.__crabLog = [];
      window.__crabFrame = () => { const q = k.now(), s = k.state(); window.__crabLog.push([s.t, q.x, q.z, q.yaw, s.phase]); };
      V3.on('frame', window.__crabFrame);
    });
    let clicked = null;
    for (let i = 0; i < 5 && !clicked; i++) {
      p = await page.evaluate(() => window.__toys.aimCrab(false));
      await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); await sleep(120);
      const st = await page.evaluate(() => V3.sealife.crab.state());
      if (st.startled) clicked = { from: p.pos, state: st, tries: i + 1 };
    }
    assert.ok(clicked, 'a real click on the crab startles it');
    c.clicked = clicked;
    assert.ok(clicked.state.hide >= 8 && clicked.state.hide < 15, 'it will hide 8–15 s: ' + clicked.state.hide);
    await noTip('crab', 400);                                       // running away: no tooltip any more
    await shot('crab-running.png');

    await page.waitForFunction(() => V3.sealife.crab.state().phase === 'hidden', null, { timeout: 90000 });
    const hid = await page.evaluate(() => window.__toys.aimCrab(false));
    c.hidden = { pos: hid.pos, state: hid.state };
    assert.ok(c.plan.hides.some(h => Math.abs(h[0] - hid.pos[0]) < 1e-6 && Math.abs(h[1] - hid.pos[2]) < 1e-6), 'it ends up exactly at a scheduled hide spot: ' + JSON.stringify(hid.pos));
    await hover(hid); await noTip('crab', 500);
    await page.mouse.click(hid.x, hid.y); await sleep(150);
    const st2 = await page.evaluate(() => V3.sealife.crab.state());
    assert.equal(st2.phase, 'hidden', 'a click at the hidden crab changes nothing'); assert.equal(st2.hide, clicked.state.hide);
    await shot('crab-hidden.png');

    await page.waitForFunction(() => !V3.sealife.crab.state().startled, null, { timeout: 120000 });
    const back = await page.evaluate(() => { V3.off('frame', window.__crabFrame); const k = V3.sealife.crab, q = k.now(); return { pos: [q.x, q.y, q.z], state: k.state() }; });
    c.back = back;
    assert.ok(Math.hypot(back.pos[0] - c.plan.mouth[0], back.pos[2] - c.plan.mouth[1]) < 0.05, 'it comes back out to the hole mouth: ' + JSON.stringify(back.pos));
    assert.equal(back.state.phase, 'routine'); assert.ok(back.state.offset !== 0);

    // the logged path: continuous, on clear sand until the mouth, hidden for the announced time
    c.path = await page.evaluate(() => {
      const k = V3.sealife.crab, pl = k.plan, L = window.__crabLog, TAU = Math.PI * 2;
      let maxStep = 0, maxOver = 0, maxYaw = 0, bad = 0, hidden = 0, flee = 0, ret = 0, maxDt = 0, phases = [];
      for (let i = 1; i < L.length; i++) {
        const a = L[i - 1], b = L[i], dt = b[0] - a[0], d = Math.hypot(b[1] - a[1], b[2] - a[2]);
        if (!(dt > 0)) continue;
        maxDt = Math.max(maxDt, dt); maxStep = Math.max(maxStep, d); maxOver = Math.max(maxOver, d - 1.5 * k.RUN * dt);
        let dy = b[3] - a[3]; dy -= TAU * Math.round(dy / TAU); maxYaw = Math.max(maxYaw, Math.abs(dy) - 9 * dt);
        if (b[4] === 'flee') { flee += dt; if (b[2] <= pl.MZ + 0.02 && !pl.ok(b[1], b[2])) bad++; }
        if (b[4] === 'hidden') hidden += dt;
        if (b[4] === 'return') ret += dt;
        if (phases[phases.length - 1] !== b[4]) phases.push(b[4]);
      }
      return { samples: L.length, maxStep, maxOver, maxYawOver: maxYaw, offSand: bad, flee, hidden, ret, maxDt, phases };
    });
    assert.ok(c.path.samples > 50, 'frames were logged: ' + c.path.samples);
    assert.ok(c.path.maxOver <= 1e-6, 'never faster than its run (no teleport): ' + JSON.stringify(c.path));
    assert.ok(c.path.maxYawOver <= 1e-6, 'yaw is continuous');
    assert.equal(c.path.offSand, 0, 'every frame on the way to the mouth is on clear wet sand');
    assert.ok(Math.abs(c.path.hidden - clicked.state.hide) <= c.path.maxDt * 2 + 1e-6, 'hidden for the announced time: ' + c.path.hidden + ' vs ' + clicked.state.hide);
    assert.deepEqual(c.path.phases.filter(x => x !== 'routine'), ['flee', 'hidden', 'return']);

    // back out: hoverable again
    await page.waitForFunction(() => V3.sealife.crab.canStartle(), null, { timeout: 30000 });
    hovered = false;
    for (let i = 0; i < 10 && !hovered; i++) {
      p = await page.evaluate(() => window.__toys.aimCrab(true));
      await hover(p);
      hovered = await waitTip(CRAB_TIP, 1500).then(() => true, () => false);
    }
    assert.ok(hovered, 'after it came back out the crab is hoverable again');
    await shot('crab-back.png');
  }

  // ================= rebuild =================
  {
    const r = out.rebuild = {};
    // startle it again, then rebuild the whole scene: the new crab is on the plain schedule, the new chime is clickable
    const p0 = await page.evaluate(() => window.__toys.aimCrab(false));
    await page.mouse.move(p0.x, p0.y); await page.mouse.click(p0.x, p0.y); await sleep(150);
    r.startledBefore = await page.evaluate(() => V3.sealife.crab.state().startled);
    r.crab = await page.evaluate(async () => {
      const old = V3.sealife.crab;
      await V3.houseBlocks.rebuildScene({ keepGirl: true }); await window.__toys.settle(20);
      const k = V3.sealife.crab, s = k.state();
      return { fresh: k !== old, startled: s.startled, offset: s.offset, phase: s.phase };
    });
    assert.deepEqual(r.crab, { fresh: true, startled: false, offset: 0, phase: 'routine' });
    const p = await page.evaluate(async () => { await V3.view('floor=all'); await window.__toys.settle(8); return window.__toys.aimChime(0); });
    assert.ok(p && p.shown && p.clickable === 'chime');
    await hover(p); await waitTip(CHIME_TIP);
    const a = await page.evaluate(() => window.__toys.chimeStats());
    await page.mouse.click(p.x, p.y); await sleep(150);
    const b = await page.evaluate(() => window.__toys.chimeStats());
    r.chime = { rings: b.rings - a.rings, clinks: b.clinks - a.clinks };
    assert.equal(b.rings - a.rings, 1, 'the rebuilt chime rings on a click'); assert.equal(b.clinks - a.clinks, 1);
  }

  out.v3errors = await page.evaluate(n => (window.__errors || []).slice(n), errs0);
  out.errors = errors;
  out.posted = posted;
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(shots, 'toys-result.json'), JSON.stringify(out, null, 1));
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(out.v3errors, [], 'no V3.err entries from these interactions');
  assert.ok(!posted.some(s => /chime|crab/i.test(s)), 'nothing about the chime / crab is sent to the server');
  console.log('PASS cabin toys browser: chime + crab hover/click with real mouse events, no page errors.');
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
