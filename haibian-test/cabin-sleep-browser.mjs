// The night routine in a real browser (Edge + SwiftShader) against an isolated staging build: she goes to bed, a private reply gets her
// to the computer, 5 minutes after the last reply she is back in bed, at 08:00 she gets up. Close-up screenshots of each stage.
// No live services: every /api/* call is answered by a local fixture; nothing is written outside the page and the screenshot folder.
//
//   CABIN_TEST_STAGE=<dir with home.html + cabin-bridge/gallery assets>   (default D:/Dafeiyu/_work/cabin-sleep-20261112/web)
//   CABIN_TEST_SHOTS=<dir for screenshots + sleep-result.json>            (default: the parent of the stage dir)
//
// The clock: an init script replaces Date before any page script runs, so the page believes it is 01:58 Shanghai time (Date.now(),
// new Date() and the scene's real-time lighting all follow it; it keeps running at real speed). window.__clockSkip(ms) moves it
// forward, used for the long waits (the 5 minutes at the computer, the rest of the night).
// The reply: handed to V3.cabinRoutine.acceptEvents in the shape cabin-bridge.js passes on from /api/cabin/state (cabinActivityEvents).
// ?auto=1: an automated browser gets no timers otherwise (60-game), and the night routine is one of them.
// Bed props (2026-11-12 night): the folded pyjamas + nightcap baked into the block bed are drawn as their own small mesh
// (V3.houseBlocks.bedProps()) and must be hidden while she lies asleep, back whenever she is up. Checked by state and by pixels: the
// screen rectangle of the props is shot with the props mesh on and off; while she is asleep the shown frame equals the "off" frame and
// differs from the "on" frame, while she is up it equals the "on" frame (bedprops-*.png).
// Sleep polish (2026-11-13 night):
//  - the model's own idle (蓝色大肥鱼 parallel_7 → idle_1, the rice-bowl bit, after ~38 s standing still) must never play while she
//    lies in bed or sits at the computer: every frame of the run is sampled (slot state of parallel_7 + the model's idle timer) and she
//    stays asleep for at least 90 s of her own time before the night reply;
//  - the hover outline in bed only outlines what is visible: one frame rendered three ways (scene, scene without her, outline only) from
//    three cameras around the bed; outline pixels farther than 5 px from her visible pixels are leaks (hover-bed-*.png: yellow = outline
//    next to her, red = leak). Old code: 152 / 2514 / 50 leak pixels. Plus a real mouse hover on her head (interaction-hover → outline).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'file:///D:/Dafeiyu/surfcore/node_modules/playwright/index.mjs';

