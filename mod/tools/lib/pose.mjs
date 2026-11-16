// 截图前核对站位：从卡片里的 tp 命令推出玩家应该站在哪、朝哪，和 /status 的 player 比。
//
// 怎么推，照 MC 26.1 源码（tmp/mod/src76/net/minecraft/）：
// - 坐标：WorldCoordinate.parseDouble —— x、z 写成不带小数点的数时 +0.5（站到方块中间），y 不加；
// - 朝向：RotationArgument 先 yaw 后 pitch，都不加 0.5；TeleportCommand 里 Mth.wrapDegrees，
//   Entity.setXRot 再把 pitch 夹到 [-90, 90]。
// 容差（lead 定的）：位置 ≤ 0.01 格；yaw 按 360° 取余后 ≤ 0.5°；pitch ≤ 0.5°。

export const POSE_TOLERANCE = Object.freeze({ pos: 0.01, yaw: 0.5, pitch: 0.5 });
/** tp 以后客户端要一两个 tick 才收到新位置：截图前最多等这么久让 /status 对上（只是等 tp 生效，容差不变） */
export const POSE_SETTLE_MS = 2000;

const NUM_RE = /^-?(\d+\.?\d*|\.\d+)$/; // Brigadier 读 double 只认数字、小数点和负号

/** Java 的 Mth.wrapDegrees：结果在 [-180, 180) */
export function wrapDegrees(v) {
  let r = v % 360;
  if (r >= 180) r -= 360;
  if (r < -180) r += 360;
  return r;
}

/** 两个角度差多少度（按 360° 取余，结果在 0 到 180 之间） */
export function angleDiff(a, b) {
  const d = (((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

/**
 * 一条命令会不会移动玩家、移到哪：
 *   null —— 不是 tp，不影响站位；
 *   { pose: {x, y, z, yaw, pitch} } —— `tp @s x y z yaw pitch`（as player，五个都是绝对值），算得出来；
 *   { pose: null, reason } —— 是 tp，但算不出来（相对坐标、facing、没写朝向、目标不是 @s……），就不核对。
 */
export function tpPose(command, as = 'player') {
  const w = String(command).trim().replace(/^\//, '').split(/\s+/);
  const bare = (t) => (t ?? '').replace(/^minecraft:/, '');
  const isTp = (t) => bare(t) === 'tp' || bare(t) === 'teleport';
  const unknown = (reason) => ({ pose: null, reason });
  if (!isTp(w[0])) return bare(w[0]) === 'execute' && w.some(isTp) ? unknown('用了 execute … tp') : null;
  if (as === 'server') return unknown('是 as server 执行的');
  const a = w.slice(1);
  if (a.includes('facing')) return unknown('用了 facing');
  if (a.length <= 2) return unknown('是 tp 到别的实体');
  if (a.length === 3 || a.length === 4) return unknown('没写朝向');
  if (a.length !== 6) return unknown('参数看不懂');
  if (a[0] !== '@s') return unknown(`的目标是 ${a[0]}，不是 @s`);
  const n = a.slice(1);
  if (n.some((t) => t.includes('~') || t.includes('^'))) return unknown('用了相对坐标（~ 或 ^）');
  if (!n.every((t) => NUM_RE.test(t))) return unknown('参数看不懂');
  const [x, y, z, yaw, pitch] = n.map(Number);
  const center = (t, v) => (t.includes('.') ? v : v + 0.5);
  return { pose: { x: center(n[0], x), y, z: center(n[2], z), yaw: wrapDegrees(yaw), pitch: Math.min(90, Math.max(-90, wrapDegrees(pitch))) } };
}

const r3 = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

/** 站位写成一行字：(x, y, z) yaw … pitch … */
export function poseText(p) {
  if (!p) return '（没有）';
  return `(${r3(p.x)}, ${r3(p.y)}, ${r3(p.z)}) yaw ${r3(p.yaw)} pitch ${r3(p.pitch)}`;
}

/** 期望和实际差多少。problems 是空的 = 对上了 */
export function poseDiff(want, got, tol = POSE_TOLERANCE) {
  if (!got) return { dist: null, dYaw: null, dPitch: null, problems: ['/status 里没有 player（不在世界里？）'] };
  const dist = Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z);
  const dYaw = angleDiff(got.yaw, want.yaw);
  const dPitch = Math.abs(got.pitch - want.pitch);
  const problems = [];
  if (!(dist <= tol.pos)) problems.push(`位置差 ${r3(dist)} 格`);
  if (!(dYaw <= tol.yaw)) problems.push(`yaw 差 ${r3(dYaw)}°`);
  if (!(dPitch <= tol.pitch)) problems.push(`pitch 差 ${r3(dPitch)}°`);
  return { dist, dYaw, dPitch, problems };
}

/** cmd 成功以后调：记下这条命令对站位的影响（不是 tp 就什么都不做） */
export function notePoseCommand(ctx, step, command, as) {
  const t = tpPose(command, as);
  if (t) ctx.lastTp = { ...t, index: step.index + 1, line: step.line }; // step.index 从 0 数；记成和控制台一样的「第 N 步」
}

/** open / leave 成功以后调：换了世界，前面的 tp 不算了 */
export function resetPose(ctx) {
  ctx.lastTp = null;
}

/** shot 要核对的期望站位：{ pose, source }；不核对时 { pose: null, note }（note 是给人看的一句话） */
export function expectedPose(poseParam, ctx) {
  if (poseParam === false) return { pose: null, note: '没核对：卡片里写了 pose: false' };
  if (poseParam) return { pose: poseParam, source: '卡片里的 pose' };
  const t = ctx.lastTp;
  if (!t) return { pose: null, note: '没核对：进世界以后卡片里还没有 tp 过' };
  if (!t.pose) return { pose: null, note: `没核对：最近一次 tp（第 ${t.index} 步）${t.reason}` };
  return { pose: t.pose, source: `第 ${t.index} 步的 tp` };
}

/**
 * 卡片 shot 的 pose 参数：不写（跟着最近一次 tp）、false（不核对），或者 {x, y, z, yaw, pitch}（五个都要写，都是数）。
 * 写错了调 h.fail，加载卡片时就报错。
 */
export function parsePoseParam(v, h) {
  if (v === undefined || v === false) return v;
  const line = h.keyLine('pose');
  if (v === null || typeof v !== 'object' || Array.isArray(v)) h.fail(`pose 要写 false（不核对），或者 {x: …, y: …, z: …, yaw: …, pitch: …}：${JSON.stringify(v)}`, line);
  const keys = ['x', 'y', 'z', 'yaw', 'pitch'];
  for (const k of Object.keys(v)) if (!keys.includes(k)) h.fail(`pose 里不认识「${k}」（只能有 x、y、z、yaw、pitch）`, line);
  for (const k of keys) if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) h.fail(`pose 的 ${k} 要写成数（x、y、z、yaw、pitch 五个都要写）：${JSON.stringify(v[k] ?? null)}`, line);
  if (v.pitch < -90 || v.pitch > 90) h.fail(`pose 的 pitch 要在 -90 到 90 之间：${v.pitch}`, line);
  return { x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch };
}
