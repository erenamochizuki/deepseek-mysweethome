// 「跟随」 camera mode in a real browser (Edge + SwiftShader) against an isolated staging build.
// No live services: every /api/* call is answered by a local fixture. Nothing is written outside the page and the
// screenshot folder. The button, the orbit drag, the wheel zoom, the pan attempt, hover and poke use real page.mouse.
//
//   CABIN_TEST_STAGE=<dir with home.html (+ cabin.html, cabin-bridge / gallery assets)>   (default ../_work/cabin-follow-20261112/web)
//   CABIN_TEST_SHOTS=<dir for screenshots + follow-result.json>                           (default: the parent of the stage dir)
//
// What it verifies on the real concatenated page:
//   switcher  four buttons 外观 / 一楼 / 阁楼 / 跟随 in one row, 跟随 rightmost, inside the viewport, clear of 布置 and of the
//             round buttons — at 1000×700, 430×810 and 360×740, on home.html and (if staged) cabin.html.
//   follow    a real click on 跟随 turns it on; she walks beach → door → ground floor → stairs → loft (her real goto on the
//             production nav); sampled once a second her head stays inside the canvas with a margin, the look-at point stays
//             on her, and the floor state (and the block house's own cutaway) matches where she is; at each stop she is
//             really visible: a real hover on her gets the 「小鲸鱼 · 戳一戳」 tooltip (the pick is blocked by walls / roofs).
//   input     drag-orbit and wheel-zoom while following stick; a right-drag (pan) changes nothing and does not end it;
//             a real click on her while the camera is following pokes her.
//   exits     一楼 → follow off, floor ground, camera flies to the preset; 跟随 pressed again → off, camera stays.
//   arrange   entering 布置 suspends it, leaving resumes with the view it had; a scene rebuild keeps it on.
//   tokens    ?view=follow=1 (and with girl=at_… indoors) is already in place at __READY.
//   no page errors, no new V3.err entries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const stage = process.env.CABIN_TEST_STAGE || '../_work/cabin-follow-20261112/web';
const shots = process.env.CABIN_TEST_SHOTS || path.dirname(path.resolve(stage));
fs.mkdirSync(shots, { recursive: true });
const assets = { 'home.html': 'text/html', 'cabin.html': 'text/html', 'cabin-gallery.js': 'text/javascript', 'cabin-bridge.js': 'text/javascript', 'cabin-gallery.css': 'text/css', 'cabin-bridge.css': 'text/css' };
// Same injection the real server does (cabin-bridge / cabin-gallery), so the HUD is laid out next to the bridge's own UI.
const has = (name) => fs.existsSync(path.join(stage, name));
const inject = ['cabin-bridge.css', 'cabin-gallery.css'].filter(has).map(f => `<link rel="stylesheet" href="/${f}">`).join('') +
  ['cabin-bridge.js', 'cabin-gallery.js'].filter(has).map(f => `<script defer src="/${f}"></script>`).join('');
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'home.html';
  if (!Object.hasOwn(assets, name) || !has(name)) return res.writeHead(204).end();
  let data = fs.readFileSync(path.join(stage, name), 'utf8');
  if (name.endsWith('.html')) data = data.replace('</body>', inject + '</body>');
  res.writeHead(200, { 'content-type': assets[name] + '; charset=utf-8' }).end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = { stage, shots: {}, samples: {} };
