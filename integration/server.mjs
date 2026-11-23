// 海边小屋本地服务（T1）
// Node >= 24，只用内置模块，零第三方依赖。
// 监听 127.0.0.1:5194（可用 --port 改端口）：
//   - 静态服务 web/（防目录穿越）
//   - GET / -> home.html，/cabin.html、/studio.html
//   - home.html / cabin.html 在 </body> 前注入 cabin-bridge 的 css/js 引用
//   - GET /api/cabin/health：本机健康 + 探测 3100（带控制台令牌请求 /api/status）
//   - GET/POST /api/cabin/inventory：本机持久收集，状态不在 web/ 下
//   - GET /api/cabin/assistant-summary：QQ 助手使用的精简只读快照
//   - 其他 /api/cabin/*：反向代理到 http://127.0.0.1:3100
//     删 Origin 头；从 surfcore/state/console-token 读令牌加 x-console-token 头。
//     令牌只在服务端使用：不写日志、不发给浏览器。
// 关闭：SIGINT / SIGTERM 正常退出。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInventoryHandler } from './cabin-inventory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(process.env.CABIN_WEB_ROOT || path.join(__dirname, '..', 'web', 'dist'));
const BRIDGE_ASSETS = path.join(__dirname, 'web');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 5194;
const BRIDGE_HOST = '127.0.0.1';
// 默认 3100；仅调试时可设 CABIN_BRIDGE_PORT 指向别的端口（用于验证 503 降级）。
const BRIDGE_PORT = Number.parseInt(process.env.CABIN_BRIDGE_PORT || '', 10) || 3100;
const PROXY_TIMEOUT_MS = 70000;

// 桥接控制台令牌：consoleToken 未配置时桥接会自动生成并持久化到这里（单行字符串）。
// 只在本进程读用；不要打印、不要返回给浏览器。
// 通过 CABIN_CONSOLE_TOKEN_FILE 显式接入本机桥接。
const CONSOLE_TOKEN_FILE = process.env.CABIN_CONSOLE_TOKEN_FILE;
const tokenCache = { mtimeMs: -1, size: -1, value: null };

function getConsoleToken() {
  try {
    if (!CONSOLE_TOKEN_FILE) return null;
    const st = fs.statSync(CONSOLE_TOKEN_FILE);
    if (tokenCache.mtimeMs === st.mtimeMs && tokenCache.size === st.size) return tokenCache.value;
    const raw = fs.readFileSync(CONSOLE_TOKEN_FILE, 'utf8').trim();
    tokenCache.value = raw.length ? raw : null;
    tokenCache.mtimeMs = st.mtimeMs;
    tokenCache.size = st.size;
    return tokenCache.value;
  } catch {
    tokenCache.value = null;
    tokenCache.mtimeMs = -1;
    tokenCache.size = -1;
    return null;
  }
}

// 日志里抹掉可能出现的令牌（?token=... 之类），绝不把令牌写进日志。
function redactUrl(u) {
  return String(u || '').replace(/([?&](?:token|consoleToken|x-console-token)=)[^&\s]*/gi, '$1***');
}

// 注入的集成层：cabin-bridge（聊天/状态/活动） + cabin-gallery（画册同步/日记本）。
// 文件缺失时只注入存在的那几个，避免给缺文件的版本挂 404。
const INJECT_PARTS = [
  { file: 'cabin-bridge.css', tag: '<link rel="stylesheet" href="/cabin-bridge.css">' },
  { file: 'cabin-gallery.css', tag: '<link rel="stylesheet" href="/cabin-gallery.css">' },
  { file: 'cabin-bridge.js', tag: '<script src="/cabin-bridge.js" defer></script>' },
  { file: 'cabin-gallery.js', tag: '<script src="/cabin-gallery.js" defer></script>' },
];
function currentInjectSnippet() {
  return INJECT_PARTS
    .filter((p) => fs.existsSync(path.join(BRIDGE_ASSETS, p.file)))
    .map((p) => p.tag)
    .join('');
}
const INJECT_FILES = new Set(['home.html', 'cabin.html']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.jar': 'application/java-archive',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') {
      const v = Number.parseInt(argv[i + 1], 10);
      if (Number.isInteger(v) && v > 0 && v < 65536) port = v;
      i++;
    } else if (a.startsWith('--port=')) {
      const v = Number.parseInt(a.slice('--port='.length), 10);
      if (Number.isInteger(v) && v > 0 && v < 65536) port = v;
    }
  }
  return { port };
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

