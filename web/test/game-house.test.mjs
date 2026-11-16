// game-house.test.mjs — 游戏页的方块房子（P4）：54-house-mc（画房子）、61-nav（按方块走路，一楼 + 阁楼两层）、65-girl-actor（她进屋、上楼、出门捡贝壳）。
// 无头 Edge 打开 dist/cabin.html 和 dist/home.html（先自己构建这两页），查：
//   房子读的是内嵌的鲸图 assets/house/house-v4.png，和生成器 42 现在出的一模一样；门、灯笼、网格都有；三个楼层都能画；
//   走路网格：一楼、阁楼都走得到，门挡死时屋里走不进去；家具挡路；从台阶前到阁楼的路经过门和楼梯；
//   她真的走：沙滩 → 阁楼 → 一楼 → 沙滩（路过门时门会开），冲上来贝壳她会去捡；home 页（不带 42、43）也一样能读房子；页面没有报错。
//   有 MC_JAR=<客户端 jar> 时再用真贴图画一次（没有就 SKIP）。
// 导入 MC 抓回来的房子（docs/HOUSE-V4.md 第 17 节）：用生成器 42 的模型改几格做一张「MC 里改过」的鲸图——餐桌挪一格并转向东、拆掉遮阳伞和
//   门左边那盏壁灯、西墙边加一台电视、贝壳柜挪到阁楼北墙下朝南、风铃往东挪 3 格——拖进页面导入，查灯、屏幕、风铃、遮阳伞、
//   贝壳柜格子、走路网格跟着方块，重开页面还在，「恢复原来的房子」以后和原来一样；读不出来、朝向不对、超出场地、对不上的会拒绝或者先问。
// 布置模式（docs/HOUSE-V4.md 第 18 节，69-arrange）：用页面接口挪一件、转一件、放到墙里被拒、加一件、拆一件、撤销一步、放弃修改；
//   完成以后重开页面还在；导出鲸图 → 再导入逐格一样；整栋房子挪一格、转 90°（藤蔓、出场点、走路跟着动，压到椰子树被拒）；
//   恢复原来的房子以后和默认完全一样；再用真的指针（puppeteer 的 mouse）长按拖一次。
// 相册和相框（docs/PHOTOS.md，68-album、55-photo-frames、45-photos）：真的点相册矮桌打开相册；页面里用画布造几张图加进去（裁正方形、128 × 128、
//   ≤ 48 KB、太花的减色、重复的不加、不是图片的说清楚）；改名、删除、调顺序、满 64 张；真的点画框墙的小框换照片、换回空的；布置模式里加一个相框、
//   「换照片」、撤销、挪相框和相册矮桌（照片跟着走）、拆了再撤销、挪整栋房子；完成后重开还在；导出 → 再导入照片都在；坏照片不画、不崩；
//   没有相册矮桌时说清楚；恢复原来的房子。
// 用法：cd web && node test/game-house.test.mjs   （MC_GPU=swiftshader 强制软件渲染；走路那几步按真时间走，整套约 3–4 分钟）
//   只跑导入那一节：GAME_HOUSE_ONLY=import node test/game-house.test.mjs；只跑布置模式那一节：GAME_HOUSE_ONLY=arrange；只跑相册和相框：GAME_HOUSE_ONLY=photos
import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIR, launchBrowser, serveFiles } from '../tools/mc-lib.mjs';
import { build } from '../build.mjs';
import { loadV3 } from '../tools/lib/v3-node.mjs';

let pass = 0, fail = 0;
const ok = (c, what, got) => {
  if (c) { pass++; console.log('PASS ' + what); }
  else { fail++; console.log('FAIL ' + what + (got !== undefined ? ' → ' + JSON.stringify(got).slice(0, 500) : '')); }
};
const ONLY = process.env.GAME_HOUSE_ONLY || '';

// ---- 改过的鲸图（Node 里用生成器的模型改）----
const NV3 = loadV3(['12-nbt', '13-share', '17-mcfallback', '42-house-mc'], { core: false }).V3;
function edited(fn) {
  const m = NV3.houseMc.build().model, [W, , L] = m.size, st = [-2 + m.offset[0], m.offset[1], -2 + m.offset[2]];
  const palette = m.palette.slice(), cells = Int32Array.from(m.cells);
  const set = (x, y, z, s) => { let k = palette.indexOf(s); if (k < 0) { k = palette.length; palette.push(s); } cells[(x - st[0]) + (z - st[2]) * W + (y - st[1]) * W * L] = k; };
  const out = Object.assign({}, m, { palette, cells, offset: m.offset.slice(), meta: JSON.parse(JSON.stringify(m.meta)) });
  fn(set, out);
  return out;
}
const AIR = 'minecraft:air', XJ = (id, facing, part) => 'xiaojingyu:' + id + '[facing=' + facing + (part != null ? ',part=' + part : '') + ']';
const MOD = edited((set, m) => {
  set(0, 1, -12, AIR); set(0, 1, -11, XJ('dining_table', 'east'));                       // 餐桌往南挪一格，转向东
  for (let y = 0; y < 3; y++) set(-10, y, 5, AIR);                                        // 拆掉遮阳伞（3 格）
  set(-3, 2, -6, AIR);                                                                    // 拆掉门左边那盏壁灯
  set(-6, 1, -13, XJ('tv_stand', 'east', 0)); set(-6, 1, -12, XJ('tv_stand', 'east', 1)); // 西墙边加一台电视（朝东，2 格）
  set(-6, 5, -10, AIR); set(-6, 5, -11, AIR);                                             // 贝壳柜挪到阁楼北墙下，朝南（left 在西）
  set(-6, 5, -15, XJ('shell_case', 'south', 'left')); set(-5, 5, -15, XJ('shell_case', 'south', 'right'));
  set(-2, 3, -6, AIR); set(1, 3, -6, XJ('wind_chime', 'south'));                          // 风铃往东挪 3 格
  const c = m.meta.compound;
  c.Name = { string: '小鲸鱼之家 v4（MC 里改过）' }; c.Author = { string: 'Moci' }; c.Date = { long: String(Date.UTC(2026, 10, 7, 3, 30)) };
  c.Xiaojingyu.compound.Origin = { intArray: [1203, 64, -517] };                          // 抓的时候在 MC 世界里的坐标：网页不按它放
});
const meta = (fn) => edited((set, m) => fn(m.meta.compound, m));
const PNGS = {
  mod: await NV3.share.writePng(MOD),
  east: await NV3.share.writePng(meta((c) => { c.Xiaojingyu.compound.Facing = { string: 'east' }; })),
  far: await NV3.share.writePng(meta((c, m) => { m.offset[0] += 30; })),
  shift: await NV3.share.writePng(meta((c, m) => { m.offset[0] += 3; })),
  nodata: NV3.share.png.solid(16, 16),
};

for (const p of ['cabin', 'home']) build(p);
const routes = { '/cabin.html': path.join(WEB_DIR, 'dist', 'cabin.html'), '/home.html': path.join(WEB_DIR, 'dist', 'home.html') };
for (const k in PNGS) routes['/' + k + '.png'] = Buffer.from(PNGS[k]);
routes['/junk.png'] = Buffer.from('这不是图片，只是几个字');
const JAR = process.env.MC_JAR && fs.existsSync(process.env.MC_JAR) ? process.env.MC_JAR : null;
if (JAR) routes['/client.jar'] = JAR;
const srv = await serveFiles(routes);
const browser = await launchBrowser({ width: 1280, height: 800 });

async function open(name, query = '') {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(srv.url + '/' + name + '.html' + query, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__READY === true, { timeout: 120000 });
  await page.evaluate(async () => { await V3.houseBlocks.ready; await V3.waitReady(V3.models.current()); await V3.houseBlocks.live().ready; });
  return { page, errs };
}
const pageErrors = (page) => page.evaluate(() => (window.__errors || []).slice());

try {
  if (!ONLY) await mainTests();
  if (!ONLY || ONLY === 'import') await importTests();
  if (!ONLY || ONLY === 'arrange') await arrangeTests();
  if (!ONLY || ONLY === 'arrange' || ONLY === 'house') await arrangeHouseTests();
  if (!ONLY || ONLY === 'photos') await photoTests();
} catch (e) {
  fail++; console.log('FAIL 测试出错：' + ((e && e.stack) || e));
} finally {
  await browser.close();
  await srv.close();
}
console.log(fail ? `\n${fail} FAIL, ${pass} PASS` : `\nALL PASS (${pass})`);
process.exit(fail ? 1 : 0);

