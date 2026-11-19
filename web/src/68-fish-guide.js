(function (V3) {
  'use strict';
  const element = V3.util.el;
  const notes = {
    goby: '青灰的背、暖棕的尾鳍。转过身时，侧面有一道浅金色的细纹。',
    silverside: '通身银白。游过白色网圈时，鱼腹像一小片碎光。',
    wrasse: '鳍和背都带着雾蓝色。看它拐弯，身侧的浅纹便露出来了。',
    clown: '橘色身上裹着三道白带。沿着珊瑚的半腰找，常能看见几尾结伴穿过去。',
    tang: '宝蓝色的背上有深色花纹，尾巴却是亮黄的。比起珊瑚根部，更容易在礁顶上方看见它。',
    blenny: '眉间两根小穗，配上琥珀色的横带，很像一对挑起来的眉毛。', cardinal: '珊瑚红的鱼身横着三道深纹，肚皮是柔和的杏色。',
    pipefish: '橄榄绿的身体像一截海草，一直细到长长的管状嘴。', puffer: '圆肚皮把乳白色的底衬得很亮，背上撒着一把褐色小点。',
    mullet: '蓝灰背下有两条平行的细线，转弯时线条一起闪过。', damsel: '鱼身短而高，深色圆斑后面跟着一把蓝尾扇。',
    ponyfish: '菱形银身像一片小月亮，侧面一道亮纹比尾巴还抢眼。', halfbeak: '先看到的是细尖长嘴，游过去才露出红尾尖。',
    filefish: '翡翠色的侧面点着斑，背鳍上另翘着一根小刺。', flounder: '从上方看它格外扁，两颗眼睛和沙色斑点都在朝上的一面。',
    anchovy: '细身泛着浅青，腹边留着一道像玻璃边缘的银线。', bannerfish: '白色长背鳍高高挑起，黑白条带和黄尾在礁边特别醒目。',
    butterfly: '扁圆的奶油色身体横着铜色条带，尖嘴沿着珊瑚一探一探。', parrotfish: '薄荷绿的身子配着浅紫鳞纹，嘴前鼓出一小截。',
    triggerfish: '背刺竖在夜蓝色的鱼身上，浅色斑点像一小片星空。',
    seahorse: '直立的金色小马驹，管嘴向前，尾尖却向后卷成一个钩。', boxfish: '方方的柠檬黄背甲上，黑色菱点排成三行。',
    flyingfish: '银背两侧各伸出一面蓝灰色的长翼，从上方看还能数出细细的翼条。', goatfish: '鼻梁微微下弯，下巴垂着一对金须，身侧也镶着一线金黄。',
    dragonet: '蓝绿鱼身绕着金色折带，背上的小帆一格橙、一格蓝。', squirrelfish: '红背上横着三道奶油细线，金圈大眼在侧面格外醒目。',
    lionfish: '绯红鱼身披着奶白斜带，两侧的长胸鳍像张开的羽扇。', emperor: '深蓝扁身上嵌着一大一小两圈金纹，背鳍边也压着一线金。',
    ribboneel: '蓝身金脊，细长的身子弯成一道波浪，鼻尖上挑着两只小喇叭。', manta: '宽翼像一只掠过礁顶的风筝；浅色肩斑、成对头鳍和细长的鞭尾都从上方看得最清楚。',
  };
  const formNotes = { lagoon:'背色转为潟湖青，三道深蓝鞍带取代了背上的小斑点。', coral:'珊瑚粉的身侧多了三道浅色环带，卷尾的轮廓没变。',
    midnight:'墨蓝背甲上浮出奶黄色的十字星和碎点，衬着一双金眼。', orchid:'金色折带换成浅绿珠斑，贴在紫藤色的身侧。',
    plum:'羽扇染成梅紫色，身上原来的斜带换成了交错的雪点。', tide:'青绿侧面浮起四道浅色弧线，一路延伸到鳃盖。', pearl:'紫灰色宽翼上撒着两列珍珠色的星斑。' };
  const views = { flounder:{az:1.22,el:.8}, flyingfish:{az:.85,el:.87}, manta:{az:.55,el:1.15}, lionfish:{az:1.12,el:.36}, dragonet:{az:1.18,el:.31} };
  function entries(shore) {
    const observed = new Set(shore?.observed), residents = shore?.fish || [];
    const list = (names, reef) => Object.entries(names).map(([id, name]) => ({
      id, name, reef, note: notes[id], observed: observed.has(id), forms: V3.inventoryRules.knownForms(shore, id),
      residents: reef ? 0 : residents.filter(fish => fish.kind === id).length,
    }));
    return [...list(V3.inventoryRules.FISH, false), ...list(V3.inventoryRules.REEF_FISH, true)];
  }
  function portrait(entry, form = entry.forms?.[0] || 'base', size = 224) {
    return V3.shellIcons.get('fish-guide:' + entry.id + ':' + form, {
      build: () => entry.reef ? V3.reefFish.model(entry.id, form) : V3.shallows.fishModel(entry.id, form),
      silhouette: !entry.observed, size, view: views[entry.id] || {az:1.22, el:.18},
    });
  }
  function specimen(entry, number, ready) {
    const state = entry.observed ? 'seen' : 'unseen';
    const status = !ready ? '暂无记录' : entry.observed ? (entry.reef ? '一起看过' : '已观察') : '待观察';
    const rules = V3.inventoryRules, total = 1 + Object.keys(rules.FISH_FORMS[entry.id] || {}).length, first = entry.forms[0] || 'base';
    const note = element('p', {}, formNotes[first] || entry.note), image = element('img', { alt:entry.observed ? entry.name + ' · ' + rules.fishFormName(entry.id, first) : entry.name + '的剪影', draggable:'false' });
    const choices = entry.observed && total > 1 ? element('div', {class:'fish-forms'}, element('small', {}, `花色 ${entry.forms.length}/${total}`)) : null;
    if (choices) for (const form of entry.forms) {
      const name = rules.fishFormName(entry.id, form);
      choices.append(entry.forms.length === 1 ? element('span', {}, name) : element('button', {type:'button', 'aria-pressed':String(form === first),
        onclick: event => { image.src = portrait(entry, form); image.alt = entry.name + ' · ' + name; note.textContent = formNotes[form] || entry.note;
          for (const button of choices.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button === event.currentTarget)); }}, name));
    }
    const card = element('article', { class: 'fish-specimen', 'data-state': state, 'data-region': entry.reef ? 'reef' : 'shallows', 'data-kind': entry.id },
      element('div', { class: 'fish-plate' },
        element('small', { class: 'fish-number' }, '图 ' + String(number).padStart(2, '0')),
        image),
      element('div', { class: 'fish-caption' }, element('span', { class: 'fish-badge' }, status),
        element('h3', {}, entry.name), note, choices,
        entry.residents ? element('small', { class: 'fish-residents' }, `鱼缸住户 · ${entry.residents} 尾`) : null));
    card.entry = entry; return card;
  }
  function mount(body) {
    let far = false, signature, observer;
    const btn = next => element('button', { type: 'button', onclick: () => { far = next; refresh(); body.scrollTop = 0; } });
    const shallow = btn(false), reef = btn(true), hint = element('p', {class:'fish-hint'}), grid = element('div', {class:'fish-grid'}), tank = element('strong');
    const ready = () => V3.cabinInventory.canShore();
    const showPicture = card => { const image = card.querySelector('img'); if (!image.hasAttribute('src')) image.src = portrait(card.entry); };
    body.replaceChildren(element('div', {class:'fish-tabs', role:'group', 'aria-label':'观察水域'}, shallow, reef), hint, grid,
      element('footer', {class:'fish-foot'}, element('div', {}, tank, element('p', {}, '可选门廊小架或餐桌一角，收缸、搬缸都不丢鱼。')),
        element('button', {type:'button', onclick: () => { V3.collection.close(); V3.shallows.openTank(); }}, '摆放 / 查看鱼缸')));
    function refresh() {
      const saved = ready(), shore = saved ? V3.shore.shore() : null, all = entries(shore), known = all.filter(entry => entry.observed).length;
      const spot = V3.shallows.currentBerth(); tank.textContent = spot ? '鱼缸在' + spot.name : shore?.berth ? '这里没有原来的缸位，可另选位置' : '鱼缸默认收起，没有固定位置';
      const key = JSON.stringify([far, saved, shore?.observed, shore?.forms, shore?.fish?.map(fish => fish.kind)]);
      if (key !== signature) {
        signature = key; observer?.disconnect();
        if (window.IntersectionObserver) observer = new IntersectionObserver(changes => {
          for (const record of changes) if (record.isIntersecting) { showPicture(record.target); observer?.unobserve(record.target); }
        }, {root:body, rootMargin:'140px'});
        for (const [button, region] of [[shallow,false],[reef,true]]) {
          const members = all.filter(entry => entry.reef === region);
          button.textContent = (region ? '远礁观赏' : '浅海抄网') + ` · ${members.filter(entry => entry.observed).length}/${members.length}`;
          button.setAttribute('aria-pressed', String(region === far));
        }
        hint.textContent = !saved ? '可以先翻图鉴，进入可存档的小屋后再开始观察。' : far ? '点击珊瑚边游过的鱼，小鲸鱼会走到岸边。等她认出那尾鱼，剪影才会变成彩图。' : '网圈变金时抄网。带回鱼缸，或看一眼再放回海里，都能点亮彩图。';
        grid.classList.toggle('fish-grid-reef', far);
        grid.replaceChildren(...all.flatMap((entry,index) => entry.reef === far ? [specimen(entry,index+1,saved)] : []));
        for (const card of grid.children) { if (observer) observer.observe(card); else showPicture(card); }
      }
      return {known:saved ? known : '—', total:all.length};
    }
    return {refresh, dispose() { observer?.disconnect(); body.replaceChildren(); }};
  }
  V3.fishGuide = { open() { V3.shore.close(); V3.collection.open('fish'); }, entries, mount, portrait };
})(window.V3);
