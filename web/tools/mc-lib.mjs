// tools/mc-lib.mjs — mc-render 的测试和工具共用的小函数（只用 Node 内置模块 + 已有的 puppeteer-core）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const inflateRaw = (d) => zlib.inflateRawSync(d);
export const inflateZlib = (d) => zlib.inflateSync(d);

// ---- 浏览器（和 tools/shoot.mjs、test/fb-ui.test.mjs 一样找 Edge、一样的 GPU 参数）----
export function findEdge() {
  const edge = (dir) => dir && path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const cands = [process.env.TOOLKIT_BROWSER, edge(process.env['ProgramFiles(x86)']), edge(process.env.ProgramFiles)];
  return cands.find((p) => p && fs.existsSync(p)) || null;
}
export const GPU = {
  d3d11: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
export const BASE_ARGS = ['--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio'];
export async function launchBrowser({ width = 1280, height = 720, gpu = process.env.MC_GPU || 'd3d11', args = [] } = {}) {
  const require = createRequire(import.meta.url);
  const puppeteer = require('puppeteer-core');
  const exe = findEdge();
  if (!exe) throw new Error('找不到 Microsoft Edge（可以用环境变量 TOOLKIT_BROWSER 指定浏览器）');
  return puppeteer.launch({ executablePath: exe, headless: true, args: [...BASE_ARGS, ...(GPU[gpu] || GPU.d3d11), ...args],
    defaultViewport: { width, height, deviceScaleFactor: 1 }, protocolTimeout: 180000 });
}

// ---- 只认指定路径的小服务器：routes = { '/mcview.html': 文件路径 | Buffer | 对象(当 JSON) } ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jar': 'application/java-archive', '.png': 'image/png', '.js': 'text/javascript' };
export function serveFiles(routes) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(String(req.url || '/').split(/[?#]/)[0]);
      if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
      const r = routes[p];
      if (r == null) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
      const body = Buffer.isBuffer(r) ? r : typeof r === 'string' ? fs.readFileSync(r) : Buffer.from(JSON.stringify(r));
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(body);
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(() => r())) }));
  });
}

// ---- PNG / zip 读写 ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
export const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function encodePng(w, h, rgba) {
  const row = w * 4 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * row + 1);
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE(crc32(td), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let _J = null;
export async function mcjar() {
  if (!_J) { const { loadV3 } = await import('./lib/v3-node.mjs'); _J = loadV3(['14-mcjar']).V3.mcjar; }
  return _J;
}
// → {width, height, data: Uint8Array RGBA}
export async function decodePng(bytes) { return (await mcjar()).decodePng(new Uint8Array(bytes), inflateZlib); }

// entries: [[名字, Buffer | 字符串 | 对象(写成 JSON)]] → zip（deflate）
export function makeZip(entries) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content, null, 1));
    const comp = zlib.deflateRawSync(data), nm = Buffer.from(name, 'utf8'), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