const GIRL_TIP = '小鲸鱼 · 戳一戳';
const QUERY = 'live=0&auto=0&wx=clear&time=noon&wind=0';
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  await context.route('**/*', route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== base) return route.abort();
    if (u.pathname === '/api/cabin/art') return route.fulfill({ json: { ok: true, drawings: [], diaries: [] } });
    if (u.pathname === '/api/cabin/timeline') return route.fulfill({ json: { ok: true, day: '2026-11-12', events: [], nextAfter: 0, hasMore: false } });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
    return req.method() === 'GET' ? route.continue() : route.abort();
  });
  const open = async (file, query) => {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(file + ': ' + e.message));
    await page.goto(`${base}/${file}?${query}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => window.__READY && V3.houseBlocks && V3.houseBlocks.grid && V3.houseBlocks.live() && V3.actor && V3.follow, null, { timeout: 120000 });
    await page.evaluate(() => {
      const px = (v) => { const p = v.clone().project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
      const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
      window.__errs0 = (window.__errors || []).length;
      window.__fc = {
        px, rect,
        async settle(n = 8) { await V3.waitReady(V3.models.current(), 30000); await V3.houseBlocks.live().ready; await V3.nextFrames(n); },
        // she only goes where the test sends her: no strolling (girl=idle), no routine behaviour starting half-way through a walk
        calm() { V3.viewTokens.girl('idle'); const a = V3.actor; if (!a.__quiet) { a.__quiet = true; a.startBehavior = () => false; } },
        sample() {
          const a = V3.actor, p = a.root.position, H = V3.houseBlocks.placedLayout().house, c = V3.R.ctl, live = V3.houseBlocks.live();
          const deep = p.x > H.x0 + 0.5 && p.x < H.x1 - 0.5 && p.z > H.z0 + 0.5 && p.z < H.z1 - 0.5;
          const outside = p.x < H.x0 - 0.5 || p.x > H.x1 + 0.5 || p.z < H.z0 - 0.5 || p.z > H.z1 + 0.5;
          const r2 = (v) => Math.round(v * 100) / 100 + 0;   // + 0: no -0
          return {
            pos: [r2(p.x), r2(p.y), r2(p.z)], v: r2(a._dbg.v), floor: V3.models.current().states.floor.value, house: live ? live.floor : null,
            expect: outside ? 'all' : deep && p.y < H.loftY - 1.2 ? 'ground' : deep && p.y > H.loftY - 0.7 ? 'loft' : null,
            head: px(a.head()), body: px(new THREE.Vector3(p.x, p.y + 0.55, p.z)), w: innerWidth, h: innerHeight,
            lag: r2(Math.hypot(c.target.x - p.x, c.target.z - p.z)), on: V3.follow.on(), active: V3.follow.state().active, zone: V3.follow.state().zone,
            view: { az: c.g.az, el: c.g.el, dist: c.g.dist }, goal: c.g.target.toArray(), cam: { az: r2(c.az), el: r2(c.el), dist: r2(c.dist), target: c.target.toArray().map(r2) },
            walk: window.__walk, fps: Math.round(V3.R.fps), pokes: a._dbg.pokes,
          };
        },
        tip() { const h = document.querySelector('.interaction-hover'); return h && !h.hidden ? { text: h.querySelector('.interaction-hover-tip').textContent, target: h.dataset.target } : null; },
        bar() {
          const bar = document.querySelector('.hud-floors'), kids = [...bar.children];
          return {
            labels: kids.map(b => b.textContent), on: kids.filter(b => b.classList.contains('on')).map(b => b.textContent), following: bar.classList.contains('following'),
            rects: kids.map(b => { const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }),
            bar: rect('.hud-floors'), arrange: rect('.hud-arrange'), corner: rect('.hud-corner'), w: innerWidth, h: innerHeight,
            cornerBtns: [...document.querySelectorAll('.hud-corner .hud-cell')].map(c => { const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }),
          };
        },
        loftPoint() {
          let s = 7; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }, H = V3.houseBlocks.placedLayout().house;
          for (let i = 0; i < 60; i++) { const q = V3.nav.randomPoint('loft', rnd); if (q && q[2] > H.loftY - 0.3 && Math.abs(q[0]) < 5) return q; }
          return null;
        },
      };
      window.__fc.calm();
    });
    await page.evaluate(() => window.__fc.settle(12));
    return page;
  };
  const sleep = (page, ms) => page.waitForTimeout(ms);
  // follow is active and the camera has finished flying: looking at her, at the goal angle / distance.
  // (Waits on the state, not on a fixed time: under SwiftShader the page runs at a few frames a second and its clock runs slow.)
  const onHer = (page, timeout = 30000) => page.waitForFunction(() => {
    const c = V3.R.ctl, p = V3.actor.root.position;
    return V3.follow.state().active && Math.hypot(c.target.x - p.x, c.target.z - p.z) < 0.03 && Math.abs(c.target.y - p.y - V3.follow.CONFIG.lift) < 0.03 && Math.abs(c.dist - c.g.dist) < 0.03 && Math.abs(c.az - c.g.az) < 0.005 && Math.abs(c.el - c.g.el) < 0.005;
  }, null, { timeout });
  // a real mouse click in the middle of an element (page.click needs element.checkVisibility, which this Edge build lacks);
  // it also checks that the element is the topmost thing at that point, i.e. not covered
  const clickEl = async (page, sel) => {
    const r = await page.evaluate((q) => {
      const e = document.querySelector(q); if (!e) return null;
      const b = e.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, top = document.elementFromPoint(x, y);
      return b.width && b.height ? { x, y, top: top === e || e.contains(top) } : null;
    }, sel);
    assert.ok(r, sel + ' is on screen'); assert.ok(r.top, sel + ' is not covered by something else');
    await page.mouse.click(r.x, r.y);
  };
  const sample = (page) => page.evaluate(() => window.__fc.sample());
  const shot = async (page, name) => { const f = path.join(shots, name); await page.screenshot({ path: f }); out.shots[name] = f; };
  const MARGIN = 40;
  const framed = (s, what) => {
    assert.ok(s.head.x > MARGIN && s.head.x < s.w - MARGIN && s.head.y > MARGIN && s.head.y < s.h - MARGIN, what + ': her head is inside the picture ' + JSON.stringify({ head: s.head, pos: s.pos, cam: s.cam }));
    assert.ok(s.body.x > MARGIN && s.body.x < s.w - MARGIN && s.body.y > MARGIN && s.body.y < s.h - MARGIN, what + ': her body is inside the picture ' + JSON.stringify(s.body));
  };
  const rightFloor = (s, what) => { if (s.expect) assert.equal(s.floor, s.expect, what + ': floor state matches where she is ' + JSON.stringify({ pos: s.pos, floor: s.floor })); };
  // her real goto; sampled once a second until she arrives
  const walk = async (page, name, x, z, y) => {
    await page.evaluate(([x, z, y]) => { window.__walk = null; V3.actor.goto(x, z, y).then(ok => { window.__walk = ok; }); }, [x, z, y]);
    const rows = [];
    for (let i = 0; i < 150; i++) {
      await sleep(page, 1000);
      const s = await sample(page); rows.push(s);
      framed(s, name + ' @' + i + 's'); rightFloor(s, name + ' @' + i + 's');
      assert.ok(s.on && s.active, name + ': still following');
      assert.ok(s.lag < 0.9, name + ' @' + i + 's: the camera looks at her (' + s.lag + ' m off)');
      if (s.walk !== null) break;
    }
    assert.equal(rows.at(-1).walk, true, name + ': she arrived ' + JSON.stringify(rows.at(-1).pos));
    out.samples[name] = rows.map(s => ({ pos: s.pos, v: s.v, floor: s.floor, lag: s.lag, head: [Math.round(s.head.x), Math.round(s.head.y)], fps: s.fps }));
    return rows;
  };
  // she is really visible and reachable: a real hover gets her tooltip (walls, roofs and floors block the pick)
  const hoverHer = async (page, what) => {
    let last = null;
    for (let i = 0; i < 6; i++) {
      const s = await sample(page), p = i % 2 ? { x: (s.body.x + s.head.x) / 2, y: (s.body.y + s.head.y) / 2 } : s.body;
      await page.mouse.move(p.x - 5, p.y - 3); await page.mouse.move(p.x, p.y);
      try { await page.waitForFunction(t => { const h = window.__fc.tip(); return h && h.text === t; }, GIRL_TIP, { timeout: 2500 }); return p; } catch (e) { last = await page.evaluate(() => window.__fc.tip()); }
    }
    assert.fail(what + ': hovering her shows 「' + GIRL_TIP + '」 (she is visible, nothing in the way); got ' + JSON.stringify(last));
  };
  const overlap = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  const layout = async (page, what) => {
    const b = await page.evaluate(() => window.__fc.bar());
    assert.deepEqual(b.labels, ['外观', '一楼', '阁楼', '跟随'], what);
    for (let i = 1; i < 4; i++) {
      assert.ok(b.rects[i].l >= b.rects[i - 1].r - 0.5, what + ': button ' + i + ' is to the right of button ' + (i - 1));
      assert.ok(Math.abs(b.rects[i].t - b.rects[0].t) < 1 && Math.abs(b.rects[i].b - b.rects[0].b) < 1, what + ': one row');
    }
    assert.ok(b.bar.l >= 0 && b.bar.r <= b.w && b.bar.b <= b.h && b.bar.t >= 0, what + ': the switcher is inside the viewport ' + JSON.stringify(b.bar));
    for (const r of b.rects) assert.ok(r.l >= b.bar.l && r.r <= b.bar.r + 0.5, what + ': every button is inside the pill');
    assert.ok(!overlap(b.bar, b.arrange), what + ': clear of 布置 ' + JSON.stringify([b.bar, b.arrange]));
    for (const c of b.cornerBtns) assert.ok(!overlap(b.bar, c), what + ': clear of the round buttons ' + JSON.stringify([b.bar, c]));
    return { bar: b.bar, arrange: b.arrange, corner: b.corner, on: b.on, gapToCorner: b.cornerBtns.length ? Math.round(Math.min(...b.cornerBtns.map(c => c.l)) - b.bar.r) : null };
  };

  // ================= home.html, desktop =================
  const page = await open('home.html', QUERY);
  out.build = await page.evaluate(() => window.__V3_BUILD);
  out.layout = { 'home 1000x700': await layout(page, 'home 1000x700') };
  {
    const s0 = await sample(page);
    assert.equal(s0.on, false); assert.equal(s0.floor, 'all');
    assert.deepEqual((await page.evaluate(() => window.__fc.bar())).on, ['外观']);
    out.hero = s0.cam;
  }

  // ---- a real click on 跟随 ----
  await clickEl(page, '.hud-follow');
  await onHer(page);
  {
    const s = await sample(page), b = await page.evaluate(() => window.__fc.bar());
    assert.equal(s.on, true); assert.equal(s.active, true); assert.deepEqual(b.on, ['外观', '跟随']); assert.equal(b.following, true);
    assert.equal(await page.evaluate(() => document.querySelector('.hud-follow').getAttribute('aria-pressed')), 'true');
    assert.equal(s.view.dist, 9); assert.equal(s.view.el, 0.55); assert.ok(Math.abs(s.cam.dist - 9) < 0.2, 'the camera flew in: ' + s.cam.dist);
    assert.ok(s.lag < 0.1, 'looking at her: ' + s.lag); framed(s, 'outside'); assert.equal(s.floor, 'all'); assert.equal(s.house, 'all');
    out.outside = { pos: s.pos, cam: s.cam, head: s.head };
    await hoverHer(page, 'outside');
    await page.mouse.move(500, 30);
    await shot(page, 'follow-outside.png');
  }

  // ---- beach → through the door → ground floor ----
  const H = await page.evaluate(() => { const h = V3.houseBlocks.placedLayout().house; return { floorY: h.floorY, loftY: h.loftY }; });
  const toGround = await walk(page, 'beach→ground', -1.5, -9.5, H.floorY);
  assert.deepEqual([...new Set(toGround.map(s => s.floor))], ['all', 'ground'], 'one switch on the way in');
  await page.evaluate(() => window.__fc.settle(10)); await onHer(page);
  {
    const s = await sample(page), b = await page.evaluate(() => window.__fc.bar());
    assert.equal(s.floor, 'ground'); assert.equal(s.house, 'ground', 'the block house is cut to the ground floor'); assert.deepEqual(b.on, ['一楼', '跟随']);
    framed(s, 'ground floor'); assert.ok(s.lag < 0.1);
    await hoverHer(page, 'ground floor');
    await page.mouse.move(500, 30);
    await shot(page, 'follow-ground.png');
    out.ground = { pos: s.pos, cam: s.cam };
  }

  // ---- up the stairs to the loft ----
  const up = await page.evaluate(() => window.__fc.loftPoint());
  assert.ok(up, 'a loft point');
  const toLoft = await walk(page, 'ground→loft', up[0], up[1], up[2]);
  assert.deepEqual([...new Set(toLoft.map(s => s.floor))], ['ground', 'loft'], 'one switch on the stairs');
  await page.evaluate(() => window.__fc.settle(10)); await onHer(page);
  {
    const s = await sample(page), b = await page.evaluate(() => window.__fc.bar());
    assert.ok(Math.abs(s.pos[1] - H.loftY) < 0.3, 'she is in the loft');
    assert.equal(s.floor, 'loft'); assert.equal(s.house, 'loft', 'the block house has its roof off'); assert.deepEqual(b.on, ['阁楼', '跟随']);
    framed(s, 'loft'); assert.ok(s.lag < 0.1);
    await hoverHer(page, 'loft');
    await page.mouse.move(500, 30);
    await shot(page, 'follow-loft.png');
    out.loft = { pos: s.pos, cam: s.cam };
  }

  // ---- orbit (drag) and zoom (wheel) stick while she walks on; pan does nothing ----
  {
    const s0 = await sample(page);
    await page.mouse.move(820, 180); await page.mouse.down(); await page.mouse.move(880, 200, { steps: 4 }); await page.mouse.move(940, 220, { steps: 4 }); await page.mouse.up();
    await page.mouse.wheel(0, -300);
    const s1 = await sample(page);
    assert.ok(Math.abs(s1.view.az - (s0.view.az - 0.96)) < 1e-6, 'drag 120 px → azimuth −0.96: ' + (s1.view.az - s0.view.az));
    assert.ok(Math.abs(s1.view.el - (s0.view.el + 0.32)) < 1e-6, 'drag 40 px down → elevation +0.32');
    assert.ok(s1.view.dist < s0.view.dist * 0.8, 'wheel zoomed in: ' + s1.view.dist);
    const p2 = await page.evaluate(() => { const a = V3.actor.pos, q = V3.nav.nearest(a[0] + 2.5, a[2] + 0.5, 3, a[1]) || V3.nav.nearest(a[0] - 2.5, a[2], 3, a[1]); return q; });
    assert.ok(p2, 'another loft point');
    const rows = await walk(page, 'loft stroll', p2[0], p2[1], p2[2]);
    const s2 = rows.at(-1);
    assert.deepEqual(s2.view, s1.view, 'the user view is kept exactly while following (no snap back)');
    await onHer(page);
    const s3 = await sample(page);
    assert.ok(Math.abs(s3.cam.az - s1.view.az) < 0.02 && Math.abs(s3.cam.el - s1.view.el) < 0.02 && Math.abs(s3.cam.dist - s1.view.dist) < 0.05, 'the camera sits at the user view: ' + JSON.stringify(s3.cam));
    framed(s3, 'after orbit + zoom'); assert.equal(s3.floor, 'loft');
    await shot(page, 'follow-orbit.png');
    // right-drag = pan: ignored, follow stays on, still looking at her
    await page.mouse.move(820, 180); await page.mouse.down({ button: 'right' }); await page.mouse.move(700, 260, { steps: 5 }); await page.mouse.up({ button: 'right' });
    await sleep(page, 600); await onHer(page);
    const s4 = await sample(page);
    assert.equal(s4.on, true); assert.ok(s4.lag < 0.1, 'pan did not move the look-at point: ' + s4.lag); assert.deepEqual(s4.view, s1.view);
    out.input = { drag: { az: s1.view.az - s0.view.az, el: s1.view.el - s0.view.el }, dist: [s0.view.dist, s1.view.dist], afterWalk: s3.cam, afterPan: s4.lag };
  }

  // ---- a real click on her while the camera follows her walking: she is poked ----
  {
    // the loft point furthest from her: a walk long enough to hover and click her on the way
    const far = await page.evaluate(() => {
      let s = 31; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }, a = V3.actor.pos, H = V3.houseBlocks.placedLayout().house;
      let best = null, bd = 0;
      for (let i = 0; i < 80; i++) { const q = V3.nav.randomPoint('loft', rnd); if (!q || q[2] < H.loftY - 0.3) continue; const d = Math.hypot(q[0] - a[0], q[1] - a[2]); if (d > bd) { bd = d; best = q; } }
      return best && { p: best, d: bd };
    });
    assert.ok(far && far.d > 4, 'a loft point a few metres away: ' + JSON.stringify(far));
    await page.evaluate(([x, z, y]) => { window.__walk = null; V3.actor.goto(x, z, y).then(ok => { window.__walk = ok; }); }, far.p);
    let s0 = null;
    for (let i = 0; i < 25 && !(s0 && s0.v > 0.5); i++) { await sleep(page, 200); s0 = await sample(page); }
    assert.ok(s0.v > 0.5, 'she is walking (' + s0.v + ' m/s) and the camera with her');
    const p = await hoverHer(page, 'walking in the loft');
    await page.mouse.click(p.x, p.y);
    await sleep(page, 400);
    const s1 = await sample(page);
    assert.equal(s1.pokes - s0.pokes, 1, 'one real click on her = one poke');
    assert.equal(s1.on, true, 'a click does not end follow mode');
    out.poke = { walking: s0.v, at: [Math.round(p.x), Math.round(p.y)], pokes: s1.pokes - s0.pokes };
    await page.mouse.move(500, 30);
    await sleep(page, 1500); await onHer(page);
  }

  // ---- 一楼: follow off, that floor, fly to its preset view (exactly what the button did before) ----
  {
    await clickEl(page, '.hud-floor[data-v="ground"]');
    const now = await sample(page), b = await page.evaluate(() => window.__fc.bar());
    assert.equal(now.on, false); assert.equal(now.floor, 'ground'); assert.deepEqual(b.on, ['一楼']); assert.equal(b.following, false);
    assert.equal(await page.evaluate(() => document.querySelector('.hud-follow').getAttribute('aria-pressed')), 'false');
    const preset = await page.evaluate(() => { const v = V3.models.current().views.inside; return { az: v.az, el: v.el, dist: v.dist, target: v.target }; });
    assert.deepEqual(now.view, { az: preset.az, el: preset.el, dist: preset.dist }, 'goal = the 一楼 preset');
    await page.waitForFunction(() => Math.abs(V3.R.ctl.dist - 17) < 0.03 && Math.abs(V3.R.ctl.az - 0.6) < 0.005 && Math.abs(V3.R.ctl.el - 0.75) < 0.005 && V3.R.ctl.target.distanceTo(V3.R.ctl.g.target) < 0.005, null, { timeout: 20000 }); await page.evaluate(() => window.__fc.settle(6));
    const s = await sample(page);
    assert.ok(Math.abs(s.cam.dist - 17) < 0.1 && Math.abs(s.cam.el - 0.75) < 0.01 && Math.abs(s.cam.az - 0.6) < 0.01, 'the camera is at the preset: ' + JSON.stringify(s.cam));
    assert.deepEqual(s.cam.target, preset.target); assert.equal(s.floor, 'ground', 'she is still upstairs but nothing follows her'); assert.equal(s.house, 'ground');
    out.floorButton = { cam: s.cam, girl: s.pos, floor: s.floor };
    await shot(page, 'follow-off-ground-preset.png');
  }

  // ---- 跟随 twice: on, then off with the camera left where it is ----
  {
    await clickEl(page, '.hud-follow'); await onHer(page);
    const a = await sample(page);
    assert.equal(a.on, true); assert.equal(a.floor, 'loft', 'she is in the loft: the cutaway went back to it'); assert.ok(a.lag < 0.1);
    await clickEl(page, '.hud-follow');
    const b = await sample(page);
    assert.equal(b.on, false); assert.deepEqual(b.view, a.view); assert.deepEqual(b.goal, a.goal, 'switching off does not touch the goal view');
    await sleep(page, 1200);
    const c = await sample(page);
    assert.deepEqual(c.goal, a.goal); assert.deepEqual(c.view, a.view);
    // (the camera was within 3 cm of its goal when 跟随 was pressed; it may finish easing onto it, nothing more)
    for (const k of ['az', 'el', 'dist']) assert.ok(Math.abs(c.cam[k] - a.cam[k]) <= 0.011, 'the camera stays where it was (' + k + '): ' + JSON.stringify([a.cam, c.cam]));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(c.cam.target[i] - a.cam.target[i]) <= 0.031, 'the camera stays where it was: ' + JSON.stringify([a.cam, c.cam]));
    assert.equal(c.floor, 'loft');
    assert.deepEqual((await page.evaluate(() => window.__fc.bar())).on, ['阁楼']);
  }

  // ---- arrange mode suspends it; leaving resumes with the view it had ----
  {
    await clickEl(page, '.hud-follow'); await onHer(page);
    const a = await sample(page);
    await clickEl(page, '.hud-arrange');
    await page.waitForFunction(() => V3.arrange.on, null, { timeout: 30000 });
    await sleep(page, 300);
    const st = await page.evaluate(() => V3.follow.state());
    assert.deepEqual({ on: st.on, active: st.active, suspended: st.suspended }, { on: true, active: false, suspended: true });
    await page.mouse.move(820, 300); await page.mouse.wheel(0, 900);       // the user zooms out and pans while arranging
    await page.mouse.down({ button: 'right' }); await page.mouse.move(700, 380, { steps: 5 }); await page.mouse.up({ button: 'right' });
    await sleep(page, 800);
    const mid = await sample(page);
    assert.ok(mid.view.dist > a.view.dist * 2, 'arrange: zoom is the user\'s'); assert.ok(mid.lag > 0.3, 'arrange: pan works, the camera is not pulled back to her (' + mid.lag + ')');
    assert.equal(mid.floor, a.floor);
    await page.evaluate(() => V3.arrange.done());
    await page.waitForFunction(() => !V3.arrange.on, null, { timeout: 30000 });
    await onHer(page);
    const b = await sample(page);
    assert.equal(b.active, true); assert.deepEqual(b.view, a.view, 'back to the follow view'); assert.ok(b.lag < 0.1, 'and on her again: ' + b.lag);
    out.arrange = { during: { dist: mid.view.dist, lag: mid.lag }, after: b.cam };
  }

  // ---- a scene rebuild (house change / re-show): still following, the new actor, the new switcher ----
  {
    const r = await page.evaluate(async () => {
      const a0 = V3.actor, m0 = V3.models.current();
      await V3.houseBlocks.rebuildScene({ keepGirl: true });
      window.__fc.calm(); await window.__fc.settle(20);
      return { freshActor: V3.actor !== a0, freshModel: V3.models.current() !== m0, on: V3.follow.on() };
    });
    assert.deepEqual(r, { freshActor: true, freshModel: true, on: true });
    await onHer(page);
    const s = await sample(page), b = await page.evaluate(() => window.__fc.bar());
    assert.equal(s.active, true); assert.ok(s.lag < 0.1); assert.equal(s.floor, 'loft'); assert.equal(s.house, 'loft'); assert.deepEqual(b.on, ['阁楼', '跟随']);
    framed(s, 'after rebuild');
    out.rebuild = { ...r, floor: s.floor, lag: s.lag };
  }

  // ---- narrow / mobile layouts (same page, she is put on the ground floor so two buttons are lit) ----
  for (const [w, h] of [[430, 810], [360, 740]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(async () => { V3.actor.place(-1.5, -9.5, 0, 1); await V3.nextFrames(4); });
    await onHer(page); await page.evaluate(() => window.__fc.settle(6));
    const name = `home ${w}x${h}`;
    out.layout[name] = await layout(page, name);
    const s = await sample(page);
    assert.equal(s.floor, 'ground'); assert.deepEqual(out.layout[name].on, ['一楼', '跟随']); framed(s, name);
    await shot(page, `follow-mobile-${w}.png`);
  }
  out.v3errors = await page.evaluate(() => (window.__errors || []).slice(window.__errs0));
  await page.close();

  // ================= cabin.html (the page with the feedback button: three round buttons) =================
  if (has('cabin.html')) {
    const cabin = await open('cabin.html', QUERY);
    // also the widths just either side of the two narrow-screen breakpoints (560 / 420) and the narrowest supported one (352)
    for (const [w, h] of [[1000, 700], [561, 800], [560, 800], [430, 810], [421, 800], [420, 800], [352, 740], [360, 740]]) {
      await cabin.setViewportSize({ width: w, height: h }); await cabin.evaluate(() => V3.nextFrames(4));
      out.layout[`cabin ${w}x${h}`] = await layout(cabin, `cabin ${w}x${h}`);
    }
    await clickEl(cabin, '.hud-follow'); await onHer(cabin);
    assert.equal((await sample(cabin)).on, true);
    await shot(cabin, 'follow-cabin-mobile-360.png');
    out.v3errors = out.v3errors.concat(await cabin.evaluate(() => (window.__errors || []).slice(window.__errs0)));
    await cabin.close();
  }

  // ================= tokens: already in place when the page says __READY =================
  {
    const a = await context.newPage();
    a.on('pageerror', e => errors.push('token: ' + e.message));
    await a.goto(`${base}/home.html?${QUERY}&view=girl=at_-1.5_-9.5_0_1+follow=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await a.waitForFunction(() => window.__READY, null, { timeout: 120000 });
    const r = await a.evaluate(() => {
      const c = V3.R.ctl, p = V3.actor.root.position, live = V3.houseBlocks.live();
      return { on: V3.follow.on(), floor: V3.models.current().states.floor.value, house: live && live.floor, dist: c.dist, el: c.el, lag: Math.hypot(c.target.x - p.x, c.target.z - p.z),
        lit: [...document.querySelectorAll('.hud-floors .on')].map(b => b.textContent), errors: (window.__errors || []).slice() };
    });
    assert.equal(r.on, true); assert.equal(r.floor, 'ground'); assert.equal(r.house, 'ground', 'the cutaway is already meshed at __READY');
    assert.equal(r.dist, 9); assert.equal(r.el, 0.55); assert.ok(r.lag < 1e-6, 'snapped onto her: ' + r.lag); assert.deepEqual(r.lit, ['一楼', '跟随']);
    assert.deepEqual(r.errors, []);
    await shot(a, 'follow-token-ground.png');
    await a.evaluate(() => V3.view('follow=0'));
    assert.equal(await a.evaluate(() => V3.follow.on()), false);
    out.token = r;
    await a.close();
  }

  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(shots, 'follow-result.json'), JSON.stringify(out, null, 1));
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(out.v3errors, [], 'no V3.err entries');
  console.log('PASS cabin follow browser: real 跟随 button, walk beach → ground floor → loft framed with the right cutaway, orbit / zoom stick, exits, arrange, rebuild, tokens, layouts.');
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
