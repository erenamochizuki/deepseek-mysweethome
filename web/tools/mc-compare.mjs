// tools/mc-compare.mjs — 把网页渲染和 MC 截图放在一起比（开发用，P3 对比）
//   node tools/mc-compare.mjs --run <mod/build/probe-runs/编号> [--out <目录>] [--cards P3-001,P3-002] [--max 3]
//        一次 run-cards 跑完以后离线算：从 results.json 找 P3 卡片的截图和抓下来的鲸图，不用开游戏；默认写到 tmp/mc-render/compare-<编号>/
//   node tools/mc-compare.mjs --card <卡片.yml> --model <鲸图 PNG / .schem / dump JSON / 区域 JSON> --shots <MC 截图目录> --out <目录>
//        [--jar <客户端 jar>|环境变量 MC_JAR] [--fov 77 | --scan 70,74,76,77,78,80] [--mask x,y,w,h;…|none] [--ao 0] [--light 0] [--bright 1]
// 相机从卡片里读：每个 shot 前面最近的一条「tp @s x y z yaw pitch」。--region 是 --model 的旧名字（探针 probe.mjs region 存的 JSON）。
// 只在网页画到的像素（不透明）上算差异；天空、区域外的地面不算。输出：<名字>-web.png、<名字>-side.png（MC | 网页 | 差异）、
// <名字>-worst.png（差得最多的几块放大）、summary.json。用 MC 真贴图做出来的图只能放 tmp/。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openViewer } from './mc-shot.mjs';
import { decodePng, encodePng, WEB_DIR } from './mc-lib.mjs';

