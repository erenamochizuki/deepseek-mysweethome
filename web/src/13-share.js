// 13-share.js — 鲸图：方块数据（Sponge Schematic 第 3 版，.schem）+ 分享 PNG（数据放在 xjSc 块里）。
//
// 约定以 docs/FORMAT.md 为准；这里用 12-nbt.js（V3.nbt）读写 NBT。所有页面都会加载本文件，
// 加载时只定义函数，不碰 DOM。
//
// 模型（read 读出来的就是规范形式，FORMAT.md 第 4 节）：
//   {
//     size: [W, H, L],          // x / y / z 方向的格数
//     offset: [x, y, z],        // 第 (0,0,0) 格相对站立点的位置
//     dataVersion: 4790,        // MC 数据版本
//     meta: {compound:{…}} | null,   // Metadata 原样（带类型的 NBT，见 12-nbt.js）
//     palette: ['minecraft:air', …], // 状态字符串，原样保留
//     cells: Int32Array,        // 长 W×H×L，值是 palette 下标；格子 i = x + z×W + y×W×L
//     blockEntities: [{pos: [x, y, z], id: 'minecraft:chest', data: {compound:{…}} | null}],
//     warnings: ['data_version', …],
//   }
// 写的时候 cells 也可以是普通数组；palette 可以有没用到的、顺序随意（写出去会规范化）。
//
// API（都在 V3.share 上）：
//   await read(bytes)            PNG 或裸 .schem（也收 Blob/File）→ 模型；出错抛 ShareError
//   await readSchem(bytes)       只读 .schem（gzip）
//   extract(pngBytes)            从 PNG 里取出 .schem 字节（按 FORMAT.md 第 1 节检查）
//   await writeSchem(model)      → .schem 字节
//   await writePng(model, png?)  → 鲸图 PNG 字节；不给 png 就用 16×16 纯色占位图
//   dump(model) / fromDump(json) 和 FORMAT.md 第 4 节的 dump 互转
//   canonicalize(model)          规范化（不改原模型）
//   requiredMods(palette)        调色板里不是 minecraft 的命名空间，排好序
//   ShareError                   e.code = FORMAT.md 第 5 节的代码，e.message = 给用户看的中文
//   png.{isPng, crc32, chunks, chunk, setChunk, solid}   PNG 小工具
(function (V3) {
  'use strict';

  const S = V3.share = {};

  S.DATA_VERSION = 4790;       // MC 26.1.2
  S.SPONGE_VERSION = 3;
  S.FORMAT_VERSION = 1;
  S.SOURCE = 'haibian-web/4.0.0-dev';
  S.CHUNK_TYPE = 'xjSc';
  S.LIMITS = Object.freeze({
    side: 1024,
    cells: 4194304,
    palette: 65536,
    chunk: 16777216,
    unzipped: 67108864,
    tags: 2097152,
  });

  S.MESSAGES = Object.freeze({
    unknown_file: '这不是鲸图（PNG）也不是 .schem 文件。',
    bad_png: '图片文件不完整，可能没下载完。请重新保存原图再试。',
    no_data: '这张图里没有方块数据。聊天软件（微信、QQ 等）发图时常会压缩图片、去掉附加数据。请让对方「发送原图」或者把图片当文件发，再试一次。',
    multiple_data: '这张图里有好几份方块数据，不知道该用哪份。',
    bad_crc: '方块数据损坏了。请让对方重新发原文件。',
    too_large: '这个建筑太大了，或者里面的东西太多了（上限：每边 1024 格，总共 4,194,304 格）。',
    bad_gzip: '方块数据损坏了（解压失败）。',
    bad_nbt: '方块数据损坏了（数据结构不对）。',
    unsupported_version: '这个文件是 Sponge 第 N 版格式，现在只支持第 3 版。',
    bad_schematic: '方块数据不完整：',
    bad_dump: 'dump 不对：',
  });

  // code：FORMAT.md 第 5 节的代码（另有 bad_dump：fromDump 收到的 JSON 不对）
  // detail：具体哪里不对（bad_schematic、bad_dump 会接在 message 后面，其他只留在 e.detail 里）
  class ShareError extends Error {
    constructor(code, detail, extra) {
      let msg = S.MESSAGES[code] || code;
      if (code === 'unsupported_version') msg = msg.replace('N', String(extra && extra.version));
      if (code === 'bad_schematic' || code === 'bad_dump') msg += detail || '（没写具体原因）';
      super(msg);
      this.name = 'ShareError';
      this.code = code;
      this.detail = detail || '';
      if (extra) Object.assign(this, extra);
    }
  }
  S.ShareError = ShareError;

  function bad(detail) { throw new ShareError('bad_schematic', detail); }
  function nbt() {
    if (!V3.nbt) throw new Error('13-share.js 需要先加载 12-nbt.js');
    return V3.nbt;
  }
  async function toBytes(x) {
    if (typeof Blob !== 'undefined' && x instanceof Blob) return new Uint8Array(await x.arrayBuffer());
    return nbt().asBytes(x);
  }
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isInt32 = (v) => typeof v === 'number' && (v | 0) === v;
  const q = (s) => JSON.stringify(s);

  // ---------- PNG 小工具 ----------

  const SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  let CRC_TABLE = null;

  function crc32(bytes, start, end) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c;
      }
    }
    const b = nbt().asBytes(bytes);
    const e = end == null ? b.length : end;
    let c = -1;
    for (let i = start || 0; i < e; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function isPng(b) {
    if (b.length < 8) return false;
    for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) return false;
    return true;
  }

  function typeAt(b, p) {
    return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  }

  function concat(parts) {
    let n = 0;
    for (const x of parts) n += x.length;
    const out = new Uint8Array(n);
    let p = 0;
    for (const x of parts) {
      out.set(x, p);
      p += x.length;
    }
    return out;
  }

  // 一个完整的块：长度 + 类型 + 数据 + CRC（类型 + 数据）
  function chunk(type, data) {
    if (typeof type !== 'string' || !/^[A-Za-z]{4}$/.test(type)) throw new TypeError('PNG 块类型要是 4 个英文字母：' + q(type));
    const d = nbt().asBytes(data || new Uint8Array(0));
    const out = new Uint8Array(12 + d.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, d.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(d, 8);
    dv.setUint32(8 + d.length, crc32(out, 4, 8 + d.length));
    return out;
  }

  // 走一遍块，到 IEND 为止：[{type, start, length, end, crc, crcOk?}]；结构坏了 → bad_png
  // （通用的走法，给写入和 info 用；读鲸图用 extract，那里的检查顺序按 FORMAT.md 第 1 节）
  function chunks(bytes, opts) {
    const b = nbt().asBytes(bytes);
    if (!isPng(b)) throw new ShareError('bad_png', '开头不是 PNG 签名');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const withCrc = !!(opts && opts.crc);
    const list = [];
    let p = 8;
    for (;;) {
      if (p + 8 > b.length) throw new ShareError('bad_png', p >= b.length ? '到文件末尾还没遇到 IEND' : `第 ${p} 字节处块头不完整`);
      const len = dv.getUint32(p);
      const type = typeAt(b, p + 4);
      if (len > b.length - p - 12) throw new ShareError('bad_png', `${q(type)} 块的长度 ${len} 超出文件`);
      const c = { type, start: p, length: len, end: p + 12 + len, crc: dv.getUint32(p + 8 + len) };
      if (withCrc) c.crcOk = crc32(b, p + 4, p + 8 + len) === c.crc;
      list.push(c);
      p = c.end;
      if (type === 'IEND') return list;
    }
  }

  // 把 type 块换成 data（先删掉所有 type 块，新的放在 IEND 紧前面；IEND 后面多出来的字节丢掉）
  function setChunk(bytes, type, data) {
    const b = nbt().asBytes(bytes);
    const list = chunks(b);
    const parts = [SIG];
    for (const c of list) {
      if (c.type === 'IEND') parts.push(chunk(type, data));
      if (c.type !== type) parts.push(b.subarray(c.start, c.end));
    }
    return concat(parts);
  }

  // zlib 流，全部用「不压缩」块（结果和 zlib 版本无关，每次都一样）
  function zlibStored(raw) {
    const n = raw.length;
    const blocks = Math.max(1, Math.ceil(n / 65535));
    const out = new Uint8Array(2 + n + blocks * 5 + 4);
    out[0] = 0x78;
    out[1] = 0x01;
    let p = 2;
    for (let i = 0; i < blocks; i++) {
      const s = i * 65535;
      const len = Math.min(65535, n - s);
      out[p++] = i === blocks - 1 ? 1 : 0;
      out[p++] = len & 0xff;
      out[p++] = len >> 8;
      out[p++] = ~len & 0xff;
      out[p++] = (~len >> 8) & 0xff;
      out.set(raw.subarray(s, s + len), p);
      p += len;
    }
    let a = 1, c = 0;
    for (let i = 0; i < n; i++) {
      a = (a + raw[i]) % 65521;
      c = (c + a) % 65521;
    }
    new DataView(out.buffer).setUint32(p, ((c << 16) | a) >>> 0);
    return out;
  }

  // 纯色 RGB 小图（样例和「没给图」时的占位图）
  function solid(w, h, rgb) {
    w = w || 16;
    h = h || 16;
    const color = rgb || [0x4a, 0x90, 0xc8];
    const row = 1 + w * 3;
    const raw = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = y * row + 1 + x * 3;
        raw[o] = color[0];
        raw[o + 1] = color[1];
        raw[o + 2] = color[2];
      }
    }
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr[8] = 8;   // 每通道 8 位
    ihdr[9] = 2;   // RGB
    return concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND')]);
  }

  S.png = Object.freeze({ SIG, isPng: (x) => isPng(nbt().asBytes(x)), crc32, chunks, chunk, setChunk, solid });

  // ---------- 读 ----------

  // FORMAT.md 第 1 节：从第 9 字节起走到 IEND，遇到 xjSc 当场依次查 too_large → bad_png → bad_crc
  S.extract = function (bytes) {
    const b = nbt().asBytes(bytes);
    if (!isPng(b)) throw new ShareError('unknown_file');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let found = null;
    let count = 0;
    let p = 8;
    for (;;) {
      if (p + 8 > b.length) throw new ShareError('bad_png', p >= b.length ? '到文件末尾还没遇到 IEND' : `第 ${p} 字节处块头不完整`);
      const len = dv.getUint32(p);
      const type = typeAt(b, p + 4);
      if (type === S.CHUNK_TYPE) {
        if (len > S.LIMITS.chunk) throw new ShareError('too_large', `xjSc 声明 ${len} 字节，超过 16 MiB`);
        if (len > b.length - p - 12) throw new ShareError('bad_png', 'xjSc 块的数据不完整');
        if (crc32(b, p + 4, p + 8 + len) !== dv.getUint32(p + 8 + len)) throw new ShareError('bad_crc', `第 ${count + 1} 个 xjSc 块 CRC 不对`);
        count++;
        if (!found) found = b.slice(p + 8, p + 8 + len);
      } else if (len > b.length - p - 12) {
        throw new ShareError('bad_png', `${q(type)} 块的长度 ${len} 超出文件`);
      }
      p += 12 + len;
      if (type === 'IEND') break;
    }
    if (count === 0) throw new ShareError('no_data');
    if (count > 1) throw new ShareError('multiple_data', `有 ${count} 个 xjSc 块`);
    return found;
  };

  S.read = async function (input) {
    const b = await toBytes(input);
    if (isPng(b)) return S.readSchem(S.extract(b));
    if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return S.readSchem(b);
    throw new ShareError('unknown_file');
  };

  // NbtError / 栈溢出 → ShareError；别的异常（代码错误、浏览器不支持）原样抛
  function asShare(e, code) {
    if (e instanceof ShareError) return e;
    if (e instanceof nbt().NbtError) return new ShareError(e.code === 'too_large' ? 'too_large' : code, e.detail);
    if (e instanceof RangeError) return new ShareError(code, e.message);
    return e;
  }

  S.readSchem = async function (input) {
    const N = nbt();
    const b = await toBytes(input);
    let raw;
    try {
      raw = await N.gunzip(b, S.LIMITS.unzipped);
    } catch (e) {
      throw asShare(e, 'bad_gzip');
    }
    let root;
    try {
      root = N.read(raw, { maxTags: S.LIMITS.tags });
    } catch (e) {
      throw asShare(e, 'bad_nbt');
    }
    return S.fromNbt(root.value);
  };

  function kindIs(tag, kind) {
    return tag !== null && typeof tag === 'object' && hasOwn(tag, kind) && Object.keys(tag).length === 1;
  }
  const compoundOf = (t) => (kindIs(t, 'compound') && t.compound && typeof t.compound === 'object' ? t.compound : null);
  const intOf = (t) => (kindIs(t, 'int') && isInt32(t.int) ? t.int : null);
  const shortOf = (t) => (kindIs(t, 'short') && isInt32(t.short) ? t.short : null);
  const stringOf = (t) => (kindIs(t, 'string') && typeof t.string === 'string' ? t.string : null);
  const listOf = (t) => (kindIs(t, 'list') && Array.isArray(t.list) ? t.list : null);
  function intArrayOf(t) {
    if (!kindIs(t, 'intArray')) return null;
    const a = t.intArray;
    if (a instanceof Int32Array) return a;
    return Array.isArray(a) && a.every(isInt32) ? a : null;
  }
  function byteArrayOf(t) {
    if (!kindIs(t, 'byteArray')) return null;
    const a = t.byteArray;
    if (ArrayBuffer.isView(a) && a.BYTES_PER_ELEMENT === 1) return new Uint8Array(a.buffer, a.byteOffset, a.length);
    return Array.isArray(a) ? Uint8Array.from(a, (x) => x & 0xff) : null;
  }

  // 带类型的 NBT 根（{compound:{…}}）→ 模型。检查顺序按 FORMAT.md 第 3 节
  S.fromNbt = function (rootTag) {
    const R = compoundOf(rootTag);
    if (!R) bad('根不是 compound');
    let s;
    if (hasOwn(R, 'Schematic')) {
      s = compoundOf(R.Schematic);
      if (!s) bad('Schematic 不是 compound');
    } else if (hasOwn(R, 'Version')) {
      s = R;
    } else {
      bad('没有 Schematic');
    }

    if (!hasOwn(s, 'Version')) bad('没有 Version');
    const version = intOf(s.Version);
    if (version === null) bad('Version 不是 int');
    if (version !== S.SPONGE_VERSION) throw new ShareError('unsupported_version', `Version = ${version}`, { version });

    if (!hasOwn(s, 'DataVersion')) bad('没有 DataVersion');
    const dataVersion = intOf(s.DataVersion);
    if (dataVersion === null) bad('DataVersion 不是 int');

    let meta = null;
    if (hasOwn(s, 'Metadata')) {
      if (!compoundOf(s.Metadata)) bad('Metadata 不是 compound');
      meta = s.Metadata;
    }

    const size = ['Width', 'Height', 'Length'].map((k) => {
      if (!hasOwn(s, k)) bad(`没有 ${k}`);
      const v = shortOf(s[k]);
      if (v === null) bad(`${k} 不是 short`);
      const u = v & 0xffff;
      if (u < 1) bad(`${k} 是 0`);
      return u;
    });
    const [W, H, L] = size;
    const L_ = S.LIMITS;
    if (W > L_.side || H > L_.side || L > L_.side || W * H * L > L_.cells) throw new ShareError('too_large', `尺寸 ${W}×${H}×${L}`);
    const count = W * H * L;

    let offset = [0, 0, 0];
    if (hasOwn(s, 'Offset')) {
      const o = intArrayOf(s.Offset);
      if (!o || o.length !== 3) bad('Offset 不是 3 个数的 int array');
      offset = [o[0], o[1], o[2]];
    }

    if (!hasOwn(s, 'Blocks')) bad('没有 Blocks');
    const B = compoundOf(s.Blocks);
    if (!B) bad('Blocks 不是 compound');

    if (!hasOwn(B, 'Palette')) bad('没有 Blocks.Palette');
    const P = compoundOf(B.Palette);
    if (!P) bad('Blocks.Palette 不是 compound');
    const byId = new Map();
    let maxId = -1;
    const states = Object.keys(P);
    for (const k of states) {
      const id = intOf(P[k]);
      if (id === null) bad(`Blocks.Palette 里 ${q(k)} 的编号不是 int`);
      if (id < 0) bad(`Blocks.Palette 里 ${q(k)} 的编号是负数（${id}）`);
      if (byId.has(id)) bad(`Blocks.Palette 里 ${q(byId.get(id))} 和 ${q(k)} 都是编号 ${id}`);
      byId.set(id, k);
      if (id > maxId) maxId = id;
    }
    if (states.length > L_.palette) throw new ShareError('too_large', `调色板有 ${states.length} 种状态`);

    if (!hasOwn(B, 'Data')) bad('没有 Blocks.Data');
    const data = byteArrayOf(B.Data);
    if (!data) bad('Blocks.Data 不是 byte array');
    let cells;
    try {
      cells = nbt().varint.decode(data, count);
    } catch (e) {
      if (e instanceof nbt().NbtError) bad(`Blocks.Data：${e.detail}`);
      throw e;
    }
    // 编号 → 规范下标（按第一次出现的顺序）；NOT = 不在 Palette 里，UNSEEN = 还没出现过
    const NOT = -2, UNSEEN = -1;
    const dense = maxId < (1 << 20);
    const table = dense ? new Int32Array(maxId + 1).fill(NOT) : null;
    const sparse = dense ? null : new Map();
    for (const id of byId.keys()) {
      if (dense) table[id] = UNSEEN;
      else sparse.set(id, UNSEEN);
    }
    const palette = [];
    for (let i = 0; i < count; i++) {
      const id = cells[i];
      let c = dense ? (id <= maxId ? table[id] : NOT) : (sparse.has(id) ? sparse.get(id) : NOT);
      if (c < 0) {
        if (c === NOT) {
          const x = i % W, z = Math.floor(i / W) % L, y = Math.floor(i / (W * L));
          bad(`Blocks.Data 第 ${i} 格（x=${x}, y=${y}, z=${z}）的编号 ${id} 不在 Palette 里`);
        }
        c = palette.length;
        palette.push(byId.get(id));
        if (dense) table[id] = c;
        else sparse.set(id, c);
      }
      cells[i] = c;
    }

    const blockEntities = [];
    if (hasOwn(B, 'BlockEntities')) {
      const list = listOf(B.BlockEntities);
      if (!list) bad('Blocks.BlockEntities 不是 list');
      const seen = new Map();
      const tmp = [];
      list.forEach((el, n) => {
        const what = `Blocks.BlockEntities 第 ${n} 个`;
        const e = compoundOf(el);
        if (!e) bad(`${what}不是 compound`);
        if (!hasOwn(e, 'Pos')) bad(`${what}没有 Pos`);
        const pos = intArrayOf(e.Pos);
        if (!pos || pos.length !== 3) bad(`${what}的 Pos 不是 3 个数的 int array`);
        if (!hasOwn(e, 'Id')) bad(`${what}没有 Id`);
        const id = stringOf(e.Id);
        if (id === null) bad(`${what}的 Id 不是 string`);
        let d = null;
        if (hasOwn(e, 'Data')) {
          if (!compoundOf(e.Data)) bad(`${what}的 Data 不是 compound`);
          d = e.Data;
        }
        const [x, y, z] = pos;
        if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= L) bad(`${what}的 Pos [${x},${y},${z}] 超出范围`);
        const idx = x + z * W + y * W * L;
        if (seen.has(idx)) bad(`Blocks.BlockEntities 第 ${seen.get(idx)} 个和第 ${n} 个都在 [${x},${y},${z}]`);
        seen.set(idx, n);
        tmp.push({ idx, be: { pos: [x, y, z], id, data: d } });
      });
      tmp.sort((a, b) => a.idx - b.idx);
      for (const t of tmp) blockEntities.push(t.be);
    }

    const warnings = [];
    if (dataVersion !== S.DATA_VERSION) warnings.push('data_version');
    if (hasOwn(s, 'Biomes')) warnings.push('ignored_biomes');
    if (hasOwn(s, 'Entities')) {
      const ents = listOf(s.Entities);
      if (ents && ents.length > 0) warnings.push('ignored_entities');
    }
    if (meta) {
      const xj = compoundOf(meta.compound.Xiaojingyu);
      const fv = xj && hasOwn(xj, 'FormatVersion') ? intOf(xj.FormatVersion) : null;
      if (fv !== null && fv > S.FORMAT_VERSION) warnings.push('newer_format');
    }
    if (palette.length < byId.size) warnings.push('unused_palette');
    warnings.sort();

    return { size, offset, dataVersion, meta, palette, cells, blockEntities, warnings };
  };

  // ---------- 写 ----------

  // 检查模型（规则和读的时候一样）并规范化；不改原模型
  function prepare(model) {
    if (!model || typeof model !== 'object') bad('模型不是对象');
    const size = model.size;
    if (!Array.isArray(size) || size.length !== 3 || !size.every(Number.isInteger)) bad('size 要是 3 个整数');
    const [W, H, L] = size;
    if (W < 1 || H < 1 || L < 1) bad(`尺寸 ${W}×${H}×${L} 有小于 1 的边`);
    const L_ = S.LIMITS;
    if (W > L_.side || H > L_.side || L > L_.side || W * H * L > L_.cells) throw new ShareError('too_large', `尺寸 ${W}×${H}×${L}`);
    const offset = model.offset == null ? [0, 0, 0] : model.offset;
    if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(isInt32)) bad('offset 要是 3 个 int');
    const dataVersion = model.dataVersion == null ? S.DATA_VERSION : model.dataVersion;
    if (!isInt32(dataVersion)) bad('dataVersion 不是 int');
    const meta = model.meta == null ? null : model.meta;
    if (meta !== null && !compoundOf(meta)) bad('meta 要是 {compound:{…}} 或 null');

    const pal = model.palette;
    if (!Array.isArray(pal)) bad('palette 要是数组');
    const seenState = new Set();
    pal.forEach((st, i) => {
      if (typeof st !== 'string') bad(`palette[${i}] 不是字符串`);
      if (seenState.has(st)) bad(`palette 里 ${q(st)} 出现了不止一次`);
      seenState.add(st);
    });

    const n = W * H * L;
    const src = model.cells;
    if (!src || typeof src.length !== 'number' || src.length !== n) bad(`cells 要有 ${n} 个（W×H×L），实际 ${src && src.length}`);
    const np = pal.length;
    const map = new Int32Array(np).fill(-1);
    const cells = new Int32Array(n);
    const palette = [];
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if ((v | 0) !== v || v < 0 || v >= np) bad(`cells[${i}] = ${v} 不是 palette 的下标`);
      let c = map[v];
      if (c < 0) {
        c = map[v] = palette.length;
        palette.push(pal[v]);
      }
      cells[i] = c;
    }
    if (palette.length > L_.palette) throw new ShareError('too_large', `调色板有 ${palette.length} 种状态`);

    const bes = model.blockEntities == null ? [] : model.blockEntities;
    if (!Array.isArray(bes)) bad('blockEntities 要是数组');
    const seen = new Map();
    const tmp = bes.map((be, k) => {
      const what = `blockEntities[${k}]`;
      if (!be || typeof be !== 'object') bad(`${what} 不是对象`);
      const pos = be.pos;
      if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isInt32)) bad(`${what} 的 pos 要是 3 个 int`);
      const [x, y, z] = pos;
      if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= L) bad(`${what} 的 pos [${x},${y},${z}] 超出范围`);
      if (typeof be.id !== 'string') bad(`${what} 的 id 不是字符串`);
      const data = be.data == null ? null : be.data;
      if (data !== null && !compoundOf(data)) bad(`${what} 的 data 要是 {compound:{…}} 或 null`);
      const idx = x + z * W + y * W * L;
      if (seen.has(idx)) bad(`blockEntities[${seen.get(idx)}] 和 [${k}] 都在 [${x},${y},${z}]`);
      seen.set(idx, k);
      return { idx, be: { pos: [x, y, z], id: be.id, data } };
    });
    tmp.sort((a, b) => a.idx - b.idx);

    const warnings = Array.isArray(model.warnings) ? Array.from(new Set(model.warnings.map(String))).sort() : [];
    return {
      size: [W, H, L], offset: offset.slice(), dataVersion, meta, palette, cells,
      blockEntities: tmp.map((t) => t.be), warnings,
    };
  }

  // 规范化：palette 按第一次出现的顺序、去掉没用到的；blockEntities 按格子编号排（不加警告）
  S.canonicalize = function (model) {
    return prepare(model);
  };

  // FORMAT.md 第 3.1 节：命名空间 = 状态字符串 [ 前面部分的第一个 : 前面，没有 : 就是 minecraft
  S.requiredMods = function (palette) {
    const set = new Set();
    for (const st of palette) {
      const b = st.indexOf('[');
      const id = b < 0 ? st : st.slice(0, b);
      const c = id.indexOf(':');
      const ns = c < 0 ? 'minecraft' : id.slice(0, c);
      if (ns !== 'minecraft') set.add(ns);
    }
    return Array.from(set).sort();
  };

  function metaForWrite(meta, palette) {
    const src = meta.compound;
    const c = Object.create(null);
    for (const k of Object.keys(src)) if (k !== 'RequiredMods') c[k] = src[k];
    const mods = S.requiredMods(palette);
    if (mods.length) c.RequiredMods = { list: mods.map((m) => ({ string: m })) };
    return { compound: c };
  }

  function buildNbt(m) {
    const N = nbt();
    const P = Object.create(null);
    m.palette.forEach((st, i) => { P[st] = { int: i }; });
    const s = Object.create(null);
    s.Version = { int: S.SPONGE_VERSION };
    s.DataVersion = { int: m.dataVersion };
    if (m.meta) s.Metadata = metaForWrite(m.meta, m.palette);
    s.Width = { short: m.size[0] };
    s.Height = { short: m.size[1] };
    s.Length = { short: m.size[2] };
    s.Offset = { intArray: Int32Array.from(m.offset) };
    const blocks = Object.create(null);
    blocks.Palette = { compound: P };
    blocks.Data = { byteArray: N.varint.encode(m.cells) };
    blocks.BlockEntities = {
      list: m.blockEntities.map((be) => {
        const c = Object.create(null);
        c.Pos = { intArray: Int32Array.from(be.pos) };
        c.Id = { string: be.id };
        if (be.data) c.Data = be.data;
        return { compound: c };
      }),
    };
    s.Blocks = { compound: blocks };
    const root = Object.create(null);
    root.Schematic = { compound: s };
    return { compound: root };
  }

  // 模型 → 带类型的 NBT 根（写文件前的样子；RequiredMods 已按调色板重算）
  S.toNbt = function (model) {
    return buildNbt(prepare(model));
  };

  S.writeSchem = async function (model) {
    const N = nbt();
    const m = prepare(model);
    let raw;
    try {
      raw = N.write(buildNbt(m), '', { maxTags: S.LIMITS.tags });
    } catch (e) {
      // 标签太多 → too_large（FORMAT.md 第 2 节「写的时候也照样数」）；别的写不出来 → bad_schematic
      if (e instanceof N.NbtError) throw new ShareError(e.code === 'too_large' ? 'too_large' : 'bad_schematic', e.detail);
      throw e;
    }
    if (raw.length > S.LIMITS.unzipped) throw new ShareError('too_large', `NBT 有 ${raw.length} 字节，超过 64 MiB`);
    return N.gzip(raw);
  };

  // png：底图（PNG 字节）；不给就用 16×16 纯色图。底图里原有的 xjSc 全部删掉
  S.writePng = async function (model, png) {
    const schem = await S.writeSchem(model);
    if (schem.length > S.LIMITS.chunk) throw new ShareError('too_large', `.schem 有 ${schem.length} 字节，超过 16 MiB`);
    const base = png == null ? solid(16, 16) : await toBytes(png);
    return setChunk(base, S.CHUNK_TYPE, schem);
  };

  // ---------- dump ----------

  S.dump = function (model) {
    const N = nbt();
    const m = prepare(model);
    const c = m.cells;
    const runs = [];
    let cur = c[0], run = 1;
    for (let i = 1; i < c.length; i++) {
      if (c[i] === cur) {
        run++;
      } else {
        runs.push([run, cur]);
        cur = c[i];
        run = 1;
      }
    }
    runs.push([run, cur]);
    try {
      return {
        dump: 1,
        size: m.size,
        offset: m.offset,
        dataVersion: m.dataVersion,
        meta: m.meta ? N.toJSON(m.meta) : null,
        palette: m.palette,
        cells: runs,
        blockEntities: m.blockEntities.map((be) => ({ pos: be.pos, id: be.id, data: be.data ? N.toJSON(be.data) : null })),
        warnings: m.warnings,
      };
    } catch (e) {
      if (e instanceof N.NbtError) throw new ShareError('bad_schematic', e.detail);
      throw e;
    }
  };

  const DUMP_KEYS = ['dump', 'size', 'offset', 'dataVersion', 'meta', 'palette', 'cells', 'blockEntities', 'warnings'];

  // dump（纯 JSON）→ 模型；严格检查形状
  S.fromDump = function (d) {
    const N = nbt();
    const badDump = (detail) => { throw new ShareError('bad_dump', detail); };
    if (!d || typeof d !== 'object' || Array.isArray(d)) badDump('不是对象');
    const keys = Object.keys(d);
    for (const k of keys) if (!DUMP_KEYS.includes(k)) badDump(`多了键 ${q(k)}`);
    for (const k of DUMP_KEYS) if (!hasOwn(d, k)) badDump(`少了键 ${q(k)}`);
    if (d.dump !== 1) badDump('dump 要是 1');
    const ints3 = (a) => Array.isArray(a) && a.length === 3 && a.every(isInt32);
    if (!ints3(d.size) || !d.size.every((v) => v >= 1)) badDump('size 要是 3 个 ≥ 1 的整数');
    const [W, H, L] = d.size;
    const L_ = S.LIMITS;
    if (W > L_.side || H > L_.side || L > L_.side || W * H * L > L_.cells) throw new ShareError('too_large', `尺寸 ${W}×${H}×${L}`);
    if (!ints3(d.offset)) badDump('offset 要是 3 个 int');
    if (!isInt32(d.dataVersion)) badDump('dataVersion 要是 int');
    if (!Array.isArray(d.palette) || !d.palette.every((s) => typeof s === 'string')) badDump('palette 要是字符串数组');
    if (!Array.isArray(d.cells)) badDump('cells 要是数组');
    const n = W * H * L;
    const cells = new Int32Array(n);
    let p = 0;
    d.cells.forEach((r, k) => {
      if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[0]) || r[0] < 1 || !Number.isInteger(r[1]) || r[1] < 0 || r[1] >= d.palette.length) {
        badDump(`cells[${k}] 要是 [格数 ≥ 1, palette 下标]`);
      }
      if (p + r[0] > n) badDump(`cells 加起来超过 ${n} 格`);
      cells.fill(r[1], p, p + r[0]);
      p += r[0];
    });
    if (p !== n) badDump(`cells 加起来是 ${p} 格，应该是 ${n}`);
    if (!Array.isArray(d.blockEntities)) badDump('blockEntities 要是数组');
    if (!Array.isArray(d.warnings) || !d.warnings.every((s) => typeof s === 'string')) badDump('warnings 要是字符串数组');
    try {
      const meta = d.meta === null ? null : N.fromJSON(d.meta, 'meta');
      if (meta && !compoundOf(meta)) badDump('meta 要是 {"compound":{…}} 或 null');
      const blockEntities = d.blockEntities.map((be, k) => {
        const what = `blockEntities[${k}]`;
        if (!be || typeof be !== 'object' || Array.isArray(be)) badDump(`${what} 不是对象`);
        const ks = Object.keys(be);
        if (ks.length !== 3 || !hasOwn(be, 'pos') || !hasOwn(be, 'id') || !hasOwn(be, 'data')) badDump(`${what} 要正好有 pos、id、data 三个键`);
        if (!ints3(be.pos)) badDump(`${what}.pos 要是 3 个 int`);
        if (typeof be.id !== 'string') badDump(`${what}.id 要是字符串`);
        const data = be.data === null ? null : N.fromJSON(be.data, `${what}.data`);
        if (data && !compoundOf(data)) badDump(`${what}.data 要是 {"compound":{…}} 或 null`);
        return { pos: be.pos.slice(), id: be.id, data };
      });
      return {
        size: [W, H, L], offset: d.offset.slice(), dataVersion: d.dataVersion, meta,
        palette: d.palette.slice(), cells, blockEntities, warnings: d.warnings.slice(),
      };
    } catch (e) {
      if (e instanceof N.NbtError) badDump(e.detail);
      throw e;
    }
  };

  // 两个 dump 按 JSON 值比较
  S.equalDump = function (a, b) {
    return nbt().equalJSON(a, b);
  };

  // 格子编号 ↔ 坐标
  S.index = function (size, x, y, z) {
    return x + z * size[0] + y * size[0] * size[2];
  };
  S.posOf = function (size, i) {
    const W = size[0], L = size[2];
    return [i % W, Math.floor(i / (W * L)), Math.floor(i / W) % L];
  };
})(window.V3);
