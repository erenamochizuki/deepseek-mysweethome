// build.mjs — v3 single-file page builder (node built-ins only).
// node build.mjs [page ...]  -> dist/<page>.html  (three + src/NN-*.js inlined, works from file://)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { packShore } from './tools/lib/shore-blockbench.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = process.env.CABIN_BUILD_DIR ? path.resolve(process.env.CABIN_BUILD_DIR) : path.join(ROOT, 'dist');
const THREE_JS = path.join(ROOT, 'vendor', 'three.min.js');
const ASSETS = path.join(ROOT, 'assets');
// --no-builtin-girl 只排除本机可选的第三方角色。可爱小鲸鱼随所有游戏和工作台页面分发。
// 兼容原有构建命令的 --no-builtin-girl 参数。

// Binary assets: every file under assets/ is inlined as base64 → window.__V3_ASSETS['girl/x.zip'] (decode in the page).
// 模组「小鲸鱼之家」自己的方块资源（家具的 blockstates / models / textures / items，P5 起）→ __V3_ASSETS['mcpack.json.gz']（见 modPackBlob）。
// 54-house-mc 把它们做成一个资源包，和玩家选的 MC jar 合在一起画（没选 jar 时原版方块用近似颜色，家具照样用自己的模型）。
const MOD_ASSETS = path.join(ROOT, '..', 'mod', 'src', 'main', 'resources', 'assets', 'xiaojingyu');
function modPackFiles() {
  const out = [];
  for (const sub of ['blockstates', 'models', 'textures', 'items']) {
    const dir = path.join(MOD_ASSETS, sub);
    for (const f of assetFiles(dir, 'mcpack/assets/xiaojingyu/' + sub)) out.push(f);
  }
  return out;
}
// 打成一个 gzip 包（__V3_ASSETS['mcpack.json.gz']）：{ 路径: {t: 文本} | {b: base64} }。模型 JSON 很占地方（25 件约 1.7 MB），
// 压完只剩一小块；页面里 54-house-mc 用 DecompressionStream 解开。gzip 头里时间是 0，同样的文件打出来字节一样
function modPackBlob() {
  const files = modPackFiles();
  if (!files.length) return [];
  const obj = {};
  for (const f of files) {
    const p = f.name.slice('mcpack/'.length);
    obj[p] = /\.json$/.test(p) ? { t: JSON.stringify(JSON.parse(f.bytes.toString('utf8'))) } : { b: f.bytes.toString('base64') };
  }
  return [{ name: 'mcpack.json.gz', bytes: zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 }) }];
}
function assetFiles(dir = ASSETS, rel = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const fp = path.join(dir, f), r = rel ? rel + '/' + f : f;
    if (fs.statSync(fp).isDirectory()) out.push(...assetFiles(fp, r));
    else out.push({ name: r, bytes: fs.readFileSync(fp) });
  }
  return out;
}

// Shared modules = every src file numbered < 90. Files 90-99 are page entries.
export const PAGES = {
  studio: { title: '小鲸鱼工作台 · v4', entries: ['90-studio.js'] },
  // the game page: feedback tool off unless ?fb=1 (pre runs before every module)
  cabin: { title: '海边小屋 · v4', entries: ['91-cabin.js'], exclude: /^46-/, pre: "window.__V3_NO_FB=!/[?&]fb=1(&|$)/.test(location.search);" },
  // 小鲸鱼之家：只能玩的游戏页（成品「小鲸鱼之家」文件夹用）。同一个游戏入口，但不带反馈工具（70–79）、
  // 方块房子的生成器和工作台草图模型（42、43：游戏页的房子直接读内嵌的鲸图 assets/house/house-v4.png）。
  // 画 MC 方块的模块（14–19）从 2026-11-06 起要带：游戏里的房子是 MC 方块（54-house-mc）
  home: { title: '小鲸鱼之家', entries: ['91-cabin.js'], pre: 'window.__V3_NO_FB=true;window.__V3_PLAY=true;',
    exclude: /^(4[236]-|7\d-)/ },
  // 开发用：读玩家自己的 MC jar，按方块模型画方块（mc-render）。只带 00、01、10–19，不内嵌 assets/
  mcview: { title: 'MC 方块查看 · v4', entries: ['92-mcview.js'], pre: 'window.__V3_NO_FB=true;', assets: false,
    exclude: /^(0[2-9]-|[2-8]\d-)/ },
};

