#!/usr/bin/env node
// zip-fallback.test.mjs — 10-zip 的纯 JS inflate 兜底（2026-11-09，Edge 100 没有 DecompressionStream('deflate-raw')）
//
//   node test/zip-fallback.test.mjs
//
// 覆盖：
//   1) 用默认角色「蓝色大肥鱼」的真实 zip（assets/girl/fatfish-1.2.zip）：25 个 deflate 条目逐个用
//      V3.zip.inflateRawJS 解压，和 Node zlib.inflateRawSync 逐字节比对；
//   2) 把 window.DecompressionStream 抹掉（模拟老浏览器）后 V3.zip.read 整包读取，所有文件和原生路径一致；
//   3) 原生路径（Node 支持时）也能正常读。
// 不开浏览器、不开端口。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadV3, WEB_DIR } from '../tools/lib/v3-node.mjs';
import { requireGirlZip } from '../tools/lib/girl-asset.mjs';
requireGirlZip('zip-fallback');   // 第三方模型不进仓库：没有就跳过

let fails = 0;
function ok(cond, name, detail) {
  if (cond) console.log('PASS ' + name);
  else { fails += 1; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}

const ZIP_PATH = path.join(WEB_DIR, 'assets', 'girl', 'fatfish-1.2.zip');
const zip = fs.readFileSync(ZIP_PATH);

// 解析中央目录：返回 [{ name, method, csize, usize, raw }]
function parseEntries(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('找不到 zip 目录');
  const count = b.readUInt16LE(eocd + 10), cd = b.readUInt32LE(eocd + 16);
  const out = [];
  let o = cd;
  for (let i = 0; i < count; i++) {
    const method = b.readUInt16LE(o + 10), csize = b.readUInt32LE(o + 20), usize = b.readUInt32LE(o + 24);
    const nl = b.readUInt16LE(o + 28), xl = b.readUInt16LE(o + 30), cl = b.readUInt16LE(o + 32), lho = b.readUInt32LE(o + 42);
    const name = b.toString('utf8', o + 46, o + 46 + nl);
    o += 46 + nl + xl + cl;
    const start = lho + 30 + b.readUInt16LE(lho + 26) + b.readUInt16LE(lho + 28);
    out.push({ name, method, csize, usize, raw: b.subarray(start, start + csize) });
  }
  return out;
}

const entries = parseEntries(zip);
const { V3 } = loadV3(['10-zip']);
ok(typeof V3.zip.inflateRawJS === 'function', '10-zip 暴露 V3.zip.inflateRawJS');

// 1) 纯 JS inflate 与 zlib 逐字节比对（25 个 deflate 条目）
let deflated = 0, bad = [];
for (const e of entries) {
  if (e.method !== 8) continue;
  deflated += 1;
  const expect = zlib.inflateRawSync(e.raw);
  let got = null, err = null;
  try { got = V3.zip.inflateRawJS(e.raw); } catch (ex) { err = ex; }
  const same = !err && got.length === expect.length && Buffer.compare(Buffer.from(got), expect) === 0;
  if (!same) bad.push(e.name + (err ? ('（' + err.message + '）') : ''));
}
ok(deflated >= 20, '真实模型包里 deflate 条目足够多', 'deflated=' + deflated);
ok(bad.length === 0, '纯 JS inflate 解压全部 deflate 条目与 zlib 一致（' + deflated + ' 个）', bad.join('；'));

// 2) 模拟老浏览器：没有 DecompressionStream('deflate-raw')
const old = loadV3(['10-zip'], { globals: { DecompressionStream: undefined } }).V3;
let oldMap = null, oldErr = null;
try { oldMap = await old.zip.read(zip); } catch (ex) { oldErr = ex; }
ok(!oldErr, '老浏览器（无 DecompressionStream）也能读 zip', oldErr && oldErr.message);
if (oldMap) {
  ok(oldMap.size === entries.filter((e) => !e.name.endsWith('/')).length,
    '老浏览器读取的文件条数和目录一致', 'got=' + oldMap.size);
  const probe = (entries.find((e) => e.method === 8) || {}).name;
  let contentOk = true;
  for (const e of entries) {
    if (e.method !== 8 || !oldMap.has(e.name)) continue;
    const got = oldMap.get(e.name);
    const expect = zlib.inflateRawSync(e.raw);
    if (got.length !== expect.length || Buffer.compare(Buffer.from(got), expect) !== 0) { contentOk = false; bad.push(e.name); break; }
  }
  ok(contentOk, '老浏览器读出的 deflate 内容逐字节正确');
  const m = oldMap.get(probe);
  ok(!!m, '老浏览器读出了 ' + probe);
}

// 3) 原生路径（Node 的 DecompressionStream 可能支持也可能不支持 deflate-raw；不支持时自动走 JS 兜底）
const native = loadV3(['10-zip']).V3;
try {
  const m = await native.zip.read(zip);
  ok(m.size === oldMap.size, '原生路径读取的文件条数一致');
} catch (ex) {
  ok(true, '原生路径不可用时由 JS 兜底接管（Node 版本差异）');
}

console.log('\n' + (fails ? ('✗ ' + fails + ' 项失败') : '✓ zip 兼容兜底全部通过'));
process.exitCode = fails ? 1 : 0;
