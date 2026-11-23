// Isolated browser integration: mock local APIs, no real chat, state or gallery writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

import { stage, stageFile } from './browser-files.mjs';
const assets = { 'home.html': 'text/html', 'cabin.html': 'text/html', 'cabin-gallery.js': 'text/javascript', 'cabin-bridge.js': 'text/javascript', 'cabin-gallery.css': 'text/css', 'cabin-bridge.css': 'text/css' };
const inject = '<link rel="stylesheet" href="/cabin-bridge.css"><link rel="stylesheet" href="/cabin-gallery.css"><script defer src="/cabin-bridge.js"></script><script defer src="/cabin-gallery.js"></script>';
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'home.html';
  if (!Object.hasOwn(assets, name)) return res.writeHead(204).end();
  let data = fs.readFileSync(stageFile(name), 'utf8');
  if (name.endsWith('.html')) data = data.replace('</body>', inject + '</body>');
  res.writeHead(200, { 'content-type': assets[name] + '; charset=utf-8' }).end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function hitShelf(page) {
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
    const r = V3.R.canvas.getBoundingClientRect(), out = [];
    for (const x of [.5, .3, .7]) for (const y of [.6, .4, .8]) for (const z of [.95, .65, .4]) {
      const p = new THREE.Vector3(box.min.x + x * (box.max.x - box.min.x), box.min.y + y * (box.max.y - box.min.y), box.min.z + z * (box.max.z - box.min.z)).project(V3.R.camera);
      out.push([r.left + (p.x + 1) * r.width / 2, r.top + (1 - p.y) * r.height / 2]);
    }
    return out;
  });
  for (const pt of points) {
    await page.mouse.move(...pt);
    await page.waitForTimeout(100);
    if (await page.evaluate(() => {
      const hover = document.querySelector('.interaction-hover[data-target="diaryShelf"]');
      return hover && !hover.hidden;
    })) return pt;
  }
  assert.fail('no visible bookshelf hit');
}

async function scenePixels(page) {
  const png = await page.screenshot();
  const stats = await page.evaluate(async data => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 24;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, image.width / 5, image.height / 5, image.width * .6, image.height * .6, 0, 0, 32, 24);
    const { data: pixels } = ctx.getImageData(0, 0, 32, 24);
    const colors = new Set(); let hash = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const rgb = pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2];
      colors.add(rgb); hash = (Math.imul(hash, 31) + rgb) | 0;
    }
    const r = V3.R.canvas.getBoundingClientRect();
    return { colors: colors.size, hash, width: r.width, height: r.height };
  }, png.toString('base64'));
  return { ...stats, png };
}

