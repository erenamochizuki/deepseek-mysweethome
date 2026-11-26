// 92-mcview.js — 开发用查看页：选 MC jar，按方块模型画出方块（mcview 页）
// 网址参数：model=<鲸图 PNG / .schem / dump JSON / 方块 JSON 的网址>  jar=<jar 网址>（测试用，cache=0 不写进缓存）
//          cam=x,y,z,yaw,pitch[,fov]（MC 相机，脚下坐标）
//          w=1280&h=720（固定画布尺寸）  compare=1（不显示工具栏、透明背景）  ao=0  bright=1  mip=4  light=0（不算光照）
//          fog=1/0（MC 白天雾，对比模式默认开，平时默认关）  rd=8（算雾用的渲染距离，区块）
// 打开方块：按钮选文件，或者把鲸图 / .schem / JSON（还有 jar）直接拖进页面。
(function (V3) {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const COMPARE = Q.get('compare') === '1';
  const FOG = Q.get('fog') == null ? COMPARE : Q.get('fog') === '1';
  const RD = Q.get('rd') == null ? 8 : +Q.get('rd');
  const css = document.createElement('style');
  css.textContent = [
    'html,body{margin:0;height:100%;overflow:hidden;font:13px/1.4 system-ui,"Microsoft YaHei",sans-serif;background:#1d2329;color:#e8e8e8}',
    '#mcv-bar{position:fixed;left:0;right:0;top:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 10px;background:rgba(20,24,28,.88);z-index:2}',
    '#mcv-bar button,#mcv-bar label.btn{background:#33414d;color:#fff;border:1px solid #4b5b69;border-radius:4px;padding:3px 9px;cursor:pointer}',
    '#mcv-bar input[type=file]{display:none}',
    '#mcv-status{opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60vw}',
    '#mcv-canvas{display:block;background:' + (COMPARE ? 'transparent' : 'linear-gradient(#8fb4ef,#c8dcf6)') + '}',
    '#mcv-warn{position:fixed;left:10px;bottom:8px;max-width:70vw;font-size:12px;color:#ffd27a;white-space:pre-wrap;z-index:2}',
  ].join('\n');
  document.head.appendChild(css);
  const el = (tag, attrs, ...kids) => V3.util.el(tag, attrs, ...kids);
  const status = el('span', { id: 'mcv-status' }, '没有选 jar：用我们自己定的颜色（近似）');
  const warn = el('div', { id: 'mcv-warn' });
  const fileJar = el('input', { type: 'file', accept: '.jar,.zip' });
  const fileModel = el('input', { type: 'file', accept: '.png,.schem,.json' });
  const aoBox = el('input', { type: 'checkbox' });
  aoBox.checked = Q.get('ao') !== '0';
  const lightBox = el('input', { type: 'checkbox' });
  lightBox.checked = Q.get('light') !== '0';
  const bar = el('div', { id: 'mcv-bar' },
    el('label', { class: 'btn', title: '选你自己电脑上的 Minecraft 客户端 jar（例如 .minecraft/versions/<版本>/<版本>.jar）' }, '选 MC jar…', fileJar),
    el('button', { onclick: () => clearJar() }, '忘掉 jar'),
    el('label', { class: 'btn', title: '鲸图 PNG、.schem、dump JSON 或方块 JSON；也可以直接拖进页面' }, '打开鲸图…', fileModel),
    el('button', { onclick: () => setModel(demoModel()) }, '示例'),
    el('label', {}, aoBox, ' 平滑光照'),
    el('label', { title: '按 MC 的规矩算天光和方块光（正午）；关掉就处处满亮' }, lightBox, ' 光照'),
    status);
  const canvas = el('canvas', { id: 'mcv-canvas' });
  if (!COMPARE) document.body.appendChild(bar);
  document.body.appendChild(canvas);
  if (!COMPARE) document.body.appendChild(warn);

  const T3 = V3.mcthree, S = V3.mcmesh, J = V3.mcjar;
  const FIXED = Q.get('w') && Q.get('h') ? [+Q.get('w'), +Q.get('h')] : null;
  const renderer = T3.renderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(T3.MC_FOV, 16 / 9, T3.NEAR, 512);
  const orbit = new V3.Orbit(camera, canvas);
  const st = { pack: null, model: null, res: null, group: null, mcCam: null, busy: 0, builds: 0 };
  const hook = window.__mcview = { ready: false, stats: null, warnings: [], pack: null, builds: 0 };

  function resize() {
    const w = FIXED ? FIXED[0] : window.innerWidth, h = FIXED ? FIXED[1] : window.innerHeight;
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const say = (s) => { status.textContent = s; };
  const fmtPack = (p) => p ? `MC ${p.version.id || '?'}：方块状态 ${p.counts.blockstates} · 模型 ${p.counts.models} · 贴图 ${p.counts.textures}` + (p.fromCache ? '（来自本机缓存）' : '') : '没有选 jar：用我们自己定的颜色（近似）';

  async function rebuild() {
    if (!st.model) return null;
    const my = ++st.busy;
    hook.ready = false;
    const res = await S.build(st.model, { pack: st.pack, ao: aoBox.checked, light: lightBox.checked, mipmaps: true, renderDistance: RD });
    if (my !== st.busy) return null;
    if (st.group) T3.dispose(st.group);
    st.res = res;
    st.group = T3.group(res, { mipLevels: Q.get('mip') == null ? T3.MIP_LEVELS : +Q.get('mip'), bright: Q.get('bright') == null ? 1 : +Q.get('bright'), fog: FOG });
    scene.add(st.group);
    st.builds++;
    hook.builds = st.builds;
    hook.stats = res.stats; hook.warnings = res.warnings; hook.size = res.size; hook.origin = res.origin; hook.fog = FOG && res.env && res.env.fog ? res.env.fog : null;
    warn.textContent = res.warnings.length ? '提示：' + res.warnings.slice(0, 6).join('\n') + (res.warnings.length > 6 ? `\n……共 ${res.warnings.length} 条` : '') : '';
    const nq = res.stats.quads, faces = nq.solid + nq.cutout + nq.translucent + (nq.entity || 0);
    say(fmtPack(st.pack) + ` ｜ ${res.stats.blocks} 个方块，${faces} 个面，${res.stats.ms} ms`);
    if (st.mcCam) applyCam(); else frame(res);
    hook.ready = true;
    return res.stats;
  }

  function frame(res) {
    const b = res.bounds;
    if (!isFinite(b[0])) return;
    const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const r = Math.max(1, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2);
    orbit.maxDist = Math.max(60, r * 6);
    orbit.set({ target: c, dist: r / Math.sin(camera.fov * Math.PI / 360) * 1.1, az: 0.65, el: 0.45 });
  }

  function applyCam() {
    orbit.enabled = false;
    T3.placeCamera(camera, Object.assign({ origin: st.res ? st.res.origin : [0, 0, 0] }, st.mcCam));
  }

  function loop() {
    if (!st.mcCam) orbit.update(1 / 60);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  async function useJar(input, save) {
    const t = performance.now();
    say('正在读 jar……');
    try {
      const pack = await J.fromBytes(input);
      st.pack = pack; hook.pack = { key: pack.key, version: pack.version, counts: pack.counts, ms: Math.round(performance.now() - t) };
      if (save) hook.saving = J.cacheSave(pack).then(() => true, (e) => { console.warn('缓存失败', e); return false; });
      await rebuild();
      if (!st.model) say(fmtPack(pack));
      return { ok: true, pack: hook.pack };
    } catch (e) {
      say('读 jar 失败：' + (e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  async function clearJar() {
    st.pack = null; hook.pack = null;
    try { await J.cacheClear(); } catch (e) { console.warn(e); }
    await rebuild();
    say(fmtPack(null));
  }

  async function setModel(m) {
    const old = st.model;
    st.model = m;
    try { return await rebuild(); } catch (e) { st.model = old; hook.ready = true; throw e; }
  }

  // 读方块文件：鲸图 PNG / .schem 交给 V3.share；JSON 里有 dump 键的按 dump 读，否则当方块 JSON（{size,palette,cells}，或探针 /region）
  const SHARE_WARN = { data_version: '文件的游戏数据版本和 26.1.2 不同', ignored_biomes: '文件里的群系没用上', ignored_entities: '文件里的实体（生物、物品框等）没画',
    newer_format: '文件是更新版本的小鲸鱼写的', unused_palette: '调色板里有没用到的方块' };
  async function readModel(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let i = 0;
    while (i < u8.length && (u8[i] === 0x20 || u8[i] === 0x0a || u8[i] === 0x0d || u8[i] === 0x09 || u8[i] === 0xef || u8[i] === 0xbb || u8[i] === 0xbf)) i++;
    if (u8[i] === 0x7b) {
      let j;
      try { j = JSON.parse(new TextDecoder().decode(u8)); } catch (e) { throw Object.assign(new Error('JSON 写得不对：' + e.message), { code: 'bad_json' }); }
      return j && typeof j === 'object' && 'dump' in j ? V3.share.fromDump(j) : j;
    }
    return V3.share.read(u8);
  }
  async function openModel(bytes, name) {
    try {
      const m = await readModel(bytes);
      const w = (m.warnings || []).map((c) => SHARE_WARN[c] || c);
      await setModel(m);
      hook.model = { name: name || null, size: st.res.size, origin: st.res.origin, warnings: w };
      if (w.length) warn.textContent = '文件：' + w.join('；') + (warn.textContent ? '\n' + warn.textContent : '');
      return { ok: true, stats: hook.stats, model: hook.model };
    } catch (e) {
      const msg = (e && e.message) || String(e);
      say('打不开' + (name ? ' ' + name : '这个文件') + '：' + msg);
      hook.lastError = { code: (e && e.code) || null, message: msg };
      return { ok: false, code: hook.lastError.code, error: msg };
    }
  }

  fileJar.addEventListener('change', () => { const f = fileJar.files[0]; if (f) useJar(f, true); fileJar.value = ''; });
  fileModel.addEventListener('change', async () => {
    const f = fileModel.files[0]; fileModel.value = '';
    if (f) await openModel(new Uint8Array(await f.arrayBuffer()), f.name);
  });
  // 拖进来：jar/zip 当 MC jar，其余当方块文件
  window.addEventListener('dragover', (ev) => { ev.preventDefault(); });
  window.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.(jar|zip)$/i.test(f.name)) await useJar(bytes, true); else await openModel(bytes, f.name);
  });
  aoBox.addEventListener('change', () => rebuild());
  lightBox.addEventListener('change', () => rebuild());

  // cam=x,y,z,yaw,pitch[,fov]
  const parseCam = (s) => {
    const a = String(s).split(',').map(Number);
    if (a.length < 5 || a.some((n) => !isFinite(n))) return null;
    return { pos: [a[0], a[1], a[2]], yaw: a[3], pitch: a[4], fov: a[5] || T3.MC_FOV };
  };

  Object.assign(hook, {
    setModel,
    openModel: (bytes, name) => openModel(bytes, name),
    openModelUrl: async (url) => openModel(new Uint8Array(await (await fetch(url)).arrayBuffer()), String(url).split('/').pop()),
    loadJar: (bytes, save) => useJar(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), !!save),
    loadJarUrl: async (url, save) => useJar(new Uint8Array(await (await fetch(url)).arrayBuffer()), !!save),
    clearJar,
    setCamera: (c) => { st.mcCam = c ? Object.assign({}, c) : null; if (st.mcCam) applyCam(); else { orbit.enabled = true; if (st.res) frame(st.res); } },
    render: () => { renderer.render(scene, camera); renderer.render(scene, camera); },
    snapshot: () => { renderer.render(scene, camera); renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    info: () => ({ width: canvas.width, height: canvas.height, fov: camera.fov, pos: camera.position.toArray(), rot: [camera.rotation.x, camera.rotation.y, camera.rotation.z] }),
  });

  function demoModel() {
    const pal = ['minecraft:air', 'minecraft:grass_block[snowy=false]', 'minecraft:water[level=0]', 'minecraft:stone', 'minecraft:cobblestone', 'minecraft:oak_planks',
      'minecraft:oak_log[axis=y]', 'minecraft:oak_leaves[distance=1,persistent=true,waterlogged=false]', 'minecraft:glass',
      'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'minecraft:stone_slab[type=bottom,waterlogged=false]', 'minecraft:torch',
      'minecraft:oak_fence[east=true,north=false,south=false,waterlogged=false,west=false]', 'minecraft:oak_fence[east=false,north=false,south=false,waterlogged=false,west=true]',
      'minecraft:chest[facing=south,type=single,waterlogged=false]', 'minecraft:poppy', 'minecraft:short_grass',
      'minecraft:oak_door[facing=south,half=lower,hinge=left,open=false,powered=false]', 'minecraft:oak_door[facing=south,half=upper,hinge=left,open=false,powered=false]',
      'minecraft:red_bed[facing=south,occupied=false,part=foot]', 'minecraft:red_bed[facing=south,occupied=false,part=head]'];
    const W = 7, H = 4, L = 5, cells = new Array(W * H * L).fill(0);
    const set = (x, y, z, v) => { cells[x + z * W + y * W * L] = v; };
    for (let x = 0; x < W; x++) for (let z = 0; z < L; z++) set(x, 0, z, x >= 5 && z >= 3 ? 2 : 1);
    [[0, 1, 0, 3], [1, 1, 0, 4], [2, 1, 0, 5], [3, 1, 0, 6], [3, 2, 0, 6], [3, 3, 0, 7], [2, 3, 0, 7], [4, 1, 0, 8], [5, 1, 0, 9], [6, 1, 0, 10],
      [0, 1, 2, 11], [1, 1, 2, 12], [2, 1, 2, 13], [3, 1, 2, 14], [4, 1, 2, 15], [5, 1, 2, 16], [0, 1, 4, 17], [0, 2, 4, 18], [2, 1, 3, 20], [2, 1, 4, 19]]
      .forEach((a) => set(...a));
    return { size: [W, H, L], palette: pal, cells };
  }

  (async function start() {
    if (V3.cabinProgress && !await V3.cabinProgress.start()) return;
    try {
      if (Q.get('jar')) await useJar(new Uint8Array(await (await fetch(Q.get('jar'))).arrayBuffer()), Q.get('cache') === '1');
      else if (Q.get('cache') !== '0') {
        const p = await J.cacheLoad().catch(() => null);
        if (p) { st.pack = p; hook.pack = { key: p.key, version: p.version, counts: p.counts, fromCache: true }; }
      }
      if (Q.get('cam')) st.mcCam = parseCam(Q.get('cam'));
      if (Q.get('model')) await hook.openModelUrl(Q.get('model'));
      else await setModel(demoModel());
      hook.ready = true;
    } catch (e) {
      say('出错了：' + (e.message || e));
      console.error(e);
      hook.error = String(e.message || e);
    }
    hook.started = true;
    loop();
  })();
})(window.V3);
