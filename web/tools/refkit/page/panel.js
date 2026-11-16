/* tools/refkit/page/panel.js — right panel: image header, the agent's summary, basic fields, the agent's
   questions, the selected-box editor, the box list and the image note. RK.qCard is shared with extra.js. */
(function () {
  'use strict';
  const RK = window.RK, $ = RK.$;
  const el = RK.el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  };
  const sec = (title, ...kids) => el('div', { class: 'sec' }, el('h3', {}, title), ...kids);
  const now = () => new Date().toISOString();

  // One question. q: {id, text, type, options, other, guess, placeholder}; ans: stored answer or undefined;
  // set(answer, soft) stores it. opts: {optional: never mark as unanswered, noNote: no extra note line}.
  RK.qCard = (q, ans, set, opts) => {
    const o = opts || {}, cur = Object.assign({}, ans || {}), type = q.type || 'text';
    const card = el('div', { class: 'q' });
    const mark = () => card.classList.toggle('todo', !o.optional && !RK.answered(cur));
    const commit = (soft) => { cur.t = now(); set(cur, soft); mark(); };
    card.append(el('div', { class: 'qt' }, q.text || q.id));
    const g = q.guess, hasG = g != null && g !== '' && !(Array.isArray(g) && !g.length);
    if (type === 'choice' || type === 'multi' || type === 'yesno') {
      const multi = type === 'multi', list = type === 'yesno' ? ['是', '否', '不确定'] : (q.options || []);
      const isSel = (x) => multi ? Array.isArray(cur.v) && cur.v.includes(x) : !cur.other && cur.v === x;
      const isG = (x) => hasG && [].concat(g).includes(x);
      const box = el('div', { class: 'opts' });
      for (const x of list) {
        box.append(el('button', { class: 'opt' + (isSel(x) ? ' sel' : '') + (isG(x) ? ' guess' : ''), title: isG(x) ? '我猜是这个' : null, onclick: () => {
          if (multi) { const s = new Set(Array.isArray(cur.v) ? cur.v : []); if (s.has(x)) s.delete(x); else s.add(x); cur.v = [...s]; }
          else { cur.v = isSel(x) ? null : x; cur.other = false; }
          commit(false);
        } }, x));
      }
      if (q.other) {
        const val = multi ? cur.otherText || '' : cur.other ? cur.v || '' : '';
        const inp = el('input', { type: 'text', placeholder: '其他，自己填', value: val, style: 'width:auto;flex:1;min-width:120px' });
        inp.oninput = () => {
          if (multi) cur.otherText = inp.value;
          else if (inp.value.trim()) { cur.v = inp.value; cur.other = true; } else if (cur.other) { cur.v = null; cur.other = false; }
          commit(true);
        };
        inp.onchange = () => RK.renderPanelSoon();
        box.append(inp);
      }
      card.append(box);
      if (hasG && !RK.answered(cur)) {
        card.append(el('div', { class: 'row' }, el('span', { class: 'guesstag grow' }, '我猜：' + [].concat(g).join('、') + '（虚线的选项）'),
          el('button', { class: 'small', onclick: () => {
            cur.v = multi ? [].concat(g) : g;
            cur.other = !multi && !list.includes(g);
            commit(false);
          } }, '对，确认')));
      }
    } else {
      const inp = type === 'number'
        ? el('input', { type: 'number', value: cur.v == null ? '' : cur.v })
        : el('textarea', { rows: 2, placeholder: q.placeholder || '' }, cur.v || '');
      inp.oninput = () => { cur.v = inp.value; commit(true); };
      card.append(inp);
      if (hasG && !RK.answered(cur)) {
        card.append(el('div', { class: 'row', style: 'margin-top:6px' }, el('span', { class: 'guesstag grow' }, '我猜：' + g),
          el('button', { class: 'small', onclick: () => { cur.v = String(g); commit(false); } }, '对，用这个')));
      }
    }
    if (!o.noNote) {
      const n = el('input', { type: 'text', placeholder: '补充说明（可选）', value: cur.note || '', style: 'margin-top:4px' });
      n.oninput = () => { cur.note = n.value; commit(true); };
      card.append(n);
    }
    mark();
    return card;
  };
  // Rebuild after the current event finishes, e.g. when an "other" text box loses focus.
  RK.renderPanelSoon = () => setTimeout(() => { if (!RK.typing()) RK.renderPanel(); }, 0);

  function header(key, a) {
    const i = RK.info(key), idx = RK.st.images.indexOf(i);
    return el('div', { class: 'row', style: 'margin-bottom:10px' },
      el('b', { class: 'grow', style: 'word-break:break-all' }, i.name),
      el('span', { class: 'muted' }, a.w ? `${a.w}×${a.h}` : ''),
      el('button', { class: 'small', title: '上一张（←）', onclick: () => RK.step(-1) }, '←'),
      el('span', { class: 'muted' }, `${idx + 1}/${RK.st.images.length}`),
      el('button', { class: 'small', title: '下一张（→）', onclick: () => RK.step(1) }, '→'),
      i.group === 'images' ? el('button', { class: 'small danger', title: '删除这张图（移到 trash 文件夹，可以找回）', onclick: () => RK.delImage(key) }, '删除') : null);
  }
  function fieldsSec(key, q, a) {
    const s = sec('基本信息'), gf = q.fields || {};
    for (const f of RK.FIELDS) {
      const v = a.fields[f.k];
      const ans = RK.filled(v) ? { v, other: f.options ? !f.options.includes(v) : false } : {};
      s.append(RK.qCard({ id: f.k, text: f.label, type: f.type, options: f.options, other: f.other, guess: gf[f.k], placeholder: f.ph }, ans,
        (n, soft) => { a.fields[f.k] = RK.answered(n) ? n.v : ''; RK.changed(soft); }, { optional: gf[f.k] == null, noNote: true }));
    }
    const chk = (k, label) => {
      const c = el('input', { type: 'checkbox', checked: !!a.fields[k] });
      c.onchange = () => { a.fields[k] = c.checked; RK.changed(); };
      return el('label', { style: 'display:flex;gap:6px;align-items:center;cursor:pointer' }, c, label);
    };
    s.append(el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap' }, chk('main', '这张是主视角（成品默认镜头）'), chk('skip', '这张不用参考')));
    return s;
  }
  // One agent proposal "box X is thing T": click the text to select the box, then 是 / 不是.
  function proposalRow(p) {
    const t = RK.thing(p.thing);
    return el('div', { class: 'row', style: 'margin-bottom:4px' },
      el('span', { class: 'guesstag grow', style: 'cursor:pointer', title: (t && t.note ? t.note + '。' : '') + '点一下选中这个框',
        onclick: () => { RK.sel = p.b.id; RK.renderPanel(); RK.draw(); } }, `${p.b.id} 是「${t ? t.name : p.thing}」吗？`),
      el('button', { class: 'small primary', onclick: () => RK.setThing(p.key, p.b.id, p.thing) }, '是'),
      el('button', { class: 'small', onclick: () => RK.rejectThing(p.key, p.b.id, p.thing) }, '不是'));
  }
  function boxEditor(key, b) {
    const s = sec('选中的框');
    s.querySelector('h3').append(el('span', { class: 'muted' }, b.id + (b.src === 'agent' ? '（我框的）' : '（你画的）')));
    if (b.q && b.q.ask) s.append(el('div', { class: 'summary', style: 'margin-bottom:6px' }, b.q.ask));
    const gs = b.q && b.q.guess;
    if (gs && b.pending && !b.removed) {
      const gk = RK.kind(gs.kind), gc = gs.character && RK.char(gs.character), gt = gs.thing && RK.thing(gs.thing);
      s.append(el('div', { class: 'row' }, el('span', { class: 'guesstag grow' }, '我猜：' + (gk ? gk.label : '?') + (gc ? ' · ' + gc.name : '') + (gt ? ' · ' + gt.name : '')),
        el('button', { class: 'small primary', onclick: () => RK.confirmBox(key, b.id) }, '对，确认')));
    }
    const kinds = el('div', { class: 'kinds' });
    RK.KINDS.forEach((k, i) => {
      const on = b.kind === k.k;
      kinds.append(el('button', { class: 'kind', title: '快捷键 ' + (i + 1), style: `border-color:${k.color};` + (on ? `background:${k.color};color:#111;font-weight:700` : ''),
        onclick: () => RK.setKind(key, b.id, k.k) }, k.label));
    });
    s.append(kinds);
    if (b.kind === 'character') {
      const sl = el('select', {});
      sl.append(el('option', { value: '' }, '— 是哪个角色？ —'));
      for (const c of RK.chars()) sl.append(el('option', { value: c.id, selected: b.character === c.id }, c.name + (c.proposed ? '（我起的名字）' : '')));
      sl.append(el('option', { value: '?', selected: b.character === '?' }, '不确定是谁'));
      sl.append(el('option', { value: '+' }, '＋ 新角色…'));
      sl.onchange = () => {
        if (sl.value !== '+') { RK.setChar(key, b.id, sl.value || null); return; }
        const name = prompt('新角色叫什么？起个好认的名字就行', '');
        if (name == null) { RK.renderPanel(); return; }
        RK.setChar(key, b.id, RK.newChar(name.trim()).id);
      };
      s.append(el('div', { class: 'row' }, el('label', {}, '是谁'), sl));
    }
    if (RK.canThing(b.kind)) {
      const sl = el('select', {});
      sl.append(el('option', { value: '' }, '— 不跟别的图对应 —'));
      for (const t of RK.things()) sl.append(el('option', { value: t.id, selected: b.thing === t.id }, t.name + (t.proposed ? '（我起的名字）' : '')));
      sl.append(el('option', { value: '+' }, '＋ 新的东西/地点…'));
      sl.onchange = () => {
        if (sl.value !== '+') { RK.setThing(key, b.id, sl.value || null); return; }
        const name = prompt('给这个东西或地点起个名字，比如：练习室的门', '');
        if (name == null) { RK.renderPanel(); return; }
        RK.setThing(key, b.id, RK.newThing(name.trim()).id);
      };
      s.append(el('div', { class: 'row', title: '不同图里的框选同一项，就表示是同一个东西或地点' }, el('label', {}, '是哪个东西'), sl));
    }
    const note = el('textarea', { rows: 2, placeholder: '这个框的说明（可选），比如：穿校服；这个招牌要照搬' }, b.note || '');
    note.oninput = () => { RK.own(key, b.id).note = note.value; RK.changed(true); };
    s.append(note);
    s.append(el('div', { class: 'row', style: 'margin-top:6px' },
      b.removed
        ? el('button', { class: 'small', onclick: () => { RK.own(key, b.id).removed = false; RK.changed(); } }, '恢复这个框')
        : el('button', { class: 'small', onclick: () => { RK.delBox(key, b.id); RK.sel = null; RK.changed(); } }, b.src === 'agent' ? '框错了，删掉' : '删除'),
      el('span', { class: 'muted', style: 'font-size:12px' }, '拖框身移动，拖四角改大小，1–7 改种类')));
    return s;
  }
  function boxList(key) {
    const all = RK.boxes(key, true), live = all.filter((b) => !b.removed);
    const s = sec(`框（${live.length}）`);
    const guessed = live.filter((b) => b.pending && b.q && b.q.guess && b.q.guess.kind);
    if (guessed.length > 1) {
      s.querySelector('h3').append(el('button', { class: 'small', title: '把所有虚线框按我的猜测确认', onclick: () => {
        for (const b of guessed) RK.confirmBox(key, b.id);
      } }, `按猜测全部确认（${guessed.length}）`));
    }
    if (!all.length) s.append(el('div', { class: 'muted' }, '还没有框。在图上空白处拖动就能画一个，画之前可以在左下角选好种类。'));
    const prop = new Set(RK.thingProposals(key).map((p) => p.b.id));
    for (const b of all) {
      const todo = b.pending || prop.has(b.id);
      s.append(el('div', { class: 'boxitem' + (b.id === RK.sel ? ' cur' : '') + (todo ? ' todo' : ''), style: b.removed ? 'opacity:.45' : null,
        onclick: () => { RK.sel = b.id; RK.renderPanel(); RK.draw(); } },
        el('span', { class: 'swatch', style: 'background:' + RK.boxColor(b) }),
        el('span', { class: 'bx grow' }, RK.boxLabel(b) + (b.removed ? '（已删）' : '') + (b.note ? ' — ' + b.note : '')),
        todo ? el('span', { class: 'guesstag' }, '待确认') : null));
    }
    return s;
  }
  function intro() {
    return el('div', {},
      el('h3', {}, '参考图标注'),
      el('p', {}, '1. 把截图拖进页面、Ctrl+V 粘贴，或点右上角「上传」。'),
      el('p', {}, '2. 回聊天告诉我图放好了。我看完会在这里提问：场景、室内外、哪些是角色、哪些是路人、哪几张是同一个人。'),
      el('p', {}, '3. 答完点「这轮答完了」，再回聊天说一声。'),
      el('p', { class: 'muted' }, '所有回答都会自动保存。'));
  }
  let lastSel = null;
  RK.renderPanel = () => {
    const P = $('panel'), top = RK.sel !== lastSel ? 0 : P.scrollTop;
    lastSel = RK.sel;
    P.replaceChildren();
    if (!RK.cur || !RK.info(RK.cur)) { P.append(intro()); return; }
    const key = RK.cur, q = RK.qimg(key), a = RK.aimg(key);
    P.append(header(key, a));
    const selBox = RK.sel && RK.boxes(key, true).find((b) => b.id === RK.sel);
    if (selBox) P.append(boxEditor(key, selBox));
    if (!RK.hasQ(key)) {
      P.append(el('div', { class: 'summary', style: 'margin-bottom:12px' },
        '我还没看过这张图。回聊天说一声，我看过后会在这里提问。你也可以先自己框出角色和路人，或者写备注。'));
    }
    if (q.summary) P.append(sec('我的理解', el('div', { class: 'summary' }, q.summary)));
    P.append(fieldsSec(key, q, a));
    const qs = (q.questions || []).filter((x) => x && x.id);
    if (qs.length) {
      P.append(sec('我的问题', qs.map((qq) => RK.qCard(qq, a.answers[qq.id], (v, soft) => { a.answers[qq.id] = v; RK.changed(soft); }))));
    }
    const props = RK.thingProposals(key);
    if (props.length) {
      const ps = sec('这是同一个东西吗？', props.map(proposalRow));
      ps.querySelector('h3').append(el('button', { class: 'small', onclick: () => RK.openThings() }, '对照别的图'));
      P.append(ps);
    }
    P.append(boxList(key));
    const note = el('textarea', { rows: 3, placeholder: '关于这张图的任何补充：哪里要照着做、哪里不用管、我理解错的地方……' }, a.note || '');
    note.oninput = () => { a.note = note.value; RK.changed(true); };
    P.append(sec('本图备注', note));
    P.scrollTop = top;
  };
})();
