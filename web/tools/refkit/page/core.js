/* tools/refkit/page/core.js — 2D 反馈（参考图标注）页: shared state (window.RK), answer model, autosave, polling,
   image list, upload / paste / drag-drop, keyboard. Load order: core, view, panel, extra; boot on DOMContentLoaded.
   Served at /2d/?p=<project> by serve.mjs (or tools/refkit/serve.mjs); every request goes to /api/ref/<project>/… */
(function () {
  'use strict';
  const RK = window.RK = { st: null, Q: {}, A: null, cur: null, sel: null, newKind: 'character' };
  const $ = RK.$ = (id) => document.getElementById(id);
  RK.project = new URLSearchParams(location.search).get('p') || '';
  RK.api = (s) => '/api/ref/' + encodeURIComponent(RK.project) + '/' + s;
  // server errors are {error}; show that text instead of the raw JSON
  RK.errText = async (r) => {
    const t = await r.text().catch(() => '');
    try { const j = JSON.parse(t); if (j && j.error) return j.error; } catch { /* plain text */ }
    return t || 'HTTP ' + r.status;
  };
  RK.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  RK.KINDS = [
    { k: 'character', label: '角色', color: '#ff5a7a' },
    { k: 'passerby', label: '路人', color: '#5ab0ff' },
    { k: 'object', label: '物件', color: '#ffd166' },
    { k: 'sign', label: '招牌/文字', color: '#b98cff' },
    { k: 'vehicle', label: '车辆', color: '#4fd1c5' },
    { k: 'other', label: '其他', color: '#c0c6d4' },
    { k: 'ignore', label: '忽略', color: '#6b7280' },
  ];
  RK.kind = (k) => RK.KINDS.find((x) => x.k === k) || null;
  RK.PALETTE = ['#ff5a7a', '#ff9f43', '#7bd88f', '#5ab0ff', '#c792ea', '#ffd166', '#4fd1c5', '#f78fb3', '#c3e88d', '#82aaff'];
  RK.FIELDS = [
    { k: 'scene', label: '场景', type: 'text', ph: '比如：雨夜便利店门口' },
    { k: 'where', label: '室内外', type: 'choice', options: ['室内', '室外', '室内外都有'] },
    { k: 'time', label: '时间', type: 'choice', options: ['白天', '傍晚', '夜晚'], other: true },
    { k: 'weather', label: '天气', type: 'choice', options: ['晴', '阴', '雨', '雪', '雾'], other: true },
  ];

  // ---------------------------------------------------------------- answer model
  RK.normAnswers = (a) => {
    const b = a && typeof a === 'object' && !Array.isArray(a) ? a : {};
    b.version = 1;
    b.submittedRound = b.submittedRound || 0;
    b.project = b.project || {};
    b.project.answers = b.project.answers || {};
    b.project.notes = Object.assign({ keep: '', free: '', avoid: '', motion: '' }, b.project.notes);
    b.images = b.images || {};
    b.characters = Array.isArray(b.characters) ? b.characters : [];
    b.pairs = b.pairs || {};
    b.things = Array.isArray(b.things) ? b.things : [];
    return b;
  };
  RK.qimg = (key) => (RK.Q.images && RK.Q.images[key]) || {};
  RK.aimg = (key) => {
    const im = RK.A.images[key] || (RK.A.images[key] = {});
    im.fields = im.fields || {};
    im.answers = im.answers || {};
    im.boxes = im.boxes || [];
    if (im.note == null) im.note = '';
    return im;
  };
  // Boxes shown for one image: agent boxes (adopted or not) followed by the user's own boxes.
  // Returns view copies; edit through RK.own().
  RK.boxes = (key, withRemoved) => {
    const a = RK.aimg(key), out = [], own = new Map(a.boxes.map((b) => [b.id, b]));
    const qbs = (RK.qimg(key).boxes || []).filter((b) => b && b.id), qids = new Set(qbs.map((b) => b.id));
    const view = (b, qb) => {
      const v = { id: b.id, src: qb ? 'agent' : 'user', x: +b.x, y: +b.y, w: +b.w, h: +b.h, kind: b.kind || null,
        character: b.character || null, thing: b.thing || null, notThing: Array.isArray(b.notThing) ? b.notThing : [],
        note: b.note || '', q: qb || null, removed: !!b.removed };
      v.pending = !v.removed && (!v.kind || (v.kind === 'character' && !v.character));
      return v;
    };
    for (const qb of qbs) { const v = view(own.get(qb.id) || qb, qb); if (withRemoved || !v.removed) out.push(v); }
    for (const b of a.boxes) if (!qids.has(b.id) && !b.removed) out.push(view(b, null));
    return out;
  };
  // The stored box; an agent box is copied into answers the first time it is touched.
  RK.own = (key, id) => {
    const a = RK.aimg(key);
    let b = a.boxes.find((x) => x.id === id);
    if (b) return b;
    const qb = (RK.qimg(key).boxes || []).find((x) => x && x.id === id);
    if (!qb) return null;
    b = { id: qb.id, src: 'agent', x: +qb.x, y: +qb.y, w: +qb.w, h: +qb.h, kind: null, character: null, note: '', removed: false };
    a.boxes.push(b);
    return b;
  };
  RK.addBox = (key, r) => {
    const a = RK.aimg(key);
    const n = Math.max(a.nextU || 0, ...a.boxes.filter((b) => /^u\d+$/.test(b.id)).map((b) => +b.id.slice(1))) + 1;
    a.nextU = n;
    const b = { id: 'u' + n, src: 'user', x: r.x, y: r.y, w: r.w, h: r.h, kind: RK.newKind, character: null, note: '', removed: false };
    a.boxes.push(b);
    return b;
  };
  RK.delBox = (key, id) => {
    if ((RK.qimg(key).boxes || []).some((x) => x && x.id === id)) RK.own(key, id).removed = true;
    else { const a = RK.aimg(key); a.boxes = a.boxes.filter((b) => b.id !== id); }
  };
  RK.setKind = (key, id, kind) => {
    const b = RK.own(key, id);
    if (!b) return;
    b.kind = kind;
    b.removed = false;
    if (kind !== 'character') b.character = null;
    if (!RK.canThing(kind)) b.thing = null;
    RK.changed();
  };
  RK.setChar = (key, id, cid) => {
    const b = RK.own(key, id);
    if (!b) return;
    if (cid && cid !== '?') RK.ownChar(cid);
    b.kind = 'character';
    b.character = cid || null;
    b.thing = null;
    RK.changed();
  };
  // Accept the agent's guess for a box (kind, and character if it guessed one).
  RK.confirmBox = (key, id) => {
    const qb = (RK.qimg(key).boxes || []).find((x) => x && x.id === id);
    const g = (qb && qb.guess) || {}, b = RK.own(key, id);
    if (!b) return;
    b.kind = g.kind || b.kind || 'other';
    b.removed = false;
    if (b.kind === 'character' && g.character) { b.character = g.character; RK.ownChar(g.character); }
    if (RK.canThing(b.kind) && g.thing && RK.thing(g.thing)) {
      RK.ownThing(g.thing);
      b.thing = g.thing;
      if (Array.isArray(b.notThing)) b.notThing = b.notThing.filter((t) => t !== g.thing);
    }
    RK.changed();
  };
  // Characters: the user's list plus agent proposals not yet adopted.
  RK.chars = () => {
    const out = RK.A.characters.slice(), seen = new Set(out.map((c) => c.id));
    for (const c of RK.Q.characters || []) {
      if (c && c.id && !seen.has(c.id)) { out.push({ id: c.id, name: c.name || c.id, note: c.note || '', src: 'agent', proposed: true }); seen.add(c.id); }
    }
    out.forEach((c, i) => { if (!c.color) c.color = RK.PALETTE[i % RK.PALETTE.length]; });
    return out;
  };
  RK.char = (id) => RK.chars().find((c) => c.id === id) || null;
  RK.ownChar = (id) => {
    let c = RK.A.characters.find((x) => x.id === id);
    if (c) return c;
    const p = RK.char(id);
    if (!p) return null;
    c = { id: p.id, name: p.name, note: p.note, color: p.color, src: 'agent' };
    RK.A.characters.push(c);
    return c;
  };
  RK.newChar = (name) => {
    const all = RK.chars(), ids = new Set(all.map((c) => c.id));
    let n = 1;
    while (ids.has('uc' + n)) n++;
    const c = { id: 'uc' + n, name: name || '角色' + (all.length + 1), note: '', color: RK.PALETTE[all.length % RK.PALETTE.length], src: 'user' };
    RK.A.characters.push(c);
    return c;
  };
  // Things: one object or place seen in several images (a door, a window, a transformer). A box joins a thing
  // through box.thing. The agent proposes members in questions.json things[].boxes ("images/x.png#u3"); the
  // user confirms each one (sets box.thing) or rejects it (adds the thing id to box.notThing).
  RK.THING_KINDS = ['object', 'sign', 'vehicle', 'other'];
  RK.canThing = (kind) => RK.THING_KINDS.includes(kind);
  RK.things = () => {
    const out = RK.A.things.slice(), seen = new Set(out.map((t) => t.id));
    for (const t of RK.Q.things || []) {
      if (t && t.id && !seen.has(t.id)) { out.push({ id: t.id, name: t.name || t.id, note: t.note || '', src: 'agent', proposed: true }); seen.add(t.id); }
    }
    out.forEach((t, i) => { if (!t.color) t.color = RK.PALETTE[(i + 3) % RK.PALETTE.length]; });
    return out;
  };
  RK.thing = (id) => RK.things().find((t) => t.id === id) || null;
  RK.ownThing = (id) => {
    let t = RK.A.things.find((x) => x.id === id);
    if (t) return t;
    const p = RK.thing(id);
    if (!p) return null;
    t = { id: p.id, name: p.name, note: p.note, color: p.color, src: 'agent' };
    RK.A.things.push(t);
    return t;
  };
  RK.newThing = (name) => {
    const all = RK.things(), ids = new Set(all.map((t) => t.id));
    let n = 1;
    while (ids.has('ut' + n)) n++;
    const t = { id: 'ut' + n, name: name || '东西' + (all.length + 1), note: '', color: RK.PALETTE[(all.length + 3) % RK.PALETTE.length], src: 'user' };
    RK.A.things.push(t);
    return t;
  };
  RK.parseRef = (ref) => {
    const s = String(ref || ''), i = s.lastIndexOf('#');
    return i > 0 ? { key: s.slice(0, i), id: s.slice(i + 1) } : null;
  };
  // One proposed member: confirmed / rejected / pending, or gone (the image or the box is no longer there).
  RK.refState = (tid, ref) => {
    const r = RK.parseRef(ref), b = r && RK.info(r.key) && RK.boxes(r.key).find((x) => x.id === r.id);
    if (!b) return { state: 'gone', ref };
    const state = b.thing === tid ? 'confirmed' : b.notThing.includes(tid) ? 'rejected' : 'pending';
    return { state, key: r.key, b, ref };
  };
  // Pending proposals, optionally only those on one image (and one box).
  RK.thingProposals = (key, id) => {
    const out = [];
    for (const t of RK.Q.things || []) {
      if (!t || !t.id || !Array.isArray(t.boxes)) continue;
      for (const ref of t.boxes) {
        const r = RK.parseRef(ref);
        if (!r || (key && r.key !== key) || (id && r.id !== id)) continue;
        const s = RK.refState(t.id, ref);
        if (s.state === 'pending') out.push(Object.assign(s, { thing: t.id }));
      }
    }
    return out;
  };
  RK.setThing = (key, id, tid) => {
    const b = RK.own(key, id);
    if (!b) return;
    if (tid) {
      RK.ownThing(tid);
      if (!RK.canThing(b.kind)) {
        const qb = (RK.qimg(key).boxes || []).find((x) => x && x.id === id), gk = qb && qb.guess && qb.guess.kind;
        b.kind = RK.canThing(gk) ? gk : 'object';
        b.character = null;
      }
      b.removed = false;
      if (Array.isArray(b.notThing)) b.notThing = b.notThing.filter((t) => t !== tid);
    }
    const old = b.thing;
    if (old && old !== tid) { // moving a box off a thing also answers "no" for that thing
      b.notThing = Array.isArray(b.notThing) ? b.notThing : [];
      if (!b.notThing.includes(old)) b.notThing.push(old);
    }
    b.thing = tid || null;
    RK.changed();
  };
  // 「不是」: remember the answer so the same proposal is not asked again.
  RK.rejectThing = (key, id, tid) => {
    const b = RK.own(key, id);
    if (!b) return;
    b.notThing = Array.isArray(b.notThing) ? b.notThing : [];
    if (!b.notThing.includes(tid)) b.notThing.push(tid);
    if (b.thing === tid) b.thing = null;
    RK.changed();
  };
  RK.answered = (a) => !!a && ((Array.isArray(a.v) ? a.v.length > 0 : a.v != null && String(a.v).trim() !== '') ||
    !!(a.otherText && String(a.otherText).trim()));
  RK.filled = (v) => v != null && String(v).trim() !== '';
  RK.hasQ = (key) => !!(RK.Q.images && RK.Q.images[key]);
  // Unanswered items of one image: agent questions, unconfirmed field guesses, unconfirmed boxes.
  RK.todo = (key) => {
    const q = RK.qimg(key), a = RK.aimg(key);
    if (a.fields.skip) return 0;
    let n = 0;
    for (const qq of q.questions || []) if (qq && qq.id && !RK.answered(a.answers[qq.id])) n++;
    for (const k of Object.keys(q.fields || {})) if (!RK.filled(a.fields[k])) n++;
    for (const b of RK.boxes(key)) if (b.pending) n++;
    n += RK.thingProposals(key).length;
    return n;
  };
  RK.todoGlobal = () => {
    let n = 0;
    for (const q of RK.Q.project || []) if (q && q.id && !RK.answered(RK.A.project.answers[q.id])) n++;
    for (const p of RK.Q.pairs || []) if (p && p.id && !RK.answered(RK.A.pairs[p.id])) n++;
    return n;
  };

  // ---------------------------------------------------------------- saving
  let timer = 0, saving = false, again = false, ver = 0, savedVer = 0;
  RK.setSave = (msg, err) => { const s = $('save'); s.textContent = msg; s.style.color = err ? '#ff8a8a' : ''; };
  RK.save = (now) => {
    ver++;
    clearTimeout(timer);
    RK.setSave('未保存…');
    timer = setTimeout(flush, now ? 0 : 600);
  };
  RK.unsaved = () => ver !== savedVer;
  async function flush() {
    if (saving) { again = true; return; }
    saving = true;
    const v = ver;
    try {
      RK.A.savedAt = new Date().toISOString();
      const r = await fetch(RK.api('answers'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(RK.A) });
      if (!r.ok) throw new Error(await RK.errText(r));
      savedVer = v;
      if (!RK.unsaved()) RK.setSave('已保存 ' + new Date().toLocaleTimeString());
    } catch (e) {
      RK.setSave('保存失败：' + e.message + '（3 秒后重试）', true);
      setTimeout(() => { if (RK.unsaved()) flush(); }, 3000);
    }
    saving = false;
    if (again) { again = false; flush(); }
  }
  RK.flushNow = flush;
  window.addEventListener('beforeunload', (e) => { if (RK.unsaved()) { flush(); e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && RK.unsaved()) flush(); });

  // Call after any edit. soft: the edit came from a text field, so do not rebuild the panel.
  RK.changed = (soft) => {
    RK.save();
    if (RK.cur) RK.scheduleExport(RK.cur);
    RK.refreshCounts();
    if (!soft) RK.renderPanel();
    RK.draw();
  };

  // ---------------------------------------------------------------- loading and polling
  let sig = '';
  RK.info = (key) => RK.st.images.find((i) => i.key === key) || null;
  RK.imgUrl = (i) => RK.api(`img/${i.group}/${encodeURIComponent(i.name)}?v=${i.mtime}`);
  RK.typing = () => { const a = document.activeElement; return !!a && $('panel').contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName); };
  // questions.json is hand-written by the agent: coerce every list and map so a slip cannot break the page.
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  RK.normQ = (raw) => {
    const q = Object.assign({}, obj(raw));
    q.project = arr(q.project);
    q.characters = arr(q.characters);
    q.pairs = arr(q.pairs);
    q.things = arr(q.things);
    const ims = {};
    for (const [k, v] of Object.entries(obj(q.images))) {
      ims[k] = Object.assign({}, obj(v), { questions: arr(obj(v).questions), boxes: arr(obj(v).boxes), fields: obj(obj(v).fields) });
    }
    q.images = ims;
    return q;
  };
  RK.reload = async (first) => {
    const r = await fetch(RK.api('state'), { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error(await RK.errText(r)), { status: r.status });
    const st = await r.json();
    RK.st = st;
    sig = st.sig;
    RK.Q = RK.normQ(st.questions);
    if (first) RK.A = RK.normAnswers(st.answers);
    $('proj').textContent = st.project;
    document.title = st.project + ' · 参考图标注';
    $('round').textContent = RK.Q.round ? '第 ' + RK.Q.round + ' 轮' : '';
    RK.renderBanner();
    RK.renderList();
    const keys = st.images.map((i) => i.key);
    if (RK.cur && keys.includes(RK.cur)) {
      RK.showImage(RK.cur, true);
      if (RK.typing()) RK.panelStale = true; else RK.renderPanel();
      RK.refreshCounts();
    } else {
      const h = decodeURIComponent(location.hash.slice(1));
      const k = keys.includes(h) ? h : keys[0];
      if (k) RK.select(k); else RK.showEmpty();
    }
  };
  RK.poll = async () => {
    try {
      const r = await fetch(RK.api('meta'), { cache: 'no-store' });
      if (!r.ok) throw new Error(await RK.errText(r));
      const m = await r.json();
      if (m.sig !== sig) {
        const r0 = RK.Q.round;
        await RK.reload(false);
        if (RK.Q.round && RK.Q.round !== r0) RK.toast('有新问题了（第 ' + RK.Q.round + ' 轮）');
      }
    } catch { RK.setSave('连不上服务，改动先留在页面里', true); }
  };
  RK.renderBanner = () => {
    const b = $('banner'), st = RK.st;
    let html = '', err = false;
    if (st.questionsError) { html = 'questions.json 读不出来：' + RK.esc(st.questionsError); err = true; }
    else if (st.answersError) { html = 'answers.json 读不出来，已从空白开始；原文件会在第一次保存前备份为 answers.bak.json。' + RK.esc(st.answersError); err = true; }
    else if (RK.Q.intro) html = RK.esc(RK.Q.intro);
    b.hidden = !html;
    b.innerHTML = html;
    b.classList.toggle('err', err);
  };

  // ---------------------------------------------------------------- image list
  RK.renderList = () => {
    const L = $('list');
    let h = '';
    for (const [g, title] of [['images', '参考图'], ['drafts', '我的草图']]) {
      const items = RK.st.images.filter((i) => i.group === g);
      if (!items.length && g === 'drafts') continue;
      h += `<h4>${title}（${items.length}）</h4>`;
      for (const i of items) {
        h += `<div class="thumb" data-key="${RK.esc(i.key)}"><img loading="lazy" src="${RK.imgUrl(i)}" alt="">` +
          `<div class="nm">${RK.esc(i.name)}</div><span class="badge"></span>` +
          (g === 'images' ? '<button class="del" title="删除这张图">×</button>' : '') + '</div>';
      }
    }
    h += '<div class="dropzone" id="dz">把截图拖进来、Ctrl+V 粘贴，或点这里上传</div>';
    L.innerHTML = h;
    L.querySelectorAll('.thumb').forEach((t) => { t.onclick = () => RK.select(t.dataset.key); });
    L.querySelectorAll('.thumb .del').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); RK.delImage(b.closest('.thumb').dataset.key); };
    });
    $('dz').onclick = () => $('file').click();
  };
  RK.refreshCounts = () => {
    let total = 0;
    document.querySelectorAll('#list .thumb').forEach((t) => {
      const k = t.dataset.key, n = RK.todo(k), b = t.querySelector('.badge');
      total += n;
      b.textContent = n ? String(n) : '✓';
      b.hidden = !n && !RK.hasQ(k);
      b.classList.toggle('done', !n);
      t.classList.toggle('cur', k === RK.cur);
      t.classList.toggle('skip', !!RK.aimg(k).fields.skip);
    });
    total += RK.todoGlobal();
    const asked = Object.keys(RK.Q.images || {}).length + (RK.Q.project || []).length + (RK.Q.pairs || []).length + (RK.Q.things || []).length;
    const p = $('progress');
    p.textContent = !asked ? '还没有问题' : total ? '还有 ' + total + ' 条没答' : '都答完了';
    p.className = !asked ? 'muted' : total ? 'left' : 'done';
  };
  RK.select = (key) => {
    RK.cur = key;
    RK.sel = null;
    $('empty').hidden = true;
    RK.showImage(key);
    RK.renderPanel();
    RK.refreshCounts();
    const t = document.querySelector(`#list .thumb[data-key="${CSS.escape(key)}"]`);
    if (t) t.scrollIntoView({ block: 'nearest' });
    history.replaceState(null, '', '#' + encodeURIComponent(key));
  };
  RK.step = (d) => {
    const ks = RK.st.images.map((i) => i.key), i = ks.indexOf(RK.cur);
    if (i >= 0 && ks[i + d]) RK.select(ks[i + d]);
  };
  RK.showEmpty = () => {
    RK.cur = null;
    RK.sel = null;
    const e = $('empty');
    e.hidden = false;
    e.textContent = '还没有图片。\n把截图拖进这里、直接 Ctrl+V 粘贴，或点右上角的「上传」。\n传完回聊天告诉我一声。';
    RK.showImage(null);
    RK.renderPanel();
    RK.refreshCounts();
  };

  // ---------------------------------------------------------------- upload, paste, drag and drop
  const OKTYPE = /^image\/(png|jpeg|webp|gif|bmp|avif)$/;
  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  RK.upload = async (files) => {
    if (!RK.st) { RK.toast('先选一个项目'); return; }
    const list = [...files].filter((f) => OKTYPE.test(f.type));
    if (!list.length) { RK.toast('只能上传 png / jpg / webp / gif / bmp / avif 图片'); return; }
    let last = null, n = 0;
    for (const f of list) {
      RK.toast(`上传中 ${++n}/${list.length}…`);
      const name = f.name && f.name !== 'image.png' ? f.name : `paste-${stamp()}.${f.type.split('/')[1]}`;
      try {
        const r = await fetch(RK.api('upload?name=' + encodeURIComponent(name)), { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
        if (!r.ok) throw new Error(await RK.errText(r));
        last = (await r.json()).key;
      } catch (e) { RK.toast('上传失败：' + e.message); return; }
    }
    await RK.reload(false);
    if (last) RK.select(last);
    RK.toast(`已上传 ${list.length} 张`);
  };
  // The server moves the file to trash/; its labels stay in answers.json under the old key, so moving
  // the file back to images/ restores it. Only uploaded images can be deleted, not the agent's drafts.
  RK.delImage = async (key) => {
    const i = RK.info(key);
    if (!i || i.group !== 'images') return;
    if (!confirm(`删除「${i.name}」？\n图片会移到项目的 trash 文件夹，标注会保留，放回 images 就能恢复。`)) return;
    RK.cancelExport(key);
    try {
      const r = await fetch(RK.api('delete?key=' + encodeURIComponent(key)), { method: 'POST' });
      if (!r.ok) throw new Error(await RK.errText(r));
    } catch (e) { RK.toast('删除失败：' + e.message); return; }
    if (RK.cur === key) {
      const ks = RK.st.images.map((x) => x.key), idx = ks.indexOf(key), rest = ks.filter((k) => k !== key);
      const next = rest[Math.min(idx, rest.length - 1)] || '';
      RK.cur = null;
      RK.sel = null;
      history.replaceState(null, '', location.pathname + location.search + (next ? '#' + encodeURIComponent(next) : ''));
    }
    await RK.reload(false);
    RK.toast('已删除（在 trash 文件夹里，可以找回）');
  };
  document.addEventListener('paste', (e) => {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (files.length) { e.preventDefault(); RK.upload(files); }
  });
  let dragN = 0;
  const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragN++; $('drop').hidden = false; } });
  window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('drop').hidden = true; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragN = 0;
    $('drop').hidden = true;
    RK.upload(e.dataTransfer.files);
  });

  // ---------------------------------------------------------------- keyboard, toast, boot
  document.addEventListener('keydown', (e) => {
    if (!RK.st || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (!$('overlay').hidden) { if (e.key === 'Escape') RK.closeOverlay(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { RK.step(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { RK.step(-1); e.preventDefault(); }
    else if (e.key === 'Escape') { RK.sel = null; RK.renderPanel(); RK.draw(); }
    else if (RK.sel && RK.cur && (e.key === 'Delete' || e.key === 'Backspace')) { RK.delBox(RK.cur, RK.sel); RK.sel = null; RK.changed(); }
    else if (RK.sel && RK.cur && /^[1-7]$/.test(e.key)) RK.setKind(RK.cur, RK.sel, RK.KINDS[+e.key - 1].k);
  });
  RK.toast = (msg) => {
    let t = $('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#2b3550;border:1px solid #4f8cff;padding:8px 16px;border-radius:8px;z-index:20';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(RK.toastT);
    RK.toastT = setTimeout(() => { t.hidden = true; }, 3000);
  };
  document.addEventListener('DOMContentLoaded', async () => {
    $('btnUpload').onclick = () => $('file').click();
    $('file').onchange = (e) => { RK.upload(e.target.files); e.target.value = ''; };
    $('btnChars').onclick = () => RK.openChars();
    $('btnThings').onclick = () => RK.openThings();
    $('btnProject').onclick = () => RK.openProject();
    $('btnDone').onclick = () => RK.done();
    $('ovClose').onclick = () => RK.closeOverlay();
    $('btnFit').onclick = () => RK.fit();
    const nk = $('newKind');
    nk.innerHTML = RK.KINDS.map((k) => `<option value="${k.k}">${k.label}</option>`).join('');
    nk.value = RK.newKind;
    nk.onchange = () => { RK.newKind = nk.value; };
    $('panel').addEventListener('focusout', () => { if (RK.panelStale) { RK.panelStale = false; setTimeout(RK.renderPanel, 0); } });
    if (!RK.project) { RK.chooser(''); return; }
    for (;;) {
      try { await RK.reload(true); break; } catch (e) {
        if (e.status === 404 || e.status === 400) { RK.chooser('找不到项目「' + RK.project + '」。'); return; }
        const b = $('banner');
        b.hidden = false;
        b.className = 'err';
        b.textContent = '连不上本机服务，3 秒后重试（黑窗口关了的话，重新双击「启动工作台.bat」）：' + e.message;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    setInterval(RK.poll, 3000);
  });
  // Opened without ?p=<project> (or with an unknown one): list the projects in refs/ to pick from.
  RK.chooser = async (msg) => {
    for (const id of ['btnUpload', 'btnChars', 'btnThings', 'btnProject', 'btnDone', 'stagebar']) $(id).hidden = true;
    $('proj').textContent = '2D 反馈';
    const e = $('empty');
    e.hidden = false;
    e.textContent = msg + '读取项目列表…';
    let list = null;
    try { const r = await fetch('/api/ref', { cache: 'no-store' }); if (r.ok) list = (await r.json()).projects || []; } catch { /* offline */ }
    const box = document.createElement('div');
    box.className = 'projlist';
    const line = (t, cls) => { const d = document.createElement('div'); d.textContent = t; if (cls) d.className = cls; box.append(d); };
    if (msg) line(msg, 'warn');
    if (!list) line('连不上本机服务。双击「启动工作台.bat」，再刷新这一页。');
    else if (!list.length) line('还没有标注项目。在工作台左上角切到「2D 反馈」，点「新项目」建一个。');
    else {
      line('选一个项目：');
      for (const p of list) {
        const a = document.createElement('a');
        a.href = '?p=' + encodeURIComponent(p.name);
        a.textContent = p.name;
        const s = document.createElement('span');
        s.className = 'muted';
        s.textContent = (p.round ? '  第 ' + p.round + ' 轮' : '  还没有问题') + ' · ' + p.images + ' 张图' + (p.drafts ? ' + ' + p.drafts + ' 张草图' : '');
        const row = document.createElement('div');
        row.append(a, s);
        box.append(row);
      }
    }
    e.replaceChildren(box);
  };
})();