const num = f => parseInt(f, 10);
const esc = s => s.replace(/<\/(script|style)/gi, '<\\/$1');

function srcFiles() {
  if (!fs.existsSync(SRC)) return [];
  return fs.readdirSync(SRC).filter(f => /^\d\d-[^.]+\.(js|css)$/.test(f)).sort();
}

function syntaxCheck(file, code) {
  try { new vm.Script(code, { filename: file }); return null; }
  catch (e) { return (e.stack || String(e)).split('\n').slice(0, 5).join('\n'); }
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function build(page) {
  const P = PAGES[page];
  if (!P) throw new Error(`unknown page "${page}" (have: ${Object.keys(PAGES).join(', ')})`);
  const files = srcFiles();
  const entryCss = P.entries.map(e => e.replace(/\.js$/, '.css'));
  const keep = f => !(P.exclude && P.exclude.test(f));
  const js = [...files.filter(f => f.endsWith('.js') && num(f) < 90 && keep(f)), ...P.entries];
  const css = files.filter(f => f.endsWith('.css') && (num(f) < 90 || entryCss.includes(f)) && keep(f));
  const errors = [];
  const parts = [];
  for (const f of js) {
    const fp = path.join(SRC, f);
    if (!fs.existsSync(fp)) { errors.push(`${f}: missing`); continue; }
    const code = fs.readFileSync(fp, 'utf8');
    const err = syntaxCheck(f, code);
    if (err) { errors.push(err); continue; }      // skip broken module, keep the page alive
    parts.push({ f, code });
  }
  const cssText = css.map(f => `/* ${f} */\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  const three = fs.readFileSync(THREE_JS, 'utf8');
  // 私有测试素材留在本机，普通构建和发布构建都只嵌入这两个角色。
  const characterFiles = new Set(['characters/Blue-Whale-Maid-Twin.zip', 'characters/Blue-Whale-Maid-Loose.zip']);
  const includeAsset = (a) => !/^(girl|characters)\//.test(a.name) || characterFiles.has(a.name);
  const assets = P.assets === false ? [] : assetFiles().filter(includeAsset).concat(modPackBlob());
  const h = crypto.createHash('sha1');
  const shoreModels = P.assets === false ? '' : JSON.stringify(packShore());
  h.update(shoreModels);
  for (const p of parts) h.update(p.f).update(p.code);
  h.update(cssText);
  for (const a of assets) h.update(a.name).update(a.bytes);
  const id = `v3-${stamp()}-${h.digest('hex').slice(0, 7)}`;
  const boot = `window.__V3_BUILD=${JSON.stringify(id)};window.__V3_PAGE=${JSON.stringify(page)};` +
    `window.__V3_MODULES=${JSON.stringify(parts.map(p => p.f))};` + (P.pre || '');
  const html = [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">',
    `<title>${P.title}</title>`,
    `<style>\n${esc(cssText)}\n</style>`,
    '</head><body>',
    `<script>${boot}</script>`,
    ...(shoreModels ? [`<script>window.__V3_SHORE_MODELS=${esc(shoreModels)};</script>`] : []),
    ...(assets.length ? [`<script>/* assets/ (base64) */\nwindow.__V3_ASSETS={${assets.map(a => JSON.stringify(a.name) + ':"' + a.bytes.toString('base64') + '"').join(',\n')}};\n</script>`] : []),
    `<script>/* three.min.js r152 */\n${esc(three)}\n</script>`,
    ...parts.map(p => `<script>/* ${p.f} */\n${esc(p.code)}\n</script>`),
    '</body></html>', '',
  ].join('\n');
  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, `${page}.html`);
  fs.writeFileSync(out, html);
  fs.writeFileSync(path.join(DIST, 'build.json'), JSON.stringify({ build: id, page, builtinGirl: false, at: new Date().toISOString() }, null, 1));
  const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
  console.log(`wrote dist/${page}.html ${mb} MB modules=${parts.length} css=${css.length} syntaxErrors=${errors.length} build=${id}`);
  for (const e of errors) console.log('  ✗ ' + e.replace(/\n/g, '\n    '));
  return { out, id, errors };
}

// dist/inventory-rules.mjs：收藏存档规则（src/58-inventory-rules.js）+ 当前的目录（贝壳、潮汐拾物、垃圾、零食），给本机小屋服务 import。
// 页面和服务端用同一份规则，见 docs/INVENTORY-V2.md。目录从源码里读出来（在 Node 里跑一遍那几个模块），不手抄。
export async function buildRules() {
  const { loadV3 } = await import('./tools/lib/v3-node.mjs');
  const mods = ['03-vox', '30-shells', '31-moon-treasures', '31-washup-catalog', '58-inventory-rules'].concat(fs.existsSync(path.join(SRC, '32-snack-catalog.js')) ? ['32-snack-catalog'] : []);
  const { V3 } = loadV3(mods, { three: 'real' });
  const kinds = [...V3.shells.KINDS, ...V3.washupCatalog.collectibles, ...V3.washupCatalog.trash, ...V3.washupCatalog.seeds]
    .map((k) => ({ id: k.id, name: k.name, rarity: k.rarity, size: k.size, category: k.category || 'collectible', decoratable: V3.inventoryRules.decoratable(k), chimeable: V3.inventoryRules.chimeable(k) }));
  const snacks = V3.snackCatalog ? V3.snackCatalog.list.map((s) => ({ sku: s.sku, name: s.name, pack: s.pack, count: s.count, price: s.price })) : [];
  const code = fs.readFileSync(path.join(SRC, '58-inventory-rules.js'), 'utf8');
  const err = syntaxCheck('58-inventory-rules.js', code);
  if (err) throw new Error(err);
  const names = ['VERSION', 'FORMAT', 'FORMAT_V1', 'TRAY', 'CHIME_SLOTS', 'decoratable', 'chimeable', 'PATTERNS', 'PRICE', 'TRASH_COIN', 'CROWN', 'InventoryError', 'catalogFrom', 'sizeRange',
    'sizeT', 'crown', 'rollSize', 'rollPattern', 'seededTraits', 'parseInventory', 'parseCommand', 'apply', 'parseState', 'freshState',
    'usedUids', 'available', 'isEmpty', 'isV1', 'exportData', 'isBackup', 'gardenZone', 'gardenDay', 'gardenStage', 'gardenReady', 'GARDEN_DAYS'];
  const out = [
    '// dist/inventory-rules.mjs — 由 web/build.mjs 从 web/src/58-inventory-rules.js 生成，别手改。用法见 docs/INVENTORY-V2.md。',
    `// build ${stamp()}`,
    'const __root = {};',
    '(function (window, globalThis) {', code, '})(__root, __root);',
    'const R = __root.__cabinInventoryRules;',
    `export const CATALOG = ${JSON.stringify({ kinds, snacks }, null, 1)};`,
    '// 规则要用的目录（尺寸区间、卖价、零食价格）；服务端 parseCommand / apply / parseState 都传 { catalog }',
    'export const catalog = R.catalogFrom(CATALOG.kinds, CATALOG.snacks);',
    `export const { ${names.join(', ')} } = R;`,
    'export default R;', '',
    '// Use the same bounded NBT and schematic readers as the game for full-save imports.',
    'const archive = { err() {} };',
    '(function (window) {',
    ...['12-nbt.js', '13-share.js', '29-ysm.js'].map(file => fs.readFileSync(path.join(SRC, file), 'utf8')),
    '})({ V3: archive });',
    'export async function validateHouseArchive(bytes) { await archive.share.read(bytes); }',
    'export function validateModelArchive(files) { archive.ysm.load(files); }',
  ].join('\n');
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'inventory-rules.mjs'), out);
  console.log(`wrote dist/inventory-rules.mjs kinds=${kinds.length} snacks=${snacks.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pages = process.argv.slice(2).filter(a => !a.startsWith('-'));
  let bad = 0;
  for (const p of pages.length ? pages : Object.keys(PAGES)) {
    try { bad += build(p).errors.length; } catch (e) { console.error(String(e.message || e)); bad++; }
  }
  // 游戏页（有收藏的那两页）一起出规则模块
  if (!pages.length || pages.some((p) => p === 'cabin' || p === 'home')) {
    try { await buildRules(); } catch (e) { console.error('inventory-rules.mjs: ' + String(e.message || e)); bad++; }
  }
  process.exit(bad ? 1 : 0);
}