async function mainTests() {
  // ---------------- cabin：房子、网格、走路 ----------------
  const { page, errs } = await open('cabin', '?time=noon&wind=0');
  const H = await page.evaluate(() => {
    const HB = V3.houseBlocks, L = V3.layout.house, G = HB.grid, st = HB.stats();
    const same = V3.houseMc ? V3.share.equalDump(V3.share.dump(HB.model), V3.share.dump(V3.houseMc.build().model)) : null;
    const id = (x, y, z) => { const s = G.at(x, y, z); return s ? s.id : null; };
    return { st, same, blocks: L.blocks, corner: id(L.x0, 1, L.z0), door: [id(-2, 1, -7), id(-2, 2, -7)], floor: id(0, 0, -10), loft: id(-3, 4, -10),
      porch: id(-6, 0, -5), step: id(-2, 0, -3), cap: id(0, 11, -12), lanternsIn: [id(0, 3, -12)] };
  });
  ok(H.st && H.st.from === 'assets/house/house-v4.png' && !H.st.error, '房子读的是内嵌的鲸图 assets/house/house-v4.png', H.st);
  ok(H.same === true, '内嵌的鲸图和生成器（42-house-mc）现在出的一模一样', H.same);
  ok(H.st.info.blocks > 700 && H.st.door && H.st.lanterns === 6 && H.st.mesh.quads.solid > 1000, '方块、门、6 盏灯笼、网格都有', H.st);
  ok(H.st.mesh.fallback > 0 && !H.st.jar, '没选 jar：原版方块用我们自己的颜色（fallback）', H.st.mesh);
  ok(/_log$/.test(H.corner) && H.door.every((d) => /_door$/.test(d || '')) && H.floor === 'oak_planks' && H.loft === 'oak_planks', '布局和方块对得上：墙角木柱、门两格、一楼和阁楼地板', H);
  // P5 家具：3 件模组家具在房子的鲸图里，模型打进了页面（没有缺的），部件、贝壳柜的格子和点开收藏
  const FU = await page.evaluate(() => {
    const G = V3.houseBlocks.grid, st = (x, y, z) => { const s = G.at(x, y, z); return s ? s.ns + ':' + s.id + JSON.stringify(s.props || {}) : null; };
    const hs = V3.houseBlocks.stats(); let click = 0;
    V3.models.current().root.traverse((o) => { if (o.userData.clickable === 'shellBox') click++; });
    return { bed: [st(-6, 1, -15), st(-6, 1, -14)], table: st(0, 1, -12), case: [st(-6, 5, -10), st(-6, 5, -11)], modFiles: hs.modFiles,
      missingMod: hs.mesh.missingMod, parts: V3.parts.list('小屋/家具'), shelf: V3.shellDisplay && V3.shellDisplay(), click };
  });
  ok(FU.bed[0] === 'xiaojingyu:bed{"facing":"north","part":"head"}' && FU.bed[1] === 'xiaojingyu:bed{"facing":"north","part":"foot"}'
    && FU.table === 'xiaojingyu:dining_table{"facing":"south"}' && FU.case[0] === 'xiaojingyu:shell_case{"facing":"east","part":"left"}'
    && FU.case[1] === 'xiaojingyu:shell_case{"facing":"east","part":"right"}', '3 件模组家具在房子的鲸图里（床、餐桌、贝壳柜，状态照 FURNITURE.md）', FU);
  ok(FU.modFiles > 0 && FU.missingMod.length === 0, '模组家具的模型和贴图打进了页面，画的时候一个都不缺', { modFiles: FU.modFiles, missingMod: FU.missingMod });
  ok(['床', '餐桌', '贝壳'].every((n) => FU.parts.some((q) => q.startsWith('小屋/家具/') && q.includes(n))), '反馈工具里有「小屋/家具」下的 3 件', FU.parts);
  ok(FU.shelf && FU.shelf.block && FU.shelf.slots === 12 && Math.hypot(FU.shelf.pos[0] + 5.5, FU.shelf.pos[1] - 5, FU.shelf.pos[2] + 9.5) < 1e-6
    && Math.abs(FU.shelf.rotY - Math.PI / 2) < 1e-3 && FU.click >= 2, '贝壳柜的 12 个格子摆在方块柜子上（朝东），柜子点了能打开收藏', FU.shelf);
  // P5 第 2 轮（FURNITURE.md 8.2）：22 种家具都在房子里；相册矮桌能点；会动 / 会亮的骨骼叠上了；贴地的能走、茶几那格挡路
  const R2 = await page.evaluate(() => {
    const G = V3.houseBlocks.grid, ids = new Set(), N = V3.nav, root = V3.models.current().root;
    for (let i = 0; i < G.cells.length; i++) { const s = G.st[G.cells[i]]; if (s && s.ns === 'xiaojingyu') ids.add(s.id); }
    let album = 0; const over = new Set();
    root.traverse((o) => { if (o.userData.clickable === 'album') album++; if (o.userData.overlay && o.userData.furn) over.add(o.userData.furn); });
    const want = (V3.furnMc && V3.furnMc.list || []).filter((f) => f.round !== 3 && Array.isArray(f.overlay) && f.overlay.length).map((f) => (f.layout && f.layout.id) || f.id);   // 规格的 layout 是 {layer, id}
    return { ids: [...ids].sort(), album, over: [...over].sort(), want: [].concat(...want).sort(),
      mat: N.walkable(-1.5, -7.5, 1), rug: N.walkable(4.5, -9.5, 1), coffee: N.walkable(3.5, -8.5, 1), sofa: N.walkable(2.5, -9.5, 1) };
  });
  ok(R2.ids.length === 40, '房子里有 40 种模组家具（第 1 轮 3 种 + 第 2 轮 22 种 + 第 3 轮屋外 15 种）', R2.ids);
  ok(R2.album >= 1, '相册矮桌点了能打开相册', R2.album);
  ok(R2.over.length >= 2 && R2.want.length >= 2 && R2.want.every((w) => R2.over.includes(w)), '会动 / 会亮的骨骼叠在方块家具上（规格里 overlay 的每一件）', R2);
  ok(R2.mat && R2.rug && !R2.coffee && !R2.sofa, '门口地垫、地毯能走，茶几、沙发挡路', R2);
  // P5 第 3 轮（FURNITURE.md 9）：屋外 15 种。游戏场景里没 overlay 的不画体素版；木箱、壁灯只叠灯罩；风铃、遮阳伞整件画体素版，方块不画
  const R3 = await page.evaluate(() => {
    const root = V3.models.current().root, G = V3.houseBlocks.grid, N = V3.nav, got = {};
    root.traverse((o) => { if (/^(house2|furn):/.test(o.name) && !got[o.name]) got[o.name] = o; });
    const meshes = (o) => { const n = []; if (o) o.traverse((m) => { if (m.isMesh) n.push(m.name); }); return n; };
    const st = (x, y, z) => { const s = G.at(x, y, z); return s ? s.ns + ':' + s.id : null; };
    const p = got['furn:parasol'], pp = p ? p.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Math.round(v * 1000) / 1000) : null;
    const hs = V3.houseBlocks.stats();
    return {
      gone: ['house2:boxW', 'house2:boxE', 'house2:towel', 'house2:stepMat', 'furn:loungerA', 'furn:loungerB', 'furn:beachTable'].filter((n) => got[n]),
      lamps: ['house2:chest', 'house2:lantern0', 'house2:lantern1'].map((n) => [n, meshes(got[n])]),
      chime: meshes(got['house2:chime']).length, parasol: pp, parasolMeshes: meshes(p).length,
      cells: { chime: st(-2, 3, -6), parasol: [st(-10, 0, 5), st(-10, 2, 5)], lounger: st(-11, 0, 4), mat: st(-2, 0, -2), crate: st(8, 0, -4) },
      skipped: hs.mesh && hs.mesh.missingMod, walk: { mat: N.walkable(-1.5, -1.6), lounger: N.walkable(-10.5, 4.5), crate: N.walkable(8.5, -3.5) },
    };
  });
  ok(R3.gone.length === 0, '方块版的花箱、毛巾、台阶下地垫、躺椅、小圆桌不再画体素版', R3.gone);
  ok(R3.lamps.every(([, m]) => m.length && m.every((n) => n === 'vox:lamp')), '木箱和两盏壁灯只叠发光的灯罩（vox:lamp）', R3.lamps);
  ok(R3.chime > 3 && R3.parasolMeshes > 0 && R3.parasol && Math.hypot(R3.parasol[0] + 9.515625, R3.parasol[2] - 5.484375) < 1e-3 && Math.abs(R3.parasol[1]) < 1e-3,
    '风铃整件照画（3 串贝壳会摆），遮阳伞挪到方块那格 (−10, 0, 5)', R3);
  ok(R3.cells.chime === 'xiaojingyu:wind_chime' && R3.cells.parasol.every((s) => s === 'xiaojingyu:beach_parasol') && R3.cells.lounger === 'xiaojingyu:beach_lounger'
    && R3.cells.mat === 'xiaojingyu:step_mat' && R3.cells.crate === 'xiaojingyu:crate_lantern', '屋外的方块在鲸图里（风铃、遮阳伞 3 格、躺椅、地垫、木箱）', R3.cells);
  ok(R3.walk.mat && !R3.walk.lounger && !R3.walk.crate, '台阶下地垫能踩，躺椅、木箱挡路', R3.walk);
  // 此页 wind=0：只测角色进入，阵风触发另由 chime-sound.test.mjs 覆盖。
  // 风铃会响（FURNITURE.md 9.3，66-chime-sound）：她刚走进风铃下面 3 格内响一串（2–3 下），站着不动不再响，体素风铃被碰一下
  const CH = await page.evaluate(async () => {
    const fr = (n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const C = V3.chimes, root = V3.models.current().root; let chime = null;
    root.traverse((o) => { if (o.name === 'house2:chime' && !chime) chime = o; });
    const clinks = () => (chime ? chime.userData.clinks : -1);
    await V3.view('girl=at_4_2_0'); await fr(6);
    const a = C.stats(), k0 = clinks();
    await V3.view('girl=at_-1.5_-5.5_0_1'); await fr(6);
    const b = C.stats(), k1 = clinks();
    await fr(40);
    const c = C.stats();
    return { list: C.list(), a: [a.rings, a.hits], b: [b.rings, b.hits], c: [c.rings, c.hits], k: [k0, k1], last: b.last, on: c.on, wind: { speed: V3.env.state.wind.speed, gust: V3.env.state.wind.gust },
      under: C.test(-1.5, 1, -5.5).length, beside: C.test(-0.5, 1, -5.5).length, high: C.test(-1.5, 3, -5.5).length, setting: (V3.game.SCHEMA || []).some((f) => f.key === 'chimeSound') };
  });
  ok(CH.list.length === 1 && CH.list[0].join() === '-2,3,-6' && CH.under === 1 && CH.beside === 0 && CH.high === 0, '风铃在 (−2, 3, −6)，管它正下方 3 格（旁边一格、头顶以上不算）', CH);
  ok(CH.wind.speed === 0 && CH.wind.gust === 0 && CH.b[0] === CH.a[0] + 1 && CH.b[1] - CH.a[1] >= 2 && CH.b[1] - CH.a[1] <= 3 && CH.c[0] === CH.b[0] && CH.last && CH.last.join() === '-2,3,-6' && CH.k[1] > CH.k[0],
    '她走到风铃下面响一串（2–3 下）、体素风铃摆一下，站着不动不再响', CH);
  ok(CH.on && CH.setting, '设置「房子」页有「风铃声」开关，默认开', CH);
  const SND = await page.evaluate(() => V3.chimes.offline());
  ok(SND && SND.peak > 0.05 && SND.peak < 0.9 && SND.seconds > 0.8 && SND.seconds < 3, '风铃声（离线渲染一串）：听得见、不爆音，响 1–3 秒', SND);
  ok(H.porch === 'oak_planks' && /_stairs$/.test(H.step || '') && /_slab$/.test(H.cap || '') && /lantern$/.test(H.lanternsIn[0] || ''), '门廊、台阶、屋脊盖板、一楼吊灯', H);

  const N = await page.evaluate(() => {
    const NV = V3.nav, L = V3.layout, s0 = NV.stats();
    const pLoft = NV.path(NV.home, [-2.0, -10.6, L.house.loftY]), pIn = NV.path(NV.home, [0, -9, L.house.floorY]);
    NV.setDoor(false);
    const shut = { inside: NV.randomPoint('inside'), loft: NV.randomPoint('loft'), door: NV.walkable(-1.5, -6.5, 1) };
    NV.setDoor(true);
    const furn = L.ground.filter((o) => o.h >= 0.1 && o.wallY == null).map((o) => [o.id, NV.walkable((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2, L.house.floorY)]);
    const loftFurn = L.loft.filter((o) => o.h >= 0.1 && !o.ceiling).map((o) => [o.id, NV.walkable((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2, L.house.loftY)]);
    return { s0, pLoft, pIn, shut, furn, loftFurn,
      door: NV.walkable(-1.5, -6.5, 1), wall: NV.walkable(-4.5, -6.5, 1), stairMid: NV.heightAt(5.5, -12.25, 3), landing: NV.heightAt(5.5, -9.5, 5),
      under: NV.heightAt(5.5, -9.5, 1), porch: NV.heightAt(-5, -4.5), step: [NV.heightAt(-1.5, -2.75), NV.heightAt(-1.5, -2.25)] };
  });
  ok(N.s0.blocks && N.s0.zones.inside > 500 && N.s0.zones.loft > 500, '走路网格按方块建：一楼、阁楼都有一大片走得到', N.s0);
  ok(N.door && !N.wall, '门那一格能过，墙不能', [N.door, N.wall]);
  ok(N.shut.inside == null && N.shut.loft == null && !N.shut.door, '门挡死时屋里、阁楼都走不进去', N.shut);
  ok(N.furn.every(([, w]) => !w) && N.loftFurn.every(([, w]) => !w), '家具挡路（一楼、阁楼）', { g: N.furn.filter((f) => f[1]), l: N.loftFurn.filter((f) => f[1]) });
  ok(Math.abs(N.landing - 5) < 0.01 && Math.abs(N.under - 1) < 0.01, '楼梯口那一格：阁楼 5 米、下面一楼 1 米（按高度选层）', [N.landing, N.under]);
  ok(Math.abs(N.stairMid - 3) < 0.01 && Math.abs(N.porch - 1) < 0.01 && Math.abs(N.step[0] - 1) < 0.01 && Math.abs(N.step[1] - 0.5) < 0.01, '楼梯、门廊、台阶的高度（MC 半格一级）', N);
  const lp = N.pLoft || [], viaDoor = lp.some((p, i) => i && Math.abs(p[0] + 1.5) < 0.8 && p[1] < -6.6 && p[1] > -9 && Math.abs(p[2] - 1) < 0.05);
  ok(lp.length >= 3 && Math.abs(lp[lp.length - 1][2] - 5) < 0.01 && viaDoor && lp.some((p) => p[2] > 1.2 && p[2] < 4.9), '从台阶前到阁楼：进门、上楼梯、到 5 米', lp);
  ok(N.pIn && Math.abs(N.pIn[N.pIn.length - 1][2] - 1) < 0.01, '从台阶前到一楼中间', N.pIn);

  // 楼层：一楼 / 阁楼剖开画，再回外观
  const F = await page.evaluate(async () => {
    const out = [];
    for (const f of ['ground', 'loft', 'all']) { await V3.view('floor=' + f); out.push([f, V3.houseBlocks.stats().shown]); }
    return out;
  });
  ok(F[0][1].startsWith('ground|') && F[1][1].startsWith('loft|') && F[2][1] === 'all|', '三个楼层都能画（剖开时压低朝镜头的墙）', F);

  // 她走：沙滩 → 阁楼 → 一楼 → 沙滩；路过门时门开
  const W = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), A = () => V3.actor;
    await V3.view('girl=at_-1.5_-0.75_0'); await sleep(300);
    const walk = async (tok, until, ms) => {
      await V3.view('girl=' + tok);
      const t0 = performance.now(); let door = false, maxY = -9;
      while (performance.now() - t0 < ms) {
        await sleep(250);
        const p = A().pos; maxY = Math.max(maxY, p[1]);
        if (V3.houseBlocks.stats().doorOpen) door = true;
        if (until(p)) return { tok, ok: true, s: Math.round((performance.now() - t0) / 100) / 10, door, maxY, pos: p };
      }
      return { tok, ok: false, door, maxY, pos: A().pos, dbg: A()._dbg };
    };
    const near = (x, z, r) => (p) => Math.hypot(p[0] - x, p[2] - z) < r;
    const a = await walk('-2_-10.4_5', (p) => p[1] > 4.8 && near(-2, -10.4, 0.7)(p), 70000);
    const b = await walk('0.5_-9_1', (p) => p[1] < 1.2 && near(0.5, -9, 0.7)(p), 70000);
    const c = await walk('-1.5_-0.75', near(-1.5, -0.75, 0.7), 70000);
    await sleep(2500);
    return { a, b, c, doorAfter: V3.houseBlocks.stats().doorOpen };
  });
  ok(W.a.ok && W.a.door && W.a.maxY > 4.8, '她从沙滩进门、上楼梯走到阁楼（门开了）', W.a);
  ok(W.b.ok, '她从阁楼下楼走到一楼', W.b);
  ok(W.c.ok && W.c.door && W.doorAfter === false, '她出门回到沙滩，走远以后门关上', { c: W.c, doorAfter: W.doorAfter });

  // 捡贝壳：冲上来两颗，她去捡
  const C = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), ev = [];
    V3.on('game:collect', (e) => ev.push(e.by));
    V3.game.washNow(2); await sleep(400);
    await V3.view('girl=collect');
    const t0 = performance.now();
    while (performance.now() - t0 < 70000) { await sleep(300); if (ev.includes('girl')) return { ok: true, s: Math.round((performance.now() - t0) / 100) / 10 }; }
    return { ok: false, ev, dbg: V3.actor._dbg };
  });
  ok(C.ok, '冲上来贝壳，她去捡到了', C);

  // 门口一个、屋里一个、阁楼一个：瞬移过去，高度对
  const T = await page.evaluate(async () => {
    const r = [];
    for (const [tok, y] of [['at_-1.5_-6.5_0', 1], ['at_0.5_-9.5_0', 1], ['at_-1.5_-10.2_0_5', 5]]) { await V3.view('girl=' + tok); r.push([tok, V3.actor.pos[1], y]); }
    return r;
  });
  ok(T.every(([, y, w]) => Math.abs(y - w) < 0.01), '瞬移到门口、一楼、阁楼：脚在对的高度上', T);

  if (JAR) {
    const J = await page.evaluate(async () => {
      const b = new Uint8Array(await (await fetch('/client.jar')).arrayBuffer());
      const pack = await V3.houseBlocks.useJar(b); await V3.houseBlocks.live().ready;
      return { version: pack.version && pack.version.id, st: V3.houseBlocks.stats() };
    });
    ok(J.st.pack && J.st.mesh.fallback === 0 && !J.st.error, '选了 jar：房子全用 MC 贴图画（' + J.version + '）', J.st);
    await page.evaluate(() => V3.houseBlocks.forgetJar());
  } else console.log('SKIP 真贴图：没有 MC_JAR');
  const e1 = await pageErrors(page);
  ok(!e1.length && !errs.length, 'cabin：页面没有报错', { e1, errs });
  await page.close();

  // ---------------- home：只能玩的游戏页（不带 42、43）----------------
  const h = await open('home');
  const HM = await h.page.evaluate(() => ({ gen: !!V3.houseMc, st: V3.houseBlocks.stats(), nav: V3.nav.stats().zones }));
  ok(!HM.gen && HM.st.from === 'assets/house/house-v4.png' && HM.st.info.blocks > 700 && HM.nav.loft > 500, 'home：没有生成器也从内嵌鲸图读出房子，阁楼走得到', HM);
  const e2 = await pageErrors(h.page);
  ok(!e2.length && !h.errs.length, 'home：页面没有报错', { e2, errs: h.errs });
  await h.page.close();
}

