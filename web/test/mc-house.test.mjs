// mc-house.test.mjs — 工作台模型「小屋 v4 方块草图」（src/43-house-mc-model.js）
// Node 部分：假房子、楼层裁切、按部件拆分；浏览器部分（无头 Edge + serve.mjs）：列表里有、开关初始值是 42 的 DEFAULTS、
// 材料能换、视角口令、三个楼层、部件能点选、没有 / 有 jar 缓存都能画、截图不是空的、换模型再换回来没报错。
// 用法：cd web && node test/mc-house.test.mjs   （MC_GPU=swiftshader 强制软件渲染；KEEP_TMP=1 留下 test/tmp-mchouse）
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR, launchBrowser, decodePng, inflateRaw } from '../tools/mc-lib.mjs';
import { makeTestJar } from '../tools/mc-testjar.mjs';
import { loadV3 } from '../tools/lib/v3-node.mjs';

let pass = 0, fail = 0;
const ok = (c, what, got) => {
  if (c) { pass++; console.log('PASS ' + what); }
  else { fail++; console.log('FAIL ' + what + (got !== undefined ? ' → ' + JSON.stringify(got).slice(0, 400) : '')); }
};

// ---------------- Node：不用浏览器的部分 ----------------
async function nodeTests() {
  const { V3 } = loadV3(['14-mcjar', '15-mcmodel', '16-mcmesh', '17-mcfallback', '19-mcentity', '19-mclight', '43-house-mc-model']);
  const H = V3.houseMcModel, S = V3.mcmesh, M = V3.mcmodel;
  const a = H.fakeHouse('a'), b = H.fakeHouse('b'), m = a.model, [W, Hh, L] = m.size;
  ok(a.parts.length === m.cells.length && a.parts.every((p, i) => !!p === !!m.cells[i]), '假房子：parts 和格子一样长，空气格没有部件');
  ok(JSON.stringify(m.size) !== JSON.stringify(b.model.size), '假房子：方案 A、B 大小不同', [m.size, b.model.size]);
  ok(JSON.stringify(S.worldOrigin(m)) === '[-7,0,-15]', '假房子：格子 (0,0,0) 在场景 (-7,0,-15)（Origin + Offset）', S.worldOrigin(m));
  ok(m.palette.every((s) => !!M.parseState(s).name), '假房子：调色板都是方块状态字符串');
  ok(a.levels.map((l) => l.id).join() === 'ground,loft' && a.furniture.length >= 2, '假房子：有一楼、阁楼和家具');
  ok(H.cutY(a.levels, 'all') === Infinity && H.cutY(a.levels, 'ground') === 3 && H.cutY(a.levels, 'loft') === 6 && H.cutY(a.levels, 'x') === Infinity, '楼层：cutY');
  const cut = H.cutModel(m, 3), air = cut.palette.indexOf('minecraft:air');
  let above = 0, keep = true;
  for (let i = 0; i < cut.cells.length; i++) {
    const y = Math.floor(i / (W * L));
    if (y > 3 && cut.cells[i] !== air) above++;
    if (y <= 3 && cut.cells[i] !== m.cells[i]) keep = false;
  }
  ok(above === 0 && keep && H.cutModel(m, Infinity) === m, '楼层：cutModel 只把 y>3 的格子换成空气，原模型不变', { above, keep });
  const noAir = { size: [1, 2, 1], palette: ['minecraft:stone'], cells: Int32Array.from([0, 0]) };
  const c2 = H.cutModel(noAir, 0);
  ok(c2.palette.length === 2 && c2.palette[1] === 'minecraft:air' && c2.cells[1] === 1 && noAir.palette.length === 1, '楼层：调色板里没有空气时补一个');
  // 面落在哪一格：(2,0,3) 的顶面（y=1，法线朝上）、东面（x=3，法线朝东）
  const top = Float32Array.from([2, 1, 3, 2, 1, 4, 3, 1, 4, 3, 1, 3]), east = Float32Array.from([3, 0, 3, 3, 1, 3, 3, 1, 4, 3, 0, 4]);
  ok(H.cellOfQuad(top, 0).join() === '2,0,3', '拆分：顶面属于下面那格', H.cellOfQuad(top, 0));
  ok(H.cellOfQuad(east, 0).join() === '2,0,3', '拆分：东面属于西边那格', H.cellOfQuad(east, 0));
  const res = await S.build(m, { ao: true, light: true, mipmaps: false });
  const sp = H.splitByPart(res, a.parts), q = res.stats.quads;
  let sum = 0;
  const cnt = (p) => { const e = sp.get(p) || {}; let n = 0; for (const k of H.LAYERS) n += e[k] ? e[k].quads : 0; return n; };
  for (const [, e] of sp) for (const k of H.LAYERS) if (e[k]) sum += e[k].quads;
  ok(sum === q.solid + q.cutout + q.translucent + q.entity && sum > 1000, '拆分：拆完面数不变', { sum, q });
  ok([...sp.keys()].every((p) => p === '' || a.parts.includes(p)) && sp.has('墙/南墙') && sp.has('屋顶/北坡'), '拆分：分组都是 parts 里的名字', [...sp.keys()]);
  ok(!sp.has(''), '拆分：没有面落到空气格（每个面都归到画它的那块方块）', cnt(''));
  ok(cnt('屋顶/北坡') === cnt('屋顶/南坡') && cnt('屋顶/北坡') > 50, '拆分：方案 A 南北对称，两坡面数一样', [cnt('屋顶/北坡'), cnt('屋顶/南坡')]);
  ok(!res.warnings.length, '假房子：没有 jar 也画得出来，没有警告', res.warnings.slice(0, 3));
}

