// test/mc-view.test.mjs — 开发用查看页 dist/mcview.html 的浏览器测试（无头 Edge）
//   node test/mc-view.test.mjs            （MC_GPU=swiftshader 可以强制用软件渲染）
// 用 tools/mc-testjar.mjs 现造的小 jar，不需要 MC 的 jar。
import { build } from '../build.mjs';
import { launchBrowser, serveFiles, decodePng, encodePng, makeZip } from '../tools/mc-lib.mjs';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { makeTestJar, TEST_COLORS, ENTITY_COLORS } from '../tools/mc-testjar.mjs';

let pass = 0, fail = 0;
function ok(cond, what, got) {
  if (cond) { pass++; console.log('PASS', what); } else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); }
}

const b = build('mcview');
ok(b.errors.length === 0, 'mcview 页面编译没有语法错误', b.errors);
const jar = makeTestJar();
const scene = { size: [3, 2, 3], palette: ['minecraft:air', 'minecraft:stone', 'minecraft:grass_block[snowy=false]', 'minecraft:glass', 'minecraft:oak_leaves[distance=7,persistent=false,waterlogged=false]'],
  cells: [1, 1, 1, 2, 2, 2, 1, 1, 1, 0, 3, 0, 0, 0, 0, 0, 4, 0] };
const srv = await serveFiles({ '/mcview.html': b.out, '/test.jar': jar, '/bad.jar': makeZip([['hello.txt', 'hi']]), '/scene.json': scene });

let browser = await launchBrowser({ width: 800, height: 600 });
{
  // 无头 Edge 用 d3d11 拿不到 WebGL 时换软件渲染
  const p = await browser.newPage();
  const gl = await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  await p.close();
  if (!gl) { console.log('d3d11 没有 WebGL，改用 swiftshader'); await browser.close(); browser = await launchBrowser({ width: 800, height: 600, gpu: 'swiftshader' }); }
}
const errors = [];
async function open(query, base) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto((base || srv.url) + '/mcview.html?' + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mcview && window.__mcview.started && window.__mcview.ready, { timeout: 60000 });
  return page;
}
// 截一张图，数一数画出来的像素，顺便找某个颜色
async function shot(page, colors = {}) {
  const url = await page.evaluate(() => window.__mcview.snapshot());
  const img = await decodePng(Buffer.from(url.split(',')[1], 'base64'));
  let drawn = 0;
  const found = Object.fromEntries(Object.keys(colors).map((k) => [k, 0]));
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 8) continue;
    drawn++;
    for (const [k, c] of Object.entries(colors)) if (Math.abs(img.data[i] - c[0]) <= 3 && Math.abs(img.data[i + 1] - c[1]) <= 3 && Math.abs(img.data[i + 2] - c[2]) <= 3) found[k]++;
  }
  return { w: img.width, h: img.height, drawn, frac: drawn / (img.width * img.height), found, img };
}
const diff = (a, b2) => { let d = 0; for (let i = 0; i < a.img.data.length; i++) d += Math.abs(a.img.data[i] - b2.img.data[i]); return d / a.img.data.length; };
const mul = (a, b2) => a.map((v, i) => Math.round(v * b2[i] / 255));
const STONE_TOP = TEST_COLORS.stone, GRASS_TOP = mul(TEST_COLORS.grass_top, TEST_COLORS.grassMap);
const brief = (s) => ({ w: s.w, h: s.h, drawn: s.drawn, frac: s.frac, found: s.found });

