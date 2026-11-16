#!/usr/bin/env node
// run-cards.mjs：自动验收。启动游戏（gradlew runClient）→ 按顺序跑卡片 → 退出游戏，结果写进 mod/build/probe-runs/<时间>/。
// 用法和卡片格式见 docs/PROBE.md。退出码：0 全过；1 有卡片失败；2 启动/连接出问题、被打断、收尾没收干净。
// 测试专用：环境变量 XJY_TEST_FAKE_GAME=<脚本> 时用「node <脚本>」代替 gradlew.bat（启动和结束进程的方式完全一样）。

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ProbeClient, ProbeError, readProbeFile, isConnectionError, MOD_DIR, DEFAULT_PROBE_FILE, PROTOCOL_VERSION, sleep } from './probe-client.mjs';
import { loadCard, listDefaultCards, runStep, bindStep, describeStep, restoreFiles, CardError, StepFailed, displayPath } from './lib/cards.mjs';
import { isAlive, processInfo, killPid, waitUntil, decodeText, IS_WINDOWS } from './lib/proc.mjs';

const DEFAULT_OUT = path.join(MOD_DIR, 'build', 'probe-runs');

const USAGE = `用法: node mod/tools/run-cards.mjs [卡片文件...] [选项]
  不写卡片文件就跑 mod/cards/ 下的全部 .yml（按文件名排序）。
选项:
  --attach              连已经开着的游戏：不启动、不结束任何进程；没加 --keep 时跑完发 /quit
  --keep                跑完不退出游戏
  --timeout-start <秒>  等游戏启动到主菜单的最长时间，默认 900（第一次启动要下载、编译，比较慢）
  --timeout-quit <秒>   发 /quit 以后等游戏进程退出的时间，超过就结束进程，默认 90
  --java-home <目录>    Java 25 JDK；优先于 XJY_JAVA_HOME、JAVA_HOME；均未设置时用 PATH
  --probe-file <文件>   探针写的连接信息，默认 mod/run/xjyprobe.json
  --port <端口>         让探针用固定端口（传给 gradlew -Pxjyprobe.port=）
  --out <目录>          运行结果放哪，默认 mod/build/probe-runs
  -h, --help            显示这段说明
退出码: 0 全过；1 有卡片失败；2 启动或连接出问题、被打断、游戏中途退了、收尾没收干净`;

class UsageError extends Error {}

/** 让这次运行停下来的问题（启动失败、连不上、游戏没了……）。code 写进 results.json 的 fatal.error。 */
class Fatal extends Error {
  constructor(code, message, hint = null) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

function isoNow(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function log(msg) {
  const d = new Date();
  console.log(`[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}] ${msg}`);
}

function short(v, max = 300) {
  const s = JSON.stringify(v);
  return s && s.length > max ? `${s.slice(0, max)}…` : s;
}

function readTail(file, bytes = 64 * 1024) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, bytes);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return decodeText(buf);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function tailLog(file, n) {
  const lines = readTail(file).split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(-n).map((l) => `    ${l}`).join('\n');
}

function lastLogLine(file) {
  const lines = readTail(file, 8192).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('# '));
  const l = (lines.at(-1) ?? '').trim();
  return l.length > 160 ? `${l.slice(0, 160)}…` : l;
}

