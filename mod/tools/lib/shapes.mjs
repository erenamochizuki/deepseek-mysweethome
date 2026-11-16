// 用探针 /shapes（接口 10，只读）查一块区域：方块是不是游戏按邻居算出来的样子。
// 每个方向超过 64 格就分几次查，再合起来。区域外的方块也是真邻居，所以分开查和一次查结果一样。
//   回 { origin: 最小角, size, checked, changed, truncated,
//        diffs: [{ pos, state: 现在的状态, game: 游戏算出来的 }]（按整块的下标 x + z·W + y·W·L 排，最多 256 条）, calls: 查了几次 }
import { BoxError, boxCorners, MAX_BOX_CELLS } from './box.mjs';

const TILE = 64;
export const MAX_DIFFS = 256;
const isPos = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isSafeInteger);

export async function readShapes(client, from, to, { dim, signal } = {}) {
  const [lo, hi] = boxCorners(from, to);
  const size = [0, 1, 2].map((k) => hi[k] - lo[k] + 1);
  const total = size[0] * size[1] * size[2];
  if (total > MAX_BOX_CELLS) throw new BoxError(`区域太大：${size.join('×')} = ${total} 格，最多 ${MAX_BOX_CELLS} 格`);
  let checked = 0;
  let changed = 0;
  let truncated = false;
  let calls = 0;
  const diffs = [];
  for (let y0 = lo[1]; y0 <= hi[1]; y0 += TILE) {
    for (let z0 = lo[2]; z0 <= hi[2]; z0 += TILE) {
      for (let x0 = lo[0]; x0 <= hi[0]; x0 += TILE) {
        const a = [x0, y0, z0];
        const b = [Math.min(x0 + TILE - 1, hi[0]), Math.min(y0 + TILE - 1, hi[1]), Math.min(z0 + TILE - 1, hi[2])];
        const r = await client.shapes(a, b, { dim }, { signal });
        calls++;
        if (!Number.isSafeInteger(r.checked) || !Number.isSafeInteger(r.changed) || !Array.isArray(r.diffs)) {
          throw new BoxError('探针 /shapes 的回复格式不对（要有 checked、changed、diffs）');
        }
        checked += r.checked;
        changed += r.changed;
        if (r.truncated === true) truncated = true;
        for (const d of r.diffs) {
          if (!isPos(d?.pos) || typeof d.state !== 'string' || typeof d.game !== 'string' || d.pos.some((v, k) => v < a[k] || v > b[k])) {
            throw new BoxError(`探针 /shapes 回的 diffs 里有不对的项：${JSON.stringify(d)}`);
          }
          diffs.push({ pos: d.pos, state: d.state, game: d.game });
        }
      }
    }
  }
  const index = ({ pos: [x, y, z] }) => (x - lo[0]) + (z - lo[2]) * size[0] + (y - lo[1]) * size[0] * size[2];
  diffs.sort((p, q) => index(p) - index(q));
  if (diffs.length > MAX_DIFFS) {
    diffs.length = MAX_DIFFS;
    truncated = true;
  }
  return { origin: lo, size, checked, changed, truncated, diffs, calls };
}
