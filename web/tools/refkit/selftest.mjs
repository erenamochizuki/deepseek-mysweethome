#!/usr/bin/env node
// tools/refkit/selftest.mjs — end-to-end test of the 2D 反馈 page (参考图标注) in a real browser (Edge or Chrome, puppeteer-core).
// Usage: node tools/refkit/selftest.mjs [--standalone] [--keep] [--shots shots/refkit]
//        node tools/refkit/selftest.mjs --demo refs/_demo    only create a demo project to try the page with
// By default it starts v3's serve.mjs on a free port with --ref-dir <temp>/refs (the studio's 2D mode uses that
// server); --standalone uses tools/refkit/serve.mjs instead. It uploads two drawn test scenes through the page,
// writes questions.json the way the agent would, answers everything through the UI like a user, then checks
// answers.json, exports/ and report.mjs, plus the server safety checks. Never touches refs/ (only --demo writes
// there). Prints PASS/FAIL lines and ends with SELFTEST: PASS or FAIL.
// Browser: TOOLKIT_BROWSER=<exe> if set, else Edge (then Chrome) from the standard install folders.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const DEMO = arg('demo', null), SHOTS = path.resolve(ROOT, arg('shots', 'shots/refkit')), KEEP = argv.includes('--keep');
const STANDALONE = argv.includes('--standalone');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'refkit-test-'));   // temp project (+ the feedback dir of serve.mjs)
const DIR = DEMO ? path.resolve(ROOT, DEMO) : path.join(TMP, 'refs', 'demo');
const NAME = path.basename(DIR);
if (DEMO && fs.existsSync(path.join(DIR, 'questions.json'))) { console.error('demo already exists: ' + DIR); process.exit(1); }
fs.mkdirSync(path.join(DIR, 'images'), { recursive: true });
const edge = (dir) => dir && path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const chrome = (dir) => dir && path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe');
const BROWSERS = [process.env.TOOLKIT_BROWSER, edge(process.env['ProgramFiles(x86)']), edge(process.env.ProgramFiles),
  chrome(process.env.ProgramFiles), chrome(process.env['ProgramFiles(x86)']), chrome(process.env.LOCALAPPDATA), '/usr/bin/google-chrome', '/usr/bin/chromium'];
