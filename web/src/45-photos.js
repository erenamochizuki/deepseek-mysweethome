// 45-photos.js — V3.photos：相册和相框的数据（docs/PHOTOS.md，2026-11-08 web7）。纯数据 + 小函数，不碰 DOM / THREE，Node 里也能加载。
// 一张照片（JS 里）：{ id, png: Uint8Array, name, added: 毫秒 | null, tag: 原来的 NBT（读进来的才有，写回去原样，别的键不丢） }。
// NBT（PHOTOS.md 第 1 节）：compound { Id: string（PNG 的 SHA-1 前 16 位，小写）, Png: byte array, Name?: string, Added?: long }。
// 方块实体（第 2 节，鲸图的 BlockEntities，pos 是模型里的格子，不加 Offset）：
//   相册矮桌 xiaojingyu:photo_album_table   Data.Album = 照片的 list（最多 64 张；空相册不写这个键）
//   相框     xiaojingyu:photo_frame         Data.Photo = 一张照片；没有 = 空相框（显示衬纸）
//   画框墙   xiaojingyu:picture_frames（只在 part=0 那格）  Data.Slots = 6 个，照片或空 compound（空 = 原来的小画）
// Data 是 {}、缺键、键的类型不对：都当空的。坏照片（不是 PNG、不是 128 × 128、超过 48 KB）当没有：不画，console 里记一行。
// 模型里的格子都用场景格子 [x, y, z]（同 54-house-mc：格子 (0,0,0) 的场景位置 = 站立点 + Offset）。改了的都出一份新模型，不改原来的对象。
(function (V3) {
  'use strict';
  const P = V3.photos = {};
  P.SIZE = 128;
  P.MAX = 64;                       // 相册最多几张
  P.MAX_BYTES = 48 * 1024;          // 读的时候：一张最多 48 KB（按 49152 字节算）
  P.WRITE_BYTES = 48000;            // 网页自己存的：压到 48000 字节以内（48 KB 不管按 1000 还是 1024 算都不超）
  P.NAME_MAX = 64;                  // 名字最多 64 个字
  P.ALBUM = 'xiaojingyu:photo_album_table'; P.FRAME = 'xiaojingyu:photo_frame'; P.WALL = 'xiaojingyu:picture_frames';
  P.WALL_SLOTS = 6;
  const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

  // ---- SHA-1（小，同步；照片最多 48 KB）----
  P.sha1 = (b) => {
    const len = b.length, nb = ((len + 8) >> 6) + 1, W = new Int32Array(nb * 16), w = new Int32Array(80);
    for (let i = 0; i < len; i++) W[i >> 2] |= b[i] << (24 - (i & 3) * 8);
    W[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
    W[nb * 16 - 1] = (len * 8) | 0; W[nb * 16 - 2] = Math.floor(len / 0x20000000);
    let h0 = 0x67452301, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476, h4 = 0xc3d2e1f0 | 0;
    for (let o = 0; o < W.length; o += 16) {
      for (let t = 0; t < 16; t++) w[t] = W[o + t];
      for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
      let a = h0, bb = h1, c = h2, d = h3, e = h4;
      for (let t = 0; t < 80; t++) {
        const f = t < 20 ? ((bb & c) | (~bb & d)) + 0x5a827999 : t < 40 ? (bb ^ c ^ d) + 0x6ed9eba1 : t < 60 ? ((bb & c) | (bb & d) | (c & d)) + (0x8f1bbcdc | 0) : (bb ^ c ^ d) + (0xca62c1d6 | 0);
        const tmp = (((a << 5) | (a >>> 27)) + f + e + w[t]) | 0;
        e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
  };
  P.idOf = (png) => P.sha1(png).slice(0, 16);
  const ID_RE = /^[0-9a-f]{16}$/;

  const bytesOf = (v) => {
    if (v instanceof Uint8Array) return v;
    if (v instanceof Int8Array || v instanceof Uint8ClampedArray) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (Array.isArray(v)) return Uint8Array.from(v, (x) => x & 255);
    return null;
  };
  // ---- 检查（PHOTOS.md 第 1 节）：PNG 文件头、宽高 128、不超过 48 KB。→ { ok: true, w, h } / { ok: false, why } ----
  P.check = (png) => {
    const b = bytesOf(png);
    if (!b || !b.length) return { ok: false, why: '没有 PNG 数据' };
    if (b.length > P.MAX_BYTES) return { ok: false, why: '超过 48 KB（' + (b.length / 1024).toFixed(1) + ' KB）' };
    if (b.length < 33 || SIG.some((v, i) => b[i] !== v)) return { ok: false, why: '不是 PNG' };
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint32(8) !== 13 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return { ok: false, why: 'PNG 的头不对' };
    const w = dv.getUint32(16), h = dv.getUint32(20);
    if (w !== P.SIZE || h !== P.SIZE) return { ok: false, why: '不是 128 × 128（是 ' + w + ' × ' + h + '）' };
    return { ok: true, w, h };
  };
  const warned = new Set();
  P.warn = (where, why) => {
    const k = where + '|' + why;
    if (warned.has(k)) return;
    warned.add(k);
    if (typeof console !== 'undefined') console.warn('[photos] ' + where + '：' + why + '，不画');
  };

  // ---- 一张照片 ↔ NBT ----
  const cut = (s, n) => Array.from(String(s == null ? '' : s)).slice(0, n).join('');
  P.cleanName = (s) => cut(String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim(), P.NAME_MAX);
  // 新照片（网页里加的）：png 是检查过的字节
  P.make = (png, name, added) => ({ id: P.idOf(png), png, name: P.cleanName(name), added: added == null ? Date.now() : added, tag: null });
  // NBT 的值（{compound: …}）→ { photo, empty, bad }：photo 是照片或 null；empty = 空 compound / 没有；bad = 坏照片的原因
  P.fromTag = (tag) => {
    const c = tag && typeof tag === 'object' && tag.compound;
    if (!c || typeof c !== 'object' || !Object.keys(c).length) return { photo: null, empty: true, bad: null };
    const png = hasOwn(c, 'Png') ? bytesOf(c.Png && c.Png.byteArray) : null;
    if (!png) return { photo: null, empty: false, bad: '没有 Png' };
    const ck = P.check(png);
    if (!ck.ok) return { photo: null, empty: false, bad: ck.why };
    const sid = hasOwn(c, 'Id') && c.Id && typeof c.Id.string === 'string' ? c.Id.string : '';
    const name = hasOwn(c, 'Name') && c.Name && typeof c.Name.string === 'string' ? c.Name.string : '';
    const added = hasOwn(c, 'Added') && c.Added && c.Added.long != null && Number.isFinite(Number(c.Added.long)) ? Number(c.Added.long) : null;
    return { photo: { id: ID_RE.test(sid) ? sid : P.idOf(png), png, name, added, tag }, empty: false, bad: null };
  };
  // 照片 → NBT：读进来的原样（别的键也带着）；新的照 PHOTOS.md 第 1 节写
  P.toTag = (p) => {
    if (p.tag) return p.tag;
    const c = { Id: { string: p.id }, Png: { byteArray: new Int8Array(p.png.buffer, p.png.byteOffset, p.png.byteLength) } };
    if (p.name) c.Name = { string: p.name };
    if (p.added != null) c.Added = { long: String(Math.round(p.added)) };
    return { compound: c };
  };
  // 改名：别的键原样，只换 Name（空名字去掉 Name）
  P.renamed = (p, name) => {
    const n = P.cleanName(name), q = Object.assign({}, p, { name: n });
    if (p.tag) {
      const c = Object.assign({}, p.tag.compound);
      if (n) c.Name = { string: n }; else delete c.Name;
      q.tag = { compound: c };
    }
    return q;
  };

  // ---- 方块状态 ----
  // 'xiaojingyu:picture_frames[facing=east,part=0]' → { id, props }
  P.parseState = (s) => {
    const t = String(s || ''), b = t.indexOf('['), id = (b < 0 ? t : t.slice(0, b)).trim(), props = {};
    if (b >= 0) for (const kv of t.slice(b + 1, t.lastIndexOf(']') > b ? t.lastIndexOf(']') : t.length).split(',')) { const q = kv.indexOf('='); if (q > 0) props[kv.slice(0, q).trim()] = kv.slice(q + 1).trim(); }
    return { id: id.includes(':') ? id : 'minecraft:' + id, props };
  };
  // 这一格的方块要不要方块实体（同 42-house-mc 的 H.furnBlockEntity）：相册矮桌、相框、画框墙的 part=0 → 方块实体 id；别的 → null
  P.beIdOf = (state) => {
    const s = P.parseState(state);
    if (s.id === P.ALBUM || s.id === P.FRAME) return s.id;
    if (s.id === P.WALL) return String(s.props.part) === '0' ? s.id : null;
    return null;
  };

  // ---- 模型里的格子 ----
  const stand = () => ((V3.layout && V3.layout.house && V3.layout.house.stand) || (V3.houseMc && V3.houseMc.ORIGIN) || [-2, 0, -2]);
  P.originOf = (m) => {
    if (V3.houseBlocks && V3.houseBlocks.originOf) return V3.houseBlocks.originOf(m);
    const s = stand(), o = m && m.offset ? Array.from(m.offset, (n) => n | 0) : [0, 0, 0];
    return [s[0] + o[0], s[1] + o[1], s[2] + o[2]];
  };
  const view = (m) => {
    const [W, H, L] = m.size, org = P.originOf(m);
    const local = (c) => [c[0] - org[0], c[1] - org[1], c[2] - org[2]];
    const inside = (q) => q[0] >= 0 && q[1] >= 0 && q[2] >= 0 && q[0] < W && q[1] < H && q[2] < L;
    const idx = (q) => q[0] + q[2] * W + q[1] * W * L;
    const cellOf = (i) => [org[0] + i % W, org[1] + Math.floor(i / (W * L)), org[2] + Math.floor(i / W) % L];
    return { W, H, L, org, local, inside, idx, cellOf, state: (c) => { const q = local(c); return inside(q) ? m.palette[m.cells[idx(q)]] : null; } };
  };
  const key = (c) => c[0] + ',' + c[1] + ',' + c[2];
  // 这一格（场景格子）上的方块实体：{ pos, id, data } 或 null
  P.beAt = (m, cell) => {
    const V = view(m), q = V.local(cell);
    return (m.blockEntities || []).find((be) => be.pos[0] === q[0] && be.pos[1] === q[1] && be.pos[2] === q[2]) || null;
  };
  // 方块实体的 Data 里的成员（compound 的对象；没有 / 不是 compound → 空对象）
  P.dataOf = (be) => (be && be.data && be.data.compound && typeof be.data.compound === 'object' ? be.data.compound : {});
  // 换掉 / 加上这一格的方块实体（data = 成员对象）；按格子编号排好。→ 新模型
  P.withBE = (m, cell, id, data) => {
    const V = view(m), q = V.local(cell);
    if (!V.inside(q)) throw new Error('格子不在鲸图里：' + key(cell));
    const list = (m.blockEntities || []).filter((be) => !(be.pos[0] === q[0] && be.pos[1] === q[1] && be.pos[2] === q[2]));
    list.push({ pos: q, id, data: { compound: data } });
    list.sort((a, b) => V.idx(a.pos) - V.idx(b.pos));
    return Object.assign({}, m, { blockEntities: list });
  };
  // 模型里所有这几种方块：[{ cell, state, id（方块 id）, props }]（按格子编号）
  function scan(m, ids) {
    const V = view(m), want = m.palette.map((s) => { const p = P.parseState(s); return ids.includes(p.id) ? p : null; }), out = [];
    if (!want.some(Boolean)) return out;
    for (let i = 0; i < m.cells.length; i++) { const p = want[m.cells[i]]; if (p) out.push({ cell: V.cellOf(i), state: m.palette[m.cells[i]], id: p.id, props: p.props }); }
    return out;
  }

  // ---- 相册 ----
  // 一本相册（这一格的相册矮桌）：{ cell, photos: [照片…]（坏的不算）, bad: 坏照片的个数, keep: 坏照片原样（{ tag, why }，改相册时留在最后、不动）, raw: 原来的 list 长度 }
  P.albumAt = (m, cell) => {
    const be = P.beAt(m, cell), d = P.dataOf(be), list = hasOwn(d, 'Album') && d.Album && Array.isArray(d.Album.list) ? d.Album.list : [];
    const photos = [], keep = [];
    list.forEach((t, i) => {
      const r = P.fromTag(t);
      if (r.photo) photos.push(r.photo);
      else if (!r.empty) { keep.push({ tag: t, why: r.bad }); P.warn('相册矮桌 ' + key(cell) + ' 第 ' + (i + 1) + ' 张', r.bad); }
    });
    return { cell: cell.slice(), photos: photos.slice(0, P.MAX), bad: keep.length, keep, raw: list.length };
  };
  // 房子里的相册矮桌：[{ cell }]
  P.albumTables = (m) => scan(m, [P.ALBUM]).map((r) => ({ cell: r.cell }));
  // 换掉这本相册的照片（别的键原样；空相册不写 Album）→ 新模型。坏照片不会写回去
  P.setAlbum = (m, cell, photos) => {
    const be = P.beAt(m, cell), d = Object.assign({}, P.dataOf(be));
    if (photos.length) d.Album = { list: photos.slice(0, P.MAX).map(P.toTag) }; else delete d.Album;
    return P.withBE(m, cell, P.ALBUM, d);
  };
  // 离这一格最近的相册矮桌（同 MC：16 格以内，按格子中心的直线距离）→ 格子或 null
  P.nearestAlbum = (m, cell, max = 16) => {
    let best = null, bd = Infinity;
    for (const t of P.albumTables(m)) {
      const d = Math.hypot(t.cell[0] - cell[0], t.cell[1] - cell[1], t.cell[2] - cell[2]);
      if (d <= max + 1e-9 && d < bd) { bd = d; best = t.cell; }
    }
    return best;
  };

  // ---- 相框、画框墙 ----
  const FM = () => V3.furnMc;
  // 房子里的相框和画框墙（每件一条，画框墙是 part=0 那格）：{ kind: 'frame' | 'wall', block, f（规格）, cell（主格）, facing, slots: [照片 | null…], bad: [原因 | null…] }
  P.frames = (m) => {
    const out = [];
    for (const r of scan(m, [P.FRAME, P.WALL])) {
      if (r.id === P.WALL && String(r.props.part) !== '0') continue;
      const f = FM() && FM().byBlock(r.id), facing = ['north', 'east', 'south', 'west'].includes(r.props.facing) ? r.props.facing : 'north';
      const it = { kind: r.id === P.FRAME ? 'frame' : 'wall', block: r.id, f, cell: r.cell, facing, slots: [], bad: [] }, d = P.dataOf(P.beAt(m, r.cell));
      const n = it.kind === 'frame' ? 1 : P.WALL_SLOTS;
      const tags = it.kind === 'frame' ? [hasOwn(d, 'Photo') ? d.Photo : null] : (hasOwn(d, 'Slots') && d.Slots && Array.isArray(d.Slots.list) ? d.Slots.list : []);
      for (let i = 0; i < n; i++) {
        const t = P.fromTag(tags[i]);
        it.slots.push(t.photo); it.bad.push(t.bad);
        if (t.bad) P.warn((it.kind === 'frame' ? '相框 ' : '画框墙 ') + key(r.cell) + (n > 1 ? ' 第 ' + (i + 1) + ' 个框' : ''), t.bad);
      }
      out.push(it);
    }
    return out;
  };
  P.frameAt = (m, cell) => P.frames(m).find((q) => key(q.cell) === key(cell)) || null;
  // 换这一个框的照片（photo = null：空）→ 新模型。cell = 相框那格 / 画框墙 part=0 那格；slot = 第几个框（相框只有 0）
  P.setSlot = (m, cell, slot, photo) => {
    const V = view(m), st = P.parseState(V.state(cell)), be = P.beAt(m, cell), d = Object.assign({}, P.dataOf(be));
    if (st.id === P.FRAME) {
      if (photo) d.Photo = P.toTag(photo); else delete d.Photo;
      return P.withBE(m, cell, P.FRAME, d);
    }
    if (st.id !== P.WALL || String(st.props.part) !== '0') throw new Error('这一格不是相框，也不是画框墙的 part=0：' + key(cell));
    const old = hasOwn(d, 'Slots') && d.Slots && Array.isArray(d.Slots.list) ? d.Slots.list : [], list = [];
    for (let i = 0; i < P.WALL_SLOTS; i++) list.push(i === slot ? (photo ? P.toTag(photo) : { compound: {} }) : old[i] && old[i].compound ? old[i] : { compound: {} });
    d.Slots = { list };
    return P.withBE(m, cell, P.WALL, d);
  };

  // ---- 照片贴在哪（PHOTOS.md 第 3 节的画法）：一件家具（规格 f）的主格 main、朝 facing 时第 slot 个框 ----
  // → { corners: [左下, 右下, 右上, 左上]（场景坐标，从正面看；已经往正面挪了 0.01 像素）, normal（正面朝哪）, uv: [左下, 右下, 右上, 左上]（cover 裁剪）, center, size: [宽, 高]（米） }
  P.slotGeom = (f, main, facing, slot, lift = 0.01) => {
    const row = f && f.photoSlots && f.photoSlots[slot];
    if (!row) return null;
    const [part, x0, y0, x1, y1, z] = row, F = FM(), c = f.cells.find((q) => (q.part == null ? 0 : +q.part) === part) || f.cells[0];
    const o = c.offset, at = (x, y) => {
      const u = [(o[0] * 16 + x) / 16, (o[1] * 16 + y) / 16, (o[2] * 16 + z - lift) / 16], r = F.rotatePoint(u, facing);
      return [main[0] + r[0], main[1] + r[1], main[2] + r[2]];
    };
    const corners = [at(x1, y0), at(x0, y0), at(x0, y1), at(x1, y1)];   // 从正面看：左边是 x1
    const w = x1 - x0, h = y1 - y0, k = Math.min(w, h) / Math.max(w, h), a = (1 - k) / 2;
    const [u0, u1, v0, v1] = w >= h ? [0, 1, a, 1 - a] : [a, 1 - a, 0, 1];
    const center = [0, 1, 2].map((i) => (corners[0][i] + corners[2][i]) / 2);
    return { corners, normal: F.rotate([0, 0, -1], facing), uv: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], center, size: [w / 16, h / 16] };
  };

  // ---- 存 PNG（网页加照片用）：RGB 8 位，每行挑最省的过滤，zlib 用 CompressionStream('deflate') ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b, s, e) => { let c = 0xffffffff; for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') throw new Error('这个浏览器不能压缩（没有 CompressionStream），换新一点的浏览器');
    const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  // rgb：w × h × 3 字节（从上到下、从左到右）→ PNG 字节
  P.encodePng = async (rgb, w = P.SIZE, h = P.SIZE) => {
    const st = w * 3, raw = new Uint8Array((st + 1) * h), cand = new Uint8Array(st);
    for (let y = 0; y < h; y++) {
      const cur = y * st, prev = (y - 1) * st;
      let best = -1, bestSum = Infinity;
      for (let ft = 0; ft < 5; ft++) {
        let sum = 0;
        for (let i = 0; i < st; i++) {
          const x = rgb[cur + i], a = i >= 3 ? rgb[cur + i - 3] : 0, b = y ? rgb[prev + i] : 0, c = y && i >= 3 ? rgb[prev + i - 3] : 0;
          let pr = 0;
          if (ft === 1) pr = a; else if (ft === 2) pr = b; else if (ft === 3) pr = (a + b) >> 1;
          else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
          const v = (x - pr) & 255;
          cand[i] = v; sum += v < 128 ? v : 256 - v;
          if (sum >= bestSum) break;
        }
        if (sum < bestSum) { bestSum = sum; best = ft; raw[y * (st + 1)] = ft; raw.set(cand, y * (st + 1) + 1); }
      }
    }
    const z = await deflate(raw), chunks = [];
    const chunk = (type, data) => {
      const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
      dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
      b.set(data, 8); dv.setUint32(8 + data.length, crc32(b, 4, 8 + data.length));
      chunks.push(b);
    };
    const ih = new Uint8Array(13), dv = new DataView(ih.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = 2; ih[10] = 0; ih[11] = 0; ih[12] = 0;
    chunk('IHDR', ih); chunk('IDAT', z); chunk('IEND', new Uint8Array(0));
    const out = new Uint8Array(8 + chunks.reduce((s, c) => s + c.length, 0));
    out.set(SIG, 0); let p = 8; for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  };
  // 减色（中位切分）：rgb → 最多 n 种颜色的 rgb（同样大小）
  P.quantize = (rgb, n) => {
    const N = rgb.length / 3, idx = new Uint32Array(N);
    for (let i = 0; i < N; i++) idx[i] = i;
    const boxes = [{ s: 0, e: N }];
    const range = (bx) => {
      const lo = [255, 255, 255], hi = [0, 0, 0];
      for (let i = bx.s; i < bx.e; i++) for (let k = 0; k < 3; k++) { const v = rgb[idx[i] * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
      const r = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], ax = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
      bx.ax = ax; bx.r = r[ax];
    };
    range(boxes[0]);
    while (boxes.length < n) {
      let bi = -1, bs = 0;
      boxes.forEach((bx, i) => { const s = bx.r * Math.sqrt(bx.e - bx.s); if (bx.e - bx.s > 1 && bx.r > 0 && s > bs) { bs = s; bi = i; } });
      if (bi < 0) break;
      const bx = boxes[bi], part = Array.from(idx.subarray(bx.s, bx.e)).sort((a, b) => rgb[a * 3 + bx.ax] - rgb[b * 3 + bx.ax]);
      idx.set(part, bx.s);
      const mid = bx.s + (part.length >> 1), nb = { s: mid, e: bx.e };
      bx.e = mid; range(bx); range(nb); boxes.push(nb);
    }
    const out = new Uint8Array(rgb.length);
    for (const bx of boxes) {
      const sum = [0, 0, 0];
      for (let i = bx.s; i < bx.e; i++) for (let k = 0; k < 3; k++) sum[k] += rgb[idx[i] * 3 + k];
      const c = sum.map((v) => Math.round(v / (bx.e - bx.s)));
      for (let i = bx.s; i < bx.e; i++) for (let k = 0; k < 3; k++) out[idx[i] * 3 + k] = c[k];
    }
    return out;
  };
  // 128 × 128 的 rgb → 不超过 WRITE_BYTES 的 PNG：先原样存，超了就减色（256、128、64、32、16、8 种颜色）再存。→ { png, colors（null = 没减色） }
  P.fitPng = async (rgb) => {
    let png = await P.encodePng(rgb);
    if (png.length <= P.WRITE_BYTES) return { png, colors: null };
    for (const n of [256, 128, 64, 32, 16, 8]) {
      png = await P.encodePng(P.quantize(rgb, n));
      if (png.length <= P.WRITE_BYTES) return { png, colors: n };
    }
    throw new Error('这张照片压不到 48 KB 以内');
  };
})(window.V3);
