#!/usr/bin/env node
// test/fb-ui.test.mjs — end-to-end test of the 3D feedback tool (src/70-79) in headless Edge.
//   node test/fb-ui.test.mjs        (KEEP_TMP=1 keeps test/tmp-fbui/fb-ui; FBUI_GPU=swiftshader forces software GL)
// 1. node build.mjs studio (syntaxErrors=0)   2. serve.mjs on :5298 with --fb-dir test/tmp-fbui/fb-ui
// 3. online: hover the girl's head -> tooltip path; click -> composer; type; Ctrl+Enter -> JSON + png on disk;
//    reload -> list row + pin; list click restores camera; AI marks fixed -> 确认解决 closes it.
// 4. file:// offline: same flow stores to localStorage 'v3.fb.offline'; survives reload; Esc closes / deselects.
// 5. 2D 反馈 (src/79-fb-2d.js): the left switch opens the annotation page (scratch project test/tmp-fbui/ref/demo2d)
//    over the studio; typing in it never reaches the 3D shortcuts; back to 3D = same selection and camera; the
//    mode survives a reload; from file:// the 2D side only says it needs the server.
// Prints one PASS line per check; exits 1 on the first failure. Screenshots go to shots/fbui/.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const PORT = +process.env.FBUI_PORT || 5298, BASE = `http://127.0.0.1:${PORT}`;   // FBUI_PORT：5298 被别的程序占着时换一个
const FB_REL = 'test/tmp-fbui/fb-ui';   // own sub-folder: test/tmp-fbui also holds other scratch work
const FB = path.join(ROOT, ...FB_REL.split('/'));
const REF_REL = 'test/tmp-fbui/ref', REF = path.join(ROOT, ...REF_REL.split('/'));   // 2D projects (never refs/)
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SHOTS = path.join(ROOT, 'shots', 'fbui');
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TestFail extends Error {}
let passed = 0;
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)).slice(0, 500);
function ok(cond, what, got) {
  if (!cond) throw new TestFail(`${what}${got === undefined ? '' : `\n  got: ${show(got)}`}`);
  passed++;
  console.log(`PASS ${what}`);
}

