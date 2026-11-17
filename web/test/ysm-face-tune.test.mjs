// 两件事的回归（2026-11-12）：
//
// 1. 「冬装小鲸鱼被戳的时候没有表情变化」
//    表情对照表（29-ysmui 的 FATFISH_TUNE.face）以前只在模型 id 是 'builtin:fatfish' 时才用。同一作者的
//    「蓝色大肥鱼(冬装)」是玩家导入的模型（id 随机），脸部选项一模一样，却拿不到这张表：被戳（laugh / surprised）、
//    说话（talk）、躲雷（pout）时脸不变。现在按模型自己的「脸部选项」认：同一套脸就用同一张表。
//
// 2. 滑条右边的数值可以直接输入（00-core 的 U.parseNumber / U.numField，69-settings 和 29-ysmui 共用）。
//
// 真实模块 + 真实 three，在 Node 里跑；不开浏览器、不构建。
//   node --test test/ysm-face-tune.test.mjs
// 冬装版不随源码分发：设 YSM_WINTER_ZIP=<zip 路径> 时再用真文件核对（不设就跳过那一项）。
// YSM_SRC_DIR=<另一份 src>：拿改动前的源码跑同一批断言（应当失败）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { requireGirlZip } from '../tools/lib/girl-asset.mjs';
requireGirlZip('ysm-face-tune');   // 第三方模型不进仓库：没有就跳过

const asset = await readFile(new URL('../assets/girl/fatfish-1.2.zip', import.meta.url));
const src = process.env.YSM_SRC_DIR ? { srcDir: process.env.YSM_SRC_DIR } : {};

// 29-ysmui 在模块顶层只碰 localStorage / indexedDB / document 的少数几样；给最小的替身就能加载它的纯逻辑部分。
function env() {
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const listeners = [];
  const document = { createElement: () => makeEl(), addEventListener() {}, body: makeEl(), head: makeEl() };
  const h = loadV3(['03-vox', '10-zip', '11-molang', '29-ysm', '29-ysmui'], { three: 'real', document, globals: { localStorage }, ...src });
  return { V: h.V3, T: h.window.THREE, window: h.window, store, listeners };
}
// 一个够用的假元素：记属性、事件监听、子节点
function makeEl() {
  const el = { attrs: {}, on: {}, kids: [], style: {}, classList: { toggle() {}, add() {}, remove() {} }, value: '', nodeType: 1, selected: 0, blurred: 0,
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'value') this.value = String(v); }, addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); },
    append(...c) { this.kids.push(...c); }, replaceChildren(...c) { this.kids = c; }, select() { this.selected++; }, blur() { this.blurred++; this.fire('blur'); },
    fire(t, e = {}) { const ev = Object.assign(e, { preventDefault() {}, stopPropagation() { ev.stopped = true; } }); for (const f of this.on[t] || []) f(ev); return ev; },
    set className(v) { this.attrs.class = v; }, get className() { return this.attrs.class || ''; }, set textContent(v) { this.text = v; }, get textContent() { return this.text || ''; } };
  return el;
}
async function load(V, bytes) {
  const model = V.ysm.load(await V.zip.read(bytes));
  model.textures = [];
  return model;
}
// 这一帧的脸：把所有名字里带 eye / mouth / face / brow 的骨骼的变换拼成一个签名
function faceSig(inst) {
  const parts = [];
  for (const b of inst.rig.list) if (/eye|mouth|face|brow|lid|teeth|tongue/i.test(b.name)) parts.push(b.name + ':' + [b.position.x, b.position.y, b.position.z, b.rotation.x, b.rotation.y, b.rotation.z, b.scale.x, b.scale.y, b.scale.z].map(v => v.toFixed(4)).join(','));
  return parts.join('|');
}
// 表情 expr 下站着不动演若干帧之后的脸。她的脸自己会动（眨眼、自动表情都跟着时间走），所以不能拿同一个实例
// 先后两段时间来比：每次新建一个实例，从 t = 0 起演同样的帧，只有 expr 不同 → 差别只可能来自表情对照表。
function faceUnder(V, model, opts, expr) {
  const inst = V.ysm.build(model, Object.assign({ height: 1.26 }, opts));
  inst.states.expr.value = expr;
  for (let i = 0; i < 12; i++) inst.update(0.05, i * 0.05);
  const sig = faceSig(inst), autoEyes = inst.getVar('roaming.auto_eyes'), longIdle = inst.longIdle;
  inst.dispose();
  return { sig, autoEyes, longIdle };
}