const stage = process.env.CABIN_TEST_STAGE || 'D:/Dafeiyu/_work/cabin-sleep-20261112/web';
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
const out = { stage, shots: {}, steps: [], late: [] };
// the two sleep-polish checks (outline leaks, idle_1) are collected and asserted at the end, so one run against old code shows both
const late = (ok, msg) => { if (!ok) out.late.push(msg); };
const START = '2026-11-13T01:58:00+08:00';
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage(), errors = [], posted = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(start => {
    const Real = Date; let skew = Real.parse(start) - Real.now();
    class Fake extends Real {
      constructor(...a) { if (a.length) super(...a); else super(Real.now() + skew); }
      static now() { return Real.now() + skew; }
    }
    window.Date = Fake;
    window.__clockSkip = ms => { skew += ms; };
  }, START);
  await context.route('**/*', route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== base) return route.abort();
    if (req.method() !== 'GET') posted.push({ path: u.pathname, body: (req.postData() || '').slice(0, 2000) });
    if (u.pathname === '/api/cabin/art') return route.fulfill({ json: { ok: true, drawings: [], diaries: [] } });
    if (u.pathname === '/api/cabin/timeline') return route.fulfill({ json: { ok: true, day: '2026-11-13', events: [], nextAfter: 0, hasMore: false } });
    if (u.pathname === '/api/cabin/behavior') {
      let ids = []; try { ids = JSON.parse(req.postData() || '{}').events.map(e => e.id); } catch (e) { /* malformed: ack nothing */ }
      return route.fulfill({ json: { ok: true, ackIds: ids } });
    }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
    return req.method() === 'GET' ? route.continue() : route.abort();
  });
  await page.goto(`${base}/home.html?auto=1&wx=clear&wind=0`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__READY && V3.houseBlocks && V3.houseBlocks.grid && V3.houseBlocks.live() && V3.actor && V3.cabinNight, null, { timeout: 90000 });
  out.build = await page.evaluate(() => window.__V3_BUILD);
  const errs0 = await page.evaluate(() => (window.__errors || []).length);

  await page.evaluate(async () => {
    await V3.houseBlocks.live().ready; await V3.view('floor=ground'); await V3.nextFrames(8);
    const shanghai = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    window.__said = []; const say = V3.bubble.say;                      // every bubble of the night, with the Shanghai time
    V3.bubble.say = function (id, text, o) { window.__said.push([shanghai.format(Date.now()), String(text)]); return say.call(this, id, text, o); };
    window.__sleep = {
      CAMS: {
        bed: { az: 0.9, el: 0.55, dist: 4.2, target: [-5.3, 1.5, -14] },      // from the south-east, above
        bedTop: { az: 0, el: 1.45, dist: 4.5, target: [-5.4, 1.5, -14] },
        bedFoot: { az: 0.05, el: 0.35, dist: 3.4, target: [-5.4, 1.6, -14.2] },
        room: { az: 0.75, el: 0.7, dist: 9, target: [-4.6, 1.5, -12.3] },      // bed and desk together
      },
      async cam(c) { V3.R.ctl.set(typeof c === 'string' ? this.CAMS[c] : c, false); await V3.nextFrames(4); },
      // camera on the desk chair, from the side the chair is open to
      async camDesk() {
        const c = V3.houseBlocks.furnInstances('desk_chair')[0].cell;
        await this.cam({ az: 1.25, el: 0.42, dist: 4.4, target: [c[0] + 0.2, c[1] + 0.75, c[2] + 0.5] });
      },
      state() {
        const a = V3.actor, r = a.root.position, L = a.lying, cover = [];
        V3.models.current().root.traverse(o => { if (o.name === 'bed-sleep-cover') cover.push(o.visible); });
        const head = a.inst.bones.head.getWorldPosition(new THREE.Vector3());
        return { time: shanghai.format(Date.now()), behavior: a.behavior, state: a.state, resting: a.resting, root: r.toArray().map(v => +v.toFixed(3)), rotX: +a.root.rotation.x.toFixed(3),
          head: head.toArray().map(v => +v.toFixed(3)), lying: L && { k: L.k, cover: L.cover, head: L.head.map(v => +v.toFixed(3)) }, covers: cover,
          variant: V3.furn.variant('bed'), anim: a.inst.actorAnimation, expr: a.inst.states.expr.value, night: V3.cabinNight.state(),
          env: { hour: V3.env && V3.env.state ? V3.env.state.hour : null, time: V3.models.current().states.time.value } };
      },
      bed() { const c = V3.houseBlocks.furnInstances('bed')[0].cell; return { x0: c[0], x1: c[0] + 1, z0: c[2], z1: c[2] + 2, y: c[1] }; },
      chair() { const c = V3.houseBlocks.furnInstances('desk_chair')[0].cell; return [c[0] + 0.5, c[2] + 0.5]; },
      bubble() { const b = V3.bubble.list ? V3.bubble.list() : []; return JSON.stringify(b).slice(0, 300); },
      props() { return V3.houseBlocks.bedProps().map(p => ({ shown: p.shown, asleep: p.asleep, cells: p.cells })); },
      // screen rectangle (CSS px, padded) of the props mesh from the current camera
      propsRect() {
        const p = V3.houseBlocks.bedProps()[0], box = new THREE.Box3().setFromObject(p.object), r = V3.R.canvas.getBoundingClientRect();
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < 8; i++) {
          const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(V3.R.camera);
          const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        const pad = 6; x0 = Math.max(r.left, Math.floor(x0 - pad)); y0 = Math.max(r.top, Math.floor(y0 - pad));
        return { x: x0, y: y0, width: Math.min(r.right, Math.ceil(x1 + pad)) - x0, height: Math.min(r.bottom, Math.ceil(y1 + pad)) - y0 };
      },
      async forceProps(v) { const p = V3.houseBlocks.bedProps()[0]; const was = p.object.visible; p.object.visible = v; await V3.nextFrames(3); return was; },
      // she breathes / idles between the three crops: take her (and only her) out of the picture while they are shot
      async still(on) { V3.actor.root.visible = !on; await V3.nextFrames(3); },
      // the model's own idle animation, sampled every frame from here on (asleep / seated time in her own clock)
      idle: { frames: 0, idle1: [], maxTimer: 0, asleepSecs: 0, seatedSecs: 0, last: null },
      watchIdle() {
        const I = this.idle, a = V3.actor;
        const tick = () => {
          const inst = a.inst, s = inst.slotInfo && inst.slotInfo().find(x => x.key === 'parallel_7'), b = a.behavior;
          const now = performance.now(), dt = I.last == null ? 0 : Math.min(0.1, (now - I.last) / 1000);   // her time = 01-render's clamped frame delta
          I.last = now;
          const posed = !!(a.lying || (b && b.phase === 'action' && a.state === 'furniture'));
          if (b && b.kind === 'sleep' && b.phase === 'action' && a.lying && a.lying.k === 1) I.asleepSecs += dt;
          else if (posed) I.seatedSecs += dt;
          I.frames++;
          if (posed) {
            const t = inst.getVar ? inst.getVar('timer') : 0; if (t > I.maxTimer) I.maxTimer = t;
            if (s && (s.ctrl === 'idle_1' || s.act.includes('idle_1')) && I.idle1.length < 20) I.idle1.push({ kind: b && b.kind, phase: b && b.phase, asleep: +I.asleepSecs.toFixed(1), seated: +I.seatedSecs.toFixed(1) });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      // one frame, no animation step in between: A = scene, B = scene without her, C = only the hover outline (on transparent black)
      async outlineLeak(cam) {
        const R = V3.R, r = R.renderer, sc = R.scene, ca = R.camera, a = V3.actor, c = new THREE.Vector3();
        a.root.getWorldPosition(c);
        R.ctl.set({ ...cam, target: [c.x, c.y + 0.1, c.z] }, false); await V3.nextFrames(4);
        const sz = r.getDrawingBufferSize(new THREE.Vector2()), w = sz.x, h = sz.y;
        const mk = () => new THREE.WebGLRenderTarget(w, h), A = mk(), B = mk(), C = mk();
        const read = t => { const b = new Uint8Array(w * h * 4); r.readRenderTargetPixels(t, 0, 0, w, h, b); return b; };
        const au = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
        try {
          r.setRenderTarget(A); r.render(sc, ca);
          a.root.visible = false; r.setRenderTarget(B); r.render(sc, ca); a.root.visible = true;
          V3.hoverOutline.set([a.root]);
          r.setRenderTarget(C); r.setClearColor(0, 0); r.clear(); V3.hoverOutline.render(r, sc, ca);
        } finally { r.setRenderTarget(null); r.shadowMap.autoUpdate = au; a.root.visible = true; V3.hoverOutline.clear(); }
        const pa = read(A), pb = read(B), pc = read(C); for (const t of [A, B, C]) t.dispose();
        const her = new Uint8Array(w * h), ol = new Uint8Array(w * h), near = new Uint8Array(w * h), P = 5;
        for (let i = 0; i < w * h; i++) { const k = i * 4; her[i] = Math.abs(pa[k] - pb[k]) + Math.abs(pa[k + 1] - pb[k + 1]) + Math.abs(pa[k + 2] - pb[k + 2]) > 6 ? 1 : 0; ol[i] = pc[k + 3] > 20 ? 1 : 0; }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (her[y * w + x]) for (let dy = -P; dy <= P; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -P; dx <= P; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) near[yy * w + xx] = 1; } }
        let olN = 0, leak = 0, herN = 0; for (let i = 0; i < w * h; i++) { herN += her[i]; if (ol[i]) { olN++; if (!near[i]) leak++; } }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d'), im = cx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (h - 1 - y) * w + x, o = (y * w + x) * 4, k = i * 4;
          if (ol[i]) { im.data[o] = 255; im.data[o + 1] = near[i] ? 220 : 0; im.data[o + 2] = 0; } else { im.data[o] = pa[k]; im.data[o + 1] = pa[k + 1]; im.data[o + 2] = pa[k + 2]; } im.data[o + 3] = 255; }
        cx.putImageData(im, 0, 0);
        return { herPixels: herN, outlinePixels: olN, leakPixels: leak, png: cv.toDataURL('image/png').split(',')[1] };
      },
    };
    window.__sleep.watchIdle();
  });
  const st = () => page.evaluate(() => window.__sleep.state());
  const shot = async (name, cam) => {
    if (cam === 'desk') await page.evaluate(() => window.__sleep.camDesk()); else if (cam) await page.evaluate(c => window.__sleep.cam(c), cam);
    const f = path.join(shots, name); await page.screenshot({ path: f }); out.shots[name] = f;
  };
  const log = (step, s) => { out.steps.push({ step, time: s.time, behavior: s.behavior, state: s.state, variant: s.variant, covers: s.covers, root: s.root, anim: s.anim && s.anim.base }); };
  const asleep = () => page.waitForFunction(() => { const b = V3.actor.behavior; return b && b.kind === 'sleep' && b.phase === 'action' && V3.actor.lying && V3.actor.lying.k === 1; }, null, { timeout: 120000 });
  const inBed = (s, what) => {
    assert.equal(s.behavior && s.behavior.kind, 'sleep', what); assert.equal(s.behavior.phase, 'action', what);
    assert.equal(s.variant, 'sleeping', what + ': bed variant'); assert.deepEqual(s.covers, [true], what + ': one visible quilt cover');
    for (const [n, p] of [['root', s.root], ['head', s.head]]) assert.ok(p[0] > bed.x0 && p[0] < bed.x1 && p[2] > bed.z0 && p[2] < bed.z1 && p[1] > bed.y + 0.3, `${what}: ${n} in the bed footprint ${p}`);
    assert.equal(s.anim.base, 'extra:extra13', what + ': lying clip'); assert.equal(s.expr, 'sleep', what + ': eyes closed'); assert.equal(s.resting, true);
  };
  const bed = await page.evaluate(() => window.__sleep.bed());
  // the props rectangle shot three ways from a fixed close camera: as the page draws it now, forced on, forced off.
  // Pixels compared as mean absolute difference per channel (0..255). The scene is still (no wind, she does not move while asleep / standing).
  // decoded in the page (no PNG decoder in node_modules here): two screenshots → mean absolute difference
  const mad = (a, b) => page.evaluate(async ([x, y]) => {
    const px = async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, img.width, img.height).data;
    };
    const A = await px(x), B = await px(y); let s = 0;
    for (let i = 0; i < A.length; i += 4) for (let k = 0; k < 3; k++) s += Math.abs(A[i + k] - B[i + k]);
    return s / (A.length / 4 * 3);
  }, [a.toString('base64'), b.toString('base64')]);
  const propsShots = async (tag) => {
    await page.evaluate(() => window.__sleep.cam('bedTop'));
    const clip = await page.evaluate(() => window.__sleep.propsRect());
    await page.evaluate(() => window.__sleep.still(true));
    const now = await page.screenshot({ clip });
    const was = await page.evaluate(() => window.__sleep.forceProps(true));
    const on = await page.screenshot({ clip });
    await page.evaluate(() => window.__sleep.forceProps(false));
    const off = await page.screenshot({ clip });
    await page.evaluate(v => window.__sleep.forceProps(v), was);
    await page.evaluate(() => window.__sleep.still(false));
    for (const [n, b] of [['now', now], ['on', on], ['off', off]]) { const f = path.join(shots, 'bedprops-' + tag + '-' + n + '.png'); fs.writeFileSync(f, b); out.shots['bedprops-' + tag + '-' + n + '.png'] = f; }
    await shot('bedprops-' + tag + '-full.png');
    const d = { clip, nowOn: await mad(now, on), nowOff: await mad(now, off), onOff: await mad(on, off), wasVisible: was };
    (out.bedProps = out.bedProps || {})[tag] = d;
    return d;
  };
  const propsUp = async (tag) => {
    const p = await page.evaluate(() => window.__sleep.props());
    assert.equal(p.length, 1, tag + ': one pyjama + nightcap mesh'); assert.equal(p[0].shown, true, tag + ': pyjamas and nightcap shown'); assert.equal(p[0].asleep, false);
    const d = await propsShots(tag);
    if (d.onOff != null) { assert.ok(d.onOff > 2, tag + ': the props are really visible in that rectangle (on vs off differ): ' + d.onOff.toFixed(2)); assert.ok(d.nowOn < 0.5, tag + ': what is drawn = props on: ' + d.nowOn.toFixed(2)); }
    return d;
  };
  const propsDown = async (tag) => {
    const p = await page.evaluate(() => window.__sleep.props());
    assert.equal(p[0].shown, false, tag + ': pyjamas and nightcap hidden'); assert.equal(p[0].asleep, true);
    const d = await propsShots(tag);
    if (d.onOff != null) { assert.ok(d.onOff > 2, tag + ': they would show in that rectangle: ' + d.onOff.toFixed(2)); assert.ok(d.nowOff < 0.5, tag + ': what is drawn = props off: ' + d.nowOff.toFixed(2)); }
    return d;
  };
  // ---- 0. before she lies down (she starts walking to bed at once): the props are on the bed ----
  await page.evaluate(() => window.__sleep.cam('bedTop'));
  out.propsBefore = await page.evaluate(() => window.__sleep.props());
  assert.equal(out.propsBefore.length, 1); assert.equal(out.propsBefore[0].shown, true, 'pyjamas and nightcap on the made bed');
  await shot('bedprops-0-before.png');

  // ---- 1. page opened at 01:58: it is night in the scene and she goes to bed on her own ----
  const s0 = await st();
  out.opened = s0;
  assert.equal(s0.night.enabled, true); assert.equal(s0.night.window, true); assert.equal(s0.env.time, 'real');
  await page.evaluate(() => window.__sleep.cam('room'));
  await page.waitForFunction(() => V3.actor.behavior && V3.actor.behavior.kind === 'sleep', null, { timeout: 30000 });
  log('to bed', await st());
  await shot('sleep-1-walking-to-bed.png', 'room');
  await page.waitForFunction(() => V3.actor.behavior && V3.actor.behavior.phase === 'lie', null, { timeout: 90000 });
  await page.waitForTimeout(450);
  await shot('sleep-2-lying-down.png', 'bed');
  await asleep();
  // the first quiet Zzz comes 5-10 s (of her own time) after she fell asleep
  await page.evaluate(() => window.__sleep.cam('bed'));
  await page.waitForFunction(() => window.__said.some(x => /^(Zzz…|z z Z…|呼……)$/.test(x[1])), null, { timeout: 90000 });
  await page.waitForTimeout(500);
  await shot('sleep-3-zzz.png', 'bed');
  await page.waitForTimeout(2500);
  const s1 = await st(); log('asleep', s1); out.asleep = s1;
  inBed(s1, 'asleep');
  await propsDown('1-asleep');
  // ---- 1b. hover outline in bed: only what is visible of her gets an outline ----
  out.hoverBed = {};
  // measured in daylight (only the lighting token changes): at night her dark hair barely differs from the dark bed and the
  // "her visible pixels" mask would miss edge pixels that are really hers
  await page.evaluate(async () => { await V3.view('time=noon'); await V3.nextFrames(6); });
  for (const [tag, cam] of [['side', { az: 0.9, el: 0.55, dist: 2.6 }], ['top', { az: 0.2, el: 1.2, dist: 2.6 }], ['foot', { az: 3.0, el: 0.5, dist: 2.6 }]]) {
    const m = await page.evaluate(c => window.__sleep.outlineLeak(c), cam);
    const f = path.join(shots, 'hover-bed-' + tag + '.png'); fs.writeFileSync(f, Buffer.from(m.png, 'base64')); out.shots['hover-bed-' + tag + '.png'] = f; delete m.png;
    out.hoverBed[tag] = m;
    assert.ok(m.herPixels > 5000 && m.outlinePixels > 500, tag + ': she is in view and outlined ' + JSON.stringify(m));
    late(m.leakPixels <= 30, tag + ': no outline around parts under the quilt / blanket: ' + JSON.stringify(m));
  }
  await page.evaluate(async () => { await V3.view('time=real'); await V3.nextFrames(6); });
  { // a real mouse hover on her head on the pillow: interaction-hover picks her and the outline pass runs
    await page.evaluate(() => window.__sleep.cam({ az: 0.9, el: 0.55, dist: 2.6, target: V3.actor.lying.head }));
    const hp = await page.evaluate(() => { const p = new THREE.Vector3(...V3.actor.lying.head).project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; });
    await page.mouse.move(hp.x, hp.y); await page.waitForTimeout(500);
    out.hoverReal = await page.evaluate(async () => { await V3.nextFrames(3); return { target: document.querySelector('.interaction-hover') && document.querySelector('.interaction-hover').dataset.target, meshes: V3.hoverOutline.stats.meshes, passes: V3.hoverOutline.stats.passes }; });
    await shot('hover-bed-real.png');
    await page.mouse.move(3, 3); await page.waitForTimeout(300);
    assert.equal(out.hoverReal.target, 'girl', 'hovering her head in bed targets her'); assert.ok(out.hoverReal.meshes > 0 && out.hoverReal.passes === 2, 'outline drawn');
  }
  // ---- 1c. asleep for 90 s of her own time: the model's own idle animation (idle_1) never comes ----
  await page.waitForFunction(() => window.__sleep.idle.asleepSecs >= 90 || window.__sleep.idle.idle1.length, null, { timeout: 400000, polling: 1000 });
  out.idleAsleep = await page.evaluate(() => ({ ...window.__sleep.idle, last: undefined }));
  late(out.idleAsleep.asleepSecs >= 90, 'asleep 90 s without idle_1: ' + out.idleAsleep.asleepSecs.toFixed(1));
  late(out.idleAsleep.idle1.length === 0, 'no idle_1 while asleep: ' + JSON.stringify(out.idleAsleep.idle1.slice(0, 3)));
  inBed(await st(), 'after 90 s asleep');
  await shot('sleep-3-asleep.png', 'bed');
  await shot('sleep-3-asleep-top.png', 'bedTop');
  await shot('sleep-3-asleep-foot.png', 'bedFoot');
  await shot('sleep-3-asleep-room.png', 'room');
  // the same moment in daylight (only the lighting token changes), so the art can be judged
  await page.evaluate(async () => { await V3.view('time=noon'); await V3.nextFrames(6); });
  await shot('sleep-3-asleep-daylight.png', 'bed');
  await shot('sleep-3-asleep-daylight-top.png', 'bedTop');
  await page.evaluate(async () => { await V3.view('time=real'); await V3.nextFrames(6); });
  // ---- 2. she really replied to a private message: up, to the computer, typing, waiting ----
  await page.evaluate(() => window.__clockSkip(60 * 60000));          // 03:0x
  const fed = await page.evaluate(() => { const at = Date.now(); V3.cabinRoutine.acceptEvents([{ id: 'reply-1', at, action: 'reply_private' }]); return at; });
  await page.waitForFunction(() => V3.actor.behavior && V3.actor.behavior.kind === 'reply_private', null, { timeout: 15000 });
  const s2 = await st(); log('woken', s2);
  assert.equal(s2.behavior.hold, true); assert.equal(s2.variant, 'made', 'the bed is made when she gets up'); assert.deepEqual(s2.covers, [false]);
  { const p = await page.evaluate(() => window.__sleep.props()); assert.equal(p[0].shown, true, 'woken by the reply: pyjamas and nightcap back'); }
  await page.waitForFunction(() => V3.actor.behavior && V3.actor.behavior.kind === 'reply_private' && V3.actor.behavior.phase === 'action', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const s3 = await st(); log('typing', s3); out.typing = s3;
  const chair = await page.evaluate(() => window.__sleep.chair());
  assert.equal(s3.state, 'furniture'); assert.ok(Math.hypot(s3.root[0] - chair[0], s3.root[2] - chair[1]) < 0.6, 'seated on the desk chair');
  assert.equal(s3.anim.base, 'tlm:keyboard');
  await shot('sleep-4-at-computer.png', 'desk');
  await shot('sleep-4-at-computer-room.png', 'room');
  // typing is over after 12 s of her own (simulated) time; she stays seated. SwiftShader runs slower than real time, so wait for it.
  await page.waitForFunction(() => V3.actor.inst.actorAnimation.base === 'main:sit', null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const s4 = await st(); log('waiting', s4);
  await propsUp('2-at-computer');
  assert.equal(s4.behavior.kind, 'reply_private'); assert.equal(s4.state, 'furniture'); assert.equal(s4.anim.base, 'main:sit', 'sits and waits');
  await shot('sleep-5-waiting.png', 'desk');
  // +3 min: a second reply restarts the wait
  await page.evaluate(() => window.__clockSkip(3 * 60000 - 20000));
  await page.evaluate(() => V3.cabinRoutine.acceptEvents([{ id: 'reply-2', at: Date.now(), action: 'reply_private' }]));
  const t1 = await page.evaluate(() => Date.now());
  await page.waitForTimeout(2500);
  const s5 = await st(); log('second reply', s5);
  assert.equal(s5.anim.base, 'tlm:keyboard', 'types again'); assert.equal(s5.behavior.kind, 'reply_private');
  await page.evaluate(() => window.__clockSkip(4 * 60000 + 30000));   // 4.5 min after the second reply (6.5 after the first)
  await page.waitForTimeout(4000);
  const s6 = await st(); log('4.5 min after the last reply', s6);
  assert.equal(s6.behavior && s6.behavior.kind, 'reply_private', 'still at the computer before the 5 minutes are over');
  // the last half minute in real time
  await page.waitForFunction(() => V3.actor.behavior && V3.actor.behavior.kind === 'sleep', null, { timeout: 60000 });
  out.leftAfterMs = await page.evaluate(t => Date.now() - t, t1);
  assert.ok(out.leftAfterMs >= 5 * 60000 && out.leftAfterMs < 5 * 60000 + 8000, 'left the computer 5 minutes after the last reply: ' + out.leftAfterMs);
  await shot('sleep-6-walking-back.png', 'room');
  await asleep();
  await page.waitForTimeout(700);
  const s7 = await st(); log('back in bed', s7); out.back = s7;
  inBed(s7, 'back in bed');
  { const p = await page.evaluate(() => window.__sleep.props()); assert.equal(p[0].shown, false, 'back in bed: hidden again'); }
  await shot('sleep-7-back-in-bed.png', 'bed');
  await shot('sleep-7-back-in-bed-room.png', 'room');

  // ---- 3. poke her with a real click: a sleepy answer, no wandering, back to bed ----
  await page.evaluate(() => window.__sleep.cam('bed'));
  const hp = await page.evaluate(() => { const p = new THREE.Vector3(...V3.actor.lying.head).project(V3.R.camera), r = V3.R.canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; });
  const pokes0 = await page.evaluate(() => { window.__pokeText = null; V3.on('actor:poke', e => { window.__pokeText = e.text; }); return V3.actor._dbg.pokes; });
  await page.mouse.move(hp.x, hp.y); await page.mouse.click(hp.x, hp.y);
  await page.waitForTimeout(600);
  const s8 = await st(); log('poked', s8);
  out.poke = { at: hp, pokes: (await page.evaluate(() => V3.actor._dbg.pokes)) - pokes0, text: await page.evaluate(() => window.__pokeText) };
  assert.equal(out.poke.pokes, 1, 'a real click on her head on the pillow pokes her');
  assert.match(String(out.poke.text), /^(唔……怎么啦？|嗯……我在睡觉呢……|（揉眼睛）天亮了吗……)$/, 'a sleepy line is said');
  assert.equal(s8.variant, 'made'); assert.equal(s8.state, 'respond');
  { const p = await page.evaluate(() => window.__sleep.props()); assert.equal(p[0].shown, true, 'poked awake: pyjamas and nightcap back'); }
  await page.waitForTimeout(900);                                      // let the bubble type the line out
  await shot('sleep-8-poked.png', 'bed');
  await asleep();
  inBed(await st(), 'after the poke');

  // ---- 4. 08:00: she gets up on her own ----
  const until8 = await page.evaluate(() => { const d = new Date(), sh = d.getTime() + 8 * 3600000, day = 24 * 3600000; return (sh - sh % day + 8 * 3600000) - sh; });
  await page.evaluate(ms => window.__clockSkip(ms - 20000), until8);   // 07:59:40
  await page.waitForTimeout(3500);
  const s9 = await st(); log('07:59', s9);
  inBed(s9, '07:59');
  await page.waitForFunction(() => !V3.actor.behavior || V3.actor.behavior.kind !== 'sleep', null, { timeout: 40000 });
  await page.waitForTimeout(500);
  const s10 = await st(); log('08:00', s10); out.morning = s10;
  assert.ok(s10.time >= '08:00:00' && s10.time < '08:00:20', 'up at 08:00: ' + s10.time);
  assert.equal(s10.variant, 'made'); assert.deepEqual(s10.covers, [false]); assert.equal(s10.resting, false); assert.equal(s10.rotX, 0);
  await propsUp('3-morning');
  await shot('sleep-9-morning.png', 'bed');

  // ---- 5. the setting is in the panel ----
  out.setting = await page.evaluate(() => { const f = V3.game.SCHEMA.find(x => x.key === 'nightSleep'); return f && { label: f.label, group: f.group, def: f.def, hint: f.hint, value: V3.game.get('nightSleep') }; });
  assert.deepEqual({ label: out.setting.label, group: out.setting.group, def: out.setting.def, value: out.setting.value }, { label: '夜里上床睡觉', group: '房子', def: true, value: true });
  await page.evaluate(() => V3.emit('game:open', 'settings'));
  await page.waitForTimeout(600);
  out.settingShown = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, [role="tab"], .tab, div, span')) if (el.childElementCount === 0 && el.textContent.trim() === '房子') { el.click(); break; }
    return new Promise(r => setTimeout(() => r(document.body.innerText.includes('夜里上床睡觉')), 300));
  });
  await shot('sleep-10-setting.png');

  out.idle = await page.evaluate(() => ({ ...window.__sleep.idle, last: undefined }));
  late(out.idle.idle1.length === 0, 'the model\'s own idle (idle_1) never played while she lay in bed or sat at the computer: ' + JSON.stringify(out.idle.idle1.slice(0, 5)));
  late(out.idle.maxTimer < 1, 'its idle timer did not run while posed: ' + out.idle.maxTimer);
  out.said = await page.evaluate(() => window.__said);
  out.zzz = out.said.filter(x => /^(Zzz…|z z Z…|呼……)$/.test(x[1])).length;
  assert.ok(out.zzz >= 1 && out.zzz <= 12, 'a Zzz now and then, not a stream: ' + out.zzz);
  out.v3errors = await page.evaluate(n => (window.__errors || []).slice(n), errs0);
  out.errors = errors;
  out.posted = posted.filter(p => p.path === '/api/cabin/behavior').map(p => { try { return JSON.parse(p.body).events.map(e => e.action); } catch (e) { return p.body; } });
  fs.writeFileSync(path.join(shots, 'sleep-result.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ hoverBed: out.hoverBed, hoverReal: out.hoverReal, idle: out.idle, bedProps: out.bedProps, build: out.build, steps: out.steps, said: out.said, leftAfterMs: out.leftAfterMs, poke: out.poke, setting: out.setting, settingShown: out.settingShown, posted: out.posted, errors: out.errors, v3errors: out.v3errors, shots: Object.keys(out.shots) }, null, 1));
  assert.deepEqual(out.late, [], 'sleep polish: outline in bed and the model\'s idle');
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(out.v3errors, [], 'no V3.err entries');
  for (const batch of out.posted) for (const action of [].concat(batch)) assert.ok(['meal', 'shell', 'read', 'diary', 'draw', 'reply_private'].includes(action), 'only whitelisted actions are uploaded: ' + action);
  assert.ok(out.posted.flat().filter(a => a === 'reply_private').length >= 2, 'both replies were logged');
  console.log('PASS cabin sleep browser: bedtime, night reply with the 5-minute wait, poke, 08:00, no page errors.');
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
