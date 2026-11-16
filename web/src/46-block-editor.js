// P6 studio editor: immutable schematic operations + independent studio model/UI.
(function (V3) {
  'use strict';
  const E = V3.blockEditor = {}, S = () => V3.share, F = () => V3.furnMc;
  const AIR = 'minecraft:air', dirs = ['north', 'east', 'south', 'west'];
  const plus = (a, b) => a.map((n, i) => n + b[i]);
  const key = p => p.join(',');
  const parse = s => V3.photos.parseState(s);
  const air = s => /^(minecraft:)?(air|cave_air|void_air)$/.test(String(s));
  E.inside = (m, p) => p.length === 3 && p.every((n, i) => Number.isInteger(n) && n >= 0 && n < m.size[i]);
  const idx = (m, p) => S().index(m.size, ...p);
  E.stateAt = (m, p) => E.inside(m, p) ? m.palette[m.cells[idx(m, p)]] : null;
  E.empty = (size = [16, 12, 16]) => S().canonicalize({ size, offset: [0, 0, 0], dataVersion: S().DATA_VERSION,
    meta: { compound: { Name: { string: '工作台新场景' } } }, palette: [AIR], cells: new Int32Array(size.reduce((a, b) => a * b)), blockEntities: [] });
  E.validateState = s => {
    s = String(s).trim();
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+(?:\[[a-z0-9_]+=[a-z0-9_.-]+(?:,[a-z0-9_]+=[a-z0-9_.-]+)*\])?$/.test(s)) throw new Error('方块状态格式应为 minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]');
    const props = s.includes('[') ? s.slice(s.indexOf('[') + 1, -1).split(',').map(x => x.split('=')[0]) : [];
    if (new Set(props).size !== props.length) throw new Error('状态属性不能重复');
    return s;
  };
  E.withFacing = (s, facing) => {
    const q = parse(E.validateState(s));
    if (q.props.facing != null) q.props.facing = facing;
    const ps = Object.entries(q.props).map(([k, v]) => k + '=' + v);
    return q.id + (ps.length ? '[' + ps.join(',') + ']' : '');
  };
  E.pieceAt = (m, p) => {
    const state = E.stateAt(m, p); if (!state) return null;
    const q = parse(state), f = F().byBlock(q.id); if (!f) return null;
    const facing = q.props.facing || 'north', offsets = F().cellsFor(f, facing);
    const own = offsets.find(c => String(c.part) === String(q.props.part == null ? null : q.props.part));
    if (!own || !dirs.includes(facing)) return { f, main: p.slice(), facing, cells: [], present: [{ pos: p.slice(), state }], broken: true };
    const main = p.map((n, i) => n - own.offset[i]);
    const cells = offsets.map(c => ({ pos: plus(main, c.offset), state: F().state(f, facing, c.part), part: c.part }));
    const eq = (a, b) => V3.mcmodel.stateKey(V3.mcmodel.parseState(a)) === V3.mcmodel.stateKey(V3.mcmodel.parseState(b));
    const present = cells.filter(c => E.stateAt(m, c.pos) && eq(E.stateAt(m, c.pos), c.state));
    return { f, main, facing, cells, present, broken: present.length !== cells.length };
  };
  // Untouched NBT stays as-is. Replacing a block drops only that cell's BE.
  function write(m, writes) {
    const palette = m.palette.slice(), ids = new Map(palette.map((s, i) => [s, i])), cells = Int32Array.from(m.cells), touched = new Set(), entities = [];
    for (const w of writes) {
      if (!E.inside(m, w.pos)) throw new Error('超出场景边界：' + key(w.pos));
      if (!ids.has(w.state)) { ids.set(w.state, palette.length); palette.push(w.state); }
      cells[idx(m, w.pos)] = ids.get(w.state); touched.add(key(w.pos));
      if (w.be) entities.push(Object.assign({}, w.be, { pos: w.pos.slice() }));
    }
    return Object.assign({}, m, { palette, cells, blockEntities: (m.blockEntities || []).filter(b => !touched.has(key(b.pos))).concat(entities) });
  }
  E.put = (m, p, state) => {
    state = E.validateState(state);
    if (F().byBlock(parse(state).id)) throw new Error('家具请从整件家具清单摆放');
    if (E.pieceAt(m, p)) throw new Error('这里是整件家具；请先整件移除，不能替换半件');
    const before = E.stateAt(m, p);
    if (before === state) return m;
    const be = before && parse(before).id === parse(state).id ? (m.blockEntities || []).find(b => key(b.pos) === key(p)) : null;
    return write(m, [{ pos: p, state, be }]);
  };
  E.fillLayer = (m, y, state) => {
    state = E.validateState(state);
    if (!Number.isInteger(y) || y < 0 || y >= m.size[1]) throw new Error('编辑层超出场景边界');
    if (F().byBlock(parse(state).id)) throw new Error('家具请从整件家具清单摆放');
    const writes = [];
    for (let z = 0; z < m.size[2]; z++) for (let x = 0; x < m.size[0]; x++) if (air(E.stateAt(m, [x, y, z]))) writes.push({ pos: [x, y, z], state });
    return writes.length ? write(m, writes) : m;
  };
  E.remove = (m, p) => {
    if (!E.inside(m, p)) throw new Error('超出场景边界');
    const pc = E.pieceAt(m, p);
    if (!pc && air(E.stateAt(m, p))) return m;
    return write(m, (pc ? pc.present : [{ pos: p }]).map(c => ({ pos: c.pos, state: AIR })));
  };
  E.placeFurniture = (m, id, p, facing = 'north', from = null) => {
    const f = F().byId(id); if (!f || !dirs.includes(facing)) throw new Error('家具或朝向无效');
    const old = from ? E.pieceAt(m, from) : null;
    if (from && (!old || old.f.id !== id || old.broken)) throw new Error('家具缺了一部分，不能移动或旋转；可整件移除后重放');
    const ignore = new Set(old ? old.cells.map(c => key(c.pos)) : []);
    const next = F().cellsFor(f, facing).map(c => ({ pos: plus(p, c.offset), part: c.part, state: F().state(f, facing, c.part) }));
    for (const c of next) {
      if (!E.inside(m, c.pos)) throw new Error('整件家具超出场景边界：' + key(c.pos));
      if (!ignore.has(key(c.pos)) && !air(E.stateAt(m, c.pos))) throw new Error('家具占用的格子不是空气：' + key(c.pos));
      const prev = old && old.cells.find(q => String(q.part) === String(c.part));
      const be = prev && (m.blockEntities || []).find(b => key(b.pos) === key(prev.pos));
      const beId = V3.photos.beIdOf(c.state);
      if (be) c.be = be;
      else if (beId) c.be = { id: beId, data: { compound: {} } };
    }
    return write(m, (old ? old.cells.map(c => ({ pos: c.pos, state: AIR })) : []).concat(next));
  };
  E.session = model => {
    let m = S().canonicalize(model); const undo = [], redo = [];
    return { get model() { return m; }, get undoCount() { return undo.length; }, get redoCount() { return redo.length; },
      apply(next) { if (next === m) return false; undo.push(m); if (undo.length > 80) undo.shift(); redo.length = 0; m = next; return true; },
      undo() { if (!undo.length) return false; redo.push(m); m = undo.pop(); return true; },
      redo() { if (!redo.length) return false; undo.push(m); m = redo.pop(); return true; } };
  };
  E.PRESETS = [
    ['橡木板', 'minecraft:oak_planks'], ['石砖', 'minecraft:stone_bricks'], ['白色混凝土', 'minecraft:white_concrete'], ['平滑石英', 'minecraft:smooth_quartz'],
    ['玻璃', 'minecraft:glass'], ['云杉木板', 'minecraft:spruce_planks'], ['橡木台阶', 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]'],
    ['云杉半砖', 'minecraft:spruce_slab[type=bottom,waterlogged=false]'], ['去皮橡木柱', 'minecraft:stripped_oak_log[axis=y]'],
    ['灯笼', 'minecraft:lantern[hanging=false,waterlogged=false]'], ['橡木活板门', 'minecraft:oak_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]']
  ];
  // Node tests load the data API without DOM/renderer.
  if (typeof document === 'undefined' || !V3.models) return;
  let doc = null, live = null;
  E.current = () => live;
  const U = V3.util, el = U.el, clamp = U.clamp;
  const option = (v, text) => el('option', { value: v }, text);
  const select = (id, items) => el('select', { id }, items.map(([v, t]) => option(v, t)));
  const button = (id, text, fn) => el('button', { id, type: 'button', onclick: () => run(fn) }, text);
  const run = async fn => { try { await fn(); } catch (e) { if (live) live.message(e.message || String(e), true); } };
  const color = s => { if (air(s)) return '#f2f5f5'; if (parse(s).id.startsWith('xiaojingyu:')) return '#e9ad72'; let n = 0; for (const c of s.split('[')[0]) n = (n * 31 + c.charCodeAt(0)) | 0; return 'hsl(' + (Math.abs(n) % 360) + ' 25% 68%)'; };
  function build() {
    if (!doc) doc = E.session(V3.houseMc.build().model);
    const root = new THREE.Group(); root.name = 'block-editor';
    const cursor = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)), new THREE.LineBasicMaterial({ color: 0x168bff, depthTest: false }));
    cursor.renderOrder = 99; cursor.userData.noPick = true; root.add(cursor);
    let seq = 0, meshes = null, photoRoot = null, dead = false, selected = [0, 0, 0], layer = 0;
    function clearPhotos() { if (!photoRoot) return; photoRoot.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); root.remove(photoRoot); photoRoot = null; }
    const inst = { id: 'blockeditor', label: '方块编辑器 · P6', root, partRoot: '方块编辑器', stage: { pedestal: false, size: 32 },
      views: { top: { az: 0, el: 1.5, dist: 30, target: [8, 0, 8] } }, ready: null, error: null,
      get model() { return doc.model; }, get selected() { return selected.slice(); }, get session() { return doc; },
      dispose() { dead = true; seq++; clearPhotos(); cursor.geometry.dispose(); cursor.material.dispose(); if (meshes) V3.houseMcModel.disposeTree(meshes.root); panel.remove(); document.body.classList.remove('block-editor-on'); if (live === inst) live = null; } };
    live = inst;
    const scene = select('be-scene', [['house', '小屋副本'], ['blank', '空白 16 × 12 × 16']]);
    const tool = select('be-tool', [['select', '选择 / 吸取'], ['place', '放方块'], ['furniture', '摆整件家具'], ['erase', '删除（家具整件）']]);
    const palette = select('be-palette', E.PRESETS.map(([n, s]) => [s, n]));
    const state = el('textarea', { id: 'be-state', rows: 3, 'aria-label': '方块完整状态', spellcheck: false }, E.PRESETS[0][1]);
    const facing = select('be-facing', dirs.map((d, i) => [d, ['北 −Z', '东 +X', '南 +Z', '西 −X'][i]]));
    const furn = select('be-furniture', F().list.map(f => [f.id, f.label + ' · ' + f.cells.length + '格']));
    const yy = el('input', { id: 'be-layer', type: 'number', min: 0, value: 0, 'aria-label': '编辑层 Y' });
    const clip = el('input', { id: 'be-clip', type: 'checkbox', checked: true });
    const coords = ['x', 'y', 'z'].map((a, i) => el('input', { id: 'be-' + a, type: 'number', min: 0, value: selected[i], 'aria-label': a.toUpperCase() }));
    const grid = el('canvas', { id: 'be-grid', width: 320, height: 320, tabindex: 0, 'aria-label': '逐层方块网格，北在上东在右' });
    const info = el('div', { id: 'be-selection', class: 'be-small' });
    const status = el('div', { id: 'be-status', role: 'status', 'aria-live': 'polite' });
    const file = el('input', { id: 'be-file', type: 'file', accept: '.png,.schem', hidden: true });
    const undo = button('be-undo', '撤销', () => { doc.undo(); refresh(); });
    const redo = button('be-redo', '重做', () => { doc.redo(); refresh(); });
    const readPos = () => coords.map(c => Number(c.value));
    const picked = () => E.pieceAt(doc.model, selected);
    const apply = m => { doc.apply(m); refresh(); };
    const act = p => {
      if (!E.inside(doc.model, p)) throw new Error('坐标必须是场景范围内的整数');
      selected = p.slice(); layer = p[1]; yy.value = layer;
      if (tool.value === 'place') apply(E.put(doc.model, p, state.value));
      else if (tool.value === 'erase') apply(E.remove(doc.model, p));
      else if (tool.value === 'furniture') apply(E.placeFurniture(doc.model, furn.value, p, facing.value));
      else { const s = E.stateAt(doc.model, p), pc = E.pieceAt(doc.model, p); if (!air(s) && !pc) { state.value = s; if (parse(s).props.facing && dirs.includes(parse(s).props.facing)) facing.value = parse(s).props.facing; } if (pc) { furn.value = pc.f.id; if (dirs.includes(pc.facing)) facing.value = pc.facing; } refresh(); }
    };
    const panel = el('section', { id: 'block-editor', 'aria-label': '方块编辑器' },
      el('h2', null, '方块编辑器'), el('p', { class: 'be-small' }, '选层，再点格子。右侧拖动旋转 3D。坐标是鲸图内的格子；改动仅在此工作台副本中。'),
      el('div', { class: 'be-row' }, scene, button('be-load-scene', '载入场景', () => { apply(scene.value === 'blank' ? E.empty() : V3.houseMc.build().model); frame(); })),
      el('div', { class: 'be-row' }, button('be-import', '导入鲸图', () => file.click()), button('be-export', '导出鲸图 PNG', async () => {
        const bytes = await inst.exportPng(), url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        const a = el('a', { href: url, download: 'workbench-edited.png' }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        inst.message('鲸图已导出，请发送原图或文件。');
      }), file),
      el('div', { class: 'be-row' }, undo, redo, button('be-frame', '对准场景', () => frame())),
      el('label', null, '操作', tool), el('label', null, '常用方块', palette), el('label', null, '完整状态（可直接修改）', state),
      el('div', { class: 'be-row' }, el('label', null, '朝向', facing), el('label', null, '整件家具', furn)),
      el('div', { class: 'be-row' }, el('label', null, '编辑层 Y', yy), el('label', { class: 'be-check' }, clip, '隐藏上层')),
      button('be-fill', '用当前方块填本层空气（一次撤销）', () => apply(E.fillLayer(doc.model, layer, state.value))),
      el('div', { class: 'be-small' }, '北 −Z ↑　东 +X →　橙色 = 家具；白色 = 空气'), grid,
      el('div', { class: 'be-row be-coords' }, ...coords.map((c, i) => el('label', null, ['X', 'Y', 'Z'][i], c)), button('be-apply', '执行', () => act(readPos()))), info,
      el('div', { class: 'be-row' }, button('be-remove', '删除选中整件/格', () => apply(E.remove(doc.model, selected))), button('be-rotate', '家具转 90°', () => {
        const p = picked(); if (!p) throw new Error('先选中一件家具');
        apply(E.placeFurniture(doc.model, p.f.id, p.main, dirs[(dirs.indexOf(p.facing) + 1) % 4], selected)); selected = p.main; sync();
      })),
      button('be-move', '将选中家具移到 XYZ 输入坐标', () => { const p = picked(); if (!p) throw new Error('先选中一件家具'); const target = readPos(); apply(E.placeFurniture(doc.model, p.f.id, target, facing.value, selected)); selected = target; layer = target[1]; yy.value = layer; refresh(); }),
      el('p', { class: 'be-small' }, '完整状态可改 half / axis / open 等属性。家具不覆盖已有格子；创作模式允许悬空，放进 MC 前请补好支撑。Ctrl+Z 撤销，Ctrl+Shift+Z 重做。切换场景也可撤销。'), status);
    document.body.append(panel); document.body.classList.add('block-editor-on');
    inst.message = (s, error = false) => { status.textContent = s; status.classList.toggle('error', error); };
    function frame() {
      const m = doc.model, o = V3.mcmesh.worldOrigin(m) || [0, 0, 0], t = m.size.map((n, i) => o[i] + n / 2);
      V3.R.ctl.set({ az: 0.6, el: 0.65, dist: Math.max(...m.size) * 1.6, target: t }, false);
    }
    function sync() {
      const m = doc.model; layer = clamp(layer, 0, m.size[1] - 1); yy.max = m.size[1] - 1; yy.value = layer;
      selected = selected.map((n, i) => clamp(n, 0, m.size[i] - 1)); coords.forEach((c, i) => { c.value = selected[i]; c.max = m.size[i] - 1; });
      const org = V3.mcmesh.worldOrigin(m) || [0, 0, 0]; cursor.position.fromArray(selected.map((n, i) => n + org[i] + 0.5));
      undo.disabled = !doc.undoCount; redo.disabled = !doc.redoCount;
      const s = E.stateAt(m, selected), pc = E.pieceAt(m, selected);
      info.textContent = '[' + selected.join(', ') + '] ' + s + (pc ? ' · ' + pc.f.label + (pc.broken ? '（不完整）' : '（整件）') : '');
      const ctx = grid.getContext('2d'), w = m.size[0], d = m.size[2], unit = 320 / Math.max(w, d);
      ctx.clearRect(0, 0, 320, 320);
      for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
        ctx.fillStyle = color(E.stateAt(m, [x, layer, z])); ctx.fillRect(x * unit, z * unit, unit, unit);
        ctx.strokeStyle = '#ffffff80'; ctx.lineWidth = 0.6; ctx.strokeRect(x * unit, z * unit, unit, unit);
      }
      if (selected[1] === layer) { ctx.strokeStyle = '#166bdb'; ctx.lineWidth = 3; ctx.strokeRect(selected[0] * unit + 1, selected[2] * unit + 1, unit - 2, unit - 2); }
    }
    async function rebuild() {
      const my = ++seq, m = doc.model; inst.error = null;
      try {
        await V3.houseBlocks.modPackReady();
        const jar = await V3.houseMcModel.jarPack(), pack = V3.houseBlocks.renderPack(jar);
        const cut = clip.checked ? V3.houseMcModel.cutModel(m, layer) : m;
        const res = await V3.mcmesh.build(cut, { pack, ao: true, light: true, mipmaps: true });
        if (my !== seq || dead) return;
        if (meshes) { root.remove(meshes.root); V3.houseMcModel.disposeTree(meshes.root); }
        meshes = V3.houseMcModel.meshes(res); meshes.root.position.fromArray(V3.mcmesh.worldOrigin(m) || [0, 0, 0]); root.add(meshes.root);
        clearPhotos();
        const pr = new THREE.Group(); photoRoot = pr; pr.name = 'editor-photos'; root.add(pr);
        const po = V3.photos.originOf(m), wo = V3.mcmesh.worldOrigin(m) || [0, 0, 0]; pr.position.fromArray(wo.map((n, i) => n - po[i]));
        await Promise.all(V3.photos.frames(cut).flatMap(fr => fr.slots.map(async (photo, slot) => {
          if (!photo || !V3.photoFrames) return;
          const g = V3.photos.slotGeom(fr.f, fr.cell, fr.facing, slot); if (!g) return;
          if (clip.checked && Math.min(...g.corners.map(c => c[1] - po[1])) > layer + 1) return;
          const texture = await V3.photoFrames.texture(photo).p;
          if (!texture || my !== seq || dead) return;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(g.corners.flat(), 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv.flat(), 2));
          geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
          const tex = texture.clone(); tex.needsUpdate = true;
          const plane = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
          plane.name = 'editor-photo'; plane.userData.photoId = photo.id; pr.add(plane);
        })));
        if (my !== seq || dead) return;
        inst.message('场景 ' + m.size.join(' × ') + ' · 撤销 ' + doc.undoCount + ' 步' + (jar ? ' · MC 贴图' : ' · 自绘近似贴图'));
      } catch (e) { if (my === seq && !dead) { inst.error = e.message; inst.message('预览失败：' + e.message, true); } }
    }
    function refresh() { sync(); inst.ready = rebuild(); return inst.ready; }
    inst.refresh = refresh;
    inst.importBytes = async bytes => {
      const m = await S().read(bytes); if (dead) return;
      if (m.cells.length > 262144) throw new Error('编辑器最多支持 262144 格；请在 MC 中抓取较小范围');
      const deps = await V3.houseBlocks.validateDependencies(m);
      if (dead) return;
      if (deps.missing.length) {
        V3.houseBlocks.showMissingMods(deps.missing);
        throw new Error('缺少所需模组：' + deps.missing.join('、'));
      }
      apply(m); frame(); await inst.ready;
    };
    inst.exportPng = async () => {
      await inst.ready;
      cursor.visible = false;
      let url;
      try { V3.R.renderer.render(V3.R.scene, V3.R.camera); url = V3.R.canvas.toDataURL('image/png'); }
      finally { cursor.visible = true; }
      const bytes = Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0));
      return S().writePng(V3.houseBlocks.withDependencyMetadata(doc.model), bytes);
    };
    file.addEventListener('change', () => run(async () => { try { if (file.files[0]) await inst.importBytes(file.files[0]); } finally { file.value = ''; } }));
    palette.addEventListener('change', () => { state.value = E.withFacing(palette.value, facing.value); tool.value = 'place'; });
    facing.addEventListener('change', () => run(() => { state.value = E.withFacing(state.value, facing.value); }));
    furn.addEventListener('change', () => { tool.value = 'furniture'; });
    yy.addEventListener('change', () => { layer = clamp(Math.trunc(Number(yy.value) || 0), 0, doc.model.size[1] - 1); selected[1] = layer; refresh(); });
    clip.addEventListener('change', refresh);
    grid.addEventListener('click', e => run(() => { const r = grid.getBoundingClientRect(), unit = 320 / Math.max(doc.model.size[0], doc.model.size[2]); act([Math.floor((e.clientX - r.left) * 320 / r.width / unit), layer, Math.floor((e.clientY - r.top) * 320 / r.height / unit)]); }));
    panel.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); e.stopPropagation(); e.shiftKey ? doc.redo() : doc.undo(); refresh(); } });
    inst.ready = refresh();
    return inst;
  }
  V3.models.register({ id: 'blockeditor', label: '方块编辑器 · P6', build });
  V3.on('ready', () => {
    if (V3.PAGE !== 'studio') return;
    const b = button('be-open', '方块编辑器', () => { if (V3.fb && V3.fb.d2) V3.fb.d2.close(); V3.models.show('blockeditor'); });
    b.className = 'be-open'; document.body.append(b);
  });
})(window.V3);
