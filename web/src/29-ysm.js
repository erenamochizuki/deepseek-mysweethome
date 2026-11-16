// 29-ysm.js — 导入 YSM（我的世界「是，史蒂夫模型」模组）的**不加密**模型：文件 → 模型描述 → 场景里能动的角色。
// 支持：新版（ysm.json + models/ animations/ textures/ functions/）和旧版（main.json + *.animation.json + png）。
// 加密的 .ysm（文件头 YSGP）不解密，只读文件头里本来就是明文的信息：Y.header(bytes)。
// 几何：照 Blockbench 读基岩版模型的规则（x 取反；骨骼 / 方块旋转取 (−rx, −ry, rz)，欧拉 ZYX；盒子 UV / 逐面 UV / 镜像 / inflate），
//   整个模型放进转了 180° 的组里（Blockbench 里模型脸朝 −Z，我们约定脸朝 +Z）。
//   全部方块合成一个蒙皮网格（每个顶点只跟一根骨骼），一次绘制；每根骨骼一个面组（faceTags），反馈工具能按骨骼点选。
// 动画：基岩版 1.8.0 关键帧（数字 / Molang、pre/post、linear / catmullrom / step），位置 x 取反、旋转 x y 取反后加到骨骼上，
//   缩放相乘。主动画（idle / walk …）切换时 0.2 s 交叉淡化；extra 表情动作按需播放；时间轴 timeline、音效 sound_effects 按时间触发。
//   槽位 pre_parallel_0–7 → 主动画 → 手 → parallel_0–7：默认放 main 文件里同名的并行动画，动画控制器（JSON）或
//   脚本控制器（@player_ctrl_<槽位>.molang）可以接管；ysmGlow* 骨骼全亮（单独一个网格）。粒子、手持物品还不支持。
// Y.load(files: Map) → model；Y.build(model, { height, anchor, vars, tune }) → inst（65-girl-actor 和工作台都能用，约定见 docs/接入新小鲸鱼.md、docs/YSM.md）。
(function (V3) {
  'use strict';
  const Y = V3.ysm = V3.ysm || {};
  const DEG = Math.PI / 180;
  const dec = new TextDecoder('utf-8');
  const text = (b) => dec.decode(b).replace(/^﻿/, '');
  // JSON with // and /* */ comments (seen in Bedrock files)
  const stripComments = (s) => {
    let out = '', i = 0, str = false;
    while (i < s.length) {
      const c = s[i];
      if (str) { out += c; if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; } if (c === '"') str = false; i++; continue; }
      if (c === '"') { str = true; out += c; i++; continue; }
      if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
      out += c; i++;
    }
    return out;
  };
  const parseJSON = (b, name) => {
    const s = text(b);
    try { return JSON.parse(s); } catch (e) {
      try { return JSON.parse(stripComments(s).replace(/,(\s*[}\]])/g, '$1')); } catch (e2) { throw new Error(name + ' 不是有效的 JSON：' + e.message); }
    }
  };

  // ---- 加密的 .ysm：只读明文文件头 ------------------------------------------------------------------------------
  Y.isEncrypted = (b) => !!b && b.length > 8 && /^﻿?YSGP/.test(dec.decode(b.subarray(0, 8)));
  Y.header = (b) => {
    const lines = dec.decode(b.subarray(0, Math.min(b.length, 32768))).replace(/^﻿/, '').split(/\r?\n/);
    const h = { name: '', authors: [], license: '', free: null, tips: [], anims: [], textures: [], sounds: [], functions: [], format: '', crypto: '' };
    let sec = '', au = null;
    for (const raw of lines) {
      const s = raw.replace(/�/g, '');
      const m = /^-{3,}\s*\[\s*(.+?)\s*\]\s*-{3,}$/.exec(s.trim());
      if (m) { sec = m[1]; continue; }
      if (/^-{20,}$/.test(s.trim()) && sec === 'Codec Version') break;     // end of the plaintext header
      const t = /^(\s*)<([^>]+)>\s*(.*)$/.exec(s);
      if (sec === 'Tips') { if (s.trim()) h.tips.push(s.trim()); continue; }
      if (!t) continue;
      const ind = t[1].length, k = t[2], v = t[3].trim();
      if (sec === 'Metadata') {
        if (k === 'author') { au = { name: '', role: '', comment: '' }; h.authors.push(au); }
        else if (ind > 0 && au && /^(name|role|comment|contact)$/.test(k)) au[k] = v;
        else if (k === 'name') { h.name = v; au = null; }
        else if (k === 'license') h.license = v;
        else if (k === 'free') h.free = v === 'true';
      } else if (sec === 'Source SHA-256') {
        if (/^animation-/.test(k)) h.anims.push(k.slice(10));
        else if (k === 'texture') h.textures.push(v.split(/\s+/)[0]);
        else if (k === 'sound') h.sounds.push(v.split(/\s+/)[0]);
        else if (k === 'function') h.functions.push(v.split(/\s+/)[0]);
      } else if (sec === 'Codec Version') {
        if (k === 'format') h.format = v; else if (k === 'crypto') h.crypto = v;
      }
    }
    return h;
  };

  // ---- 文件 → 模型描述 -------------------------------------------------------------------------------------------------
  const stripTop = (files) => {
    const keys = [...files.keys()];
    if (!keys.length) return files;
    const top = keys[0].split('/')[0];
    if (keys.length > 0 && keys.every(k => k.startsWith(top + '/'))) {
      const m = new Map(); for (const [k, v] of files) m.set(k.slice(top.length + 1), v); return stripTop(m);
    }
    return files;
  };
  const baseName = (p) => String(p).split('/').pop().replace(/\.[^.]+$/, '');
  // geometry json (format 1.12+ 'minecraft:geometry' or older 'geometry.xxx') → { texW, texH, bones }
  function geoOf(j, name) {
    let g = j && j['minecraft:geometry'] && j['minecraft:geometry'][0], tw = 0, th = 0;
    if (g) { const d = g.description || {}; tw = d.texture_width; th = d.texture_height; }
    else {
      const k = j && Object.keys(j).find(x => /^geometry\./.test(x));
      if (!k) throw new Error(name + ' 里没有模型（minecraft:geometry）');
      g = j[k]; tw = g.texturewidth; th = g.textureheight;
    }
    return { texW: +tw || 64, texH: +th || 64, bones: Array.isArray(g.bones) ? g.bones : [] };
  }
  // 模型自带设置：properties.extra_animation_buttons[].config_forms → [{ group, type: range|checkbox|radio, title, desc, key, min, max, step, labels }]
  // value 必须是变量（v.roaming.Tail）；key 是去掉 v. 的小写名（和 Molang 上下文里的键一样）
  const mcText = (s) => String(s == null ? '' : s).replace(/§[0-9a-fk-or]/gi, '');   // MC 的颜色 / 粗体代码（§c §l §r …）
  function formsOf(props) {
    const out = [];
    for (const btn of (props && props.extra_animation_buttons) || []) for (const f of (btn && btn.config_forms) || []) {
      const m = /^\s*(?:v|variable)\.([\w.]+)\s*$/i.exec(String((f && f.value) || ''));
      if (!m || !/^(range|checkbox|radio)$/.test(f.type)) continue;
      const key = m[1].toLowerCase();
      const it = { group: mcText(btn.name || btn.id || '设置').trim(), type: f.type, title: mcText(f.title || m[1]).replace(/[\s:：]+$/, ''),
        desc: mcText(f.description || '').trim(), key };
      if (f.type === 'range') Object.assign(it, { min: Number.isFinite(+f.min) ? +f.min : 0, max: Number.isFinite(+f.max) ? +f.max : 1, step: +f.step || 0.1 });
      if (f.type === 'radio') {
        // 每个选项是一句 Molang（"v.roaming.x=2;v.roaming.y=2"）：从里面找给本设置赋的值，用来标出当前选中的是哪个
        const set = new RegExp('(?:^|[^\\w.])(?:v|variable)\\.' + key.replace(/\./g, '\\.') + '\\s*=\\s*(-?\\d+(?:\\.\\d+)?)(?![\\w.])', 'i');
        it.labels = Object.entries(f.labels || {}).map(([label, stmt]) => [mcText(label), String(stmt)]);
        it.vals = it.labels.map(([, stmt]) => { const x = set.exec(stmt); return x ? +x[1] : null; });
      }
      out.push(it);
    }
    return out;
  }
  // load(files: Map(path → Uint8Array)) → { layout, meta, props, geo, anims: { group: { name: json } }, textures: [{ name, bytes }], functions, files }
  // 这根 ysmGlow* 骨骼是不是眼睛：自己或任何一级父骨骼的名字里有 eye / pupil / iris（不算 eyebrow、eyelash 这种）。
  // 自带模型和它的换装版：ysmGlowRightEyesBase → RightEyesBase → … → Eyes，八组都能认出来。
  // 父骨骼也要看：有的作者把发光方块放在叫 ysmGlow1 的骨骼里，再挂到 LeftEye 下面。
  const EYE_WORD = /eye|pupil|iris|瞳|眼/i, NOT_EYE = /eyebrow|eyelash|brow|眉|睫/i;
  const eyeName = (n) => { const s = String(n || '').replace(/^ysmGlow/i, ''); return EYE_WORD.test(s.replace(new RegExp(NOT_EYE.source, 'gi'), '')); };
  Y.isEyeGlowBone = (bone) => {
    if (!bone || !/^ysmGlow/.test(String(bone.name))) return false;
    for (let b = bone, i = 0; b && i < 32; b = b.parent, i++) { if (!b.isBone && i) break; if (eyeName(b.name)) return true; }
    return false;
  };

  Y.load = (input, opts) => {
    let files = new Map([...input].filter(([k]) => !/^__MACOSX\//.test(k) && !/(^|\/)\.DS_Store$/.test(k)));
    files = stripTop(files);
    const lower = new Map(); for (const k of files.keys()) lower.set(k.toLowerCase(), k);
    const get = (p) => { if (!p) return null; const k = lower.get(String(p).replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase()); return k ? files.get(k) : null; };
    const out = { layout: '', meta: {}, props: {}, geo: null, anims: {}, textures: [], functions: [], controllers: {}, sounds: {}, files };
    let fnDir = 'functions', soundDir = 'sounds';
    const yj = get('ysm.json');
    if (yj) {
      const j = parseJSON(yj, 'ysm.json');
      out.layout = 'v' + (j.spec || 2); out.meta = j.metadata || {}; out.props = j.properties || {};
      const P = (j.files && j.files.player) || {}, M = P.model || {};
      const mainPath = M.main || 'models/main.json', mb = get(mainPath);
      if (!mb) throw new Error('ysm.json 里写的模型文件找不到：' + mainPath);
      out.geo = geoOf(parseJSON(mb, mainPath), mainPath);
      const A = P.animation || {};
      for (const k in A) { const f = get(A[k]); if (f) { try { out.anims[k] = parseJSON(f, A[k]).animations || {}; } catch (e) { V3.err('ysm: ' + e.message); } } }
      for (const t of [].concat(P.texture || [])) {
        const p = typeof t === 'string' ? t : t && (t.uv || t.path);
        const b = get(p);
        if (b) out.textures.push({ name: baseName(p), bytes: b });
      }
      // 动画控制器：键是槽位名（player.parallel_7 …），见 YSM-FORMAT「Animation controllers」；同名后面的覆盖前面的
      for (const cp of [].concat(P.animation_controllers || [])) {
        const f = get(cp); if (!f) continue;
        try { Object.assign(out.controllers, parseJSON(f, cp).animation_controllers || {}); } catch (e) { V3.err('ysm: ' + e.message); }
      }
      if (P.function_path) fnDir = String(P.function_path).replace(/\\/g, '/').replace(/^\.?\/|\/$/g, '').toLowerCase();
      if (j.files && j.files.sound_path) soundDir = String(j.files.sound_path).replace(/\\/g, '/').replace(/^\.?\/|\/$/g, '').toLowerCase();
    } else if (get('main.json')) {
      out.layout = 'legacy';
      out.geo = geoOf(parseJSON(get('main.json'), 'main.json'), 'main.json');
      for (const [k, real] of lower) {
        const m = /^([^/]+)\.animation\.json$/.exec(k);
        if (m) { try { out.anims[m[1]] = parseJSON(files.get(real), real).animations || {}; } catch (e) { V3.err('ysm: ' + e.message); } }
      }
      for (const [k, real] of [...lower].sort()) if (/^[^/]+\.png$/.test(k)) out.textures.push({ name: baseName(real), bytes: files.get(real) });
      const info = get('info.json');
      if (info) { try { const j = parseJSON(info, 'info.json'); out.meta = { name: j.name, tips: j.tips, authors: j.authors, license: j.license }; } catch (e) { /* optional */ } }
    } else throw new Error('不是 YSM 模型：找不到 ysm.json，也找不到 main.json');
    // default texture first
    const def = out.props.default_texture;
    if (def) out.textures.sort((a, b) => (a.name === def ? -1 : b.name === def ? 1 : 0));
    // functions/*.molang: "name@hook.molang" → { name, hook, src }（目录按 ysm.json 的 function_path）
    const fnRe = new RegExp('^' + fnDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/(?:.*\\/)?([^/]*)@([^/]+)\\.molang$');
    for (const [k, real] of lower) {
      const m = fnRe.exec(k);
      if (m) out.functions.push({ name: m[1], hook: m[2], src: text(files.get(real)) });
    }
    // 音效：sounds/<名字>.ogg（动画的 sound_effects 用名字找；sound_path 可以改目录）
    const sdPre = soundDir + '/';
    for (const [k, real] of lower) if (k.startsWith(sdPre) && /\.(ogg|wav|mp3)$/.test(k)) out.sounds[k.slice(sdPre.length).replace(/\.(ogg|wav|mp3)$/, '')] = files.get(real);
    if (!out.meta.name) out.meta.name = (opts && opts.name) || 'YSM 模型';
    out.forms = formsOf(out.props);
    return out;
  };

  // ---- 几何：方块 → 蒙皮网格（Blockbench 的坐标规则）---------------------------------------------------------------
  // face corners TL TR BR BL seen from outside, as (x, y, z) picks of [min, max]; the box-UV rect's top-left texel goes to TL
  const FACE = {
    north: { n: [0, 0, -1], c: [[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]] },
    south: { n: [0, 0, 1], c: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]] },
    east: { n: [1, 0, 0], c: [[1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]] },
    west: { n: [-1, 0, 0], c: [[0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]] },
    up: { n: [0, 1, 0], c: [[1, 1, 1], [0, 1, 1], [0, 1, 0], [1, 1, 0]] },
    down: { n: [0, -1, 0], c: [[1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1]] },
  };
  const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
  // box UV rects [x1, y1, x2, y2] (x2 < x1 = flipped) for size w h d at offset u v (Blockbench floors sizes for box UV)
  function boxRects(u, v, size, mirror) {
    const w = Math.floor(size[0] + 1e-4), h = Math.floor(size[1] + 1e-4), d = Math.floor(size[2] + 1e-4);
    const R = {
      east: [u, v + d, u + d, v + d + h], north: [u + d, v + d, u + d + w, v + d + h],
      west: [u + d + w, v + d, u + 2 * d + w, v + d + h], south: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
      up: [u + d, v, u + d + w, v + d], down: [u + d + w, v + d, u + d + 2 * w, v],
    };
    if (mirror) {
      const e = R.east; R.east = R.west; R.west = e;
      for (const k in R) { const r = R[k]; R[k] = [r[2], r[1], r[0], r[3]]; }
    }
    return R;
  }
  const eulerZYX = (r) => new THREE.Euler(-(+r[0] || 0) * DEG, -(+r[1] || 0) * DEG, (+r[2] || 0) * DEG, 'ZYX');   // Bedrock → Blockbench
  const bbPos = (p) => [-(+p[0] || 0), +p[1] || 0, +p[2] || 0];
  const CAT = [[/^(all)?head$/i, '头'], [/arm|hand/i, '手臂'], [/leg|foot/i, '腿'], [/tail/i, '尾巴'], [/hair|ear|ahoge/i, '头']];
  // ---- 连成一体（2026-11-14）----------------------------------------------------------------------------------------
  // YSM 模型是几千个互相穿插的方块，原样画出来有三样毛病（Y.SOFT 是可调的数，长度单位：模型像素 px = 1/16）：
  //   ① 共面打架：两个方块各有一面落在同一个平面上、朝同一边、又互相盖着一部分。深度一样，谁在上面每个像素、每一帧都不一样，
  //      看起来是接缝上一条条互相干涉的条纹。给互相打架的方块排级（打架的两个不同级；只有两个时排在后面的那个高，和 MC 里
  //      后画的盖住先画的一样），按级整个往外胀一点（每级 lift px，最多 4 级 ≈ 1.5 mm）。一模一样大、叠在同一处的面不用管：
  //      顶点相同、深度逐位相同，一次绘制里后面的三角形稳定盖住前面的。
  //   ② 边上漏线：开着多重采样时，面边缘那一圈像素按像素中心取贴图，中心落在面外面 → 取到贴图上隔壁那一格（别的面的颜色），
  //      方块的棱上出现一段段虚线。贴图坐标往面里收 uvIn 格；材质再把贴图坐标改成 centroid 插值（centroidUv，WebGL2）。
  //   ③ 明暗一块一块：每个面一个法线，头发、裙摆这种一片片稍微错开角度的方块，太阳一照每片一个亮度。每个顶点的法线换成
  //      「radius px 以内、朝向相差不到 angle 度的面」按面积和距离加权的平均，再和原来的法线按 mix 混合：一缕头发、一圈裙摆的亮度
  //      连成一片，方块自己的棱（90°）不受影响。只算现在显示着的方块（备用的嘴型、收起来的饭盆这些缩成 0 的不参加，也不改）。
  // ①② 在建网格时做（soften），③ 在摆好默认姿势以后做（smoothNormals，Y.build 里；玩家改了模型设置可以再调 inst.resmooth()）。
  // 网址加 ysmsoft=0 可以整个关掉对照；Y.build(model, { soft: false }) 也一样。
  Y.SOFT = { on: true, lift: 0.012, uvIn: 0.02, radius: 3, angle: 55, mix: 0.8 };
  const softOn = (pre) => {
    if (pre && pre.soft === false) return false;
    try { if (typeof location !== 'undefined' && /[?&]ysmsoft=0(&|$)/.test(location.search)) return false; } catch (e) { /* no location (Node) */ }
    return Y.SOFT.on !== false;
  };
  const PX = 1 / 16, QW = 15;
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  // 每个面（4 个顶点，顺序 TL TR BR BL）15 个数：中心 c(0..2)、法线 n(3..5)、两条边的方向 e1(6..8) e2(9..11)、半长 h1 h2(12, 13)、外接半径(14)
  function quadsOf(pos, nor, nq) {
    const Q = new Float32Array(nq * QW);
    for (let i = 0; i < nq; i++) {
      const o = i * 12, q = i * QW;
      const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];          // TL → TR
      const bx = pos[o + 9] - pos[o], by = pos[o + 10] - pos[o + 1], bz = pos[o + 11] - pos[o + 2];        // TL → BL
      const la = Math.hypot(ax, ay, az) || 1e-9, lb = Math.hypot(bx, by, bz) || 1e-9;
      Q[q] = (pos[o] + pos[o + 3] + pos[o + 6] + pos[o + 9]) / 4; Q[q + 1] = (pos[o + 1] + pos[o + 4] + pos[o + 7] + pos[o + 10]) / 4;
      Q[q + 2] = (pos[o + 2] + pos[o + 5] + pos[o + 8] + pos[o + 11]) / 4;
      Q[q + 3] = nor[o]; Q[q + 4] = nor[o + 1]; Q[q + 5] = nor[o + 2];
      Q[q + 6] = ax / la; Q[q + 7] = ay / la; Q[q + 8] = az / la; Q[q + 9] = bx / lb; Q[q + 10] = by / lb; Q[q + 11] = bz / lb;
      Q[q + 12] = la / 2; Q[q + 13] = lb / 2; Q[q + 14] = Math.hypot(la, lb) / 2;
    }
    return Q;
  }
  // ①②：pos / nor / uv 是 buildRig 的顶点数组，就地改；quadCube[i] = 第 i 个面属于第几个方块
  function soften(pos, nor, uv, quadCube, tw, th, noLift) {
    const S = Y.SOFT, nq = quadCube.length, t0 = nowMs(), info = { quads: nq, coplanar: 0, same: 0, lifted: 0, levels: 0, ms: 0 };
    if (!nq) return info;
    // ---- ① 共面又互相盖着的面 → 哪些方块互相打架 → 排级 → 按级往外胀 ----
    if (S.lift > 0) {
      const Q = quadsOf(pos, nor, nq);
      // 按（法线，平面位置）分格：共面的两个面这四个数几乎一样，只会落在同一格，或者正好跨在格子边上（那时才去看隔壁那一格）
      const NS = 64, DS = 256, TN = 0.1, TD = 0.05, cells = new Map();
      const keyOf = (a, b, c, d) => (((a + 80) * 161 + (b + 80)) * 161 + (c + 80)) * 20001 + (d + 10000);
      const F = new Float64Array(4), B = new Int32Array(4);
      const place = (i) => {
        const q = i * QW;
        F[0] = Q[q + 3] * NS + 0.5; F[1] = Q[q + 4] * NS + 0.5; F[2] = Q[q + 5] * NS + 0.5;
        F[3] = Math.max(-9990, Math.min(9990, (Q[q + 3] * Q[q] + Q[q + 4] * Q[q + 1] + Q[q + 5] * Q[q + 2]) * DS + 0.5));
        for (let k = 0; k < 4; k++) B[k] = Math.floor(F[k]);
      };
      for (let i = 0; i < nq; i++) {
        place(i);
        const k = keyOf(B[0], B[1], B[2], B[3]), L = cells.get(k);
        if (L) L.push(i); else cells.set(k, [i]);
      }
      // 长方形 i 在方向 (x, y, z) 上的两头（sign −1 / +1）
      const end = (i, x, y, z, sign) => {
        const q = i * QW;
        return Q[q] * x + Q[q + 1] * y + Q[q + 2] * z
          + sign * (Math.abs(Q[q + 6] * x + Q[q + 7] * y + Q[q + 8] * z) * Q[q + 12] + Math.abs(Q[q + 9] * x + Q[q + 10] * y + Q[q + 11] * z) * Q[q + 13]);
      };
      // 两个共面的长方形盖着多少：四条边方向上的分离轴。> 0 = 盖着，值是最浅的那个方向上的重叠宽度
      const overlap = (i, j) => {
        let pen = Infinity;
        for (let s = 0; s < 2; s++) for (let e = 6; e <= 9; e += 3) {
          const q = (s ? j : i) * QW + e, x = Q[q], y = Q[q + 1], z = Q[q + 2];
          const w = Math.min(end(i, x, y, z, 1), end(j, x, y, z, 1)) - Math.max(end(i, x, y, z, -1), end(j, x, y, z, -1));
          if (w <= 0) return 0;
          if (w < pen) pen = w;
        }
        return pen;
      };
      const foes = new Map();                        // 方块 → 和它打架的方块
      const link = (a, b) => { let L = foes.get(a); if (!L) foes.set(a, L = new Set()); L.add(b); };
      const off = [[0], [0], [0], [0]];
      for (let i = 0; i < nq; i++) {
        const q = i * QW, ci = quadCube[i];
        if (noLift && noLift[ci]) continue;                          // 脸上那层贴图纸片不参加 ①（见 buildRig 里的说明）
        place(i);
        for (let k = 0; k < 4; k++) {
          const fr = F[k] - B[k], t = k < 3 ? TN : TD, o = off[k];
          o.length = 1;
          if (fr < t) o.push(-1); else if (fr > 1 - t) o.push(1);
        }
        for (const da of off[0]) for (const db of off[1]) for (const dc of off[2]) for (const dd of off[3]) {
          const L = cells.get(keyOf(B[0] + da, B[1] + db, B[2] + dc, B[3] + dd));
          if (!L) continue;
          for (let n = 0; n < L.length; n++) {
            const j = L[n];
            if (j <= i || quadCube[j] === ci) continue;
            if (noLift && noLift[quadCube[j]]) continue;
            const p = j * QW, dx = Q[p] - Q[q], dy = Q[p + 1] - Q[q + 1], dz = Q[p + 2] - Q[q + 2];
            if (Q[q + 3] * Q[p + 3] + Q[q + 4] * Q[p + 4] + Q[q + 5] * Q[p + 5] < 0.999999) continue;        // 朝向一样
            if (Math.abs(Q[q + 3] * dx + Q[q + 4] * dy + Q[q + 5] * dz) > 0.0025 * PX) continue;             // 在同一个平面上
            const reach = Q[q + 14] + Q[p + 14];
            if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
            if (!(overlap(i, j) > 0.02 * PX)) continue;                                                      // 互相盖着
            // 一模一样大、叠在同一个位置（换装 / 表情的备用件，或者贴在上面的一层花纹）：不会闪，不用动
            let same = dx * dx + dy * dy + dz * dz < 1e-10;
            for (let e = 6; same && e <= 9; e += 3) {
              const x = Q[q + e], y = Q[q + e + 1], z = Q[q + e + 2];
              same = Math.abs(end(i, x, y, z, 1) - end(j, x, y, z, 1)) < 1e-5 && Math.abs(end(i, x, y, z, -1) - end(j, x, y, z, -1)) < 1e-5;
            }
            if (same) { info.same++; continue; }
            info.coplanar++;
            link(ci, quadCube[j]); link(quadCube[j], ci);
          }
        }
      }
      // 排级：按方块的先后，每个方块取「排在它前面、和它打架的方块都没用过」的最小一级（每一堆的第一个是 0 级，不动）。
      // 最多 MAXL 级：表情、换装的备用件（几十个嘴型叠在同一个位置，同一时间只显示一个）会排出几十级，再往上就循环用，不把它们越胀越远
      const level = new Map(), used = [], MAXL = 4;
      for (const c of [...foes.keys()].sort((a, b) => a - b)) {
        used.length = 0;
        for (const f of foes.get(c)) { const l = level.get(f); if (l != null) used[l] = true; }
        let l = 0;
        while (used[l]) l++;
        if (l > MAXL) l = 1 + (l - 1) % MAXL;
        level.set(c, l);
        if (l) info.lifted++;
        if (l > info.levels) info.levels = l;
      }
      for (let i = 0; i < nq; i++) {
        if (noLift && noLift[quadCube[i]]) continue;
        const l = level.get(quadCube[i]);
        if (!l) continue;
        const q = i * QW, o = i * 12, k = l * S.lift * PX;
        for (let v = 0; v < 4; v++) {
          const s1 = v === 1 || v === 2 ? 1 : -1, s2 = v >= 2 ? 1 : -1;            // TL TR BR BL：e1 往 TR，e2 往 BL
          pos[o + v * 3] += k * (Q[q + 3] + s1 * Q[q + 6] + s2 * Q[q + 9]);
          pos[o + v * 3 + 1] += k * (Q[q + 4] + s1 * Q[q + 7] + s2 * Q[q + 10]);
          pos[o + v * 3 + 2] += k * (Q[q + 5] + s1 * Q[q + 8] + s2 * Q[q + 11]);
        }
      }
    }
    // ---- ② 贴图坐标往面里收一点 ----
    if (S.uvIn > 0) {
      const iu = S.uvIn / tw, iv = S.uvIn / th;
      for (let i = 0; i < nq; i++) {
        const o = i * 8, cu = (uv[o] + uv[o + 2] + uv[o + 4] + uv[o + 6]) / 4, cv = (uv[o + 1] + uv[o + 3] + uv[o + 5] + uv[o + 7]) / 4;
        for (let v = 0; v < 4; v++) { uv[o + v * 2] += Math.sign(cu - uv[o + v * 2]) * iu; uv[o + v * 2 + 1] += Math.sign(cv - uv[o + v * 2 + 1]) * iv; }
      }
    }
    info.ms = Math.round(nowMs() - t0);
    return info;
  }
  Y._soften = soften;
  // ③：pos = 顶点，flat = 每个面原来的法线（每个顶点一份），out = 写进去的新法线；hidden[i] 非 0 = 第 i 个面现在不显示
  // （不参加平均，法线照原样）。→ { quads: 参加的面数, ms }
  function smoothNormals(pos, flat, out, hidden) {
    const S = Y.SOFT, nq = pos.length / 12, t0 = nowMs();
    for (let i = 0; i < flat.length; i++) out[i] = flat[i];
    const R = S.radius * PX, cosA = Math.cos(S.angle * DEG), cell = R, grid = new Map(), info = { quads: 0, ms: 0 };
    if (!(S.mix > 0) || !(R > 0) || !nq) return info;
    const Q = quadsOf(pos, flat, nq);
    const gk = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
    const box = new Float32Array(nq * 6);
    for (let i = 0; i < nq; i++) {
      if (hidden && hidden[i]) continue;
      info.quads++;
      const o = i * 12, b = i * 6;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let v = 0; v < 4; v++) {
        const x = pos[o + v * 3], y = pos[o + v * 3 + 1], z = pos[o + v * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      box[b] = x0; box[b + 1] = y0; box[b + 2] = z0; box[b + 3] = x1; box[b + 4] = y1; box[b + 5] = z1;
      const a1 = Math.floor(x1 / cell), b1 = Math.floor(y1 / cell), c1 = Math.floor(z1 / cell);
      for (let a = Math.floor(x0 / cell); a <= a1; a++) for (let bb = Math.floor(y0 / cell); bb <= b1; bb++) for (let c = Math.floor(z0 / cell); c <= c1; c++) {
        const k = gk(a, bb, c), L = grid.get(k);
        if (L) L.push(i); else grid.set(k, [i]);
      }
    }
    const lim = 2 * R, seen = new Int32Array(nq).fill(-1), near = [];
    for (let i = 0; i < nq; i++) {
      if (hidden && hidden[i]) continue;
      const o = i * 12, q = i * QW, b = i * 6, nx = Q[q + 3], ny = Q[q + 4], nz = Q[q + 5];
      // 这个面周围 R 以内、朝向差不多的面（四个顶点共用这一份）
      near.length = 0;
      const a1 = Math.floor((box[b + 3] + R) / cell), b1 = Math.floor((box[b + 4] + R) / cell), c1 = Math.floor((box[b + 5] + R) / cell);
      for (let a = Math.floor((box[b] - R) / cell); a <= a1; a++) for (let bb = Math.floor((box[b + 1] - R) / cell); bb <= b1; bb++) for (let c = Math.floor((box[b + 2] - R) / cell); c <= c1; c++) {
        const L = grid.get(gk(a, bb, c));
        if (!L) continue;
        for (let n = 0; n < L.length; n++) {
          const j = L[n];
          if (seen[j] === i) continue;
          seen[j] = i;
          const p = j * QW, d = j * 6;
          if (nx * Q[p + 3] + ny * Q[p + 4] + nz * Q[p + 5] <= cosA) continue;
          if (box[d] - box[b + 3] < R && box[b] - box[d + 3] < R && box[d + 1] - box[b + 4] < R && box[b + 1] - box[d + 4] < R
            && box[d + 2] - box[b + 5] < R && box[b + 2] - box[d + 5] < R) near.push(p);            // 两个面的包围盒相隔不到 R
        }
      }
      for (let v = 0; v < 4; v++) {
        const x = pos[o + v * 3], y = pos[o + v * 3 + 1], z = pos[o + v * 3 + 2];
        let sx = 0, sy = 0, sz = 0;
        for (let n = 0; n < near.length; n++) {
          const p = near[n], dx = x - Q[p], dy = y - Q[p + 1], dz = z - Q[p + 2];
          const h = dx * Q[p + 3] + dy * Q[p + 4] + dz * Q[p + 5];
          const u = Math.max(0, Math.abs(dx * Q[p + 6] + dy * Q[p + 7] + dz * Q[p + 8]) - Q[p + 12]);
          const w = Math.max(0, Math.abs(dx * Q[p + 9] + dy * Q[p + 10] + dz * Q[p + 11]) - Q[p + 13]);
          const d2 = h * h + u * u + w * w;
          if (d2 >= R * R) continue;
          const f = 1 - Math.sqrt(d2) / R, dot = nx * Q[p + 3] + ny * Q[p + 4] + nz * Q[p + 5];
          const k = Math.min(2 * Q[p + 12], lim) * Math.min(2 * Q[p + 13], lim) * f * f * (dot - cosA) / (1 - cosA);
          sx += Q[p + 3] * k; sy += Q[p + 4] * k; sz += Q[p + 5] * k;
        }
        const sl = Math.hypot(sx, sy, sz);
        if (!(sl > 1e-12)) continue;
        const mx = nx * (1 - S.mix) + sx / sl * S.mix, my = ny * (1 - S.mix) + sy / sl * S.mix, mz = nz * (1 - S.mix) + sz / sl * S.mix;
        const ml = Math.hypot(mx, my, mz) || 1;
        out[o + v * 3] = mx / ml; out[o + v * 3 + 1] = my / ml; out[o + v * 3 + 2] = mz / ml;
      }
    }
    info.ms = Math.round(nowMs() - t0);
    return info;
  }
  Y._smoothNormals = smoothNormals;
  // 贴图坐标改成 centroid 插值（WebGL2）：多重采样时面边缘的像素不再取到面外面的那一格（见上面 ②）
  function centroidUv(m) {
    m.onBeforeCompile = (sh, renderer) => {
      const C = THREE.ShaderChunk;
      if (!C || !renderer || !renderer.capabilities || !renderer.capabilities.isWebGL2) return;
      const fix = (s) => String(s).replace('varying vec2 vMapUv;', 'centroid varying vec2 vMapUv;');
      sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', fix(C.uv_pars_vertex));
      sh.fragmentShader = sh.fragmentShader.replace('#include <uv_pars_fragment>', fix(C.uv_pars_fragment));
    };
    m.customProgramCacheKey = () => 'ysm-centroid-uv';
    return m;
  }
  // build geometry + bones. → { root (our frame), turn (π group), bones: { name: Bone }, list: [Bone], mesh, rest: Map(bone → { p, r }) }
  function buildRig(model, pre) {
    const G = model.geo, list = [], byName = {}, byLower = {}, pv = new Map(), restR = new Map();
    const root = new THREE.Group(); root.name = 'ysm';
    const turn = new THREE.Group(); turn.name = 'ysm-turn'; turn.rotation.y = Math.PI; root.add(turn);
    const U = 1 / 16;
    for (const b of G.bones) {
      if (!b || !b.name) continue;
      const bone = new THREE.Bone(); bone.name = b.name;
      list.push(bone); byName[b.name] = bone; byLower[b.name.toLowerCase()] = bone;
      pv.set(bone, bbPos(b.pivot || [0, 0, 0]));
      bone.userData.def = b;
    }
    for (const bone of list) {
      const b = bone.userData.def, par = b.parent && (byName[b.parent] || byLower[String(b.parent).toLowerCase()]);   // 父骨骼：先精确，再不分大小写（Blockbench 的做法）
      let p = par && par !== bone ? par : null;
      for (let q = p; q; q = q.parent) if (q === bone) { p = null; break; }          // parent cycle guard
      (p || turn).add(bone);
      const P = pv.get(bone), Q = p ? pv.get(p) : [0, 0, 0];
      bone.position.set((P[0] - Q[0]) * U, (P[1] - Q[1]) * U, (P[2] - Q[2]) * U);
      bone.rotation.copy(eulerZYX(b.rotation || [0, 0, 0]));
      restR.set(bone, [bone.rotation.x, bone.rotation.y, bone.rotation.z]);
      bone.userData.rest = bone.position.clone();                                     // 65-girl-actor contract
    }
    root.updateMatrixWorld(true);
    const turnInv = new THREE.Matrix4().copy(turn.matrixWorld).invert();
    // part path per bone: 小鲸鱼/<类别>/<骨骼>
    const catOf = (bone) => { for (let q = bone; q && q.isBone; q = q.parent) for (const [re, c] of CAT) if (re.test(q.name)) return c; return '身体'; };
    const pos = [], nor = [], uv = [], si = [], sw = [], idx = [], groups = [], tags = [], quadCube = [], noLift = [];
    let cubeN = 0;
    // 脸上那一层「贴图纸片」不参加 ①「按级往外胀」（2026-11-15 修）：
    //   眼睛：眼球 / 眼白 / 瞳孔 / 高光 / 眼睑 / 睫毛 / 眉毛
    //   嘴：smile / catMouth / toothSmile / openMouth…（父骨骼 Mouth / GuiMouth / AutoMouth 都算）
    //   其他脸部配件：腮红 Shy / 胡须 Whiskers / 眼泪 Tears / 问号（父骨骼 ExtraFace 一类）
    // 这些方块本来就是一层贴图叠在另一层前面、位置几乎完全一样，MC 里靠绘制顺序决定谁盖谁。按级一胀，
    // 谁高谁低整个反过来 —— 眼白上的高光被眼睑盖掉、嘴的边被相邻的嘴型/牙齿压出锯齿，剩下的两个面只差
    // 零点几毫米，跟随镜头默认 9 米远时深度精度只有约 ±0.24 mm，那片像素就在两层之间来回跳（用户反馈「一直闪」）。
    // 保持原样：深度逐位相同 → 后画的稳定盖住先画的。② 贴图坐标内收、③ 法线平均照做，不影响这一层。
    const FACE_LIFT_SKIP = /eye|pupil|iris|lid|lash|brow|mouth|tooth|teeth|tongue|lip|smile|cry|sulk|extraface|tear|whisker|shy|cheek|question|瞳|眼|睫|眉|嘴|牙|舌|唇|泪|腮|须/i;
    const noLiftOf = (bone) => { for (let q = bone; q && q.isBone; q = q.parent) if (FACE_LIFT_SKIP.test(q.name)) return true; return false; };
    const tw = G.texW, th = G.texH, v = new THREE.Vector3(), m4 = new THREE.Matrix4(), nm = new THREE.Matrix3();
    const inHead = (bone) => { for (let q = bone; q && q.isBone; q = q.parent) if (/^(all)?head$/i.test(q.name)) return true; return false; };
    let headTop = -Infinity, top = -Infinity;
    const headVerts = [];
    list.forEach((bone, bi) => {
      const b = bone.userData.def, cubes = Array.isArray(b.cubes) ? b.cubes : [];
      if (!cubes.length) return;
      const start = idx.length;
      const bindM = new THREE.Matrix4().multiplyMatrices(turnInv, bone.matrixWorld);   // bone-local → turn space at rest
      const P = pv.get(bone), headSub = inHead(bone);
      for (const c of cubes) {
        if (!c || !c.origin || !c.size) continue;
        const cubeI = cubeN++;
        noLift[cubeI] = noLiftOf(bone) ? 1 : 0;
        // Blockbench: from = (−(ox+sx), oy, oz), to = from + size（尺寸可以是负的：盒子翻过来、绕向反过来，描边模型靠它）；inflate 往外长
        const inf = +(c.inflate != null ? c.inflate : b.inflate || 0) || 0, s = c.size;
        const lo = [-(+c.origin[0] + +s[0]), +c.origin[1], +c.origin[2]], hi = [-(+c.origin[0]), +c.origin[1] + +s[1], +c.origin[2] + +s[2]];
        for (let a = 0; a < 3; a++) { const g = hi[a] >= lo[a] ? 1 : -1; lo[a] -= inf * g; hi[a] += inf * g; }
        const rot = c.rotation && c.rotation.some(x => +x) ? new THREE.Matrix4().makeRotationFromEuler(eulerZYX(c.rotation)) : null;
        const cp = bbPos(c.pivot || [0, 0, 0]);
        const mirror = c.mirror != null ? !!c.mirror : !!b.mirror;
        const rects = Array.isArray(c.uv) ? boxRects(+c.uv[0] || 0, +c.uv[1] || 0, s, mirror) : null;
        for (const f of FACES) {
          let r;
          if (rects) r = rects[f];
          else if (c.uv && c.uv[f]) {
            const F = c.uv[f], o = F.uv || [0, 0], z = F.uv_size || [0, 0];
            r = [+o[0], +o[1], +o[0] + +z[0], +o[1] + +z[1]];
            const k = ((+F.uv_rotation || 0) / 90 | 0) & 3;
            if (k) r = { rect: r, rot: k };
          } else continue;                                                               // face without UV: not drawn
          const F = FACE[f], ax = f === 'north' || f === 'south' ? [0, 1] : f === 'east' || f === 'west' ? [2, 1] : [0, 2];
          if (!(Math.abs(hi[ax[0]] - lo[ax[0]]) > 1e-6) || !(Math.abs(hi[ax[1]] - lo[ax[1]]) > 1e-6)) continue;   // zero-area face
          const rect = r.rect || r, rk = r.rot || 0;
          const tex = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];   // TL TR BR BL
          const base = pos.length / 3;
          for (let q = 0; q < 4; q++) {
            const k = F.c[q];
            v.set(k[0] ? hi[0] : lo[0], k[1] ? hi[1] : lo[1], k[2] ? hi[2] : lo[2]);
            if (rot) { v.x -= cp[0]; v.y -= cp[1]; v.z -= cp[2]; v.applyMatrix4(rot); v.x += cp[0]; v.y += cp[1]; v.z += cp[2]; }
            v.set((v.x - P[0]) * U, (v.y - P[1]) * U, (v.z - P[2]) * U).applyMatrix4(bindM);
            pos.push(v.x, v.y, v.z);
            if (v.y > top) top = v.y;
            if (headSub) { if (v.y > headTop) headTop = v.y; headVerts.push(pos.length / 3 - 1); }
            const t = tex[(q - rk + 4) & 3];
            uv.push(t[0] / tw, t[1] / th);
            si.push(bi, 0, 0, 0); sw.push(1, 0, 0, 0);
          }
          const n = new THREE.Vector3(F.n[0], F.n[1], F.n[2]);
          if (rot) n.applyMatrix4(m4.extractRotation(rot));
          n.applyMatrix3(nm.getNormalMatrix(bindM)).normalize();
          for (let q = 0; q < 4; q++) nor.push(n.x, n.y, n.z);
          quadCube.push(cubeI);
          idx.push(base, base + 3, base + 2, base, base + 2, base + 1);   // TL BL BR · TL BR TR (CCW from outside)
        }
      }
      const count = idx.length - start;
      if (count) { groups.push({ start, count, bone: bi }); tags.push(pre.root + '/' + catOf(bone) + '/' + bone.name); }
    });
    const soft = softOn(pre) ? soften(pos, nor, uv, quadCube, tw, th, noLift) : null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    const triTag = new Uint16Array(idx.length / 3);
    groups.forEach((gr, i) => { g.addGroup(gr.start, gr.count, i); triTag.fill(i, gr.start / 3, (gr.start + gr.count) / 3); });
    g.computeBoundingBox(); g.computeBoundingSphere();
    return { root, turn, list, byName, byLower, restR, geometry: g, faceTags: tags, triTag, tris: idx.length / 3, groups, soft,
      height: Number.isFinite(headTop) ? headTop : Number.isFinite(top) ? top : 32 / 16, headVerts };
  }
  Y._buildRig = buildRig;
  // ---- 动画：基岩版关键帧 + Molang ----------------------------------------------------------------------------------
  const ML = () => V3.molang;
  const comp = (x) => (typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0)
    : typeof x === 'string' ? (x.trim() !== '' && Number.isFinite(+x) ? +x : ML().compile(x)) : 0);
  const vec = (v) => { if (Array.isArray(v)) return [comp(v[0] == null ? 0 : v[0]), comp(v[1] == null ? 0 : v[1]), comp(v[2] == null ? 0 : v[2])]; const c = comp(v); return [c, c, c]; };
  const isKey = (o) => o && typeof o === 'object' && !Array.isArray(o) && ('pre' in o || 'post' in o || 'lerp_mode' in o);
  // channel json → { st: vec } | { keys: [{ t, pre, post, lerp }] }
  function chan(j) {
    if (j == null) return null;
    if (Array.isArray(j) || typeof j !== 'object') return { st: vec(j) };
    if (isKey(j)) return { st: vec(j.post !== undefined ? j.post : j.pre) };
    if (j.vector) return { st: vec(j.vector) };
    const keys = [];
    for (const k in j) {
      const t = parseFloat(k), v = j[k];
      if (!Number.isFinite(t)) continue;
      if (isKey(v)) { const post = vec(v.post !== undefined ? v.post : v.pre); keys.push({ t, pre: v.pre !== undefined ? vec(v.pre) : post, post, lerp: v.lerp_mode || 'linear' }); }
      else { const x = vec(v); keys.push({ t, pre: x, post: x, lerp: 'linear' }); }
    }
    keys.sort((a, b) => a.t - b.t);
    return keys.length ? { keys } : null;
  }
  // animation json → { name, group, len, loop: 'loop' | 'hold' | 'once', bones: [{ bone, rot, pos, scl }], tl: [{ t, fn }], weight }
  function animOf(name, group, a, rig) {
    const bones = [];
    let last = 0;
    for (const bn in (a && a.bones) || {}) {
      // 骨骼名区分大小写（YSM 基于 GeckoLib，按名字精确匹配）：dsV4P 动画里的小写 tail 对不上 Tail，在 YSM 里也不起作用
      const B = a.bones[bn] || {}, e = { bone: rig.byName[bn] || null, rot: chan(B.rotation), pos: chan(B.position), scl: chan(B.scale) };
      for (const c of [e.rot, e.pos, e.scl]) if (c && c.keys) last = Math.max(last, c.keys[c.keys.length - 1].t);
      if (e.rot || e.pos || e.scl) bones.push(e);
    }
    const tl = [];
    for (const k in (a && a.timeline) || {}) {
      const t = parseFloat(k), v = a.timeline[k];
      if (Number.isFinite(t)) tl.push({ t, fn: ML().compile(Array.isArray(v) ? v.join('\n') : String(v)) });   // 拆成多行的 { } 块要先拼起来
    }
    // 音效关键帧 sound_effects: { "4.58": { "effect": "aaa" } }（effect = sounds/ 里的文件名）→ 和 timeline 一起触发
    for (const k in (a && a.sound_effects) || {}) {
      const t = parseFloat(k);
      if (!Number.isFinite(t)) continue;
      for (const e of [].concat(a.sound_effects[k])) {
        const n = e && (typeof e === 'string' ? e : e.effect || e.sound);
        if (n) tl.push({ t, fn: (c) => { if (c.sound) c.sound(String(n)); } });
      }
    }
    tl.sort((x, y) => x.t - y.t);
    const loop = a && (a.loop === true || a.loop === 'true') ? 'loop' : a && a.loop === 'hold_on_last_frame' ? 'hold' : 'once';
    return { name, group, len: +(a && a.animation_length) || last || 0, loop, bones, tl, weight: a && a.blend_weight != null ? comp(a.blend_weight) : 1 };
  }
  const evc = (c, ctx) => (typeof c === 'number' ? c : ML().num(c(ctx)));
  const S3 = [0, 0, 0];
  // edges (Blockbench): before the first key → its pre; after the last → its post; linear post → next pre; catmull-rom if either end says so
  function sample(ch, t, ctx, o) {
    if (ch.st) { o[0] = evc(ch.st[0], ctx); o[1] = evc(ch.st[1], ctx); o[2] = evc(ch.st[2], ctx); return o; }
    const K = ch.keys, n = K.length;
    let v;
    if (n === 1 || t <= K[0].t) v = K[0].pre;
    else if (t >= K[n - 1].t) v = K[n - 1].post;
    else {
      let i = 0;
      while (i < n - 2 && K[i + 1].t <= t) i++;
      const a = K[i], b = K[i + 1], f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      if (a.lerp === 'step') v = a.post;
      else if (a.lerp === 'catmullrom' || b.lerp === 'catmullrom') {
        const p0 = (K[i - 1] || a).post, p3 = (K[i + 2] || b).pre, f2 = f * f, f3 = f2 * f;
        for (let k = 0; k < 3; k++) {
          const P0 = evc(p0[k], ctx), P1 = evc(a.post[k], ctx), P2 = evc(b.pre[k], ctx), P3 = evc(p3[k], ctx);
          o[k] = 0.5 * (2 * P1 + (-P0 + P2) * f + (2 * P0 - 5 * P1 + 4 * P2 - P3) * f2 + (-P0 + 3 * P1 - 3 * P2 + P3) * f3);
        }
        return o;
      } else {
        for (let k = 0; k < 3; k++) { const A = evc(a.post[k], ctx), B = evc(b.pre[k], ctx); o[k] = A + (B - A) * f; }
        return o;
      }
    }
    o[0] = evc(v[0], ctx); o[1] = evc(v[1], ctx); o[2] = evc(v[2], ctx);
    return o;
  }
  // one playing animation: { A, t (seconds since start), done }
  const localTime = (P) => {
    const A = P.A, len = A.len;
    if (!(len > 0)) return P.t;
    if (A.loop === 'loop') return P.t % len;
    return Math.min(P.t, len);                     // hold / once (once: P.done after len)
  };
  // apply one layer: replace (weight w) per bone + channel it animates; parallel layers ADD rotation
  function applyLayer(P, ctx, out, w, additiveRot) {
    const A = P.A, lt = localTime(P);
    ctx.q.anim_time = P.t; ctx.q.life_time = lt;   // YSM 文档：anim_time 不随循环清零，life_time 是这一圈里的秒数
    if (A.weight !== 1) w *= Math.max(0, Math.min(1, evc(A.weight, ctx)));
    if (!(w > 0)) return;
    for (const e of A.bones) {
      const o = e.bone ? out.get(e.bone) : null;  // 没有这根骨骼（如 molang 假骨骼）：照样求值，只为里面的赋值
      if (e.rot) {
        sample(e.rot, lt, ctx, S3);
        if (o) {
          const x = -S3[0] * DEG, y = -S3[1] * DEG, z = S3[2] * DEG;
          if (additiveRot) { o.r[0] += x * w; o.r[1] += y * w; o.r[2] += z * w; }
          else { o.r[0] += (x - o.r[0]) * w; o.r[1] += (y - o.r[1]) * w; o.r[2] += (z - o.r[2]) * w; }
        }
      }
      if (e.pos) {
        sample(e.pos, lt, ctx, S3);
        if (o) { o.p[0] += (-S3[0] - o.p[0]) * w; o.p[1] += (S3[1] - o.p[1]) * w; o.p[2] += (S3[2] - o.p[2]) * w; }
      }
      if (e.scl) {
        sample(e.scl, lt, ctx, S3);
        if (o) { o.s[0] += (S3[0] - o.s[0]) * w; o.s[1] += (S3[1] - o.s[1]) * w; o.s[2] += (S3[2] - o.s[2]) * w; }
      }
    }
  }
  function runTimeline(P, t0, t1, ctx) {           // timeline keys crossed between local times t0 → t1 (wrapping on loop)
    const tl = P.A.tl;
    if (!tl.length) return;
    const hit = (t) => (t1 >= t0 ? t > t0 && t <= t1 : t > t0 || t <= t1);
    for (const k of tl) if (hit(k.t) || (P.first && k.t <= t1)) k.fn(ctx);
    P.first = false;
  }
  // ---- 贴图 ----------------------------------------------------------------------------------------------------------
  function texOf(bytes) {
    const tex = new THREE.Texture();
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    if (bytes && typeof Image !== 'undefined') {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), img = new Image();
      img.onload = () => { tex.image = img; tex.needsUpdate = true; URL.revokeObjectURL(url); };
      img.onerror = () => { URL.revokeObjectURL(url); V3.err('ysm: 贴图读不出来'); };
      img.src = url;
    }
    return tex;
  }

  // ---- 角色：Y.build(model, { height, anchor, partRoot, studio }) → inst -----------------------------------------------
  // 游戏里的动作 → YSM 动画（找到第一个有的）；捡东西时再叠一个伸手（hand 层）
  // cheer 用模型自带的 jump（一整个循环 0.75 s 正好是一下蹦，由 65-girl-actor 只放 CHEER_ACT 这么久），之后换成 idle 只举手
  const STATE = { stand: ['idle'], walk: ['walk'], pickup: ['sneaking', 'sneak', 'idle'], cheer: ['jump', 'idle'], huddle: ['sneaking', 'sneak', 'idle'] };   // sit 是 MC 的骑乘坐姿，坐得比门廊沿高：缩着就用蹲下
  const HAND = { pickup: ['use_mainhand', 'use_righthand', 'swing_hand'] };
  // ---- 音效（WebAudio，第一次用才建；浏览器要等页面上点过一次才出声）----
  let actx = null;
  const sndBuf = new WeakMap();                    // bytes → Promise<AudioBuffer>
  Y.soundOn = () => !(V3.game && V3.game.get && V3.game.get('girlSound') === false);
  Y.soundCount = 0;
  function playSound(model, name, vol) {
    if (!Y.soundOn()) return;
    const S = (model && model.sounds) || {}, bytes = S[name] || S[String(name).toLowerCase()];
    if (!bytes) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      let p = sndBuf.get(bytes);
      if (!p) { p = actx.decodeAudioData(bytes.slice().buffer); sndBuf.set(bytes, p); p.catch(() => {}); }
      p.then((buf) => {
        const src = actx.createBufferSource(), g = actx.createGain();
        g.gain.value = vol == null ? 0.7 : vol; src.buffer = buf; src.connect(g); g.connect(actx.destination); src.start();
        Y.soundCount++;
      }).catch(() => {});
    } catch (e) { /* no audio here */ }
  }
  const PAR = /^(pre_)?parallel(\d+)$/;
  // MC 画蹲着的玩家时整个模型往下挪 0.125 格（2 px），作者的 sneaking / sneak 动画都按这个做（脚抬高约 2 px）：我们也挪，不然蹲着会飘起来
  const CROUCH = /^sneak(ing)?$/, CROUCH_DY = 2 / 16;
  const UMB_POSE = { arm: [-10, 0, 80], fore: [0, 0, 40] };   // 撑伞时右大臂往外侧抬、小臂往上弯，手在脸颊外侧（Blockbench 度数，加在静止姿势上；大头小手的 Q 版模型够不到头顶）
  // 欢呼时大臂、小臂的角度（Blockbench 度数，加在静止姿势上；左臂取镜像），wave = 手来回晃的幅度。Q 版模型头大手短，手举不过头顶：
  // 直着往上举（z 105 以上、不往前）整条手臂被两边的头发挡住，看不见；往前带 50° 以后两只手举在脸的两侧，正面、侧面都看得到
  // 2026-11-16：原来的 [-50, 0, 98] / [0, 0, 32] 抬得太高（看着约 60°），两只手正好挡在脸前面；降到约 40–45°：手在脸颊外侧，不挡脸
  const CHEER_POSE = { arm: [-40, 0, 75], fore: [0, 0, 20], wave: 6 };
  const CHEER_WAVE_T = 0.6;                        // 手只晃一个来回（秒），晃完停在举起的姿势上，不再一直晃
  Y.build = function (model, opts) {
    opts = opts || {};
    V3.molang.radians = true;                      // YSM：asin / acos / atan 返回弧度
    const root0 = opts.partRoot || '小鲸鱼', pre = { root: root0, soft: opts.soft };
    const rig = buildRig(model, pre);
    const texs = model.textures.map(t => ({ name: t.name, bytes: t.bytes, tex: null }));
    const texAt = (i) => { const T = texs[i]; if (!T) return null; if (!T.tex) T.tex = texOf(T.bytes); return T.tex; };
    const mat = new THREE.MeshStandardMaterial({ map: texAt(0), roughness: 0.85, metalness: 0, alphaTest: 0.1 });
    mat.name = 'ysm';
    if (rig.soft) centroidUv(mat);
    const mesh = new THREE.SkinnedMesh(rig.geometry, rig.faceTags.length ? rig.faceTags.map(() => mat) : mat);
    mesh.name = 'ysm-body'; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    Object.assign(mesh.userData, { faceTags: rig.faceTags, triTag: rig.triTag, anchor: (opts.anchor || 'ysm:') + 'body' });
    rig.turn.add(mesh);
    rig.root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(rig.list);
    mesh.bind(skeleton);
    // ysmGlow* 骨骼自己的方块（不含子骨骼）在 YSM 里全亮、不受光照：单独一个网格（同一份顶点、同一套骨骼）叠在上面画，
    // 主体照样一次绘制。点选、阴影都不算它
    // 眼睛例外（Y.isEyeGlowBone）：全亮的眼睛在阴天、夜里像两盏灯。默认不给眼睛画全亮叠层，让它和脸一起受光；
    // 眼睛的面本来就在主体网格里，所以什么都不会少。这条规则对所有模型都生效（自带的、导入的、同一作者的换装版），
    // 不再只认某一个模型 id。opts.eyeGlow === true（玩家在「模型设置」里勾了「眼睛发光」）时按作者原样全亮。
    // 灯、光环这类非眼睛的 ysmGlow 骨骼不受影响。opts.tune.disableGlowBones 仍可按名字额外关掉个别骨骼。
    const gIndex = rig.geometry.index.array;
    const skipGlow = new Set(opts.tune && opts.tune.disableGlowBones || []);
    const glowBones = [];                            // [{ name, eye, start, count }]：这个模型所有可以全亮的骨骼
    for (const gr of rig.groups) {
      const bone = rig.list[gr.bone], name = bone.name;
      if (/^ysmGlow/.test(name) && !skipGlow.has(name)) glowBones.push({ name, eye: Y.isEyeGlowBone(bone), start: gr.start, count: gr.count });
    }
    const hasEyeGlow = glowBones.some(b => b.eye);
    let eyeGlow = opts.eyeGlow === true;
    const glowIndexFor = (withEyes) => {
      const out = [];
      for (const b of glowBones) if (withEyes || !b.eye) for (let i = b.start; i < b.start + b.count; i++) out.push(gIndex[i]);
      return out;
    };
    let glowMat = null, glowMesh = null;
    if (glowBones.length) {
      const gg = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) gg.setAttribute(k, rig.geometry.attributes[k]);
      gg.setIndex(glowIndexFor(eyeGlow));
      glowMat = new THREE.MeshBasicMaterial({ map: texAt(0), alphaTest: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      glowMat.name = 'ysm-glow';
      if (rig.soft) centroidUv(glowMat);
      glowMesh = new THREE.SkinnedMesh(gg, glowMat);
      Object.assign(glowMesh, { name: 'ysm-glow', frustumCulled: false, castShadow: false, receiveShadow: false, renderOrder: 1 });
      Object.assign(glowMesh.userData, { noShadow: true, noReceive: true, fbOverlay: true });
      glowMesh.raycast = () => {};
      rig.turn.add(glowMesh);
      glowMesh.bind(skeleton, mesh.bindMatrix);
      glowMesh.visible = glowMesh.geometry.index.count > 0;      // 只有眼睛会亮、又没开眼睛发光：整层不画
    }
    const P = V3.parts;
    if (P && P.tagFaces) { P.tagFaces(mesh); if (P.declare) P.declare(rig.faceTags); }
    if (P && P.solo) P.solo(mesh);                 // 一次绘制；反馈工具要按骨骼隐藏时会自己拆开
    // animations: groups (main / extra / arm / tac …) → name → anim
    const A = {}, list = [];
    for (const g in model.anims) for (const n in model.anims[g]) {
      if (/^——/.test(n)) continue;                // separators
      const an = animOf(n, g, model.anims[g][n], rig);
      list.push(an);
      if (!A[n] || g === 'main') A[n] = an;        // main wins on name clashes
    }
    // Molang context (per model instance)
    const fo = new Map(), so = new Map();
    const ctx = { q: {}, v: {}, t: {}, c: {}, ns: { ysm: {}, ctrl: {}, fn: {} } };
    const Q = ctx.q, YS = ctx.ns.ysm, CT = ctx.ns.ctrl;
    Object.assign(YS, {
      first_order: (name, x, k) => { const p = fo.has(name) ? fo.get(name) : +x; const r = p + (+x - p) * Math.max(0, Math.min(1, +k || 0.5)); fo.set(name, r); return r; },
      second_order: (name, x, f, c, r) => {
        let s = so.get(name); if (!s) { s = { y: +x, v: 0, xp: +x }; so.set(name, s); }
        const dt = Math.max(1e-3, Q.delta_time || 0.016), w = 2 * Math.PI * Math.max(0.1, +f || 1), z = Math.max(0, +c || 0.5), R = +r || 0;
        const xd = (+x - s.xp) / dt; s.xp = +x;
        const acc = w * w * (+x + R * z * xd / w * 0 - s.y) - 2 * z * w * s.v;
        s.v += acc * dt; s.y += s.v * dt;
        return s.y;
      },
      play_sound: () => 0, stop_sound: () => 0, particle: () => 0, sync: () => 0,
    });
    for (const k in A) { /* nothing: names only */ }
    // @player_init 一次（种下 v.* / v.roaming.* 的默认值）
    for (const F of model.functions) if (/^player_init$/i.test(F.hook)) { try { ML().compile(F.src)(ctx); } catch (e) { /* ignored */ } }
    const updFns = model.functions.filter(F => /^player_update$/i.test(F.hook)).map(F => ML().compile(F.src));
    // ---- 槽位（YSM-FORMAT「Animation controllers」）：pre_parallel_0…7 → main → 手 → parallel_0…7 ----
    // 槽位可以被动画控制器（JSON，键 = 槽位名，如 player.parallel_7）或脚本控制器（@player_ctrl_<槽位>.molang）接管；
    // 没接管的放 main 文件里的同名并行动画（pre_parallelN / parallelN）。main 槽位被接管时决定主动画（ysm-builtin / bypass = 照我们的动作表）。
    const valE = (e) => (typeof e === 'number' ? e : ML().num(e(ctx)));
    const compE = (x) => {
      if (typeof x === 'number') return x;
      if (typeof x === 'boolean') return x ? 1 : 0;
      try { return ML().compile(String(x)); } catch (e) { return 0; }
    };
    const stmts = (arr) => [].concat(arr || []).map(s => { try { return ML().compile(String(s)); } catch (e) { return null; } }).filter(Boolean);
    const compileCtrl = (def) => {
      const S = {};
      for (const [name, st0] of Object.entries((def && def.states) || {})) {
        const st = st0 || {}, bt = st.blend_transition;
        S[name] = {
          anims: [].concat(st.animations || []).map(a => (typeof a === 'string' ? { n: a, w: null }
            : a && typeof a === 'object' ? Object.entries(a).map(([n, w]) => ({ n, w: compE(w) }))[0] : null)).filter(Boolean),
          tr: [].concat(st.transitions || []).map(t => { const e = t && Object.entries(t)[0]; return e ? { to: e[0], cond: compE(e[1]) } : null; }).filter(Boolean),
          onEntry: stmts(st.on_entry), onExit: stmts(st.on_exit),
          blend: typeof bt === 'number' ? bt : bt && typeof bt === 'object' ? Math.max(0, ...Object.keys(bt).map(Number).filter(Number.isFinite)) : 0,
        };
      }
      return { S, init: def && def.initial_state && S[def.initial_state] ? def.initial_state : Object.keys(S)[0] || null, cur: null };
    };
    const slots = new Map();
    const slotOf = (key) => {
      let S = slots.get(key);
      if (!S) {
        const m = /^(pre_)?parallel_(\d+)$/.exec(key);
        S = { key, pre: !!(m && m[1]), idx: m ? +m[2] : -1, builtin: null, C: null, script: null, act: [], old: [], fadeT: 0, fadeLen: 0,
          want: null, tlen: null, reset: false, pause: false, bypass: false, builtinOn: false };
        slots.set(key, S);
      }
      return S;
    };
    const SLOT_OK = /^(main|(pre_)?parallel_\d+)$/;
    for (const a of list) if (a.group === 'main') { const m = PAR.exec(a.name); if (m) slotOf((m[1] ? 'pre_' : '') + 'parallel_' + m[2]).builtin = { A: a, t: 0, first: true }; }
    for (const [k, def] of Object.entries(model.controllers || {})) { const key = String(k).toLowerCase().replace(/^player\./, ''); if (SLOT_OK.test(key)) slotOf(key).C = compileCtrl(def); }
    for (const F of model.functions) {
      const m = /^player_ctrl_(.+)$/i.exec(F.hook), key = m && m[1].toLowerCase();
      if (key && SLOT_OK.test(key)) { try { slotOf(key).script = ML().compile(F.src); } catch (e) { /* bad script: slot keeps its built-in */ } }
    }
    const preSlots = [...slots.values()].filter(S => S.pre).sort((a, b) => a.idx - b.idx);
    const parSlots = [...slots.values()].filter(S => !S.pre && S.key !== 'main').sort((a, b) => a.idx - b.idx);
    const mainSlot = slots.get('main') || null;
    const enterState = (S, name) => {
      const C = S.C, st = C.S[name];
      C.cur = name; S.builtinOn = name === 'ysm-builtin';
      for (const f of st.onEntry) f(ctx);
      S.act = st.anims.map(a => (A[a.n] ? { Pl: { A: A[a.n], t: 0, first: true }, wf: a.w, w: 1 } : null)).filter(Boolean);
    };
    const ctrlTick = (S) => {                      // 一帧最多换一次状态（基岩版也是）
      const C = S.C;
      if (!C.init) return;
      if (!C.cur) { enterState(S, C.init); return; }
      const st = C.S[C.cur];
      for (const t of st.tr) {
        if (!C.S[t.to] || !(valE(t.cond) !== 0)) continue;
        for (const f of st.onExit) f(ctx);
        S.old = S.act.filter(x => !x.Pl.done).map(x => ({ Pl: x.Pl, w: x.w })); S.fadeLen = st.blend; S.fadeT = 0;
        enterState(S, t.to);
        break;
      }
    };
    // 脚本控制器：每帧跑一次；ctrl.set_animation('名字'[, ctrl.loop | ctrl.play_once | ctrl.hold_on_last_frame])，
    // 返回 ctrl.state_continue / state_pause / state_stop / state_bypass（bypass = 这个槽位照内置的走）
    let scriptSlot = null;
    const ST = { state_continue: 11, state_pause: 12, state_stop: 13, state_bypass: 14 };
    Object.assign(CT, ST, { loop: 1, play_once: 2, hold_on_last_frame: 3,
      set_animation: (n, mode) => { if (scriptSlot) scriptSlot.want = { n: String(n), mode: +mode || 0 }; return 0; },
      set_beginning_transition_length: (s) => { if (scriptSlot) scriptSlot.tlen = Math.max(0, +s || 0); return 0; },
      reset: () => { if (scriptSlot) scriptSlot.reset = true; return 0; }, indicate_reload: () => 0 });
    Object.assign(YS, ST);
    const LOOPS = { 1: 'loop', 2: 'once', 3: 'hold' }, variants = new Map();
    const withMode = (an, mode) => {               // 脚本指定的播放方式和动画自己写的不一样：复制一份换掉 loop
      const lm = LOOPS[mode];
      if (!lm || lm === an.loop) return an;
      const k = an.group + ':' + an.name + '|' + lm;
      if (!variants.has(k)) variants.set(k, Object.assign({}, an, { loop: lm }));
      return variants.get(k);
    };
    const scriptTick = (S) => {
      scriptSlot = S; S.want = null;
      let r = 0;
      try { r = ML().num(S.script(ctx)); } catch (e) { r = 0; }
      scriptSlot = null;
      S.bypass = r === ST.state_bypass; S.pause = r === ST.state_pause;
      const fadeOut = (len) => { S.old = S.act.filter(x => !x.Pl.done).map(x => ({ Pl: x.Pl, w: x.w })); S.fadeLen = len; S.fadeT = 0; S.act = []; };
      if (S.bypass || r === ST.state_stop) { if (S.act.length) fadeOut(0.15); }
      else if (S.want && A[S.want.n]) {
        const an = withMode(A[S.want.n], S.want.mode), curPl = S.act[0] && S.act[0].Pl;
        if (!curPl || curPl.A !== an || S.reset) { fadeOut(S.tlen != null ? S.tlen : 0.15); S.act = [{ Pl: { A: an, t: 0, first: true }, wf: null, w: 1 }]; }
      }
      S.reset = false; S.tlen = null;
    };
    // ---- 音效：模型自带的 sounds/*.ogg；游戏设置「角色音效」关掉就不放 ----
    ctx.sound = (n) => playSound(model, n);
    YS.play_sound = (n) => { playSound(model, n); return 0; };
    const v0 = Object.assign({}, ctx.v);           // 作者的默认值：量身高只按这一套（见 normalize）
    for (const k in opts.vars || {}) ctx.v[k] = +opts.vars[k];   // 玩家在「模型设置」里改过的值（每个模型单独存）
    // bones for 65-girl-actor (missing → dummy Object3D, so overlays never crash)
    const B = (...names) => { for (const n of names) { const b = rig.byLower[n.toLowerCase()]; if (b) return b; } return null; };
    const dummy = (n) => { const o = new THREE.Object3D(); o.name = 'ysm-dummy-' + n; o.userData.rest = new THREE.Vector3(); rig.turn.add(o); return o; };
    const bones = {
      hips: B('AllBody', 'MAllBody', 'Root') || dummy('hips'), chest: B('UpperBody', 'UpBody', 'AllBody') || dummy('chest'),
      head: B('Head', 'AllHead', 'MHead') || dummy('head'), armR: B('RightArm') || dummy('armR'), armL: B('LeftArm') || dummy('armL'),
      legR: B('RightLeg') || dummy('legR'), legL: B('LeftLeg') || dummy('legL'),
    };
    const legBone = B('LeftLeg', 'RightLeg');
    // 我们自己的「腿长」（不是作者的设置，2026-11-05 用户要的）：LeftLeg / RightLeg 沿自身长度缩放，脚掌按反比补回去不压扁，
    // 整个模型往下挪 (1 − k)·胯高，脚还踩在地上；之后按头顶重新缩放到设定的身高。存在每个模型的设置里，键 '@legs'
    const LL = rig.byName.LeftLeg || null, RL = rig.byName.RightLeg || null, LF = rig.byName.LeftFoot || null, RF = rig.byName.RightFoot || null;
    const hipY = ((LL || RL) ? +((LL || RL).userData.def.pivot || [0, 0, 0])[1] : 0) / 16;
    const clampLegs = (k) => Math.max(0.4, Math.min(1.3, +k || 1));
    let legs = clampLegs((opts.vars || {})['@legs']);
    const legOff = () => -(1 - legs) * hipY;
    rig.turn.position.y = legOff();
    // 蹲下往下挪多少（量身高时一起量）：sneaking 第一帧脚比站着高多少就挪多少，最多 MC 的 2 px；旧版模型脚没抬高就不挪
    let crouchDy = 0;
    const crouchAnim = ['sneaking', 'sneak'].find(n => A[n] && A[n].group === 'main') || null;
    const legIdx = new Set();
    rig.list.forEach((b, i) => { for (let o = b; o && o.isBone; o = o.parent) if (/^(Left|Right)(Leg|Foot)/.test(o.name)) { legIdx.add(i); break; } });
    const out = new Map(rig.list.map(b => [b, { r: [0, 0, 0], p: [0, 0, 0], s: [1, 1, 1] }]));
    const clips = new Map(list.map(a => [a.group + ':' + a.name, a]));
    let actorBase = null, actorOverlay = null, actorHand = null, actorLift = 0, actorPosed = false;
    // 站在地上演的底层动画（不坐、不躺），比如 tlm:bookshelf「翻几页书」：作者按女仆坐在 TLM 家具上做的，AllBody 往下挪了 18.5 px，
    // 我们这里没有座位托着她，直接放会整个人陷进地板里（脚低 0.66 m）。setActorAnimation(…, { ground: true }) 时量一下这个动画摆出来
    // 最低的脚比站着的脚低多少，把模型往上抬这么多（只抬不压；跟着淡入淡出）。每个动画量一次，换腿长重新量。
    let standFoot = NaN;
    const liftCache = new Map();
    let clock = 0, cur = null, prev = null, fade = 1, hand = null, blinkT = 3, blink = 0, look = 0, lookUp = 0, wxK = 0, wxWet = 0;
    const lastPos = new THREE.Vector3(), wp = new THREE.Vector3();
    let speed = 0, havePos = false;
    const animOpts = [['', '（跟着动作走）']].concat(list.filter(a => !PAR.test(a.name) || a.group !== 'main')
      .map(a => [a.group + ':' + a.name, (a.group === 'main' ? '' : a.group + ' · ') + a.name]));
    let dtNow = 0;                                 // 暂停（dt = 0）时切动画直接切过去，不淡入（量 REACH、工作台暂停时）
    const play = (name) => { const a = A[name]; if (!a) return; if (cur && cur.A === a) return; prev = cur; cur = { A: a, t: 0, first: true }; fade = prev && dtNow > 0 ? 0 : 1; };
    // 游戏里的调校（只给自带的模型配，29-ysmui 的 BUILTIN.tune）：表情对照表 face、偶尔久站 longIdle（秒）、撑伞姿势 umbrella
    const tune = opts.tune || {}, faceMap = tune.face || null;
    const RUA = rig.byName.RightArm || null, RFA = rig.byName.RightForeArm || null;
    const LUA = rig.byName.LeftArm || null, LFA = rig.byName.LeftForeArm || null;
    const inst = {
      id: 'ysm', label: (model.meta && model.meta.name) || 'YSM 模型', root: rig.root, partRoot: root0, bones, mesh, rig, model,
      face: null, solo: true, noOverlay: true, noUmbrella: !RUA, umbUp: 0.97, longIdle: +tune.longIdle || 0, glow: glowMesh,
      states: {
        pose: { label: '动作', options: [['stand', '站立'], ['walk', '走路'], ['pickup', '蹲下捡'], ['cheer', '欢呼'], ['huddle', '缩着坐']], value: 'stand' },
        anim: { label: '动画', options: animOpts, value: '' },
        texture: { label: '贴图', options: texs.map((t, i) => [String(i), t.name]), value: '0' },
        expr: { label: '表情', options: [['happy', '（模型自己控制）']], value: 'happy' },
        ...(opts.studio ? { weather: { label: '天气', options: [['0', '晴'], ['1', '下雨'], ['2', '雷雨']], value: '0' } } : {}),   // 工作台预览；游戏里由 actor 调 setWeather
      },
      views: { front: { az: 0, el: 0.06, dist: 3.0, target: [0, 0.62, 0] }, side: { az: Math.PI / 2, el: 0.06, dist: 3.0, target: [0, 0.62, 0] },
        back: { az: Math.PI, el: 0.06, dist: 3.0, target: [0, 0.62, 0] }, q34: { az: 0.6, el: 0.15, dist: 3.1, target: [0, 0.62, 0] },
        face: { az: 0, el: 0.05, dist: 1.35, target: [0, 0.95, 0] } },
      poseK: null,
      leg: legBone ? Math.max(0.1, legBone.getWorldPosition(wp).y) : 0.35, swing: 0.5,
      handBone: B('RightHandLocator', 'RightHand', 'RightForeArm', 'RightArm') || bones.armR, handOff: new THREE.Vector3(),
      setLook(yaw, up) { look = +yaw || 0; lookUp = +up || 0; },
      // 天气（65-girl-actor 每帧调）：w = 0 晴 / 1 雨 / 2 雷雨（ysm.weather），wet = 正淋着雨（q.is_in_water_or_rain；躲在门廊下不算）
      setWeather(w, wet) { wxK = +w || 0; wxWet = wet ? 1 : 0; },
      // 撑伞（65-girl-actor 在 update 之后调，h = 0..1）：右大臂抬起、小臂竖起来，手在头的右边。角度是 Blockbench 的度数，加在静止姿势上
      umbrellaArm(h) {
        if (!(h > 0) || !RUA) return;
        const pose = inst.umbPose || tune.umbrella || UMB_POSE;   // inst.umbPose：调试时可以直接换
        const to = (b, d) => {
          if (!b || !d) return;
          const r = rig.restR.get(b), tx = r[0] - d[0] * DEG, ty = r[1] - d[1] * DEG, tz = r[2] + d[2] * DEG;
          b.rotation.set(b.rotation.x + (tx - b.rotation.x) * h, b.rotation.y + (ty - b.rotation.y) * h, b.rotation.z + (tz - b.rotation.z) * h, 'ZYX');
        };
        to(RUA, pose.arm); to(RFA, pose.fore);
      },
      // 欢呼（65-girl-actor 在 update 之后调，h = 0..1）：两只手举过头顶（捡到贝壳以后）。模型自带的 jump 手只往两边张开一点，
      // 没有举手的动画，所以和撑伞一样按骨骼摆：大臂往外上方抬、小臂再往上弯一点，左边是右边的镜像。
      // t = 欢呼开始后的秒数：前 CHEER_WAVE_T 秒手晃一个来回，之后定住（只演一遍，再保持姿势）
      cheerArms(h, t) {
        if (!(h > 0) || !RUA) return;
        const pose = inst.cheerPose || tune.cheer || CHEER_POSE, k = Math.max(0, Math.min(1, (+t || 0) / CHEER_WAVE_T));
        const wave = Math.sin(k * Math.PI * 2) * (pose.wave || 0);
        const to = (b, d, m) => {
          if (!b || !d) return;
          const r = rig.restR.get(b), tx = r[0] - d[0] * DEG, ty = r[1] - d[1] * DEG * m, tz = r[2] + (d[2] + wave) * DEG * m;
          b.rotation.set(b.rotation.x + (tx - b.rotation.x) * h, b.rotation.y + (ty - b.rotation.y) * h, b.rotation.z + (tz - b.rotation.z) * h, 'ZYX');
        };
        to(RUA, pose.arm, 1); to(RFA, pose.fore, 1); to(LUA, pose.arm, -1); to(LFA, pose.fore, -1);
      },
      // 调试 / 测试用：每个槽位现在放什么（控制器状态、脚本、内置并行动画）
      slotInfo() {
        return [...slots.values()].map(S => ({ key: S.key, ctrl: S.C ? S.C.cur : null, script: !!S.script, bypass: S.bypass,
          act: S.act.map(x => x.Pl.A.name), builtin: S.builtin ? S.builtin.A.name : null }));
      },
      forms: model.forms || [],
      getVar(k) { const x = ctx.v[k]; return typeof x === 'number' ? x : x ? 1 : 0; },
      setVar(k, x) { ctx.v[k] = +x || 0; resmoothSoon(); },
      runStmt(src) { try { ML().compile(String(src))(ctx); } catch (e) { /* ignored */ } resmoothSoon(); },
      hasAnimation(key) { return clips.has(key); },
      findAnimation(name) { const a = list.find(x => x.name.toLowerCase() === String(name).toLowerCase()); return a ? a.group + ':' + a.name : null; },
      // o.ground：站在地上演（量脚抬多少）；o.posed：65-girl-actor 把她摆着（坐着 / 躺着），不是「站着不动」——
      // 有 base / overlay 或 posed 时模型自己的待机计时不走（ctrl.idle = 0、ctrl.playing_extra_animation = 1，见 update）
      setActorAnimation(base, overlay, mode, o) {
        actorBase = clips.get(base) || null;
        actorPosed = !!(o && o.posed);
        actorLift = actorBase && o && o.ground ? liftOf(actorBase.group + ':' + actorBase.name) : 0;
        const clip = clips.get(overlay);
        actorOverlay = clip ? withMode(clip, mode === 'hold' ? 3 : mode === 'loop' ? 1 : 0) : null;
      },
      get actorAnimation() {
        const key = clip => clip ? clip.group + ':' + clip.name : null;
        return { base: key(actorBase), overlay: key(actorOverlay), overlayMode: actorOverlay && actorOverlay.loop, lift: actorLift, posed: actorPosed };
      },
      setState(k, v) {
        if (!this.states[k]) return;
        this.states[k].value = v;
        if (k === 'texture') { const t = texAt(+v || 0); if (t) { mat.map = t; mat.needsUpdate = true; if (glowMat) { glowMat.map = t; glowMat.needsUpdate = true; } } }
      },
      update(dt, t) {
        dt = Math.max(0, Math.min(0.1, +dt || 0));
        clock += dt; dtNow = dt;
        rig.root.getWorldPosition(wp);                 // ground speed from the root's world motion (the actor moves it)
        if (havePos && dt > 0) speed += (Math.hypot(wp.x - lastPos.x, wp.z - lastPos.z) / dt - speed) * Math.min(1, dt * 8);
        lastPos.copy(wp); havePos = true;
        const st = inst.states, want = st.anim.value, pose = st.pose.value;
        const hn = !want && !actorBase && !actorOverlay && HAND[pose] ? HAND[pose].find(n => A[n]) : null;
        // queries (YSM names; see YSM-FORMAT §6)：先算好，控制器的条件、主动画、动画里的 Molang 都用这一帧的值
        if ((blinkT -= dt) <= 0) { blink = 0.15; blinkT = 2.5 + Math.random() * 3; }
        blink = Math.max(0, blink - dt);
        const moving = speed > 0.08, sp = speed / Math.max(0.2, rig.root.scale.y * 1.0);
        const W = st.weather ? +st.weather.value || 0 : wxK, wet = st.weather ? (W > 0 ? 1 : 0) : wxWet;
        Object.assign(Q, { delta_time: dt, ground_speed: sp * 1.7, vertical_speed: 0, is_on_ground: 1, is_moving: moving ? 1 : 0,
          is_jumping: pose === 'cheer' ? 1 : 0, is_sneaking: pose === 'pickup' || pose === 'huddle' ? 1 : 0, is_sprinting: speed > 1.3 ? 1 : 0,
          is_swimming: 0, is_riding: 0, is_sleeping: 0, is_in_water: 0, is_in_water_or_rain: wet, is_first_person: 0, is_alive: 1,
          health: 20, max_health: 20, hurt_time: 0, body_y_rotation: 0, yaw_speed: 0, cardinal_facing_2d: 2, moon_phase: 0,
          time_of_day: V3.env && V3.env.state && V3.env.state.hour != null ? V3.env.state.hour / 24 : 0.5,
          head_x_rotation: look / DEG, head_y_rotation: lookUp / DEG });
        Object.assign(YS, { head_yaw: look / DEG, head_pitch: lookUp / DEG, ground_speed2: sp * 1.7, time_delta: dt,
          input_vertical: moving ? 1 : 0, input_horizontal: 0, food_level: 20, armor_value: 0, weather: W, is_close_eyes: blink > 0 ? 1 : 0,
          person_view: 2, rendering_in_inventory: 0, rendering_in_paperdoll: 0, texture_name: (texs[+st.texture.value || 0] || {}).name || '',
          swinging: hn ? 1 : 0, swinging_arm: hn ? 1 : 0 });
        // 我们在放动作（躺着睡、坐着打字 / 吃饭、翻书…）或把她摆着（坐、躺）：对模型来说她不是「站着发呆」，在演额外动画。
        // 自带模型的 parallel_7 靠 ctrl.idle 计时，站满约 38 秒演 idle_1（铁盆那段），躺着、坐着时不该叠上去
        const busy = !!(actorBase || actorOverlay || actorPosed);
        Object.assign(CT, { idle: !moving && pose === 'stand' && !busy ? 1 : 0, walk: pose === 'walk' ? 1 : 0, run: speed > 1.3 ? 1 : 0, sneak: pose === 'pickup' || pose === 'huddle' ? 1 : 0,
          jump: pose === 'cheer' ? 1 : 0, swim: 0, fly: 0, sleep: 0, death: 0, attacked: 0, playing_extra_animation: want || busy ? 1 : 0 });
        // 表情（游戏里说话 / 开心 / 害怕…；tune.face 只给自带的模型配）：这一帧临时改脸部变量，算完动画再换回玩家自己的设置
        const fx = faceMap && faceMap[st.expr.value];
        let faceKeep = null;
        if (fx) {
          const keys = Object.keys(fx.vars || {}).concat(fx.seq ? fx.seq.keys : []);
          faceKeep = keys.map(k => [k, ctx.v[k]]);
          Object.assign(ctx.v, fx.vars || {});
          if (fx.seq) { const v = fx.seq.values[Math.floor(clock / (fx.seq.every || 0.13)) % fx.seq.values.length]; for (const k of fx.seq.keys) ctx.v[k] = v; }
        }
        for (const f of updFns) f(ctx);
        for (const S of slots.values()) { if (S.C) ctrlTick(S); else if (S.script) scriptTick(S); }
        // 主动画：工作台里选的动画 > main 槽位的控制器 / 脚本 > 我们的动作表（STATE）
        const mainOv = !want && mainSlot && (mainSlot.C || mainSlot.script) && !mainSlot.bypass && !mainSlot.builtinOn && mainSlot.act[0] ? mainSlot.act[0].Pl.A : null;
        const selected = want ? clips.get(want) : actorBase || mainOv;
        if (selected) {
          if (!cur || cur.A !== selected) { prev = cur; cur = { A: selected, t: 0, first: true }; fade = prev && dt > 0 ? 0 : 1; }
        } else if (!want) play((STATE[pose] || STATE.stand).find(n => A[n]) || 'idle');
        if (cur) cur.lift = !want && cur.A === actorBase ? actorLift : 0;   // prev 留着它自己的，淡出时一起落回去
        if (hn) { if (!hand || hand.A !== A[hn]) hand = { A: A[hn], t: 0, first: true }; } else hand = null;
        if (!want && actorOverlay) {
          if (!actorHand || actorHand.A !== actorOverlay) actorHand = { A: actorOverlay, t: 0, first: true };
        } else actorHand = null;
        // layers: pre_parallel 槽位 → main (cross-fade) → hand → parallel 槽位 (rotation adds)
        for (const o of out.values()) { o.r[0] = o.r[1] = o.r[2] = 0; o.p[0] = o.p[1] = o.p[2] = 0; o.s[0] = o.s[1] = o.s[2] = 1; }
        const step = (Pl, k) => { if (!Pl) return; const t0 = localTime(Pl); Pl.t += dt * (k || 1); runTimeline(Pl, t0, localTime(Pl), ctx); if (Pl.A.loop === 'once' && Pl.A.len > 0 && Pl.t > Pl.A.len) Pl.done = true; };
        const slotApply = (S, additive) => {
          if (S.old.length) { S.fadeT += dt; if (!(S.fadeLen > 0) || S.fadeT >= S.fadeLen) S.old = []; }
          const k = S.old.length ? S.fadeT / S.fadeLen : 1;
          for (const o of S.old) { step(o.Pl); if (!o.Pl.done) applyLayer(o.Pl, ctx, out, (1 - k) * o.w, additive); }
          if ((!S.C && !S.script) || S.bypass || S.builtinOn) {        // 没接管 / bypass / ysm-builtin：内置的同名并行动画
            const B0 = S.builtin;
            if (B0) { step(B0); if (!B0.done) applyLayer(B0, ctx, out, 1, additive); }
            return;
          }
          for (const x of S.act) {
            if (!S.pause) step(x.Pl);
            x.w = x.wf == null ? 1 : Math.max(0, Math.min(1, valE(x.wf)));
            if (!x.Pl.done) applyLayer(x.Pl, ctx, out, x.w * k, additive);
          }
        };
        for (const S of preSlots) slotApply(S, false);
        fade = Math.min(1, fade + dt / 0.2);
        const isCrouch = (Pl) => !!(Pl && Pl.A.group === 'main' && CROUCH.test(Pl.A.name));   // 蹲着往下挪，跟着淡入淡出
        rig.turn.position.y = legOff() - crouchDy * ((isCrouch(cur) ? fade : 0) + (prev && fade < 1 && isCrouch(prev) ? 1 - fade : 0))
          + (cur && cur.lift ? cur.lift * fade : 0) + (prev && fade < 1 && prev.lift ? prev.lift * (1 - fade) : 0);
        if (prev && fade < 1) { step(prev); applyLayer(prev, ctx, out, 1 - fade, false); } else prev = null;
        if (cur) { step(cur, cur.A.name === 'walk' && !opts.studio ? Math.max(0.6, Math.min(1.6, speed / 1.0)) : 1); applyLayer(cur, ctx, out, fade, false); }
        if (hand) { step(hand); applyLayer(hand, ctx, out, 1, false); }
        for (const S of parSlots) slotApply(S, true);
        // Authored arm clips replace only their keyed channels, leaving the seated base intact.
        if (actorHand) { step(actorHand); applyLayer(actorHand, ctx, out, 1, false); }
        // write bones: rest + offsets (Blockbench: Euler ZYX, position in px)
        for (const [b, o] of out) {
          const r = rig.restR.get(b), rp = b.userData.rest;
          b.rotation.set(r[0] + o.r[0], r[1] + o.r[1], r[2] + o.r[2], 'ZYX');
          b.position.set(rp.x + o.p[0] / 16, rp.y + o.p[1] / 16, rp.z + o.p[2] / 16);
          b.scale.set(o.s[0] || 1e-4, o.s[1] || 1e-4, o.s[2] || 1e-4);
        }
        if (legs !== 1) {                              // 腿长：腿沿自身 y 缩放，脚掌反比补回
          for (const L of [LL, RL]) if (L) L.scale.y *= legs;
          for (const F of [LF, RF]) if (F) F.scale.y /= legs;
        }
        const H = bones.head;                          // 头跟着视线（YSM 自己在动画之后加；Blockbench 空间里 x = 抬头、y = 往左转）
        if (H && H.isBone) { H.rotation.x += lookUp; H.rotation.y += look; }
        if (faceKeep) for (const [k, v] of faceKeep) { if (v === undefined) delete ctx.v[k]; else ctx.v[k] = v; }   // 换回玩家自己的脸部设置
      },
      dispose() {
        rig.geometry.dispose(); mat.dispose(); skeleton.dispose();
        if (glowMesh) { glowMesh.geometry.dispose(); glowMat.dispose(); }
        for (const T of texs) if (T.tex) T.tex.dispose();
      },
    };
    // 身高：按作者的默认设置摆好（含模型自己的「模型大小」默认值、我们的腿长）以后，量头顶的实际高度，再缩放到 height。
    // 玩家改过的「模型大小」「头部缩放」之类量的时候先换回默认值，量完再换回来：不然刷新页面后又被缩回 height，改了等于没改
    const H = opts.height || (V3.layout && V3.layout.girlH) || 1.26;
    const normalize = () => {
      const mine = ctx.v;
      ctx.v = Object.assign({}, v0);
      try { measure(); } finally { ctx.v = mine; }
      inst.update(0, 0);
    };
    const measure = () => {                          // 总按站着量（工作台里蹲着的时候拖腿长滑条，也不会把她放大）
      const st = inst.states, keep = [st.pose.value, st.anim.value];
      st.pose.value = 'stand'; st.anim.value = '';
      try { measureNow(); } finally { st.pose.value = keep[0]; st.anim.value = keep[1]; }
    };
    const measureNow = () => {
      inst.update(0, 0);
      rig.root.scale.setScalar(1); rig.root.updateMatrixWorld(true); skeleton.update();
      const P0 = rig.geometry.attributes.position, sv = new THREE.Vector3(), verts = rig.headVerts.length ? rig.headVerts : null;
      let top = -Infinity;
      const n0 = verts ? verts.length : P0.count;
      for (let i = 0; i < n0; i++) { const vi = verts ? verts[i] : i; mesh.applyBoneTransform(vi, sv.fromBufferAttribute(P0, vi)); if (sv.y > top) top = sv.y; }
      top += legOff();                               // applyBoneTransform 给的是网格（turn 组）里的坐标：加上腿长带来的下移
      crouchDy = 0;                                  // 还在 scale 1、站着：量站着和蹲着时最低的脚
      liftCache.clear(); standFoot = legIdx.size ? footLow() : NaN;
      if (crouchAnim && legIdx.size) {
        const stand = standFoot;
        inst.states.anim.value = 'main:' + crouchAnim; inst.update(0, 0);
        const lift = footLow() - stand;
        if (Number.isFinite(lift)) crouchDy = Math.max(0, Math.min(CROUCH_DY, lift));
      }
      rig.root.scale.setScalar(H / Math.max(0.3, Number.isFinite(top) ? top : rig.height));
    };
    // 网格（turn 组）坐标里，现在这一帧最低的脚（腿、脚下面的所有顶点）
    function footLow() {
      const P0 = rig.geometry.attributes.position, SI = rig.geometry.attributes.skinIndex, sv = new THREE.Vector3();
      rig.root.updateMatrixWorld(true); skeleton.update();
      let low = Infinity;
      for (let i = 0; i < P0.count; i++) if (legIdx.has(SI.getX(i))) { mesh.applyBoneTransform(i, sv.fromBufferAttribute(P0, i)); if (sv.y < low) low = sv.y; }
      return low;
    }
    // 这个动画（第一帧）的脚比站着低多少（网格单位，≥ 0）：临时摆一下量完，把播放状态原样放回去（下一帧照常重算姿势）
    function liftOf(key) {
      if (liftCache.has(key)) return liftCache.get(key);
      let lift = 0;
      if (legIdx.size && Number.isFinite(standFoot)) {
        const st = inst.states, keep = { pose: st.pose.value, anim: st.anim.value, cur, prev, fade, hand, actorBase, actorOverlay, actorHand };
        try {
          st.pose.value = 'stand'; st.anim.value = key; actorOverlay = null;
          inst.update(0, 0);
          const low = footLow();
          if (Number.isFinite(low) && standFoot - low > 1 / 16) lift = Math.min(2, standFoot - low);   // 不到 1 px（跑步第一帧之类）不算
        } catch (e) { lift = 0; }
        finally {
          st.pose.value = keep.pose; st.anim.value = keep.anim;
          ({ cur, prev, fade, hand, actorBase, actorOverlay, actorHand } = keep);
        }
      }
      liftCache.set(key, lift);
      return lift;
    }
    inst.canLegs = !!(LL || RL);
    // 眼睛发光（本游戏的设置，29-ysmui 的「模型设置」里一个勾）：模型有眼睛全亮骨骼时才有
    inst.canEyeGlow = hasEyeGlow;
    inst.getEyeGlow = () => eyeGlow;
    inst.setEyeGlow = (on) => {
      on = !!on;
      if (!glowMesh || on === eyeGlow) { eyeGlow = on; return; }
      eyeGlow = on;
      glowMesh.geometry.setIndex(glowIndexFor(eyeGlow));
      glowMesh.visible = glowMesh.geometry.index.count > 0;
    };
    inst.getLegs = () => legs;
    // 头顶（头骨骼局部坐标）：65-girl-actor 用它放对话框、瞄伞尖。骨骼本身没有网格，Box3 量不出来，所以按头部顶点算
    const headTopNow = () => {
      const Hb = bones.head;
      if (!Hb || !Hb.isBone || !rig.headVerts.length) return null;
      rig.root.updateMatrixWorld(true); skeleton.update();
      const P0 = rig.geometry.attributes.position, v = new THREE.Vector3(), best = new THREE.Vector3();
      let top = -Infinity;
      for (const i of rig.headVerts) { mesh.applyBoneTransform(i, v.fromBufferAttribute(P0, i)); v.applyMatrix4(mesh.matrixWorld); if (v.y > top) { top = v.y; best.copy(v); } }
      if (!Number.isFinite(top)) return null;
      const c = Hb.getWorldPosition(new THREE.Vector3());
      return Hb.worldToLocal(new THREE.Vector3(c.x, best.y, c.z));
    };
    inst.setLegs = (k) => { legs = clampLegs(k); rig.turn.position.y = legOff(); normalize(); inst.headTop = headTopNow(); };
    normalize();
    inst.headTop = headTopNow();
    // 明暗连成一片（soften 上面说明里的 ③）：按现在显示着的方块重算一遍法线。骨骼自己或哪一级父骨骼缩成 0 = 这块现在不显示。
    // 玩家在「模型设置」里开关了部件以后可以再调 inst.resmooth()；没开 soft 时什么都不做
    const flatN = rig.soft ? rig.geometry.attributes.normal.array.slice() : null;
    inst.resmooth = () => {
      if (!flatN) return null;
      const GA = rig.geometry.attributes, SI = GA.skinIndex.array, gone = new Uint8Array(rig.list.length), tiny = (b) => Math.min(Math.abs(b.scale.x), Math.abs(b.scale.y), Math.abs(b.scale.z)) < 0.01;
      rig.list.forEach((b, i) => { for (let o = b; o && o.isBone; o = o.parent) if (tiny(o)) { gone[i] = 1; break; } });
      const hidden = new Uint8Array(flatN.length / 12);
      for (let i = 0; i < hidden.length; i++) hidden[i] = gone[SI[i * 16]];
      const r = smoothNormals(GA.position.array, flatN, GA.normal.array, hidden);
      GA.normal.needsUpdate = true;
      return (rig.soft.normals = r);
    };
    inst.resmooth();
    // 模型设置里开关了部件（setVar / runStmt）：等下一帧把新的显示状态摆出来，再重算一遍（连着拖滑条只算最后一次）
    let smoothT = 0, gone = false;
    function resmoothSoon() {
      if (!flatN || gone || typeof setTimeout !== 'function') return;
      clearTimeout(smoothT);
      smoothT = setTimeout(() => { if (!gone) inst.resmooth(); }, 250);
      if (smoothT && smoothT.unref) smoothT.unref();
    }
    const dispose0 = inst.dispose;
    inst.dispose = () => { gone = true; clearTimeout(smoothT); dispose0(); };
    // 腿长（米，胯到地面）：65-girl-actor 算步幅 / 脚印间距用，要在缩放到身高之后量
    inst.leg = legBone ? Math.max(0.1, legBone.getWorldPosition(wp).y) : 0.35;
    return inst;
  };
})(window.V3);
