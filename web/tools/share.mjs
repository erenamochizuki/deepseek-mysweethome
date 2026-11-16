#!/usr/bin/env node
// share.mjs — 鲸图（分享 PNG / .schem）命令行工具 + 两边共用的样例生成器
//
// 用法（在 web/ 目录下）：
//   node tools/share.mjs info <文件>                    看文件里有什么（PNG 块、尺寸、调色板、警告…）
//   node tools/share.mjs dump <文件>                    打印 dump JSON（docs/FORMAT.md 第 4 节）；读不了时打印 {"error":…} 并退出 1
//   node tools/share.mjs extract <png> <out.schem>      把鲸图里的 .schem 原样取出来
//   node tools/share.mjs wrap <schem> <out.png> [图片]  把 .schem 原样塞进图片（不给图就用 16×16 纯色图）
//   node tools/share.mjs make-fixtures                  生成 fixtures/share/ 下的 cases/、js/、odd/
//   node tools/share.mjs check-fixtures                 在内存里重新生成一遍，和提交的逐字节比
//   node tools/share.mjs list                           列出所有样例（Markdown 表格）
//
// 「标准答案」cases/*.json 直接从 lib/share-cases.mjs 里定义的模型算出来（自己数调色板、自己做游程），
// 不经过 web/src/13-share.js 的读取器；odd/ 的文件用 lib/share-raw.mjs 自己的小 NBT / gzip / PNG 编码器拼
// （lib/share-odd.mjs，可以故意拼错）。这样读取器不能「自己证明自己」。js/*.png 用真正的写入器（13-share.js）写。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadV3, WEB_DIR } from './lib/v3-node.mjs';
import { formatJSON } from './lib/share-raw.mjs';
import { CASES, caseDump } from './lib/share-cases.mjs';
import { ODD } from './lib/share-odd.mjs';

export { CASES, caseDump, ODD, formatJSON };

export const REPO_DIR = path.resolve(WEB_DIR, '..');
export const FIXTURE_DIR = path.join(REPO_DIR, 'fixtures', 'share');
const SUBDIRS = ['cases', 'js', 'odd'];

let v3 = null;
export function share() {
  if (!v3) v3 = loadV3(['12-nbt', '13-share']).V3;
  return v3.share;
}

// ======================================================================
// 生成 / 检查 fixtures/share/{cases,js,odd}/（java/ 由 fmt-java 的 Gradle 任务生成，这里不碰）
// ======================================================================

// 返回 Map(相对路径 → Buffer)，不写盘
export async function buildFixtures() {
  const S = share();
  const files = new Map();
  for (const c of CASES) {
    const d = caseDump(c.name);
    files.set(`cases/${c.name}.json`, Buffer.from(formatJSON(d), 'utf8'));
    files.set(`js/${c.name}.png`, Buffer.from(await S.writePng(S.fromDump(d))));
  }
  for (const o of ODD) {
    if (o.file.replace(/\.(png|schem)$/, '') !== o.name) throw new Error('odd 文件名和名字对不上：' + o.file);
    files.set(`odd/${o.file}`, Buffer.from(o.bytes()));
    files.set(`odd/${o.name}.expect.json`, Buffer.from(formatJSON(o.expect), 'utf8'));
  }
  return files;
}

const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

// 第一个不一样的位置（JSON 值比较，键的顺序不算）
export function diffJSON(a, b, at = '$') {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return at;
  if (a === null || typeof a !== 'object') return a === b ? null : at;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${at}（长度 ${a.length} ≠ ${b.length}）`;
    for (let i = 0; i < a.length; i++) { const d = diffJSON(a[i], b[i], `${at}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join('\u0001') !== kb.join('\u0001')) return `${at}（键不同：${ka} ≠ ${kb}）`;
  for (const k of ka) { const d = diffJSON(a[k], b[k], `${at}.${k}`); if (d) return d; }
  return null;
}

async function explain(rel, have, want) {
  if (rel.endsWith('.json')) {
    try { return `${rel}：内容不同，第一处在 ${diffJSON(JSON.parse(have), JSON.parse(want)) ?? '（只是排版不同）'}`; }
    catch { return `${rel}：不是合法的 JSON`; }
  }
  if (rel.startsWith('js/')) {
    const S = share();
    try {
      const same = S.equalDump(S.dump(await S.read(have)), S.dump(await S.read(want)));
      return same ? `${rel}：字节不同，但读出来的 dump 一样（多半是 Node 的 zlib 变了；确认后重新 make-fixtures 并提交）`
        : `${rel}：字节不同，读出来的 dump 也不同`;
    } catch (e) { return `${rel}：字节不同，提交的文件读不了（${e.code || e.message}）`; }
  }
  return `${rel}：字节不同`;
}

export async function checkFixtures(dir = FIXTURE_DIR) {
  const want = await buildFixtures();
  const problems = [];
  for (const [rel, buf] of want) {
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) { problems.push(`${rel}：缺这个文件`); continue; }
    const have = rel.endsWith('.json') ? lf(fs.readFileSync(p)) : fs.readFileSync(p);
    if (!have.equals(buf)) problems.push(await explain(rel, have, buf));
  }
  for (const sub of SUBDIRS) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).sort()) {
      if (!want.has(`${sub}/${f}`)) problems.push(`${sub}/${f}：生成器里没有这个文件（多余）`);
    }
  }
  return { files: want.size, problems };
}