function makeRunDir(out) {
  const d = new Date();
  const base = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  fs.mkdirSync(out, { recursive: true });
  for (let i = 1; ; i++) {
    const dir = path.join(out, i === 1 ? base : `${base}-${i}`);
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

function parseArgs(argv) {
  const o = {
    files: [],
    attach: false,
    keep: false,
    timeoutStart: 900,
    timeoutQuit: 90,
    javaHome: process.env.XJY_JAVA_HOME || process.env.JAVA_HOME || null,
    probeFile: DEFAULT_PROBE_FILE,
    port: null,
    out: DEFAULT_OUT,
    help: false,
  };
  const seconds = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${name} 要是大于 0 的秒数：${v}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    if (a.startsWith('--') && a.includes('=')) {
      inline = a.slice(a.indexOf('=') + 1);
      a = a.slice(0, a.indexOf('='));
    }
    const value = () => {
      if (inline !== undefined) return inline;
      if (i + 1 >= argv.length) throw new UsageError(`${a} 后面要跟一个值`);
      return argv[++i];
    };
    switch (a) {
      case '--attach':
        o.attach = true;
        break;
      case '--keep':
        o.keep = true;
        break;
      case '--timeout-start':
        o.timeoutStart = seconds(value(), a);
        break;
      case '--timeout-quit':
        o.timeoutQuit = seconds(value(), a);
        break;
      case '--java-home':
        o.javaHome = value();
        if (!o.javaHome.trim()) throw new UsageError('--java-home 要是非空的 JDK 目录');
        break;
      case '--probe-file':
        o.probeFile = path.resolve(value());
        break;
      case '--port': {
        const v = Number(value());
        if (!Number.isInteger(v) || v < 1 || v > 65535) throw new UsageError('--port 要是 1 到 65535 的整数');
        o.port = v;
        break;
      }
      case '--out':
        o.out = path.resolve(value());
        break;
      case '-h':
      case '--help':
        o.help = true;
        break;
      default:
        if (a.startsWith('-')) throw new UsageError(`不认识的选项 ${a}`);
        o.files.push(a);
    }
  }
  return o;
}

class Runner {
  constructor(opts, cards) {
    this.o = opts;
    this.cards = cards;
    this.abort = new AbortController(); // 第一次 Ctrl+C：停止跑卡片，正常收尾
    this.force = new AbortController(); // 第二次 Ctrl+C：不再等，直接结束这次启动的进程
    this.child = null;
    this.childExit = null;
    this.client = null;
    this.launchMs = null;
    this.fatal = null;
    this.interrupted = false;
    // 游戏进程。trusted：确认是这次启动的（只有 trusted 的才会被结束）。
    this.game = { pid: null, port: null, trusted: false, createdMs: null, createdAt: null, name: null, ppid: null, mc: null, neoforge: null };
  }

  async run() {
    const o = this.o;
    const t0 = Date.now();
    this.runDir = makeRunDir(o.out);
    this.logFile = path.join(this.runDir, 'gradle.log');
    this.results = {
      tool: 'run-cards',
      mode: o.attach ? 'attach' : 'launch',
      startedAt: isoNow(),
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      args: process.argv.slice(2),
      runDir: this.runDir,
      options: { keep: o.keep, timeoutStart: o.timeoutStart, timeoutQuit: o.timeoutQuit, javaHome: o.attach || !o.javaHome ? null : path.resolve(o.javaHome), probeFile: o.probeFile, port: o.port },
      startup: null,
      input: null, // 锁没锁住这台电脑的键盘鼠标（接口 9）：{ before, locked, by, supported, error, restored }
      game: this.game,
      cards: this.cards.map((c) => ({ id: c.id, title: c.title, file: c.file, status: 'pending', startedAt: null, durationMs: null, failedStep: null, steps: [] })),
      summary: null,
      fatal: null,
      interrupted: false,
      shutdown: null,
    };
    this.installHandlers();
    log(`运行结果目录：${displayPath(this.runDir)}`);
    if (o.attach) fs.writeFileSync(this.logFile, '# --attach：游戏不是这次启动的，这里没有 gradlew 的输出\n');
    this.save();
    try {
      await this.start();
      await this.runCards();
    } catch (e) {
      this.setFatal(e);
    }
    try {
      await this.shutdown();
    } catch (e) {
      this.setFatal(e);
    }
    const code = this.exitCode();
    Object.assign(this.results, { finishedAt: isoNow(), durationMs: Date.now() - t0, exitCode: code, interrupted: this.interrupted, fatal: this.fatal });
    this.results.summary = this.summarize();
    this.save();
    this.printSummary(code);
    this.removeHandlers();
    return code;
  }

  // ---- 启动 / 连接 ----

  async start() {
    const o = this.o;
    const t0 = Date.now();
    const st = (this.results.startup = { command: null, childPid: null, launchedAt: null, probeFileAt: null, readyAt: null, ms: null });
    if (o.attach) {
      if (o.port) log('注意：--attach 时 --port 不起作用（端口看 xjyprobe.json）');
      let info;
      try {
        info = readProbeFile(o.probeFile);
      } catch (e) {
        throw new Fatal(e.code, e.message, e.code === 'no_probe_file' ? '用 --attach 时游戏要先开着；或者去掉 --attach，让我来启动游戏' : null);
      }
      this.connect(info);
      log(`连接已经开着的游戏：端口 ${info.port}，pid ${info.pid}`);
    } else {
      await this.clearOldProbeFile();
      this.launch(st);
      const info = await this.waitProbeFile(st, t0);
      this.connect(info);
      await this.trustGamePid(info.pid);
    }
    const ready = await this.waitReady(st, t0);
    st.ms = Date.now() - t0;
    await this.lockInput(ready);
  }

  // 跑卡片时不让这台电脑的键盘鼠标动游戏（有人在用电脑也不怕）。自己开的游戏启动时就锁了（-Pxjyprobe.lockInput=true），
  // 这里再核对一下；--attach 先记下原来锁没锁，再锁上（--keep 时最后恢复）。旧探针没有 /input：提醒一句，照样跑
  async lockInput(ready) {
    const inp = (this.results.input = { before: typeof ready?.inputLocked === 'boolean' ? ready.inputLocked : null, locked: false, by: null, supported: null, error: null, restored: null });
    if (!this.o.attach && inp.before === true) {
      Object.assign(inp, { locked: true, by: 'launch', supported: true });
      log('键盘鼠标：游戏启动时就锁住了，跑卡片时动这台电脑的键盘鼠标不影响游戏');
      return;
    }
    try {
      await this.client.input(true, { signal: this.abort.signal });
      Object.assign(inp, { locked: true, by: 'runner', supported: true });
      log(this.o.attach
        ? `键盘鼠标：已锁住（原来${inp.before === true ? '就是锁着的' : inp.before === false ? '没锁' : '锁没锁不知道'}），跑卡片时动这台电脑的键盘鼠标不影响游戏`
        : '键盘鼠标：启动参数没锁住，补锁上了');
    } catch (e) {
      if (!(e instanceof ProbeError) || e.code === 'aborted' || isConnectionError(e)) throw e;
      inp.error = e.toJSON();
      if (e.code === 'not_found') {
        inp.supported = false;
        log('提醒：这个探针太旧，没有 /input，锁不住键盘鼠标。跑卡片时别碰这台电脑的键盘鼠标（截图前照样核对站位）');
      } else log(`提醒：锁键盘鼠标没成功（${e.message}），照样跑。跑卡片时别碰这台电脑的键盘鼠标`);
    }
  }

  // --attach --keep：游戏要留给人用，锁的状态恢复成原来的（原来就锁着、或者不知道原来怎样的，不动）
  async restoreInput() {
    const inp = this.results.input;
    if (!inp || inp.by !== 'runner' || inp.before !== false || !this.client) return;
    try {
      await this.client.input(false, { signal: this.force.signal });
      inp.restored = true;
      log('键盘鼠标：恢复成原来的（没锁）');
    } catch (e) {
      inp.restored = false;
      log(`键盘鼠标没解开（${e?.message ?? e}）：要用游戏的话运行 node mod/tools/probe.mjs input unlock`);
    }
  }

  connect(info) {
    this.client = new ProbeClient({ port: info.port, token: info.token });
    this.game.port = info.port;
    if (this.o.attach) this.game.pid = info.pid;
  }

  /** 启动前：旧的 xjyprobe.json 删掉；但如果它指向的游戏还开着，就不启动第二个。 */
  async clearOldProbeFile() {
    const f = this.o.probeFile;
    if (!fs.existsSync(f)) return;
    let info = null;
    try {
      info = readProbeFile(f);
    } catch {
      // 格式坏了，当旧文件处理
    }
    if (info) {
      let answered = null;
      try {
        await new ProbeClient({ port: info.port, token: info.token }).status({ timeoutMs: 3000 });
        answered = 'ok';
      } catch (e) {
        if (!isConnectionError(e)) answered = e.code;
      }
      if (answered) {
        throw new Fatal(
          'game_running',
          `已经有一个游戏开着（${displayPath(f)}：端口 ${info.port}，pid ${info.pid}，/status 回的是 ${answered}）`,
          '要连它就加 --attach；要重新启动就先让它退出：node mod/tools/probe.mjs quit',
        );
      }
    }
    fs.rmSync(f, { force: true });
    log(`删掉了旧的 ${displayPath(f)}`);
  }

  launch(st) {
    const o = this.o;
    const fake = process.env.XJY_TEST_FAKE_GAME ? path.resolve(process.env.XJY_TEST_FAKE_GAME) : null;
    const javaHome = o.javaHome ? path.resolve(o.javaHome) : null;
    const lock = ' -Pxjyprobe.lockInput=true'; // 游戏一启动就不理会这台电脑的键盘鼠标（docs/PROBE.md 接口 9）
    let cmdline;
    if (fake) cmdline = `"${process.execPath}" "${fake}" client${lock}`;
    else {
      if (javaHome) {
        const java = path.join(javaHome, 'bin', IS_WINDOWS ? 'java.exe' : 'java');
        if (!fs.existsSync(java)) throw new Fatal('no_java', `找不到 JDK：${java}`, '用 --java-home <JDK 目录>、XJY_JAVA_HOME 或 JAVA_HOME 指定 Java 25 JDK；均未设置时由 gradlew 使用 PATH 中的 java');
      }
      cmdline = `"${path.join(MOD_DIR, IS_WINDOWS ? 'gradlew.bat' : 'gradlew')}" runClient --console=plain${o.port ? ` -Pxjyprobe.port=${o.port}` : ''}${lock}`;
    }
    for (const p of [MOD_DIR, this.logFile, fake ?? '', process.execPath]) {
      if (/["%]/.test(p)) throw new Fatal('bad_path', `路径里有 cmd.exe 处理不了的字符（" 或 %）：${p}`, '换一个不带这些字符的目录');
    }
    fs.writeFileSync(this.logFile, `# run-cards.mjs ${isoNow()}\n# cwd: ${MOD_DIR}\n# JAVA_HOME=${javaHome ?? '(unset; java from PATH)'}\n# ${cmdline}\n\n`);
    const full = `${cmdline} >> "${this.logFile}" 2>&1`;
    const env = { ...process.env };
    if (javaHome) env.JAVA_HOME = javaHome;
    else delete env.JAVA_HOME;
    if (fake) env.XJY_PROBE_FILE = o.probeFile;
    this.launchMs = Date.now() - 2000; // 进程创建时间有一点误差，留 2 秒余量
    // 经过 cmd.exe、整条命令一个字符串（Node 24 不让直接 spawn .bat）；不 detached、不继承输出：不会弹出控制台窗口，
    // Ctrl+C 只到这个 Node 进程，由下面的处理先发 /quit。
    this.child = IS_WINDOWS
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `"${full}"`], { cwd: MOD_DIR, env, windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' })
      : spawn('/bin/sh', ['-c', full], { cwd: MOD_DIR, env, stdio: 'ignore' });
    this.child.on('exit', (code, signal) => {
      this.childExit = { code, signal };
    });
    this.child.on('error', (e) => {
      this.childExit = { code: null, signal: null, error: e.message };
    });
    Object.assign(st, { command: cmdline, childPid: this.child.pid ?? null, launchedAt: isoNow() });
    log(`启动游戏：${fake ? '（测试用的假游戏）' : ''}${cmdline}`);
    log(`gradlew 的输出写在 ${displayPath(this.logFile)}`);
  }

  async waitProbeFile(st, t0) {
    const deadline = t0 + this.o.timeoutStart * 1000;
    let lastProgress = Date.now();
    let lastErr = null;
    for (;;) {
      if (this.abort.signal.aborted) throw new ProbeError('aborted', '被打断了');
      if (fs.existsSync(this.o.probeFile)) {
        try {
          const info = readProbeFile(this.o.probeFile);
          st.probeFileAt = isoNow();
          log(`探针起来了：端口 ${info.port}，游戏 pid ${info.pid}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
          return info;
        } catch (e) {
          if (e.code === 'version_mismatch') throw new Fatal('version_mismatch', e.message, '探针和 Node 工具的接口版本对不上，两边要一起更新');
          lastErr = e; // 可能还没写完，下一轮再读
        }
      }
      if (this.childExit) throw new Fatal('start_failed', `gradlew 提前退出了（退出码 ${this.childExit.code}${this.childExit.error ? `，${this.childExit.error}` : ''}），游戏没起来`, `${displayPath(this.logFile)} 的末尾：\n${tailLog(this.logFile, 25)}`);
      if (Date.now() > deadline) throw new Fatal('start_timeout', `等了 ${this.o.timeoutStart} 秒，探针还没写出 ${displayPath(this.o.probeFile)}${lastErr ? `（${lastErr.message}）` : ''}`, `${displayPath(this.logFile)} 的末尾：\n${tailLog(this.logFile, 25)}`);
      if (Date.now() - lastProgress >= 15000) {
        lastProgress = Date.now();
        log(`  …${((Date.now() - t0) / 1000).toFixed(0)} 秒  ${lastLogLine(this.logFile)}`);
      }
      await sleep(500, this.abort.signal).catch(() => {});
    }
  }

  /** 记下游戏 pid 和它的创建时间。只有在这次启动之后才创建的进程才算「自己的」，收尾时才会结束它。 */
  async trustGamePid(pid) {
    const g = this.game;
    if (!Number.isInteger(pid) || pid <= 0 || pid === g.pid) return;
    Object.assign(g, { pid, trusted: false, createdMs: null, createdAt: null, name: null, ppid: null });
    const info = await processInfo(pid);
    if (info) Object.assign(g, { createdMs: info.createdMs, createdAt: info.createdMs ? new Date(info.createdMs).toISOString() : null, name: info.name, ppid: info.ppid });
    // xjyprobe.json 是启动前删掉之后才出现的，所以里面的 pid 本来就是这次的游戏；创建时间再防一下 pid 复用。
    g.trusted = info ? info.createdMs === null || info.createdMs >= this.launchMs : isAlive(pid);
    if (!g.trusted) log(`注意：没法确认 pid ${pid} 是这次启动的游戏（${info ? '它比这次启动还早' : '查不到这个进程'}），收尾时不会单独结束它`);
  }

  async waitReady(st, t0) {
    const o = this.o;
    const deadline = t0 + o.timeoutStart * 1000;
    let lastProgress = Date.now();
    let errorScreenSince = null;
    let last = null;
    let lastErr = null;
    for (;;) {
      if (this.abort.signal.aborted) throw new ProbeError('aborted', '被打断了');
      try {
        const s = await this.client.status({ signal: this.abort.signal });
        last = s;
        lastErr = null;
        if (s.v !== PROTOCOL_VERSION) throw new Fatal('version_mismatch', `/status 回的 v 是 ${JSON.stringify(s.v)}，这个工具只认 v=${PROTOCOL_VERSION}`, '探针和 Node 工具的接口版本对不上，两边要一起更新');
        if (Number.isInteger(s.pid)) {
          if (o.attach) this.game.pid = s.pid;
          else await this.trustGamePid(s.pid);
        }
        if (s.ready === true) {
          st.readyAt = isoNow();
          Object.assign(this.game, { mc: s.mc ?? null, neoforge: s.neoforge ?? null });
          log(`游戏准备好了：Minecraft ${s.mc}，NeoForge ${s.neoforge}，pid ${s.pid}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
          return s; // start() 拿它看键盘鼠标锁没锁（inputLocked）
        }
        if (typeof s.screen === 'string' && /Error/.test(s.screen)) {
          errorScreenSince ??= Date.now();
          if (Date.now() - errorScreenSince >= 3000) {
            throw new Fatal('load_error', `游戏停在 ${s.screen}（模组加载报错或警告），到不了主菜单`, `看游戏窗口上的提示，或者 ${displayPath(this.logFile)} 里的 ERROR / WARN；只是警告的话，可以在 mod/run/config/neoforge-client.toml 里设 showLoadWarnings = false`);
          }
        } else errorScreenSince = null;
      } catch (e) {
        if (e instanceof Fatal || !(e instanceof ProbeError) || e.code === 'aborted') throw e;
        if (e.code === 'unauthorized') throw new Fatal('unauthorized', `探针不认 token（401）：${displayPath(o.probeFile)} 里的 token 不对`, '这个文件可能是旧的，或者有两个游戏在用同一个 run 目录');
        if (e.code === 'forbidden') throw new Fatal('forbidden', `探针拒绝了请求（403）：${e.message}`, '探针不接受带 Origin 的请求，Host 只能是 127.0.0.1 或 localhost');
        if (!['connect_failed', 'connection_lost', 'request_timeout'].includes(e.code)) throw new Fatal(e.code, `/status 出错：${e.message}`);
        if (o.attach && e.code === 'connect_failed') throw new Fatal('connect_failed', e.message, `${displayPath(o.probeFile)} 可能是旧的（游戏已经关了）；去掉 --attach 让我来启动游戏`);
        lastErr = e;
      }
      if (!o.attach && this.childExit) throw new Fatal('start_failed', `gradlew 退出了（退出码 ${this.childExit.code}），游戏没到主菜单`, `${displayPath(this.logFile)} 的末尾：\n${tailLog(this.logFile, 25)}`);
      if (this.game.pid && !isAlive(this.game.pid)) throw new Fatal('game_exited', `游戏进程（pid ${this.game.pid}）没了，没到主菜单`, `可能崩了：看 ${displayPath(this.logFile)} 的末尾和 mod/run/crash-reports/`);
      if (Date.now() > deadline) {
        const where = last ? `screen=${last.screen}，ready=${last.ready}` : lastErr ? lastErr.message : '没拿到 /status';
        throw new Fatal('start_timeout', `等了 ${o.timeoutStart} 秒，游戏还没到主菜单（最后看到：${where}）`, o.attach ? null : `${displayPath(this.logFile)} 的末尾：\n${tailLog(this.logFile, 25)}`);
      }
      if (Date.now() - lastProgress >= 15000) {
        lastProgress = Date.now();
        log(`  …${((Date.now() - t0) / 1000).toFixed(0)} 秒  screen=${last?.screen ?? '?'}${o.attach ? '' : `  ${lastLogLine(this.logFile)}`}`);
      }
      await sleep(500, this.abort.signal).catch(() => {});
    }
  }

  // ---- 跑卡片 ----

  async runCards() {
    for (let i = 0; i < this.cards.length; i++) {
      if (this.abort.signal.aborted || this.fatal) break;
      const res = this.results.cards[i];
      try {
        await this.toTitle();
      } catch (e) {
        if (e instanceof ProbeError && e.code === 'aborted') break;
        if (isConnectionError(e)) this.setFatal(await this.lostGame(e));
        else this.setFatal(e instanceof Fatal ? e : new Fatal('cleanup_failed', `没法回到主菜单：${e.message}`, '上一张卡片可能把游戏留在了别的界面'));
        res.note = '没跑：游戏回不到主菜单';
        break;
      }
      await this.runCard(this.cards[i], res);
      this.save();
    }
  }

  /** 每张卡片开始前，游戏要在主菜单。还在世界里就先离开。 */
  async toTitle() {
    const deadline = Date.now() + 180000;
    let leaveAt = null;
    let strangeSince = null;
    for (;;) {
      const s = await this.client.status({ signal: this.abort.signal });
      if (s.inWorld === false && s.screen === 'TitleScreen') return;
      const loading = typeof s.screen === 'string' && /Loading|Progress|Receiving|Connect|Message/i.test(s.screen);
      if (s.inWorld === true && !loading) {
        strangeSince = null;
        if (leaveAt === null || Date.now() - leaveAt > 30000) {
          log('  （游戏还在世界里，先离开世界）');
          leaveAt = Date.now();
          try {
            await this.client.leaveWorld({ signal: this.abort.signal });
          } catch (e) {
            if (!(e instanceof ProbeError) || !['not_in_world', 'busy'].includes(e.code)) throw e;
            if (e.code === 'busy') leaveAt = null;
          }
        }
      } else if (s.inWorld !== true && !loading) {
        strangeSince ??= Date.now();
        if (Date.now() - strangeSince > 15000) throw new Fatal('cleanup_failed', `游戏停在 ${s.screen ?? '（没有界面）'}，回不到主菜单`, '可能弹出了报错界面，看一下游戏窗口');
      } else strangeSince = null;
      if (Date.now() > deadline) throw new Fatal('cleanup_failed', `等了 180 秒还没回到主菜单（screen=${s.screen}，inWorld=${s.inWorld}）`);
      await sleep(250, this.abort.signal);
    }
  }

  async runCard(card, res) {
    const t0 = Date.now();
    res.status = 'running';
    res.startedAt = isoNow();
    log('');
    log(`=== ${card.id}${card.title ? `  ${card.title}` : ''}  (${displayPath(card.file)})`);
    // runId = 结果文件夹名（卡片里的 ${run}）；gameDir = 探针文件所在的游戏目录（mod/run/）；snapshots 每张卡片单独一份
    const ctx = {
      client: this.client, signal: this.abort.signal, shotsDir: path.join(this.runDir, 'shots'),
      runId: path.basename(this.runDir), gameDir: path.dirname(path.resolve(this.o.probeFile)), snapshots: new Map(),
    };
    let failed = null;
    for (const rawStep of card.steps) {
      // ${run} 换成真的运行编号后再检查一遍参数；这里出错（CardError）算这一步失败，不当成程序崩溃
      let step = rawStep;
      let bindError = null;
      try {
        step = bindStep(rawStep, ctx.runId);
      } catch (e) {
        bindError = e;
      }
      const sr = { index: step.index + 1, line: step.line, type: step.type, desc: describeStep(step), status: 'running', ms: null, result: null };
      res.steps.push(sr);
      const s0 = Date.now();
      try {
        if (bindError) throw bindError;
        sr.result = await runStep(step, ctx);
        sr.status = 'pass';
      } catch (e) {
        if (e instanceof CardError) {
          Object.assign(sr, { status: 'fail', error: 'card_error', message: e.reason });
        } else if (e instanceof StepFailed) {
          Object.assign(sr, { status: 'fail', error: e.code ?? 'check_failed', message: e.message, expected: e.expected, actual: e.actual });
          if (e.result !== undefined) sr.result = e.result;
        } else if (e instanceof ProbeError && e.code === 'aborted') {
          Object.assign(sr, { status: 'interrupted', error: 'aborted', message: '被打断了' });
        } else if (e instanceof ProbeError) {
          Object.assign(sr, { status: 'fail', error: e.code, message: e.message });
          if (e.httpStatus !== undefined) sr.httpStatus = e.httpStatus;
          if (isConnectionError(e)) {
            const f = await this.lostGame(e);
            if (f) this.setFatal(f);
          }
        } else {
          Object.assign(sr, { status: 'fail', error: 'internal', message: String(e?.stack || e) });
        }
      }
      sr.ms = Date.now() - s0;
      this.printStep(sr);
      if (sr.status !== 'pass') {
        failed = sr;
        break;
      }
    }
    // config 步骤改过的配置文件，这张卡片结束时（过没过都）原样改回去，免得影响后面的卡片
    try {
      const restored = await restoreFiles(ctx);
      if (restored.length) {
        res.restored = restored.map((f) => displayPath(f));
        log(`  （改回了这张卡片改过的 ${res.restored.join('、')}）`);
      }
    } catch (e) {
      res.restoreError = String(e?.message ?? e);
      log(`  （没能改回这张卡片改过的配置文件：${res.restoreError}）`);
    }
    res.durationMs = Date.now() - t0;
    if (!failed) res.status = 'pass';
    else if (failed.status === 'interrupted') res.status = 'interrupted';
    else {
      res.status = 'fail';
      res.failedStep = { index: failed.index, line: failed.line, type: failed.type, desc: failed.desc, error: failed.error, message: failed.message };
    }
    if (res.status === 'pass') log(`PASS ${card.id}  (${(res.durationMs / 1000).toFixed(1)}s)`);
    else if (res.status === 'fail') log(`FAIL ${card.id}  第 ${failed.index} 步「${failed.desc}」（${displayPath(card.file)}:${failed.line}）：${failed.message}`);
    else log(`STOP ${card.id}  第 ${failed.index} 步被打断`);
  }

  printStep(sr) {
    const tag = { pass: ' ok ', fail: 'FAIL', interrupted: 'STOP' }[sr.status] ?? sr.status;
    log(`  [${tag}] ${String(sr.index).padStart(2)}. ${sr.desc}  ${sr.ms}ms`);
    if (sr.status === 'fail') log(`         ${sr.error === 'check_failed' ? '' : `${sr.error}：`}${sr.message}`);
    else if (sr.status === 'pass' && sr.result?.pose?.note) log(`         ${sr.result.pose.note}`);
    else if (sr.status === 'pass' && sr.result?.pose?.checked) log(`         站位核对过了（${sr.result.pose.source}）`);
  }

  /** 请求连不上了：游戏还在不在？返回 Fatal（要停止整次运行），或者 null（又能连上了）。 */
  async lostGame(e) {
    try {
      await this.client.status({ timeoutMs: 3000 });
      return null;
    } catch {
      // 确实连不上
    }
    const pid = this.game.pid;
    if (pid && !isAlive(pid)) return new Fatal('game_exited', `游戏进程（pid ${pid}）没了：${e.message}`, `可能崩了：看 ${displayPath(this.logFile)} 的末尾和 mod/run/crash-reports/`);
    return new Fatal(e.code, `连不上探针了：${e.message}`, '游戏可能卡住了，或者正在退出');
  }

  // ---- 收尾 ----

  async shutdown() {
    const o = this.o;
    const sd = (this.results.shutdown = { quitSent: false, quitError: null, waitedMs: 0, forced: false, killed: [], leftover: [], exited: null, kept: false });
    const t0 = Date.now();
    const finished = !this.fatal && !this.interrupted;

    if (o.attach) {
      if (o.keep) {
        sd.kept = true;
        await this.restoreInput();
        log('--keep：游戏保持开着');
        return;
      }
      if (!this.client) return;
      await this.sendQuit(sd);
      if (!sd.quitSent) {
        await this.restoreInput(); // 游戏没退出：别把它锁着留给人
        return;
      }
      const pid = this.game.pid;
      const useFile = !pid || pid === process.pid;
      log(`等游戏退出${useFile ? '' : `（pid ${pid}）`}…`);
      const ok = await waitUntil(() => (useFile ? !fs.existsSync(o.probeFile) : !isAlive(pid)), o.timeoutQuit * 1000, { signal: this.force.signal });
      sd.waitedMs = Date.now() - t0;
      sd.exited = ok;
      if (ok) log(`游戏退出了（${(sd.waitedMs / 1000).toFixed(1)} 秒）`);
      else {
        sd.leftover.push({ pid, what: 'game' });
        log(`游戏 ${o.timeoutQuit} 秒内没退出。--attach 时我不结束任何进程，请手动处理`);
      }
      return;
    }

    if (!this.child) return; // 根本没启动（比如找不到 JDK）
    if (o.keep && finished) {
      sd.kept = true;
      this.child.unref();
      log(`--keep：游戏保持开着（pid ${this.game.pid}）。用完了用 node mod/tools/probe.mjs quit 退出`);
      if (this.results.input?.locked) log('  键盘鼠标还锁着；要自己在游戏里操作，先运行 node mod/tools/probe.mjs input unlock');
      return;
    }
    const force = this.force.signal;
    if (this.client && !force.aborted) await this.sendQuit(sd);
    const gamePid = this.game.trusted ? this.game.pid : null;
    const gone = () => (!gamePid || !isAlive(gamePid)) && this.childExit !== null;
    if (!force.aborted) {
      const ms = sd.quitSent ? o.timeoutQuit * 1000 : 5000;
      log(sd.quitSent ? `等游戏${gamePid ? `（pid ${gamePid}）` : ''}和 gradlew 退出，最多 ${ms / 1000} 秒…` : '没发出 /quit，稍等一下就结束进程…');
      await waitUntil(gone, ms, { signal: force });
    }
    if (!gone()) {
      sd.forced = true;
      const own = await this.ownGamePid();
      if (own) {
        log(`游戏没有自己退出，结束游戏进程 ${own}`);
        const r = await killPid(own, { tree: true });
        sd.killed.push({ pid: own, what: 'game', ok: r.ok, command: r.command, output: r.output });
        await waitUntil(gone, 10000);
      }
      if (this.childExit === null) {
        log(`结束这次启动的 gradlew 进程树（pid ${this.child.pid}）`);
        const r = await killPid(this.child.pid, { tree: true });
        sd.killed.push({ pid: this.child.pid, what: 'gradlew', ok: r.ok, command: r.command, output: r.output });
        await waitUntil(() => this.childExit !== null, 10000);
      }
    }
    await this.killLateGame(sd);
    if (await this.ownGamePid()) sd.leftover.push({ pid: gamePid, what: 'game' });
    if (this.childExit === null) sd.leftover.push({ pid: this.child.pid, what: 'gradlew' });
    sd.exited = sd.leftover.length === 0;
    sd.waitedMs = Date.now() - t0;
    if (this.childExit) {
      try {
        fs.appendFileSync(this.logFile, `\n# gradlew 退出了，退出码 ${this.childExit.code}，${isoNow()}\n`);
      } catch {
        // 不要紧
      }
    }
    if (sd.exited) log(`游戏和 gradlew 都退出了（${(sd.waitedMs / 1000).toFixed(1)} 秒${sd.forced ? '，有进程是强制结束的' : ''}）`);
    else log(`还有进程没退出：${sd.leftover.map((l) => `${l.what} pid ${l.pid}`).join('，')}，请手动结束（taskkill /PID <pid> /T /F）`);
  }

  /** 游戏 pid 还活着、而且确实是这次启动的那个进程（创建时间对得上）时返回 pid，否则 null。 */
  async ownGamePid() {
    const g = this.game;
    if (!g.trusted || !g.pid || !isAlive(g.pid)) return null;
    if (!IS_WINDOWS) return g.pid;
    const info = await processInfo(g.pid);
    if (!info) return isAlive(g.pid) && g.createdMs === null ? g.pid : null;
    if (g.createdMs !== null && info.createdMs !== null && Math.abs(info.createdMs - g.createdMs) > 1000) return null; // pid 已经被别的进程复用
    return g.pid;
  }

  /** 启动到一半被打断时，探针文件可能在收尾时才出现：如果是这次启动之后才有的游戏进程，也结束它。 */
  async killLateGame(sd) {
    let info;
    try {
      info = readProbeFile(this.o.probeFile);
    } catch {
      return;
    }
    if (!Number.isInteger(info.pid) || info.pid === this.game.pid || !isAlive(info.pid)) return;
    const pi = await processInfo(info.pid);
    if (!pi || pi.createdMs === null || pi.createdMs < this.launchMs) return;
    log(`收尾时发现这次启动的游戏进程 ${info.pid}，结束它`);
    const r = await killPid(info.pid, { tree: true });
    sd.forced = true;
    sd.killed.push({ pid: info.pid, what: 'game (late)', ok: r.ok, command: r.command, output: r.output });
    await waitUntil(() => !isAlive(info.pid), 10000);
    if (isAlive(info.pid)) sd.leftover.push({ pid: info.pid, what: 'game (late)' });
  }

  async sendQuit(sd) {
    try {
      await this.client.quit();
      sd.quitSent = true;
      log('已发送 /quit');
    } catch (e) {
      if (e instanceof ProbeError && e.code === 'connection_lost') {
        sd.quitSent = true;
        log('已发送 /quit（回复前连接断了，游戏可能已经在退出）');
        return;
      }
      sd.quitError = e instanceof ProbeError ? e.toJSON() : { error: 'internal', message: String(e) };
      log(`/quit 没成功：${sd.quitError.message}`);
    }
  }

  // ---- 结果 ----

  setFatal(e) {
    if (e instanceof ProbeError && e.code === 'aborted') {
      this.interrupted = true;
      return;
    }
    if (this.fatal || !e) return;
    if (e instanceof Fatal) this.fatal = { error: e.code, message: e.message, hint: e.hint };
    else if (e instanceof ProbeError) this.fatal = { error: e.code, message: e.message, hint: null };
    else this.fatal = { error: 'internal', message: String(e?.stack || e), hint: '这是 run-cards.mjs 自己的问题' };
    log(`出错：${this.fatal.message}`);
    if (this.fatal.hint) log(`提示：${this.fatal.hint}`);
  }

  exitCode() {
    if (this.fatal || this.interrupted) return 2;
    if (this.results.mode === 'launch' && this.results.shutdown?.leftover.length) return 2;
    return this.results.cards.every((c) => c.status === 'pass') ? 0 : 1;
  }

  summarize() {
    for (const c of this.results.cards) {
      if (c.status === 'pending' || c.status === 'running') c.status = this.interrupted ? 'interrupted' : 'skipped';
    }
    const count = (s) => this.results.cards.filter((c) => c.status === s).length;
    return { total: this.cards.length, pass: count('pass'), fail: count('fail'), interrupted: count('interrupted'), skipped: count('skipped') };
  }

  printSummary(code) {
    const s = this.results.summary;
    const extra = [s.fail && `${s.fail} 张失败`, s.interrupted && `${s.interrupted} 张被打断`, s.skipped && `${s.skipped} 张没跑`].filter(Boolean).join('，');
    log('');
    log(`结果：${s.pass}/${s.total} 张卡片通过${extra ? `（${extra}）` : ''}`);
    for (const c of this.results.cards) {
      if (c.status === 'fail') log(`  FAIL ${c.id}  第 ${c.failedStep.index} 步「${c.failedStep.desc}」：${c.failedStep.message}`);
      else if (c.status !== 'pass') log(`  ${c.status === 'interrupted' ? 'STOP' : 'SKIP'} ${c.id}`);
    }
    if (this.fatal) log(`出错：${this.fatal.message}`);
    if (this.interrupted) log('被打断了（Ctrl+C）');
    log(`详细结果：${displayPath(path.join(this.runDir, 'results.json'))}`);
    log(`退出码 ${code}`);
  }

  /** 写 results.json：先写临时文件再改名。Windows 上杀毒软件等可能刚好开着旧文件，改名会 EPERM，所以重试几次，
   *  实在不行就直接覆盖写。写结果失败不影响退出码，只打印出来。 */
  save() {
    const file = path.join(this.runDir, 'results.json');
    const tmp = `${file}.tmp`;
    const text = `${JSON.stringify(this.results, null, 2)}\n`;
    try {
      fs.writeFileSync(tmp, text);
      for (let i = 0; ; i++) {
        try {
          fs.renameSync(tmp, file);
          return;
        } catch (e) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || i >= 10) throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
      }
    } catch (e) {
      try {
        fs.writeFileSync(file, text);
        fs.rmSync(tmp, { force: true });
      } catch (e2) {
        log(`写不了 ${displayPath(file)}：${e2.message}（${e.message}）`);
      }
    }
  }

  // ---- Ctrl+C 等 ----

  installHandlers() {
    const onSignal = (sig) => {
      if (!this.abort.signal.aborted) {
        this.interrupted = true;
        log(`收到 ${sig}：停止跑卡片，正在让游戏退出（再按一次 Ctrl+C 就不等了，直接结束进程）…`);
        this.abort.abort();
      } else if (!this.force.signal.aborted) {
        log(`又收到 ${sig}：不等了，直接结束这次启动的进程`);
        this.force.abort();
      }
    };
    this.handlers = {
      SIGINT: () => onSignal('Ctrl+C'),
      SIGBREAK: () => onSignal('Ctrl+Break'),
      SIGTERM: () => onSignal('SIGTERM'),
      SIGHUP: () => {
        // 控制台窗口被关掉：Windows 只给几秒，直接结束进程
        onSignal('SIGHUP');
        this.force.abort();
      },
    };
    for (const [sig, h] of Object.entries(this.handlers)) {
      try {
        process.on(sig, h);
      } catch {
        // 这个平台没有这个信号
      }
    }
    // 测试用：父进程通过 IPC 发 {type:'interrupt'}，效果和 Ctrl+C 一样（Windows 上没法给子进程发真正的 Ctrl+C）
    this.onMessage = (m) => {
      if (m && m.type === 'interrupt') onSignal('interrupt');
    };
    if (process.channel) process.on('message', this.onMessage);
    this.onCrash = (e) => {
      console.error('run-cards.mjs 内部出错：', e?.stack || e);
      this.setFatal(e instanceof Error ? e : new Error(String(e)));
      if (!this.abort.signal.aborted) this.abort.abort();
    };
    process.on('uncaughtException', this.onCrash);
    process.on('unhandledRejection', this.onCrash);
  }

  removeHandlers() {
    for (const [sig, h] of Object.entries(this.handlers ?? {})) process.off(sig, h);
    if (this.onMessage) process.off('message', this.onMessage);
    process.off('uncaughtException', this.onCrash);
    process.off('unhandledRejection', this.onCrash);
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n用 --help 看用法`);
      return 2;
    }
    throw e;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const files = opts.files.length ? opts.files.map((f) => path.resolve(f)) : listDefaultCards();
  if (files.length === 0) {
    console.error('没有卡片：mod/cards/ 下没有 .yml 文件');
    return 2;
  }
  const cards = [];
  for (const f of files) {
    try {
      cards.push(loadCard(f));
    } catch (e) {
      if (e instanceof CardError) {
        console.error(`卡片写错了：${e.message}`);
        return 2;
      }
      throw e;
    }
  }
  log(`卡片：${cards.map((c) => c.id).join('、')}`);
  return new Runner(opts, cards).run();
}

function finish(code) {
  process.exitCode = code;
  if (process.channel) {
    try {
      process.disconnect();
    } catch {
      // 已经断了
    }
  }
  // 正常情况下事件循环空了自己退出（输出能写完）；万一有东西挂着，3 秒后强制退出。
  setTimeout(() => process.exit(code), 3000).unref();
}

main().then(finish, (e) => {
  console.error(e?.stack || e);
  finish(2);
});
