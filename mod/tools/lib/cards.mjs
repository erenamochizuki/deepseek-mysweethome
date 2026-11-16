// cards.mjs：读卡片（YAML 子集）、检查格式、执行每一步。卡片格式见 docs/PROBE.md「卡片格式」。

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlDocument, YamlError } from '../yaml-lite.mjs';
import { MOD_DIR, sleep, waitForStatus, ProbeError } from '../probe-client.mjs';
import { readBox, loadModelFile, compareBoxes, compareModels, boxCorners, BoxError, REPO_DIR, MAX_BOX_CELLS } from './box.mjs';
import { notePoseCommand, resetPose, expectedPose, poseDiff, poseText, parsePoseParam, POSE_SETTLE_MS } from './pose.mjs';
import { readShapes } from './shapes.mjs';

export const CARDS_DIR = path.join(MOD_DIR, 'cards');
/** 卡片 id、截图名都用这个规则（和探针的截图名规则一样）。 */
export const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const STATE_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+(\[([a-z0-9_]+=[a-z0-9_]+)(,[a-z0-9_]+=[a-z0-9_]+)*\])?$/;
const MAX_REGION_SIDE = 64;
/** 读卡片时先拿这个顶替 ${run} 检查格式（和真的运行编号一样长：YYYYMMDD-HHMMSS-n）。 */
export const SAMPLE_RUN = '20000101-000000-9';
const VAR_RE = /\$\{([^}]*)\}/g;

// 把参数里所有字符串的 ${run} 换掉（返回新的副本，不改原来的）
function substVars(v, runId) {
  if (typeof v === 'string') return v.replace(VAR_RE, (_m, name) => (name === 'run' ? runId : _m));
  if (Array.isArray(v)) return v.map((x) => substVars(x, runId));
  if (isObj(v)) {
    const out = {};
    for (const k of Object.keys(v)) Object.defineProperty(out, k, { value: substVars(v[k], runId), enumerable: true, writable: true, configurable: true });
    return out;
  }
  return v;
}
// 参数里有没有 ${…}；有不认识的变量名就返回它
function findVars(v, found = { any: false, bad: null }) {
  if (typeof v === 'string') {
    for (const m of v.matchAll(VAR_RE)) { found.any = true; if (m[1] !== 'run') found.bad ??= m[0]; }
    if (v.replace(VAR_RE, '').includes('${')) found.bad ??= v;
  } else if (Array.isArray(v)) v.forEach((x) => findVars(x, found));
  else if (isObj(v)) Object.keys(v).forEach((k) => findVars(v[k], found));
  return found;
}

/** 卡片文件本身写错了（带文件名和行号）。 */
export class CardError extends Error {
  constructor(reason, { file, line } = {}) {
    super(file ? `${displayPath(file)}${line ? `:${line}` : ''}: ${reason}` : reason);
    this.name = 'CardError';
    this.reason = reason;
    this.file = file;
    this.line = line;
  }
}

/** 某一步的检查没通过。expected / actual 会写进 results.json。 */
export class StepFailed extends Error {
  constructor(message, { expected, actual, result, code } = {}) {
    super(message);
    this.name = 'StepFailed';
    if (code) this.code = code; // 不写就是 check_failed
    this.expected = expected;
    this.actual = actual;
    this.result = result;
  }
}

/** 截图前（或截图时）玩家不在卡片要的位置、朝向上 → 错误码 pose_changed */
function poseChanged(when, want, got, problems, result) {
  return new StepFailed(`${when}玩家的位置或朝向变了（可能有人动了键盘鼠标，或者卡片 tp 之后又移动了玩家）：期望 ${poseText(want)}，实际 ${poseText(got)}（${problems.join('，')}）`, {
    code: 'pose_changed', expected: { pose: want }, actual: { pose: got ?? null, problems }, result,
  });
}
// 站位差多少，写进 results.json（留 4 位小数，免得一长串）
const round4 = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
const diffNums = (d) => ({ dist: round4(d.dist), dYaw: round4(d.dYaw), dPitch: round4(d.dPitch) });

export function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPos = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isSafeInteger);
const j = (v) => JSON.stringify(v);

/** mod/cards/ 下的全部 .yml / .yaml，按文件名排序。 */
export function listDefaultCards(dir = CARDS_DIR) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => /\.ya?ml$/i.test(n)).sort().map((n) => path.join(dir, n));
}

/** 读一张卡片并检查格式。返回 { id, title, file, steps: [{ type, index, line, params }] }，写错了抛 CardError。 */
export function loadCard(file) {
  const abs = path.resolve(file);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new CardError(e.code === 'ENOENT' ? '文件不存在' : `读不了：${e.message}`, { file: abs });
  }
  let doc;
  try {
    doc = parseYamlDocument(text, { filename: abs });
  } catch (e) {
    if (e instanceof YamlError) throw new CardError(e.reason, { file: abs, line: e.line });
    throw e;
  }
  const top = doc.value;
  const bad = (msg, line) => {
    throw new CardError(msg, { file: abs, line });
  };
  if (!isObj(top)) bad('卡片最外层要写成「键: 值」，至少要有 steps', 1);
  for (const k of Object.keys(top)) {
    if (!['id', 'title', 'steps'].includes(k)) bad(`不认识的键「${k}」（最外层只能有 id、title、steps）`, doc.keyLine(top, k));
  }
  const id = top.id ?? path.basename(abs).replace(/\.ya?ml$/i, '');
  if (typeof id !== 'string' || !NAME_RE.test(id)) bad(`id 只能用字母、数字和 . _ -，1 到 64 个字符（不写就用文件名）：${j(id)}`, doc.keyLine(top, 'id') ?? 1);
  if (top.title !== undefined && typeof top.title !== 'string') bad('title 要是字符串', doc.keyLine(top, 'title'));
  if (!Array.isArray(top.steps) || top.steps.length === 0) bad('steps 要是一个不空的列表（每一步一行「- 步骤名」）', doc.keyLine(top, 'steps') ?? 1);
  const card = { id, title: top.title ?? '', file: abs, steps: [] };
  top.steps.forEach((raw, i) => card.steps.push(parseStep(raw, i, doc.itemLine(top.steps, i) ?? doc.keyLine(top, 'steps'), doc, card)));
  return card;
}