// fmt-js 的真数据（src/42-house-mc.js）：接口约定 + 网格；MC_JAR 给了就再用真 jar 查一遍所有方块状态和贴图
async function realTests() {
  const { V3 } = loadV3(['14-mcjar', '15-mcmodel', '16-mcmesh', '17-mcfallback', '19-mcentity', '19-mclight', '42-house-mc', '43-house-mc-model']);
  const H = V3.houseMcModel, S = V3.mcmesh, M = V3.mcmodel, HM = V3.houseMc;
  if (!H.real()) { console.log('SKIP 真数据：42-house-mc.js 还没有 build()'); return; }
  const jar = process.env.MC_JAR;
  let pack = null;
  if (jar && fs.existsSync(jar)) pack = await V3.mcjar.fromBytes(fs.readFileSync(jar), { inflateRaw });
  else console.log('SKIP 真数据 + 真 jar：没设 MC_JAR');
  // P5 模组家具：和网页一样把模组自己的资源盖在 jar 上（mod/src/main/resources/assets/xiaojingyu）；还没导出时跳过模组方块的那几条警告
  const MODA = path.join(WEB_DIR, '..', 'mod', 'src', 'main', 'resources', 'assets', 'xiaojingyu'), modFiles = new Map();
  const walkMod = (d, rel) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f), r = rel + '/' + f; if (fs.statSync(p).isDirectory()) walkMod(p, r); else modFiles.set(r, new Uint8Array(fs.readFileSync(p))); } };
  for (const sub of ['blockstates', 'models', 'textures']) walkMod(path.join(MODA, sub), 'assets/xiaojingyu/' + sub);
  const hasMod = [...modFiles.keys()].some((k) => k.includes('/blockstates/'));
  if (pack && hasMod) pack = V3.mcjar.makePack(new Map([...pack.files, ...modFiles]), { key: pack.key + '+xjy', inflateZlib: pack.inflateZlib });
  if (pack && !hasMod) console.log('SKIP 模组家具的模型：mod/src/main/resources/assets/xiaojingyu/blockstates 还没有（P5 的 furn-mc export 之后再查）');
  const modWarn = (w) => !hasMod && /xiaojingyu:/.test(String(w));   // 模组资源还没导出时，模组方块缺模型不算
  ok(H.variants() === HM.variants && HM.variants.length === 1 && HM.variants[0].id === 'b', '真数据：方案列表来自 42（定稿只有方案 b）', H.variants().map((v) => v.id));
  const mats = H.materials();
  ok(mats.roof.length >= 2 && mats.wall.length >= 2, '真数据：屋顶、墙面材料选项来自 42', mats);
  ok(H.defaults() === HM.DEFAULTS && HM.DEFAULTS.roof === 'two' && HM.DEFAULTS.wall === 'quartz', '真数据：开关初始值用 42 的 DEFAULTS（两色屋顶、平滑石英）', H.defaults());
  const sizes = [];
  for (const v of HM.variants) {
    const d = await H.data(v.id), m = d.model, xo = m.meta.compound.Xiaojingyu.compound;
    const [W, Hh, L] = m.size;
    let mis = 0, solid = 0;
    for (let i = 0; i < m.cells.length; i++) {
      const air = M.isAir(M.parseState(m.palette[m.cells[i]]));
      if (!air) solid++;
      if (air !== (d.parts[i] == null)) mis++;
    }
    sizes.push(solid);
    ok(d.parts.length === m.cells.length && mis === 0, `真数据 ${v.id}：parts 和格子一样长，空气格才是 null`, { mis });
    const noLabel = [...new Set(d.parts.filter(Boolean))].flatMap((p) => p.split('/').map((_, k, a) => a.slice(0, k + 1).join('/'))).filter((p) => !d.labels[p]);
    ok(!noLabel.length, `真数据 ${v.id}：每一层部件路径都有中文名`, noLabel.slice(0, 5));
    ok(m.palette.every((s) => !!M.parseState(s).name), `真数据 ${v.id}：调色板都是方块状态字符串`);
    const o = S.worldOrigin(m), want = Array.from(xo.Origin.intArray).map((c, k) => c + m.offset[k]);
    ok(JSON.stringify(o) === JSON.stringify(want) && xo.Facing.string === 'north' && JSON.stringify(Array.from(xo.Origin.intArray)) === JSON.stringify(Array.from(HM.ORIGIN)),
      `真数据 ${v.id}：格子 (0,0,0) 的场景位置 = Origin + Offset，朝北`, { o, want });
    const [g, lo] = ['ground', 'loft'].map((id) => d.levels.find((l) => l.id === id));
    ok(g && lo && g.y0 <= g.y1 && g.y1 < lo.y0 && lo.y0 <= lo.y1 && lo.y1 < Hh, `真数据 ${v.id}：一楼在阁楼下面，都在模型高度里`, d.levels);
    const badF = d.furniture.filter((f) => !f.id || !f.label || !d.levels.some((l) => l.id === f.level) || f.box.length !== 6 || !(f.box[0] < f.box[3] && f.box[1] < f.box[4] && f.box[2] < f.box[5]));
    // P5 起家具都是模组方块（furnBlocks），占位盒子（furniture）可以是空的
    const fb = d.furnBlocks || [], badB = fb.filter((f) => !f.id || !f.label || !d.levels.some((l) => l.id === f.level) || f.box.length !== 6 || !f.facing);
    ok(!badF.length && fb.length >= 20 && !badB.length, `真数据 ${v.id}：家具（${fb.length} 件模组方块 + ${d.furniture.length} 件占位）都有名字、楼层、格子和朝向`, [badF.slice(0, 3), badB.slice(0, 3)]);
    ok(['steps', 'door_out', 'door_in'].every((id) => d.anchors.some((a) => a.id === id && a.pos.length === 3)), `真数据 ${v.id}：有台阶、门口的锚点`);
    const counts = [];
    for (const fl of ['ground', 'loft', 'all']) {
      const res = await S.build(H.cutModel(m, H.cutY(d.levels, fl)), { pack, ao: true, light: true, mipmaps: false });
      const sp = H.splitByPart(res, d.parts), q = res.stats.quads;
      let sum = 0; for (const e of sp.values()) for (const k of H.LAYERS) if (e[k]) sum += e[k].quads;
      counts.push(res.stats.blocks);
      ok(sum === q.solid + q.cutout + q.translucent + q.entity && !sp.has('') && [...sp.keys()].every((p) => d.parts.includes(p)),
        `真数据 ${v.id} ${fl}：拆完面数不变，每个面都归到一个部件`, { sum, groups: sp.size });
      const warns = res.warnings.filter((w) => !modWarn(w)), missSt = res.stats.missingStates.filter((w) => !modWarn(w)), modFb = hasMod ? 0 : res.stats.missingStates.length - missSt.length;
      ok(!warns.length && (!pack || (res.stats.fallback === modFb && !res.stats.missingSprites.length && !missSt.length)),
        `真数据 ${v.id} ${fl}：没有警告${pack ? '，真 jar' + (hasMod ? '（加模组资源）' : '') + ' 里方块状态和贴图都找得到' : ''}`, warns.slice(0, 3));
    }
    ok(counts[0] < counts[1] && counts[1] < counts[2], `真数据 ${v.id}：一楼 < 阁楼 < 全部`, counts);
  }
  ok(sizes.length === 1 && sizes[0] > 700, '真数据：房子有 700 多个方块', sizes);
  const pals = new Set();
  for (const r of mats.roof) for (const w of mats.wall) pals.add([...(await H.data(HM.DEFAULTS.variant, { roof: r.id, wall: w.id })).model.palette].sort().join());
  ok(pals.size === mats.roof.length * mats.wall.length, '真数据：每种屋顶 × 墙面的方块都不一样', pals.size);
}

