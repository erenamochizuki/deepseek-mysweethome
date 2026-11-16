/* tools/refkit/page/extra.js — overlays: the character sheet (identity across images, "same person?" pairs), the things
   sheet (one object or place seen in several images),
   project questions and notes, and "这轮答完了". */
(function () {
  'use strict';
  const RK = window.RK, $ = RK.$, el = RK.el;
  RK.ovRender = null;
  RK.openOverlay = (fn) => { RK.ovRender = fn; $('overlay').hidden = false; render(); };
  RK.closeOverlay = () => { $('overlay').hidden = true; RK.ovRender = null; $('ovBody').replaceChildren(); };
  function render() {
    if (!RK.ovRender) return;
    const sh = $('sheet'), top = sh.scrollTop;
    $('ovBody').replaceChildren(RK.ovRender());
    sh.scrollTop = top;
  }
  // Keep an open overlay in step with edits and with new questions from the agent.
  const baseChanged = RK.changed;
  RK.changed = (soft) => { baseChanged(soft); if (!soft && !$('overlay').hidden) render(); };
  const baseReload = RK.reload;
  RK.reload = async (first) => { await baseReload(first); if (!$('overlay').hidden && !$('sheet').contains(document.activeElement)) render(); };
  $('overlay').addEventListener('mousedown', (e) => { if (e.target.id === 'overlay') RK.closeOverlay(); });

  const short = (key) => key.replace(/^images\//, '');
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  function cropEl(key, b, label, size, extra) {
    const ph = el('div', { style: `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center` }, '…');
    const holder = el('div', { class: 'crop', title: '点一下跳到这张图', onclick: () => RK.focusBox(key, b.id) }, ph, el('div', {}, label), extra);
    RK.crop(key, b, size, size).then((c) => ph.replaceWith(c)).catch(() => { ph.textContent = '加载失败'; });
    return holder;
  }
  function findRef(ref) {
    const s = String(ref || ''), i = s.lastIndexOf('#');
    if (i < 0 || !RK.info(s.slice(0, i))) return null;
    const key = s.slice(0, i), b = RK.boxes(key, true).find((x) => x.id === s.slice(i + 1));
    return b ? { key, b } : null;
  }
  const cropSec = (title, items) => el('div', { class: 'sec' }, el('h3', {}, title),
    el('div', { class: 'crops' }, items.map((it) => cropEl(it.key, it.b, short(it.key) + ' ' + it.b.id, 140))));
  function delChar(id) {
    if (!confirm('删除这个角色？指定成它的框会变回「没指定是谁」。')) return;
    RK.A.characters = RK.A.characters.filter((c) => c.id !== id);
    for (const im of Object.values(RK.A.images)) for (const b of im.boxes || []) if (b.character === id) b.character = null;
    RK.changed();
  }

  RK.openChars = () => RK.openOverlay(() => {
    const root = el('div', {}, el('h2', { style: 'margin-top:0' }, '角色'),
      el('p', { class: 'muted' }, '不同图里指定成同一个角色，就表示是同一个人。点截图会跳到那张图，在那里改。'));
    const pairs = (RK.Q.pairs || []).filter((p) => p && p.id);
    if (pairs.length) {
      const s = el('div', { class: 'sec' }, el('h3', {}, '这两个是同一个人吗？'));
      for (const p of pairs) {
        const A = findRef(p.a), B = findRef(p.b);
        const crops = el('div', { class: 'pair', style: 'margin-bottom:6px' },
          A ? cropEl(A.key, A.b, short(A.key) + ' ' + A.b.id, 200) : el('div', { class: 'muted' }, '找不到 ' + p.a),
          B ? cropEl(B.key, B.b, short(B.key) + ' ' + B.b.id, 200) : el('div', { class: 'muted' }, '找不到 ' + p.b));
        const card = RK.qCard({ id: p.id, text: p.ask || '这两个是同一个人吗？', type: 'yesno', guess: p.guess }, RK.A.pairs[p.id],
          (v, soft) => { RK.A.pairs[p.id] = v; RK.changed(soft); });
        card.insertBefore(crops, card.children[1]);
        s.append(card);
      }
      root.append(s);
    }
    const groups = new Map(), unknown = [], unassigned = [];
    for (const i of RK.st.images) {
      for (const b of RK.boxes(i.key)) {
        const g = b.q && b.q.guess, guessChar = b.pending && !b.kind && g && g.kind === 'character';
        if (b.kind === 'character' && b.character && b.character !== '?') push(groups, b.character, { key: i.key, b, guess: false });
        else if (b.kind === 'character' && b.character === '?') unknown.push({ key: i.key, b });
        else if (guessChar && g.character) push(groups, g.character, { key: i.key, b, guess: true });
        else if (b.kind === 'character' || guessChar) unassigned.push({ key: i.key, b });
      }
    }
    for (const c of RK.chars()) {
      const items = groups.get(c.id) || [];
      const name = el('input', { type: 'text', value: c.name, style: 'width:200px' });
      name.oninput = () => { RK.ownChar(c.id).name = name.value; RK.changed(true); };
      const col = el('input', { type: 'color', value: c.color, style: 'width:36px;height:28px;padding:0' });
      col.onchange = () => { RK.ownChar(c.id).color = col.value; RK.changed(); };
      const note = el('input', { type: 'text', value: c.note || '', placeholder: '特征（可选），比如：短发、红伞、总在柜台后面' });
      note.oninput = () => { RK.ownChar(c.id).note = note.value; RK.changed(true); };
      const n = new Set(items.filter((x) => !x.guess).map((x) => x.key)).size;
      const head = el('div', { class: 'row' }, col, name,
        el('span', { class: 'muted grow' }, `出现在 ${n} 张图` + (c.proposed ? '（名字是我起的，可以改）' : '')),
        c.src === 'user' ? el('button', { class: 'small', onclick: () => delChar(c.id) }, '删除') : null);
      const crops = el('div', { class: 'crops' });
      for (const it of items) {
        const ok = it.guess ? el('button', { class: 'small', onclick: (e) => { e.stopPropagation(); RK.confirmBox(it.key, it.b.id); } }, '对，是 ta') : null;
        crops.append(cropEl(it.key, it.b, short(it.key) + ' ' + it.b.id + (it.guess ? '（我猜）' : ''), 140, ok));
      }
      if (!items.length) crops.append(el('div', { class: 'muted' }, '还没有框指定成这个角色。'));
      root.append(el('div', { class: 'char', style: `border-left:4px solid ${c.color}` }, head, note, crops));
    }
    if (unassigned.length) root.append(cropSec('还没指定是谁的角色框', unassigned));
    if (unknown.length) root.append(cropSec('标了「不确定是谁」的', unknown));
    root.append(el('button', { onclick: () => { const nm = prompt('新角色叫什么？', ''); if (nm != null) { RK.newChar(nm.trim()); RK.changed(); } } }, '＋ 新建角色'));
    return root;
  });

  function delThing(id) {
    if (!confirm('删除这个东西/地点？对应到它的框会变回「不跟别的图对应」。')) return;
    RK.A.things = RK.A.things.filter((t) => t.id !== id);
    for (const im of Object.values(RK.A.images)) for (const b of im.boxes || []) if (b.thing === id) b.thing = null;
    RK.changed();
  }

  RK.openThings = () => RK.openOverlay(() => {
    const root = el('div', {}, el('h2', { style: 'margin-top:0' }, '物件/地点'),
      el('p', { class: 'muted' }, '同一样东西或同一个地方（门、窗、变压器、斑马线……）在不同图里对应到同一项，我就知道它们是一个。点截图会跳到那张图。'));
    const members = new Map(), props = new Map();
    for (const i of RK.st.images) for (const b of RK.boxes(i.key)) if (b.thing && RK.canThing(b.kind)) push(members, b.thing, { key: i.key, b });
    for (const p of RK.thingProposals()) push(props, p.thing, p);
    const list = RK.things();
    for (const t of list) {
      const mine = members.get(t.id) || [], guess = props.get(t.id) || [];
      const name = el('input', { type: 'text', value: t.name, style: 'width:200px' });
      name.oninput = () => { RK.ownThing(t.id).name = name.value; RK.changed(true); };
      const col = el('input', { type: 'color', value: t.color, style: 'width:36px;height:28px;padding:0' });
      col.onchange = () => { RK.ownThing(t.id).color = col.value; RK.changed(); };
      const note = el('input', { type: 'text', value: t.note || '', placeholder: '说明（可选），比如：练习室唯一的门，外面的人从这里进来' });
      note.oninput = () => { RK.ownThing(t.id).note = note.value; RK.changed(true); };
      const n = new Set(mine.map((x) => x.key)).size;
      const head = el('div', { class: 'row' }, col, name,
        el('span', { class: 'muted grow' }, `出现在 ${n} 张图` + (guess.length ? `，还有 ${guess.length} 个等你确认` : '') + (t.proposed ? '（名字是我起的，可以改）' : '')),
        guess.length > 1 ? el('button', { class: 'small primary', title: '下面标着（我猜）的框都是它',
          onclick: () => { for (const it of guess) RK.setThing(it.key, it.b.id, t.id); } }, '我猜的都对') : null,
        t.src === 'user' ? el('button', { class: 'small', onclick: () => delThing(t.id) }, '删除') : null);
      const crops = el('div', { class: 'crops' });
      for (const it of mine) {
        const no = el('button', { class: 'small', onclick: (e) => { e.stopPropagation(); RK.rejectThing(it.key, it.b.id, t.id); } }, '不是它');
        crops.append(cropEl(it.key, it.b, short(it.key) + ' ' + it.b.id, 140, no));
      }
      for (const it of guess) {
        const btns = el('div', { class: 'row', style: 'justify-content:center' },
          el('button', { class: 'small primary', onclick: (e) => { e.stopPropagation(); RK.setThing(it.key, it.b.id, t.id); } }, '是'),
          el('button', { class: 'small', onclick: (e) => { e.stopPropagation(); RK.rejectThing(it.key, it.b.id, t.id); } }, '不是'));
        crops.append(cropEl(it.key, it.b, short(it.key) + ' ' + it.b.id + '（我猜）', 140, btns));
      }
      if (!mine.length && !guess.length) crops.append(el('div', { class: 'muted' }, '还没有框对应到这里。在图上选中一个框，在「是哪个东西」里选它。'));
      root.append(el('div', { class: 'char', style: `border-left:4px solid ${t.color}` }, head, note, crops));
    }
    if (!list.length) root.append(el('p', { class: 'muted' }, '还没有。新建一项，再到图上把框对应过来；或者等我下一轮提议。'));
    root.append(el('button', { onclick: () => { const nm = prompt('新的东西/地点叫什么？比如：练习室的门', ''); if (nm != null) { RK.newThing(nm.trim()); RK.changed(); } } }, '＋ 新建东西/地点'));
    return root;
  });

  RK.openProject = () => RK.openOverlay(() => {
    const root = el('div', {}, el('h2', { style: 'margin-top:0' }, '项目：' + RK.st.project));
    if (RK.Q.intro) root.append(el('div', { class: 'summary', style: 'margin-bottom:12px' }, RK.Q.intro));
    const qs = (RK.Q.project || []).filter((q) => q && q.id);
    if (qs.length) {
      root.append(el('div', { class: 'sec' }, el('h3', {}, '整体的问题'),
        qs.map((q) => RK.qCard(q, RK.A.project.answers[q.id], (v, soft) => { RK.A.project.answers[q.id] = v; RK.changed(soft); }))));
    }
    const N = RK.A.project.notes, notes = el('div', { class: 'sec' }, el('h3', {}, '项目备注'));
    for (const [k, label, ph] of [
      ['keep', '必须和参考一致的', '布局、某几样东西、灯光颜色、天气……'],
      ['free', '可以自由发挥的', ''],
      ['avoid', '不要出现的', '比如：人、车、真实品牌'],
      ['motion', '想要的动态', '雨、灯闪、信号灯、人走动……写上节奏更好'],
    ]) {
      const t = el('textarea', { rows: 2, placeholder: ph }, N[k] || '');
      t.oninput = () => { N[k] = t.value; RK.changed(true); };
      notes.append(el('div', { style: 'margin-bottom:8px' }, el('div', { class: 'muted' }, label), t));
    }
    root.append(notes, el('div', { class: 'muted' }, `图片 ${RK.st.images.length} 张 · 数据目录 ${RK.st.dir}`));
    return root;
  });

  RK.todoAll = () => RK.st.images.reduce((n, i) => n + RK.todo(i.key), 0) + RK.todoGlobal();
  RK.done = async () => {
    if (!RK.st) return;
    const left = RK.todoAll();
    if (left && !confirm(`还有 ${left} 条没答。先交这一轮吗？没答的我下一轮再问。`)) return;
    RK.A.submittedRound = RK.Q.round || 0;
    RK.A.submittedAt = new Date().toISOString();
    RK.save(true);
    RK.toast('正在导出标注图…');
    await RK.exportAll();
    RK.openOverlay(() => el('div', {}, el('h2', { style: 'margin-top:0' }, '收到'),
      el('p', {}, '回聊天告诉我「答完了」，我就去读答案。'),
      el('p', { class: 'muted' }, (left ? `还有 ${left} 条没答，没关系，我先按已答的推进。` : '这一轮的问题都答完了。') +
        '之后还可以接着改，改动同样会自动保存。')));
  };
})();