// ---------------- 导入 MC 抓回来的房子（docs/HOUSE-V4.md 第 17 节）----------------
// 场景里跟着方块走的东西（在页面里跑）：overlay（屏幕、灯泡、米饭…）、点光、壁灯 / 木箱灯罩、风铃、遮阳伞、贝壳柜格子，再加走路网格的数
function SNAP() {
  const root = V3.models.current().root, r3 = (a) => a.map((v) => Math.round(v * 1000) / 1000), wp = (o) => r3(o.getWorldPosition(new THREE.Vector3()).toArray());
  const over = [], lamps = [], named = [];
  root.traverse((o) => {
    if (o.userData.overlay && o.userData.furn) over.push([o.name, wp(o), Math.round(o.rotation.y * 1000) / 1000]);
    if (o.isPointLight) lamps.push(wp(o));
    if (/^(house2:(chest|lantern|chime)|furn:parasol)/.test(o.name)) named.push([o.name, wp(o)]);
  });
  const N = V3.nav.stats();
  return { over: over.sort(), lamps: lamps.sort(), named: named.sort(), shelf: V3.shellDisplay(), chimes: V3.chimes.list(), zones: N.zones, walk: N.walk,
    from: V3.houseBlocks.stats().from, blocks: V3.houseBlocks.info.blocks };
}
// Exact fixture light sources: 4 porch lanterns + 2 indoor block lanterns (6 switchable),
// 1 averaged doorway wall-light + 1 crate lantern + desk lamp + loft fixture = 10.
function expectedLampPositions(doorX = -1.5) {
  return [
    [-7.5, 2.3, -3.5], [-3.5, 2.3, -3.5], [0.5, 2.3, -3.5], [7.5, 2.3, -3.5],
    [-1.5, 9.3, -10.5], [doorX, 2.5, -5.7], [8.5, 0.719, -3.687],
    [-5.744, 1.844, -10.5], [0.5, 3.3, -11.5], [0, 9.625, -11.062],
  ].sort();
}
function exactLampSources(s, doorX = -1.5) {
  return JSON.stringify(s.lamps) === JSON.stringify(expectedLampPositions(doorX));
}
async function lampBudget(page) {
  return page.evaluate(async () => {
    await V3.view('time=night');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const lamps = []; V3.models.current().root.traverse(o => { if (o.isPointLight) lamps.push(o); });
    const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const result = { total: lamps.length, switchable: lamps.filter(o => o.userData.switchable).length,
      visible: lamps.filter(visible).length, lit: lamps.filter(o => visible(o) && o.intensity > 0).length, limit: V3.scene.MAX_LAMPS };
    await V3.view('time=noon');
    return result;
  });
}
async function importTests() {
  const { page, errs } = await open('cabin', '?time=noon');
  const before = await page.evaluate(SNAP);
  ok(before.from === 'assets/house/house-v4.png' && before.over.length === 4 && exactLampSources(before) && before.shelf && before.shelf.all.length === 1,
    '导入前：用的是原来的房子，4 件 overlay、10 盏来源/坐标明确的点光、1 个贝壳柜', before);

  const initialBudget = await lampBudget(page);
  ok(initialBudget.total === 10 && initialBudget.switchable === 6 && initialBudget.limit === 8
    && initialBudget.visible > 0 && initialBudget.visible <= 8 && initialBudget.lit === initialBudget.visible,
    '夜间保留10盏光源（6盏可切换方块灯），实际可见/发亮点光不超过8盏', initialBudget);

  // 读不出来 / 不是这栋房子：不换，说清楚为什么
  const BAD = await page.evaluate(async () => {
    const get = async (n) => new Uint8Array(await (await fetch('/' + n + '.png')).arrayBuffer()), out = {};
    for (const n of ['junk', 'nodata', 'east', 'far', 'shift']) { const r = await V3.houseBlocks.importFile(await get(n), { file: n + '.png' }); out[n] = { ok: r.ok, error: r.error || null, ask: r.ask || null }; }
    out.from = V3.houseBlocks.from;
    return out;
  });
  ok(!BAD.junk.ok && /不是鲸图/.test(BAD.junk.error) && !BAD.nodata.ok && /聊天软件/.test(BAD.nodata.error), '读不出来的说清楚：不是鲸图、被聊天软件去掉了方块数据', BAD);
  ok(!BAD.east.ok && /面朝东/.test(BAD.east.error || '') && !BAD.far.ok && /超出场地/.test(BAD.far.error || ''), '朝向不对、放进来超出场地的直接拒绝', BAD);
  ok(!BAD.shift.ok && !BAD.shift.error && BAD.shift.ask && BAD.shift.ask.some((t) => /站立点不一样/.test(t)) && BAD.shift.ask.some((t) => /对得上/.test(t)) && BAD.from === 'assets/house/house-v4.png',
    'Offset 不一样、和原来的房子对不上的先问一句，没点「还是用它」就不换', BAD.shift);

  // 拖进页面导入（走 29-ysmui 的拖放 → 54-house-mc）
  const t0 = Date.now();
  await page.evaluate(async () => {
    const b = await (await fetch('/mod.png')).arrayBuffer(), dt = new DataTransfer();
    dt.items.add(new File([b], 'house-v4-改过.png', { type: 'image/png' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => V3.houseBlocks.from === 'import' && !V3.houseBlocks.ui().busy, { timeout: 120000 });
  await page.evaluate(async () => { await V3.waitReady(V3.models.current(), 30000); await V3.houseBlocks.live().ready; });
  const swapMs = Date.now() - t0;
  const A = await page.evaluate(SNAP), AX = await page.evaluate(() => {
    const HB = V3.houseBlocks, G = HB.grid, st = (x, y, z) => { const s = G.at(x, y, z); return s ? s.ns + ':' + s.id + JSON.stringify(s.props || {}) : null; };
    const root = V3.models.current().root, tvs = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o.name !== 'furn:tv') return;
      const scr = o.getObjectByName('screen'), n = new THREE.Vector3(0, 0, 1).transformDirection(scr.matrixWorld), p = scr.getWorldPosition(new THREE.Vector3());
      tvs.push({ cell: o.userData.cell, n: n.toArray().map((v) => Math.round(v * 100) / 100 + 0), p: p.toArray().map((v) => Math.round(v * 1000) / 1000) });
    });
    let door = null; root.traverse((o) => { if (o.isPointLight && Math.abs(o.position.y - 2.5) < 0.01) door = o.position.toArray(); });
    V3.settingsPanel.open('房子');
    const row = document.querySelector('.set-house-cur');
    const N = V3.nav;
    return { st: HB.stats(), custom: HB.custom, ui: HB.ui(), row: row && row.textContent, origin: G.org, table: [st(0, 1, -12), st(0, 1, -11)], tv: [st(-6, 1, -13), st(-6, 1, -12)], tvs, door,
      chimes: V3.houseDetail.chimes(),
      walk: { oldTable: N.blockedBy(0.5, -11.5, 1), newTable: N.blockedBy(0.5, -10.5, 1), tv: N.blockedBy(-5.5, -12.5, 1), parasol: N.walkable(-9.5, 5.5), oldCase: N.blockedBy(-5.5, -9.5, 5), newCase: N.blockedBy(-5.5, -14.5, 5) },
      loft: N.path(N.home, [-2.0, -10.6, V3.layout.house.loftY]) };
  });
  ok(AX.st.from === 'import' && AX.custom && AX.custom.name === '小鲸鱼之家 v4（MC 里改过）' && AX.custom.author === 'Moci' && AX.custom.file === 'house-v4-改过.png' && !AX.st.error
    && AX.st.mesh.missingMod.length === 0, '拖进页面导入改过的鲸图：换成了它（名字、作者、文件名），' + Math.round(swapMs / 100) / 10 + ' 秒', { st: AX.st, custom: AX.custom });
  ok(AX.origin.join() === '-11,0,-17' && AX.table[0] === null && AX.table[1] === 'xiaojingyu:dining_table{"facing":"east"}' && /tv_stand/.test(AX.tv[0] || '') && /tv_stand/.test(AX.tv[1] || ''),
    '方块按站立点 + Offset 放（不看 Metadata 的 Origin）：餐桌挪了、电视在', AX);
  ok(/导入的房子/.test(AX.row || '') && /MC 里改过/.test(AX.row) && /作者 Moci/.test(AX.row) && /house-v4-改过\.png/.test(AX.row) && /2026-11-07/.test(AX.row) && AX.ui.kind === 'ok',
    '设置「房子」页写着现在用的是哪张（名字、作者、日期、文件）', { row: AX.row, ui: AX.ui });
  const tv = AX.tvs.find((t) => t.cell && t.cell.join() === '-6,1,-13'), tv0 = AX.tvs.find((t) => t.cell && t.cell.join() === '5,1,-9');
  ok(AX.tvs.length === 2 && tv && tv0 && tv.n.join() === '1,0,0' && tv0.n.join() === '-1,0,0' && tv.p[0] > -6 && tv.p[0] < -5 && tv.p[2] > -13 && tv.p[2] < -11 && tv.p[1] > 1.5 && tv.p[1] < 2,
    '加的电视也叠了屏幕：在新电视那两格上、朝东（原来那台照旧朝西）', AX.tvs);
  const names = A.named.map((n) => n[0]);
  ok(!names.includes('house2:lantern0') && names.includes('house2:lantern1') && !names.includes('furn:parasol') && exactLampSources(A, -0.5) && AX.door && Math.abs(AX.door[0] + 0.5) < 1e-6 && Math.abs(AX.door[2] + 5.7) < 1e-6,
    '拆掉的壁灯、遮阳伞不画了；门边的点光挪到剩下那盏壁灯前', { named: A.named, lamps: A.lamps, door: AX.door });
  const importedBudget = await lampBudget(page);
  ok(importedBudget.total === 10 && importedBudget.switchable === 6 && importedBudget.limit === 8
    && importedBudget.visible > 0 && importedBudget.visible <= 8 && importedBudget.lit === importedBudget.visible,
    '导入后灯具来源与8盏渲染预算仍保持', importedBudget);
  const ch = A.named.find((n) => n[0] === 'house2:chime');
  ok(A.chimes.length === 1 && A.chimes[0].join() === '1,3,-6' && ch && Math.abs(ch[1][0] - 1.5) < 1e-6 && Math.abs(ch[1][1] - 3.7) < 1e-6 && AX.chimes.length === 1 && AX.chimes[0].cell.join() === '1,3,-6',
    '风铃跟着方块挪到 (1, 3, −6)（会响的范围也跟着）', { chimes: A.chimes, ch, d: AX.chimes });
  ok(A.shelf && A.shelf.all.length === 1 && A.shelf.slots === 12 && A.shelf.pos.join() === '-5.5,5,-14.5' && Math.abs(A.shelf.rotY) < 1e-6,
    '贝壳柜的 12 个格子跟着柜子挪到阁楼北墙下、朝南', A.shelf);
  ok(AX.walk.oldTable !== 'furniture' && AX.walk.newTable === 'furniture' && AX.walk.tv === 'furniture' && AX.walk.parasol && AX.walk.oldCase !== 'furniture' && AX.walk.newCase === 'furniture'
    && AX.loft && Math.abs(AX.loft[AX.loft.length - 1][2] - 5) < 0.01, '走路网格跟着方块：餐桌、电视、贝壳柜新的位置挡路，旧的位置和拆掉的遮阳伞能走，照样上得了阁楼', AX.walk);

  // 重新打开页面：导入的房子还在（存在浏览器里）
  const p2 = await open('cabin', '?time=noon');
  const B = await p2.page.evaluate(SNAP), Bc = await p2.page.evaluate(() => V3.houseBlocks.custom);
  ok(B.from === 'import' && Bc && Bc.name === '小鲸鱼之家 v4（MC 里改过）' && JSON.stringify(B.over) === JSON.stringify(A.over) && B.shelf.pos.join() === '-5.5,5,-14.5' && B.chimes.join() === '1,3,-6',
    '重新打开页面：还是导入的那栋（存在浏览器里），屏幕、柜子、风铃一样', { from: B.from, over: B.over, shelf: B.shelf });
  const e2 = await pageErrors(p2.page);
  ok(!e2.length && !p2.errs.length, '重新打开的页面没有报错', { e2, errs: p2.errs });
  await p2.page.close();

  // 恢复原来的房子（设置里点「恢复原来的房子」→「确定」）
  await page.evaluate(() => {
    V3.settingsPanel.open('房子');
    [...document.querySelectorAll('.set-house button')].find((b) => b.textContent === '恢复原来的房子').click();
    document.querySelector('[data-key="houseRestore"]').click();
  });
  await page.waitForFunction(() => V3.houseBlocks.from !== 'import' && !V3.houseBlocks.ui().busy, { timeout: 120000 });
  await page.evaluate(async () => { await V3.waitReady(V3.models.current(), 30000); await V3.houseBlocks.live().ready; });
  const C = await page.evaluate(SNAP), stored = await page.evaluate(async () => !!(await V3.houseBlocks.store.get()));
  ok(JSON.stringify(C) === JSON.stringify(before) && !stored, '恢复原来的房子：overlay、点光、壁灯、风铃、遮阳伞、贝壳柜、走路网格都和导入前一样，浏览器里存的删掉了',
    { diff: Object.keys(C).filter((k) => JSON.stringify(C[k]) !== JSON.stringify(before[k])), C, stored });
  const e1 = await pageErrors(page);
  ok(!e1.length && !errs.length, '导入、恢复的页面没有报错', { e1, errs });
  await page.close();
}

// ---------------- 布置模式（docs/HOUSE-V4.md 第 18 节，69-arrange）----------------
// 模型逐格比（尺寸、Offset、调色板、格子；不比 Metadata）
function CELLS(which) {
  const HB = V3.houseBlocks, m = which === 'local' ? HB.localModel() : which === 'default' ? HB.defaultModel : HB.model, d = V3.share.dump(m);
  return JSON.stringify([d.size, d.offset, d.palette, d.cells]);
}
async function arrangeTests() {
  const { page, errs } = await open('cabin', '?time=noon');
  const idle = () => page.evaluate(async () => { await V3.arrange.whenIdle(); await V3.waitReady(V3.models.current(), 30000); await V3.houseBlocks.live().ready; });
  const before = await page.evaluate(SNAP), def = await page.evaluate(CELLS, 'model');
  const girl0 = await page.evaluate(() => V3.actor.pos);

  // 进布置模式：左下角的按钮、上面一条、她停在原地
  const E = await page.evaluate(async () => {
    const btn = document.querySelector('.hud-arrange'); btn.click();
    for (let i = 0; i < 100 && !V3.arrange.on; i++) await new Promise((r) => setTimeout(r, 30));
    const bar = document.querySelector('.ar-bar'), A = V3.arrange;
    const fits = V3.houseBlocks.furnInstances().map((p) => [p.f.id, p.cell.join(), A.checkHere(p.cell)]).filter((x) => !x[2].ok);
    return { on: A.on, held: V3.actor.held, bar: bar && bar.textContent, corner: getComputedStyle(document.querySelector('.hud-corner')).display, fits };
  });
  ok(E.on && E.held && /完成/.test(E.bar || '') && /放弃修改/.test(E.bar) && /撤销一步/.test(E.bar) && /加家具/.test(E.bar) && E.corner === 'none',
    '左下角「布置」进布置模式：上面一条有 加家具 / 导出鲸图 / 撤销一步 / 放弃修改 / 完成，她停在原地', E);
  ok(E.fits.length === 0, '默认房子里每件家具在原地都符合「放得下」的规则（挂墙的背后是墙、吊顶的上面有东西、放地上的下面托得住）', E.fits);

  // 挪一件、转一件、放到墙里被拒、挂墙的背后没墙被拒、加一件、拆一件、撤销一步
  const t0 = Date.now();
  const O1 = await page.evaluate(async () => {
    const A = V3.arrange, G = () => V3.houseBlocks.grid, st = (x, y, z) => { const s = G().at(x, y, z); return s ? s.id + JSON.stringify(s.props || {}) : null; };
    const r = {};
    r.sel = A.select([0, 1, -12]);
    r.move = A.nudge('south'); await A.whenIdle();
    r.table = [st(0, 1, -12), st(0, 1, -11)];
    r.wall = A.moveTo([-7, 1, -11]);
    r.chairSel = A.select([-5, 1, -11]);
    r.rot = A.rotate(); await A.whenIdle();
    r.chair = st(-5, 1, -11);
    r.towel = A.add('towel_hook', [0, 1, -9], 'south');
    r.tv = A.add('tv_stand', [-6, 1, -13], 'east'); await A.whenIdle();
    r.tvCells = [st(-6, 1, -13), st(-6, 1, -12)];
    r.tvSel = A.state().sel;
    r.paraSel = A.select([-10, 1, 5]);
    r.rm = A.remove(); await A.whenIdle();
    r.para = [st(-10, 0, 5), st(-10, 1, 5), st(-10, 2, 5)];
    r.st = A.state();
    return r;
  });
  const opMs = Date.now() - t0;
  ok(O1.sel.ok && O1.move.ok && O1.table[0] === null && O1.table[1] === 'dining_table{"facing":"south"}', '挪一件：餐桌往南挪一格（方块数据跟着改）', O1);
  ok(!O1.wall.ok && /那里已经有/.test(O1.wall.why), '放到墙里被拒：' + (O1.wall.why || ''), O1.wall);
  ok(O1.rot.ok && O1.chair === 'desk_chair{"facing":"north"}', '转一件：书桌椅顺时针转 90°（朝西 → 朝北）', O1.chair);
  ok(!O1.towel.ok && /背后要有墙/.test(O1.towel.why), '挂墙的（毛巾）放在屋子中间被拒：背后要有墙', O1.towel);
  ok(O1.tv.ok && O1.tvCells[0] === 'tv_stand{"facing":"east","part":"0"}' && O1.tvCells[1] === 'tv_stand{"facing":"east","part":"1"}' && O1.tvSel && O1.tvSel.id === 'tv_stand',
    '加一件新家具：西墙边加一台电视（2 格，朝东），加好就选中它', O1);
  ok(O1.paraSel.ok && O1.paraSel.id === 'beach_parasol' && O1.rm.ok && O1.para.every((s) => s === null), '拆一件：遮阳伞（3 格一起拆）', O1);
  const A1 = await page.evaluate(SNAP), girl1 = await page.evaluate(() => V3.actor.pos);
  const A1x = await page.evaluate(() => { const r = []; V3.models.current().root.traverse((o) => { if (o.name === 'furn:tv') r.push(o.userData.cell.join()); }); return r.sort(); });
  ok(A1x.length === 2 && A1x.includes('-6,1,-13') && !A1.named.some((n) => n[0] === 'furn:parasol'), '场景按新方块重建：新电视叠了屏幕，拆掉的遮阳伞不画了', { tv: A1x, named: A1.named });
  ok(girl1 && Math.hypot(girl1[0] - girl0[0], girl1[2] - girl0[2]) < 1e-6, '改了好几次、场景重建了好几次，她一直停在原地', { girl0, girl1 });
  console.log('     （6 次操作 + 场景重建共 ' + (opMs / 1000).toFixed(1) + ' 秒）');
  const U1 = await page.evaluate(async () => {
    const A = V3.arrange, r = { u: A.undo() }; await A.whenIdle();
    const s = V3.houseBlocks.grid.at(-10, 1, 5); r.para = s && s.id; r.undoLeft = A.state().undo;
    r.u2 = A.undo(); await A.whenIdle(); r.tv = V3.houseBlocks.grid.at(-6, 1, -13);
    return r;
  });
  ok(U1.u.ok && U1.para === 'beach_parasol' && U1.u2.ok && U1.tv === null && U1.undoLeft === 3, '撤销一步：遮阳伞回来了；再撤销一步：新加的电视没了', U1);
  // 放弃修改：回到进来时的样子
  const D = await page.evaluate(async () => { const r = await V3.arrange.discard(); await V3.waitReady(V3.models.current(), 30000); return { r, on: V3.arrange.on, held: V3.actor.held, from: V3.houseBlocks.from }; });
  await idle();
  const D2 = await page.evaluate(SNAP), dCells = await page.evaluate(CELLS, 'model');
  ok(D.r && D.r.dirty && !D.on && !D.held && D.from === 'assets/house/house-v4.png' && dCells === def && JSON.stringify(D2) === JSON.stringify(before),
    '放弃修改：方块、overlay、点光、走路网格都回到进来时的样子，她接着玩', { D, diff: Object.keys(D2).filter((k) => JSON.stringify(D2[k]) !== JSON.stringify(before[k])) });

  // 再布置一次，点「完成」：存进浏览器，设置「房子」页写着「布置过的房子」
  const F = await page.evaluate(async () => {
    const A = V3.arrange; await A.enter();
    A.select([0, 1, -12]); A.nudge('south'); A.select([-5, 1, -11]); A.rotate(); A.add('tv_stand', [-6, 1, -13], 'east');
    A.select([-10, 0, 5]); A.remove(); A.add('flower_pot', [-4, 0, 1], 'south');
    A.add('picture_frames', [5, 2, -9], 'west');                        // 东墙上（电视上面）挂一组画
    await A.whenIdle();
    const r = await A.done(), rec = await V3.houseBlocks.store.get();
    V3.settingsPanel.open('房子'); await new Promise((q) => setTimeout(q, 300));
    const row = document.querySelector('.set-house-cur').textContent, back = [...document.querySelectorAll('.set-house button')].find((b) => b.textContent === '恢复原来的房子');
    V3.settingsPanel.close();
    return { r: r && { dirty: r.dirty, stored: r.saved && r.saved.stored }, rec: rec && { kind: rec.kind, place: rec.place, bytes: rec.bytes && rec.bytes.length }, from: V3.houseBlocks.from, row, back: back && !back.disabled, on: A.on };
  });
  ok(F.r && F.r.dirty && F.r.stored && F.rec && F.rec.kind === 'arranged' && F.rec.bytes > 100 && F.from === 'arranged' && !F.on,
    '完成：存成「布置过的房子」（IndexedDB，和导入的一样只留一份）', F);
  ok(/布置过的房子/.test(F.row || '') && F.back, '设置「房子」页写着「布置过的房子」，「恢复原来的房子」能点', F.row);
  await idle();
  const S1 = await page.evaluate(SNAP), arranged = await page.evaluate(CELLS, 'model');

  // 重开页面：还是布置过的那栋
  const p2 = await open('cabin', '?time=noon');
  const S2 = await p2.page.evaluate(SNAP), c2 = await p2.page.evaluate(CELLS, 'model'), from2 = await p2.page.evaluate(() => V3.houseBlocks.from);
  ok(from2 === 'arranged' && c2 === arranged && JSON.stringify(S2) === JSON.stringify(S1), '重新打开页面：还是布置过的那栋（方块逐格一样，overlay、点光、走路一样）',
    { from2, diff: Object.keys(S2).filter((k) => JSON.stringify(S2[k]) !== JSON.stringify(S1[k])) });

  // 导出鲸图 → 再导入：逐格一样；Metadata 按 FORMAT.md
  const X = await p2.page.evaluate(async () => {
    const HB = V3.houseBlocks, r = await HB.exportPng(), m = await V3.share.read(r.bytes), meta = HB.metaOf(m), d0 = V3.share.dump(HB.localModel()), d1 = V3.share.dump(m);
    const x = m.meta.compound.Xiaojingyu.compound;
    const imp = await HB.importFile(r.bytes, { file: r.name }); await V3.waitReady(V3.models.current(), 30000); await HB.live().ready;
    const d2 = V3.share.dump(HB.model);
    return { name: r.name, png: Array.from(r.bytes.slice(1, 4)), same: JSON.stringify([d0.size, d0.offset, d0.palette, d0.cells]) === JSON.stringify([d1.size, d1.offset, d1.palette, d1.cells]),
      offset: d1.offset, meta, fmt: x.FormatVersion, facing: x.Facing && x.Facing.string, source: x.Source && x.Source.string, mods: m.meta.compound.RequiredMods,
      imp: { ok: imp.ok, ask: imp.ask || null, error: imp.error || null }, again: JSON.stringify([d2.size, d2.offset, d2.palette, d2.cells]) === JSON.stringify([d0.size, d0.offset, d0.palette, d0.cells]) };
  });
  ok(/^小鲸鱼之家-布置过-\d{4}-\d\d-\d\d-\d{4}\.png$/.test(X.name) && X.png.join() === '80,78,71' && X.same, '导出鲸图：PNG（' + X.name + '），里面的方块和网页里的逐格一样', X);
  ok(X.offset.join() === '-9,0,-15' && X.facing === 'north' && X.fmt && X.fmt.int === 1 && /^haibian-web\//.test(X.source || '') && /网页里布置过/.test(X.meta.name || '') && X.meta.date > Date.now() - 600000,
    'Metadata：Facing 北、Offset 和原来一样 (−9, 0, −15)、名字带「网页里布置过」、日期、Source 是网页', X);
  ok(X.imp.ok && !X.imp.ask && X.again, '导出的鲸图再导入回网页：不用问，逐格一样', X.imp);
  await p2.page.close();

  // 恢复原来的房子：和默认完全一样
  const R = await page.evaluate(async () => { const r = await V3.houseBlocks.restore(); await V3.waitReady(V3.models.current(), 30000); await V3.houseBlocks.live().ready;
    return { r, from: V3.houseBlocks.from, stored: !!(await V3.houseBlocks.store.get()) }; });
  const R2 = await page.evaluate(SNAP), rCells = await page.evaluate(CELLS, 'model');
  ok(R.r.ok && !R.stored && R.from === 'assets/house/house-v4.png' && rCells === def && JSON.stringify(R2) === JSON.stringify(before),
    '恢复原来的房子：方块、overlay、点光、风铃、贝壳柜、走路网格都和默认完全一样', { R, diff: Object.keys(R2).filter((k) => JSON.stringify(R2[k]) !== JSON.stringify(before[k])) });

  // 真的指针：长按餐桌拖到别处；再按住拖到厨房台面上（放不下，变红），松手回原位
  await page.evaluate(async () => { await V3.arrange.enter(); await V3.view('floor=ground+cam=0.5_12_-2_0.5_1_-11'); await V3.nextFrames(3); });
  const sp = (p) => page.evaluate((q) => V3.arrange.screenOf(q), p);
  const a = await sp([0.5, 1.4, -11.5]), b = await sp([2.5, 1.0, -11.5]);
  await page.mouse.move(a[0], a[1]); await page.mouse.down();
  await new Promise((r) => setTimeout(r, 650));
  const P1 = await page.evaluate(() => V3.arrange.state());
  for (let i = 1; i <= 12; i++) await page.mouse.move(a[0] + (b[0] - a[0]) * i / 12, a[1] + (b[1] - a[1]) * i / 12);
  const P2 = await page.evaluate(() => ({ st: V3.arrange.state(), cam: V3.R.ctl.g.az }));
  await page.mouse.up(); await idle();
  const P3 = await page.evaluate(() => { const s = V3.houseBlocks.grid.at(2, 1, -12); return { t: s && s.id, old: V3.houseBlocks.grid.at(0, 1, -12), sel: V3.arrange.state().sel }; });
  ok(P1.sel && P1.sel.id === 'dining_table' && P1.drag && P2.st.drag && P2.st.drag.target && P2.st.drag.target.ok && P3.t === 'dining_table' && P3.old === null,
    '真的指针：长按 0.4 秒选中餐桌，拖到东边两格，松手就放下', { P1, P2, P3 });
  const c = await sp([2.5, 1.4, -11.5]), d = await sp([-0.5, 1.0, -14.5]);
  await page.mouse.move(c[0], c[1]); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(c[0] + (d[0] - c[0]) * i / 12, c[1] + (d[1] - c[1]) * i / 12);
  const P4 = await page.evaluate(() => ({ st: V3.arrange.state(), tip: document.querySelector('.ar-tipbad').textContent }));
  await page.mouse.up(); await idle();
  const P5 = await page.evaluate(() => { const s = V3.houseBlocks.grid.at(2, 1, -12); return { t: s && s.id, undo: V3.arrange.state().undo }; });
  ok(P4.st.drag && P4.st.drag.target && !P4.st.drag.target.ok && /厨房台面/.test(P4.tip) && P5.t === 'dining_table' && P5.undo === 1,
    '真的指针：按住选中的餐桌拖到厨房台面上，变红、说清楚为什么，松手回原位', { P4, P5 });
  await page.evaluate(async () => { await V3.arrange.discard(); });
  await idle();
  const Z = await page.evaluate(CELLS, 'model');
  ok(Z === def, '放弃修改以后又是默认的房子', null);
  const e1 = await pageErrors(page);
  ok(!e1.length && !errs.length, '布置模式的页面没有报错', { e1, errs });
  await page.close();
}

// ---------------- 布置模式第二步：整栋房子挪位置、转方向 ----------------
// 跟着房子的东西：门（方块）、贴墙的藤蔓、出场点（台阶前）、门内外落脚点、走路（从台阶前上阁楼）
function HOUSEINFO() {
  const N = V3.nav, root = V3.models.current().root, vines = {}, r3 = (v) => Math.round(v * 1000) / 1000;
  root.traverse((o) => { if (/^vine(SW|SE|E)$/.test(o.name || '')) vines[o.name] = [o.getWorldPosition(new THREE.Vector3()).toArray().map(r3), r3(o.rotation.y)]; });
  const G = V3.houseBlocks.grid, find = (re) => {
    for (let i = 0; i < G.cells.length; i++) { const s = G.st[G.cells[i]]; if (s && re.test(s.ns + ':' + s.id)) return [G.org[0] + i % G.W, G.org[1] + Math.floor(i / (G.W * G.L)), G.org[2] + Math.floor(i / G.W) % G.L, (s.props || {}).facing || '']; }
    return null;
  };
  const p = N.path(N.home, [N.home[0], N.home[1], 0]), loft = N.path(N.home, V3.houseBlocks.placePoint([-2.0, 5, -10.6], V3.houseBlocks.place).filter((v, i) => i !== 1).concat([5]));
  return { place: Object.assign({}, V3.houseBlocks.place), home: N.home.map(r3), doorOut: N.doorLink.out.map(r3), doorIn: N.doorLink.in.map(r3), vines,
    door: find(/_door$/), bed: find(/^xiaojingyu:bed$/), org: G.org.slice(), here: !!p, loftEnd: loft ? loft[loft.length - 1].map(r3) : null, zones: N.stats().zones,
    girl: V3.actor.pos.map(r3), lamps: (() => { let n = 0; root.traverse((o) => { if (o.isPointLight) n++; }); return n; })() };
}
async function arrangeHouseTests() {
  const { page, errs } = await open('cabin', '?time=noon');
  const idle = () => page.evaluate(async () => { await V3.arrange.whenIdle(); await V3.waitReady(V3.models.current(), 30000); await V3.houseBlocks.live().ready; });
  const before = await page.evaluate(SNAP), def = await page.evaluate(CELLS, 'model'), I0 = await page.evaluate(HOUSEINFO);
  const sh = (p, d) => p.map((v, i) => +(v + (d[i] || 0)).toFixed(3));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // 挪一格（往东）
  const M1 = await page.evaluate(async () => { const A = V3.arrange; await A.enter(); const g0 = V3.actor.pos; const s = A.selectHouse(); const r = A.nudge('east'); await A.whenIdle(); return { s, r, st: A.state(), g0 }; });
  await idle();
  const I1 = await page.evaluate(HOUSEINFO);
  ok(M1.s.ok && M1.r.ok && same(I1.place, { dx: 1, dz: 0, k: 0 }) && I1.org[0] === I0.org[0] + 1 && same(I1.door, sh(I0.door.slice(0, 3), [1]).concat(I0.door[3])) && same(I1.bed, sh(I0.bed.slice(0, 3), [1]).concat(I0.bed[3])),
    '整栋房子往东挪一格：整张鲸图跟着挪（门、床……都往东 1 格，朝向不变）', { I0, I1 });
  ok(Object.keys(I0.vines).length === 3 && Object.keys(I0.vines).every((k) => same(I1.vines[k][0], sh(I0.vines[k][0], [1])) && I1.vines[k][1] === I0.vines[k][1]),
    '墙上的藤蔓跟着挪', { v0: I0.vines, v1: I1.vines });
  ok(same(I1.home, sh(I0.home, [1])) && same(I1.doorOut, sh(I0.doorOut, [1])) && same(I1.doorIn, sh(I0.doorIn, [1])) && same(I1.girl, sh(M1.g0.map((v) => +v.toFixed(3)), [1, 0, 0])),
    '她出场的地方（台阶前）、门内外落脚点跟着挪；她站在台阶前，也跟着房子挪了一格', { I0, I1 });
  ok(I1.here && I1.loftEnd && Math.abs(I1.loftEnd[2] - 5) < 0.01 && Math.abs(I1.zones.inside - I0.zones.inside) < 20 && Math.abs(I1.zones.loft - I0.zones.loft) < 20,
    '走路网格跟着挪：从台阶前照样走到阁楼，一楼、阁楼能走的面积不变', { z0: I0.zones, z1: I1.zones, end: I1.loftEnd });

  // 压到椰子树、石堆被拒（不动）
  const B = await page.evaluate(async () => { const A = V3.arrange; const palm = A.placeHouse({ dx: -3, dz: 0, k: 0 }), rock = A.placeHouse({ dx: -2, dz: 0, k: 0 }), out = A.nudge('north'); await A.whenIdle(); return { palm, rock, out, place: V3.houseBlocks.place }; });
  ok(!B.palm.ok && /椰子树/.test(B.palm.why) && !B.rock.ok && /石堆/.test(B.rock.why) && same(B.place, { dx: 1, dz: 0, k: 0 }),
    '挪过去会压到椰子树、石堆的不让放（说明原因），房子不动：' + B.palm.why + '；' + B.rock.why, B);
  ok(!B.out.ok && /出场地/.test(B.out.why), '往北挪会跑出场地，不让挪：' + B.out.why, B.out);

  // 转 90°：原地转不开就挪到最近转得开的地方
  const R1 = await page.evaluate(async () => { const r = V3.arrange.rotate(); await V3.arrange.whenIdle(); return r; });
  await idle();
  const I2 = await page.evaluate(HOUSEINFO);
  const turn = (p) => { const c = [0, -11], q = [p[0] - c[0] - 0, p[2] - c[1]]; return [-q[1] + c[0], p[1], q[0] + c[1]]; };   // 默认摆法里的点顺时针转 90°（绕 (0, −11)）
  const want = (p0) => { const q = turn([p0[0], 0, p0[1]]); return [q[0] + I2.place.dx, q[2] + I2.place.dz]; };
  ok(R1.ok && I2.place.k === 1 && I2.door[3] === 'east' && I0.door[3] === 'north', '转 90°（原地转不开时挪到最近转得开的地方：' + JSON.stringify(R1.moved || [0, 0]) + '）：门从朝北变成朝东', { R1, door: I2.door });
  ok(same(I2.home, want(I0.home).map((v) => +v.toFixed(3))) && same(I2.doorOut, want(I0.doorOut).map((v) => +v.toFixed(3))) && I2.vines.vineSW[1] !== I0.vines.vineSW[1],
    '转过以后出场点、门外落脚点、藤蔓跟着转', { I2, want: want(I0.home) });
  ok(I2.here && I2.loftEnd && Math.abs(I2.loftEnd[2] - 5) < 0.01 && I2.lamps === I0.lamps && Math.abs(I2.zones.inside - I0.zones.inside) < 20,
    '转过以后照样从台阶前走到阁楼，点光一样多', { end: I2.loftEnd, lamps: [I0.lamps, I2.lamps], z: [I0.zones, I2.zones] });

  // 完成：存起来（方块 + 摆法），重开还在；导出的鲸图还是房子自己的方向，和默认的房子逐格一样（只挪了房子）
  const F = await page.evaluate(async () => { const r = await V3.arrange.done(); const rec = await V3.houseBlocks.store.get(); return { dirty: r.dirty, place: rec && rec.place, kind: rec && rec.kind }; });
  await idle();
  const S1 = await page.evaluate(SNAP), c1 = await page.evaluate(CELLS, 'model');
  ok(F.dirty && F.kind === 'arranged' && same(F.place, I2.place), '完成：房子摆在哪儿、朝哪和方块一起存起来', F);
  const p2 = await open('cabin', '?time=noon');
  const I3 = await p2.page.evaluate(HOUSEINFO), S3 = await p2.page.evaluate(SNAP), c3 = await p2.page.evaluate(CELLS, 'model');
  ok(same(I3.place, I2.place) && c3 === c1 && same(I3.home, I2.home) && same(I3.vines, I2.vines) && JSON.stringify(S3) === JSON.stringify(S1),
    '重开页面：房子还在挪过、转过的地方（方块、藤蔓、出场点、overlay、走路都一样）', { I3, diff: Object.keys(S3).filter((k) => JSON.stringify(S3[k]) !== JSON.stringify(S1[k])) });
  const X = await p2.page.evaluate(async () => { const r = await V3.houseBlocks.exportPng(), m = await V3.share.read(r.bytes), d = V3.share.dump(m), d0 = V3.share.dump(V3.houseBlocks.defaultModel);
    return { local: JSON.stringify([d.size, d.offset, d.palette, d.cells]) === JSON.stringify([d0.size, d0.offset, d0.palette, d0.cells]), offset: d.offset, facing: m.meta.compound.Xiaojingyu.compound.Facing.string }; });
  ok(X.local && X.offset.join() === '-9,0,-15' && X.facing === 'north', '导出的鲸图还是房子自己的方向（Facing 北、Offset 不变），和默认房子逐格一样（MC 那边不管它在沙滩上的位置）', X);
  await p2.page.close();

  // 恢复原来的房子：和默认完全一样
  await page.evaluate(async () => { await V3.houseBlocks.restore(); });
  await idle();
  const I4 = await page.evaluate(HOUSEINFO), S4 = await page.evaluate(SNAP), c4 = await page.evaluate(CELLS, 'model');
  ok(c4 === def && same(I4.place, { dx: 0, dz: 0, k: 0 }) && same(I4.home, I0.home) && same(I4.vines, I0.vines) && same(I4.doorOut, I0.doorOut) && JSON.stringify(S4) === JSON.stringify(before),
    '恢复原来的房子：位置、方向、方块、藤蔓、出场点、overlay、走路都和默认完全一样', { I4, diff: Object.keys(S4).filter((k) => JSON.stringify(S4[k]) !== JSON.stringify(before[k])) });
  const e1 = await pageErrors(page);
  ok(!e1.length && !errs.length, '挪房子的页面没有报错', { e1, errs });
  await page.close();
}

// ---------------- 相册和相框（docs/PHOTOS.md） ----------------
// 页面里造图片：画布画好 → File（type 'image/jpeg' / 'image/png'）。kind：'grad'（渐变 + 字）、'bands'（上红中绿下蓝，查裁中间）、'noise'（随机像素，逼它减色）、'alpha'（左上角透明）
function PHOTO_HELPERS() {
  window.__mkPhoto = (name, w, h, type, kind, seed = 1) => new Promise((res) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    if (kind === 'noise') {
      const im = g.createImageData(w, h);                                  // 真随机：PNG 原样存压不小（超过 48 KB）
      for (let o = 0; o < im.data.length; o += 65536) crypto.getRandomValues(im.data.subarray(o, Math.min(im.data.length, o + 65536)));
      for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
      g.putImageData(im, 0, 0);
    } else if (kind === 'bands') {
      g.fillStyle = '#20c040'; g.fillRect(0, 0, w, h); g.fillStyle = '#e02020'; g.fillRect(0, 0, w, h * 0.19); g.fillStyle = '#2040e0'; g.fillRect(0, h * 0.81, w, h);
    } else {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, ['#ffb0c8', '#8fd6ff', '#ffe08a'][seed % 3]); gr.addColorStop(1, ['#3a5fcf', '#cf6a3a', '#3aa36a'][seed % 3]);
      g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(h / 4) + 'px sans-serif'; g.fillText(name.slice(0, 2), w * 0.12, h * 0.62);
      if (kind === 'alpha') g.clearRect(0, 0, w * 0.3, h * 0.3);
    }
    cv.toBlob((b) => res(new File([b], name, { type })), type, 0.92);
  });
  // PNG 字节 → 像素（解开看颜色）
  window.__px = async (png, x, y) => { const bm = await createImageBitmap(new Blob([png], { type: 'image/png' })), cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; const g = cv.getContext('2d'); g.drawImage(bm, 0, 0); return [bm.width, bm.height, Array.from(g.getImageData(x, y, 1, 1).data)]; };
  window.__photoInfo = () => {
    const HB = V3.houseBlocks, P = V3.photos, m = HB.model, t = P.albumTables(m), a = t.length ? P.albumAt(m, t[0].cell) : null;
    return { from: HB.from, tables: t.map((q) => q.cell), album: a && { cell: a.cell, ids: a.photos.map((p) => p.id), names: a.photos.map((p) => p.name), bad: a.bad },
      frames: P.frames(m).map((f) => ({ kind: f.kind, cell: f.cell, facing: f.facing, ids: f.slots.map((p) => (p ? p.id : null)), bad: f.bad.filter(Boolean).length })),
      bes: (m.blockEntities || []).map((b) => b.id.split(':')[1] + '@' + P.originOf(m).map((o, k) => o + b.pos[k]).join(',')).sort(), shown: V3.photoFrames.state() };
  };
}
async function photoTests() {
  const { page, errs } = await open('cabin', '?time=noon');
  const idle = () => page.evaluate(async () => { if (V3.arrange.on) await V3.arrange.whenIdle(); await V3.waitReady(V3.models.current(), 30000); await V3.houseBlocks.live().ready; await V3.photoFrames.whenReady(); });
  await page.evaluate(async () => { await V3.houseBlocks.restore(); });
  await idle();
  await page.evaluate(PHOTO_HELPERS);
  const def = await page.evaluate(CELLS, 'model');

  // 默认房子：相册矮桌和画框墙有空的方块实体（生成器写的），相册是空的，6 个小框都是原来的小画
  const D0 = await page.evaluate(() => Object.assign(window.__photoInfo(), { check: V3.houseBlocks.check(V3.houseBlocks.model).photos, slots: V3.furnMc.byId('picture_frames').photoSlots.length }));
  ok(D0.tables.length === 1 && D0.tables[0].join() === '-2,5,-11' && D0.album.ids.length === 0 && D0.frames.length === 1 && D0.frames[0].kind === 'wall' && D0.frames[0].ids.every((x) => x === null),
    '默认房子：一张相册矮桌 (−2, 5, −11)，相册是空的；画框墙 6 个小框都是原来的小画', D0);
  ok(D0.bes.join() === 'photo_album_table@-2,5,-11,picture_frames@-6,2,-11' && D0.shown.length === 6 && D0.shown.every((q) => !q.id) && D0.check.photos === 0 && D0.check.bad === 0,
    '方块实体：相册矮桌、画框墙 part=0 各一条（Data 是空的也当空）；没有照片要贴', D0);

  // 真的点阁楼的相册矮桌：打开相册（还是空的）
  await page.evaluate(async () => { await V3.view('floor=loft+cam=-1.5_8.2_-6.8_-1.5_5.2_-10.5'); await V3.nextFrames(4); });
  const at = await page.evaluate(() => V3.arrange.screenOf([-1.5, 5.32, -10.5]));
  await page.mouse.click(at[0], at[1]);
  await page.waitForFunction(() => V3.album.state().open, { timeout: 5000 }).catch(() => {});
  const O = await page.evaluate(() => ({ st: V3.album.state(), text: document.querySelector('.alb-card') && document.querySelector('.alb-card').textContent }));
  ok(O.st.open && O.st.cell && O.st.cell.join() === '-2,5,-11' && O.st.count === 0 && /相册还是空的/.test(O.text || '') && /添加照片/.test(O.text || ''), '真的点阁楼的相册矮桌：打开相册（空的，有「添加照片」）', O);

  // 加照片：大横图、竖图（上下两头裁掉）、很小的图、很花的图（要减色）、透明的、重复的、不是图片的
  const A = await page.evaluate(async () => {
    const mk = window.__mkPhoto, P = V3.photos;
    const big = await mk('海边.jpg', 1600, 1200, 'image/jpeg', 'grad', 0);
    const files = [big, await mk('竖着的.png', 300, 500, 'image/png', 'bands'), await mk('小图.jpg', 90, 60, 'image/jpeg', 'grad', 1),
      await mk('很花.png', 128, 128, 'image/png', 'noise', 7), await mk('透明.png', 200, 200, 'image/png', 'alpha', 2),
      new File([await big.arrayBuffer()], '海边-副本.jpg', { type: 'image/jpeg' }), new File(['这不是图片'], '说明.txt', { type: 'text/plain' })];
    const r = await V3.album.add(files), st = V3.album.state(), ph = V3.album.photos();
    const rec = await V3.houseBlocks.store.get();
    return { r, st, sizes: ph.map((p) => p.png.length), checks: ph.map((p) => P.check(p.png).ok), idsOk: ph.every((p) => p.id === P.idOf(p.png) && /^[0-9a-f]{16}$/.test(p.id)),
      added: ph.every((p) => p.added > Date.now() - 600000), bands: [await window.__px(ph[1].png, 64, 1), await window.__px(ph[1].png, 64, 126)], alpha: await window.__px(ph[4].png, 2, 2),
      noisePx: await window.__px(ph[3].png, 10, 10), rec: rec && { kind: rec.kind }, from: V3.houseBlocks.from, msg: st.msg };
  });
  ok(A.r.ok && A.r.added === 5 && A.r.dup === 1 && A.r.bad.length === 1 && /说明\.txt（不是图片）/.test(A.r.bad[0]) && A.st.count === 5 && A.st.tiles === 5,
    '加照片：5 张加上了，重复的 1 张没加，不是图片的说清楚了', A.r);
  ok(A.st.names.join() === '海边,竖着的,小图,很花,透明', '名字 = 文件名去掉扩展名，顺序 = 加的顺序', A.st.names);
  ok(A.checks.every(Boolean) && A.sizes.every((n) => n <= 48000) && A.idsOk && A.added, '每张都是 128 × 128 的 PNG、不超过 48000 字节、Id = SHA-1 前 16 位、带加的时间', A.sizes);
  ok(A.r.reduced >= 1 && A.noisePx[0] === 128, '太花的那张（原样存超过 48 KB）减了颜色才存下', { reduced: A.r.reduced, size: A.sizes[3] });
  ok(A.bands[0][2][1] > 150 && A.bands[0][2][0] < 90 && A.bands[1][2][1] > 150 && A.bands[1][2][2] < 120, '竖图从中间裁正方形：上下的红、蓝两头裁掉了，上下边都是中间的绿色', A.bands);
  ok(A.alpha[2].slice(0, 3).every((v) => v > 245) && A.alpha[2][3] === 255, '透明的地方垫成白色（照片不透明）', A.alpha);
  ok(A.from === 'arranged' && A.rec && A.rec.kind === 'arranged', '加了照片，房子变成「布置过的房子」，存进了浏览器', A);

  // 改名、删除、调顺序
  const E = await page.evaluate(async () => {
    const AL = V3.album, r = {};
    r.long = await AL.rename(1, '竖着的' + '很长'.repeat(40)); r.longLen = Array.from(AL.state().names[1]).length;
    r.rn = await AL.rename(1, '小鲸鱼和她的鱼');
    r.rm = await AL.remove(2);                     // 小图
    r.mv = await AL.move(2, 0);                    // 很花 → 最前
    r.st = AL.state();
    // 界面：选中一张，下面一条有名字、往前 / 往后、删除
    document.querySelector('.alb-tile[data-i="1"]').click();
    await new Promise((q) => setTimeout(q, 50));
    const foot = document.querySelector('.alb-foot');
    r.foot = foot && !foot.classList.contains('hide') ? foot.textContent : null;
    r.input = document.querySelector('.alb-name-in') && document.querySelector('.alb-name-in').value;
    return r;
  });
  ok(E.longLen === 64 && E.rn.ok && E.rm.ok && E.mv.ok && E.st.names.join() === '很花,海边,小鲸鱼和她的鱼,透明', '改名（最多 64 个字）、删掉一张、把「很花」挪到最前', E);
  ok(/往前/.test(E.foot || '') && /往后/.test(E.foot || '') && /删除/.test(E.foot || '') && E.input === '海边', '点一张：下面一条有名字、往前 / 往后、删除', E.foot);

  // 满 64 张就不能再加
  const F = await page.evaluate(async () => {
    const HB = V3.houseBlocks, P = V3.photos, cell = [-2, 5, -11], keep = P.albumAt(HB.model, cell).photos, p0 = keep[0];
    const fake = Array.from({ length: 64 }, (_, i) => ({ tag: { compound: { Id: { string: i.toString(16).padStart(16, '0') }, Png: { byteArray: new Int8Array(p0.png.buffer, p0.png.byteOffset, p0.png.length) } } } }));
    HB.setEntities(P.setAlbum(HB.model, cell, fake));
    V3.album.close(); await V3.album.open({ cell });
    const r = await V3.album.add([await window.__mkPhoto('多一张.jpg', 200, 200, 'image/jpeg', 'grad', 2)]), st = V3.album.state();
    const addOff = document.querySelector('.alb-add').classList.contains('off');
    HB.setEntities(P.setAlbum(HB.model, cell, keep)); await HB.saveArranged();
    V3.album.close(); await V3.album.open({ cell });
    return { r, count: st.count, addOff, after: V3.album.state().names };
  });
  ok(!F.r.ok && F.r.full === 1 && F.count === 64 && F.addOff && F.after.join() === '很花,海边,小鲸鱼和她的鱼,透明', '相册满 64 张：「添加照片」点不了，再加的说清楚没加', F);
  await page.evaluate(() => V3.album.close());

  // 真的点画框墙的一个小框（第 6 个，上排最右）：打开「换照片」，挑「海边」；第 3 个用接口挂「小鲸鱼和她的鱼」
  await page.evaluate(async () => { await V3.view('floor=ground+cam=-2.6_2.75_-10.2_-6_2.7_-10.2'); await V3.nextFrames(4); });
  const W = await page.evaluate(() => { const P = V3.photos, fr = P.frames(V3.houseBlocks.model).find((f) => f.kind === 'wall'); return { cell: fr.cell, at: V3.arrange.screenOf(P.slotGeom(fr.f, fr.cell, fr.facing, 5).center) }; });
  await page.mouse.click(W.at[0], W.at[1]);
  await page.waitForFunction(() => V3.album.pickState().open, { timeout: 5000 }).catch(() => {});
  const K = await page.evaluate(async (cell) => {
    const AL = V3.album, ps = AL.pickState(), text = document.querySelector('.alb-pick') && document.querySelector('.alb-pick').textContent;
    const c1 = await AL.choose(1);
    AL.pick({ cell, slot: 2 }); const c2 = await AL.choose(2);
    await V3.photoFrames.whenReady();
    return { ps, text, c1, c2, info: window.__photoInfo(), slots: V3.photos.dataOf(V3.photos.beAt(V3.houseBlocks.model, cell)).Slots.list.length };
  }, W.cell);
  const ids = (await page.evaluate(() => window.__photoInfo())).album.ids;
  const wall = K.info.frames.find((f) => f.kind === 'wall'), shownW = K.info.shown.filter((q) => q.kind === 'wall');
  ok(K.ps.open && K.ps.slot === 5 && K.ps.kind === 'wall' && K.ps.tiles === 5 && /原来的/.test(K.text || ''), '真的点画框墙上排最右的小框：打开「换照片」，是第 6 个框，能挑「空（原来的小画）」和相册里的 4 张', K.ps);
  ok(K.c1.ok && K.c2.ok && wall.ids[5] === ids[1] && wall.ids[2] === ids[2] && wall.ids.filter(Boolean).length === 2 && K.slots === 6,
    '挂上了：第 6 个框是「海边」，第 3 个框是「小鲸鱼和她的鱼」（方块实体 Slots 6 个）', wall);
  ok(shownW[5].shown && shownW[2].shown && shownW[5].visible && !shownW[0].shown, '照片平面贴好了（空的框不贴，露出原来的小画）', shownW);
  const Kb = await page.evaluate(async (cell) => { V3.album.pick({ cell, slot: 5 }); const r = await V3.album.choose(null); await V3.photoFrames.whenReady(); return { r, info: window.__photoInfo() }; }, W.cell);
  ok(Kb.r.ok && Kb.info.frames[0].ids[5] === null && Kb.info.frames[0].ids[2] === ids[2], '第 6 个框换回「空」：露出原来的小画', Kb.info.frames[0]);

  // 布置模式：加一个相框（挂墙）、换照片、撤销、挪相框和相册矮桌（照片跟着走）、拆画框墙再撤销、挪整栋房子
  const B = await page.evaluate(async () => {
    const A = V3.arrange, P = V3.photos, r = {};
    await A.enter();
    const cand = [];
    for (const y of [2, 3, 1]) for (const z of [-9, -12, -13, -14, -8]) cand.push([[-6, y, z], 'east']);
    for (const y of [6, 7]) for (const x of [-4, -3, -1, 0, 1]) cand.push([[x, y, -15], 'south']);
    const along = (c, f) => (f === 'east' ? [[c[0], c[1], c[2] - 1], [c[0], c[1], c[2] + 1]] : [[c[0] + 1, c[1], c[2]], [c[0] - 1, c[1], c[2]]]);
    const pick = cand.find(([c, f]) => A.check('photo_frame', c, f).ok && along(c, f).some((q) => A.check('photo_frame', q, f).ok));   // 旁边一格也挂得上（下面要挪）
    r.cell = pick && pick[0]; r.facing = pick && pick[1];
    r.add = A.add('photo_frame', r.cell, r.facing); await A.whenIdle();
    r.fresh = P.beAt(A.model(), r.cell); r.fresh = r.fresh && { id: r.fresh.id, keys: Object.keys(P.dataOf(r.fresh)) };
    r.sel = A.state().sel;
    const pb = document.querySelector('.ar-photo');
    r.btn = !!pb && pb.parentNode.style.display !== 'none';
    r.pick = A.pickPhoto(); r.ps = V3.album.pickState();
    r.choose = await V3.album.choose(2); await A.whenIdle(); await V3.photoFrames.whenReady();
    r.after = window.__photoInfo(); r.dirty = A.state().dirty;
    r.undo = A.undo(); await A.whenIdle(); r.undone = P.frameAt(A.model(), r.cell);
    r.undone = r.undone && r.undone.slots[0];
    A.select(r.cell); A.pickPhoto(); await V3.album.choose(2); await A.whenIdle();
    // 挪相框：沿着墙挪一格（照片跟着）
    A.select(r.cell);
    const dirs = r.facing === 'east' ? ['north', 'south'] : ['east', 'west'];
    for (const d of dirs) { const m = A.nudge(d); if (m.ok) { r.nudge = d; break; } }
    await A.whenIdle();
    r.moved = A.state().sel && A.state().sel.cell;
    // 挪相册矮桌：往东一格（不行就往西）
    A.select([-2, 5, -11]); r.albumMove = A.nudge('east'); if (!r.albumMove.ok) r.albumMove = A.nudge('west'); await A.whenIdle();
    r.albumCell = A.state().sel && A.state().sel.cell;
    // 拆画框墙，再撤销
    A.select([-6, 2, -11]); r.rm = A.remove(); await A.whenIdle();
    r.wallGone = !P.beAt(A.model(), [-6, 2, -11]);
    r.undo2 = A.undo(); await A.whenIdle();
    await V3.photoFrames.whenReady();
    r.info = window.__photoInfo();
    return r;
  });
  const fr = B.info.frames.find((f) => f.kind === 'frame'), wl = B.info.frames.find((f) => f.kind === 'wall');
  ok(B.cell && B.add.ok && B.fresh && B.fresh.id === 'xiaojingyu:photo_frame' && B.fresh.keys.length === 0 && B.sel && B.sel.id === 'photo_frame' && B.sel.mount === 'wall',
    '布置模式里加一个相框（' + (B.cell || []).join(',') + '，朝' + B.facing + '）：挂在墙上，带一条空的方块实体', B);
  ok(B.btn && B.pick.ok && B.ps.open && B.ps.kind === 'frame' && B.ps.slot === 0 && B.choose.ok && B.after.frames.find((f) => f.kind === 'frame').ids[0] === ids[2] && B.dirty,
    '选中相框多一个「换照片」：挑了「小鲸鱼和她的鱼」，算改动', { btn: B.btn, ps: B.ps, choose: B.choose });
  ok(B.undo.ok && B.undone === null, '撤销一步：相框又是空的', B.undone);
  ok(B.nudge && fr && fr.cell.join() === (B.moved || []).join() && fr.ids[0] === ids[2] && B.info.shown.some((q) => q.kind === 'frame' && q.id === ids[2] && q.shown),
    '挪相框：照片跟着走，新位置贴着照片', { fr, moved: B.moved });
  ok(B.albumMove.ok && B.albumCell && B.info.album.cell.join() === B.albumCell.join() && B.albumCell.join() !== '-2,5,-11' && B.info.album.ids.join() === ids.join() && !B.info.bes.includes('photo_album_table@-2,5,-11'),
    '挪相册矮桌：相册（4 张）跟着走，原来那格没有方块实体了', B.info.album);
  ok(B.rm.ok && B.wallGone && B.undo2.ok && wl && wl.ids[2] === ids[2], '拆画框墙：方块实体一起拆；撤销：照片回来了', wl);
  // 挪整栋房子：方块实体跟着；导出的还是房子自己的方向（方块实体的位置跟着转回去）
  const Hm = await page.evaluate(async () => {
    const A = V3.arrange, HB = V3.houseBlocks, P = V3.photos, before = P.albumTables(HB.localModel()).map((t) => t.cell.join());
    A.selectHouse(); const r = A.placeHouse({ dx: 1, dz: 0, k: 0 }); await A.whenIdle(); await V3.photoFrames.whenReady();
    const info = window.__photoInfo(), local = P.albumTables(HB.localModel()).map((t) => t.cell.join());
    const u = A.undo(); await A.whenIdle(); A.furnMode();
    return { r, info, before, local, u: u.ok };
  });
  ok(Hm.r.ok && Hm.info.album.cell.join() === [B.albumCell[0] + 1, B.albumCell[1], B.albumCell[2]].join() && Hm.info.album.ids.length === 4 && Hm.info.shown.filter((q) => q.id && q.shown).length === 2 && Hm.local.join() === Hm.before.join() && Hm.u,
    '整栋房子往东挪一格：相册、相框的照片跟着走；房子自己方向的模型里位置不变', Hm);
  const Dn = await page.evaluate(async () => { const r = await V3.arrange.done(); return { dirty: r.dirty, stored: r.saved && r.saved.stored, info: window.__photoInfo() }; });
  await idle();
  ok(Dn.dirty && Dn.stored && Dn.info.from === 'arranged', '完成：存进浏览器', Dn);
  const S1 = await page.evaluate(() => window.__photoInfo());

  // 重开页面：相册、相框、画框墙的照片都在
  const p2 = await open('cabin', '?time=noon');
  await p2.page.evaluate(async () => { await V3.photoFrames.whenReady(); });
  await p2.page.evaluate(PHOTO_HELPERS);
  const S2 = await p2.page.evaluate(() => window.__photoInfo());
  ok(S2.from === 'arranged' && JSON.stringify(S2.album) === JSON.stringify(S1.album) && JSON.stringify(S2.frames) === JSON.stringify(S1.frames) && S2.shown.filter((q) => q.id && q.shown).length === 2,
    '重开页面：相册（4 张、名字、顺序）、相框、画框墙的照片都在', { S1: S1.album, S2: S2.album, f1: S1.frames, f2: S2.frames });

  // 导出鲸图 → 再导入：照片都在（方块实体在鲸图里，位置对）
  const X = await p2.page.evaluate(async (ac) => {
    const HB = V3.houseBlocks, P = V3.photos, r = await HB.exportPng(), m = await V3.share.read(r.bytes);
    const mine = { album: P.albumAt(m, ac).photos.map((p) => p.id), frames: P.frames(m).map((f) => [f.kind, f.cell.join(), f.slots.map((p) => (p ? p.id : null))]), bes: m.blockEntities.map((b) => b.id + '@' + b.pos.join(',')) };
    const imp = await HB.importFile(r.bytes, { file: r.name }); await V3.waitReady(V3.models.current(), 30000); await HB.live().ready; await V3.photoFrames.whenReady();
    return { mine, imp: { ok: imp.ok, ask: imp.ask || null, photos: imp.check && imp.check.photos }, info: window.__photoInfo() };
  }, S1.album.cell);
  ok(X.mine.album.join() === S1.album.ids.join() && X.mine.frames.length === 2 && X.mine.bes.length === 3, '导出的鲸图里：相册矮桌 4 张、相框、画框墙（3 条方块实体，位置是鲸图里的格子）', X.mine);
  ok(X.imp.ok && !X.imp.ask && X.imp.photos.photos === 4 + 2 && X.imp.photos.bad === 0 && JSON.stringify(X.info.album) === JSON.stringify(S1.album) && JSON.stringify(X.info.frames) === JSON.stringify(S1.frames),
    '再导入回网页：不用问，照片都在', X.imp);

  // 坏照片：不是 PNG、64 × 64、超过 48 KB、头对但解不开 —— 不画、不崩，相册里的坏照片原样留着
  const Bd = await p2.page.evaluate(async () => {
    const HB = V3.houseBlocks, P = V3.photos, N = V3.nbt;
    let m = HB.exportModel();
    const ba = (b) => ({ byteArray: new Int8Array(b.buffer, b.byteOffset, b.length) });
    const small = await P.encodePng(new Uint8Array(64 * 64 * 3).fill(200), 64, 64);
    const big = new Uint8Array(50000); big.set(small.slice(0, 33)); new DataView(big.buffer).setUint32(16, 128); new DataView(big.buffer).setUint32(20, 128);
    const broken = new Uint8Array(3000); broken.set(small.slice(0, 33)); new DataView(broken.buffer).setUint32(16, 128); new DataView(broken.buffer).setUint32(20, 128);
    const tag = (png, id) => ({ compound: { Id: { string: id }, Png: ba(png), Name: { string: '坏的' } } });
    const fr = P.frames(m).find((f) => f.kind === 'frame'), wl = P.frames(m).find((f) => f.kind === 'wall');
    const fbe = P.beAt(m, fr.cell); m = P.withBE(m, fr.cell, fbe.id, { Photo: tag(new TextEncoder().encode('这不是 PNG'), '1111111111111111') });
    const wd = Object.assign({}, P.dataOf(P.beAt(m, wl.cell))), list = wd.Slots.list.slice();
    list[0] = tag(small, '2222222222222222'); list[1] = tag(big, '3333333333333333'); list[3] = tag(broken, '4444444444444444'); list[4] = { compound: { Png: { string: '类型不对' } } };
    m = P.withBE(m, wl.cell, wl.block, Object.assign(wd, { Slots: { list } }));
    const ac = P.albumTables(m)[0].cell, ad = Object.assign({}, P.dataOf(P.beAt(m, ac)));
    ad.Album = { list: ad.Album.list.concat([tag(small, '5555555555555555')]) };
    m = P.withBE(m, ac, 'xiaojingyu:photo_album_table', ad);
    const bytes = await V3.share.writePng(m);
    const imp = await HB.importFile(bytes, { file: 'bad.png', force: true }); await V3.waitReady(V3.models.current(), 30000); await HB.live().ready; await V3.photoFrames.whenReady();
    await V3.album.open({}); const st = V3.album.state(), warn = document.querySelector('.alb-msg.warn') && document.querySelector('.alb-msg.warn').textContent;
    const r2 = await V3.album.rename(0, '还能改名');
    const kept = P.albumAt(HB.model, P.albumTables(HB.model)[0].cell);
    V3.album.close();
    return { imp: { ok: imp.ok, notes: imp.check && imp.check.notes, photos: imp.check && imp.check.photos }, info: window.__photoInfo(), st, warn, r2: r2.ok, kept: { n: kept.photos.length, bad: kept.bad } };
  });
  const bw = Bd.info.frames.find((f) => f.kind === 'wall'), bf = Bd.info.frames.find((f) => f.kind === 'frame'), bs = Bd.info.shown.filter((q) => q.kind === 'wall');
  ok(Bd.imp.ok && Bd.imp.notes.some((t) => /照片坏了/.test(t)) && Bd.imp.photos.bad === 5, '导入带坏照片的鲸图：照样换，提一句有几张坏了（' + ((Bd.imp.photos || {}).bad) + ' 张）', Bd.imp);
  ok(bf.ids[0] === null && bw.ids[0] === null && bw.ids[1] === null && bw.ids[4] === null && bw.ids[2] === ids[2] && bw.ids[3] === '4444444444444444' && !bs[3].shown && bs[2].shown,
    '坏照片不画：不是 PNG、64 × 64、超过 48 KB、类型不对的当空；头对但解不开的不贴；好的照样贴', { bw, bf, bs });
  ok(Bd.st.count === 4 && Bd.st.bad === 1 && /网页打不开/.test(Bd.warn || '') && Bd.r2 && Bd.kept.n === 4 && Bd.kept.bad === 1, '相册里的坏照片：不显示、说一句，改别的照片时它原样留着', Bd);

  // 没有相册矮桌：相册说清楚；换照片只能选「空」
  const N0 = await p2.page.evaluate(async () => {
    const A = V3.arrange, P = V3.photos; await A.enter();
    const t = P.albumTables(A.model())[0].cell; A.select(t); A.remove(); await A.whenIdle(); await A.done();
    await V3.album.open({}); const st = V3.album.state(), text = document.querySelector('.alb-card').textContent; V3.album.close();
    const fr = P.frames(V3.houseBlocks.model).find((f) => f.kind === 'wall');
    V3.album.pick({ cell: fr.cell, slot: 2 }); const ps = V3.album.pickState(), ptext = document.querySelector('.alb-pick').textContent;
    const c = await V3.album.choose(null);
    return { st, text, ps, ptext, c: c.ok, ids: P.frames(V3.houseBlocks.model).find((f) => f.kind === 'wall').slots.map((p) => (p ? p.id : null)) };
  });
  ok(N0.st.open && N0.st.noTable && /没有相册矮桌/.test(N0.text) && /加家具/.test(N0.text), '房子里没有相册矮桌：相册里说清楚（在「布置」→「加家具」里放一张）', N0.text);
  ok(N0.ps.open && N0.ps.album === null && N0.ps.tiles === 1 && /16 格以内没有相册矮桌/.test(N0.ptext) && N0.c && N0.ids[2] === null, '没有相册矮桌时换照片：只能选「空」，说清楚为什么', N0.ps);
  const e2 = await pageErrors(p2.page);
  ok(!e2.length && !p2.errs.length, '相册、相框的页面（重开的那页）没有报错', { e2, errs: p2.errs });
  await p2.page.close();

  // 恢复原来的房子：相册空的，小框都是原来的画
  const R = await page.evaluate(async () => { await V3.houseBlocks.restore(); await V3.waitReady(V3.models.current(), 30000); await V3.houseBlocks.live().ready; await V3.photoFrames.whenReady(); return window.__photoInfo(); });
  const rc = await page.evaluate(CELLS, 'model');
  ok(rc === def && R.album.ids.length === 0 && R.frames[0].ids.every((x) => x === null) && R.shown.every((q) => !q.id) && R.bes.join() === D0.bes.join(), '恢复原来的房子：相册空了，画框墙都是原来的小画', R);
  const e1 = await pageErrors(page);
  ok(!e1.length && !errs.length, '相册、相框的页面没有报错', { e1, errs });
  await page.close();
}