// 注入后的 HTML 缓存（文件名 + mtime + size 作为 key），避免每次请求都切 6MB 字符串。
const htmlCache = new Map();

function buildInjectedHtml(absPath) {
  const st = fs.statSync(absPath);
  const snippet = currentInjectSnippet();
  const key = `${absPath}|${st.mtimeMs}|${st.size}|${snippet}`;
  const hit = htmlCache.get(key);
  if (hit) return { body: hit, key };

  let html = fs.readFileSync(absPath, 'utf8');
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) {
    // 找不到注入点：原样返回，只记一条警告日志（不改变响应状态，避免页面白屏）。
    console.warn(`[inject] ${path.basename(absPath)} 没有 </body>，原样返回`);
  } else {
    html = html.slice(0, idx) + snippet + html.slice(idx);
  }
  const body = Buffer.from(html, 'utf8');
  if (htmlCache.size > 8) htmlCache.clear();
  htmlCache.set(key, body);
  return { body, key };
}

// 把 URL path 解析成 web/ 下的真实路径；越界或非法返回 null。
function resolveStaticPath(rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, `http://${HOST}`).pathname);
  } catch {
    return null;
  }
  if (pathname === '/' || pathname === '') pathname = '/home.html';
  if (pathname.includes('\0')) return null;
  const asset = INJECT_PARTS.find(({ file }) => pathname === '/' + file);
  if (asset) return path.join(BRIDGE_ASSETS, asset.file);
  const abs = path.resolve(WEB_ROOT, '.' + pathname);
  const rel = path.relative(WEB_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

function serveStatic(req, res, urlPath) {
  const abs = resolveStaticPath(urlPath);
  if (!abs) return sendText(res, 400, '400 Bad Request');

  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return sendText(res, 404, '404 Not Found');
  }
  if (!st.isFile()) return sendText(res, 404, '404 Not Found');

  const base = path.basename(abs);
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';

  // home/cabin：注入桥接层后返回（带缓存）。
  if (INJECT_FILES.has(base.toLowerCase())) {
    try {
      const { body } = buildInjectedHtml(abs);
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      return res.end(body);
    } catch (e) {
      // 读文件失败：按契约原样返回 + 500 日志
      console.error(`[inject] 读取 ${base} 失败：${e.message}`);
      return sendText(res, 500, '500 Internal Server Error');
    }
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': st.size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(abs);
  stream.on('error', (e) => {
    console.error(`[static] 读取 ${base} 失败：${e.message}`);
    res.destroy();
  });
  stream.pipe(res);
}

// 用带令牌的 GET /api/status 判断桥接是否可用（2xx 才算在跑）。
function probeBridge(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const token = getConsoleToken();
    if (!token) return resolve(false);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    let req;
    try {
      req = http.request(
        {
          host: BRIDGE_HOST,
          port: BRIDGE_PORT,
          method: 'GET',
          path: '/api/status',
          headers: { 'x-console-token': token },
        },
        (r) => {
          r.resume();
          finish(r.statusCode >= 200 && r.statusCode < 300);
        },
      );
    } catch {
      return finish(false);
    }
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });
    req.on('error', () => finish(false));
    req.end();
  });
}

async function handleHealth(req, res) {
  const bridge = await probeBridge();
  return sendJson(res, 200, { ok: true, bridge, port: PORT, at: Date.now() });
}

function proxyCabin(req, res) {
  const headers = { ...req.headers };
  // 桥接的 CSRF 校验按 Origin 判跨站：浏览器发来的是 5194，必须删掉。
  delete headers.origin;
  // 桥接控制台 Host 校验只接受 127.0.0.1:3100 / localhost:3100 / [::1]:3100。
  headers.host = `${BRIDGE_HOST}:${BRIDGE_PORT}`;

  // 控制台令牌只从本机读，忽略浏览器可能带来的同名头。
  const token = getConsoleToken();
  if (!token) {
    // 读不到令牌 = 桥接不可用；令牌绝不回给浏览器。
    return sendJson(res, 503, { ok: false, error: 'QQ 桥接没开' });
  }
  headers['x-console-token'] = token;

  const options = {
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    method: req.method,
    path: req.url,
    headers,
  };

  let responded = false;
  const fail = (status, error) => {
    if (responded) return;
    responded = true;
    if (res.destroyed || res.writableEnded) return;
    sendJson(res, status, { ok: false, error });
  };

  const upstream = http.request(options, (upRes) => {
    if (responded) return;
    responded = true;
    const outHeaders = { ...upRes.headers };
    delete outHeaders.connection;
    delete outHeaders['keep-alive'];
    delete outHeaders['transfer-encoding'];
    res.writeHead(upRes.statusCode || 502, outHeaders);
    upRes.pipe(res);
  });

  const timeoutMs = req.url.split('?')[0] === '/api/cabin/star-chart' ? 145000 : PROXY_TIMEOUT_MS;
  upstream.setTimeout(timeoutMs, () => {
    upstream.destroy();
    fail(504, 'QQ 桥接响应超时');
  });

  upstream.on('error', (e) => {
    if (e && (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'EHOSTUNREACH')) {
      fail(503, 'QQ 桥接没开');
    } else if (e && e.code === 'ETIMEDOUT') {
      fail(504, 'QQ 桥接响应超时');
    } else {
      fail(503, `QQ 桥接没开（${e ? e.code || e.message : 'unknown'}）`);
    }
  });

  // 客户端提前断开时别把上游挂住。
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });

  req.pipe(upstream);
}

