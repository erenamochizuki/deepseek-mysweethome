// Shared Minecraft-style collectible models. The same element coordinates and painted
// atlas are used by the game and by the resource pack; no THREE, DOM, or canvas here.
(function (V3) {
  'use strict';

  const WIDTH = 256, TEXELS = 4, GUTTER = 2, MAX_HEIGHT = 512;
  // [normal, u, v], each [axis, sign] in unrotated Minecraft FaceInfo order.
  // Pixel rects are [left, top, right, bottom) in the top-left-origin RGBA image.
  const FACE = {
    down:  [[1, -1], [0,  1], [2, -1]],
    up:    [[1,  1], [0,  1], [2,  1]],
    north: [[2, -1], [0, -1], [1, -1]],
    south: [[2,  1], [0,  1], [1, -1]],
    west:  [[0, -1], [2,  1], [1, -1]],
    east:  [[0,  1], [2, -1], [1, -1]],
  };

  const slab = (x0, x1, z0, z1, y0, y1, inner) => ({ from: [x0, y0, z0], to: [x1, y1, z1], inner });
  // A dome built from shallow rounded bands. Only the main aperture cuts the solids;
  // pores and the five radiating bands remain artwork on the atlas.
  function ring(y0, y1, profile, crown = false) {
    const rows = profile.slice(0, -1).map(([z, w], i) => [z, profile[i + 1][0], w]);
    const [z, w] = profile.at(-1), parts = [];
    const hole = crown ? [6.5, 7.25, 8.75, 9.5] : [6.5, 9.5];
    for (const [z0, z1, width] of [...rows, [z, 16 - z, w], ...rows.slice().reverse().map(([a,b,c]) => [16-b,16-a,c])]) {
      const cuts = [z0, ...hole.filter((h) => h > z0 && h < z1), z1];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i], b = cuts[i + 1];
        if (a >= 6.5 && b <= 9.5) {
          const r = crown && (b <= 7.25 || a >= 8.75) ? .75 : 1.5;
          parts.push(slab(8-width, 8-r, a, b, y0, y1, 'east'), slab(8+r, 8+width, a, b, y0, y1, 'west'));
        } else parts.push(slab(8-width, 8+width, a, b, y0, y1));
      }
    }
    return parts;
  }
  const urchin = [
    ...ring(0, .75, [[2.25, 2.5], [3.25, 4.25], [4.5, 5.25], [5.75, 5.75]]),
    ...ring(.75, 1.75, [[1.25, 2.75], [2.25, 4.75], [3.5, 6], [5.25, 7]]),
    ...ring(1.75, 2.75, [[1.75, 2.75], [2.75, 4.5], [3.75, 5.75], [5.5, 6.5]]),
    ...ring(2.75, 3.75, [[2.5, 2.5], [3.25, 4], [4.5, 5.25], [5.75, 5.75]]),
    ...ring(3.75, 4.5, [[3.5, 2], [4.25, 3.5], [5.5, 4.5]]),
    ...ring(4.5, 5.25, [[4.75, 1.5], [5.5, 2.5], [6.25, 3]], true),
  ];

  const overlap = (a, b, axis) => Math.max(0, Math.min(a.to[axis], b.to[axis]) - Math.max(a.from[axis], b.from[axis]));
  function exposed(parts, part, [[n, sign], [u], [v]]) {
    const plane = (sign > 0 ? part.to : part.from)[n];
    let covered = 0;
    // Parts have disjoint interiors, so neighbours on this plane cannot cover
    // the same area. Keep partially covered faces; the adjacent solid hides them.
    for (const other of parts) {
      if (other !== part && (sign > 0 ? other.from : other.to)[n] === plane) {
        covered += overlap(part, other, u) * overlap(part, other, v);
      }
    }
    return covered < (part.to[u] - part.from[u]) * (part.to[v] - part.from[v]);
  }

  const rgb = value => [value >> 16, (value >> 8) & 255, value & 255];
  const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
  const clamp = x => Math.min(1, Math.max(0, x));
  const fract = x => x - Math.floor(x);
  function grain(x, y, z) {
    const hash = Math.imul(Math.floor(x * 4) + 5, 0x45d9f3b)
      ^ Math.imul(Math.floor(y * 4) + 11, 0x119de1f3)
      ^ Math.imul(Math.floor(z * 4) + 17, 0x27d4eb2d);
    return ((hash ^ (hash >>> 13)) & 255) / 255 - .5;
  }
  const sage = rgb(0x96bfa8), chalk = rgb(0xe0dfc2), shadow = rgb(0x607e78);
  const rose = rgb(0xc879a1), lightRose = rgb(0xecb5c4), pore = rgb(0x734668), hole = rgb(0x676175);
  const TAU = 2 * Math.PI;
  function urchinPixel(part, name, [x, y, z]) {
    const dx = x - 8, dz = z - 8, r = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx), offset = (fract((a + Math.PI / 2) * 5 / TAU + .5) - .5) * TAU / 5;
    const inner = part.inner === name, noise = grain(x, y, z);
    if (inner) return mix(hole, chalk, .12 + .25 * (y / 5.25) + noise * .1);
    if (name === 'down') return mix(shadow, sage, .35 + Math.max(0, 1 - r / 8) * .27 + noise * .13);

    const ridge = (5.25 - y) * .42 + r;
    const band = Math.abs(offset), onBand = band < .245;
    let c = onBand
      ? mix(rose, lightRose, .23 + .25 * Math.sin(ridge * 2.9) + .22 * (1 - band / .245))
      : mix(sage, chalk, .18 + .18 * Math.sin(ridge * 2.9) + .16 * (y / 5.25));
    if (onBand && r > 2.1) {
      // Two pores at the same radius on every stripe, repeated down the shell.
      const row = (fract((ridge - 2.45) / 1.56 + .5) - .5) * 1.56;
      const mark = Math.hypot((band - .112) * Math.min(r, 6) / .31, row / .27);
      if (mark < 1.04) c = mix(c, pore, mark < .74 ? .92 : .55);
    }
    // Keep the top aperture rim pale; the dark recess is geometry, not an alpha hole.
    if (name === 'up' && Math.max(Math.abs(dx), Math.abs(dz)) < 1.87) c = mix(c, chalk, .75);
    if (y < 2) c = mix(c, shadow, .17 * (1 - y / 2));
    return c.map(value => value + noise * 12);
  }

  const pearlBands = [0xf6e4ca, 0xe5afbf, 0xc5aee0, 0x8aaed8, 0x66c8c0, 0xafe0cf, 0xf1c8cb, 0xb9a9ca].map(rgb);
  const bandEdges = [.21, .36, .48, .60, .78, .87, 1.02];
  const umber = rgb(0x69473d), rust = rgb(0xa87055), sand = rgb(0xd1ad87), shine = rgb(0xfdf2dc);
  function abalonePixel(part, name, p) {
    const [x, y, z] = p, dx = x - 7.05, dz = z - 7.65 + dx * .16;
    const r = Math.hypot(dx / 6.25, dz / 4.85);
    const noise = grain(x, y, z), isTop = name === 'up';
    const lip = part.rim === true && isTop;
    let inset = Infinity;
    if (lip && part.inner) {
      const [axis, sign] = FACE[part.inner][0];
      inset = sign * ((sign > 0 ? part.to : part.from)[axis] - p[axis]);
    }
    if (name === part.inner || (isTop && !lip) || inset < .32) {
      const q = r + .032 * Math.sin(dx * 1.13 + dz * .53) + .035 * (y - 1.25);
      const band = bandEdges.findIndex(edge => q < edge);
      const i = band === -1 ? bandEdges.length : band;
      const boundary = i > 0 ? Math.abs(q - bandEdges[i - 1]) : Infinity;
      let c = pearlBands[i];
      if (boundary < .028) c = mix(c, shine, .66 - boundary * 13);
      const ripple = fract(q * 31 + .22 * Math.sin(dz * 1.7 - dx * .54));
      if (ripple < .19) c = mix(c, shine, .22);
      const glint = Math.max(0, Math.sin(dx * .7 - dz * .6 + q * 3) - .77) * .82;
      return mix(c, shine, glint + (inset < .32 ? .26 : 0)).map(value => value + noise * 11);
    }
    // Faint growth ribs flow down from the lip, rather than reading as courses of bricks.
    const angle = Math.atan2(dz / 4.85, dx / 6.25);
    const rib = .5 + .5 * Math.sin(angle * 16 + y * .35 + Math.cos(angle * 5) * .6);
    const c = isTop
      ? mix(rust, shine, .44 + .15 * rib)
      : mix(umber, sand, .24 + .28 * clamp(y / 3.5) + .21 * rib);
    return c.map(value => value + noise * 6);
  }

  const MODELS = new Map([['sea_urchin_test', [() => urchin, urchinPixel]], ['rainbow_abalone', [() => V3.abaloneContour.parts(), abalonePixel]]]);
  function build(id) {
    if (!MODELS.has(id)) throw new Error('V3.collectibleCubes.build: unknown id ' + id);
    const [makeParts, paint] = MODELS.get(id);
    const parts = makeParts();
    const elements = parts.map(({ from, to }) => ({ from: [...from], to: [...to], faces: {} }));
    const charts = [];
    parts.forEach((part, i) => {
      for (const [name, basis] of Object.entries(FACE)) {
        if (!exposed(parts, part, basis)) continue;
        const [, [u], [v]] = basis;
        charts.push({ part, i, name, basis, w: (part.to[u] - part.from[u]) * TEXELS, h: (part.to[v] - part.from[v]) * TEXELS });
      }
    });

    if (elements.length > 64) throw new Error('Collectible element budget exceeded: ' + id);
    const rows = [];
    for (const chart of charts.sort((a, b) => b.h - a.h || b.w - a.w)) {
      const width = chart.w + 2 * GUTTER, height = chart.h + 2 * GUTTER;
      let row = rows.find(candidate => candidate.x + width <= WIDTH);
      if (!row) {
        const y = rows.length ? rows.at(-1).y + rows.at(-1).height : 0;
        if (width > WIDTH || y + height > MAX_HEIGHT) throw new Error('Collectible atlas overflow: ' + id);
        rows.push(row = { x: 0, y, height });
      }
      chart.left = row.x + GUTTER; chart.top = row.y + GUTTER;
      row.x += width;
    }
    const last = rows.at(-1), height = 2 ** Math.ceil(Math.log2(last.y + last.height));
    const rgba = new Uint8Array(WIDTH * height * 4);
    for (const { part, i, name, basis, w, h, left, top } of charts) {
      elements[i].faces[name] = [left, top, left + w, top + h];
      const [[n, ns], [u, us], [v, vs]] = basis;
      const p = [0, 0, 0];
      p[n] = (ns > 0 ? part.to : part.from)[n];
      // Extrude a border to reduce bleeding between neighbouring charts.
      for (let j = -GUTTER; j < h + GUTTER; j++) {
        p[v] = (vs > 0 ? part.from : part.to)[v] + vs * (Math.min(h - 1, Math.max(0, j)) + .5) / TEXELS;
        for (let k = -GUTTER; k < w + GUTTER; k++) {
          p[u] = (us > 0 ? part.from : part.to)[u] + us * (Math.min(w - 1, Math.max(0, k)) + .5) / TEXELS;
          const c = paint(part, name, p);
          const off = ((top + j) * WIDTH + left + k) * 4;
          for (let ch = 0; ch < 3; ch++) rgba[off + ch] = Math.max(0, Math.min(255, Math.round(c[ch])));
          rgba[off + 3] = 255;
        }
      }
    }
    return { elements, width: WIDTH, height, rgba };
  }

  V3.collectibleCubes = { build };
})(window.V3);