function parseStep(raw, index, line, doc, card) {
  const fail = (msg, l = line) => {
    throw new CardError(`第 ${index + 1} 步：${msg}`, { file: card.file, line: l });
  };
  let type;
  let p;
  if (typeof raw === 'string') type = raw;
  else if (isObj(raw)) {
    const keys = Object.keys(raw);
    if (keys.length !== 1) fail(`一步只能有一个键（步骤名），这里有 ${keys.length} 个：${keys.join('、')}。参数要缩进写在步骤名下面`);
    type = keys[0];
    p = raw[type];
  } else fail('每一步要写成「- 步骤名」或者「- 步骤名: 参数」');
  const def = STEPS[type];
  if (!def) fail(`不认识的步骤「${type}」（能用的：${Object.keys(STEPS).join('、')}）`);
  const keyLine = (k) => (isObj(p) ? doc.keyLine(p, k) : undefined) ?? line;
  const h = {
    card,
    fail,
    keyLine,
    obj(v, allowed, hint) {
      if (!isObj(v)) fail(hint ?? `${type} 的参数要写成「键: 值」`);
      for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`${type} 没有参数「${k}」（能用的：${allowed.join('、')}）`, keyLine(k));
    },
    num(v, name, min, max) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${name} 要是 ${min} 到 ${max} 之间的数字：${j(v)}`, keyLine(name));
      return v;
    },
    pos(v, name) {
      if (!isPos(v)) fail(`${name} 要写成 [x, y, z]（三个整数）：${j(v)}`, keyLine(name));
      return v;
    },
    state(v, name, l) {
      if (typeof v !== 'string' || !STATE_RE.test(v)) fail(`${name} 要是完整的方块状态，比如 minecraft:oak_log[axis=x]（要带 minecraft: 前缀，属性写成 名字=值，用逗号隔开）：${j(v)}`, l ?? keyLine(name));
      const m = v.match(/\[(.*)\]$/);
      if (m) {
        const names = m[1].split(',').map((kv) => kv.split('=')[0]);
        const sorted = [...names].sort();
        if (names.join() !== sorted.join()) fail(`${name} 的属性要按名字的字母顺序写（游戏读回来就是这个顺序）：应该是 ${sorted.join(', ')}`, l ?? keyLine(name));
        if (new Set(names).size !== names.length) fail(`${name} 里有重复的属性`, l ?? keyLine(name));
      }
      return v;
    },
    strList(v, name) {
      const list = typeof v === 'string' ? [v] : v;
      if (!Array.isArray(list) || list.length === 0 || !list.every((s) => typeof s === 'string' && s)) fail(`${name} 要是字符串，或者字符串列表`, keyLine(name));
      return list;
    },
  };
  const vars = findVars(p);
  if (vars.bad) fail(`不认识的变量「${vars.bad}」（只能用 \${run}：这次运行的编号）`);
  const step = { type, index, line, params: def.parse(vars.any ? substVars(p, SAMPLE_RUN) : p, h) };
  // 有 ${run} 的步骤：上面先用样例编号检查了格式，真正运行时再用真的编号算一遍参数
  if (vars.any) step.bind = (runId) => ({ type, index, line, params: def.parse(substVars(p, runId), h) });
  return step;
}

// ---- 每种步骤：parse（检查参数）、describe（控制台显示）、run（执行，返回结果；检查不过抛 StepFailed） ----

function pickStatus(s) {
  if (!s) return s ?? null;
  const { ready, screen, inWorld, chunksRendered, player, fps, snapshotAgeMs } = s;
  return { ready, screen, inWorld, chunksRendered, player, fps, snapshotAgeMs };
}

const STEPS = {
  open: {
    parse(p, h) {
      if (p === undefined || p === null) p = {};
      if (typeof p === 'string') p = { name: p };
      h.obj(p, ['name', 'seed']);
      const name = p.name ?? h.card.id;
      if (typeof name !== 'string' || !name.trim() || name.length > 64) h.fail('open 的 name 要是 1 到 64 个字符', h.keyLine('name'));
      if (p.seed !== undefined && !Number.isSafeInteger(p.seed)) h.fail('open 的 seed 要是整数', h.keyLine('seed'));
      return { name, seed: p.seed };
    },
    describe: (s) => `open ${s.params.name}`,
    async run({ params }, ctx) {
      const r = await ctx.client.openWorld({ name: params.name, seed: params.seed }, { signal: ctx.signal });
      resetPose(ctx); // 新世界：前面的 tp 不算了
      return { name: r.name, folder: r.folder };
    },
  },

  reopen: {
    parse(p, h) {
      if (p !== undefined && p !== null && !(isObj(p) && Object.keys(p).length === 0)) h.fail('reopen 不要参数');
      return {};
    },
    describe: () => 'reopen last probe world',
    async run(_s, ctx) {
      const r = await ctx.client.reopenWorld({ signal: ctx.signal });
      resetPose(ctx);
      return { folder: r.folder };
    },
  },

  pick: {
    parse(p, h) {
      h.obj(p, ['pos', 'includeData', 'hasReference', 'hasAlbum', 'maxBytes']);
      for (const key of ['includeData', 'hasReference', 'hasAlbum']) {
        if (p[key] !== undefined && typeof p[key] !== 'boolean') h.fail(`${key} must be boolean`);
      }
      if (p.maxBytes !== undefined && (!Number.isSafeInteger(p.maxBytes) || p.maxBytes < 1)) h.fail('maxBytes must be positive integer');
      return { ...p, pos: h.pos(p.pos, 'pos') };
    },
    describe: (s) => `pick ${s.params.pos.join(' ')}`,
    async run({ params }, ctx) {
      const r = await ctx.client.pick(params.pos, { includeData: params.includeData }, { signal: ctx.signal });
      if ((params.hasReference !== undefined && params.hasReference !== /^[0-9a-f]{64}$/.test(r.reference ?? ''))
          || (params.hasAlbum !== undefined && params.hasAlbum !== r.hasAlbum)
          || (params.maxBytes !== undefined && !(r.encodedBytes <= params.maxBytes))) {
        throw new StepFailed('pick item does not match expected payload', { expected: params, actual: r, result: r });
      }
      return r;
    },
  },

  leave: {
    parse(p, h) {
      if (p !== undefined && p !== null && !(isObj(p) && Object.keys(p).length === 0)) h.fail('leave 不要参数');
      return {};
    },
    describe: () => 'leave',
    async run(_s, ctx) {
      await ctx.client.leaveWorld({ signal: ctx.signal });
      resetPose(ctx);
      return {};
    },
  },

  wait: {
    parse(p, h) {
      h.obj(p, ['ready', 'screen', 'inWorld', 'chunksRendered', 'timeout', 'stableFor'], 'wait 要写条件，比如 wait: {inWorld: true, screen: null}');
      const cond = {};
      for (const k of ['ready', 'inWorld']) {
        if (k in p) {
          if (typeof p[k] !== 'boolean') h.fail(`${k} 要是 true 或 false`, h.keyLine(k));
          cond[k] = p[k];
        }
      }
      if ('chunksRendered' in p) {
        if (typeof p.chunksRendered !== 'boolean' && p.chunksRendered !== null) h.fail('chunksRendered 要是 true、false 或 null', h.keyLine('chunksRendered'));
        cond.chunksRendered = p.chunksRendered;
      }
      if ('screen' in p) {
        if (p.screen !== null && (typeof p.screen !== 'string' || !p.screen)) h.fail('screen 要是界面类名（比如 TitleScreen），或者 null（没开界面）', h.keyLine('screen'));
        cond.screen = p.screen;
      }
      if (Object.keys(cond).length === 0) h.fail('wait 至少要有一个条件：ready、screen、inWorld、chunksRendered');
      return { cond, timeout: h.num(p.timeout ?? 60, 'timeout', 0.1, 3600), stableFor: h.num(p.stableFor ?? 0, 'stableFor', 0, 600) };
    },
    describe: (s) => `wait ${Object.entries(s.params.cond).map(([k, v]) => `${k}=${j(v)}`).join(' ')}${s.params.stableFor ? ` stableFor=${s.params.stableFor}s` : ''}`,
    async run({ params }, ctx) {
      try {
        const r = await waitForStatus(ctx.client, params.cond, { timeoutMs: params.timeout * 1000, stableMs: params.stableFor * 1000, signal: ctx.signal });
        return { waitedMs: r.ms, polls: r.polls, status: pickStatus(r.status) };
      } catch (e) {
        if (e instanceof ProbeError && e.code === 'wait_timeout') throw new StepFailed(e.message, { expected: params.cond, actual: pickStatus(e.details?.last) });
        throw e;
      }
    },
  },

  cmd: {
    parse(p, h) {
      if (typeof p === 'string') p = { command: p };
      h.obj(p, ['command', 'as', 'success', 'outputContains', 'timeout', 'until', 'result'], 'cmd 后面写命令，比如「- cmd: time set noon」');
      if (typeof p.command !== 'string' || !p.command.trim()) h.fail('cmd 要有 command（命令文字）', h.keyLine('command'));
      if (p.as !== undefined && p.as !== 'player' && p.as !== 'server') h.fail('as 只能是 player 或 server', h.keyLine('as'));
      const success = p.success ?? true;
      if (success !== true && success !== false && success !== 'any') h.fail('success 只能是 true、false 或 any', h.keyLine('success'));
      if (p.result !== undefined) {
        if (!Number.isSafeInteger(p.result)) h.fail('result 要是整数（命令的 result 必须正好等于它）', h.keyLine('result'));
        if (p.until !== undefined) h.fail('result 和 until 不能一起用（until 里已经写了要等到的 result）', h.keyLine('result'));
        if (success !== true) h.fail('用了 result 的命令必须期望成功（不能和 success: false / any 一起用）', h.keyLine('success'));
      }
      let until;
      if (p.until !== undefined) {
        const u = typeof p.until === 'number' ? { result: p.until } : p.until;
        if (!isObj(u) || !Object.keys(u).every((k) => ['result', 'outputContains', 'timeout', 'interval'].includes(k))
          || (u.result === undefined && u.outputContains === undefined) || (u.result !== undefined && !Number.isSafeInteger(u.result))) {
          h.fail('until 写成「until: 0」、「until: {result: 0, timeout: 120, interval: 0.5}」（result 是整数）或「until: {outputContains: 文字, timeout: 10}」', h.keyLine('until'));
        }
        if (success !== true) h.fail('用了 until 的命令必须期望成功（不能和 success: false / any 一起用）', h.keyLine('success'));
        until = {
          result: u.result,
          outputContains: u.outputContains === undefined ? undefined : h.strList(u.outputContains, 'until.outputContains'),
          timeout: h.num(u.timeout ?? 60, 'until.timeout', 0.1, 3600),
          interval: h.num(u.interval ?? 0.5, 'until.interval', 0.05, 60),
        };
      }
      return {
        command: p.command,
        as: p.as,
        success,
        until,
        result: p.result,
        outputContains: p.outputContains === undefined ? undefined : h.strList(p.outputContains, 'outputContains'),
        timeout: p.timeout === undefined ? undefined : h.num(p.timeout, 'timeout', 0.1, 600),
      };
    },
    describe: (s) => `cmd ${s.params.command}${s.params.as === 'server' ? '  (as server)' : ''}${untilText(s.params.until)}${s.params.result !== undefined ? `  (result=${s.params.result})` : ''}`,
    async run(step, ctx) {
      const { params } = step;
      const t0 = Date.now();
      let r;
      let tries = 0;
      const u = params.until;
      // until：result 等于它（写了的话），输出里也都有 outputContains 的文字（写了的话）
      const missing = (res) => (u.outputContains ?? []).filter((s) => !(Array.isArray(res.output) ? res.output : []).join('\n').includes(s));
      for (;;) {
        r = await ctx.client.command(params.command, { as: params.as }, { signal: ctx.signal, ...(params.timeout ? { timeoutMs: params.timeout * 1000 } : {}) });
        tries++;
        if (!u || r.success !== true || ((u.result === undefined || r.result === u.result) && missing(r).length === 0)) break;
        if (Date.now() - t0 + u.interval * 1000 > u.timeout * 1000) {
          const why = u.result !== undefined && r.result !== u.result
            ? `result 一直不是 ${u.result}，最后一次是 ${r.result}`
            : `输出里一直没有「${missing(r).join('」「')}」，最后一次：${(r.output ?? []).join(' | ') || '（没有）'}`;
          throw new StepFailed(`等了 ${u.timeout} 秒（执行了 ${tries} 次），${why}`, {
            expected: { result: u.result, outputContains: u.outputContains }, actual: { success: r.success, result: r.result, output: r.output }, result: { tries },
          });
        }
        await sleep(u.interval * 1000, ctx.signal);
      }
      if (r.success === true) notePoseCommand(ctx, step, params.command, params.as); // tp 成功了：记下应该站在哪，截图前核对
      const output = Array.isArray(r.output) ? r.output : [];
      const result = { success: r.success, result: r.result, output, ...(params.until ? { tries, waitedMs: Date.now() - t0 } : {}) };
      const problems = [];
      if (params.success !== 'any' && r.success !== params.success) problems.push(`命令执行${r.success ? '成功' : '失败'}了，期望${params.success ? '成功' : '失败'}`);
      else if (params.result !== undefined && r.result !== params.result) problems.push(`result 是 ${r.result}，期望 ${params.result}`);
      const text = output.join('\n');
      for (const s of params.outputContains ?? []) if (!text.includes(s)) problems.push(`输出里没有「${s}」`);
      if (problems.length) {
        throw new StepFailed(`${problems.join('；')}。游戏输出：${output.length ? output.join(' | ') : '（没有）'}`, {
          expected: { success: params.success, result: params.result, outputContains: params.outputContains },
          actual: { success: r.success, result: r.result, output },
          result,
        });
      }
      return result;
    },
  },

  expect_block: {
    parse(p, h) {
      h.obj(p, ['pos', 'state', 'blockEntityContains', 'dim']);
      if (p.dim !== undefined && (typeof p.dim !== 'string' || !p.dim)) h.fail('dim 要是维度名，比如 minecraft:overworld', h.keyLine('dim'));
      return {
        pos: h.pos(p.pos, 'pos'),
        state: h.state(p.state, 'state'),
        blockEntityContains: p.blockEntityContains === undefined ? undefined : h.strList(p.blockEntityContains, 'blockEntityContains'),
        dim: p.dim,
      };
    },
    describe: (s) => `expect_block ${s.params.pos.join(' ')}`,
    async run({ params }, ctx) {
      const r = await ctx.client.block(params.pos, { dim: params.dim }, { signal: ctx.signal });
      const be = r.blockEntity === null || r.blockEntity === undefined ? null : typeof r.blockEntity === 'string' ? r.blockEntity : j(r.blockEntity);
      const result = { state: r.state, blockEntity: be };
      const problems = [];
      if (r.state !== params.state) problems.push(`方块状态不一样：期望 ${params.state}，实际 ${r.state}`);
      for (const s of params.blockEntityContains ?? []) {
        if (be === null) {
          problems.push(`这里没有方块实体（期望里面有「${s}」）`);
          break;
        }
        if (!be.includes(s)) problems.push(`方块实体里没有「${s}」`);
      }
      if (problems.length) {
        throw new StepFailed(problems.join('；'), {
          expected: { state: params.state, blockEntityContains: params.blockEntityContains },
          actual: { state: r.state, blockEntity: be },
          result,
        });
      }
      return result;
    },
  },

  // 模拟玩家右键一个方块（探针接口 12 /use，2026-11-08 mod7 加）：换照片之类。不发真实键鼠。
  // 检查（都可以不写）：consumed（右键有没有起作用，true / false）、actionBarContains（动作栏的字里要有这些）。
  use: {
    parse(p, h) {
      h.obj(p, ['pos', 'face', 'hit', 'sneak', 'consumed', 'actionBarContains']);
      const faces = ['down', 'up', 'north', 'south', 'west', 'east'];
      if (p.face !== undefined && !faces.includes(p.face)) h.fail(`face 只能是 ${faces.join('、')}`, h.keyLine('face'));
      if (p.hit !== undefined && !(Array.isArray(p.hit) && p.hit.length === 3 && p.hit.every((v) => typeof v === 'number' && Number.isFinite(v)))) {
        h.fail('hit 要写成 [x, y, z]（世界坐标，可以有小数）', h.keyLine('hit'));
      }
      if (p.sneak !== undefined && typeof p.sneak !== 'boolean') h.fail('sneak 只能是 true 或 false', h.keyLine('sneak'));
      if (p.consumed !== undefined && typeof p.consumed !== 'boolean') h.fail('consumed 只能是 true 或 false', h.keyLine('consumed'));
      return {
        pos: h.pos(p.pos, 'pos'),
        face: p.face,
        hit: p.hit,
        sneak: p.sneak,
        consumed: p.consumed,
        actionBarContains: p.actionBarContains === undefined ? undefined : h.strList(p.actionBarContains, 'actionBarContains'),
      };
    },
    describe: (s) => `use ${s.params.pos.join(' ')}${s.params.face ? ` ${s.params.face}` : ''}${s.params.hit ? ` at ${s.params.hit.join(' ')}` : ''}${s.params.sneak ? '  (sneak)' : ''}`,
    async run({ params }, ctx) {
      const r = await ctx.client.use(params.pos, { face: params.face, hit: params.hit, sneak: params.sneak }, { signal: ctx.signal });
      const result = { result: r.result, consumed: r.consumed, actionBar: r.actionBar ?? null };
      const problems = [];
      if (params.consumed !== undefined && r.consumed !== params.consumed) problems.push(params.consumed ? `右键没有起作用（${r.result}）` : `右键起作用了（${r.result}），期望不起作用`);
      for (const s of params.actionBarContains ?? []) {
        if (typeof r.actionBar !== 'string') {
          problems.push(`动作栏没有新的字（期望里面有「${s}」）`);
          break;
        }
        if (!r.actionBar.includes(s)) problems.push(`动作栏的字里没有「${s}」：${r.actionBar}`);
      }
      if (problems.length) {
        throw new StepFailed(problems.join('；'), {
          expected: { consumed: params.consumed, actionBarContains: params.actionBarContains },
          actual: result,
          result,
        });
      }
      return result;
    },
  },

  expect_region: {
    parse(p, h) {
      h.obj(p, ['from', 'to', 'size', 'palette', 'at', 'dim']);
      const from = h.pos(p.from, 'from');
      const to = h.pos(p.to, 'to');
      const min = from.map((v, i) => Math.min(v, to[i]));
      const max = from.map((v, i) => Math.max(v, to[i]));
      const realSize = max.map((v, i) => v - min[i] + 1);
      if (realSize.some((n) => n > MAX_REGION_SIDE)) h.fail(`区域每个方向最多 ${MAX_REGION_SIDE} 格，这里是 ${realSize.join('×')}`, h.keyLine('to'));
      let size;
      if (p.size !== undefined) {
        size = h.pos(p.size, 'size');
        if (size.join() !== realSize.join()) h.fail(`size 写的是 [${size.join(', ')}]，但 from/to 算出来是 [${realSize.join(', ')}]`, h.keyLine('size'));
      }
      let palette;
      if (p.palette !== undefined) {
        if (!Array.isArray(p.palette) || p.palette.length === 0) h.fail('palette 要是方块状态的列表', h.keyLine('palette'));
        palette = p.palette.map((s, i) => h.state(s, `palette 第 ${i + 1} 项`, h.keyLine('palette')));
      }
      let at;
      if (p.at !== undefined) {
        const list = isObj(p.at) ? [p.at] : p.at;
        if (!Array.isArray(list) || list.length === 0) h.fail('at 要是列表，每一项是 {pos: [x, y, z], state: ...}', h.keyLine('at'));
        at = list.map((a, i) => {
          if (!isObj(a) || Object.keys(a).some((k) => k !== 'pos' && k !== 'state')) h.fail(`at 第 ${i + 1} 项要写成 {pos: [x, y, z], state: ...}`, h.keyLine('at'));
          if (!isPos(a.pos)) h.fail(`at 第 ${i + 1} 项的 pos 要是 [x, y, z]：${j(a.pos)}`, h.keyLine('at'));
          if (a.pos.some((v, k) => v < min[k] || v > max[k])) h.fail(`at 第 ${i + 1} 项的 pos [${a.pos.join(', ')}] 不在区域里`, h.keyLine('at'));
          return { pos: a.pos, state: h.state(a.state, `at 第 ${i + 1} 项的 state`, h.keyLine('at')) };
        });
      }
      if (!size && !palette && !at) h.fail('expect_region 至少要检查一样：size、palette、at');
      if (p.dim !== undefined && (typeof p.dim !== 'string' || !p.dim)) h.fail('dim 要是维度名', h.keyLine('dim'));
      return { from, to, size, palette, at, dim: p.dim };
    },
    describe: (s) => `expect_region ${s.params.from.join(' ')} ~ ${s.params.to.join(' ')}`,
    async run({ params }, ctx) {
      const r = await ctx.client.region(params.from, params.to, { dim: params.dim }, { signal: ctx.signal });
      const { origin, size, palette, blocks } = r;
      const result = { origin, size, palette, blockEntities: Array.isArray(r.blockEntities) ? r.blockEntities.length : null };
      if (!isPos(origin) || !isPos(size) || !Array.isArray(palette) || !Array.isArray(blocks) || blocks.length !== size[0] * size[1] * size[2]) {
        throw new StepFailed(`/region 的回复格式不对（origin/size/palette/blocks）`, { actual: result, result });
      }
      const problems = [];
      if (params.size && size.join() !== params.size.join()) problems.push(`size 期望 [${params.size.join(', ')}]，实际 [${size.join(', ')}]`);
      const missing = (params.palette ?? []).filter((s) => !palette.includes(s));
      if (missing.length) problems.push(`palette 里没有：${missing.join('、')}`);
      const atActual = (params.at ?? []).map(({ pos, state }) => {
        const [dx, dy, dz] = pos.map((v, k) => v - origin[k]);
        const got = dx >= 0 && dy >= 0 && dz >= 0 && dx < size[0] && dy < size[1] && dz < size[2] ? palette[blocks[dx + dz * size[0] + dy * size[0] * size[2]]] : undefined;
        if (got !== state) problems.push(`[${pos.join(', ')}] 期望 ${state}，实际 ${got ?? '（不在回复的区域里）'}`);
        return { pos, state: got ?? null };
      });
      if (problems.length) {
        throw new StepFailed(problems.join('；'), {
          expected: { size: params.size, palette: params.palette, at: params.at },
          actual: { size, palette, at: atActual },
          result,
        });
      }
      return result;
    },
  },

  shot: {
    parse(p, h) {
      if (p === undefined || p === null) p = {};
      if (typeof p === 'string') p = { name: p };
      h.obj(p, ['name', 'meanBrightness', 'distinctColors', 'hideGui', 'pose']);
      const name = p.name ?? h.card.id;
      if (typeof name !== 'string' || !NAME_RE.test(name)) h.fail(`截图名只能用字母、数字和 . _ -，1 到 64 个字符：${j(name)}`, h.keyLine('name'));
      const hideGui = p.hideGui;
      if (hideGui !== undefined && typeof hideGui !== 'boolean') h.fail(`hideGui 要写 true 或 false（不加引号）：${j(hideGui)}`, h.keyLine('hideGui'));
      let meanBrightness;
      if (p.meanBrightness !== undefined) {
        const b = p.meanBrightness;
        if (!Array.isArray(b) || b.length !== 2 || !b.every((v) => typeof v === 'number' && v >= 0 && v <= 1) || b[0] > b[1]) h.fail('meanBrightness 要写成 [最小, 最大]，都在 0 到 1 之间', h.keyLine('meanBrightness'));
        meanBrightness = b;
      }
      let distinctColors;
      if (p.distinctColors !== undefined) {
        if (!Number.isSafeInteger(p.distinctColors) || p.distinctColors < 1) h.fail('distinctColors 要是正整数（至少有多少种颜色）', h.keyLine('distinctColors'));
        distinctColors = p.distinctColors;
      }
      // pose：不写 = 跟着最近一次 tp 核对；false = 不核对；{x, y, z, yaw, pitch} = 按这个核对
      const pose = parsePoseParam(p.pose, h);
      return { name, meanBrightness, distinctColors, hideGui, pose };
    },
    describe: (s) => {
      const extra = [];
      if (s.params.hideGui !== undefined) extra.push(`hideGui=${s.params.hideGui}`);
      if (s.params.pose === false) extra.push('pose=false');
      else if (s.params.pose) extra.push(`pose=${poseText(s.params.pose)}`);
      return `shot ${s.params.name}${extra.length ? `  (${extra.join(', ')})` : ''}`;
    },
    async run({ params }, ctx) {
      // 截图前核对站位（docs/PROBE.md「卡片格式」shot）。tp 之后客户端要一两个 tick 才对上，最多等 POSE_SETTLE_MS
      const exp = expectedPose(params.pose, ctx);
      const want = exp.pose;
      let st = await ctx.client.status({ signal: ctx.signal });
      let before = want ? poseDiff(want, st.player) : null;
      for (const t0 = Date.now(); before?.problems.length && Date.now() - t0 < POSE_SETTLE_MS;) {
        await sleep(100, ctx.signal);
        st = await ctx.client.status({ signal: ctx.signal });
        before = poseDiff(want, st.player);
      }
      const player = st.player ?? null; // 截图前那一刻玩家在哪、朝哪（不在世界里就是 null）
      const pose = want ? { checked: true, source: exp.source, expected: want, before: diffNums(before) } : { checked: false, note: exp.note };
      if (before?.problems.length) throw poseChanged('截图前', want, st.player, before.problems, { path: null, copy: null, player, pose });
      const r = await ctx.client.screenshot({ name: params.name, hideGui: params.hideGui }, { signal: ctx.signal });
      // 截完马上再看一次：截图这段时间里被动过，这张图也不能算
      let after = null;
      if (want) {
        const st2 = await ctx.client.status({ signal: ctx.signal });
        after = poseDiff(want, st2.player);
        Object.assign(pose, { after: diffNums(after), playerAfter: st2.player ?? null });
      }
      const src = path.isAbsolute(r.path ?? '') ? r.path : path.resolve(MOD_DIR, 'run', r.path ?? '');
      const result = { path: src, copy: null, width: r.width, height: r.height, meanBrightness: r.meanBrightness, distinctColors: r.distinctColors, ms: r.ms, hideGui: params.hideGui, player, pose };
      const problems = [];
      if (!fs.existsSync(src)) problems.push(`截图文件不存在：${src}`);
      else if (ctx.shotsDir) {
        fs.mkdirSync(ctx.shotsDir, { recursive: true });
        const dst = path.join(ctx.shotsDir, path.basename(src));
        fs.copyFileSync(src, dst);
        result.copy = dst;
      }
      if (after?.problems.length) throw poseChanged('截图时', want, pose.playerAfter, after.problems, result); // 图留着给人看，但这一步不算过
      const [lo, hi] = params.meanBrightness ?? [];
      if (params.meanBrightness && !(r.meanBrightness >= lo && r.meanBrightness <= hi)) problems.push(`平均亮度 ${r.meanBrightness} 不在 [${lo}, ${hi}] 里`);
      if (params.distinctColors && !(r.distinctColors >= params.distinctColors)) problems.push(`颜色只有 ${r.distinctColors} 种，期望至少 ${params.distinctColors} 种`);
      if (problems.length) {
        throw new StepFailed(problems.join('；'), {
          expected: { meanBrightness: params.meanBrightness, distinctColors: params.distinctColors },
          actual: { meanBrightness: r.meanBrightness, distinctColors: r.distinctColors },
          result,
        });
      }
      return result;
    },
  },

  sleep: {
    parse(p, h) {
      if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 600) h.fail('sleep 后面写秒数（大于 0，最多 600），比如「- sleep: 1」');
      return { seconds: p };
    },
    describe: (s) => `sleep ${s.params.seconds}s`,
    async run({ params }, ctx) {
      await sleep(params.seconds * 1000, ctx.signal);
      return {};
    },
  },

  // ---- P2：记下一块区域、和它比、和文件比、复制文件 ----

  snapshot: {
    parse(p, h) {
      h.obj(p, ['name', 'from', 'to', 'dim'], 'snapshot 要写 name、from、to，比如 snapshot: {name: A, from: [0, -61, 0], to: [8, -57, 6]}');
      if (typeof p.name !== 'string' || !p.name || p.name.length > 64) h.fail('snapshot 要有 name（1 到 64 个字符）', h.keyLine('name'));
      const from = h.pos(p.from, 'from');
      const to = h.pos(p.to, 'to');
      const [lo, hi] = boxCorners(from, to);
      const cells = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (cells > MAX_BOX_CELLS) h.fail(`区域太大：${cells} 格（最多 ${MAX_BOX_CELLS} 格）`, h.keyLine('to'));
      return { name: p.name, from, to, dim: dimOf(p, h) };
    },
    describe: (s) => `snapshot ${s.params.name} ${j(s.params.from)}..${j(s.params.to)}`,
    async run({ params }, ctx) {
      const box = await boxStep(() => readBox(ctx.client, params.from, params.to, { dim: params.dim, signal: ctx.signal }));
      box.dim = params.dim;
      (ctx.snapshots ??= new Map()).set(params.name, box);
      return { origin: box.origin, size: box.size, blockEntities: box.bes.size };
    },
  },

  expect_same: {
    parse(p, h) {
      if (typeof p === 'string') p = { snapshot: p };
      h.obj(p, ['snapshot', 'at', 'dim'], 'expect_same 要写 snapshot（前面 snapshot 步骤的名字），可选 at（拿来比的那块的最小角）');
      if (typeof p.snapshot !== 'string' || !p.snapshot) h.fail('expect_same 要有 snapshot', h.keyLine('snapshot'));
      if (!h.card.steps.some((s) => s.type === 'snapshot' && s.params.name === p.snapshot)) h.fail(`前面没有叫「${p.snapshot}」的 snapshot 步骤`, h.keyLine('snapshot'));
      return { snapshot: p.snapshot, at: p.at === undefined ? undefined : h.pos(p.at, 'at'), dim: dimOf(p, h) };
    },
    describe: (s) => `expect_same ${s.params.snapshot}${s.params.at ? ` at ${j(s.params.at)}` : ''}`,
    async run({ params }, ctx) {
      const snap = (ctx.snapshots ??= new Map()).get(params.snapshot);
      if (!snap) throw new StepFailed(`还没有记下「${params.snapshot}」（snapshot 那一步没执行？）`);
      const lo = params.at ?? snap.origin;
      const hi = lo.map((v, k) => v + snap.size[k] - 1);
      const got = await boxStep(() => readBox(ctx.client, lo, hi, { dim: params.dim ?? snap.dim, signal: ctx.signal }));
      return sameOrFail(snap, got, `和 ${params.snapshot}（${j(snap.origin)} 起）`);
    },
  },

  expect_file: {
    parse(p, h) {
      h.obj(p, ['file', 'saved', 'at', 'size', 'offset', 'dim'], 'expect_file 要写 file（仓库里的文件）或 saved（游戏存的鲸图名），还有 at');
      if ((p.file === undefined) === (p.saved === undefined)) h.fail('expect_file 的 file 和 saved 要写一个，而且只写一个');
      const file = p.file === undefined ? undefined : repoFile(p.file, 'file', h, /\.(json|png|schem)$/i);
      if (p.saved !== undefined && !plainName(p.saved)) h.fail('saved 要是 xiaojingyu 文件夹里的文件名（不带路径，可以省掉 .png）', h.keyLine('saved'));
      return {
        file, saved: p.saved, at: h.pos(p.at, 'at'), dim: dimOf(p, h),
        size: p.size === undefined ? undefined : h.pos(p.size, 'size'),
        offset: p.offset === undefined ? undefined : h.pos(p.offset, 'offset'),
      };
    },
    describe: (s) => `expect_file ${s.params.saved ?? path.relative(REPO_DIR, s.params.file).replaceAll('\\', '/')} at ${j(s.params.at)}`,
    async run({ params }, ctx) {
      const file = params.file ?? path.join(xjyDir(ctx), /\.(png|schem)$/i.test(params.saved) ? params.saved : params.saved + '.png');
      const name = path.basename(file);
      const want = await boxStep(() => loadModelFile(file, { signal: ctx.signal }));
      if (params.size && params.size.join() !== want.size.join()) {
        throw new StepFailed(`${name} 的大小是 ${want.size.join('×')}，期望 ${params.size.join('×')}`, { expected: { size: params.size }, actual: { size: want.size } });
      }
      if (params.offset && params.offset.join() !== (want.offset ?? []).join()) {
        throw new StepFailed(`${name} 的 offset 是 ${j(want.offset)}，期望 ${j(params.offset)}`, { expected: { offset: params.offset }, actual: { offset: want.offset } });
      }
      const hi = params.at.map((v, k) => v + want.size[k] - 1);
      const got = await boxStep(() => readBox(ctx.client, params.at, hi, { dim: params.dim, signal: ctx.signal }));
      return { file: displayPath(file), ...sameOrFail(want, got, `和 ${name} `) };
    },
  },

  // ---- capture 上次（COMMANDS.md §2b）：两个鲸图逐格比，不读世界 ----

  expect_files: {
    parse(p, h) {
      h.obj(p, ['file', 'saved', 'capture', 'diffs', 'fromPlace'], 'expect_files 要写原来的文件（file：仓库里的；或 saved：xiaojingyu 文件夹里的）和 capture（xjy capture 抓出来的文件名），可选 diffs、fromPlace');
      if ((p.file === undefined) === (p.saved === undefined)) h.fail('expect_files 的 file 和 saved 要写一个，而且只写一个（原来的那个文件）');
      const file = p.file === undefined ? undefined : repoFile(p.file, 'file', h, /\.(json|png|schem)$/i);
      if (p.saved !== undefined && !plainName(p.saved)) h.fail('saved 要是 xiaojingyu 文件夹里的文件名（不带路径，可以省掉 .png）', h.keyLine('saved'));
      if (!plainName(p.capture)) h.fail('capture 要是 xjy capture 抓出来的文件名（xiaojingyu 文件夹里的，不带路径，可以省掉 .png）', h.keyLine('capture'));
      let diffs = [];
      if (p.diffs !== undefined) {
        if (!Array.isArray(p.diffs)) h.fail('diffs 要是列表，每一项是 {pos: [x, y, z], was: 原来的状态, now: 抓出来的状态}', h.keyLine('diffs'));
        const seen = new Set();
        diffs = p.diffs.map((d, i) => {
          if (!isObj(d) || Object.keys(d).some((k) => !['pos', 'was', 'now'].includes(k))) h.fail(`diffs 第 ${i + 1} 项要写成 {pos: [x, y, z], was: …, now: …}`, h.keyLine('diffs'));
          if (!isPos(d.pos) || d.pos.some((v) => v < 0)) h.fail(`diffs 第 ${i + 1} 项的 pos 要是模型里的格子 [x, y, z]（从 0 起）：${j(d.pos)}`, h.keyLine('diffs'));
          if (seen.has(d.pos.join())) h.fail(`diffs 里 [${d.pos.join(', ')}] 写了两次`, h.keyLine('diffs'));
          seen.add(d.pos.join());
          const was = h.state(d.was, `diffs 第 ${i + 1} 项的 was`, h.keyLine('diffs'));
          const now = h.state(d.now, `diffs 第 ${i + 1} 项的 now`, h.keyLine('diffs'));
          if (was === now) h.fail(`diffs 第 ${i + 1} 项的 was 和 now 一样`, h.keyLine('diffs'));
          return { pos: d.pos, was, now };
        });
      }
      let fromPlace;
      if (p.fromPlace !== undefined) {
        const f = p.fromPlace;
        if (!isObj(f) || Object.keys(f).some((k) => k !== 'file' && k !== 'turn') || !plainName(f.file) || ![0, 90, 180, 270].includes(f.turn)) {
          h.fail('fromPlace 要写成 {file: 当初 place 的文件名（带扩展名）, turn: 0、90、180 或 270}', h.keyLine('fromPlace'));
        }
        fromPlace = { file: f.file, turn: f.turn };
      }
      return { file, saved: p.saved, capture: p.capture, diffs, fromPlace };
    },
    describe: (s) => `expect_files ${s.params.saved ?? path.relative(REPO_DIR, s.params.file).replaceAll('\\', '/')} vs ${s.params.capture}${s.params.diffs.length ? `  (${s.params.diffs.length} 处不一样)` : ''}`,
    async run({ params }, ctx) {
      const inXjy = (n) => path.join(xjyDir(ctx), /\.(png|schem)$/i.test(n) ? n : n + '.png');
      const wantFile = params.file ?? inXjy(params.saved);
      const gotFile = inXjy(params.capture);
      const want = await boxStep(() => loadModelFile(wantFile, { signal: ctx.signal }));
      const got = await boxStep(() => loadModelFile(gotFile, { signal: ctx.signal }));
      const a = path.basename(wantFile);
      const b = path.basename(gotFile);
      const problems = [];
      if (want.size.join() !== got.size.join()) problems.push(`大小：${a} 是 ${want.size.join('×')}，${b} 是 ${got.size.join('×')}`);
      const off = (m) => (m.offset ?? [0, 0, 0]).join(', ');
      if (off(want) !== off(got)) problems.push(`Offset：${a} 是 [${off(want)}]，${b} 是 [${off(got)}]`);
      if (want.facing !== got.facing) problems.push(`Facing：${a} 是 ${want.facing ?? '（没有）'}，${b} 是 ${got.facing ?? '（没有）'}`);
      const fp = got.meta?.compound?.Xiaojingyu?.compound?.FromPlace?.compound;
      const fromPlace = fp ? { file: fp.File?.string ?? null, turn: fp.Turn?.int ?? null } : null;
      if (params.fromPlace && (fromPlace?.file !== params.fromPlace.file || fromPlace?.turn !== params.fromPlace.turn)) {
        problems.push(`${b} 的 FromPlace 期望 ${j(params.fromPlace)}，实际 ${j(fromPlace)}`);
      }
      const result = { file: displayPath(wantFile), capture: displayPath(gotFile), size: got.size, offset: got.offset, facing: got.facing, fromPlace, diffs: params.diffs.length };
      if (problems.length) throw new StepFailed(problems.join('；'), { expected: { size: want.size, offset: want.offset, facing: want.facing, fromPlace: params.fromPlace }, actual: { size: got.size, offset: got.offset, facing: got.facing, fromPlace }, result });
      const { count, problems: cells } = compareModels(want, got, { diffs: params.diffs });
      if (count) {
        throw new StepFailed(`${a} 和 ${b} 逐格比（卡片里写了 ${params.diffs.length} 处该不一样），有 ${count} 处不对：${cells.join('；')}${count > cells.length ? '；……' : ''}`, {
          expected: { diffs: params.diffs }, actual: { mismatches: count, first: cells }, result,
        });
      }
      return { ...result, cells: got.states.length, blockEntities: got.bes.size };
    },
  },

  // ---- P4：方块是不是游戏按邻居算出来的样子（探针 /shapes，只读）----

  expect_shapes: {
    parse(p, h) {
      h.obj(p, ['from', 'to', 'file', 'at', 'dim'], 'expect_shapes 要写 from、to（区域的两个角），或者 file（仓库里的 dump / 鲸图）加 at（第 (0,0,0) 格的世界坐标）');
      const byFile = p.file !== undefined || p.at !== undefined;
      if (byFile && (p.from !== undefined || p.to !== undefined)) h.fail('expect_shapes 写了 from/to 就不要再写 file/at（两种写法选一种）');
      const dim = dimOf(p, h);
      if (byFile) {
        if (p.file === undefined) h.fail('expect_shapes 写了 at，还要写 file（按文件的大小算区域）');
        return { file: repoFile(p.file, 'file', h, /\.(json|png|schem)$/i), at: h.pos(p.at, 'at'), dim };
      }
      const from = h.pos(p.from, 'from');
      const to = h.pos(p.to, 'to');
      const [lo, hi] = boxCorners(from, to);
      const cells = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (cells > MAX_BOX_CELLS) h.fail(`区域太大：${cells} 格（最多 ${MAX_BOX_CELLS} 格）`, h.keyLine('to'));
      return { from, to, dim };
    },
    describe: (s) => s.params.file
      ? `expect_shapes ${path.relative(REPO_DIR, s.params.file).replaceAll('\\', '/')} at ${j(s.params.at)}`
      : `expect_shapes ${j(s.params.from)}..${j(s.params.to)}`,
    async run({ params }, ctx) {
      let from = params.from;
      let to = params.to;
      if (params.file) {
        const want = await boxStep(() => loadModelFile(params.file, { signal: ctx.signal }));
        from = params.at;
        to = params.at.map((v, k) => v + want.size[k] - 1);
      }
      const r = await boxStep(() => readShapes(ctx.client, from, to, { dim: params.dim, signal: ctx.signal })).catch((e) => {
        if (e instanceof ProbeError && e.code === 'not_found') throw new StepFailed('这个探针太旧，没有 /shapes：重新编译、启动开发游戏（gradlew runClient）以后再跑', { code: 'shapes_unsupported' });
        throw e;
      });
      const result = { file: params.file ? displayPath(params.file) : undefined, ...r };
      const where = `[${r.origin.join(', ')}] 起 ${r.size.join('×')}`;
      if (r.checked === 0) throw new StepFailed(`${where} 全是空气，没有方块可查（坐标写错了？）`, { result });
      if (r.changed > 0) {
        const first = r.diffs.slice(0, 10);
        const list = first.map((d) => `[${d.pos.join(', ')}] 现在 ${d.state}，游戏算的 ${d.game}`).join('；');
        const more = r.changed > first.length ? `；……还有 ${r.changed - first.length} 处` : '';
        throw new StepFailed(`${where}：查了 ${r.checked} 格，有 ${r.changed} 格不是游戏按邻居算出来的样子（玩家在旁边一动就会变）：${list}${more}`, {
          expected: { changed: 0 }, actual: { checked: r.checked, changed: r.changed, truncated: r.truncated, first }, result,
        });
      }
      return result;
    },
  },

  copy_file: {
    parse(p, h) {
      h.obj(p, ['from', 'to'], 'copy_file 要写 from（仓库里的文件），可选 to（复制过去叫什么）');
      const from = repoFile(p.from, 'from', h);
      const to = p.to ?? path.basename(from);
      if (!plainName(to)) h.fail('to 只能是文件名（不带路径）', h.keyLine('to'));
      return { from, to };
    },
    describe: (s) => `copy_file ${path.relative(REPO_DIR, s.params.from).replaceAll('\\', '/')} -> xiaojingyu/${s.params.to}`,
    async run({ params }, ctx) {
      const dir = xjyDir(ctx);
      const dest = path.join(dir, params.to);
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.copyFileSync(params.from, dest, fs.constants.COPYFILE_EXCL);
      } catch (e) {
        if (e.code === 'EEXIST') throw new StepFailed(`xiaojingyu/${params.to} 已经有了，不覆盖（文件名里加上 \${run}，每次运行就不一样）`);
        throw e;
      }
      return { path: dest, bytes: fs.statSync(dest).size };
    },
  },

  // 改模组配置（游戏目录的 config/ 下，开发游戏是 mod/run/config/）。NeoForge 发现文件变了会自己重读（防抖约 0.5 秒），
  // 所以后面要等它生效（比如 cmd 的 until.outputContains 等 /xjy status 里出现新的数）。卡片结束时 runner 原样改回去。
  config: {
    parse(p, h) {
      h.obj(p, ['file', 'set'], 'config 要写 set（要改的键和值，比如 set: {captureBack: 7}），可选 file（config 文件夹里的 .toml，默认 xiaojingyu-common.toml）');
      const file = p.file ?? 'xiaojingyu-common.toml';
      if (!plainName(file) || !/\.toml$/i.test(file)) h.fail('file 要是 config 文件夹里的 .toml 文件名（不带路径）', h.keyLine('file'));
      if (!isObj(p.set) || Object.keys(p.set).length === 0) h.fail('set 要写成 {键: 值, …}，至少一个', h.keyLine('set'));
      for (const [k, v] of Object.entries(p.set)) {
        if (!TOML_KEY_RE.test(k)) h.fail(`set 的键只能有字母、数字、_ 和 -（顶层的键）：${j(k)}`, h.keyLine('set'));
        if (!Number.isSafeInteger(v) && typeof v !== 'boolean' && typeof v !== 'string') h.fail(`set 的 ${k} 要是整数、true / false 或字符串：${j(v)}`, h.keyLine('set'));
      }
      return { file, set: { ...p.set } };
    },
    describe: (s) => `config ${s.params.file} ${Object.entries(s.params.set).map(([k, v]) => `${k}=${j(v)}`).join(' ')}`,
    async run({ params }, ctx) {
      if (!ctx.gameDir) throw new StepFailed('不知道游戏目录在哪（ctx.gameDir 没设）');
      const dir = path.join(ctx.gameDir, 'config');
      const file = path.join(dir, params.file);
      let text = null;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      ctx.restoreFiles ??= new Map();
      if (!ctx.restoreFiles.has(file)) ctx.restoreFiles.set(file, text); // 记下这张卡片改之前的样子
      fs.mkdirSync(dir, { recursive: true });
      await writeFileReplacing(file, setTomlKeys(text ?? '', params.set), ctx.signal);
      return { path: file, set: params.set, created: text === null };
    },
  },
};

// cmd 的 until 在控制台怎么显示
function untilText(u) {
  if (!u) return '';
  const parts = [];
  if (u.result !== undefined) parts.push(`result=${u.result}`);
  if (u.outputContains) parts.push(`output has ${u.outputContains.map((s) => `「${s}」`).join('')}`);
  return `  (until ${parts.join(', ')})`;
}

// ---- config：改游戏目录 config/ 下的 .toml（模组配置）。卡片结束时 runner 把改过的文件原样写回去（restoreFiles）----

const TOML_KEY_RE = /^[A-Za-z0-9_-]+$/;
const tomlValue = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

/** 改 TOML 文字里顶层的 `键 = 值`（保留注释和别的行）；没有这个键就加在最前面（第一个 [表] 之前）。 */
export function setTomlKeys(text, set) {
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const add = [];
  for (const [k, v] of Object.entries(set)) {
    const re = new RegExp(`^([ \\t]*)${k}[ \\t]*=`);
    let found = false;
    let inTable = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^[ \t]*\[/.test(lines[i])) inTable = true;
      if (!inTable && re.test(lines[i])) {
        lines[i] = `${lines[i].match(re)[1]}${k} = ${tomlValue(v)}`;
        found = true;
      }
    }
    if (!found) add.push(`${k} = ${tomlValue(v)}`);
  }
  const out = [...add, ...lines];
  if (out.length && out[out.length - 1] !== '') out.push('');
  return out.join(eol);
}

// 先写临时文件再换掉原文件（游戏的配置监视器不会读到写了一半的文件）；Windows 上偶尔换不了就重试，最后直接写
async function writeFileReplacing(file, text, signal) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i >= 5) {
        fs.rmSync(tmp, { force: true });
        if (i >= 5) {
          fs.writeFileSync(file, text);
          return;
        }
        throw e;
      }
      await sleep(80, signal);
    }
  }
}

/**
 * 卡片结束时（过没过都调）：config 步骤改过的文件原样写回去（原来没有就删掉），免得改过的配置影响后面的卡片。
 * 返回写回去的文件路径列表。
 */
export async function restoreFiles(ctx) {
  const done = [];
  for (const [file, text] of [...(ctx.restoreFiles ?? new Map())].reverse()) {
    let now = null;
    try {
      now = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (now === text) continue;
    if (text === null) fs.rmSync(file, { force: true });
    else await writeFileReplacing(file, text);
    done.push(file);
  }
  ctx.restoreFiles?.clear();
  return done;
}

const plainName = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 100
  && /^[^\\/:*?"<>|\x00-\x1f]+$/.test(v) && !/^\.+$/.test(v) && !/[ .]$/.test(v);

function repoFile(v, name, h, exts) {
  const abs = typeof v === 'string' && v && !path.isAbsolute(v) ? path.resolve(REPO_DIR, v) : null;
  const rel = abs && path.relative(REPO_DIR, abs);
  if (!abs || rel.startsWith('..') || path.isAbsolute(rel)) h.fail(`${name} 要是仓库里的相对路径（比如 fixtures/share/js/p0-blocks.png）`, h.keyLine(name));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) h.fail(`${name} 不存在：${v}`, h.keyLine(name));
  if (exts && !exts.test(abs)) h.fail(`${name} 要是 .json（dump）、.png 或 .schem`, h.keyLine(name));
  return abs;
}

function dimOf(p, h) {
  if (p.dim === undefined) return undefined;
  if (typeof p.dim !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(p.dim)) h.fail('dim 要写成 minecraft:overworld 这样', h.keyLine('dim'));
  return p.dim;
}

// 游戏目录下的 xiaojingyu/（开发游戏里就是 mod/run/xiaojingyu/）
function xjyDir(ctx) {
  if (!ctx.gameDir) throw new StepFailed('不知道游戏目录在哪（ctx.gameDir 没设）');
  return path.join(ctx.gameDir, 'xiaojingyu');
}

async function boxStep(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BoxError) throw new StepFailed(e.message);
    throw e;
  }
}

function sameOrFail(want, got, what) {
  const { count, problems } = compareBoxes(want, got);
  if (count) {
    throw new StepFailed(`${what}比，有 ${count} 处不一样：${problems.join('；')}${count > problems.length ? '；……' : ''}`, {
      expected: { size: want.size }, actual: { origin: got.origin, size: got.size, mismatches: count, first: problems },
    });
  }
  return { origin: got.origin, size: got.size, cells: got.states.length, blockEntities: got.bes.size };
}

export const STEP_TYPES = Object.keys(STEPS);

export function describeStep(step) {
  return STEPS[step.type].describe(step);
}

/** 有 ${run} 的步骤，换成真的运行编号算出参数（没有 ${run} 的原样返回）。 */
export function bindStep(step, runId) {
  if (!step.bind) return step;
  if (!runId) throw new Error(`第 ${step.index + 1} 步用了 \${run}，但是没给运行编号（ctx.runId）`);
  return step.bind(runId);
}

/** 执行一步。ctx: { client, signal, shotsDir, runId, gameDir, snapshots }。检查不过抛 StepFailed，探针出错抛 ProbeError。 */
export function runStep(step, ctx) {
  const s = bindStep(step, ctx.runId);
  return STEPS[s.type].run(s, ctx);
}
