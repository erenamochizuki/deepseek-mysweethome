// 79-fb-2d.js — 工作台左边最上面的「3D 反馈 | 2D 反馈」切换。2D = 参考图标注页（tools/refkit/page，由 serve.mjs 在
// /2d/?p=<项目> 提供），放在一个盖住整个工作台的 iframe 里，左边一栏是切换和项目选择（refs/ 下的标注项目）。
// Only on the studio page with the feedback tool on. The 3D studio is never changed: the 2D layer just covers it, and
// while it is up the canvas stops drawing (R.render -> no-op) and the studio's key / drag-drop handlers get no events,
// so switching back shows everything exactly as it was. Mode + project are remembered in localStorage
// (v3.fb.mode, v3.fb.2d.project). Opened from file:// the 2D side only shows that it needs the server.
// Test hooks: __view token fb2d=<project> | fb2d (remembered project) | fb2d=0 (back to 3D); URL ?fb2d=<project>|1|0;
// V3.fb.d2 = { on, project, frame, open(p), close(), whenReady(), paused3d() }.
(function (V3) {
  'use strict';
  const U = V3.util, fb = V3.fb;
  if (V3.PAGE !== 'studio' || !fb || !fb.enabled) return;
  const FILE = location.protocol === 'file:';
  const LS_MODE = 'v3.fb.mode', LS_PROJ = 'v3.fb.2d.project';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage off or full */ } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NOTE = {
    file: '2D 反馈要开着本机服务才能用。\n双击项目文件夹里的「启动工作台.bat」，它会打开 http://127.0.0.1:5194/studio.html ，\n再点左上角的「2D 反馈」。',
    down: '连不上本机服务。\n黑窗口关掉了的话，重新双击「启动工作台.bat」，再点左边的「刷新」。',
    old: '正在运行的服务是旧版本，还没有 2D 反馈。\n关掉黑窗口，重新双击「启动工作台.bat」。',
    empty: '还没有标注项目。\n点左边的「新项目」建一个，再把参考图拖进来。',
    tab: '这个项目已经在新标签页里打开了。\n同一个项目只开一个页面，免得两边的回答互相覆盖。\n在那边答完、关掉那个标签页后，点左边的「刷新」回到这里。',
  };
  const D = fb.d2 = { on: false, project: null, projects: null, refsDir: 'refs', frame: null, layer: null };
  const switches = [];

  // ---- the switch: one in the 3D part-tree panel, one in the 2D side panel ----
  const makeSwitch = () => {
    const b3 = U.el('button', { type: 'button', class: 'fb-mode-b', title: '给 3D 模型的部位写反馈', onclick: () => setMode(false) }, '3D 反馈');
    const b2 = U.el('button', { type: 'button', class: 'fb-mode-b', title: '在参考图上框选、回答问题（参考图标注）', onclick: () => setMode(true) }, '2D 反馈');
    switches.push({ b3, b2 });
    syncSwitches();
    return U.el('div', { class: 'fb-mode', role: 'group', 'aria-label': '反馈方式' }, b3, b2);
  };
  function syncSwitches() {
    for (const s of switches) {
      s.b3.classList.toggle('on', !D.on); s.b2.classList.toggle('on', D.on);
      s.b3.setAttribute('aria-pressed', String(!D.on)); s.b2.setAttribute('aria-pressed', String(D.on));
    }
  }

  // ---- 2D layer (built the first time 2D is opened) ----
  const pageUrl = (p) => '/2d/?p=' + encodeURIComponent(p);
  const frameRK = () => { try { return D.frame && D.frame.contentWindow && D.frame.contentWindow.RK; } catch (e) { return null; } };
  const btn = (label, title, fn) => U.el('button', { type: 'button', class: 'fb2d-btn', title, onclick: fn }, label);
  const build = () => {
    if (D.layer) return;
    D.sel = U.el('select', { class: 'fb2d-in', title: '标注项目（refs/ 下的文件夹）', onchange: () => openProject(D.sel.value) });
    D.info = U.el('div', { class: 'fb2d-dim fb2d-info' });
    D.where = U.el('p', { class: 'fb2d-dim' });
    D.frame = U.el('iframe', { class: 'fb2d-frame', title: '2D 反馈：参考图标注', hidden: true });
    D.frame.addEventListener('load', focusFrame);
    D.note = U.el('div', { class: 'fb2d-note', hidden: true });
    D.layer = U.el('div', { class: 'fb2d' + (FILE ? ' fb2d-file' : ''), 'aria-hidden': 'true' },
      U.el('div', { class: 'fb2d-side' }, makeSwitch(),
        U.el('div', { class: 'fb2d-sec' },
          U.el('div', { class: 'fb2d-row' }, U.el('label', null, '项目'), D.sel), D.info,
          U.el('div', { class: 'fb2d-row' },
            btn('新项目', '在 refs/ 下新建一个标注项目', () => newProject()),
            btn('刷新', '重新读项目列表和标注页', () => reload()),
            btn('新标签页打开', '在新的浏览器标签页里单独打开这个项目（这里会先关掉它）', () => openInTab()))),
        U.el('div', { class: 'fb2d-sec fb2d-help' }, U.el('b', null, '怎么用'),
          U.el('ol', null,
            U.el('li', null, '把参考图拖进右边、Ctrl+V 粘贴，或点「上传」。'),
            U.el('li', null, '回答右边的问题，核对图上的框。改动会自动保存。'),
            U.el('li', null, '答完点「这轮答完了」，再回聊天说一声。')),
          U.el('p', null, '按键（先点一下右边）：← → 换图，1–7 改框的种类，Delete 删框，Esc 取消选中。'),
          D.where)),
      U.el('div', { class: 'fb2d-main' }, D.frame, D.note));
    document.body.append(D.layer);
  };
  const showNote = (text) => { D.note.textContent = text; D.note.hidden = false; D.frame.hidden = true; };
  const showFrame = () => { D.note.hidden = true; D.frame.hidden = false; };
  // only while 2D is shown: a hidden page holding the focus would swallow the studio's keys
  const focusFrame = () => { if (D.on && D.frame && !D.frame.hidden) try { D.frame.focus(); } catch (e) { /* ignore */ } };
  const setInfo = (text, err) => { D.info.textContent = text; D.info.classList.toggle('err', !!err); };
  const infoText = (p) => (p.round ? `第 ${p.round} 轮` : '还没有问题') + ` · ${p.images} 张图` + (p.drafts ? ` + ${p.drafts} 张草图` : '');

  // Before the iframe leaves a project, let its page save what is still pending (it autosaves 0.6 s after an edit).
  const flushFrame = async () => {
    const rk = frameRK();
    for (let i = 0; rk && rk.unsaved && rk.unsaved() && i < 30; i++) {
      try { await rk.flushNow(); } catch (e) { break; }
      await sleep(100);
    }
  };
  const fetchProjects = async () => {
    let r = null;
    try { r = await fetch('/api/ref', { cache: 'no-store' }); } catch (e) { /* server down */ }
    if (!r || (!r.ok && r.status !== 404)) { showNote(NOTE.down); setInfo(''); return null; }
    if (r.status === 404) { showNote(NOTE.old); setInfo(''); return null; }
    const j = await r.json().catch(() => ({}));
    D.projects = Array.isArray(j.projects) ? j.projects : [];
    D.refsDir = j.dir || 'refs';
    D.sel.replaceChildren(...D.projects.map((p) => U.el('option', { value: p.name }, p.name)));
    return D.projects;
  };
  const openProject = async (name, force) => {
    if (!name) return;
    D.project = name;
    lsSet(LS_PROJ, name);
    if (D.sel.value !== name) D.sel.value = name;
    const p = (D.projects || []).find((x) => x.name === name);
    setInfo(p ? infoText(p) : '');
    D.where.textContent = `回答存在 ${D.refsDir}/${name}/answers.json（自动保存）。`;
    showFrame();
    const url = pageUrl(name);
    if (D.frameUrl === url && !force) { focusFrame(); return; }
    await flushFrame();
    if (D.frameUrl === url && D.frame.contentWindow) { D.frame.contentWindow.location.reload(); return; }
    D.frameUrl = url;
    D.frame.src = url;
  };
  const load = async (want, force) => {
    if (FILE) { showNote(NOTE.file); return; }
    const list = await fetchProjects();
    if (!list) return;
    if (!list.length) { showNote(NOTE.empty); setInfo(''); D.where.textContent = ''; return; }
    const name = [want, D.project, lsGet(LS_PROJ)].find((n) => n && list.some((p) => p.name === n)) || list[0].name;
    await openProject(name, force);
  };
  const reload = () => load(D.project, true);
  // Two pages on one project overwrite each other's answers: save, open the tab, then unload the page here.
  const openInTab = async () => {
    if (!D.project || FILE) return;
    const rk = frameRK();
    if (rk && rk.unsaved && rk.unsaved()) await flushFrame();
    if (!window.open(pageUrl(D.project), '_blank')) { setInfo('浏览器拦住了新标签页，再点一次「新标签页打开」。', true); return; }
    D.frameUrl = null;
    D.frame.src = 'about:blank';
    showNote(NOTE.tab);
  };
  const newProject = async () => {
    const name = String(prompt('新项目叫什么？\n只用字母、数字、中文和 - _，比如：scene-02', '') || '').trim();
    if (!name) return;
    try {
      const r = await fetch('/api/ref', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    } catch (e) { setInfo('没建成：' + e.message, true); return; }
    await load(name);
  };

  // ---- 3D drawing pause while the 2D layer covers it ----
  let realRender = null;
  const NOOP = () => {};
  const pause3d = (on) => {
    const R = V3.R;
    if (!R) return;
    if (on && !realRender) { realRender = R.render; R.render = NOOP; }
    else if (!on && realRender) { if (R.render === NOOP) R.render = realRender; realRender = null; }
  };

  // ---- mode ----
  async function setMode(on, project) {
    if (on) {
      build();
      if (!D.on) {
        D.on = true;
        lsSet(LS_MODE, '2d');
        document.body.classList.add('fb2d-on');
        D.layer.setAttribute('aria-hidden', 'false');
        if (fb.clearHover) fb.clearHover();
        pause3d(true);
        syncSwitches();
      }
      await load(project || null);
      focusFrame();
      return;
    }
    if (!D.on) return;
    D.on = false;
    lsSet(LS_MODE, '3d');
    document.body.classList.remove('fb2d-on');
    D.layer.setAttribute('aria-hidden', 'true');
    pause3d(false);
    syncSwitches();
    // keys belong to the 3D studio again, not to the hidden page
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
    try { window.focus(); } catch (e) { /* ignore */ }
  }
  D.open = (project) => setMode(true, project);
  D.close = () => setMode(false);
  D.paused3d = () => !!realRender;
  /** Resolves true once the 2D page shows its project (and the current image), or the layer shows a note. */
  D.whenReady = async (ms = 20000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) {
      if (!D.on) return false;
      if (!D.note.hidden && D.note.textContent) return true;
      const rk = frameRK();
      if (rk && rk.st && rk.project === D.project && rk.A && (!rk.cur || (rk.V && rk.V.img))) return true;
    }
    return false;
  };

  // ---- while 2D is up: no key events for the studio's shortcuts; pasted / dropped images go to the 2D page ----
  // (key presses inside the iframe never reach this window anyway)
  for (const t of ['keydown', 'keyup', 'keypress']) addEventListener(t, (e) => { if (D.on) e.stopImmediatePropagation(); }, true);
  const toPage = (files) => { const rk = frameRK(); if (rk && rk.upload && files && files.length) rk.upload([...files]); };
  addEventListener('paste', (e) => {
    if (!D.on) return;
    const files = (e.clipboardData && e.clipboardData.files) || [];
    if (files.length) { e.preventDefault(); e.stopImmediatePropagation(); toPage(files); }
  }, true);
  for (const t of ['dragenter', 'dragover', 'dragleave', 'drop']) addEventListener(t, (e) => {
    if (!D.on) return;
    e.stopImmediatePropagation();   // e.g. the YSM model drop zone must not see them
    if (t === 'dragover' || t === 'drop') e.preventDefault();   // never let the browser open the file instead
    if (t === 'drop' && e.dataTransfer) toPage(e.dataTransfer.files);
  }, true);

  // ---- boot: the switch goes on top of the part tree (78-fb-tree builds it on 'init' first) ----
  V3.on('init', () => {
    const tree = fb.tree && fb.tree.el;
    if (!tree) return;
    tree.prepend(makeSwitch());
    const q = U.qs('fb2d', null);
    if (q === '0' || q === '3d') lsSet(LS_MODE, '3d');
    else if (q != null) setMode(true, q === '' || q === '1' ? null : q);
    else if (lsGet(LS_MODE) === '2d') setMode(true);
  });
  V3.viewTokens.fb2d = async (v) => {
    if (v === '0' || v === '3d') { await setMode(false); return; }
    await setMode(true, v && v !== '1' ? v : null);
    await D.whenReady();
  };
})(window.V3);