// ---------------- 浏览器：工作台里的模型 ----------------
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const TMP = path.join(WEB_DIR, 'test', 'tmp-mchouse');
const shotOf = async (page) => decodePng(Buffer.from(await page.screenshot({ type: 'png' })));
const diffOf = (A, B) => {
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 30) n++;
  return n / (A.width * A.height);
};

async function browserTests() {
  const b = spawnSync(process.execPath, [path.join(WEB_DIR, 'build.mjs'), 'studio'], { cwd: WEB_DIR, encoding: 'utf8' });
  ok(b.status === 0 && /syntaxErrors=0/.test(b.stdout), '构建 studio：syntaxErrors=0', (b.stdout || '') + (b.stderr || ''));
  if (b.status !== 0) return;
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const d of ['fb', 'ref']) fs.mkdirSync(path.join(TMP, d), { recursive: true });
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  let log = '', browser = null;
  const srv = spawn(process.execPath, [path.join(WEB_DIR, 'serve.mjs'), '--port', String(port), '--fb-dir', 'test/tmp-mchouse/fb', '--ref-dir', 'test/tmp-mchouse/ref'],
    { cwd: WEB_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { try { up = (await fetch(base + '/api/ping')).ok; } catch { await new Promise((r) => setTimeout(r, 200)); } }
    ok(up, 'serve.mjs 起来了', log.slice(-300));
    if (!up) return;
    let gpu = process.env.MC_GPU || 'd3d11';
    for (;;) {
      browser = await launchBrowser({ width: 1280, height: 720, gpu });
      const p0 = await browser.newPage();
      const gl2 = await p0.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
      await p0.close();
      if (gl2 || gpu === 'swiftshader') break;
      await browser.close(); gpu = 'swiftshader';
    }
    console.log('gpu ' + gpu);
    const page = await browser.newPage(), errs = [], jar = makeTestJar({ entities: true });
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console ' + m.text()); });
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().endsWith('/__test.jar') ? r.respond({ status: 200, contentType: 'application/java-archive', body: jar }) : r.continue()));
    const open = async (q, raw = false) => {
      await page.goto(base + '/studio.html?' + q, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__READY === true, { timeout: 90000 });
      if (raw) return page.evaluate(() => V3.models.current().info());   // 不自己等 ready：看 __READY 时是不是已经画完
      return page.evaluate(async () => { await V3.models.current().ready; await V3.nextFrames(3); return V3.models.current().info(); });
    };
    const set = (k, v) => page.evaluate(async (k, v) => {
      V3.setState(k, v); const inst = V3.models.current(); await inst.ready; await V3.nextFrames(3); return inst.info();
    }, k, v);
    await browserSteps(page, open, set, errs);
  } finally {
    if (browser) await browser.close();
    srv.kill();
    if (!process.env.KEEP_TMP) fs.rmSync(TMP, { recursive: true, force: true });
  }
}

