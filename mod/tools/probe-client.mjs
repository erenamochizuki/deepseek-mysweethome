// probe-client.mjs：连游戏里的开发探针 xjyprobe（接口见 docs/PROBE.md「接口约定（v1）」）。
// 只用 Node 自带模块。所有失败都抛 ProbeError，带错误码 code：
//   探针回的：bad_request unauthorized forbidden not_found method_not_allowed busy not_in_world
//             chunk_not_loaded too_large timeout internal
//   这边加的：no_probe_file bad_probe_file version_mismatch connect_failed connection_lost
//             request_timeout bad_reply aborted wait_timeout

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_VERSION = 1;
export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MOD_DIR = path.resolve(TOOLS_DIR, '..');
export const DEFAULT_PROBE_FILE = path.join(MOD_DIR, 'run', 'xjyprobe.json');

// 每个接口这边等回复的时间（毫秒）。比探针自己的超时（10 秒，截图 15 秒）长，这样能看到探针回的 504。
export const DEFAULT_TIMEOUTS = {
  status: 5000,
  openWorld: 15000,
  leaveWorld: 15000,
  command: 20000,
  block: 15000,
  region: 30000,
  shapes: 30000, // 探针在 server thread 上算，自己的超时 10 秒（和 region 一样）
  use: 20000, // 探针先在 server thread 上右键，再等动作栏最多 2 秒
  screenshot: 25000,
  quit: 10000,
  input: 5000, // 探针在 HTTP 线程上直接改，不等游戏线程（和 status 一样）
};

const MAX_REPLY_BYTES = 64 * 1024 * 1024;
const STATUS_CODES = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed', 500: 'internal', 504: 'timeout' };

export class ProbeError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    Object.assign(this, extra); // httpStatus、endpoint、details、cause
  }

  toJSON() {
    const o = { error: this.code, message: this.message };
    if (this.httpStatus !== undefined) o.httpStatus = this.httpStatus;
    if (this.endpoint !== undefined) o.endpoint = this.endpoint;
    if (this.details !== undefined) o.details = this.details;
    return o;
  }
}

/** 连不上 / 连接断了：游戏可能已经退出或崩了。 */
export function isConnectionError(e) {
  return e instanceof ProbeError && (e.code === 'connect_failed' || e.code === 'connection_lost');
}

/** 读 xjyprobe.json，检查格式和版本。返回 { v, port, token, pid, startedAt, file }。 */
export function readProbeFile(file = DEFAULT_PROBE_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new ProbeError('no_probe_file', `找不到 ${file}：游戏没开，或者探针还没起来`);
    throw new ProbeError('bad_probe_file', `读不了 ${file}：${e.message}`, { cause: e });
  }
  let o;
  try {
    o = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new ProbeError('bad_probe_file', `${file} 不是 JSON（可能正在写）：${e.message}`, { cause: e });
  }
  if (!o || typeof o !== 'object') throw new ProbeError('bad_probe_file', `${file} 的内容不是对象`);
  if (o.v !== PROTOCOL_VERSION) throw new ProbeError('version_mismatch', `${file} 的 v 是 ${JSON.stringify(o.v)}，这个工具只认 v=${PROTOCOL_VERSION}`);
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new ProbeError('bad_probe_file', `${file} 里的 port 不对：${JSON.stringify(o.port)}`);
  if (typeof o.token !== 'string' || !/^[\x21-\x7e]+$/.test(o.token)) throw new ProbeError('bad_probe_file', `${file} 里的 token 不对`);
  if (o.pid !== undefined && o.pid !== null && !Number.isInteger(o.pid)) throw new ProbeError('bad_probe_file', `${file} 里的 pid 不对：${JSON.stringify(o.pid)}`);
  return { v: o.v, port: o.port, token: o.token, pid: o.pid ?? null, startedAt: o.startedAt ?? null, file };
}

export class ProbeClient {
  /**
   * @param {{port:number, token:string, host?:string, timeouts?:object, extraHeaders?:object}} opts
   *   extraHeaders 只给测试用（比如故意带 Origin）。
   */
  constructor({ port, token, host = '127.0.0.1', timeouts = {}, extraHeaders = {} }) {
    if (!Number.isInteger(port)) throw new TypeError('port 必须是整数');
    this.port = port;
    this.token = token;
    this.host = host;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
    this.extraHeaders = extraHeaders;
  }

  /** 从 xjyprobe.json 建一个客户端。返回的客户端上有 .info（文件内容）。 */
  static fromFile(file = DEFAULT_PROBE_FILE, opts = {}) {
    const info = readProbeFile(file);
    const c = new ProbeClient({ ...opts, port: info.port, token: info.token });
    c.info = info;
    return c;
  }

  // ---- 8 个接口 ----

  status(opts = {}) {
    return this.request('GET', '/status', { timeoutMs: this.timeouts.status, ...opts });
  }

