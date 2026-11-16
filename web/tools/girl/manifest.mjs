// tools/girl/manifest.mjs — the editor manifest of a kit Model: every element (block) with its base control points,
// face colours (for the live preview) and its left/right mirror partner, plus bones and the current hand edits.
// Read by the studio editor (src/27-girl3-edit.js); points are model-space design units (1 u = 0.02 m).
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// partner of element a under x -> -x: same part, kind and point count, every mirrored point matched (tolerance tol)
function mirrorMap(a, b, tol = 0.03) {
  if (a.part !== b.part || a.kind !== b.kind || a.base.length !== b.base.length || a.ringLen !== b.ringLen) return null;
  const map = new Array(a.base.length), used = new Set();
  for (let i = 0; i < a.base.length; i++) {
    const p = a.base[i];
    let best = -1, bd = tol;
    for (let j = 0; j < b.base.length; j++) {
      if (used.has(j) && a !== b) continue;
      const q = b.base[j], d = Math.abs(q[0] + p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]);
      if (d < bd) { bd = d; best = j; }
    }
    if (best < 0) return null;
    map[i] = best; used.add(best);
  }
  return map;
}

export function buildManifest(model, extra = {}) {
  const els = model.elements;
  const mirror = new Map();
  for (const a of els) {
    if (mirror.has(a.name)) continue;
    const self = mirrorMap(a, a);
    if (self) { mirror.set(a.name, { name: a.name, map: self }); continue; }
    for (const b of els) {
      if (b === a || mirror.has(b.name)) continue;
      const m = mirrorMap(a, b);
      if (m) {
        mirror.set(a.name, { name: b.name, map: m });
        const back = new Array(m.length); m.forEach((j, i) => { back[j] = i; });
        mirror.set(b.name, { name: a.name, map: back });
        break;
      }
    }
  }
  return {
    version: 1, model: model.name, unitMeters: extra.unitMeters || 0.02,
    bones: model.bones.map((b) => ({ name: b.name, pivot: b.pivot, parent: b.parent })),
    partPath: extra.partPath || null,
    elements: els.map((e) => ({
      name: e.name, part: e.part, bone: e.bone, kind: e.kind, ringLen: e.ringLen,
      base: e.base.map((p) => p.map(r4)),
      faces: e.faces.map((seg) => (seg || []).map((f) => ({ n: f.n, col: f.col, face: f.face }))),
      mirror: mirror.get(e.name) || null,
    })),
    edits: model.edits || {},
  };
}