// same browser lookup + GPU flags as tools/shoot.mjs
function findEdge() {
  const edge = (dir) => dir && path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const cands = [process.env.TOOLKIT_BROWSER, edge(process.env['ProgramFiles(x86)']), edge(process.env.ProgramFiles)];
  return cands.find((p) => p && fs.existsSync(p)) || null;
}
const GPU = {
  d3d11: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const BASE_ARGS = ['--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio'];

// ---- server ----
let server = null, serverLog = '';
async function startServer() {
  fs.rmSync(FB, { recursive: true, force: true });
  fs.rmSync(REF, { recursive: true, force: true });
  fs.mkdirSync(path.join(REF, 'demo2d', 'images'), { recursive: true });
  fs.writeFileSync(path.join(REF, 'demo2d', 'images', 'a.png'), PNG_1PX);
  fs.writeFileSync(path.join(REF, 'demo2d', 'questions.json'), JSON.stringify({ round: 1,
    images: { 'images/a.png': { summary: '测试图', questions: [{ id: 'q1', text: '这是测试图吗？', type: 'yesno' }] } } }));
  server = spawn(process.execPath, [path.join(ROOT, 'serve.mjs'), '--port', String(PORT), '--fb-dir', FB_REL, '--ref-dir', REF_REL],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE}/api/ping`); if (r.ok) return await r.json(); } catch { /* not up yet */ }
    if (server.exitCode != null) break;
    await sleep(100);
  }
  throw new TestFail(`serve.mjs did not answer /api/ping\n${serverLog.slice(-800)}`);
}
const api = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new TestFail(`${method} ${p} -> ${r.status} ${show(j)}`);
  return j;
};

// ---- browser ----
let browser = null;
const pageErrors = [];
async function launch(gpu) {
  const exe = findEdge();
  if (!exe) throw new TestFail('Microsoft Edge not found (set TOOLKIT_BROWSER)');
  browser = await puppeteer.launch({ executablePath: exe, headless: true, args: [...BASE_ARGS, ...GPU[gpu]],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }, protocolTimeout: 120000 });
}
async function openPage(url) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${url}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console] ${m.text().slice(0, 200)}`); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true || (window.__errors && window.__errors.length > 0)', { timeout: 60000 });
  const errs = await page.evaluate('window.__errors || []');
  ok(!errs.length, `page ready without __errors (${url.replace(ROOT, '').slice(0, 60)})`, errs);
  return page;
}
// ---- shared steps ----
// client point at the centre of the girl's head (bbox of the 头 group)
async function headPoint(page) {
  const r = await page.evaluate(() => {
    const fb = V3.fb, head = V3.parts.list().find((p) => /^[^/]+\/(头|脸)$/.test(p));   // 旧模型的「X/头」；v1 小鲸鱼是「小鲸鱼/脸」
    const s = head && fb.screenOf(head);
    return s && { head, x: s.x, y: s.y, at: (document.elementFromPoint(s.x, s.y) || {}).id,
      over: document.elementsFromPoint(s.x, s.y).slice(0, 3).map((e) => e.tagName + '.' + e.className).join(' > ') };
  });
  ok(r && r.head && r.at === 'v3-canvas', 'head centre is on the canvas (not under a panel)', r);
  return r;
}
// hover -> tooltip with the full path; click -> selection + composer
async function pickHead(page) {
  const h = await headPoint(page);
  await page.mouse.move(h.x - 40, h.y + 30);
  await page.mouse.move(h.x, h.y, { steps: 4 });
  await page.waitForFunction((head) => {
    const t = document.querySelector('.fb-tip');
    return V3.fb.hover && (V3.fb.hover === head || V3.fb.hover.startsWith(head + '/')) && t && t.style.display !== 'none';
  }, { timeout: 8000 }, h.head);
  const tip = await page.evaluate(() => ({ hover: V3.fb.hover, text: document.querySelector('.fb-tip').textContent }));
  ok(tip.text.includes(tip.hover), `hover tooltip shows the full path: ${tip.hover}`, tip);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => V3.fb.comp.open, { timeout: 8000 });
  const sel = await page.evaluate(() => ({ sel: V3.fb.sel, target: V3.fb.comp.target, hit: !!(V3.fb.hit && V3.fb.hit.local), crumb: (document.querySelector('.fb-crumb') || {}).textContent || '' }));
  ok(sel.sel === tip.hover && sel.target === sel.sel && sel.hit, 'click selects the hovered part and opens the composer', sel);
  ok(sel.crumb.includes(await page.evaluate((p) => V3.fb.label(p), sel.sel)), 'breadcrumb shows the selected part', sel.crumb);
  return sel.sel;
}
// fill composer + Ctrl+Enter; resolves to the new item (store copy)
async function submit(page, text, shot) {
  await page.evaluate(() => { const b = [...document.querySelectorAll('.fb-cat')].find((x) => x.textContent.trim() === '形状'); b.click(); });
  await page.focus('.fb-comp textarea');
  await page.keyboard.type(text);
  if (shot) await page.screenshot({ path: path.join(SHOTS, shot) });
  const n0 = await page.evaluate(() => V3.fb.store.items.length);
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
  await page.waitForFunction((n) => V3.fb.store.items.length === n + 1 && !V3.fb.comp.open, { timeout: 20000 }, n0);
  return page.evaluate(() => { const { shotData, ...it } = V3.fb.store.items[0]; return it; });
}
const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
const pinShown = (page, id) => page.waitForFunction((i) => V3.fb.pins.visible().includes(i), { timeout: 8000 }, id).then(() => true, () => false);
// ---- online (serve.mjs) ----
async function online() {
  const ping = await startServer();
  ok(ping && ping.ok, 'serve.mjs /api/ping ok', ping);
  const page = await openPage(`${BASE}/studio.html?model=ysm`);
  await page.waitForFunction(() => V3.fb.store.checked, { timeout: 15000 });
  const st = await page.evaluate(() => ({ online: V3.fb.store.online, chip: V3.fb.bar.status.textContent, rows: document.querySelectorAll('.fb-tree-row').length }));
  ok(st.online && st.chip === '已连接服务器', 'status chip: 已连接服务器', st);
  ok(st.rows >= 5, `part tree shows the girl's body regions (${st.rows} rows)`, st);
  await page.type('.fb-left input[type=search]', 'Head');
  const found = await page.evaluate(() => [...document.querySelectorAll('.fb-tree-row')].map((r) => r.dataset.path));
  ok(found.some((p) => /\/头\/Head$/.test(p)), 'tree search Head finds 头/Head', found);
  await page.evaluate(() => { const s = document.querySelector('.fb-left input[type=search]'); s.value = ''; s.dispatchEvent(new Event('input')); });
  const part = await pickHead(page);
  const it = await submit(page, '刘海太厚了，挡住眼睛，想要碎一点', '01-composer.png');
  ok(/^fb-\d{8}-\d{6}-[a-z0-9]{3,6}$/.test(it.id) && it.part === part, `POST saved ${it.id} for ${part}`, it);
  const jf = path.join(FB, 'items', `${it.id}.json`);
  ok(fs.existsSync(jf), 'feedback JSON written to test/tmp-fbui/fb-ui/items/', fs.existsSync(FB) ? fs.readdirSync(FB) : 'no dir');
  const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  ok(j.part === part && j.partLabel && j.model === 'ysm' && j.page === 'studio' && /^v3-/.test(j.build), 'JSON has part path, label, model, page, build', j);
  ok(j.camera && vec3(j.camera.pos) && vec3(j.camera.target) && j.camera.fov > 0, 'JSON has camera {pos, target, fov}', j.camera);
  ok(j.point && vec3(j.point.local) && vec3(j.point.world) && j.point.anchor, 'JSON has clicked point (local, world, anchor)', j.point);
  ok(j.state && 'expr' in j.state && 't' in j.state && j.state.light, 'JSON has state {expr, pose, t, light}', j.state);
  ok(j.category === '形状' && j.severity === 2 && j.text.includes('刘海') && j.status === 'open', 'JSON has category, severity, text, status', j);
  const pf = path.join(FB, j.shot || 'missing');
  const png = fs.existsSync(pf) ? fs.readFileSync(pf) : null;
  const pw = png && png.readUInt32BE(16), ph = png && png.readUInt32BE(20);
  ok(png && png.toString('latin1', 1, 4) === 'PNG' && pw === W && ph > H && png.length > 20000,
    `screenshot ${j.shot} ${pw}x${ph} ${png && Math.round(png.length / 1024)} KB`, { pf, pw, ph });
  fs.copyFileSync(pf, path.join(SHOTS, '02-saved-shot.png'));
  // reload: the item comes back from the server, with a list row and a pin
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 60000 });
  await page.waitForFunction((id) => V3.fb.store.checked && V3.fb.store.get(id), { timeout: 15000 }, it.id);
  ok(await page.$(`.fb-item[data-id="${it.id}"]`), 'after reload the item is in the list');
  ok(await pinShown(page, it.id), 'after reload its pin is visible on the model');
  // list click = back to the view it was written in
  await page.evaluate(() => V3.R.setView({ pos: [3, 2, 3], target: [0, 0.5, 0] }));
  await page.click(`.fb-item[data-id="${it.id}"] .fb-itext`);
  const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 0.02);
  await page.waitForFunction((c) => V3.R.getView().pos.every((x, i) => Math.abs(x - c[i]) < 0.02), { timeout: 5000 }, j.camera.pos).catch(() => {});
  const back = await page.evaluate(() => ({ view: V3.R.getView(), sel: V3.fb.sel, open: V3.fb.list.openId }));
  ok(near(back.view.pos, j.camera.pos) && back.sel === part && back.open === it.id, 'clicking the list item restores camera + selects the part', back);
  // AI marks it fixed -> 已修复 + 确认解决 / 还有问题; 确认解决 closes it
  await api('PATCH', `/api/fb/${it.id}`, { status: 'fixed', reply: { who: 'ai', text: '刘海改薄了，露出眼睛' } });
  await page.evaluate(() => V3.fb.store.refresh());
  await page.waitForFunction((id) => V3.fb.store.get(id).status === 'fixed', { timeout: 15000 }, it.id);
  const fx = await page.evaluate((id) => {
    const r = document.querySelector(`.fb-item[data-id="${id}"]`);
    return { badge: r.querySelector('.fb-item-top .fb-st').textContent, ai: !!r.querySelector('.fb-msg.ai'),
      btns: [...r.querySelectorAll('.fb-acts .fb-btn')].map((b) => b.textContent) };
  }, it.id);
  ok(fx.badge === '已修复' && fx.ai && fx.btns.includes('确认解决') && fx.btns.includes('还有问题'), 'AI fix shows 已修复 + AI reply + 确认解决/还有问题', fx);
  await page.screenshot({ path: path.join(SHOTS, '03-list-fixed.png') });
  await page.evaluate((id) => [...document.querySelectorAll(`.fb-item[data-id="${id}"] .fb-acts .fb-btn`)].find((b) => b.textContent === '确认解决').click(), it.id);
  await page.waitForFunction((id) => V3.fb.store.get(id).status === 'closed', { timeout: 10000 }, it.id);
  const j2 = JSON.parse(fs.readFileSync(jf, 'utf8'));
  ok(j2.status === 'closed' && j2.thread.some((m) => m.who === 'ai'), '确认解决 -> status closed on disk', j2);
  await twoD(page, part);
  await page.close();
}

