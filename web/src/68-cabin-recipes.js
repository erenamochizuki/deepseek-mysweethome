// 厨房旁的食谱架。每次翻开或返回目录都向小屋服务取最新记录。
(function (V3) {
  'use strict';
  const el = V3.util.el, base = '/api/cabin/recipes', perPage = 12;
  const unavailable = '共享食谱暂时连不上。请从 QQ 助手启动器打开本机小屋，再试一次。';
  const fields = [
    { key: 'name', label: '菜名', max: 80, hint: '这道菜叫什么？' },
    { key: 'ingredients', label: '食材', max: 3000, hint: '写下用量，可以每行记一种食材' },
    { key: 'steps', label: '做法', max: 8000, hint: '按下厨顺序记录每一步' },
    { key: 'notes', label: '小记', max: 2000, hint: '口味、火候，或下次想试的变化' }
  ];
  const button = (label, action, style = '') => el('button', { type: 'button', class: style, onclick: action }, label);
  const byline = recipe => (recipe.source === 'assistant' ? '她学会的' : '玩家记下的');
  const dateLabel = value => value ? new Date(value).toLocaleDateString('zh-CN') : '';
  async function request(path, options) {
    if (location.protocol === 'file:') throw Error(unavailable);
    let response, data;
    try {
      response = await fetch(base + path, { cache: 'no-store', ...options });
      data = await response.json();
    } catch { throw Error(unavailable); }
    if (!response.ok || data?.ok !== true) {
      const error = Error(typeof data?.error === 'string' ? data.error : unavailable);
      error.code = data?.code;
      error.recipe = data?.recipe;
      throw error;
    }
    return data;
  }

  function open(event) {
    if (V3.hud.modalOpen('recipes')) return;
    V3.shore?.close();
    const previousFocus = document.activeElement;
    const title = el('h2', { id: 'cabin-recipes-title' }, '小屋食谱');
    const close = button('×', () => V3.hud.closeModal('recipes'), 'recipe-close');
    close.setAttribute('aria-label', '合上食谱');
    const content = el('div', { class: 'recipe-content' });
    const dialog = el('section', { class: 'recipe-book', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id },
      el('header', { class: 'recipe-cover' }, el('span', { class: 'recipe-bookmark', 'aria-hidden': 'true' }), title, close), content);
    let query = '', offset = 0, ticket = 0, timer, mode, saving = false, backTo;
    function nextView(nextMode) {
      mode = nextMode;
      clearTimeout(timer);
      ticket++;
      content.scrollTop = 0;
      content.replaceChildren();
    }
    function showIndex() {
      nextView('index');
      const search = el('input', { type: 'search', class: 'recipe-search', maxlength: 80, 'aria-label': '按菜名或食材搜索', placeholder: '按菜名或食材搜索' });
      search.value = query;
      const write = button('＋ 记一道菜', () => edit(null), 'recipe-primary');
      write.disabled = true;
      const caption = el('p', { class: 'recipe-count', role: 'status' });
      const list = el('div', { class: 'recipe-list' }), pages = el('nav', { class: 'recipe-pager', 'aria-label': '食谱翻页' });
      content.append(el('div', { class: 'recipe-tools' }, search, write), caption, list, pages);
      async function refresh() {
        const current = ++ticket;
        list.replaceChildren(); pages.replaceChildren();
        caption.textContent = '正在翻目录…';
        try {
          const params = new URLSearchParams({ q: query, limit: perPage, offset });
          const { recipes, total } = await request('?' + params);
          if (current !== ticket) return;
          if (!Array.isArray(recipes) || !Number.isInteger(total)) throw Error(unavailable);
          V3.cabinRoutine?.recipeVisit(false);
          write.disabled = false;
          caption.textContent = query ? '找到 ' + total + ' 道菜' : '已收录 ' + total + ' 道菜';
          if (!total) {
            list.append(el('div', { class: 'recipe-empty' }, el('span', { class: 'recipe-open-icon', 'aria-hidden': 'true' }),
              el('strong', {}, query ? '没找到这道菜' : '第一页还空着'),
              el('p', {}, query ? '换个菜名或食材再找找。' : '记下第一道菜吧。她在 QQ 里学会的做法也会收在这里。')));
          }
          for (const recipe of recipes) {
            const row = button('', () => showRecipe(recipe.id), 'recipe-row');
            row.append(el('strong', {}, recipe.name), el('small', {}, byline(recipe)), el('span', { 'aria-hidden': 'true' }, '›'));
            list.append(row);
          }
          if (total > perPage) {
            const go = step => { offset += step * perPage; refresh(); content.scrollTop = 0; };
            const prev = button('上一页', () => go(-1)), next = button('下一页', () => go(1));
            prev.disabled = offset === 0; next.disabled = offset + perPage >= total;
            pages.append(prev, el('small', {}, (1 + Math.floor(offset / perPage)) + ' / ' + Math.ceil(total / perPage)), next);
          }
        } catch (error) {
          if (current !== ticket) return;
          write.disabled = true; caption.textContent = error.message;
          list.replaceChildren(button('重新连接', refresh));
        }
      }
      search.addEventListener('input', () => {
        query = search.value.trim(); offset = 0; ticket++;
        list.replaceChildren(); pages.replaceChildren(); caption.textContent = '正在翻目录…';
        clearTimeout(timer); timer = setTimeout(refresh, 180);
      });
      refresh();
      close.focus({ preventScroll: true });
    }

    function sections(recipe) {
      return fields.slice(1).filter(field => recipe[field.key]).map(field =>
        el('section', { class: 'recipe-section' }, el('h4', {}, field.label), el('p', {}, recipe[field.key])));
    }
    function read(recipe) {
      nextView('read');
      const back = button('‹ 目录', showIndex, 'recipe-back');
      content.append(el('div', { class: 'recipe-nav' }, back, button('编辑食谱', () => edit(recipe))),
        el('article', { class: 'recipe-leaf' }, el('h3', {}, recipe.name), el('small', { class: 'recipe-meta' },
          byline(recipe) + '　·　' + dateLabel(recipe.updatedAt) + ' 更新'), ...sections(recipe)));
      back.focus({ preventScroll: true });
    }
    async function showRecipe(id) {
      nextView('read');
      const current = ticket;
      const back = button('‹ 目录', showIndex, 'recipe-back'), status = el('p', { role: 'status' }, '正在翻开食谱…');
      content.append(back, status); back.focus({ preventScroll: true });
      try {
        const { recipe } = await request('/' + encodeURIComponent(id));
        if (current === ticket) { read(recipe); V3.cabinRoutine?.recipeVisit(false); }
      } catch (error) {
        if (current === ticket) { status.textContent = error.message; content.append(button('重新读取', () => showRecipe(id))); }
      }
    }

    function edit(recipe) {
      nextView('edit');
      const current = ticket, inputs = {};
      backTo = () => recipe ? read(recipe) : showIndex();
      const back = button('‹ ' + (recipe ? '返回食谱' : '目录'), backTo, 'recipe-back');
      const save = el('button', { type: 'submit', class: 'recipe-primary' }, '保存食谱');
      const feedback = el('div', { class: 'recipe-feedback', role: 'status' });
      const form = el('form', { class: 'recipe-form' });
      for (const { key, label, max, hint } of fields) {
        const attrs = { name: key, maxlength: max, placeholder: hint, required: key !== 'notes' };
        const input = key === 'name' ? el('input', { ...attrs, type: 'text' }) : el('textarea', { ...attrs, rows: key === 'steps' ? 4 : 2 });
        input.value = recipe?.[key] || ''; inputs[key] = input;
        input.addEventListener('input', () => input.setCustomValidity(''));
        form.append(el('label', {}, el('span', {}, label, key === 'notes' ? el('small', {}, '（选填）') : null), input));
      }
      form.append(feedback, el('div', { class: 'recipe-save' }, save));
      content.append(back, el('h3', { class: 'recipe-form-title' }, recipe ? '编辑食谱' : '记一道菜'), form);
      inputs.name.focus({ preventScroll: true });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving) return;
        const payload = {};
        for (const field of fields) {
          const input = inputs[field.key];
          payload[field.key] = input.value.trim();
          if (input.required && !payload[field.key]) { input.setCustomValidity('请填写' + field.label); input.reportValidity(); return; }
        }
        if (recipe) payload.expectedUpdatedAt = recipe.updatedAt;
        saving = true; back.disabled = true; save.disabled = true; feedback.textContent = '正在保存…';
        for (const input of Object.values(inputs)) input.readOnly = true;
        try {
          const result = await request(recipe ? '/' + encodeURIComponent(recipe.id) : '', { method: recipe ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          V3.cabinRoutine?.recipeVisit(true);
          if (current !== ticket) return;
          read(result.recipe); V3.hud.toast('《' + result.recipe.name + '》已保存');
        } catch (error) {
          if (current !== ticket) return;
          if (error.code === 'duplicate' || error.code === 'stale') {
            feedback.replaceChildren(el('p', {}, error.code === 'duplicate' ? '这道菜已经收录过了，可以打开原食谱查看。' : '这页食谱刚被改过。请对照最新版再编辑。'));
            if (error.recipe) {
              const existing = error.recipe;
              feedback.append(el('details', {}, el('summary', {}, '对照《' + existing.name + '》'),
                ...sections(existing), button('打开这份已保存的食谱', () => showRecipe(existing.id))));
            }
          } else feedback.textContent = error.message;
          feedback.scrollIntoView({ block: 'nearest' });
        } finally {
          saving = false; back.disabled = false; save.disabled = false;
          for (const input of Object.values(inputs)) input.readOnly = false;
        }
      });
    }
    dialog.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const targets = [...dialog.querySelectorAll('button:enabled,input,textarea,summary')].filter(node => node.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    const desk = event?.detail?.desk;
    V3.hud.modal(dialog, { name: 'recipes', cls: desk ? 'recipe-modal recipe-at-desk' : 'recipe-modal', onClose: () => { ticket++; clearTimeout(timer); previousFocus?.focus?.({ preventScroll: true }); },
      onEsc: () => {
        if (saving) return true;
        if (mode === 'edit') { backTo(); return true; }
        if (mode === 'read') { showIndex(); return true; }
        return false;
      } });
    showIndex();
    if (desk) V3.shoreView?.focus('recipeDesk', desk, dialog);
  }
  window.addEventListener('cabin:open-recipes', open);
})(window.V3);