const fails = [];
const check = (cond, what) => { console.log((cond ? 'PASS ' : 'FAIL ') + what); if (!cond) fails.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (...a) => spawnSync(process.execPath, [path.join(HERE, 'report.mjs'), '--dir', DIR, ...a], { encoding: 'utf8' });

// Round-1 questions for the two drawn scenes, written the way the agent writes them. Boxes match drawAndUpload().
const QUESTIONS = {
  round: 1,
  intro: '示例项目：两张画出来的测试图。先确认场景和人物。',
  project: [{ id: 'style', text: '最终想要什么风格？', type: 'choice', options: ['和便利店那次一样的卡通', '更写实', '不确定'], other: true, guess: '和便利店那次一样的卡通' }],
  characters: [{ id: 'c1', name: '红伞的人', note: '撑红伞' }],
  images: {
    'images/scene-a.png': {
      summary: '夜晚的街。右边一家店亮着灯，绿色招牌；左边一个撑红伞的人，店门口一个穿灰衣服的人。',
      fields: { where: '室外', time: '夜晚', weather: '雨' },
      questions: [
        { id: 'q1', text: '店的招牌要照着做吗？', type: 'yesno' },
        { id: 'q2', text: '画面里哪些东西必须有？', type: 'multi', options: ['店', '路灯', '人', '雨'], other: true },
      ],
      boxes: [
        { id: 'a1', x: 0.248, y: 0.411, w: 0.104, h: 0.319, guess: { kind: 'character', character: 'c1' }, ask: '这是主角吗？' },
        { id: 'a2', x: 0.675, y: 0.485, w: 0.05, h: 0.244, guess: { kind: 'passerby' }, ask: '这个是路人吧？' },
        { id: 'a3', x: 0.583, y: 0.278, w: 0.354, h: 0.074, guess: { kind: 'sign' } },
        { id: 'a4', x: 0.80, y: 0.50, w: 0.08, h: 0.24, guess: { kind: 'object', thing: 't1' }, ask: '这是店门吧？' },
      ],
    },
    'images/scene-b.png': {
      summary: '同一条街换了个角度，只有一个撑红伞的人。',
      fields: { where: '室外', time: '夜晚' },
      questions: [{ id: 'q1', text: '这张和第一张是同一个地方吗？', type: 'yesno', guess: '是' }],
      boxes: [
        { id: 'a1', x: 0.498, y: 0.411, w: 0.104, h: 0.319, guess: { kind: 'character' }, ask: '这是谁？' },
        { id: 'a2', x: 0.10, y: 0.40, w: 0.08, h: 0.30, guess: { kind: 'object' }, ask: '这是什么？' },
      ],
    },
  },
  pairs: [{ id: 'p1', a: 'images/scene-a.png#a1', b: 'images/scene-b.png#a1', ask: '这两个是同一个人吗？', guess: '是' }],
  things: [{ id: 't1', name: '店门', note: '店的入口', boxes: ['images/scene-a.png#a4', 'images/scene-b.png#a2'] }],
};

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
// url = the page: http://127.0.0.1:<port>/2d/?p=<project>
async function startServer() {
  const port = STANDALONE ? 0 : await freePort();
  const args = STANDALONE ? [path.join(HERE, 'serve.mjs'), '--dir', DIR, '--port', '0']
    : [path.join(ROOT, 'serve.mjs'), '--port', String(port), '--fb-dir', path.join(TMP, 'fb'), '--ref-dir', path.dirname(DIR)];
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      const m = STANDALONE ? /refkit: (http:\S+)/.exec(buf)
        : buf.includes(`http://127.0.0.1:${port}/`) && [0, `http://127.0.0.1:${port}/2d/?p=${encodeURIComponent(NAME)}`];
      if (m) resolve({ server: p, url: m[1] });
    });
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('exit', (c) => reject(new Error('server exited with ' + c + '\n' + buf)));
  });
}
const api = (s) => '/api/ref/' + encodeURIComponent(NAME) + '/' + s;
const rawGet = (url, p, host) => new Promise((resolve) => {
  const u = new URL(url);
  http.get({ host: u.hostname, port: u.port, path: p, headers: host ? { Host: host } : {} }, (r) => { r.resume(); resolve(r.statusCode); })
    .on('error', () => resolve(0));
});
const getJson = (url, p) => new Promise((resolve) => {
  const u = new URL(url);
  http.get({ host: u.hostname, port: u.port, path: p }, (r) => {
    let t = '';
    r.on('data', (d) => { t += d; });
    r.on('end', () => { try { resolve(JSON.parse(t)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});
// POST from Node; resolves { status, body }.
const rawPost = (url, p, headers, body) => new Promise((resolve) => {
  const u = new URL(url);
  const r = http.request({ host: u.hostname, port: u.port, path: p, method: 'POST', headers: headers || {} }, (res) => {
    let t = '';
    res.on('data', (d) => { t += d; });
    res.on('end', () => resolve({ status: res.statusCode, body: t }));
  });
  r.on('error', () => resolve({ status: 0, body: '' }));
  r.end(body || '');
});

// Runs in the page. scene-a: a lit shop on the right with a green sign band, a figure under a red umbrella
// at x 0.3 and a grey figure at x 0.7. scene-b: the same red-umbrella figure at x 0.55, no shop.
async function drawAndUpload() {
  const make = (name, figs, shop) => new Promise((res) => {
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 540;
    const x = c.getContext('2d'), sky = x.createLinearGradient(0, 0, 0, 400);
    sky.addColorStop(0, '#0b1230');
    sky.addColorStop(1, '#2a2f4a');
    x.fillStyle = sky; x.fillRect(0, 0, 960, 400);
    x.fillStyle = '#23262e'; x.fillRect(0, 400, 960, 140);
    if (shop) {
      x.fillStyle = '#3b4252'; x.fillRect(560, 150, 340, 250);
      x.fillStyle = '#2bb673'; x.fillRect(560, 150, 340, 40);
      x.fillStyle = '#fff7d6'; x.fillRect(590, 220, 280, 160);
    }
    for (const [fx, red] of figs) {
      const px = fx * 960;
      x.fillStyle = red ? '#d94a5a' : '#8a8f99';
      x.fillRect(px - 18, 300, 36, 90);
      x.beginPath(); x.arc(px, 285, 16, 0, Math.PI * 2); x.fill();
      if (red) { x.fillStyle = '#ff3355'; x.beginPath(); x.arc(px, 272, 46, Math.PI, 0); x.fill(); }
    }
    c.toBlob((b) => res(new File([b], name, { type: 'image/png' })), 'image/png');
  });
  await RK.upload([await make('scene-a.png', [[0.3, true], [0.7, false]], true), await make('scene-b.png', [[0.55, true]], false)]);
  return RK.st.images.map((i) => i.key);
}

const { server, url } = await startServer();
const exe = BROWSERS.find((b) => b && fs.existsSync(b));
if (!exe) { console.error('no Edge or Chrome found'); server.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(d.message().includes('东西') ? '路灯' : '戴帽子的人') : d.accept()));
await page.goto(url);
await page.waitForFunction(() => window.RK && RK.st, { timeout: 15000 });
check(await page.evaluate(() => !document.getElementById('empty').hidden), 'empty project shows the upload hint');
const keys = await page.evaluate(drawAndUpload);
check(JSON.stringify(keys) === '["images/scene-a.png","images/scene-b.png"]' && fs.existsSync(path.join(DIR, 'images', 'scene-a.png')), 'upload through the page stores both images');
fs.writeFileSync(path.join(DIR, 'questions.json'), JSON.stringify(QUESTIONS, null, 1));
await page.waitForFunction(() => RK.Q.round === 1, { timeout: 10000 });
check(report('--check').status === 0, 'report.mjs --check accepts the questions');
const prog = await page.evaluate(() => document.getElementById('progress').textContent);
check(prog.includes('18'), `progress shows 18 unanswered items ("${prog}")`);
if (DEMO) {
  await page.evaluate(() => RK.flushNow());
  await browser.close();
  server.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  const rel = path.relative(ROOT, DIR).split(path.sep).join('/');
  console.log(`demo ready: 工作台左上角「2D 反馈」里选 ${NAME}，或 node tools/refkit/serve.mjs --dir ${rel}`);
  process.exit(fails.length ? 1 : 0);
}

// ---------------------------------------------------------------- UI helpers (everything goes through the page)
// Page position of a point given as fractions (0-1) of the current image.
const at = (fx, fy) => page.evaluate((fx, fy) => {
  const r = RK.$('cv').getBoundingClientRect(), V = RK.V;
  return { x: r.left + V.ox + fx * V.iw * V.s, y: r.top + V.oy + fy * V.ih * V.s };
}, fx, fy);
async function openImage(key) {
  await page.evaluate((k) => RK.select(k), key);
  await page.waitForFunction((k) => RK.V.key === k && !!RK.V.img, {}, key);
  await sleep(100);
}
// Inside root, optionally narrowed to the .sec / .q whose title starts with sec, run fn on the matching element.
async function inScope(root, sec, fn, ...rest) {
  const ok = await page.evaluate((root, sec, fnSrc, rest) => {
    let s = document.querySelector(root);
    if (s && sec) s = [...s.querySelectorAll('.sec, .q')].find((x) => ((x.querySelector('h3, .qt') || {}).textContent || '').startsWith(sec));
    return !!s && new Function('s', 'rest', fnSrc)(s, rest);
  }, root, sec, fn, rest);
  if (!ok) throw new Error(`not found: ${rest.join(' ')} in ${sec || root}`);
  await sleep(80);
}
const clickBtn = (text, sec, root = '#panel') => inScope(root, sec,
  'const b = [...s.querySelectorAll("button")].find((x) => x.textContent.trim() === rest[0]); if (b) b.click(); return !!b;', text);
const typeIn = (ph, text, sec, root = '#panel') => inScope(root, sec,
  'const e = [...s.querySelectorAll("input, textarea")].find((x) => (x.placeholder || "").startsWith(rest[0])); if (!e) return false;' +
  'e.focus(); e.value = rest[1]; e.dispatchEvent(new Event("input", { bubbles: true })); e.blur(); return true;', ph, text);
const pickChar = (value) => inScope('#panel', '选中的框',
  'const e = s.querySelector("select"); if (!e) return false; e.value = rest[0]; e.dispatchEvent(new Event("change")); return true;', value);
const pickBox = (id) => inScope('#panel', null,
  'const b = [...s.querySelectorAll(".boxitem")].find((x) => x.textContent.startsWith(rest[0] + " ")); if (b) b.click(); return !!b;', id);
const pickThing = (value) => inScope('#panel', '选中的框',
  'const r = [...s.querySelectorAll(".row")].find((x) => ((x.querySelector("label") || {}).textContent || "") === "是哪个东西");' +
  'const e = r && r.querySelector("select"); if (!e) return false; e.value = rest[0]; e.dispatchEvent(new Event("change")); return true;', value);
async function confirmFields() {
  for (let i = 0; i < 6; i++) {
    try { await clickBtn('对，确认', '基本信息'); } catch { return; }
  }
}
async function clickImage(fx, fy) { const p = await at(fx, fy); await page.mouse.click(p.x, p.y); await sleep(80); }

fs.mkdirSync(SHOTS, { recursive: true });
try {
  // scene-a: confirm the agent's character guess, set a kind by keyboard, delete a wrong box, draw a new one.
  await openImage('images/scene-a.png');
  await clickImage(0.30, 0.55);
  await clickBtn('对，确认', '选中的框');
  await clickImage(0.70, 0.60);
  await page.keyboard.press('2');
  await sleep(80);
  await pickBox('a3');
  await clickBtn('框错了，删掉', '选中的框');
  const p0 = await at(0.05, 0.50), p1 = await at(0.15, 0.74);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 6 });
  await page.mouse.up();
  await sleep(80);
  await pickChar('+');
  await confirmFields();
  await clickBtn('是', '店的招牌要照着做吗？');
  await clickBtn('店', '画面里哪些东西必须有？');
  await clickBtn('人', '画面里哪些东西必须有？');
  await typeIn('其他，自己填', '雨伞', '画面里哪些东西必须有？');
  await typeIn('关于这张图的任何补充', '招牌颜色要一样');
  await page.evaluate(() => [...document.querySelectorAll('#panel label')].find((l) => l.textContent.includes('主视角')).click());
  await sleep(80);
  // Things: confirming a4's box guess also links it to the proposed thing t1.
  await pickBox('a4');
  await clickBtn('对，确认', '选中的框');
  check(await page.evaluate(() => RK.thingProposals('images/scene-a.png').length === 0), 'confirming a box guess answers its thing proposal');
  // scene-b: confirm field and question guesses, then give the box a character.
  await openImage('images/scene-b.png');
  await confirmFields();
  await clickBtn('对，确认', '这张和第一张是同一个地方吗？');
  await clickImage(0.55, 0.55);
  await clickBtn('对，确认', '选中的框');
  await pickChar('c1');
  // scene-b a2: answer 不是 to "a2 is 店门", then link it to a new thing made from the box's select.
  await clickBtn('不是', '这是同一个东西吗？');
  await pickBox('a2');
  await page.keyboard.press('3');
  await sleep(80);
  await pickThing('+');
  // Project question and notes, then the "same person?" pair in the character sheet.
  await page.click('#btnProject');
  await clickBtn('和便利店那次一样的卡通', '最终想要什么风格？', '#ovBody');
  await typeIn('布局、某几样东西', '店在右边，路灯在左边', null, '#ovBody');
  await page.click('#ovClose');
  await page.click('#btnChars');
  await clickBtn('是', '这两个是同一个人吗？', '#ovBody');
  await page.waitForFunction(() => document.querySelectorAll('#ovBody .crop canvas').length >= 5, { timeout: 10000 });
  await page.screenshot({ path: path.join(SHOTS, 'characters.png') });
  await page.click('#ovClose');
  await page.click('#btnThings');
  // Thing names live in <input> values, so look there, not in textContent.
  await page.waitForFunction(() => document.querySelectorAll('#ovBody .crop canvas').length >= 2 &&
    [...document.querySelectorAll('#ovBody input')].some((x) => x.value === '路灯'), { timeout: 10000 })
    .catch(async () => { throw new Error('things sheet did not render: ' + await page.evaluate(() => JSON.stringify({ hidden: RK.$('overlay').hidden,
      canvases: document.querySelectorAll('#ovBody .crop canvas').length, things: RK.things().map((t) => t.id + ':' + t.name), text: RK.$('ovBody').textContent.slice(0, 200) }))); });
  await page.screenshot({ path: path.join(SHOTS, 'things.png') });
  await page.click('#ovClose');
  check(await page.evaluate(() => RK.todoAll()) === 0, 'every item answered through the UI');
  check((await page.evaluate(() => RK.$('progress').textContent)) === '都答完了', 'progress says 都答完了');
  await page.click('#btnDone');
  await page.waitForFunction(() => RK.$('ovBody').textContent.includes('收到'), { timeout: 20000 });
  await page.waitForFunction(() => !RK.unsaved() && RK.$('save').textContent.startsWith('已保存'), { timeout: 10000 });

  // What the agent reads back.
  const A = JSON.parse(fs.readFileSync(path.join(DIR, 'answers.json'), 'utf8'));
  const ia = A.images['images/scene-a.png'], ib = A.images['images/scene-b.png'];
  const box = (im, id) => (im.boxes || []).find((b) => b.id === id) || {};
  const hat = (A.characters || []).find((c) => c.name === '戴帽子的人'), u1 = box(ia, 'u1');
  check(A.submittedRound === 1 && ia.w === 960 && ia.h === 540, 'answers.json: round submitted, image size recorded');
  check(box(ia, 'a1').kind === 'character' && box(ia, 'a1').character === 'c1', 'agent box confirmed with the guessed character');
  check(box(ia, 'a2').kind === 'passerby', 'kind set with keyboard shortcut 2');
  check(box(ia, 'a3').removed === true, 'agent box deleted');
  check(!!hat && u1.src === 'user' && u1.kind === 'character' && u1.character === hat.id && Math.abs(u1.x - 0.05) < 0.01 && Math.abs(u1.w - 0.1) < 0.01,
    'drawn box saved with a new character');
  check(ia.fields.where === '室外' && ia.fields.time === '夜晚' && ia.fields.weather === '雨' && ia.fields.main === true, 'field guesses confirmed, main view set');
  const q2 = ia.answers.q2 || {};
  check(ia.answers.q1.v === '是' && q2.v.length === 2 && q2.v.includes('店') && q2.v.includes('人') && q2.otherText === '雨伞', 'yes/no and multi-choice answers');
  check(ia.note === '招牌颜色要一样' && ib.answers.q1.v === '是' && box(ib, 'a1').character === 'c1', 'image note, confirmed guess, same character in image 2');
  check(A.project.answers.style.v === '和便利店那次一样的卡通' && A.project.notes.keep === '店在右边，路灯在左边', 'project question and notes');
  check(!!A.pairs.p1 && A.pairs.p1.v === '是', 'same-person pair answered');
  const lamp = (A.things || []).find((t) => t.name === '路灯'), a2b = box(ib, 'a2');
  check(box(ia, 'a4').kind === 'object' && box(ia, 'a4').thing === 't1' && (A.things || []).some((t) => t.id === 't1'), 'thing guess confirmed through the box guess');
  check(!!lamp && lamp.src === 'user' && a2b.kind === 'object' && a2b.thing === lamp.id && (a2b.notThing || []).includes('t1'),
    'thing proposal rejected, box linked to a new thing');
  for (const n of ['images__scene-a.jpg', 'images__scene-b.jpg']) {
    const p = path.join(DIR, 'exports', n);
    check(fs.existsSync(p) && fs.statSync(p).size > 5000, 'annotated export ' + n);
  }
  const rep = report();
  check(rep.status === 0 && rep.stdout.includes('戴帽子的人') && rep.stdout.includes('images/scene-a.png#a1 ↔ images/scene-b.png#a1 → 是') && rep.stdout.includes('用户删了'),
    'report.mjs summarises the answers');
  check(report('--todo').stdout.includes('都答完了'), 'report.mjs --todo is empty');
  check(rep.stdout.includes('== 物件/地点') && rep.stdout.includes('出现在：images/scene-a.png#a4') && rep.stdout.includes('用户说不是：images/scene-b.png#a2') &&
    rep.stdout.includes('= ' + (lamp && lamp.id) + ' 路灯'), 'report.mjs lists things, members and rejected proposals');

  // Reload keeps everything; the server refuses paths outside the data dir and foreign Host headers.
  await page.reload();
  await page.waitForFunction(() => window.RK && RK.A && RK.st && RK.Q.round === 1, { timeout: 15000 });
  check(await page.evaluate(() => RK.A.pairs.p1.v === '是' && RK.todoAll() === 0), 'answers survive a page reload');
  check(await rawGet(url, api('img/images/..%2Fanswers.json')) >= 400 && await rawGet(url, '/api/ref/..%2F..%2Fserve.mjs/state') >= 400,
    'server refuses paths outside images/ and outside the projects');
  check(await rawGet(url, api('state'), 'evil.example') === 403, 'server refuses a foreign Host header');
  const list = await getJson(url, '/api/ref');
  check(!!list && list.projects.length === 1 && list.projects[0].name === NAME && list.projects[0].round === 1 && list.projects[0].submittedRound === 1,
    'GET /api/ref lists the project with its round');
  await openImage('images/scene-a.png');
  await clickImage(0.30, 0.55);
  await page.screenshot({ path: path.join(SHOTS, 'main.png') });

  // Deleting an image: other sites are refused; the page moves the file to trash/ and keeps its labels;
  // a re-upload under the same name gets a fresh name instead of inheriting the old labels.
  const del = await rawPost(url, api('delete?key=' + encodeURIComponent('images/scene-b.png')), { Origin: 'http://evil.example' });
  check(del.status === 403 && fs.existsSync(path.join(DIR, 'images', 'scene-b.png')), 'server refuses a delete from another origin');
  await openImage('images/scene-b.png');
  await clickBtn('删除', null);
  await page.waitForFunction(() => RK.st.images.length === 1 && RK.cur === 'images/scene-a.png', { timeout: 10000 });
  const trash = fs.existsSync(path.join(DIR, 'trash')) ? fs.readdirSync(path.join(DIR, 'trash')) : [];
  check(!fs.existsSync(path.join(DIR, 'images', 'scene-b.png')) && trash.length === 1 && /^\d{8}-\d{6}__scene-b\.png$/.test(trash[0]) &&
    !fs.existsSync(path.join(DIR, 'exports', 'images__scene-b.jpg')), 'delete button moves the image to trash/ and drops its export');
  const A2 = JSON.parse(fs.readFileSync(path.join(DIR, 'answers.json'), 'utf8'));
  check(!!A2.images['images/scene-b.png'] && report().stdout.includes('图片 1 张'), 'labels of the deleted image are kept; report skips it');
  const up = await rawPost(url, api('upload?name=scene-b.png'), { 'Content-Type': 'image/png' }, fs.readFileSync(path.join(DIR, 'images', 'scene-a.png')));
  check(up.status === 200 && JSON.parse(up.body).key === 'images/scene-b-2.png', 're-upload of a deleted name gets a new name');
} catch (e) {
  check(false, 'unexpected error: ' + ((e && e.stack) || e));
}
check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
server.kill();
if (KEEP) console.log('kept ' + TMP); else fs.rmSync(TMP, { recursive: true, force: true });
console.log(`server: ${STANDALONE ? 'tools/refkit/serve.mjs' : 'serve.mjs'}  screenshots: ${path.relative(ROOT, SHOTS).split(path.sep).join('/')}/main.png, characters.png, things.png`);
console.log(fails.length ? `SELFTEST: FAIL (${fails.length})` : 'SELFTEST: PASS');
process.exit(fails.length ? 1 : 0);