// 卡片里的机位：[{name, pos, yaw, pitch}]。和 MC 的 tp 一样：x、z 写成整数（没有小数点）时自动 +0.5（站到方块中间），y 不加。
export function camerasFromCard(text) {
  const out = [];
  let tp = null;
  const center = (t) => (t.includes('.') ? +t : +t + 0.5);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*#.*$/, '');
    let m = line.match(/cmd:\s*"?tp @s (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
    if (m) tp = [center(m[1]), +m[2], center(m[3]), +m[4], +m[5]];
    m = line.match(/shot:\s*\{?\s*name:\s*"?([A-Za-z0-9._-]+)/);
    if (m && tp) out.push({ name: m[1], pos: tp.slice(0, 3), yaw: tp[3], pitch: tp[4] });
  }
  return out;
}

// 探针的截图名是 <name>-yyyyMMdd-HHmmss.png（同一秒再拍是 -2、-3）；取最新的一张
export function findShot(dir, name) {
  const re = new RegExp('^' + name.replace(/\./g, '\\.') + '-\\d{8}-\\d{6}(-\\d+)?\\.png$');
  const f = fs.readdirSync(dir).filter((n) => re.test(n)).sort();
  return f.length ? path.join(dir, f[f.length - 1]) : null;
}

export const camString = (c, fov) => [...c.pos, c.yaw, c.pitch, fov].join(',');

// 差异：只看网页不透明（a=255）且不在遮罩里的像素
export function diff(mc, web, { masks = [], thr = 24, tile = 8, region = 40 } = {}) {
  const W = mc.width, H = mc.height, n = W * H;
  if (web.width !== W || web.height !== H) throw new Error(`尺寸不一样：MC ${W}×${H}，网页 ${web.width}×${web.height}`);
  const cov = new Uint8Array(n), dl = new Float32Array(n);
  const sAbs = [0, 0, 0], sSign = [0, 0, 0], sMc = [0, 0, 0], sWeb = [0, 0, 0];
  let cnt = 0, over = 0;
  const masked = (x, y) => masks.some(([mx, my, mw, mh]) => x >= mx && x < mx + mw && y >= my && y < my + mh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4;
    if (web.data[p + 3] < 255 || masked(x, y)) continue;
    cov[i] = 1; cnt++;
    let mx = 0, s = 0;
    for (let c = 0; c < 3; c++) {
      const a = web.data[p + c], b = mc.data[p + c], d = a - b;
      sAbs[c] += Math.abs(d); sSign[c] += d; sMc[c] += b; sWeb[c] += a;
      s += Math.abs(d); if (Math.abs(d) > mx) mx = Math.abs(d);
    }
    dl[i] = s / 3;
    if (mx > thr) over++;
  }
  const k = Math.max(1, cnt);
  // 小块平均色的差（不怕贴图采样差半个像素）
  let tSum = 0, tN = 0;
  for (let ty = 0; ty + tile <= H; ty += tile) for (let tx = 0; tx + tile <= W; tx += tile) {
    let full = true; const a = [0, 0, 0], b = [0, 0, 0];
    for (let y = ty; y < ty + tile && full; y++) for (let x = tx; x < tx + tile; x++) {
      const i = y * W + x; if (!cov[i]) { full = false; break; }
      for (let c = 0; c < 3; c++) { a[c] += web.data[i * 4 + c]; b[c] += mc.data[i * 4 + c]; }
    }
    if (!full) continue;
    tSum += (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / (3 * tile * tile); tN++;
  }
  // 差得最多的区域（region×region，至少一半像素有覆盖）
  const worst = [];
  for (let ry = 0; ry + region <= H; ry += region / 2) for (let rx = 0; rx + region <= W; rx += region / 2) {
    let s = 0, c = 0;
    for (let y = ry; y < ry + region; y++) for (let x = rx; x < rx + region; x++) { const i = y * W + x; if (cov[i]) { s += dl[i]; c++; } }
    if (c >= region * region / 2) worst.push({ x: rx, y: ry, w: region, h: region, mae: +(s / c).toFixed(1) });
  }
  worst.sort((a, b) => b.mae - a.mae);
  const pick = [];
  for (const r of worst) { if (pick.length >= 8) break; if (!pick.some((q) => Math.abs(q.x - r.x) < region && Math.abs(q.y - r.y) < region)) pick.push(r); }
  const r1 = (v) => +v.toFixed(2);
  return {
    covered: r1(cnt / n * 100), mae: sAbs.map((v) => r1(v / k)), maeAll: r1((sAbs[0] + sAbs[1] + sAbs[2]) / (3 * k)),
    bias: sSign.map((v) => r1(v / k)), gain: sMc.map((v, c) => +(v / Math.max(1, sWeb[c])).toFixed(3)),
    over: r1(over / k * 100), tileMae: r1(tSum / Math.max(1, tN)), tiles: tN, worst: pick, cov, dl,
  };
}

// ---- 拼图 ----
const blank = (w, h, rgb = [20, 24, 40]) => { const d = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) d.set([...rgb, 255], i * 4); return { width: w, height: h, data: d }; };
function down(img, n) {
  const W = Math.floor(img.width / n), H = Math.floor(img.height / n), o = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) s += img.data[((y * n + j) * img.width + x * n + i) * 4 + c];
    o[(y * W + x) * 4 + c] = Math.round(s / (n * n));
  }
  return { width: W, height: H, data: o };
}
function paste(dst, src, ox, oy, sx = 0, sy = 0, w = src.width, h = src.height, zoom = 1) {
  for (let y = 0; y < h * zoom; y++) for (let x = 0; x < w * zoom; x++) {
    const X = ox + x, Y = oy + y; if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) continue;
    const s = ((sy + Math.floor(y / zoom)) * src.width + sx + Math.floor(x / zoom)) * 4;
    dst.data.set(src.data.subarray(s, s + 4), (Y * dst.width + X) * 4);
  }
}
// 网页图：没画到的地方用变暗的 MC 图垫底，方便看位置
function webOverMc(mc, web) {
  const o = { width: mc.width, height: mc.height, data: new Uint8Array(mc.data.length) };
  for (let i = 0; i < mc.width * mc.height; i++) {
    const p = i * 4, a = web.data[p + 3] / 255;
    for (let c = 0; c < 3; c++) o.data[p + c] = Math.round(web.data[p + c] * a + mc.data[p + c] * 0.3 * (1 - a));
    o.data[p + 3] = 255;
  }
  return o;
}
// 差异图：没覆盖 = 深蓝；差 0 = 黑，越大越红再到黄
function heat(d, W, H) {
  const o = blank(W, H);
  for (let i = 0; i < W * H; i++) {
    if (!d.cov[i]) continue;
    const t = Math.min(1, d.dl[i] / 64);
    o.data.set([Math.round(255 * Math.min(1, t * 2)), Math.round(255 * Math.max(0, t * 2 - 1)), 0, 255], i * 4);
  }
  return o;
}
export function sideBySide(mc, web, d) {
  const n = mc.width >= 1000 ? 2 : 1, a = down(mc, n), b = down(webOverMc(mc, web), n), c = down(heat(d, mc.width, mc.height), n);
  const o = blank(a.width * 3 + 8, a.height, [255, 255, 255]);
  paste(o, a, 0, 0); paste(o, b, a.width + 4, 0); paste(o, c, a.width * 2 + 8, 0);
  return o;
}
// 差得最多的几块：MC | 网页，各放大 3 倍
export function worstSheet(mc, web, d, zoom = 3) {
  const R = d.worst.slice(0, 6), cw = (R[0] ? R[0].w : 40) * zoom, ch = (R[0] ? R[0].h : 40) * zoom;
  const o = blank(Math.max(1, 2 * (2 * cw + 6) + 12), Math.max(1, Math.ceil(R.length / 2) * (ch + 6)), [255, 255, 255]);
  const wm = webOverMc(mc, web);
  R.forEach((r, k) => {
    const ox = (k % 2) * (2 * cw + 18), oy = Math.floor(k / 2) * (ch + 6);
    paste(o, mc, ox, oy, r.x, r.y, r.w, r.h, zoom); paste(o, wm, ox + cw + 6, oy, r.x, r.y, r.w, r.h, zoom);
  });
  return o;
}

