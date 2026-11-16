// fake-game.mjs：测试 run-cards.mjs 启动模式用的假游戏，代替 gradlew.bat。不是测试文件（名字不是 *.test.mjs）。
// 进程关系模仿 Gradle daemon：client（相当于 gradlew 客户端，是 cmd.exe 的子进程）→ launcher（马上退出）
// → game（detached，父进程已经没了，所以不在 client 的进程树里，taskkill /T 结束 client 也结束不到它）。
// 环境变量：
//   XJY_PROBE_FILE        必需，探针文件写到哪（run-cards.mjs 会设）
//   XJY_FAKE_MODE         normal（默认）| hang-on-quit（收到 /quit 不退出）| client-hang（游戏退了 client 不退）
//                         | die-early（client 一开始就失败退出）| load-error（停在 LoadingErrorScreen）| no-probe（不写探针文件）
//   XJY_FAKE_READY_MS     多久到主菜单，默认 300
//   XJY_FAKE_PIDFILE      game 的 pid 写到哪，默认 <XJY_PROBE_FILE>.game-pid
//   XJY_FAKE_LIFETIME_MS  每个进程最多活多久，默认 120000（测试出意外时也不会一直留着）

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockProbe } from './mock-probe.mjs';

const SELF = fileURLToPath(import.meta.url);
const role = process.argv[2] ?? 'client';
const probeFile = process.env.XJY_PROBE_FILE;
const mode = process.env.XJY_FAKE_MODE ?? 'normal';
const pidFile = process.env.XJY_FAKE_PIDFILE ?? `${probeFile}.game-pid`;
// run-cards 开游戏时带 -Pxjyprobe.lockInput=true：用环境变量传给后面的 launcher、game（子进程会继承）
if (process.argv.includes('-Pxjyprobe.lockInput=true')) process.env.XJY_FAKE_LOCK_INPUT = '1';
const lockInput = process.env.XJY_FAKE_LOCK_INPUT === '1';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

if (!probeFile) {
  console.error('fake-game: 没有设 XJY_PROBE_FILE');
  process.exit(9);
}
setTimeout(() => process.exit(3), Number(process.env.XJY_FAKE_LIFETIME_MS ?? 120000)); // 正常情况下每条路都会自己先退出

if (role === 'client') {
  console.log(`> Task :runClient（假游戏，模式 ${mode}）`);
  if (mode === 'die-early') {
    console.log('FAILURE: Build failed with an exception.');
    console.log('* What went wrong: 这是假游戏故意报的错');
    process.exit(1);
  }
  fs.rmSync(pidFile, { force: true });
  const launcher = spawn(process.execPath, [SELF, 'launcher'], { stdio: 'ignore', windowsHide: true });
  launcher.on('exit', () => {
    let gamePid = null;
    try {
      gamePid = Number(fs.readFileSync(pidFile, 'utf8'));
    } catch {
      // 没写出来
    }
    console.log(`游戏进程 pid ${gamePid}`);
    const timer = setInterval(() => {
      if (gamePid && alive(gamePid)) return;
      clearInterval(timer);
      if (mode === 'client-hang') {
        console.log('游戏退出了，但 client 卡住不退');
        return;
      }
      console.log('BUILD SUCCESSFUL');
      process.exit(0);
    }, 200);
  });
} else if (role === 'launcher') {
  const game = spawn(process.execPath, [SELF, 'game'], { detached: true, stdio: 'ignore', windowsHide: true });
  fs.writeFileSync(pidFile, String(game.pid));
  game.unref();
  process.exit(0);
} else if (role === 'game') {
  if (mode !== 'no-probe') {
    await startMockProbe({
      dir: path.dirname(probeFile),
      probeFile,
      pid: process.pid,
      readyDelayMs: Number(process.env.XJY_FAKE_READY_MS ?? 300),
      loadError: mode === 'load-error',
      quitBehavior: mode === 'hang-on-quit' ? 'hang' : 'exit',
      inputLocked: lockInput, // 和真探针一样：启动参数要锁，一启动就锁着
      onQuit: () => process.exit(0),
    });
  }
  // no-probe：永远到不了主菜单，等着被结束（或者到点自己退出）
} else {
  console.error(`fake-game: 不认识的角色 ${role}`);
  process.exit(9);
}