test('numbers typed next to a slider: what counts as a number', () => {
  const { V } = env(), P = V.util.parseNumber;
  assert.equal(P('7'), 7);
  assert.equal(P(' 7.5 '), 7.5);
  assert.equal(P('７．５'), 7.5, 'full-width digits and dot');
  assert.equal(P('7,5'), 7.5, 'comma as decimal point');
  assert.equal(P('7，5'), 7.5, 'full-width comma');
  assert.equal(P('12 分钟'), 12, 'a trailing unit is ignored');
  assert.equal(P('1.26米'), 1.26);
  assert.equal(P('.5'), 0.5);
  assert.equal(P('-3'), -3);
  assert.equal(P('50%', { pct: true }), 0.5, 'percent fields are typed as 0–100 and stored as 0–1');
  assert.equal(P('50', { pct: true }), 0.5);
  assert.equal(P('５０％', { pct: true }), 0.5);
  for (const bad of ['', '   ', 'abc', '米', '--', '.', 'NaN', null, undefined]) assert.equal(P(bad), null, JSON.stringify(bad) + ' is not a number');
  assert.equal(P('1e3'), 1, 'no exponent syntax: reads the leading number only');
});

test('the value box: edit, commit, clamp by the owner, cancel, step with arrows, and no clobbering while typing', () => {
  const { V } = env();
  let stored = 7; const sets = [];
  const owner = (v) => { sets.push(v); stored = Math.min(60, Math.max(0.5, Math.round(v / 0.5) * 0.5)); };   // what V3.game.set does: clamp + snap
  const field = V.util.numField({ cls: 'set-val', label: '间隔', step: 0.5, format: v => v.toFixed(1) + ' 分钟', edit: v => String(+v.toFixed(1)), get: () => stored, set: owner });
  const el = field.el;
  assert.equal(el.value, '7.0 分钟', 'shows the formatted value with its unit when idle');
  assert.equal(el.attrs.type, 'text');
  assert.equal(el.attrs.inputmode, 'decimal', 'numeric keypad on phones');

  el.fire('focus');
  assert.equal(el.value, '7', 'while editing: the bare number, no unit');
  assert.equal(el.selected, 1, 'and it is selected so typing replaces it');

  // the slider moves while the user is typing: the text must be left alone
  el.value = '12.';
  field.sync(9);
  assert.equal(el.value, '12.', 'outside updates never overwrite a half-typed value');

  el.value = '12.3';
  el.fire('keydown', { key: 'Enter' });
  assert.deepEqual(sets, [12.3], 'the typed number goes to the owner as typed');
  assert.equal(stored, 12.5, 'the owner snaps it to the step');
  assert.equal(el.value, '12.5 分钟', 'and the box shows what was really stored');
  assert.equal(el.blurred, 1);

  // out of range → clamped by the owner, shown clamped
  el.fire('focus'); el.value = '999'; el.fire('blur');
  assert.equal(stored, 60); assert.equal(el.value, '60.0 分钟');
  el.fire('focus'); el.value = '-4'; el.fire('blur');
  assert.equal(stored, 0.5); assert.equal(el.value, '0.5 分钟');

  // unreadable → nothing is set, the old value comes back
  const n = sets.length;
  el.fire('focus'); el.value = '多一点'; el.fire('blur');
  assert.equal(sets.length, n, 'garbage is not sent to the owner');
  assert.equal(el.value, '0.5 分钟');
  el.fire('focus'); el.value = ''; el.fire('blur');
  assert.equal(sets.length, n);

  // Escape discards and must not bubble (the settings panel closes on Escape)
  el.fire('focus'); el.value = '33';
  const ev = el.fire('keydown', { key: 'Escape' });
  assert.equal(ev.stopped, true, 'Escape is swallowed so the panel stays open');
  assert.equal(sets.length, n, 'Escape discards the edit');
  assert.equal(el.value, '0.5 分钟');
  el.fire('blur');
  assert.equal(sets.length, n, 'the blur that follows Escape does not commit either');

  // arrows step by one step from what is typed
  el.fire('focus'); el.value = '10';
  el.fire('keydown', { key: 'ArrowUp' });
  assert.equal(stored, 10.5); assert.equal(el.value, '10.5');
  el.fire('keydown', { key: 'ArrowDown' }); el.fire('keydown', { key: 'ArrowDown' });
  assert.equal(stored, 9.5);
  el.fire('blur');
  assert.equal(el.value, '9.5 分钟');

  // when idle, outside updates do show
  field.sync(20); assert.equal(el.value, '20.0 分钟');
});

test('percent fields are edited as 0–100', () => {
  const { V } = env();
  let stored = 0.5;
  const field = V.util.numField({ pct: true, step: 0.05, format: v => Math.round(v * 100) + '%', edit: v => String(Math.round(v * 100)), get: () => stored, set: v => { stored = Math.min(1, Math.max(0, Math.round(v / 0.05) * 0.05)); } });
  const el = field.el;
  assert.equal(el.value, '50%');
  el.fire('focus'); assert.equal(el.value, '50');
  el.value = '80'; el.fire('keydown', { key: 'Enter' });
  assert.ok(Math.abs(stored - 0.8) < 1e-9); assert.equal(el.value, '80%');
  el.fire('focus'); el.value = '33%'; el.fire('blur');
  assert.ok(Math.abs(stored - 0.35) < 1e-9, 'snapped to the 5 % step'); assert.equal(el.value, '35%');
  el.fire('focus'); el.fire('keydown', { key: 'ArrowUp' });
  assert.ok(Math.abs(stored - 0.4) < 1e-9, 'one arrow = one 5 % step'); assert.equal(el.value, '40');
});

