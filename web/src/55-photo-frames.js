// 55-photo-frames.js — 场景部件 'photo-frames'（order 41）：相框、画框墙上贴照片（docs/PHOTOS.md 第 3、5 节，2026-11-08 web7）。
// 照片从房子方块数据的方块实体里读（V3.photos.frames(HB.model)）：相框的 Photo、画框墙 part=0 的 Slots。按规格的 photoSlots 贴一块平面
// （往正面挪 0.01 像素，再用 polygonOffset 往前偏一点，不闪；不是正方形的框按 cover 从照片中间裁）。空相框不贴（方块模型的衬纸露着），
// 画框墙空的框也不贴（露出原来的小画）。坏照片不画（V3.photos.fromTag 查过，console 里记一行）。
// 每个框另外有一块看不见的「点的平面」（userData.clickable = 'photo'，photoTarget = { cell, slot, kind }）：游戏里点它换照片（91-cabin → 68-album）。
// 照片纹理按 Id 缓存（同一张照片挂几处只解一次），换房子、换照片后没人用的释放。
// 剖开看的时候：这一格（HB.visibleAt）看不见就藏；布置模式拖着的那件（HB.live().hidden）也藏。
// 方块实体变了（相册、照片，HB.setEntities → 'house:entities'）或者房子换了（'house:blocks'）就重新贴，不用重建整个场景。
(function (V3) {
  'use strict';
  if (!V3.scene || !V3.scene.part || !V3.photos) return;
  const P = V3.photos, HB = () => V3.houseBlocks;
  const PF = V3.photoFrames = { version: 0 };
  const key = (c) => c[0] + ',' + c[1] + ',' + c[2];

  // ---- 照片纹理（按 Id）：{ tex, p: Promise<tex | null>, used } ----
  const TEX = new Map();
  async function decode(png) {
    const blob = new Blob([png], { type: 'image/png' });
    let img;
    if (typeof createImageBitmap === 'function') img = await createImageBitmap(blob);
    else img = await new Promise((res, rej) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('解不开')); }; im.src = u; });
    const cv = document.createElement('canvas'); cv.width = cv.height = P.SIZE;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, P.SIZE, P.SIZE);   // 照片应该是不透明的；万一有透明像素，垫白
    g.drawImage(img, 0, 0, P.SIZE, P.SIZE);
    if (img.close) img.close();
    return cv;
  }
  // 缓存的键 = PNG 字节的 SHA-1（不信 Id：Id 写错了也不会显示成别的照片）
  const texKey = (photo) => photo.key || (photo.key = P.sha1(photo.png));
  PF.texture = (photo) => {
    const k = texKey(photo);
    let t = TEX.get(k);
    if (!t) {
      t = { tex: null, p: null, used: 0 };
      t.p = decode(photo.png).then((cv) => {
        const tex = new THREE.CanvasTexture(cv);
        if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace; else tex.encoding = 3001;
        tex.anisotropy = 4; tex.needsUpdate = true;
        t.tex = tex;
        return tex;
      }).catch((e) => { P.warn('照片 ' + photo.id, '解不开（' + ((e && e.message) || e) + '）'); return null; });
      TEX.set(k, t);
    }
    return t;
  };
  // 没人用的纹理释放（live = 现在要用的 Id）
  function sweep(live) {
    for (const [id, t] of TEX) if (!live.has(id)) { TEX.delete(id); t.p.then((tex) => { if (tex) tex.dispose(); }); }
  }

  // ---- 一块平面（四个角 + uv）----
  function quad(g, mat) {
    const pos = new Float32Array(12), uv = new Float32Array(8);
    g.corners.forEach((c, i) => { pos.set(c, i * 3); uv.set(g.uv[i], i * 2); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false; m.receiveShadow = true;
    Object.assign(m.userData, { noShadow: true });
    return m;
  }
  const photoMat = (tex) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });

  let LIVE = null;
  function build(ctx) {
    const root = new THREE.Group(); root.name = 'photo-frames';
    const me = { root, items: [], gen: 0, mats: new Map(), pickMat: new THREE.MeshBasicMaterial({ visible: false }) };
    LIVE = me;
    me.refresh = () => {
      const H = HB();
      if (!H || !H.model || ctx.dead) return;
      const my = ++me.gen;
      // 旧的框拿掉：每块平面（点的平面、照片）的几何体是它自己的，拿掉以后场景收尾时扫不到，这里就释放。
      // 材质不动：pickMat 大家共用，照片材质 / 纹理按 Id 共用（下面 me.mats、sweep 管）。
      for (const it of me.items) { root.remove(it.group); it.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      me.items = [];
      const live = new Set();
      for (const fr of P.frames(H.model)) {
        if (!fr.f || !fr.f.photoSlots) continue;
        fr.slots.forEach((photo, slot) => {
          const geo = P.slotGeom(fr.f, fr.cell, fr.facing, slot);
          if (!geo) return;
          const grp = new THREE.Group();
          grp.name = 'photo:' + key(fr.cell) + '#' + slot;
          // 这个框在哪一格（剖开、拖动时藏）
          const row = fr.f.photoSlots[slot], c = fr.f.cells.find((q) => (q.part == null ? 0 : +q.part) === row[0]) || fr.f.cells[0];
          const off = V3.furnMc.rotate(c.offset, fr.facing), cell = [fr.cell[0] + off[0], fr.cell[1] + off[1], fr.cell[2] + off[2]];
          // 点的平面：相框是整个框的正面（衬纸露着的地方都能点），画框墙是这个小框
          const pick = fr.kind === 'frame' ? Object.assign({}, geo, { corners: P.slotGeom(Object.assign({}, fr.f, { photoSlots: [[0, 0.5, 0.5, 15.5, 15.5, 14]] }), fr.cell, fr.facing, 0, 0.05).corners }) : P.slotGeom(fr.f, fr.cell, fr.facing, slot, 0.05);
          const pm = quad(pick, me.pickMat);
          pm.name = 'photo-pick';
          Object.assign(pm.userData, { clickable: 'photo', clickAlways: true, photoTarget: { cell: fr.cell.slice(), slot, kind: fr.kind, block: fr.block } });
          grp.add(pm);
          const item = { group: grp, cell, frame: fr, slot, photo, mesh: null };
          if (photo) {
            const tk = texKey(photo);
            live.add(tk);
            const t = PF.texture(photo);
            const put = (tex) => {
              if (!tex || my !== me.gen) return;
              let mat = me.mats.get(tk);
              if (!mat) { mat = photoMat(tex); me.mats.set(tk, mat); }
              const m = quad(geo, mat);
              m.name = 'photo-plane'; m.userData.photoId = photo.id;
              grp.add(m); item.mesh = m;
            };
            if (t.tex) put(t.tex); else t.p.then(put);
          }
          root.add(grp);
          me.items.push(item);
        });
      }
      // 材质：这次用不到的扔掉；纹理：全局没人用的释放
      for (const [id, mat] of me.mats) if (!live.has(id)) { mat.dispose(); me.mats.delete(id); }
      sweep(live);
      PF.version++;
      me.tick();
      if (V3.emit) V3.emit('photos:frames', PF.state());
    };
    me.tick = () => {
      const H = HB(), hl = H && H.live && H.live(), hid = hl && hl.hidden;
      for (const it of me.items) {
        const k = key(it.cell);
        it.group.visible = !(hid && (hid.has(k) || hid.has(key(it.frame.cell)))) && (!H || !H.visibleAt || H.visibleAt(it.cell[0], it.cell[1], it.cell[2]));
      }
    };
    me.onEnt = () => me.refresh();
    V3.on('house:entities', me.onEnt);
    V3.on('house:blocks', me.onEnt);
    if (HB() && HB().whenGrid) HB().whenGrid(ctx, () => me.refresh());
    root.userData.photoFrames = me;
    return root;
  }
  V3.scene.part({
    id: 'photo-frames', label: '相框里的照片', order: 41,
    build(ctx) { const r = build(ctx); this._me = r.userData.photoFrames; return r; },
    update() { if (this._me) this._me.tick(); },
    dispose() {
      const me = this._me;
      if (me) { V3.off('house:entities', me.onEnt); V3.off('house:blocks', me.onEnt); me.gen++; for (const m of me.mats.values()) m.dispose(); me.pickMat.dispose(); }
      if (LIVE === me) LIVE = null;
      this._me = null;
    },
  });
  // 现在贴着的（测试、截图用）：[{ cell, slot, kind, id（照片的 Id 或 null）, shown（贴好了没有）, visible }]
  PF.state = () => (LIVE ? LIVE.items.map((it) => ({ cell: it.frame.cell.slice(), slot: it.slot, kind: it.frame.kind, id: it.photo ? it.photo.id : null, shown: !!it.mesh, visible: it.group.visible })) : []);
  PF.live = () => LIVE;
  // 等照片都贴好（纹理解完）
  PF.whenReady = async () => {
    await Promise.all([...TEX.values()].map((t) => t.p));
    await new Promise((r) => setTimeout(r, 0));
    return LIVE ? LIVE.items.every((it) => !it.photo || it.mesh || !(TEX.get(texKey(it.photo)) || {}).tex) : true;   // 解不开的（坏照片）不算
  };
})(window.V3);