// A：从网址读 jar（存缓存），画场景（ao=0：平光，好按颜色找石头和草）
{
  const page = await open('jar=/test.jar&cache=1&model=/scene.json&ao=0');
  const h = await page.evaluate(() => ({ pack: window.__mcview.pack, stats: window.__mcview.stats, error: window.__mcview.error || null }));
  ok(h.pack && h.pack.counts.blockstates === 7 && !h.error, '查看页读了小 jar', h.pack);
  ok(h.stats.fallback === 0 && h.stats.blocks === 11 && h.stats.quads.solid > 0 && h.stats.quads.cutout > 0, '场景建好了网格', h.stats);
  const s = await shot(page, { stone: STONE_TOP, grass: GRASS_TOP });
  ok(s.frac > 0.05 && s.found.stone > 50 && s.found.grass > 50, '画面上有石头的灰和染过的草色', brief(s));
  ok(await page.evaluate(() => window.__mcview.saving) === true, 'jar 存进了 IndexedDB');
  await page.close();
}
// B：再打开（不给 jar）→ 从缓存读
{
  const page = await open('model=/scene.json&ao=0');
  const h = await page.evaluate(() => ({ pack: window.__mcview.pack, stats: window.__mcview.stats }));
  const s = await shot(page, { grass: GRASS_TOP });
  ok(h.pack && h.pack.fromCache && h.pack.counts.models === 12 && h.stats.fallback === 0 && s.found.grass > 50, '下次打开：jar 从本机缓存读，不用再选', h.pack);
  // C：忘掉 jar → 兜底颜色
  const c = await page.evaluate(async () => { await window.__mcview.clearJar(); return { pack: window.__mcview.pack, stats: window.__mcview.stats }; });
  const s2 = await shot(page);
  ok(c.pack === null && c.stats.fallback === 4 && s2.frac > 0.05, '忘掉 jar：按名字兜底，照样画出来', c.stats);
  await page.close();
}
{
  const page = await open('model=/scene.json');
  ok(await page.evaluate(() => window.__mcview.pack) === null, '忘掉以后缓存里没有了');
  // D：用「选 MC jar」的文件框选 jar（jar 的字节用 base64 文本传进页面）
  await page.evaluate(async (t) => {
    const bin = atob(t), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const input = document.querySelector('input[type=file][accept=".jar,.zip"]');
    const dt = new DataTransfer();
    dt.items.add(new File([u], 'client.jar'));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, jar.toString('base64'));
  await page.waitForFunction(() => window.__mcview.pack && window.__mcview.ready && window.__mcview.stats.fallback === 0, { timeout: 60000 });
  ok(await page.evaluate(() => window.__mcview.saving) === true, '用文件框选 jar：读好并存进缓存');
  // E：选错文件 → 中文提示，原来的 jar 还在
  const bad = await page.evaluate(() => window.__mcview.loadJarUrl('/bad.jar'));
  ok(!bad.ok && /没有方块模型/.test(bad.error) && await page.evaluate(() => !!window.__mcview.pack), '选错文件：提示「没有方块模型」，原来的 jar 不受影响', bad);
  // 平滑光照开关：重建网格，画面跟着变
  const a1 = await shot(page);
  await page.evaluate(() => { const x = document.querySelector('input[type=checkbox]'); x.checked = !x.checked; x.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => window.__mcview.ready && window.__mcview.builds >= 3, { timeout: 60000 });
  const a2 = await shot(page);
  ok(a1.drawn > 0 && diff(a1, a2) > 0.05, '平滑光照开关：画面变了', diff(a1, a2));
  await page.close();
}
// F：示例场景 + MC 相机（对比用的模式：没有工具栏，背景透明，固定尺寸）
{
  const page = await open('compare=1&w=640&h=360&cam=3,1,-4,0,20,77');
  const i = await page.evaluate(() => ({ info: window.__mcview.info(), origin: window.__mcview.origin, bar: !!document.getElementById('mcv-bar') }));
  const want = [3 - i.origin[0], 1 + 1.62 - i.origin[1], -4 - i.origin[2]];
  ok(i.info.width === 640 && i.info.height === 360 && i.info.fov === 77 && !i.bar, '对比模式：640×360、视野 77°、没有工具栏', i);
  ok(i.info.pos.every((v, k) => Math.abs(v - want[k]) < 1e-6) && Math.abs(i.info.rot[0] + 20 * Math.PI / 180) < 1e-6 && Math.abs(i.info.rot[1] - Math.PI) < 1e-6, '相机：脚下 + 1.62 眼高；yaw 0 朝南（+z）', i.info);
  const s = await shot(page);
  ok(s.w === 640 && s.h === 360 && s.frac > 0.02 && s.frac < 0.98, '示例场景画出来了，背景是透明的', brief(s));
  await page.close();
}
// G：MC 白天雾（测试 jar 的雾色是橙色 #ff8000，雾终点 50 格）：开雾的画面整体偏橙
{
  const q = 'jar=/test.jar&cache=0&model=/scene.json&ao=0&compare=1&w=320&h=180&cam=1.5,2,-6,0,15,70';
  const p1 = await open(q + '&fog=1'), fogInfo = await p1.evaluate(() => window.__mcview.fog);
  const s1 = await shot(p1); await p1.close();
  const p0 = await open(q + '&fog=0'), noFog = await p0.evaluate(() => window.__mcview.fog);
  const s0 = await shot(p0); await p0.close();
  const warm = (s) => { let t = 0, n = 0; for (let i = 0; i < s.img.data.length; i += 4) if (s.img.data[i + 3] === 255) { t += s.img.data[i] - s.img.data[i + 2]; n++; } return n ? t / n : 0; };
  ok(fogInfo && fogInfo.end === 50 && noFog === null, '对比模式按 jar 的维度文件加雾，fog=0 关掉', { fogInfo, noFog });
  ok(s1.drawn > 0 && warm(s1) - warm(s0) > 5, '开雾以后画面往雾色（橙）偏', { fog: warm(s1), none: warm(s0) });
}
// H：打开鲸图（PNG / .schem / dump JSON），世界坐标 = Origin + Offset；坏图给 V3.share 的中文提示；拖进页面；没 jar 也能画
{
  const X = loadV3(['12-nbt', '13-share']).V3.share;
  const meta = { compound: { Xiaojingyu: { compound: { Origin: { intArray: Int32Array.of(100, 64, -20) } } } } };
  const wm = { size: scene.size, offset: [-1, 0, -2], palette: scene.palette, cells: scene.cells, blockEntities: [], meta };
  const files = { '/mcview.html': b.out, '/test.jar': jar, '/w/house.png': Buffer.from(await X.writePng(wm)), '/w/house.schem': Buffer.from(await X.writeSchem(wm)),
    '/w/house.dump.json': Buffer.from(JSON.stringify(X.dump(wm))), '/w/plain.png': encodePng(4, 4, new Uint8Array(64).fill(200)) };
  const srv2 = await serveFiles(files);
  const nblocks = scene.cells.filter((v) => v !== 0).length;
  const page = await open('jar=/test.jar&cache=0&model=/w/house.png&ao=0', srv2.url);
  const h = await page.evaluate(() => ({ model: window.__mcview.model, stats: window.__mcview.stats }));
  ok(h.model && h.model.name === 'house.png' && JSON.stringify(h.model.origin) === '[99,64,-22]' && h.stats.blocks === nblocks, '打开鲸图 PNG：世界坐标 = Origin + Offset', h);
  const s = await shot(page, { stone: STONE_TOP, grass: GRASS_TOP });
  ok(s.found.stone > 50 && s.found.grass > 50, '鲸图画出来了（石头、草）', brief(s));
  const r2 = await page.evaluate(async () => [await window.__mcview.openModelUrl('/w/house.schem'), await window.__mcview.openModelUrl('/w/house.dump.json')]);
  ok(r2.every((r) => r.ok && r.stats.blocks === nblocks && JSON.stringify(r.model.origin) === '[99,64,-22]'), '.schem 和 dump JSON 也能打开', r2);
  const bad = await page.evaluate(async () => [await window.__mcview.openModelUrl('/w/plain.png'), window.__mcview.model.name, document.getElementById('mcv-status').textContent]);
  ok(!bad[0].ok && bad[0].code === 'no_data' && /发送原图/.test(bad[0].error) && /发送原图/.test(bad[2]) && bad[1] === 'house.dump.json', '没有数据的图：显示「请让对方发送原图」，原来的模型还在', bad);
  // 拖进页面
  await page.evaluate(async () => {
    const buf = await (await fetch('/w/house.png')).arrayBuffer();
    const dt = new DataTransfer(); dt.items.add(new File([buf], '拖进来的.png', { type: 'image/png' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => window.__mcview.model && window.__mcview.model.name === '拖进来的.png' && window.__mcview.ready, { timeout: 30000 }).catch(() => {});
  ok(await page.evaluate(() => window.__mcview.model && window.__mcview.model.name) === '拖进来的.png', '把鲸图拖进页面就能打开');
  await page.close();
  const p2 = await open('cache=0&model=/w/house.png&ao=0', srv2.url);
  const h2 = await p2.evaluate(() => ({ pack: window.__mcview.pack, stats: window.__mcview.stats }));
  const s2 = await shot(p2); await p2.close();
  ok(h2.pack === null && h2.stats.fallback > 0 && s2.frac > 0.02, '没有 jar：鲸图按兜底颜色画出来', h2.stats);
  srv2.close();
}
// I：箱子和床的真模型（实体层：最近点采样、不用 mipmap）。jar 带上自己画的实体贴图；露天正午，顶面颜色 = 贴图原色
{
  const ejar = makeTestJar({ entities: true });
  const escene = { size: [3, 2, 2], palette: ['minecraft:air', 'minecraft:stone', 'minecraft:chest[facing=south,type=single,waterlogged=false]',
    'minecraft:red_bed[facing=south,occupied=false,part=foot]', 'minecraft:red_bed[facing=south,occupied=false,part=head]'], cells: [1, 1, 1, 1, 1, 1, 2, 0, 3, 0, 0, 4] };
  const srv3 = await serveFiles({ '/mcview.html': b.out, '/e.jar': ejar, '/e.json': escene });
  const page = await open('jar=/e.jar&cache=0&model=/e.json&ao=0', srv3.url);
  const h = await page.evaluate(() => ({ stats: window.__mcview.stats, error: window.__mcview.error || null }));
  ok(!h.error && h.stats.entityModels === 3 && h.stats.quads.entity === 18 + 30, '查看页：箱子和床用实体层画', h.stats);
  const s = await shot(page, { lid: ENTITY_COLORS.chestLid, pillow: ENTITY_COLORS.pillow, sheet: ENTITY_COLORS.bed });
  ok(s.found.lid > 20 && s.found.pillow > 20 && s.found.sheet > 20, '画面上有箱子盖（红）、枕头（白）、床单（深红）', brief(s));
  await page.close();
  srv3.close();
}
await browser.close();
srv.close();
ok(errors.length === 0, '页面没有报错', errors.slice(0, 5));
console.log(`mc-view: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
