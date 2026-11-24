// 29-ysmui.js — YSM 模型的导入界面和存储（导入器本身在 29-ysm.js）。
// - 存储：IndexedDB 'v3-ysm' / 'models'，每个模型一条 { id, name, file, authors, license, layout, at, files: [[路径, 字节]] }；
//   游戏里用哪个存在 localStorage 'v3.girl.model'：没选过时使用页面内置的可爱小鲸鱼，
//   旧内置模型的选择自动回到 Twin，导入的模型保存在当前浏览器。
// - 工作台：模型「导入的 YSM 模型」（id 'ysm'）+ 左下角小面板：导入 zip / .ysm / 文件夹、选已导入的、删除、看作者和协议。
// - 游戏页：设置里的「角色」页：用哪个角色、导入、删除、身高（girlHeight）。选中的 YSM 模型替换游戏里的小鲸鱼（V3.actor.useBody）。
// - 两个页面都能把 zip / .ysm / 文件夹直接拖进窗口导入。
// - 加密的 .ysm：只显示文件头里的明文（名字、作者、协议、简介、内容），说明为什么打不开、怎么办。
(function (V3) {
  'use strict';
  const U = V3.util, Y = V3.ysm;
  if (!Y) return;
  const UI = V3.ysmUI = { cache: new Map() };
  const LS = 'v3.girl.model';
  const baseName = (p) => String(p || '').split(/[\\/]/).pop().replace(/\.(zip|ysm)$/i, '');
  const toast = (msg, bad) => {
    if (V3.hud && V3.hud.toast && V3.hud.mounted) V3.hud.toast(msg, { color: bad ? '#ff8a8a' : '#6fc3f5' });
    else if (V3.fb && V3.fb.toast) V3.fb.toast(msg, bad ? 'err' : 'ok', 5000);
  };

  // ---- IndexedDB ----
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('这个浏览器存不了模型（没有 IndexedDB）')); return; }
    const r = indexedDB.open('v3-ysm', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('models')) r.result.createObjectStore('models', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('打不开浏览器里的模型库'));
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('models', mode), req = fn(t.objectStore('models'));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('存储被取消'));
    });
  };
  UI.list = async () => {
    try { return ((await tx('readonly', s => s.getAll())) || []).map(({ files, ...m }) => m).sort((a, b) => b.at - a.at); }
    catch (e) { return []; }
  };
  UI.get = (id) => tx('readonly', s => s.get(id));

  // ---- 自带的 YSM 模型：build.mjs 把 assets/ 下的文件内联成 base64（window.__V3_ASSETS）----
  // 内置的两个 YSM 小鲸鱼模型来自 Moci 的原始模型包，随页面原样内嵌。
  // 其他模型可从设置里导入。
  // tune = 游戏里的调校（29-ysm build 的 opts.tune）：
  //   face：actor 的表情 → 她「脸部选项」里的变量（左眼 le / 右眼 re / 嘴 t，pants_change* 是同一个值给单选高亮用；auto_eyes = 1 关掉自动表情）。
  //         happy 不在表里 = 用她自己的自动表情；talk 的嘴按 seq 轮换。只在那一帧临时改，不动玩家的设置。
  //   longIdle：偶尔站着发呆这么多秒（她的控制器站满约 38 秒才演待机动画 idle_1 = 铁盆那段）。
  const EYE = (l, r) => ({ 'roaming.pants_change1': l, 'roaming.le': l, 'roaming.pants_change2': r, 'roaming.re': r });
  const MOUTH = (m) => ({ 'roaming.pants_change': m, 'roaming.t': m });
  const FACE = (l, r, m) => Object.assign({ 'roaming.auto_eyes': 1 }, EYE(l, r), m == null ? {} : MOUTH(m));
  const FATFISH_TUNE = {
    // 为带这套脸部选项的导入模型保留眼部调校。
    disableGlowBones: ['ysmGlowRightEyesBase', 'ysmGlowLeftEyesBase', 'ysmGlowRightEyesBase4', 'ysmGlowLeftEyesBase4',
      'ysmGlowAutoRightEyesBase1', 'ysmGlowAutoLeftEyesBase1', 'ysmGlowAutoRightEyesBase2', 'ysmGlowAutoLeftEyesBase2'],
    longIdle: 62,
    face: {
      talk: { vars: FACE(0, 0), seq: { keys: ['roaming.pants_change', 'roaming.t'], values: [4, 2, 0, 5, 0, 4], every: 0.12 } },   // 说话：OoO / OωO / 无 / O∀O
      laugh: { vars: FACE(4, 4, 5) },              // >_<  O∀O
      surprised: { vars: FACE(0, 0, 10) },         // O_O  O△O
      pout: { vars: FACE(0, 0, 12) },              // 躲雷时：害怕
      sad: { vars: FACE(1, 1, 7) },                // —_—  O︿O
      sleep: { vars: FACE(1, 1, 0) },              // 躺着睡（65-girl-actor 的 lying）：闭眼 —_—，嘴放松（不是难过的 O︿O）
      neutral: { vars: FACE(0, 0, 0) },
    },
  };
  const BUILTIN = [
    { id: 'builtin:blue-whale-maid-twin', asset: 'characters/Blue-Whale-Maid-Twin.zip', name: '可爱小鲸鱼 · 低双马尾', sub: '默认角色 · 模型作者 Moci' },
    { id: 'builtin:blue-whale-maid-loose', asset: 'characters/Blue-Whale-Maid-Loose.zip', name: '可爱小鲸鱼 · 散发', sub: '内置角色 · 模型作者 Moci' },
  ];
  // 署名（refs/CREDITS.md：小鲸鱼是对上善无形设计的改编，成品里要写明，不得商用）
  UI.CREDIT = '可爱小鲸鱼模型：Moci · 角色设计：上善无形（ZipZipPipe），CC BY-NC-SA 4.0，不得商用';
  // 调校不只认 id（2026-11-12）：同一作者的换装版是玩家导入的模型，id 是随机的，
  // 以前拿不到这张表 → 被戳、说话、躲雷时脸不变（眼睛夜里发亮也是同一个原因）。
  // 现在按模型自己的「脸部选项」认：三项单选（左眼 / 右眼 / 嘴）用的变量和选项的取值，正好覆盖这张表要用到的那些，
  // 就是同一套脸，直接用同一张表。别的作者的模型变量名不一样，认不出来就没有表情调校（和以前一样），不会乱改它的变量。
  const FACE_NEEDS = { 'roaming.pants_change1': [0, 1, 4], 'roaming.pants_change2': [0, 1, 4], 'roaming.pants_change': [0, 2, 4, 5, 7, 10, 12] };
  UI.sameFaceAsFatfish = (model) => {
    const forms = (model && model.forms) || [];
    if (!forms.some(f => f.key === 'roaming.auto_eyes')) return false;
    return Object.entries(FACE_NEEDS).every(([key, values]) => {
      const f = forms.find(x => x.key === key && x.type === 'radio' && Array.isArray(x.vals) && Array.isArray(x.labels));
      // 选项那句 Molang 里还要同时写着真正起作用的那个变量（le / re / t）：pants_change* 只是单选高亮用的
      const real = key === 'roaming.pants_change1' ? 'le' : key === 'roaming.pants_change2' ? 're' : 't';
      return !!f && values.every(v => f.vals.some((x, i) => x === v && new RegExp('roaming\\.' + real + '\\s*=\\s*' + v + '(?![\\d.])').test(f.labels[i][1])));
    });
  };
  const tuneOf = (id, model) => UI.sameFaceAsFatfish(model) ? FATFISH_TUNE : null;
  UI.tuneOf = tuneOf;
  UI.BUILTIN = BUILTIN;
  UI.isBuiltin = (id) => BUILTIN.some(b => b.id === id);
  const assetB64 = (name) => (window.__V3_ASSETS || {})[name] || null;
  const assetBytes = (name) => {
    const s = assetB64(name); if (!s) return null;
    const bin = atob(s), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  };
  UI.defaultId = () => BUILTIN[0].id;
  UI.del = async (id) => { if (UI.isBuiltin(id)) return; await tx('readwrite', s => s.delete(id)); UI.cache.delete(id); if (UI.choice() === id) UI.choose(UI.defaultId()); V3.emit('ysm:list'); };
  UI.choice = () => {
    let id = null; try { id = localStorage.getItem(LS); } catch (e) { /* private mode */ }
    if (id && id.startsWith('builtin:') && !BUILTIN.some(b => b.id === id && assetB64(b.asset))) id = null;
    return id && id !== 'v1' ? id : UI.defaultId();
  };
  UI.choose = (id) => { id = id || UI.defaultId(); try { localStorage.setItem(LS, id); } catch (e) { /* private mode */ } V3.emit('girl:model', id); };
  const loading = new Map();
  UI.model = (id) => {                           // parsed model (cached; parallel calls share one load)
    if (UI.cache.has(id)) return Promise.resolve(UI.cache.get(id));
    if (loading.has(id)) return loading.get(id);
    const p = (async () => {
      const B = BUILTIN.find(b => b.id === id);
      let m;
      if (B) {
        const bytes = assetBytes(B.asset);
        if (!bytes) throw new Error('这个页面里没有带自带的模型');
        m = Y.load(await V3.zip.read(bytes), { name: B.name });
      } else {
        const rec = await UI.get(id);
        if (!rec) throw new Error('浏览器里找不到这个模型了');
        m = Y.load(new Map(rec.files), { name: rec.name });
      }
      UI.cache.set(id, m);
      return m;
    })();
    loading.set(id, p);
    p.then(() => loading.delete(id), () => loading.delete(id));
    return p;
  };
  // 先缓存默认角色，旧存档中的导入模型失效或读取得慢时也能建好场景。
  UI.preload = async (ms = 5000) => {
    const def = UI.defaultId(), id = UI.choice();
    const fallback = await UI.model(def);
    if (id === def) return fallback;
    try { return await Promise.race([UI.model(id), new Promise(r => setTimeout(() => r(fallback), ms))]); }
    catch (e) { return fallback; }
  };
  const heightSetting = () => (V3.game && V3.game.get && V3.game.get('girlHeight')) || 1.26;
  // '@eyeGlow'：我们自己加的设置（和 '@legs' 一样存在这个模型的 vars 里）。没勾过 = false：眼睛跟着场景光照，不全亮。
  const eyeGlowOf = (id) => UI.vars(id)['@eyeGlow'] === true;
  const builderOf = (id, model) => () => Y.build(model, { height: heightSetting(), anchor: 'girl:', partRoot: '小鲸鱼', vars: UI.vars(id), tune: tuneOf(id, model), eyeGlow: eyeGlowOf(id) });
  // initialBody() → { id, builder } | null：65-girl-actor 建场景时用（模型已经 preload 好才有）
  UI.initialBody = (id = UI.choice()) => {
    if (!UI.cache.has(id)) id = UI.defaultId();
    return { id, builder: builderOf(id, UI.cache.get(id)) };
  };

  // ---- 读玩家给的文件：zip / .ysm / 一个文件夹的全部文件 ----
  const authorsOf = (meta) => (Array.isArray(meta.authors) ? meta.authors : []).map(a => (typeof a === 'string' ? a : a && a.name)).filter(Boolean);
  const licenseOf = (meta) => { const L = meta.license; if (!L) return ''; if (typeof L === 'string') return L; return [L.type, L.desc].filter(Boolean).join(' · '); };
  UI.licenseText = (lic) => {
    const s = String(lic || '');
    if (!s) return '没写协议';
    if (/^ARR\b/i.test(s)) return '保留所有权利（ARR）：只能自己用，不能拿去改或再发布';
    if (/CC/i.test(s)) return s + '（知识共享协议，按协议要求署名使用）';
    return s;
  };
  UI.read = async (files) => {
    files = [...files].filter(f => f && f.size !== undefined);
    if (!files.length) throw new Error('没有选到文件');
    const rel = (f) => f.webkitRelativePath || f.relPath || '';
    if (files.length === 1 && !rel(files[0]).includes('/')) {
      const f = files[0], bytes = new Uint8Array(await f.arrayBuffer());
      if (Y.isEncrypted(bytes)) return { kind: 'encrypted', header: Y.header(bytes), fileName: f.name };
      if (V3.zip.isZip(bytes)) return fromMap(await V3.zip.read(bytes), f.name);
      throw new Error(f.name + ' 不是 zip，也不是 YSM 模型');
    }
    const top = rel(files[0]).split('/')[0] || 'YSM 模型';
    return fromMap(await V3.zip.fromFiles(files), top);
  };
  async function fromMap(map, fileName) {
    const model = Y.load(map, { name: baseName(fileName) });       // 不是模型会抛错
    const meta = model.meta || {};
    const rec = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: meta.name || baseName(fileName),
      file: fileName, authors: authorsOf(meta), license: licenseOf(meta), layout: model.layout, at: Date.now(), files: [...model.files] };
    return { kind: 'model', rec, model };
  }
  // import(files) → 存进浏览器（use: true 时顺手换上）
  UI.import = async (files, o = {}) => {
    let r;
    try { r = await UI.read(files); } catch (e) { toast('导入失败：' + ((e && e.message) || e), true); return null; }
    if (r.kind === 'encrypted') { UI.showEncrypted(r.header, r.fileName); return null; }
    try { await tx('readwrite', s => s.put(r.rec)); } catch (e) { toast('存不进浏览器：' + ((e && e.message) || e), true); return null; }
    UI.cache.set(r.rec.id, r.model);
    const by = r.rec.authors.length ? '，作者 ' + r.rec.authors.join('、') : '';
    toast('已导入「' + r.rec.name + '」' + by + '。协议：' + UI.licenseText(r.rec.license));
    V3.emit('ysm:list');
    if (o.use) UI.choose(r.rec.id);
    V3.emit('ysm:imported', r.rec);
    return r.rec;
  };

  // ---- 对话框（两个页面通用）----
  let dlg = null;
  UI.dialog = (title, body) => {
    if (dlg) dlg.remove();
    const close = () => { if (dlg) { dlg.remove(); dlg = null; } removeEventListener('keydown', esc, true); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    addEventListener('keydown', esc, true);
    dlg = U.el('div', { class: 'ysm-dlg', onclick: (e) => { if (e.target === dlg) close(); } },
      U.el('div', { class: 'ysm-dlg-card' }, U.el('div', { class: 'ysm-dlg-title' }, title), body,
        U.el('div', { class: 'ysm-dlg-btns' }, U.el('button', { class: 'ysm-btn pri', type: 'button', onclick: close }, '知道了'))));
    document.body.append(dlg);
    return close;
  };
  UI.showEncrypted = (h, fileName) => {
    const row = (k, v) => (v ? U.el('div', { class: 'ysm-kv' }, U.el('b', null, k), U.el('span', null, v)) : null);
    const parts = [h.anims.length ? h.anims.length + ' 组动画' : '', h.textures.length ? '贴图 ' + h.textures.join('、') : '',
      h.sounds.length ? h.sounds.length + ' 个音效' : '', h.functions.length ? h.functions.length + ' 个脚本' : ''].filter(Boolean).join('，');
    const au = h.authors.map(a => a.name + (a.role ? '（' + a.role + '）' : '')).join('、');
    UI.dialog('这是加密的 YSM 模型', U.el('div', { class: 'ysm-dlg-body' },
      row('文件', fileName), row('名字', h.name), row('作者', au), row('协议', h.license), row('免费', h.free == null ? '' : h.free ? '是' : '否'),
      row('简介', h.tips.join(' / ')), row('包含', parts),
      U.el('p', null, '加密的 .ysm 只有 YSM 模组自己能打开（模组里带着解密的办法），别的程序读不了它的内容，这里也一样。'),
      U.el('p', null, '想在游戏里用这个模型：请联系作者' + (h.authors[0] ? '「' + h.authors[0].name + '」' : '') +
        '，征得同意后要一份不加密的源文件（模型文件夹或 zip，里面有 ysm.json 或 main.json），再导入那个。')));
  };

  // ---- 文件选择（zip / .ysm，或者一个文件夹）----
  const pick = (folder, cb) => {
    const inp = U.el('input', { type: 'file', style: { display: 'none' } });
    if (folder) { inp.webkitdirectory = true; inp.multiple = true; } else inp.accept = '.zip,.ysm';
    inp.addEventListener('change', () => { const fs = [...inp.files]; inp.remove(); if (fs.length) cb(fs); });
    document.body.append(inp); inp.click();
  };
  UI.pick = (folder, o) => pick(folder, (fs) => UI.import(fs, o));

  // ---- 拖进窗口（文件、zip、.ysm 或文件夹）----
  const readEntry = (entry, path, out) => new Promise((res) => {
    if (entry.isFile) entry.file((f) => { f.relPath = path + f.name; out.push(f); res(); }, () => res());
    else if (entry.isDirectory) {
      const rd = entry.createReader(), all = [];
      const more = () => rd.readEntries(async (ents) => {
        if (!ents.length) { for (const e of all) await readEntry(e, path + entry.name + '/', out); res(); return; }
        all.push(...ents); more();
      }, () => res());
      more();
    } else res();
  });
  // 只拖一张 PNG 进游戏页 = 换房子（鲸图，54-house-mc 管；docs/HOUSE-V4.md 第 17 节），提示也换成房子的
  const housePng = (dt) => V3.PAGE !== 'studio' && !!(V3.houseBlocks && V3.houseBlocks.dropFiles) && dt.items && dt.items.length === 1 && dt.items[0].type === 'image/png';
  addEventListener('dragover', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    const h = housePng(e.dataTransfer);
    document.body.classList.toggle('house-drop', h); document.body.classList.toggle('ysm-drop', !h);
  });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('ysm-drop', 'house-drop'); });
  addEventListener('drop', async (e) => {
    document.body.classList.remove('ysm-drop', 'house-drop');
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    const items = [...(e.dataTransfer.items || [])].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    // 只拖了一张鲸图（.png / .schem）：是换房子，交给 54-house-mc
    if (!items.some(x => x.isDirectory) && V3.houseBlocks && V3.houseBlocks.dropFiles && V3.houseBlocks.dropFiles(e.dataTransfer.files)) return;
    const out = [];
    if (items.some(x => x.isDirectory)) { for (const x of items) await readEntry(x, '', out); }
    else out.push(...e.dataTransfer.files);
    const inGame = !!(V3.actor && V3.PAGE !== 'studio');   // 游戏页：cabin（开发用）和 home（小鲸鱼之家）
    const rec = await UI.import(out, { use: inGame });
    if (rec && V3.models.current() && V3.models.current().id === 'ysm') studioShow(rec.id);
  });

  // ---- 模型自带设置（ysm.json 里作者写的 config_forms：模型大小、尾巴……）：每个模型单独存在 localStorage ----
  const VK = (id) => 'v3.ysm.vars.' + id;
  UI.vars = (id) => { try { return JSON.parse(localStorage.getItem(VK(id))) || {}; } catch (e) { return {}; } };
  UI.setVar = (id, k, v) => { const o = UI.vars(id); o[k] = v; try { localStorage.setItem(VK(id), JSON.stringify(o)); } catch (e) { /* private mode */ } };
  // formsEl(inst, id) → 控件（改了马上作用到这个模型上，并记住）；模型没有设置时返回 null
  // 单选的每个选项是一句 Molang，可能顺手改好几个变量（"v.roaming.pants_change1=1;v.roaming.le=1"）：都要存，不然刷新后只恢复一半
  const assigned = (stmt) => [...String(stmt).matchAll(/(?:^|[^\w.])(?:v|variable)\.([\w.]+)\s*=(?!=)/gi)].map(m => m[1].toLowerCase());
  UI.formsEl = (inst, id) => {
    const forms = (inst && inst.forms) || [];
    if (!forms.length && !(inst && (inst.canLegs || inst.canEyeGlow))) return null;
    const box = U.el('div', { class: 'ysm-forms' }, U.el('b', null, forms.length ? '模型自带设置' : '模型设置'));
    // 同一个变量可能出现在好几组里（比如「禁用自动表情」），单选还会改别的变量：任何一个改了，全部按当前值刷新
    const refresh = [], sync = () => refresh.forEach(f => f());
    // 作者分了好几组（按钮页）时，每组一个可折叠的块，默认只展开第一组
    const groups = [...new Set(forms.map(f => f.group))], holder = {};
    if (groups.length > 1) groups.forEach((g, i) => {
      const body = U.el('div', { class: 'ysm-fgb' });
      const d = U.el('details', { class: 'ysm-fg' }, U.el('summary', null, g), body);
      if (i === 0) d.open = true;
      holder[g] = body;
    });
    // 滑条右边的数值可以直接输入（00-core 的 U.numField）。范围、步长在这里夹：模型自带的设置没有 60-game 那层 norm。
    // 这一行不再用 <label> 包着：label 里放两个输入框，点数值会把焦点抢给滑条。
    const snap = (v, min, max, step) => { v = Math.min(max, Math.max(min, v)); return step ? +(Math.round((v - min) / step) * step + min).toFixed(6) : v; };
    if (inst.canLegs) {                              // 我们自己加的腿长（只改游戏里的显示，不改模型文件）
      const inp = U.el('input', { type: 'range', min: 0.5, max: 1.2, step: 0.05, value: inst.getLegs(), 'aria-label': '腿长（本游戏）' });
      const put = (v) => { inst.setLegs(snap(v, 0.5, 1.2, 0.05)); UI.setVar(id, '@legs', inst.getLegs()); inp.value = inst.getLegs(); out.sync(inst.getLegs()); };
      const out = U.numField({ cls: 'ysm-fv', label: '腿长（本游戏）', pct: true, step: 0.05, format: (v) => Math.round(v * 100) + '%',
        edit: (v) => String(Math.round(v * 100)), get: () => inst.getLegs(), set: put });
      inp.addEventListener('input', () => put(+inp.value));
      box.append(U.el('div', { class: 'ysm-f', title: '本游戏加的：腿沿自身长度缩短，脚还踩在地上，身高不变；100% = 作者原样' }, U.el('span', null, '腿长（本游戏）'), inp, out.el));
    }
    if (inst.canEyeGlow) {                           // 我们自己加的：眼睛要不要按作者原样全亮（默认不亮，跟着场景光照）
      const inp = U.el('input', { type: 'checkbox', checked: inst.getEyeGlow() });
      const tip = '本游戏加的：不勾 = 眼睛和脸一起受光，阴天、夜里不会像灯一样亮；勾上 = 按模型作者原样全亮';
      inp.addEventListener('change', () => { inst.setEyeGlow(inp.checked); UI.setVar(id, '@eyeGlow', inst.getEyeGlow()); });
      box.append(U.el('label', { class: 'ysm-f ysm-fc', title: tip }, inp, U.el('span', null, '眼睛发光（本游戏）'), U.el('small', null, '默认关：眼睛跟着昼夜变暗')));
    }
    for (const f of forms) {
      const val = () => inst.getVar(f.key), save = () => UI.setVar(id, f.key, val());
      const tip = f.desc && f.desc !== f.title ? f.desc : '';
      const parent = holder[f.group] || box;
      if (f.type === 'range') {
        const inp = U.el('input', { type: 'range', min: f.min, max: f.max, step: f.step, value: val(), 'aria-label': f.title });
        const dec = String(f.step).includes('.') ? String(f.step).split('.')[1].length : 0;
        const out = U.numField({ cls: 'ysm-fv', label: f.title, step: +f.step || 1, format: (v) => (+v).toFixed(dec), edit: (v) => String(+(+v).toFixed(dec)),
          get: val, set: (v) => { inst.setVar(f.key, snap(v, +f.min, +f.max, +f.step || 0)); save(); sync(); } });
        refresh.push(() => { inp.value = val(); out.sync(val()); });
        inp.addEventListener('input', () => { inst.setVar(f.key, +inp.value); save(); sync(); });
        parent.append(U.el('div', { class: 'ysm-f', title: tip }, U.el('span', null, f.title), inp, out.el));
      } else if (f.type === 'checkbox') {
        const inp = U.el('input', { type: 'checkbox', checked: !!val() });
        refresh.push(() => { inp.checked = !!val(); });
        inp.addEventListener('change', () => { inst.setVar(f.key, inp.checked ? 1 : 0); save(); sync(); });
        parent.append(U.el('label', { class: 'ysm-f ysm-fc', title: tip }, inp, U.el('span', null, f.title), tip ? U.el('small', null, tip) : null));
      } else if (f.type === 'radio') {
        const row = U.el('div', { class: 'ysm-fr' });
        // 哪个选中：选项那句 Molang 给本变量赋的值（formsOf 解析好的 vals）；解析不出来才按第几个
        const on = (i) => { const x = f.vals && f.vals[i]; return x != null ? Math.abs(val() - x) < 1e-6 : Math.round(val()) === i; };
        const draw = () => row.replaceChildren(...f.labels.map(([label, stmt], i) => U.el('button', {
          class: 'ysm-btn' + (on(i) ? ' pri' : ''), type: 'button',
          onclick: () => { inst.runStmt(stmt); save(); for (const k of assigned(stmt)) UI.setVar(id, k, inst.getVar(k)); sync(); } }, label)));
        refresh.push(draw);
        draw();
        parent.append(U.el('div', { class: 'ysm-f', title: tip }, U.el('span', null, f.title), row));
      }
    }
    for (const g of groups) if (holder[g]) box.append(holder[g].parentNode);
    return box;
  };

  // ---- 游戏：用哪个角色（V3.actor.useBody）----
  let applying = 0;
  async function applyChoice(force) {
    const A = V3.actor;
    if (!A || !A.useBody) return;
    const id = UI.choice(), my = ++applying;
    if (A.bodyId === id && !force) return;
    try {
      const model = await UI.model(id);
      if (my !== applying || !V3.actor) return;
      V3.actor.useBody(id, builderOf(id, model));
      V3.emit('ysm:body', id);
    } catch (e) {
      const back = UI.defaultId();
      toast('这个角色用不了，先换回小鲸鱼：' + ((e && e.message) || e), true);
      if (id !== back) UI.choose(back);
    }
  }
  V3.on('girl:model', () => applyChoice(false));
  V3.on('actor:ready', () => applyChoice(false));   // 场景里已经按 initialBody 建好时什么都不做
  let heightT = 0;                                  // 拖身高滑条：停手 0.25 秒后再重建一次（每次重建约 45 ms）
  V3.on('game:settings', (ev) => {
    if (!ev || ev.key !== 'girlHeight') return;
    clearTimeout(heightT); heightT = setTimeout(() => applyChoice(true), 250);
  });

  // ---- 游戏页设置：「角色」页（60-game 在本文件之后加载：等 init 再加；G.start 读存档在 init 之后）----
  V3.on('init', () => {
  const G = V3.game;
  if (G && G.SCHEMA && !G.SCHEMA.some(f => f.key === 'girlModel')) {
    G.SCHEMA.push(
      { key: 'girlModel', label: '角色', type: 'custom', group: '角色', render: () => settingsRow() },
      { key: 'girlHeight', label: '身高', type: 'range', min: 0.8, max: 2.0, step: 0.02, unit: '米', group: '角色', def: 1.26,
        hint: '调整 YSM 角色的身高（门高 2 米）' },
      { key: 'girlSound', label: '角色音效', type: 'toggle', group: '角色', def: true, hint: '模型自带的音效' });
    if (G.S && G.S.girlHeight == null) G.S.girlHeight = 1.26;
    if (G.S && G.S.girlSound == null) G.S.girlSound = true;   // 新存档：开关要显示「开」
  }
  });
  function settingsRow() {
    const box = U.el('div', { class: 'ysm-set' });
    const draw = async () => {
      const list = await UI.list(), cur = UI.choice();
      const forms = V3.actor && V3.actor.bodyId === cur && UI.formsEl(V3.actor.inst, cur);
      const item = (id, name, sub, del) => U.el('label', { class: 'ysm-item' + (cur === id ? ' on' : '') },
        U.el('input', { type: 'radio', name: 'ysm-girl', checked: cur === id, onchange: () => UI.choose(id) }),
        U.el('span', { class: 'ysm-item-t' }, U.el('b', null, name), sub ? U.el('small', null, sub) : null),
        del ? U.el('button', { class: 'ysm-x', type: 'button', title: '从浏览器里删掉', onclick: (e) => { e.preventDefault(); if (confirm('删除「' + name + '」？')) UI.del(id); } }, '删除') : null);
      box.replaceChildren(
        U.el('div', { class: 'ysm-list' },
          ...BUILTIN.filter(b => assetB64(b.asset)).map(b => item(b.id, b.name + '（自带）', b.sub)),
          ...list.map(m => item(m.id, m.name, [m.authors.length ? '作者 ' + m.authors.join('、') : '', UI.licenseText(m.license)].filter(Boolean).join(' · '), true))),
        U.el('div', { class: 'ysm-btnrow' },
          U.el('button', { class: 'ysm-btn pri', type: 'button', onclick: () => UI.pick(false, { use: true }) }, '导入 zip / .ysm'),
          U.el('button', { class: 'ysm-btn', type: 'button', onclick: () => UI.pick(true, { use: true }) }, '导入文件夹')),
        U.el('div', { class: 'ysm-note' }, '支持 YSM 不加密的模型（文件夹或 zip，里面有 ysm.json 或 main.json）。加密的 .ysm 只能看名字和作者。也可以直接把文件拖进窗口。'),
        ...(forms ? [forms] : []),
        U.el('div', { class: 'ysm-note ysm-credit' }, UI.CREDIT));
    };
    draw();
    V3.on('ysm:list', draw); V3.on('girl:model', draw); V3.on('ysm:body', draw);
    return box;
  }

  // ---- 工作台：模型「导入的 YSM 模型」+ 小面板 ----
  UI.studio = null;                                 // { id, model }
  const LABEL = 'YSM 模型（默认小鲸鱼 / 导入的）';
  const empty = () => ({ id: 'ysm', label: LABEL, root: new THREE.Group(), partRoot: '小鲸鱼', states: {},
    views: { front: { az: 0, el: 0.06, dist: 3.0, target: [0, 0.62, 0] } }, update() {}, dispose() {} });
  if (V3.models && V3.models.register) V3.models.register({ id: 'ysm', label: LABEL, build: () => {
    const S = UI.studio;
    if (!S) { setTimeout(studioDefault, 0); return empty(); }
    try { const inst = Y.build(S.model, { studio: true, height: 1.26, vars: UI.vars(S.id), tune: tuneOf(S.id, S.model), eyeGlow: eyeGlowOf(S.id) }); inst.label = S.model.meta.name || LABEL; return inst; }
    catch (e) { V3.err('ysm build: ' + ((e && e.stack) || e)); toast('这个模型建不出来：' + ((e && e.message) || e), true); return empty(); }
  } });
  async function studioShow(id) {
    try { UI.studio = { id, model: await UI.model(id) }; } catch (e) { toast((e && e.message) || String(e), true); return; }
    V3.models.show('ysm'); drawPanel();
  }
  let triedDefault = false;
  async function studioDefault() {                  // 第一次打开：先选自带的默认小鲸鱼，没有再选最近导入的那个
    if (triedDefault || UI.studio) return;
    triedDefault = true;
    const id = UI.defaultId();
    if (id && V3.models.current() && V3.models.current().id === 'ysm') studioShow(id);
  }
  let panel = null;
  async function drawPanel() {
    const cur = V3.models.current();
    if (!cur || cur.id !== 'ysm' || V3.PAGE !== 'studio') { if (panel) panel.style.display = 'none'; return; }
    if (!panel) { panel = U.el('div', { class: 'ysm-panel' }); document.body.append(panel); }
    panel.style.display = '';
    const builtins = BUILTIN.filter(b => assetB64(b.asset));
    const list = await UI.list(), S = UI.studio, rec = S && list.find(m => m.id === S.id), bi = S && builtins.find(b => b.id === S.id);
    const sel = U.el('select', { class: 'ysm-sel', onchange: () => studioShow(sel.value) },
      [...builtins.map(b => U.el('option', { value: b.id }, b.name + '（自带）')), ...list.map(m => U.el('option', { value: m.id }, m.name))]
        .concat(builtins.length || list.length ? [] : [U.el('option', { value: '' }, '（还没有导入）')]));
    if (S) sel.value = S.id;
    // 平时一行：选模型 + 导入 / 删除；「模型设置」点开才展开（展开状态记在 localStorage），免得挡住模型
    const forms = S && cur.forms && cur.forms.length ? UI.formsEl(cur, S.id) : null;
    let open = false; try { open = localStorage.getItem('v3.ysm.panelOpen') === '1'; } catch (e) { /* private mode */ }
    if (forms) forms.hidden = !open;
    const tog = forms ? U.el('button', { class: 'ysm-btn' + (open ? ' pri' : ''), type: 'button', onclick: () => {
      open = !open; forms.hidden = !open; tog.classList.toggle('pri', open); tog.textContent = open ? '模型设置 ▾' : '模型设置 ▸';
      try { localStorage.setItem('v3.ysm.panelOpen', open ? '1' : '0'); } catch (e) { /* private mode */ }
    } }, open ? '模型设置 ▾' : '模型设置 ▸') : null;
    panel.replaceChildren(
      U.el('div', { class: 'ysm-top' }, U.el('b', null, 'YSM 模型'), sel),
      U.el('div', { class: 'ysm-btnrow' },
        U.el('button', { class: 'ysm-btn pri', type: 'button', onclick: () => UI.pick(false, {}) }, '导入 zip / .ysm'),
        U.el('button', { class: 'ysm-btn', type: 'button', onclick: () => UI.pick(true, {}) }, '导入文件夹'),
        S && !bi ? U.el('button', { class: 'ysm-btn', type: 'button', onclick: () => { if (confirm('从浏览器里删掉「' + (rec ? rec.name : '') + '」？')) { UI.del(S.id); UI.studio = null; V3.models.show('ysm'); } } }, '删除') : null,
        tog),
      bi ? U.el('div', { class: 'ysm-note' }, bi.sub)
        : rec ? U.el('div', { class: 'ysm-note' }, [rec.authors.length ? '作者 ' + rec.authors.join('、') : '', UI.licenseText(rec.license), rec.layout === 'legacy' ? '旧版格式' : '新版格式'].filter(Boolean).join(' · '))
        : U.el('div', { class: 'ysm-note' }, '把模型的 zip / 文件夹 / .ysm 拖进窗口，或者点上面的按钮。'),
      ...(forms ? [forms] : []));
  }
  V3.on('model', () => setTimeout(drawPanel, 0));
  V3.on('ysm:list', () => setTimeout(drawPanel, 0));
  V3.on('ysm:imported', (rec) => { const c = V3.models.current(); if (V3.PAGE === 'studio' && c && c.id === 'ysm') studioShow(rec.id); });
})(window.V3);