export async function makeFixtures(dir = FIXTURE_DIR) {
  const want = await buildFixtures();
  let written = 0, same = 0;
  for (const [rel, buf] of want) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p) && fs.readFileSync(p).equals(buf)) { same++; continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
    written++;
  }
  const extra = [];
  for (const sub of SUBDIRS) {
    const d = path.join(dir, sub);
    for (const f of fs.readdirSync(d).sort()) if (!want.has(`${sub}/${f}`)) extra.push(`${sub}/${f}`);
  }
  return { written, same, extra };
}

// ======================================================================
// 命令行
// ======================================================================

async function cmdInfo(file) {
  const S = share();
  const bytes = fs.readFileSync(file);
  console.log(`文件：${file}（${bytes.length} 字节）`);
  if (S.png.isPng(bytes)) {
    try {
      const list = S.png.chunks(bytes, { crc: true });
      console.log('PNG 块：' + list.map((c) => `${c.type}(${c.length}${c.crcOk === false ? '，CRC 错' : ''})`).join(' '));
    } catch (e) { console.log('PNG 块：读不完（' + (e.detail || e.message) + '）'); }
  } else if (bytes[0] === 0x1f && bytes[1] === 0x8b) console.log('类型：裸 .schem（gzip）');
  else console.log('类型：认不出来');
  const d = S.dump(await S.read(bytes));   // 读不了会抛 ShareError，交给 main
  console.log(`尺寸：${d.size.join('×')}  Offset：${d.offset.join(',')}  DataVersion：${d.dataVersion}`);
  console.log(`调色板：${d.palette.length} 种  方块实体：${d.blockEntities.length} 个  游程：${d.cells.length} 段`);
  console.log('调色板前几项：' + d.palette.slice(0, 5).join('  '));
  const m = d.meta && d.meta.compound;
  if (m) {
    const s = (k) => (m[k] && typeof m[k].string === 'string' ? m[k].string : '（没有）');
    console.log(`名字：${s('Name')}  作者：${s('Author')}  RequiredMods：${m.RequiredMods ? JSON.stringify(m.RequiredMods) : '（没有）'}`);
  } else console.log('Metadata：没有');
  console.log('警告：' + (d.warnings.length ? d.warnings.join(', ') : '没有'));
}

async function cmdDump(file) {
  const S = share();
  try {
    process.stdout.write(formatJSON(S.dump(await S.read(fs.readFileSync(file)))));
  } catch (e) {
    if (!(e instanceof S.ShareError)) throw e;
    process.stdout.write(formatJSON({ error: e.code, message: e.message, detail: e.detail ?? null }));
    process.exitCode = 1;
  }
}

async function cmdWrap(schemFile, out, image) {
  const S = share();
  const schem = fs.readFileSync(schemFile);
  if (schem.length > S.LIMITS.chunk) throw new S.ShareError('too_large', `.schem 有 ${schem.length} 字节，超过 16 MiB`);
  await S.readSchem(schem);   // 先确认读得了；塞进去的是原字节，不重写
  const base = image ? fs.readFileSync(image) : S.png.solid(16, 16);
  fs.writeFileSync(out, S.png.setChunk(base, S.CHUNK_TYPE, schem));
  console.log(`已写出 ${out}`);
}

async function cmdList() {
  console.log('| case | 尺寸 | 调色板 | 方块实体 | 测什么 |\n|---|---|---|---|---|');
  for (const c of CASES) {
    console.log(`| ${c.name} | ${c.size.join('×')} | ${caseDump(c.name).palette.length} | ${c.blockEntities.length} | ${c.purpose} |`);
  }
  console.log('\n| 文件 | 期望 | 测什么 |\n|---|---|---|');
  for (const o of ODD) console.log(`| ${o.file} | ${o.expect.error || '能读（dump）'} | ${o.purpose} |`);
}

const USAGE = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 11)
  .map((l) => l.replace(/^\/\/ ?/, '')).join('\n');

async function main(argv) {
  const [cmd, a, b, c] = argv;
  const need = (n) => { if (argv.length - 1 < n) { console.error(USAGE); process.exit(2); } };
  switch (cmd) {
    case 'info': need(1); return cmdInfo(a);
    case 'dump': need(1); return cmdDump(a);
    case 'extract': {
      need(2);
      const schem = share().extract(fs.readFileSync(a));
      fs.writeFileSync(b, schem);
      console.log(`已写出 ${b}（${schem.length} 字节）`);
      return undefined;
    }
    case 'wrap': need(2); return cmdWrap(a, b, c);
    case 'make-fixtures': {
      const r = await makeFixtures();
      console.log(`fixtures/share：写了 ${r.written} 个，没变 ${r.same} 个`);
      for (const f of r.extra) console.log(`  多余（生成器里没有，要不要删请人看）：${f}`);
      return undefined;
    }
    case 'check-fixtures': {
      const r = await checkFixtures();
      for (const p of r.problems) console.log('  ' + p);
      console.log(r.problems.length ? `FAIL  ${r.problems.length} 处不一致（共 ${r.files} 个文件）` : `PASS  ${r.files} 个文件和提交的一样`);
      if (r.problems.length) process.exitCode = 1;
      return undefined;
    }
    case 'list': return cmdList();
    default: console.error(USAGE); process.exit(2);
  }
  return undefined;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main(process.argv.slice(2)).catch((e) => {
    if (e && e.code && share().MESSAGES[e.code]) {
      console.error(`读不了：${e.code}\n${e.message}${e.detail ? '\n（' + e.detail + '）' : ''}`);
      process.exit(1);
    }
    console.error(e && e.stack ? e.stack : e);
    process.exit(2);
  });
}
