// house-mc-png.mjs — 方块小屋鲸图的「图」部分：左边南立面（从海那边看过去），右边俯视（北在上）。
// 颜色全用 17-mcfallback 的（我们自己挑的颜色，和工作台没选 jar 时一样），不用 MC 的贴图。
// 每格 12 像素，格子边线稍微压暗，方便数格子。栅栏、玻璃板、灯笼按半透明画。
import { encodePng } from '../mc-lib.mjs';
import { openGrid, rgbOf } from './house-mc-grid.mjs';

const SKY = [0xdc, 0xec, 0xf6], SAND = [0xdc, 0xcf, 0x9c];
const CELL = 12, PAD = 12, GAP = 18, GROUND = 2, EDGE = 0.86;

export function previewPng(r) {
  const G = openGrid(r), [W, Hh, L] = G.size, [bx, by, bz] = G.base;
  const ew = W * CELL, eh = (Hh + GROUND) * CELL, pw = W * CELL, ph = L * CELL, inner = Math.max(eh, ph);
  const w = PAD + ew + GAP + pw + PAD, h = PAD + inner + PAD;
  const px = new Uint8Array(w * h * 4);
  const put = (x, y, rgb) => { const i = (y * w + x) * 4; px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255; };
  const rect = (x0, y0, ww, hh, rgb, grid) => {
    const c = rgb.map(Math.round), e = rgb.map((v) => Math.round(v * EDGE));
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) put(x0 + x, y0 + y, grid && (x === 0 || y === 0) ? e : c);
  };
  // 沿着一条线从近往远叠颜色：整块挡住后面的，薄的（栅栏、玻璃板、灯笼）透一半；什么都没碰到的部分是背景色
  const layer = (cells, back) => {
    let acc = [0, 0, 0], rest = 1;
    for (const [st, kind, f] of cells) {
      if (kind === 'air') continue;
      const a = kind === 'thin' ? 0.5 : 1, c = rgbOf(st);
      acc = acc.map((v, j) => v + c[j] * f * a * rest);
      rest *= 1 - a;
      if (rest < 0.02) break;
    }
    return { rgb: acc.map((v, j) => v + back[j] * rest), hit: rest < 1 };
  };
  rect(0, 0, w, h, SKY, false);
  // 南立面：x 往右是东，y 往上；比前墙更靠北（更远）的格子颜色越暗，前墙和门廊保持原色
  const ex0 = PAD, ey0 = PAD + inner - eh, front = r.info.grid.z1;
  for (let lx = 0; lx < W; lx++) for (let ly = 0; ly < Hh; ly++) {
    const cells = [];
    for (let lz = L - 1; lz >= 0; lz--) {
      const x = bx + lx, y = by + ly, z = bz + lz;
      cells.push([G.state(x, y, z), G.kind(x, y, z), Math.max(0.6, 1 - Math.max(0, front - z) * 0.06)]);
    }
    const { rgb, hit } = layer(cells, SKY);
    rect(ex0 + lx * CELL, ey0 + (Hh - 1 - ly) * CELL, CELL, CELL, rgb, hit);
  }
  rect(ex0, ey0 + Hh * CELL, ew, GROUND * CELL, SAND, false);
  // 俯视：北在上、东在右；越低颜色越暗；什么都没有的地方是沙子
  const px0 = PAD + ew + GAP, py0 = PAD + inner - ph;
  for (let lx = 0; lx < W; lx++) for (let lz = 0; lz < L; lz++) {
    const cells = [];
    for (let ly = Hh - 1; ly >= 0; ly--) {
      const x = bx + lx, y = by + ly, z = bz + lz;
      cells.push([G.state(x, y, z), G.kind(x, y, z), 0.62 + 0.38 * ly / Math.max(1, Hh - 1)]);
    }
    const { rgb, hit } = layer(cells, SAND);
    rect(px0 + lx * CELL, py0 + lz * CELL, CELL, CELL, rgb, hit);
  }
  return encodePng(w, h, px);
}