// ---- 2D 反馈 (switch on the left, annotation page in an iframe) ----
const clickMode = (page, scope, label) => page.evaluate((s, l) => [...document.querySelectorAll(s + ' .fb-mode-b')].find((b) => b.textContent === l).click(), scope, label);
const state3d = (page) => page.evaluate(() => ({ sel: V3.fb.sel, view: V3.R.getView(), hidden: V3.fb.hiddenAny(), iso: V3.fb.iso, paused: V3.fb.paused(), comp: V3.fb.comp.open }));
async function twoD(page, part) {
  await page.evaluate((p) => V3.fb.select(p, { src: 'tree' }), part);
  await page.waitForFunction(() => V3.fb.comp.open, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => V3.fb.closeCompose());   // selection stays, the composer must not cover the head below
  const before = await state3d(page);
  const sw = await page.evaluate(() => [...document.querySelectorAll('.fb-left > .fb-mode .fb-mode-b')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')));
  ok(sw.join() === '3D 反馈*,2D 反馈', 'left panel starts with the switch 3D 反馈 | 2D 反馈 (3D on)', sw);
  await clickMode(page, '.fb-left', '2D 反馈');
  await page.waitForFunction(() => V3.fb.d2.on, { timeout: 5000 });
  const ready = await page.evaluate(() => V3.fb.d2.whenReady());
  const fr = page.frames().find((f) => f.url().includes('/2d/?p=demo2d'));
  const s2 = await page.evaluate((h) => {
    const d = V3.fb.d2, rk = d.frame.contentWindow.RK, at = document.elementFromPoint(h.x, h.y);
    return { ready: d.on, opts: [...d.sel.options].map((o) => o.value), project: rk && rk.st && rk.st.project, progress: rk && rk.$('progress').textContent,
      at: at && at.className, mode: localStorage.getItem('v3.fb.mode'), paused3d: d.paused3d() };
  }, await page.evaluate(() => { const s = V3.fb.screenOf(V3.parts.list().find((p) => /^[^/]+\/(头|脸)$/.test(p))); return { x: s.x, y: s.y }; }));
  ok(ready && fr && s2.opts.join() === 'demo2d' && s2.project === 'demo2d' && s2.progress === '还有 1 条没答', '2D 反馈 opens the annotation page with the project picker (demo2d)', s2);
  ok(s2.at === 'fb2d-frame' && s2.mode === '2d' && s2.paused3d, '2D page covers the studio, mode remembered, 3D drawing paused', s2);
  await page.screenshot({ path: path.join(SHOTS, '05-2d.png') });
  // typing in the 2D page (keys that are 3D shortcuts: h i f 1 2 space) never reaches the studio
  await fr.evaluate(() => [...document.querySelectorAll('#panel textarea')].find((t) => t.placeholder.startsWith('关于这张图')).focus());
  await page.keyboard.type('hif 12 好');
  const typed = await fr.evaluate(() => document.activeElement.value);
  ok(typed === 'hif 12 好' && JSON.stringify(await state3d(page)) === JSON.stringify(before), 'typing h i f 1 2 space in the 2D page leaves the 3D studio alone', { typed, now: await state3d(page), before });
  const af = path.join(REF, 'demo2d', 'answers.json');
  for (let i = 0; i < 50 && !(fs.existsSync(af) && fs.readFileSync(af, 'utf8').includes('hif 12 好')); i++) await sleep(100);
  ok(fs.existsSync(af) && JSON.parse(fs.readFileSync(af, 'utf8')).images['images/a.png'].note === 'hif 12 好', '2D page autosaves to <ref-dir>/demo2d/answers.json');
  // keys while the studio itself has focus (the switch button) are blocked as well
  await page.evaluate(() => [...document.querySelectorAll('.fb2d .fb-mode-b')].find((b) => b.textContent === '2D 反馈').focus());
  for (const k of ['h', 'i', '2', 'f', 'H']) await page.keyboard.press(k);
  ok(JSON.stringify(await state3d(page)) === JSON.stringify(before), 'studio shortcuts are off while 2D is shown', await state3d(page));
  // 新标签页打开: the project opens in its own tab and the studio's copy is unloaded (two pages would overwrite answers)
  const tabT = browser.waitForTarget((t) => t.url().includes('/2d/?p=demo2d') && t.opener(), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('.fb2d .fb2d-btn')].find((b) => b.textContent === '新标签页打开').click());
  const tab = await (await tabT).page();
  await page.waitForFunction(() => !V3.fb.d2.note.hidden, { timeout: 5000 }).catch(() => {});
  const tabbed = await page.evaluate(() => ({ note: V3.fb.d2.note.textContent, src: V3.fb.d2.frame.getAttribute('src'), frame: !V3.fb.d2.frame.hidden }));
  ok(tab && tabbed.src === 'about:blank' && !tabbed.frame && tabbed.note.includes('新标签页'), '新标签页打开: own tab, the studio unloads its copy', tabbed);
  if (tab) await tab.close();
  await page.evaluate(() => [...document.querySelectorAll('.fb2d .fb2d-btn')].find((b) => b.textContent === '刷新').click());
  await page.waitForFunction(() => !V3.fb.d2.frame.hidden, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(async () => (await V3.fb.d2.whenReady()) && !V3.fb.d2.frame.hidden && V3.fb.d2.frame.contentWindow.RK.st.project === 'demo2d'),
    '刷新 brings the project back into the studio');
  // back to 3D: everything as before
  await clickMode(page, '.fb2d', '3D 反馈');
  await sleep(300);
  const back = await page.evaluate(() => ({ on: V3.fb.d2.on, vis: getComputedStyle(document.querySelector('.fb2d')).visibility, mode: localStorage.getItem('v3.fb.mode'), paused3d: V3.fb.d2.paused3d() }));
  ok(!back.on && back.vis === 'hidden' && back.mode === '3d' && !back.paused3d && JSON.stringify(await state3d(page)) === JSON.stringify(before),
    '3D 反馈 brings the studio back unchanged (selection, camera, drawing)', { back, now: await state3d(page), before });
  const hit = await page.evaluate(() => [[0.5, 0.5], [0.12, 0.5], [0.9, 0.3], [0.5, 0.05]].map(([fx, fy]) => {
    const e = document.elementFromPoint(innerWidth * fx, innerHeight * fy);
    return e ? (e.closest('.fb2d') ? 'fb2d' : e.id || e.className) : null;
  }));
  ok(!hit.includes('fb2d') && hit.every(Boolean), 'after switching back nothing of the 2D layer is hit any more', hit);
  await page.keyboard.press('2');
  const moved = await page.waitForFunction((v) => JSON.stringify(V3.R.getView()) !== v, { timeout: 5000 }, JSON.stringify(before.view)).then(() => true, () => false);
  ok(moved, 'studio shortcuts work again after switching back (2 = side view)');
  // the mode is remembered: reload opens straight in 2D on the same project
  await clickMode(page, '.fb-left', '2D 反馈');
  await page.waitForFunction(() => V3.fb.d2.on, { timeout: 5000 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 60000 });
  await page.waitForFunction(() => V3.fb.d2 && V3.fb.d2.on, { timeout: 10000 });
  const again = await page.evaluate(async () => ({ ready: await V3.fb.d2.whenReady(), project: V3.fb.d2.project }));
  ok(again.ready && again.project === 'demo2d', 'after reload the studio opens in 2D on the same project', again);
  await clickMode(page, '.fb2d', '3D 反馈');
}

// ---- offline (file://) ----
async function offline() {
  const page = await openPage(pathToFileURL(path.join(ROOT, 'dist', 'studio.html')).href + '?model=ysm');
  await page.waitForFunction(() => V3.fb.store.checked, { timeout: 15000 });
  const st = await page.evaluate(() => ({ online: V3.fb.store.online, chip: V3.fb.bar.status.textContent, n: V3.fb.store.items.length }));
  ok(!st.online && st.chip === '离线模式' && st.n === 0, 'file:// page: status chip 离线模式, empty list', st);
  const part = await pickHead(page);
  const it = await submit(page, '头发颜色太暗了', null);
  const arr = await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('v3.fb.offline') || '[]'); return Array.isArray(j) ? j : j.items || []; });
  const x = arr[0] || {};
  ok(arr.length === 1 && x.id === it.id && x.part === part && /^data:image\/jpeg;base64,/.test(x.shotData || ''),
    `offline item ${it.id} stored in localStorage with a jpeg shot`, { n: arr.length, id: x.id, part: x.part, shot: String(x.shotData).slice(0, 30) });
  ok(/^fb-\d{8}-\d{6}-[a-z0-9]{3,6}$/.test(x.id) && x.camera && vec3(x.camera.pos) && x.point && vec3(x.point.local), 'offline item has a server-compatible id, camera and point', x.id);
  // Esc: first closes the composer (selection stays), second deselects
  await page.evaluate((p) => V3.fb.select(p, { src: 'tree' }), part);
  await page.waitForFunction(() => V3.fb.comp.open, { timeout: 5000 });
  await page.keyboard.press('Escape');
  const e1 = await page.evaluate(() => ({ open: V3.fb.comp.open, sel: V3.fb.sel }));
  await page.keyboard.press('Escape');
  const e2 = await page.evaluate(() => ({ open: V3.fb.comp.open, sel: V3.fb.sel }));
  ok(!e1.open && e1.sel === part && e2.sel === null, 'Esc closes the composer, second Esc deselects', { e1, e2 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__READY === true', { timeout: 60000 });
  await page.waitForFunction((id) => V3.fb.store.checked && V3.fb.store.get(id), { timeout: 15000 }, it.id);
  ok(await page.$(`.fb-item[data-id="${it.id}"]`) && await pinShown(page, it.id), 'offline item survives reload (list row + pin)');
  await page.screenshot({ path: path.join(SHOTS, '04-offline.png') });
  const hid = await page.evaluate(async () => { await window.__view('ui=0'); const r = document.querySelector('.fb-root'); return { cls: document.body.classList.contains('ui-off'), disp: r && getComputedStyle(r).display }; });
  ok(hid.cls && hid.disp === 'none', 'ui=0 hides all feedback UI', hid);
  await page.evaluate(async () => { await window.__view('ui=1'); [...document.querySelectorAll('.fb-left .fb-mode-b')].find((b) => b.textContent === '2D 反馈').click(); });
  const note = await page.evaluate(() => { const d = V3.fb.d2; return { on: d.on, note: d.note.hidden ? '' : d.note.textContent, frame: !d.frame.hidden }; });
  ok(note.on && note.note.includes('启动工作台.bat') && !note.frame, 'file:// page: 2D 反馈 only shows that it needs the server', note);
  await page.close();
}

async function webglOk() {
  const p = await browser.newPage();
  const r = await p.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); });
  await p.close();
  return r;
}
async function main() {
  const b = spawnSync(process.execPath, [path.join(ROOT, 'build.mjs'), 'studio'], { cwd: ROOT, encoding: 'utf8' });
  const out = (b.stdout || '') + (b.stderr || '');
  ok(b.status === 0 && /syntaxErrors=0/.test(out), 'node build.mjs studio -> syntaxErrors=0', out.slice(-400));
  fs.mkdirSync(SHOTS, { recursive: true });
  let gpu = process.env.FBUI_GPU || 'd3d11';
  await launch(gpu);
  if (!(await webglOk()) && gpu !== 'swiftshader') { await browser.close(); gpu = 'swiftshader'; await launch(gpu); }
  ok(await webglOk(), `WebGL available (gpu ${gpu})`);
  await online();
  await offline();
  ok(!pageErrors.length, 'no uncaught page errors', pageErrors);
  console.log(`\nRESULT: OK ${passed} checks (gpu ${gpu})`);
}
let code = 0;
try { await main(); } catch (e) {
  code = 1;
  console.log(`FAIL ${e instanceof TestFail ? e.message : (e && e.stack) || e}`);
  if (pageErrors.length) console.log(`page errors:\n  ${pageErrors.join('\n  ')}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) { server.kill(); await sleep(300); }
  if (!process.env.KEEP_TMP) { fs.rmSync(FB, { recursive: true, force: true }); fs.rmSync(REF, { recursive: true, force: true }); }
}
process.exit(code);
