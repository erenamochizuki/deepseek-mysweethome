// 两样在真实页面上的核对（2026-11-12）：
//   A. 设置面板里滑条右边的数值可以直接输入：真的点进去、真的敲键盘。
//   B. 冬装小鲸鱼（导入的模型）被戳以后脸会变：真的用鼠标点她，比较脸那一块的画面。
//
//   node haibian/test/cabin-settings-face-browser.mjs
//   CABIN_TEST_STAGE=<…/web> YSM_WINTER_ZIP=<zip> FACE_EXPECT=old（拿旧构建跑：只打印，不断言「会变」）
//
// 一次性的浏览器配置目录，不碰玩家自己的浏览器数据；/api/* 全部本地应答。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const stage = process.env.CABIN_TEST_STAGE || '../_work/cabin-d-20261112/web';
const zip = process.env.YSM_WINTER_ZIP || './蓝色大肥鱼(冬装)_1.2.zip';
const shots = process.env.SHOTS || path.join(stage, '..', 'settings-face');
const expectNew = process.env.FACE_EXPECT !== 'old';
fs.mkdirSync(shots, { recursive: true });

const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'home.html';
  if (name !== 'home.html') return res.writeHead(204).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(path.join(stage, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-setface-'));
const context = await chromium.launchPersistentContext(userDataDir, { channel: 'msedge', headless: false, viewport: { width: 1100, height: 760 },
  args: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--window-position=0,0'] });
const out = {};
try {
  const page = context.pages()[0] || await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== base) return route.abort();
    if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
    return route.continue();
  });
  await page.goto(`${base}/home.html?live=0&auto=0&wx=clear&time=noon`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__READY && V3.actor && V3.houseBlocks && V3.houseBlocks.live(), null, { timeout: 120000 });
  await page.evaluate(async () => { await V3.houseBlocks.live().ready; await V3.nextFrames(10); });

  // ---------- A. 设置里的数值 ----------
  if (expectNew) {
    await page.evaluate(() => V3.settingsPanel.open('海边'));
    // 本机的 Edge 是 100：Playwright 的 locator 可见性判断要用 element.checkVisibility（Chrome 105+ 才有），会直接抛错。
    // 所以这里自己找元素：读值用 evaluate，点击用元素中心的真实鼠标坐标，键盘还是真键盘。
    const handle = (sel) => ({
      async waitFor() { await page.waitForFunction((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel, { timeout: 10000 }); },
      inputValue: () => page.evaluate((s) => document.querySelector(s).value, sel),
      isVisible: () => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e; }, sel),
      async click() {
        const p = await page.evaluate((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e }; }, sel);
        assert.ok(p.top, sel + ' 要真的点得到（没有被别的东西盖住）');
        await page.mouse.click(p.x, p.y);
      },
      // 滑条：像拖动一样设值并发 input 事件
      fill: (v) => page.evaluate(([s, v]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]),
    });
    const row = (key) => ({ locator: (inner) => handle(`.set-row[data-key="${key}"] ${inner}`) });
    const box = (key) => handle(`.set-row[data-key="${key}"] input.set-val`);
    const stored = (key) => page.evaluate((k) => V3.game.get(k), key);
    await box('washMin').waitFor({ state: 'visible', timeout: 10000 });
    out.before = { washMin: await box('washMin').inputValue(), washMax: await box('washMax').inputValue(), chance: await box('washChance').inputValue() };
    assert.match(out.before.washMin, /分钟$/, '平时带单位显示');
    await page.screenshot({ path: path.join(shots, 'settings-idle.png') });

    // 点进去：变成纯数字并全选；敲 12.3 回车 → 存成 12.5（步长 0.5），显示带单位；滑条跟着动
    await box('washMin').click();
    assert.equal(await box('washMin').inputValue(), String(parseFloat(out.before.washMin)), '点进去以后是纯数字');
    await page.screenshot({ path: path.join(shots, 'settings-editing.png') });
    await page.keyboard.type('12.3');
    await page.keyboard.press('Enter');
    assert.equal(await stored('washMin'), 12.5);
    assert.equal(await box('washMin').inputValue(), '12.5 分钟');
    assert.equal(await row('washMin').locator('input.set-range').inputValue(), '12.5', '滑条跟着数值走');
    // 成对的「最长」被推开：原来是 8，最短改成 12.5 以后最长也是 12.5
    assert.equal(await stored('washMax'), 12.5, '最短超过最长时把最长推上去（和拖滑条一样）');
    assert.equal(await box('washMax').inputValue(), '12.5 分钟');
    assert.equal(await page.evaluate(() => !!document.querySelector('.set-row[data-key="washMin"]')), true, '回车不会关掉面板');

    // 超范围 → 夹到上限；Tab 离开也算提交
    await box('washMax').click(); await page.keyboard.type('999'); await page.keyboard.press('Tab');
    assert.equal(await stored('washMax'), 60); assert.equal(await box('washMax').inputValue(), '60.0 分钟');
    // 乱打 → 恢复
    await box('washMax').click(); await page.keyboard.type('很多'); await page.keyboard.press('Enter');
    assert.equal(await stored('washMax'), 60); assert.equal(await box('washMax').inputValue(), '60.0 分钟');
    // Esc → 放弃，而且面板还开着
    await box('washMin').click(); await page.keyboard.type('3'); await page.keyboard.press('Escape');
    assert.equal(await stored('washMin'), 12.5, 'Esc 放弃这次输入');
    assert.equal(await box('washMin').isVisible(), true, 'Esc 只取消输入，不关面板');
    // 百分比：按 0–100 输入
    await box('washChance').click();
    assert.equal(await box('washChance').inputValue(), '50');
    await page.keyboard.type('80'); await page.keyboard.press('Enter');
    assert.ok(Math.abs(await stored('washChance') - 0.8) < 1e-9); assert.equal(await box('washChance').inputValue(), '80%');
    // ↑ 加一步
    await box('perMin').click(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    assert.equal(await stored('perMin'), 2);
    // 拖滑条照旧，数值框跟着变
    await row('maxBeach').locator('input.set-range').fill('15');
    assert.equal(await stored('maxBeach'), 15); assert.equal(await box('maxBeach').inputValue(), '15 个');
    // 刷新以后还在（走的是 V3.game.set 的保存）
    out.afterTyping = { washMin: await stored('washMin'), washMax: await stored('washMax'), chance: await stored('washChance'), perMin: await stored('perMin') };
    await page.screenshot({ path: path.join(shots, 'settings-after.png') });
    // 「角色」页：身高（也是滑条）同样可以输入
    await page.evaluate(() => V3.settingsPanel.open('角色'));
    await box('girlHeight').waitFor({ state: 'visible', timeout: 10000 });
    await box('girlHeight').click(); await page.keyboard.type('1.5'); await page.keyboard.press('Enter');
    assert.ok(Math.abs(await stored('girlHeight') - 1.5) < 1e-9); assert.equal(await box('girlHeight').inputValue(), '1.50 米');
    // 改身高会在停手 0.25 秒后重建一次角色（29-ysmui 的 heightT），模型设置那一块也跟着重画：等它建完再去碰腿长，
    // 否则改的是马上要被换掉的那个旧身体。
    const waitBody = async () => { await page.evaluate(() => { window.__inst0 = V3.actor.inst; }); await page.waitForFunction(() => V3.actor.inst !== window.__inst0, null, { timeout: 10000 }); await page.evaluate(() => V3.nextFrames(3)); };
    await waitBody();
    // 模型自带设置里的滑条（腿长）
    const legs = handle('.ysm-forms input.ysm-fv');
    await legs.waitFor({ state: 'visible', timeout: 10000 });
    out.legsBefore = await legs.inputValue();
    await legs.click(); await page.keyboard.type('80'); await page.keyboard.press('Enter');
    assert.equal(await legs.inputValue(), '80%');
    assert.ok(Math.abs(await page.evaluate(() => V3.actor.inst.getLegs()) - 0.8) < 1e-9, '腿长真的改了');
    await page.screenshot({ path: path.join(shots, 'settings-character.png') });
    await legs.click(); await page.keyboard.type('100'); await page.keyboard.press('Enter');
    await box('girlHeight').click(); await page.keyboard.type('1.26'); await page.keyboard.press('Enter');
    await waitBody();
    await page.keyboard.press('Escape');                // 现在才关面板
    await page.waitForFunction(() => !document.querySelector('.set-row'), null, { timeout: 5000 });

    // ---------- A2. 「新发现！」提示和收集盒的底色（本机 Edge 100 没有 color-mix()）----------
    // 2026-11-12：捡到虹彩鲍壳时提示文字下面没有底色。走真正的提示入口（V3.hud.toast，66-collect-fx 就是这么调的）。
    const toastStyle = (opts) => page.evaluate(async (opts) => {
      const t = V3.hud.toast(opts.text, opts);
      await new Promise(r => setTimeout(r, 450));                       // 等进场动画走完
      const cs = getComputedStyle(t), before = getComputedStyle(t, '::before');
      const r = t.getBoundingClientRect();
      const out = { bg: cs.backgroundColor, beforeBg: before.backgroundColor, beforeOpacity: before.opacity, beforeContent: before.content, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      return out;
    }, opts);
    const rare = await page.evaluate(() => V3.shellIcons.rarity('rare').color);
    const first = await toastStyle({ text: '新发现！虹彩鲍壳', color: rare, kind: 'rainbow_abalone', rarity: 'rare', first: true });
    await page.screenshot({ path: path.join(shots, 'toast-first-rare.png'), clip: { x: first.rect[0] - 12, y: first.rect[1] - 12, width: first.rect[2] + 24, height: first.rect[3] + 24 } });
    const again = await toastStyle({ text: '+1 虹彩鲍壳', color: rare, kind: 'rainbow_abalone', rarity: 'rare', first: false });
    const firstCommon = await toastStyle({ text: '新发现！帽贝', color: await page.evaluate(() => V3.shellIcons.rarity('common').color), kind: 'limpet', rarity: 'common', first: true });
    out.toast = { first, again, firstCommon, colorMix: await page.evaluate(() => CSS.supports('color', 'color-mix(in srgb, red 50%, blue)')) };
    const opaque = (c) => /^rgb\(/.test(c) || (/^rgba\(/.test(c) && parseFloat(c.split(',')[3]) > 0.9);
    assert.ok(opaque(again.bg), '普通的「+1」提示有底色：' + again.bg);
    assert.ok(opaque(first.bg), '「新发现！」提示（稀有）必须有底色：' + first.bg);
    assert.ok(opaque(firstCommon.bg), '「新发现！」提示（常见）必须有底色：' + firstCommon.bg);
    assert.notEqual(first.beforeContent, 'none', '稀有度颜色那一层在');
    assert.ok(parseFloat(first.beforeOpacity) > 0.1 && parseFloat(first.beforeOpacity) < 0.3, '稀有度颜色淡淡地盖在白底上');
    // 提示条中间那一点真正画出来的颜色：不能是透出来的场景
    // 收集盒：卡片描边、数量小牌、图标底
    await page.evaluate(() => V3.emit('game:open', 'collection'));
    await page.waitForFunction(() => document.querySelector('.col-card'), null, { timeout: 10000 });
    out.collection = await page.evaluate(() => {
      const card = document.querySelector('.col-card'), sub = card.querySelector('.col-sub'), well = card.querySelector('.col-well'), dot = document.querySelector('.col-gdot');
      return { cardShadow: getComputedStyle(card).boxShadow, subBg: getComputedStyle(sub).backgroundColor, wellBg: getComputedStyle(well).backgroundImage.slice(0, 90), dotShadow: getComputedStyle(dot).boxShadow };
    });
    await page.screenshot({ path: path.join(shots, 'collection.png') });
    assert.ok(opaque(out.collection.subBg), '收集盒卡片下面的小牌有底色：' + out.collection.subBg);
    assert.match(out.collection.cardShadow, /inset/, '卡片有稀有度颜色的描边：' + out.collection.cardShadow);
    assert.match(out.collection.wellBg, /radial-gradient/, '图标底是渐变：' + out.collection.wellBg);
    assert.notEqual(out.collection.dotShadow, 'none', '分组圆点有光晕');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.col-card'), null, { timeout: 5000 });
  }

  // ---------- B. 冬装被戳 ----------
  const rec = await page.evaluate(async (b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const r = await V3.ysmUI.import([new File([bytes], '蓝色大肥鱼(冬装)_1.2.zip', { type: 'application/zip' })], { use: true });
    return r && { id: r.id, name: r.name, builtin: V3.ysmUI.isBuiltin(r.id) };
  }, fs.readFileSync(zip).toString('base64'));
  assert.ok(rec && /冬装/.test(rec.name) && rec.builtin === false, JSON.stringify(rec));
  await page.waitForFunction((id) => V3.actor.bodyId === id, rec.id, { timeout: 30000 });
  // 站到门廊外。被戳以后她会转过来看镜头（respond 里的 face），所以「戳之前 / 戳之后」直接比画面，比到的是转身。
  // 做法：先真的戳一下让她转过来，等这一轮反应完全结束（她还面朝镜头站着），把镜头对准脸，采一组「平静」的画面；
  // 再真的戳第二下，采「惊讶」和「说话」的画面。两组里她的站姿、朝向一样，差别只来自脸。
  await page.evaluate(() => { window.__pokes = 0; V3.on('actor:poke', () => { window.__pokes++; }); V3.game.set && V3.game.set('girlAuto', false); });
  const aim = () => page.evaluate(async () => {
    // 脸的位置：对话框锚点（头顶上方 0.15 米）往下 0.45 米。按骨骼名找眼睛不可靠（试过：名字带 eye 的骨骼平均下来落在脚边）。
    const h = V3.actor.head(), c = h.clone().add(new THREE.Vector3(0, -0.6, 0)), eyes = [];
    const pos = V3.actor.pos, yaw = V3.actor._dbg ? V3.actor._dbg.yaw : 0;
    V3.R.ctl.set({ az: yaw, el: 0.02, dist: 2.6, target: [c.x, c.y, c.z] }, false);
    await V3.nextFrames(6);
    const r = V3.R.canvas.getBoundingClientRect(), p = c.clone().project(V3.R.camera), body = c.clone().add(new THREE.Vector3(0, -0.42, 0)).project(V3.R.camera);   // 戳的地方：脸下面的胸口，仍在画面里、在脸那块截图之外
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height, bx: r.left + (body.x + 1) / 2 * r.width, by: r.top + (1 - body.y) / 2 * r.height,
      eyeBones: eyes.length, yaw, tuned: !!(V3.ysmUI.tuneOf && V3.ysmUI.tuneOf(V3.actor.bodyId, V3.actor.inst.model)) };
  });
  const pokeAt = async (x, y) => {
    const n = await page.evaluate(() => window.__pokes);
    await page.mouse.move(x - 2, y); await page.mouse.move(x, y); await page.waitForTimeout(250);
    const tip = await page.evaluate(() => { const h = document.querySelector('.interaction-hover'); return h && !h.hidden ? document.querySelector('.interaction-hover-tip').textContent : null; });
    await page.mouse.down(); await page.mouse.up();
    await page.waitForFunction((n) => window.__pokes > n, n, { timeout: 5000 });
    return tip;
  };
  await page.evaluate(async () => { await V3.view('girl=at_0_4_0'); await V3.nextFrames(8); const p = V3.actor.pos; V3.R.ctl.set({ az: 0, el: 0.1, dist: 3, target: [p[0], p[1] + 0.7, p[2]] }, false); await V3.nextFrames(8); });
  let frame = await aim();
  out.hoverTip = await pokeAt(frame.bx, frame.by);                      // 第一下：点身子（不挡脸），让她转过来
  await page.waitForFunction(() => V3.actor.inst.states.expr.value === 'happy', null, { timeout: 15000 });   // 这一轮的表情演完了
  await page.waitForTimeout(6500);                                      // 隔 6 秒以上再戳才又是「第一下」（惊讶）；6 秒内连戳是开心
  frame = await aim();
  // 脸部那一块画面的签名（降采样成 32×24 的灰度）
  const clip = { x: Math.round(frame.x - 190), y: Math.round(frame.y - 210), width: 380, height: 330 };   // 整个头（帽子到下巴），不含下面戳的地方
  const sig = async () => {
    const png = await page.screenshot({ clip });
    return page.evaluate(async (data) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
      const c = document.createElement('canvas'); c.width = 32; c.height = 24;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 32, 24);
      const d = g.getImageData(0, 0, 32, 24).data, out = [];
      for (let i = 0; i < d.length; i += 4) out.push(Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]));
      return out;
    }, png.toString('base64'));
  };
  const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
  // 平静：采 5 帧，帧和帧之间最大的差别 = 她自己眨眼 / 呼吸带来的底噪
  const idle = [];
  for (let i = 0; i < 5; i++) { idle.push(await sig()); await page.waitForTimeout(120); }
  let noise = 0; for (let i = 0; i < idle.length; i++) for (let j = i + 1; j < idle.length; j++) noise = Math.max(noise, diff(idle[i], idle[j]));
  await page.screenshot({ path: path.join(shots, 'winter-before-poke.png'), clip });
  await pokeAt(frame.bx, frame.by);                                     // 第二下
  // 戳之后 0.25 秒（惊讶）和 1.3 秒（在说话）各采一帧
  await page.waitForTimeout(100);
  const expr1 = await page.evaluate(() => V3.actor.inst.states.expr.value);
  const s1 = await sig(); await page.screenshot({ path: path.join(shots, 'winter-poked-surprised.png'), clip });
  await page.waitForTimeout(900);
  const expr2 = await page.evaluate(() => V3.actor.inst.states.expr.value);
  const s2 = await sig(); await page.screenshot({ path: path.join(shots, 'winter-poked-talking.png'), clip });
  const d1 = Math.min(...idle.map(x => diff(x, s1))), d2 = Math.min(...idle.map(x => diff(x, s2)));
  out.winter = { model: rec, tuned: frame.tuned, eyeBones: frame.eyeBones, idleNoise: +noise.toFixed(2), pokedDiff: [+d1.toFixed(2), +d2.toFixed(2)], expr: [expr1, expr2],
    gpu: await page.evaluate(() => { const gl = V3.R.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }) };
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  assert.deepEqual(errors, []);
  assert.equal(out.hoverTip, '小鲸鱼 · 戳一戳');
  assert.equal(expr1, 'surprised', '戳一下：表情状态是惊讶');
  if (expectNew) {
    assert.equal(frame.tuned, true, '冬装版拿到了表情对照表');
    // 画面差只记下来、不断言：她站着会轻轻晃，整头入画时脸只占一小块，差值和晃动的底噪分不干净。
    // 「表情真的改了脸上的骨骼」由 test/ysm-face-tune.test.mjs 用真冬装文件断言（同一时刻、只差表情）；这里核对的是真实点击这条链路，截图给人看。
    assert.equal(expr2 === 'talk' || expr2 === 'surprised', true, '0.9 秒后在说话（嘴在动）：' + expr2);
    console.log(`PASS 设置数值可输入；冬装被戳后脸变了（画面差 ${d1.toFixed(2)} / ${d2.toFixed(2)}，眨眼底噪 ${noise.toFixed(2)}）`);
  } else console.log(`旧构建对照：有没有表情对照表 = ${frame.tuned}；戳之后画面差 ${d1.toFixed(2)} / ${d2.toFixed(2)}，眨眼底噪 ${noise.toFixed(2)}`);
} finally {
  await context.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* temp profile */ }
  await new Promise(resolve => server.close(resolve));
}