  /** 开一个新的超平坦世界。只是「开始」，进没进去要看 /status。 */
  openWorld({ name, seed } = {}, opts = {}) {
    const body = {};
    if (name !== undefined) body.name = name;
    if (seed !== undefined) body.seed = seed;
    return this.request('POST', '/world/open', { body, timeoutMs: this.timeouts.openWorld, ...opts });
  }

  reopenWorld(opts = {}) {
    return this.request('POST', '/world/reopen', { body: {}, timeoutMs: this.timeouts.openWorld, ...opts });
  }

  pick(pos, { includeData = true } = {}, opts = {}) {
    return this.request('POST', '/pick', { body: { pos, includeData }, timeoutMs: this.timeouts.use, ...opts });
  }

  leaveWorld(opts = {}) {
    return this.request('POST', '/world/leave', { body: {}, timeoutMs: this.timeouts.leaveWorld, ...opts });
  }

  /** as: 'player'（默认）或 'server'。命令本身失败时不抛，看返回的 success。 */
  command(command, { as } = {}, opts = {}) {
    const body = { command };
    if (as !== undefined) body.as = as;
    return this.request('POST', '/command', { body, timeoutMs: this.timeouts.command, ...opts });
  }

  block([x, y, z], { dim } = {}, opts = {}) {
    const query = { x, y, z };
    if (dim !== undefined) query.dim = dim;
    return this.request('GET', '/block', { query, timeoutMs: this.timeouts.block, ...opts });
  }

  region(from, to, { dim } = {}, opts = {}) {
    const body = { from, to };
    if (dim !== undefined) body.dim = dim;
    return this.request('POST', '/region', { body, timeoutMs: this.timeouts.region, ...opts });
  }

  /** 查区域里的方块是不是游戏按邻居算出来的样子（接口 10，只读）。旧探针没有这个接口：抛 not_found（404）。 */
  shapes(from, to, { dim } = {}, opts = {}) {
    const body = { from, to };
    if (dim !== undefined) body.dim = dim;
    return this.request('POST', '/shapes', { body, timeoutMs: this.timeouts.shapes, ...opts });
  }

  /**
   * 模拟玩家右键一个方块（接口 12，2026-11-08 mod7 加）：pos [x, y, z]，face 点到的面（默认 up），hit 点到的位置
   * [x, y, z]（世界坐标小数，默认那个面的正中），sneak 潜行。回 {result, consumed, actionBar}。旧探针没有：抛 not_found。
   */
  use(pos, { face, hit, sneak } = {}, opts = {}) {
    const body = { pos };
    if (face !== undefined) body.face = face;
    if (hit !== undefined) body.hit = hit;
    if (sneak !== undefined) body.sneak = sneak;
    return this.request('POST', '/use', { body, timeoutMs: this.timeouts.use, ...opts });
  }

  // hideGui：true = 截纯世界画面（像按 F1）。不写就不发，和以前一样
  screenshot({ name, hideGui } = {}, opts = {}) {
    const body = {};
    if (name !== undefined) body.name = name;
    if (hideGui !== undefined) body.hideGui = hideGui;
    return this.request('POST', '/screenshot', { body, timeoutMs: this.timeouts.screenshot, ...opts });
  }

  /** 操作界面（接口 11，不发真实键鼠）：{config: 模组 id} 打开模组的配置界面，{press: 按钮上的字} 点一个按钮，{close: true} 关掉。 */
  screen(action, opts = {}) {
    return this.request('POST', '/screen', { body: action, ...opts });
  }

  quit(opts = {}) {
    return this.request('POST', '/quit', { body: {}, timeoutMs: this.timeouts.quit, ...opts });
  }

  /** 锁上（true）或解开（false）游戏对这台电脑键盘鼠标的响应（接口 9）。旧探针没有这个接口：抛 not_found（404）。 */
  input(locked, opts = {}) {
    return this.request('POST', '/input', { body: { locked }, timeoutMs: this.timeouts.input, ...opts });
  }

  // ---- 底层 ----

