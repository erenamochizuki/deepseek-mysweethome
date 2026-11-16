// tools/girl/png.mjs — minimal PNG decoder (8-bit grey / RGB / RGBA / grey+alpha, non-interlaced). Node built-ins only.
// decodePNG(buf) -> { w, h, rgba: Uint8Array (w*h*4) }
import zlib from 'node:zlib';

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error('unsupported PNG colour type ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[prev + x] : 0, c = x >= ch && y ? px[prev + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch;
    if (ch >= 3) { rgba[i * 4] = px[s]; rgba[i * 4 + 1] = px[s + 1]; rgba[i * 4 + 2] = px[s + 2]; rgba[i * 4 + 3] = ch === 4 ? px[s + 3] : 255; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[s]; rgba[i * 4 + 3] = ch === 2 ? px[s + 1] : 255; }
  }
  return { w, h, rgba };
}
