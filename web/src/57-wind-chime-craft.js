// 自制风铃：向下量的厘米坐标。门上和工作台都用同一个挂件模型。
(function (V3) {
  'use strict';
  function owners(inv = V3.cabinInventory?.data?.inventory) {
    const map = new Map();
    for (const [kind, row] of Object.entries(inv?.found || {})) for (const item of row.items) map.set(item.uid, { kind, item });
    return map;
  }
  // design 只存 uid；尺寸以收藏实例为准，计算不修改任一输入。
  function layout(slot, design, own = owners()) {
    const count = V3.inventoryRules.CHIME_SLOTS[slot].strands;
    return design.strands.map((row, i) => {
      let length = 0;
      const items = row.map(({ uid, gap }) => {
        const top = length + gap, bottom = top + own.get(uid).item.size / 10;
        length = bottom; return { uid, gap, top, bottom };
      });
      return { x: (i - (count - 1) / 2) * 18, length, items };
    });
  }
  function primary(chimes, door) {
    let nearest = null, best = Infinity;
    for (const ch of chimes) {
      const [x, y, z] = ch.pos, distance = Math.hypot(x - door[0], y - door[1], z - door[2]);
      if (distance < best) { nearest = ch; best = distance; }
    }
    return nearest;
  }
  function assign(chimes, door, windowPos) {
    let front = primary(chimes, door);
    // 只剩窗边那一件时，拆掉的门铃不能把它的设计抢走。
    const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    if (chimes.length === 1 && distance(front.pos, windowPos) < distance(front.pos, door)) front = null;
    return { door: front, window: primary(chimes.filter(ch => ch !== front), windowPos) };
  }
  let parts;
  function stick(color, x, y, width, height, depth) {
    if (!parts) {
      const shared = o => { o.userData.shared = true; return o; };
      parts = { box: shared(new THREE.BoxGeometry()), wood: shared(new THREE.MeshStandardMaterial({ color: 0xa77850 })),
        twine: shared(new THREE.MeshStandardMaterial({ color: 0x725c47 })) };
    }
    const mesh = new THREE.Mesh(parts.box, parts[color]);
    mesh.scale.set(width, height, depth); mesh.position.set(x, y, 0); mesh.castShadow = true; return mesh;
  }
  function pendant(uid, entry) {
    const { kind, item } = entry, shell = V3.shells.build(kind, { tag: false, pat: item.pat, anchor: 'chime:' + uid });
    const box = new THREE.Box3(), size = new THREE.Vector3();
    shell.rotateX(Math.PI / 2); // 把平放时朝上的花纹转向屋外，再让最长边朝下。
    box.setFromObject(shell, true).getSize(size);
    if (size.x > size.y && size.x >= size.z) shell.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    else if (size.z > size.y) shell.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    shell.scale.multiplyScalar(item.size / (1000 * Math.max(size.x, size.y, size.z)));
    box.setFromObject(shell, true);
    shell.position.set(-(box.min.x + box.max.x) / 2, -box.max.y, -(box.min.z + box.max.z) / 2);
    const holder = new THREE.Group(); holder.userData.uid = uid; holder.add(shell);
    holder.userData.phase = V3.inventoryRules.hash01(uid) * 2 * Math.PI;
    return holder;
  }
  function build(slot, design, own = owners()) {
    const group = new THREE.Group(), sway = [], beads = [];
    group.name = 'chime:craft'; group.add(stick('wood', 0, .016, (design.strands.length - 1) * .18 + .16, .042, .095));
    const lines = layout(slot, design, own);
    for (const line of lines) {
      const bone = new THREE.Group(); bone.position.x = line.x / 100; group.add(bone); sway.push(bone);
      const length = Math.max(.025, line.length / 100);
      bone.add(stick('twine', 0, -length / 2, .0045, length, .0045));
      for (const b of line.items) {
        const holder = pendant(b.uid, own.get(b.uid)); holder.position.y = -b.top / 100;
        bone.add(holder); beads.push(holder);
        const entry = own.get(b.uid), bounds = new THREE.Box3().setFromObject(holder, true);
        b.size = entry.item.size; b.chime = V3.game?.kind?.(entry.kind)?.chime;
        b.radius = (bounds.max.x - bounds.min.x) / 2;
      }
    }
    const model = { group, sway, beads, lines, touching: 0, bounds: new THREE.Box3().setFromObject(group, true) };
    contact(model); // 安装时已挨着的挂件要先分开，再碰才响。
    return model;
  }
  // 独立的摆长决定频率；同一阵风拨动相邻绳后，回摆的时刻和方向不同。
  function swing(model, phase, speed, age, lx, lz) {
    model.sway.forEach((bone, i) => {
      const omega = Math.sqrt(9.81 / Math.max(.095, model.lines[i].length / 100));
      const impulse = age < 3 ? Math.sign(lx || 1) * 1.08 * Math.sin(age * omega) * Math.exp(-age * 1.65) : 0;
      bone.rotation.z = .12 * speed * lx + .18 * speed * Math.sin(phase * omega * .42 + i * 1.8) + (i % 2 ? -impulse : impulse);
      bone.rotation.x = -.11 * speed * lz + .04 * speed * Math.sin(phase * 1.7 + i);
    });
  }
  // 用绘制时同一组摆角算挂件中心（米）。每对相邻串只在刚靠近的一帧报最近的两枚。
  function contact(model) {
    let touching = 0, best = Infinity, pair;
    for (let i = 0; i < model.lines.length; i++) {
      const line = model.lines[i], { x, z } = model.sway[i].rotation;
      for (const b of line.items) {
        const d = (b.top + b.bottom) / 200;
        b.x = line.x / 100 + d * Math.sin(z); b.y = -d * Math.cos(z) * Math.cos(x); b.z = -d * Math.cos(z) * Math.sin(x);
      }
      if (!i) continue;
      const bit = 1 << i;
      for (const a of model.lines[i - 1].items) for (const b of line.items) {
        const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - a.radius - b.radius;
        if (gap > .012) continue;
        touching |= bit;
        if (!(model.touching & bit) && gap < best) { best = gap; pair = [a,b]; }
      }
    }
    model.touching = touching; return pair;
  }
  function spin(model, phase) {
    for (const b of model.beads) b.rotation.y = .24 * Math.sin(phase * .7 + b.userData.phase);
  }
  function cells() {
    const result = { door: null, window: null };
    for (const ch of V3.houseDetail?.chimes() || []) if (ch.slot) result[ch.slot] = ch.cell;
    return result;
  }
  function slotOf(cell) {
    if (!Array.isArray(cell) || cell.length !== 3) return null;
    return Object.entries(cells()).find(([, pos]) => pos?.every((v, i) => v === cell[i]))?.[0] || null;
  }
  V3.chimeCraft = { owners, layout, primary, assign, cells, slotOf, build, swing, contact, spin };
})(window.V3);
