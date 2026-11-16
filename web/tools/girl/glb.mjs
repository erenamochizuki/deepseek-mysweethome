// tools/girl/glb.mjs — write a kit Model as glTF 2.0 binary (.glb) + a tiny PNG encoder. Node built-ins only.
// Layout: root node -> bone nodes (translation only, rest pose) -> one mesh node per (part, bone, material),
// named by part ("刘海", "鲸鳍耳.L", ...), extras.part = part path. Rigid binding: mesh vertices are in the
// bone's space, so animating a bone node moves its parts (MODEL-IMPORT.md: 方块模型可以把每块直接挂在骨骼下面).
// Vertex colours (COLOR_0, linear) on the shared "block" material; the face plane uses material "face" with a
// nearest-filtered PNG. Units: metres (1 design unit = scale m).
import zlib from 'node:zlib';
import { C } from './kit.mjs';

// ---------- PNG (RGBA 8-bit) ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
};
export function encodePNG(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- GLB ----------
// opts: { scale (m per unit), textures: { face: {png: Buffer} }, extras, partPath(part) -> string }
export function toGLB(model, opts = {}) {
  const S = opts.scale || 0.02;
  const json = {
    asset: { version: '2.0', generator: 'haibian-v3 girl kit (tools/girl)', copyright: opts.copyright || '' },
    scene: 0, scenes: [{ name: model.name, nodes: [0] }],
    nodes: [{ name: model.name, children: [], extras: opts.extras || {} }],
    meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
  };
  const bins = []; let off = 0;
  const pushView = (buf, target) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) { bins.push(Buffer.alloc(pad)); off += pad; }
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) });
    bins.push(buf); off += buf.length;
    return json.bufferViews.length - 1;
  };
  const accessor = (arr, type, ctype, target, minmax) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const a = { bufferView: pushView(buf, target), componentType: ctype, count: arr.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3 })[type], type };
    if (minmax) Object.assign(a, minmax);
    json.accessors.push(a);
    return json.accessors.length - 1;
  };
  // materials
  const matIdx = {};
  matIdx.block = json.materials.push({ name: 'block', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } }) - 1;
  const tex = opts.textures || {};
  if (tex.face) {
    json.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }];
    json.images = [{ name: 'face', mimeType: 'image/png', bufferView: pushView(tex.face.png) }];
    json.textures = [{ sampler: 0, source: 0, name: 'face' }];
    matIdx.face = json.materials.push({ name: 'face', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }) - 1;
  }
  // bones
  const boneNode = {}, boneDef = {};
  for (const b of model.bones) boneDef[b.name] = b;
  for (const b of model.bones) {
    const pp = b.parent ? boneDef[b.parent].pivot : [0, 0, 0];
    const idx = json.nodes.push({ name: b.name, translation: [0, 1, 2].map((k) => +((b.pivot[k] - pp[k]) * S).toFixed(6)), children: [], extras: { bone: true } }) - 1;
    boneNode[b.name] = idx;
  }
  for (const b of model.bones) {
    const parent = b.parent ? json.nodes[boneNode[b.parent]] : json.nodes[0];
    parent.children.push(boneNode[b.name]);
  }
  // group triangles -> meshes
  const groups = new Map();
  for (const t of model.tris) {
    const k = t.part + '|' + t.bone + '|' + t.mat;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const names = new Map();       // part -> count of mesh nodes so far
  const faceParts = new Set([...groups.keys()].filter((k) => k.endsWith('|face')).map((k) => k.split('|')[0]));
  const order = [...groups.keys()].sort((a, b) => model.partOrder.indexOf(a.split('|')[0]) - model.partOrder.indexOf(b.split('|')[0]));
  for (const k of order) {
    const tris = groups.get(k), [part, bone, mname] = k.split('|');
    const pv = boneDef[bone].pivot, hasUV = mname === 'face';
    const verts = new Map(), pos = [], nor = [], col = [], uv = [], idx = [];
    for (const t of tris) {
      const lin = C.toLinear(t.col);
      for (let i = 0; i < 3; i++) {
        const p = t.p[i], q = [(p[0] - pv[0]) * S, (p[1] - pv[1]) * S, (p[2] - pv[2]) * S];
        const u = hasUV ? t.uv[i] : null;
        const key = q.map((v) => v.toFixed(5)).join(',') + '|' + t.n.map((v) => v.toFixed(4)).join(',') + '|' + t.col + (u ? '|' + u.join(',') : '');
        let vi = verts.get(key);
        if (vi == null) {
          vi = pos.length / 3; verts.set(key, vi);
          pos.push(...q); nor.push(...t.n); col.push(...lin);
          if (hasUV) uv.push(u[0], 1 - u[1]);
        }
        idx.push(vi);
      }
    }
    const P = new Float32Array(pos), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); }
    const attributes = {
      POSITION: accessor(P, 'VEC3', 5126, 34962, { min: mn, max: mx }),
      NORMAL: accessor(new Float32Array(nor), 'VEC3', 5126, 34962),
    };
    if (!hasUV) attributes.COLOR_0 = accessor(new Float32Array(col), 'VEC3', 5126, 34962);
    else attributes.TEXCOORD_0 = accessor(new Float32Array(uv), 'VEC2', 5126, 34962);
    const I = pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    const indices = accessor(I, 'SCALAR', I instanceof Uint32Array ? 5125 : 5123, 34963);
    const n = (names.get(part) || 0) + 1; names.set(part, n);
    const sideTag = bone.endsWith('L') && bone !== 'hips' ? '.L' : bone.endsWith('R') ? '.R' : '';
    const leaf = part.split('/').pop();
    // the textured face plane keeps the bare part name ('脸'); the rest of that part is '<part>.皮肤'
    const nodeName = hasUV ? leaf : faceParts.has(part) ? leaf + '.皮肤' : leaf + sideTag + (n > 1 && !sideTag ? '.' + n : '');
    const mi = json.meshes.push({ name: nodeName, primitives: [{ attributes, indices, material: matIdx[mname] ?? matIdx.block }] }) - 1;
    const ni = json.nodes.push({ name: nodeName, mesh: mi, extras: { part: opts.partPath ? opts.partPath(part) : part, bone } }) - 1;
    json.nodes[boneNode[bone]].children.push(ni);
  }
  for (const nd of json.nodes) if (nd.children && !nd.children.length) delete nd.children;
  const bin = Buffer.concat(bins);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  json.buffers[0].byteLength = binPad.length;
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + binPad.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([header, jh, js, bh, binPad]), json };
}