const { port: ARG_PORT } = parseArgs(process.argv);
const PORT = ARG_PORT;
const inventoryOptions = {
  dataDir: process.env.CABIN_INVENTORY_DATA_DIR || path.join(__dirname, 'state'),
  webRoot: WEB_ROOT,
  sendJson,
};
const handleInventory = createInventoryHandler(inventoryOptions);
const handleAssistantInventory = createInventoryHandler({ ...inventoryOptions, summary: true });

const server = http.createServer((req, res) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`[${now()}] ${req.method} ${redactUrl(req.url)} ${res.statusCode} ${ms.toFixed(0)}ms`);
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`[${now()}] ${req.method} ${redactUrl(req.url)} aborted ${ms.toFixed(0)}ms`);
    }
  });

  try {
    const pathname = (() => {
      try {
        return new URL(req.url, `http://${HOST}`).pathname;
      } catch {
        return null;
      }
    })();

    if (pathname === null) return sendText(res, 400, '400 Bad Request');

    if (pathname === '/api/cabin/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      }
      handleHealth(req, res).catch((e) => {
        console.error(`[health] ${e && e.message}`);
        sendJson(res, 200, { ok: true, bridge: false, port: PORT, at: Date.now() });
      });
      return;
    }

    if (pathname === '/api/cabin/inventory') {
      return handleInventory(req, res);
    }

    if (pathname === '/api/cabin/assistant-summary') {
      return handleAssistantInventory(req, res);
    }

    if (pathname.startsWith('/api/cabin/')) {
      const host = req.headers.host?.toLowerCase(), port = req.socket.localPort;
      const local = [`127.0.0.1:${port}`, `localhost:${port}`].includes(host);
      const { origin, 'sec-fetch-site': site } = req.headers;
      if (!local || (origin !== undefined && origin !== `http://${host}`) || (site !== undefined && site !== 'same-origin' && site !== 'none')) {
        return sendJson(res, 403, { ok: false, error: '仅接受本机同源请求' });
      }
    }
    if (pathname === '/api/cabin/behavior' || pathname === '/api/cabin/star-chart') {
      const type = req.headers['content-type'];
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      if (!/^application\/json(?:\s*;|$)/i.test(type || '')) return sendJson(res, 415, { ok: false, error: '需要 JSON 请求' });
    }

    if (pathname.startsWith('/api/cabin/')) {
      return proxyCabin(req, res);
    }

    // 其它 /api/* 一律 404，避免误连
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: 'Not Found' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, '405 Method Not Allowed');
    }

    return serveStatic(req, res, req.url);
  } catch (e) {
    console.error(`[fatal] ${req.method} ${redactUrl(req.url)} ${e && (e.stack || e.message)}`);
    if (!res.headersSent) sendText(res, 500, '500 Internal Server Error');
    else res.destroy();
  }
});

server.on('clientError', (err, socket) => {
  try {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } catch {}
});

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`[启动失败] ${HOST}:${PORT} 已被占用（可能小屋服务已经在跑）`);
  } else {
    console.error(`[启动失败] ${e && (e.stack || e.message)}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`海边小屋服务已启动： http://${HOST}:${PORT}/`);
  console.log(`  静态目录：${WEB_ROOT}`);
  console.log(`  QQ 桥接反向代理： http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
  console.log('  关闭：Ctrl+C（或关掉这个窗口）');
});

let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${now()}] 收到 ${sig}，正在关闭…`);
  server.close(() => {
    console.log(`[${now()}] 已关闭`);
    process.exit(0);
  });
  // 兜底：5 秒内没退干净就强制退出
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