  /** 发一个请求。成功返回回复对象（ok:true），否则抛 ProbeError。 */
  request(method, endpoint, { query, body, timeoutMs = 10000, signal, headers = {} } = {}) {
    let reqPath = endpoint;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) qs.set(k, String(v));
      reqPath += `?${qs}`;
    }
    const payload = method === 'GET' ? null : Buffer.from(JSON.stringify(body ?? {}), 'utf8');
    const hdrs = { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...this.extraHeaders, ...headers };
    if (payload) {
      hdrs['Content-Type'] = 'application/json; charset=utf-8';
      hdrs['Content-Length'] = String(payload.length);
    }
    const where = `${method} ${endpoint}`;

    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;
      let req = null;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (err) {
          err.endpoint ??= where;
          reject(err);
        } else resolve(value);
      };
      const onAbort = () => {
        finish(new ProbeError('aborted', `${where} 被打断了`));
        req?.destroy();
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });

      req = http.request({ host: this.host, port: this.port, method, path: reqPath, headers: hdrs, agent: false });
      timer = setTimeout(() => {
        finish(new ProbeError('request_timeout', `${where} 等了 ${timeoutMs} 毫秒没有回复`));
        req.destroy();
      }, timeoutMs);

      req.on('error', (e) => {
        if (e.code === 'ECONNREFUSED') finish(new ProbeError('connect_failed', `连不上 ${this.host}:${this.port}（游戏没开或者已经退出了）`, { cause: e }));
        else finish(new ProbeError('connection_lost', `${where} 连接出错：${e.code || e.message}`, { cause: e }));
      });

      req.on('response', (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_REPLY_BYTES) {
            finish(new ProbeError('bad_reply', `${where} 的回复太大（超过 ${MAX_REPLY_BYTES} 字节）`, { httpStatus: res.statusCode }));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('error', (e) => finish(new ProbeError('connection_lost', `${where} 读回复时出错：${e.code || e.message}`, { cause: e })));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const st = res.statusCode;
          let o;
          try {
            o = JSON.parse(text);
          } catch {
            const code = st !== 200 ? STATUS_CODES[st] || 'bad_reply' : 'bad_reply';
            return finish(new ProbeError(code, `${where} 回了 HTTP ${st}，内容不是 JSON：${text.slice(0, 200)}`, { httpStatus: st }));
          }
          if (o && typeof o === 'object' && o.ok === true && st === 200) return finish(null, o);
          if (o && typeof o === 'object' && o.ok === false) {
            const code = typeof o.error === 'string' && o.error ? o.error : STATUS_CODES[st] || 'bad_reply';
            return finish(new ProbeError(code, typeof o.message === 'string' && o.message ? o.message : `HTTP ${st}`, { httpStatus: st, details: o }));
          }
          return finish(new ProbeError('bad_reply', `${where} 回了 HTTP ${st}，但不是约定的格式：${text.slice(0, 200)}`, { httpStatus: st }));
        });
      });

      if (payload) req.end(payload);
      else req.end();
    });
  }
}

// ---- 等 /status ----

const STATUS_KEYS = ['ready', 'screen', 'inWorld', 'chunksRendered'];
export const WAIT_KEYS = STATUS_KEYS;

const show = (v) => (v === undefined ? '（没有这个字段）' : JSON.stringify(v));

/** 返回不满足的条件，比如 ['inWorld 期望 true，实际 false']；全满足返回 []。 */
export function statusMismatches(status, cond) {
  const out = [];
  for (const [k, want] of Object.entries(cond)) {
    if (status?.[k] !== want) out.push(`${k} 期望 ${show(want)}，实际 ${show(status?.[k])}`);
  }
  return out;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProbeError('aborted', '被打断了'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ProbeError('aborted', '被打断了'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 轮询 /status，直到 cond 里每一项都相等，而且连续保持 stableMs 毫秒。
 * cond 例子：{ inWorld: true, screen: null }。
 * retry 里列的错误码只是重试（默认只重试 request_timeout），其它错误直接抛。
 * 超时抛 ProbeError('wait_timeout')，details.last 是最后一次看到的状态。
 */
export async function waitForStatus(client, cond, { timeoutMs = 60000, stableMs = 0, intervalMs = 250, signal, retry = ['request_timeout'] } = {}) {
  const t0 = Date.now();
  let last;
  let lastErr = null;
  let okSince = null;
  let polls = 0;
  for (;;) {
    if (signal?.aborted) throw new ProbeError('aborted', '被打断了');
    const left = timeoutMs - (Date.now() - t0);
    try {
      last = await client.status({ signal, timeoutMs: Math.max(1000, Math.min(client.timeouts.status, left)) });
      lastErr = null;
      polls++;
      if (statusMismatches(last, cond).length === 0) {
        okSince ??= Date.now();
        if (Date.now() - okSince >= stableMs) return { status: last, ms: Date.now() - t0, polls };
      } else okSince = null;
    } catch (e) {
      if (!(e instanceof ProbeError) || !retry.includes(e.code)) throw e;
      lastErr = e;
      okSince = null;
    }
    const remain = timeoutMs - (Date.now() - t0);
    if (remain <= 0) {
      let why;
      if (last === undefined) why = `一次 /status 都没拿到${lastErr ? `（${lastErr.code}：${lastErr.message}）` : ''}`;
      else {
        const miss = statusMismatches(last, cond);
        why = miss.length ? miss.join('；') : `条件满足了，但没有连续保持 ${stableMs} 毫秒`;
      }
      throw new ProbeError('wait_timeout', `等了 ${(timeoutMs / 1000).toFixed(1)} 秒，${why}`, { details: { cond, last: last ?? null } });
    }
    await sleep(Math.min(intervalMs, remain), signal);
  }
}