// 一组机位（一张卡片）：开一次查看页，逐个机位截网页、算差异、写图，返回 summary（也写进 <out>/summary.json）。
// fov 给数字就固定用它；不给就按 scan（默认 70,74,76,77,78,80）找差异最小的。mask：'x,y,w,h;…'，'none' 不遮，默认遮画面中心 24×24（准星）。
export async function compareSet({ jar, model, cams, files, out, fov = null, scan, mask, ao = true, light = true, bright, log = console.log }) {
  fs.mkdirSync(out, { recursive: true });
  const first = files.find(Boolean);
  if (!first) throw new Error('找不到卡片里的任何一张截图：' + cams.map((c) => c.name).join(', '));
  const { width: W0, height: H0 } = await decodePng(fs.readFileSync(first));
  const masks = mask === 'none' ? [] : mask ? mask.split(';').map((s) => s.split(',').map(Number)) : [[W0 / 2 - 12, H0 / 2 - 12, 24, 24]];
  const v = await openViewer({ jar: path.resolve(jar), model: path.resolve(model), cam: camString(cams[0], 77), w: W0, h: H0, ao, light, bright });
  if (v.error) { await v.close(); throw new Error('查看页打不开方块文件：' + v.error); }
  const summary = { pack: v.pack && v.pack.key, model: v.model, stats: v.stats, warnings: v.warnings, errors: v.errors, masks, shots: [] };
  try {
    for (let k = 0; k < cams.length; k++) {
      const c = cams[k], file = files[k];
      if (!file) { summary.shots.push({ name: c.name, missing: true }); log(c.name, '没有这张截图'); continue; }
      const mc = await decodePng(fs.readFileSync(file));
      const render = async (f) => decodePng(await v.snap(camString(c, f)));
      let f0 = fov; const tried = [];
      if (f0 == null) {
        const tryF = async (f) => { const d = diff(mc, await render(f), { masks }); tried.push([f, d.maeAll]); return d.maeAll; };
        for (const f of (scan || '70,74,76,77,78,80').split(',').map(Number)) await tryF(f);
        const best = tried.reduce((p, q) => (q[1] < p[1] ? q : p))[0];
        for (const f of [best - 1, best - 0.5, best + 0.5, best + 1]) if (!tried.some((s) => s[0] === f)) await tryF(f);
        f0 = tried.reduce((p, q) => (q[1] < p[1] ? q : p))[0];
        tried.sort((p, q) => p[0] - q[0]);
      }
      const webPng = await v.snap(camString(c, f0)), web = await decodePng(webPng);
      const d = diff(mc, web, { masks });
      fs.writeFileSync(path.join(out, c.name + '-web.png'), webPng);
      fs.writeFileSync(path.join(out, c.name + '-side.png'), (() => { const s = sideBySide(mc, web, d); return encodePng(s.width, s.height, s.data); })());
      if (d.worst.length) { const s = worstSheet(mc, web, d); fs.writeFileSync(path.join(out, c.name + '-worst.png'), encodePng(s.width, s.height, s.data)); }
      const { cov, dl, ...rest } = d;
      summary.shots.push({ name: c.name, file: path.basename(file), cam: c, fov: f0, scan: tried, ...rest });
      log(c.name, 'fov', f0, 'covered%', rest.covered, 'mae', rest.maeAll, 'tileMae', rest.tileMae, 'over%', rest.over, 'gain', rest.gain.join('/'));
    }
  } finally { await v.close(); }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

// 一次 run-cards 的运行目录（mod/build/probe-runs/<编号>）→ 要比的卡片 [{id, cardFile, model, cams, files, hideGui}]。
// 截图用 results.json 里 shot 步骤记下的副本，鲸图用 expect_file 步骤读过的文件。默认只看 P3-* 卡片。
export function runInputs(runDir, { only } = {}) {
  const REPO = path.resolve(WEB_DIR, '..');
  const res = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
  const items = [];
  for (const c of res.cards || []) {
    if (only ? !only.includes(c.id) : !/^P3-/.test(c.id)) continue;
    const shots = new Map();
    let model = null, hide = true;
    for (const s of c.steps || []) {
      if (s.type === 'shot' && s.result) {
        shots.set(String(s.desc).replace(/^shot\s+/, '').split(/\s+/)[0], s.result.copy || s.result.path);
        if (!/hideGui=true/.test(s.desc)) hide = false;
      }
      if (s.type === 'expect_file' && s.result && /\.(png|schem)$/i.test(s.result.file || '')) model = path.resolve(REPO, s.result.file);
    }
    if (!shots.size || !model) { items.push({ id: c.id, status: c.status, skip: !shots.size ? '这张卡片没有截图' : '没找到抓下来的鲸图（expect_file 没跑到）' }); continue; }
    const cardFile = fs.existsSync(c.file) ? c.file : path.join(REPO, 'mod', 'cards', c.id + '.yml');
    const cams = camerasFromCard(fs.readFileSync(cardFile, 'utf8'));
    const files = cams.map((k) => { const f = shots.get(k.name); return f && fs.existsSync(f) ? f : findShot(path.join(runDir, 'shots'), k.name); });
    items.push({ id: c.id, status: c.status, cardFile, model, cams, files, hideGui: hide });
  }
  return { results: res, items };
}

// ---- 命令行 ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const USAGE = [
    '用法：',
    '  node tools/mc-compare.mjs --run <mod/build/probe-runs/编号> [--out <目录>] [--cards P3-001,P3-002] [--max 3]',
    '  node tools/mc-compare.mjs --card <卡片.yml> --model <鲸图.png|.schem|dump.json|区域.json> --shots <截图目录> --out <目录>',
    '共同的：[--jar <客户端 jar>|环境变量 MC_JAR] [--fov 77 | --scan 70,74,77,80] [--only A,B] [--mask x,y,w,h;…|none] [--ao 0] [--light 0] [--bright 1]',
  ].join('\n');
  const jar = arg('jar') || process.env.MC_JAR;
  const opts = { scan: arg('scan'), mask: arg('mask'), ao: arg('ao') !== '0', light: arg('light') !== '0', bright: arg('bright') };
  const pick = (cams, files) => {
    if (!arg('only')) return [cams, files];
    const set = new Set(arg('only').split(','));
    const k = cams.map((c, i) => i).filter((i) => set.has(cams[i].name) || set.has(cams[i].name.split('-').pop()));
    return [k.map((i) => cams[i]), k.map((i) => files[i])];
  };
  if (!jar || !fs.existsSync(jar)) { console.error('缺少 --jar（或环境变量 MC_JAR）：MC 客户端 jar，只读。\n' + USAGE); process.exit(2); }
  if (arg('run')) {
    // 整次运行：results.json 里的 P3 卡片 → 每张卡片一个子目录 + 总的 summary.json；默认视野 77（旁观飞行时 70×1.1）
    const runDir = path.resolve(arg('run')), runId = path.basename(runDir), REPO = path.resolve(WEB_DIR, '..');
    const out = path.resolve(arg('out') || path.join(REPO, 'tmp', 'mc-render', 'compare-' + runId));
    const { items } = runInputs(runDir, { only: arg('cards') ? arg('cards').split(',') : null });
    const max = arg('max') != null ? +arg('max') : null;
    const fov = arg('scan') ? null : arg('fov') ? +arg('fov') : 77;
    const all = { run: runId, runDir: path.relative(REPO, runDir), jar: path.basename(jar), fov, max, cards: [] };
    let bad = 0;
    const t0 = Date.now();
    if (!items.length) { console.error('这次运行里没有 P3 卡片：' + runDir); process.exit(1); }
    for (const it of items) {
      if (it.skip) { console.log(it.id, '跳过：' + it.skip); all.cards.push({ id: it.id, status: it.status, skip: it.skip }); bad++; continue; }
      const [cams, files] = pick(it.cams, it.files);
      console.log('== ' + it.id + '（' + path.basename(it.model) + '，' + cams.length + ' 个机位）');
      const s = await compareSet({ jar, model: it.model, cams, files, out: path.join(out, it.id), fov, ...opts, mask: opts.mask || (it.hideGui ? 'none' : undefined) });
      const shots = s.shots.map((x) => ({ name: x.name, missing: !!x.missing, fov: x.fov, covered: x.covered, mae: x.maeAll, tileMae: x.tileMae, over: x.over,
        pass: x.missing ? false : max == null ? null : x.tileMae <= max }));
      for (const x of shots) if (x.pass === false) bad++;
      all.cards.push({ id: it.id, status: it.status, model: path.relative(REPO, it.model), hideGui: it.hideGui, out: path.relative(REPO, path.join(out, it.id)),
        warnings: (s.warnings || []).length, stats: s.stats, shots });
    }
    all.seconds = Math.round((Date.now() - t0) / 100) / 10;
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(all, null, 2));
    console.log('\n机位            tileMae     mae  covered%' + (max != null ? '  结果（tileMae ≤ ' + max + '）' : ''));
    for (const c of all.cards) for (const x of c.shots || []) {
      console.log(x.name.padEnd(14), String(x.tileMae ?? '-').padStart(8), String(x.mae ?? '-').padStart(7), String(x.covered ?? '-').padStart(9), x.pass == null ? '' : x.pass ? '  PASS' : '  FAIL');
    }
    console.log('用时 ' + all.seconds + ' 秒；写好了：' + path.join(out, 'summary.json'));
    process.exit(max != null && bad ? 1 : 0);
  }
  // 单张卡片：自己给卡片、鲸图、截图目录；不给 --fov 就扫视野
  const modelArg = arg('model') || arg('region');
  const need = ['card', 'shots', 'out'].filter((k) => !arg(k)).concat(modelArg ? [] : ['model']);
  if (need.length) { console.error('缺少参数：' + need.map((k) => '--' + k).join(' ') + '\n' + USAGE); process.exit(2); }
  const cams0 = camerasFromCard(fs.readFileSync(arg('card'), 'utf8'));
  const [cams, files] = pick(cams0, cams0.map((c) => findShot(arg('shots'), c.name)));
  const out = path.resolve(arg('out'));
  try {
    await compareSet({ jar, model: modelArg, cams, files, out, fov: arg('fov') ? +arg('fov') : null, ...opts });
  } catch (e) { console.error(e.message); process.exit(1); }
  console.log('写好了：' + path.join(out, 'summary.json'));
}
