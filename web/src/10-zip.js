// 10-zip.js — 读 zip（YSM 模型包用）：V3.zip.read(bytes) → Promise<Map(路径 → Uint8Array)>，不用第三方库。
// 支持 stored(0) 和 deflate(8)（优先用浏览器自带 DecompressionStream('deflate-raw')）；不支持 zip64、加密的 zip。
// 2026-11-09：老浏览器（实测 Edge 100）没有 DecompressionStream('deflate-raw')，会报
//   Unsupported compression format: 'deflate-raw' → 自带的 YSM 模型解不开。这里带一份纯 JS inflate 兜底，
//   原生解压失败时自动退回（Z.inflateRawJS 也可单独用/测）。
// 文件名：带 UTF-8 标志位按 UTF-8 解码；没有标志位时先试 UTF-8（严格），失败再按 GBK（Windows 中文压缩软件常见）。
// 路径统一成 / 分隔、去掉开头的 ./ 和 /；目录项不放进结果。
(function (V3) {
  'use strict';
  const Z = V3.zip = {};
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const utf8 = new TextDecoder('utf-8'), utf8Strict = new TextDecoder('utf-8', { fatal: true });
  let gbk = null;
  try { gbk = new TextDecoder('gbk'); } catch (e) { gbk = null; }
  const name = (bytes, flagUtf8) => {
    if (flagUtf8) return utf8.decode(bytes);
    try { return utf8Strict.decode(bytes); } catch (e) { return gbk ? gbk.decode(bytes) : utf8.decode(bytes); }
  };
  Z.clean = (p) => String(p).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  // 结尾的「中央目录结束记录」：签名 0x06054b50，后面最多 65535 字节注释
  const findEOCD = (b) => {
    for (let o = b.length - 22, lo = Math.max(0, b.length - 22 - 65535); o >= lo; o--) if (u32(b, o) === 0x06054b50) return o;
    return -1;
  };
  // ---- 纯 JS raw-deflate 解压（canonical Huffman，参照 tinf/puff；浏览器没有 deflate-raw 时用）----
  Z.inflateRawJS = function (src) {
    src = src instanceof Uint8Array ? src : new Uint8Array(src);
    let pos = 0, bitBuf = 0, bitCnt = 0;
    let outBuf = new Uint8Array(Math.max(64, src.length * 4)), outLen = 0;
    const ensure = (n) => {
      if (outLen + n > outBuf.length) {
        let cap = outBuf.length;
        while (cap < outLen + n) cap <<= 1;
        const nb = new Uint8Array(cap);
        nb.set(outBuf.subarray(0, outLen));
        outBuf = nb;
      }
    };
    const getBit = () => {
      if (bitCnt === 0) {
        if (pos >= src.length) throw new Error('deflate 数据提前结束');
        bitBuf = src[pos++]; bitCnt = 8;
      }
      const b = bitBuf & 1; bitBuf >>>= 1; bitCnt--;
      return b;
    };
    const getBits = (n) => { let v = 0; for (let i = 0; i < n; i++) v |= getBit() << i; return v; };
    const buildTree = (lengths, n) => {
      const counts = new Uint16Array(16), offsets = new Uint16Array(16), symbols = new Uint16Array(n);
      for (let i = 0; i < n; i++) counts[lengths[i]]++;
      counts[0] = 0;
      for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
      for (let i = 0; i < n; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
      return { counts, symbols };
    };
    const decodeSym = (tree) => {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len < 16; len++) {
        code |= getBit();
        const count = tree.counts[len];
        if (code - first < count) return tree.symbols[index + (code - first)];
        index += count; first = (first + count) << 1; code <<= 1;
      }
      throw new Error('deflate Huffman 码损坏');
    };
    const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const LEXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const DEXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    const FIXED_LIT = new Uint8Array(288), FIXED_DIST = new Uint8Array(30);
    for (let i = 0; i <= 143; i++) FIXED_LIT[i] = 8;
    for (let i = 144; i <= 255; i++) FIXED_LIT[i] = 9;
    for (let i = 256; i <= 279; i++) FIXED_LIT[i] = 7;
    for (let i = 280; i <= 287; i++) FIXED_LIT[i] = 8;
    for (let i = 0; i < 30; i++) FIXED_DIST[i] = 5;
    const fixedLit = buildTree(FIXED_LIT, 288), fixedDist = buildTree(FIXED_DIST, 30);
    const inflateBlock = (litTree, distTree) => {
      for (;;) {
        const sym = decodeSym(litTree);
        if (sym < 256) { ensure(1); outBuf[outLen++] = sym; }
        else if (sym === 256) return;
        else {
          const li = sym - 257;
          if (li >= 29) throw new Error('deflate 长度码非法');
          const len = LBASE[li] + (LEXTRA[li] ? getBits(LEXTRA[li]) : 0);
          const ds = decodeSym(distTree);
          if (ds >= 30) throw new Error('deflate 距离码非法');
          const dist = DBASE[ds] + (DEXTRA[ds] ? getBits(DEXTRA[ds]) : 0);
          if (dist > outLen) throw new Error('deflate 距离越界');
          ensure(len);
          let from = outLen - dist;
          for (let i = 0; i < len; i++) outBuf[outLen++] = outBuf[from++];
        }
      }
    };
    let last = 0;
    do {
      last = getBit();
      const type = getBits(2);
      if (type === 0) {
        bitCnt = 0;                                   // 对齐到字节边界
        if (pos + 4 > src.length) throw new Error('deflate stored 块损坏');
        const len = src[pos] | (src[pos + 1] << 8);
        pos += 4;                                     // LEN + NLEN
        if (pos + len > src.length) throw new Error('deflate stored 块越界');
        ensure(len);
        outBuf.set(src.subarray(pos, pos + len), outLen);
        outLen += len; pos += len;
      } else if (type === 1) {
        inflateBlock(fixedLit, fixedDist);
      } else if (type === 2) {
        const hlit = 257 + getBits(5), hdist = 1 + getBits(5), hclen = 4 + getBits(4);
        const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLengths[ORDER[i]] = getBits(3);
        const clTree = buildTree(clLengths, 19);
        const lengths = new Uint8Array(hlit + hdist);
        let i = 0;
        while (i < lengths.length) {
          const sym = decodeSym(clTree);
          if (sym < 16) lengths[i++] = sym;
          else if (sym === 16) {
            if (i === 0) throw new Error('deflate 重复码无前值');
            const rep = 3 + getBits(2), prev = lengths[i - 1];
            for (let k = 0; k < rep; k++) lengths[i++] = prev;
          } else if (sym === 17) {
            const rep = 3 + getBits(3);
            for (let k = 0; k < rep; k++) lengths[i++] = 0;
          } else {
            const rep = 11 + getBits(7);
            for (let k = 0; k < rep; k++) lengths[i++] = 0;
          }
        }
        inflateBlock(buildTree(lengths.subarray(0, hlit), hlit), buildTree(lengths.subarray(hlit), hdist));
      } else {
        throw new Error('deflate 块类型非法');
      }
    } while (!last);
    return outBuf.slice(0, outLen);
  };
  const inflate = async (data) => {
    if (typeof DecompressionStream === 'function') {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
        return new Uint8Array(out);
      } catch (e) { /* 老浏览器不支持 deflate-raw：走下面的纯 JS 解压 */ }
    }
    return Z.inflateRawJS(data);
  };
  Z.isZip = (b) => !!b && b.length >= 4 && u32(b, 0) === 0x04034b50;
  // read(bytes | ArrayBuffer, { maxFiles = 2000, maxBytes = 64 MB }) → Map(path → Uint8Array)
  Z.read = async (input, opts = {}) => {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    const e = findEOCD(b);
    if (e < 0) throw new Error('不是 zip 文件（找不到目录）');
    const n = u16(b, e + 10), cdOff = u32(b, e + 16);
    if (n === 0xffff || cdOff === 0xffffffff) throw new Error('不支持 zip64');
    const maxFiles = opts.maxFiles || 2000, maxBytes = opts.maxBytes || 64 * 1048576;
    if (n > maxFiles) throw new Error('zip 里文件太多（' + n + ' 个）');
    const out = new Map();
    let o = cdOff, total = 0;
    for (let i = 0; i < n; i++) {
      if (u32(b, o) !== 0x02014b50) throw new Error('zip 目录损坏');
      const flags = u16(b, o + 8), method = u16(b, o + 10), csize = u32(b, o + 20), usize = u32(b, o + 24);
      const nl = u16(b, o + 28), xl = u16(b, o + 30), cl = u16(b, o + 32), lho = u32(b, o + 42);   // 本地文件头偏移在第 42 字节，文件名从 46 开始
      const path = Z.clean(name(b.subarray(o + 46, o + 46 + nl), flags & 0x800));
      o += 46 + nl + xl + cl;
      if (!path || path.endsWith('/')) continue;
      if (flags & 1) throw new Error('不支持加密的 zip：' + path);
      if (u32(b, lho) !== 0x04034b50) throw new Error('zip 文件头损坏：' + path);
      const start = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28), raw = b.subarray(start, start + csize);
      total += usize;
      if (total > maxBytes) throw new Error('zip 解开后太大（超过 ' + (maxBytes / 1048576) + ' MB）');
      let data;
      if (method === 0) data = raw.slice();
      else if (method === 8) data = await inflate(raw);
      else throw new Error('不支持的压缩方式 ' + method + '：' + path);
      out.set(path, data);
    }
    return out;
  };
  // 一组 File（<input webkitdirectory> 或拖进来的文件夹）→ Map(相对路径 → Uint8Array)
  Z.fromFiles = async (files) => {
    const out = new Map();
    for (const f of files) out.set(Z.clean(f.webkitRelativePath || f.relPath || f.name), new Uint8Array(await f.arrayBuffer()));
    return out;
  };
  Z.text = (bytes) => utf8.decode(bytes).replace(/^﻿/, '');
})(window.V3);