try {
  for (const [name, viewport] of [['home.html', {width: 1240, height: 820}], ['cabin.html', {width: 430, height: 810}]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [], chatBodies = [], activityRequests = [], uploads = [], prompts = [];
    const localQueue = new Map();
    let failArt = false, allowUpload = false;
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', route => {
      const req = route.request(), u = new URL(req.url());
      if (u.origin !== base) return route.abort();
      if (u.pathname === '/api/cabin/art') return failArt
        ? route.fulfill({ status: 503, json: { ok: false } })
        : route.fulfill({ json: { ok: true, drawings: [], diaries: [
          { day: '2026-11-10', chars: 13, text: '前一篇日记。\n<b>只显示成纯文本</b>' },
          { day: '2026-11-11', chars: 11, text: '这是最新的隔离测试日记。' },
        ] } });
      if (u.pathname === '/api/cabin/behavior') {
        const { events } = req.postDataJSON();
        uploads.push(events);
        if (!allowUpload) return route.fulfill({ status: 503, json: { ok: false } });
        for (const e of events) localQueue.set(e.id, e);
        return route.fulfill({ json: { ok: true, ackIds: events.map(e => e.id) } });
      }
      if (u.pathname === '/api/cabin/chat') {
        chatBodies.push(req.postDataJSON());
        if (chatBodies.length === 1) {
          allowUpload = true;
          return route.fulfill({ status: 502, json: { ok: false, error: 'fixture offline' } });
        }
        prompts.push([...localQueue.values()].map(e => e.action));
        localQueue.clear();
        return route.fulfill({ json: { ok: true, reply: { text: '收到。' }, ...(chatBodies.length === 2 ? { cabinAction: 'draw' } : {}) } });
      }
      if (u.pathname === '/api/cabin/activity') activityRequests.push(req.url());
      if (u.pathname === '/api/cabin/timeline') return route.fulfill({ json: { ok: true, day: '2026-11-11', events: [], nextAfter: 0, hasMore: false } });
      if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
      return req.method() === 'GET' ? route.continue() : route.abort();
    });
    await page.goto(`${base}/${name}?live=0&auto=0&wx=clear&time=noon`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__READY && window.__cabinGallery && V3.houseBlocks.grid, null, { timeout: 60000 });
    const overview = await scenePixels(page);
    const hit = await hitShelf(page);
    const closeup = await scenePixels(page);
    for (const frame of [overview, closeup]) {
      assert.ok(frame.colors > 40, `${name}: scene is blank or low diversity (${frame.colors})`);
      assert.ok(frame.width >= viewport.width - 2 && frame.height >= viewport.height - 2, `${name}: canvas should fill viewport`);
    }
    assert.notEqual(overview.hash, closeup.hash, `${name}: camera motion must change canvas pixels`);
    await page.mouse.click(...hit);
    const diary = '.alb-card[aria-label="书架 · 日记"]';
    const waitText = (selector, text) => page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text });
    await waitText(`${diary} .alb-diary-text`, '这是最新的隔离测试日记。');
    const prev = `${diary} button[title="上一页"]`, next = `${diary} button[title="下一页"]`;
    assert.equal(await page.$eval(prev, el => el.disabled), true);
    const nextPoint = await page.$eval(next, el => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(...nextPoint);
    await waitText(`${diary} .alb-diary-text`, '<b>只显示成纯文本</b>');
    assert.equal(await page.locator(`${diary} .alb-diary-text b`).count(), 0);
    assert.equal(await page.$eval(next, el => el.disabled), true);
    await page.$eval(`${diary} select`, el => { el.value = '0'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await waitText(`${diary} .alb-diary-text`, '这是最新的隔离测试日记。');
    assert.equal(await page.locator(`${diary} input[type=file]`).count(), 0);
    await page.waitForFunction(selector => {
      const card = document.querySelector(selector);
      return card?.parentElement?.classList.contains('in') && getComputedStyle(card).transform === 'none';
    }, diary);
    const bounds = await page.$eval(diary, card => {
      const r = card.getBoundingClientRect();
      const text = card.querySelector('.alb-diary-text');
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, overflow: text.scrollWidth - text.clientWidth };
    });
    assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= viewport.width + 1 && bounds.bottom <= viewport.height + 1 && bounds.overflow <= 1, JSON.stringify(bounds));
    fs.writeFileSync(path.join(stage, `a1-scene-${name.replace('.html', '.png')}`), closeup.png);
    await page.screenshot({ path: path.join(stage, `a1-diary-${name.replace('.html', '.png')}`) });
    await page.keyboard.press('Escape');
    await page.waitForFunction(selector => !document.querySelector(selector), diary);
    await page.evaluate(() => V3.album.open());
    await page.waitForFunction(() => document.querySelector('.alb-card[aria-label="相册"]'));
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('.cg-diary-toggle').click());
    await page.waitForFunction(() => document.querySelector('.cg-diary-panel.on .cg-diary-text')?.textContent.includes('这是最新的隔离测试日记'));
    await page.keyboard.press('Escape');
    failArt = true;
    await page.mouse.click(...hit);
    await waitText(`${diary} .alb-msg`, '日记暂时读不到');
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      const originalKinds = V3.game.kinds;
      V3.game.kinds = () => [...originalKinds(), ...V3.washupCatalog.collectibles];
      V3.collection.openDetail('rainbow_abalone');
    });
    const locked = '还没找到。常去沙滩上走走，浪会把它冲上来的。';
    assert.equal(await page.$eval('.col-desc', el => el.textContent), `${locked} 等到小雨或雷雨的时候，说不定海浪就会把它带上岸……`);
    await page.evaluate(() => V3.collection.openDetail(V3.shells.KINDS[0].id));
    assert.equal(await page.$eval('.col-desc', el => el.textContent), locked);
    const originalDescription = await page.evaluate(() => {
      V3.game.st.found.rainbow_abalone = { n: 1, first: Date.now() };
      V3.collection.openDetail('rainbow_abalone');
      return V3.game.kind('rainbow_abalone').desc;
    });
    assert.equal(await page.$eval('.col-desc', el => el.textContent), originalDescription);
    await page.evaluate(() => V3.collection.close());

    if (name === 'home.html') {
      const playerReport = page.waitForResponse(response => response.url().endsWith('/api/cabin/event')
        && response.request().postDataJSON()?.detail?.by === 'player');
      await page.evaluate(() => V3.emit('game:collect', { by: 'player', kind: { name: '玩家测试贝壳', category: 'collectible' } }));
      assert.equal((await playerReport).request().postDataJSON().text, '玩家捡到了玩家测试贝壳');
      await page.evaluate(() => {
        window.__events = [];
        V3.on('actor:behavior', e => window.__events.push(e));
        V3.emit('game:collect', { by: 'girl', kind: { name: '隔离测试贝壳' } });
        window.__cabinBridge.api.pollActivity();
      });
      assert.equal(chatBodies.length, 0);
      assert.equal((await page.evaluate(() => __cabinBridge.api.chat('第一句'))).ok, false);
      assert.equal((await page.evaluate(() => __cabinBridge.api.chat('第二句'))).ok, true);
      assert.equal((await page.evaluate(() => __cabinBridge.api.chat('第三句'))).ok, true);
      assert.equal(uploads[0][0].action, 'shell');
      assert.deepEqual(uploads[0], uploads[1], 'same ID when local persistence first failed');
      assert.deepEqual(prompts, [['shell'], []], 'log enters the next successful conversation exactly once');
      assert.ok(chatBodies.every(body => Object.keys(body).sort().join(',') === 'client,text'));
      assert.deepEqual(activityRequests, []);
      if (process.env.CABIN_EXPECT_ACTOR) {
        // Walk to the desk runs in real time; under SwiftShader it measured 46-50 s on this machine (2026-11-12), so 45 s
        // was a coin flip. The assertion is unchanged: the draw action must actually start.
        await page.waitForFunction(() => window.__events.some(e => e.kind === 'draw' && e.phase === 'action'), null, { timeout: 120000 });
        await page.evaluate(() => __cabinBridge.api.chat('核对画画日志'));
        assert.equal(prompts.at(-1).at(-1), 'draw');
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: real bookshelf click, shared album pager, fallback/side diary, no page errors.`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
