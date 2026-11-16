// proc.mjs：进程小工具（主要给 run-cards.mjs 收尾用）。只用 Node 自带模块。
// 规矩：只结束「这次运行自己启动的」进程；调用方负责先确认 pid 是自己的。

import { execFile } from 'node:child_process';

export const IS_WINDOWS = process.platform === 'win32';

/** pid 对应的进程还在不在。 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // 进程在，只是没权限
  }
}

/** Windows 命令行工具的输出可能是 GBK（中文系统），先按 UTF-8 解，不行再按 GBK。 */
export function decodeText(buf) {
  if (typeof buf === 'string') return buf;
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return utf8;
  }
}

function run(file, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'buffer' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: decodeText(stdout ?? Buffer.alloc(0)), stderr: decodeText(stderr ?? Buffer.alloc(0)), error: err });
    });
  });
}

/**
 * 查进程的创建时间、父进程、名字（Windows 用 PowerShell 的 Win32_Process）。
 * 返回 { pid, ppid, name, createdMs } ；查不到（进程不在或者不是 Windows）返回 null。
 * 用途：结束进程前确认这个 pid 是这次运行启动之后才出现的，防止 pid 被别的进程复用。
 */
export async function processInfo(pid) {
  if (!IS_WINDOWS || !Number.isInteger(pid) || pid <= 0) return null;
  const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { [Console]::Out.Write((@{ ppid = [int]$p.ParentProcessId; name = [string]$p.Name; created = $p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress)) }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 20000);
  const text = r.stdout.trim();
  if (!text) return null;
  try {
    const o = JSON.parse(text);
    const createdMs = Date.parse(o.created);
    return { pid, ppid: o.ppid, name: o.name, createdMs: Number.isFinite(createdMs) ? createdMs : null };
  } catch {
    return null;
  }
}

/** 结束 pid（tree=true 时连它的子进程一起）。Windows 用 taskkill /PID <pid> [/T] /F。 */
export async function killPid(pid, { tree = true } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, output: '无效的 pid' };
  if (IS_WINDOWS) {
    const args = ['/PID', String(pid)];
    if (tree) args.push('/T');
    args.push('/F');
    const r = await run('taskkill.exe', args, 20000);
    return { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim(), command: `taskkill ${args.join(' ')}` };
  }
  try {
    process.kill(pid, 'SIGKILL');
    return { ok: true, output: '', command: `kill -9 ${pid}` };
  } catch (e) {
    return { ok: false, output: e.message, command: `kill -9 ${pid}` };
  }
}

/** 每 intervalMs 毫秒看一次 fn()，返回 true 就结束；超时返回 false。signal 打断时也返回 false。 */
export async function waitUntil(fn, timeoutMs, { intervalMs = 250, signal } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (signal?.aborted || Date.now() - t0 >= timeoutMs) return false;
    await new Promise((resolve) => {
      const t = setTimeout(done, Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - t0))));
      function done() {
        signal?.removeEventListener('abort', done);
        clearTimeout(t);
        resolve();
      }
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