async function browserSteps(page, open, set, errs) {
  // 1. 没有 jar 缓存
  let info = await open('model=housemc', true);
  ok(info.builds >= 1 && info.stats && info.stats.blocks > 300, '__READY 时异步模型已经画完（90-studio 等了 inst.ready）', info.stats);
  info = await open('model=housemc');
  ok(info.source === '42-house-mc' && !info.fake && info.roof && info.wall, '工作台用的是 42-house-mc.js 的真数据，有屋顶、墙面开关', { source: info.source, roof: info.roof, wall: info.wall });
  const list = await page.evaluate(() => V3.models.list().map((m) => m.id + '|' + m.label));
  ok(list.includes('housemc|小屋 v4 方块草图'), '模型列表里有「小屋 v4 方块草图」', list);
  ok(!info.error && info.groups.length >= 10 && info.stats.blocks > 300, '没有 jar：方块小屋画出来了', info);
  ok(info.pack === null && /MC 方块查看/.test(info.hint || ''), '没有 jar：用自己的颜色，并提示去选 jar', info.hint);
  ok(await page.evaluate(() => document.body.innerText.includes('MC 方块查看')), '没有 jar：页面上弹了提示');
  const tree = await page.evaluate(() => ({ wall: V3.parts.objects('方块小屋/墙/南墙').length, label: V3.parts.label('方块小屋/墙'),
    furn: V3.parts.list('方块小屋/家具').length, root: V3.parts.label('方块小屋') }));
  ok(tree.wall > 0 && tree.furn > 1 && tree.root === '小屋 v4 方块草图', '部件：墙、家具都登记了', tree);
  // 2. 点选
  const hits = await page.evaluate(() => {
    const out = [], rc = V3.R.canvas.getBoundingClientRect();
    for (let i = 1; i < 16; i++) for (let j = 1; j < 10; j++) {
      const x = rc.left + (rc.width * i) / 16, y = rc.top + (rc.height * j) / 10, h = V3.fb.pickAt(x, y);
      if (h && h.path.startsWith('方块小屋/')) out.push({ x, y, path: h.path, d: Math.hypot(x - rc.width / 2, y - rc.height / 2) });
    }
    return out.sort((a, b) => a.d - b.d);
  });
  ok(new Set(hits.map((h) => h.path)).size >= 3, '点选：画面上能点到好几种部件', [...new Set(hits.map((h) => h.path))]);
  if (hits.length) {
    await page.mouse.click(hits[0].x, hits[0].y);
    const sel = await page.evaluate(() => V3.fb.sel);
    ok(sel === hits[0].path, '点选：点一下就选中那个部件', { sel, want: hits[0].path });
    await page.evaluate(() => V3.fb.select(null));
  }
  // 3. 截图不是空的
  await page.evaluate(() => V3.view('ui=0'));
  const s1 = await shotOf(page);
  await page.evaluate(async () => { V3.models.current().root.visible = false; await V3.nextFrames(3); });
  const s0 = await shotOf(page);
  await page.evaluate(async () => { V3.models.current().root.visible = true; await V3.nextFrames(3); });
  const d = diffOf(s1, s0);
  ok(d > 0.05, `截图不是空的：藏起房子画面变了 ${(d * 100).toFixed(1)}%`, d);
  // 4. 开关初始值、视角口令、楼层、家具、贴图
  const ids = await page.evaluate(() => V3.models.current().states.plan.options.map((o) => o[0]));
  const def = await page.evaluate(() => V3.houseMc.DEFAULTS);
  ok(ids.length === 1 && ids[0] === def.variant && info.variant === def.variant && info.roof === def.roof && info.wall === def.wall,
    '开关：方案只有定稿一项，初始值是 V3.houseMc.DEFAULTS（方案 b、两色屋顶、平滑石英）', { ids, def, info: [info.variant, info.roof, info.wall] });
  const vt = await page.evaluate(async (d) => {   // 反馈里存的视角是「键=值」口令，重放时要回到同样的开关；V3.view 自己等画完
    await V3.view('model=housemc+plan=' + d.variant + '+roof=spruce'); const i = V3.models.current();
    const r = i.info(); await V3.view('roof=' + d.roof); return { r, back: i.info().roof, errs: (window.__errors || []).length };
  }, def);
  ok(vt.r.variant === def.variant && vt.r.roof === 'spruce' && vt.r.builds > info.builds && String(vt.r.size) === String(info.size) && vt.back === def.roof && vt.errs === 0,
    '视角口令：plan=…、roof=… 能切开关，V3.view 等到画完（不和 variant 口令冲突）', vt);
  const rv = await open('model=housemc&view=roof%3Dspruce%2Bhouse', true);
  ok(rv.roof === 'spruce' && String(rv.size) === String(info.size) && rv.stats.blocks > 300, '带 view= 打开：__READY 时已经换好屋顶', rv);
  const wr = await page.evaluate(async () => {     // V3.waitReady：超时、失败只记一次、等的时候 ready 换了接着等
    const n0 = window.__errors.length, never = new Promise(() => {}), t0 = Date.now();
    const slow = await V3.waitReady({ id: 't-slow', ready: never }, 300), dt = Date.now() - t0;
    const again = await V3.waitReady({ id: 't-slow', ready: never }, 300);
    const bad = Promise.reject(new Error('坏了')), fail1 = await V3.waitReady({ id: 't-bad', ready: bad }), fail2 = await V3.waitReady({ id: 't-bad', ready: bad });
    const x = { id: 't-swap', ready: new Promise((res) => setTimeout(res, 50)) }; let late = false;
    setTimeout(() => { x.ready = new Promise((res) => setTimeout(() => { late = true; res(); }, 150)); }, 10);
    const swap = await V3.waitReady(x, 2000), none = await V3.waitReady({ id: 't-none' });
    const errs = window.__errors.splice(n0);
    return { n0, slow, dt, again, fail1, fail2, swap, late, none, errs };
  });
  ok(wr.slow === false && wr.dt >= 250 && wr.dt < 2000 && wr.again === false && wr.errs.filter((e) => /t-slow 0\.3 秒还没画完/.test(e)).length === 1,
    'V3.waitReady：超时返回 false、记一条中文错误、同一个 Promise 不再等', wr);
  ok(wr.fail1 === false && wr.fail2 === false && wr.errs.filter((e) => /t-bad ready: .*坏了/.test(e)).length === 1, 'V3.waitReady：失败只记一次', wr.errs);
  ok(wr.n0 === 0 && wr.swap === true && wr.late === true && wr.none === true && wr.errs.length === 2, 'V3.waitReady：等的时候 ready 换了就等新的；没有 ready 直接过；之前页面没报错', wr);
  await open('model=housemc');
  const g = await set('floor', 'ground'), lo = await set('floor', 'loft'), al = await set('floor', 'all');
  ok(!g.error && g.stats.blocks < lo.stats.blocks && lo.stats.blocks <= al.stats.blocks, '楼层：一楼 < 阁楼 ≤ 外观（方块数）', [g.stats.blocks, lo.stats.blocks, al.stats.blocks]);
  ok(g.groups.length < al.groups.length, '楼层：一楼少了屋顶那些部件', [g.groups.length, al.groups.length]);
  ok(g.furnitureShown <= lo.furnitureShown && al.furnitureShown === al.furnitureItems, '楼层：家具占位跟着楼层显示（P5 起家具都是方块，占位可以是 0 件）', [g.furnitureShown, lo.furnitureShown, al.furnitureShown]);
  const off = await set('furniture', 'off');
  ok(off.furnitureShown === 0 && off.builds === al.builds, '家具：关掉就不显示（不用重建）', off);
  await set('furniture', 'on');
  if (info.roof && info.wall) {   // 42 的材料小样：换屋顶、墙面要重建，方块数不变
    const r2 = await set('roof', 'spruce'), w2 = await set('wall', 'calcite');
    ok(!r2.error && r2.roof === 'spruce' && w2.wall === 'calcite' && w2.builds > al.builds && w2.stats.blocks === al.stats.blocks, '材料：换屋顶、墙面会重画，方块数不变', [r2.roof, w2.wall, w2.stats.blocks]);
    await set('roof', info.roof); await set('wall', info.wall);
  }
  const own = await set('tex', 'own');
  ok(!own.error && own.pack === null && own.hint === null && own.stats.fallback > 0, '贴图：「我们自己的颜色」', own);
  await set('tex', 'mc');
  const sNo = await shotOf(page);
  // 5. 有 jar 缓存（在别的页选过 jar 的效果：同一个网址的 IndexedDB）
  const saved = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch('/__test.jar')).arrayBuffer());
    const pack = await V3.mcjar.fromBytes(bytes); await V3.mcjar.cacheSave(pack); return pack.key;
  });
  info = await open('model=housemc');
  ok(info.pack === saved && info.hint === null && !info.error, '有 jar 缓存：自动用上', { pack: info.pack, saved });
  ok(info.stats.fallback < own.stats.fallback, '有 jar 缓存：jar 里有的方块不再用自己的颜色', [info.stats.fallback, own.stats.fallback]);
  await page.evaluate(() => V3.view('ui=0'));
  const sJar = await shotOf(page);
  ok(diffOf(sNo, sJar) > 0.01, '有 jar 缓存：画面和没 jar 时不一样');
  // 6. 换别的模型（家具一览）再换回来
  const sw = await page.evaluate(async () => {
    V3.models.show('furn'); await V3.nextFrames(3); V3.models.show('housemc');
    const i = V3.models.current(); await i.ready; await V3.nextFrames(3); return i.info();
  });
  ok(!sw.error && sw.groups.length >= 10, '换成别的模型再换回来，还能画');
  const pe = await page.evaluate(() => (window.__errors || []).slice(0, 5));
  ok(!errs.length && !pe.length, '页面没有报错', { errs: errs.slice(0, 5), pe });
}

await nodeTests();
await realTests();
if (!process.argv.includes('--node')) await browserTests();
console.log(`mc-house: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