test('a model with the same face options as the built-in one gets the same expression table', async () => {
  const { V } = env();
  const model = await load(V, asset);
  assert.equal(V.ysmUI.sameFaceAsFatfish(model), true, 'the bundled model has this face');
  // an imported copy: any id that is not the built-in one
  const tune = V.ysmUI.tuneOf('mmwd4w5w31v5g', model);
  assert.ok(tune && tune.face && tune.face.laugh && tune.face.talk, 'recognised by its face options, not by id');
  assert.equal(tune, V.ysmUI.BUILTIN[0].tune, 'the very same table');
  assert.equal(V.ysmUI.tuneOf('builtin:fatfish', model), V.ysmUI.BUILTIN[0].tune);
});

test('a different face layout is not touched', async () => {
  const { V } = env();
  const model = await load(V, asset);
  const strip = (pred) => ({ ...model, forms: model.forms.filter(pred) });
  assert.equal(V.ysmUI.tuneOf('x', strip(f => f.key !== 'roaming.pants_change')), null, 'no mouth option → no table');
  assert.equal(V.ysmUI.tuneOf('x', strip(f => f.key !== 'roaming.auto_eyes')), null, 'cannot switch auto expressions off → no table');
  assert.equal(V.ysmUI.tuneOf('x', { ...model, forms: [] }), null);
  assert.equal(V.ysmUI.tuneOf('x', null), null);
  // same variable names but the option statements drive another variable: not the same face
  const other = { ...model, forms: model.forms.map(f => f.key === 'roaming.pants_change' ? { ...f, labels: f.labels.map(([l, s]) => [l, s.replace(/roaming\.t=/g, 'roaming.zzz=')]) } : f) };
  assert.equal(V.ysmUI.tuneOf('x', other), null);
  // fewer mouth shapes than the table needs
  const few = { ...model, forms: model.forms.map(f => f.key === 'roaming.pants_change' ? { ...f, vals: f.vals.slice(0, 3), labels: f.labels.slice(0, 3) } : f) };
  assert.equal(V.ysmUI.tuneOf('x', few), null);
});

test('with the table, a poke changes the face; without it nothing changes (what the winter model did)', async () => {
  const { V } = env();
  const model = await load(V, asset);
  // built the way an imported model with this face is built now
  const tuned = { tune: V.ysmUI.tuneOf('imported-id', model) };
  const calm = faceUnder(V, model, tuned, 'happy');
  assert.equal(faceUnder(V, model, tuned, 'happy').sig, calm.sig, 'two identical runs give the same face (the comparison is deterministic)');
  for (const expr of ['laugh', 'surprised', 'sad', 'pout']) assert.notEqual(faceUnder(V, model, tuned, expr).sig, calm.sig, expr + ' must look different from the idle face');
  assert.notEqual(faceUnder(V, model, tuned, 'laugh').sig, faceUnder(V, model, tuned, 'sad').sig, 'and expressions differ from each other');
  // the player's own face settings are restored after each frame
  assert.equal(faceUnder(V, model, tuned, 'laugh').autoEyes, calm.autoEyes, 'the "disable auto expressions" setting is put back after the frame');
  // built the old way (no table): the face never changes — the reported symptom
  const idle = faceUnder(V, model, {}, 'happy');
  for (const expr of ['laugh', 'surprised', 'sad', 'pout', 'talk']) assert.equal(faceUnder(V, model, {}, expr).sig, idle.sig, 'without a table "' + expr + '" has no effect');
});

test('real winter-outfit model, when provided: recognised, and poking changes its face', { skip: !process.env.YSM_WINTER_ZIP }, async () => {
  const { V } = env();
  const model = await load(V, new Uint8Array(fs.readFileSync(process.env.YSM_WINTER_ZIP)));
  assert.match(String(model.meta.name), /冬装/);
  assert.equal(V.ysmUI.sameFaceAsFatfish(model), true);
  const tune = V.ysmUI.tuneOf('some-imported-id', model);
  assert.equal(tune, V.ysmUI.BUILTIN[0].tune);
  const calm = faceUnder(V, model, { tune }, 'happy');
  assert.notEqual(faceUnder(V, model, { tune }, 'laugh').sig, calm.sig, 'poked (laugh) looks different');
  assert.notEqual(faceUnder(V, model, { tune }, 'surprised').sig, calm.sig, 'poked (surprised) looks different');
  assert.equal(calm.longIdle, 62, 'the rest of the table (long idle) comes along');
  // and this is what it did before: built without a table, a poke changes nothing
  assert.equal(faceUnder(V, model, {}, 'laugh').sig, faceUnder(V, model, {}, 'happy').sig);
});
