(function (V3) {
  'use strict';
  const element = V3.util.el;
  const islands=V3.inventoryRules.ISLET_STAGES, matureIsland=islands.length-1;
  const notes = {
    foldsail:'它游得像一条小船。转弯前，背上一排褶子先撑成白帆，尾巴随后才跟过来。',rainbell:'两片水色胸鳍像小玻璃铃，铃口下垂着金色小锤。第一粒饵落下时，它轻轻碰一下双铃。',
    moonray:'深蓝的背像水底一块旧礁石。只有它翻身接沉饵时，腹面那弯象牙白的小月亮才完整。',islet:'初见时它背上只有一块苔石。等石上长起双礁、蓄起潮池，鱼转身时，还能透过小拱门望见另一侧的水。',
    frogfish:'背鳍像一排枫叶，额前还另挑着一片。它用胸鳍挪两步就停下来，等食粒靠近。', pinecone:'金甲上的深色菱纹一层压一层，下巴的一对小青灯到了傍晚格外亮。', archer:'银腹墨斑，嘴尖朝上。一粒饵在水面打转，它瞄准了，才吐出一道细水线。',
    bamboo:'宽宽的褐色带纹从肩排到长尾。幼鲨身上只有带纹，长大后带间才露出浅色星点。', dory:'额头挑起几根细长的背鳍。迎面看薄得像一条线，转过来才看见铜色侧面上的圆斑。', moray:'墨褐色身上开着奶白的小花。陶管口露出半个脑袋，闻见食物，它才探出半身。', dolphin:'雾蓝背、白肚皮，一对水平的尾叶上下拍水。它沿水面划出一条弧线，抬起短吻换气。',
    knifejaw:'银灰色高背上横着四道炭黑竖带。它在缸的中层转身时，条纹会一道接一道地亮出来。', sandray:'两只眼睛从沙色圆盘上探出来。胸鳍边缘轻轻起伏，带着细长的尾巴掠过缸底。',
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
  const views = { flounder:{az:1.22,el:.8}, flyingfish:{az:.85,el:.87}, manta:{az:.55,el:1.15}, lionfish:{az:1.12,el:.36}, dragonet:{az:1.18,el:.31}, moonray:{az:.82,el:-.87}, islet:{az:.98,el:.47}, rainbell:{az:.64,el:.19} };
  const study = {
    foldsail:'浅海幻想鱼，占 2 格。看白帆在转弯前张开、进食后折起。重逢时，先找浪面上的小帆。',rainbell:'浅海幻想鱼，占 2 格。喂食时听一声轻铃；小雨里的老朋友，习惯在网圈外响两声。',
    moonray:'浅海幻想鱼，占 4 格。把模型转到底面找月牙，再喂一粒沉饵看它翻身。',islet:'小岛从来家那天开始长：'+islands.map(({day,name})=>`第 ${day} 天${name}`).join('、')+'。每个阶段都占 4 格。重逢时，它还背着离家那天的小岛。',
    frogfish:'从侧面找一找额头的叶饵和撑在沙面上的小脚。占 2 格。', pinecone:'把视角转到斜下方，看看青色的小灯和背上金色的甲片。占 2 格。', archer:'留意向上翘的嘴尖。喂食时，有一粒饵会等在水面。占 2 格。',
    bamboo:'看长尾带着身体绕弯；长到成鱼时，宽带之间会显出星点。占 4 格。', dory:'从正面转九十度，鱼的轮廓会从细线变成铜镜。投食时注意它能伸出来的小嘴。占 4 格。', moray:'先找陶管口的白花纹，再看它探身时尾巴如何弯回洞里。占 4 格。', dolphin:'它是浅海的哺乳动物访客。看水平尾叶上下摆动；只住潮湾超级大缸，预留 6 格。',
    knifejaw:'从侧面数四道黑带，再看背上短短的鳍条。中层巡游，养它需要预留 2 格。', sandray:'俯看两翼上的浅色沙纹，再贴近底面看它扁平的轮廓。它需要 4 格，会等饵沉底才进食。',
    goby:'先把头尾转到同一高度，再沿侧线从鳃后看到尾柄，细纹就在背腹交界处。', silverside:'略微俯看，再转回侧面，对比背部与腹部的明暗。',
    wrasse:'从尾端慢慢转向侧面，留意背鳍的颜色怎样接到身上的浅纹。', blenny:'转向斜前方，两只眉穗会从背鳍的轮廓里分开。',
    cardinal:'侧面对照三道深纹，再略微仰看，找出横纹与浅腹相接的位置。', pipefish:'从正面转到侧面，才能看出管嘴比鱼身还细。',
    puffer:'从头顶俯看，再回到侧面：背上的纹路和浅色圆腹最容易在这两个角度对照。', mullet:'让鱼身横在眼前，两条平行细线最清楚；转到尾后，它们就缩成细点。',
    damsel:'看侧面的深斑和蓝尾扇之间隔了多远，再从正面看扁高的身形。', ponyfish:'从正侧面看菱形轮廓，上下两角和中间的亮纹可以一起看清。',
    halfbeak:'从斜下方看伸出的长嘴，再转到另一侧，找尾尖那一点红。', filefish:'把背景留在背鳍上方，单独挑起的小刺就不会和身侧的斑点混在一起。',
    flounder:'先从侧面看它有多薄，再转到头顶：两只眼睛都在朝上的一面。', anchovy:'侧着看最容易找到腹边银线；从正面看，整条鱼缩成一小道窄影。',
    seahorse:'顺着弯颈往下看，尾巴没有展开成扇形，而是绕回去卷成了钩。', boxfish:'从斜前方看，可以同时看见背甲的顶面和侧面，顺着棱角找两面的花纹。',
    flyingfish:'转到上方看胸鳍的翼展，再从侧面找尾巴上格外长的下叶。', goatfish:'正面能把两根下巴须分开；再从侧面看须尖伸到嘴前多远。',
    dragonet:'先沿背帆看颜色交替，再看左右铺开的胸鳍，别把它们当成尾鳍。', squirrelfish:'侧面看金边大眼和腹侧细线，稍微俯看，背上成排的小尖鳍就出现了。',
    clown:'让橙白条带朝向自己，再转到背面，看白带怎样绕过背脊。', tang:'从斜上方看背上的深色块，再与尾柄后面亮黄的尾鳍对照。',
    bannerfish:'从侧面沿最高的白鳍往下找，它的起点在背上，不在尾巴上。', butterfly:'将尖嘴朝向自己，再转九十度，对比窄窄的正面和圆盘般的侧面。',
    parrotfish:'从斜前方看嘴部凸起，再转向侧面观察鳞纹，一头一尾都别错过。', triggerfish:'先找轮廓上竖起的背刺，再放大看深色鱼身上的点纹。',
    lionfish:'从正面转向侧面：两边展开的是胸鳍，背上独立竖起的是另一排长棘。', emperor:'从正侧面看身上的线条，再转到斜前方看深色鱼身有多扁。',
    ribboneel:'沿着金色背脊从鼻尖看到尾梢，换一个角度还能看见细身的弯折。', manta:'俯看能把宽翼和鞭尾放进同一个轮廓；转向正面，能看见嘴边成对的头鳍。',
  };
  const viewFor = id => id==='sandray' ? {az:.58,el:.93} : views[id] || {az:1.22, el:.18};
  const modelFor = (entry, form, islandStage) => entry.reef ? V3.reefFish.model(entry.id,form) : V3.shallows.fishModel(entry.id,form,islandStage);
  // Use one scale and orbit centre so changing the preview shows the fish growing in place.
  let matureBounds;
  function islandBounds() {
    if(!matureBounds) {
      const full=V3.shallows.fishModel('islet','base',matureIsland);
      const bounds=new THREE.Box3();full.updateMatrixWorld(true);
      full.traverseVisible(part=>{if(part.isMesh)bounds.expandByObject(part,true);});
      matureBounds=bounds.getBoundingSphere(new THREE.Sphere());
    }
    return matureBounds;
  }
  const formCount = id => 1 + Object.keys(V3.inventoryRules.FISH_FORMS[id] || {}).length;
  const figure = number => '图 ' + String(number).padStart(2,'0');
  const statusOf = (entry, ready) => !ready ? '暂无记录' : !entry.observed ? '待观察' : entry.reef ? '一起看过' : '已观察';
  function entries(shore) {
    const observed = new Set(shore?.observed), residents = shore?.fish || [];
    const list = (names, reef) => Object.entries(names).map(([id, name]) => ({
      id, name, reef, note: notes[id], tip: study[id], observed: observed.has(id), forms: V3.inventoryRules.knownForms(shore, id),
      residents: reef ? 0 : residents.filter(fish => fish.kind === id).length,
    }));
    return [...list(V3.inventoryRules.FISH, false), ...list(V3.inventoryRules.REEF_FISH, true)];
  }
  function portrait(entry, form = entry.forms?.[0] || 'base', size = 224, islandStage = matureIsland) {
    return V3.shellIcons.get('fish-guide:' + entry.id + ':' + form + (entry.id==='islet'?':'+islandStage:''), {
      build: () => modelFor(entry,form,islandStage), silhouette: !entry.observed, size,
      view: entry.id==='islet'?{...viewFor(entry.id),frameSpan:2*islandBounds().radius*1.04}:viewFor(entry.id),
    });
  }
  function specimen(entry, number, ready, preferred, remember, open) {
    const state = entry.observed ? 'seen' : 'unseen';
    const rules = V3.inventoryRules, total = formCount(entry.id);
    let selected = entry.forms.includes(preferred) ? preferred : entry.forms[0] || 'base';
    const note = element('p', {}, formNotes[selected] || entry.note), image = element('img', { alt:entry.observed ? entry.name + ' · ' + rules.fishFormName(entry.id, selected) : entry.name + '的剪影', draggable:'false' });
    const choices = entry.observed && total > 1 ? element('div', {class:'fish-forms'}, element('small', {}, `花色 ${entry.forms.length}/${total}`)) : null;
    function select(form) {
      if (!entry.forms.includes(form) || selected === form) return;
      selected = form; remember(entry.id,form); image.src = portrait(entry,form); image.alt = entry.name + ' · ' + rules.fishFormName(entry.id,form); note.textContent = formNotes[form] || entry.note;
      for (const button of choices?.querySelectorAll('button') || []) button.setAttribute('aria-pressed',String(button.dataset.form === form));
    }
    if (choices) for (const form of entry.forms) {
      const name = rules.fishFormName(entry.id, form);
      choices.append(entry.forms.length === 1 ? element('span', {}, name) : element('button', {type:'button', 'data-form':form, 'aria-pressed':String(form === selected), onclick:()=>select(form)}, name));
    }
    const card = element('article', { class: 'fish-specimen', 'data-state': state, 'data-region': entry.reef ? 'reef' : 'shallows', 'data-kind': entry.id },
      element('div', { class: 'fish-plate' },element('small', { class: 'fish-number' }, figure(number)), image),
      element('div', { class: 'fish-caption' }, element('span', { class: 'fish-badge' }, statusOf(entry,ready)),
        element('h3', {}, element('button',{type:'button',class:'fish-open','aria-label':'查看'+entry.name+'的观察手记',onclick:()=>open(entry,number,selected)},entry.name)), note, choices,
        entry.residents ? element('small', { class: 'fish-residents' }, `鱼缸住户 · ${entry.residents} 尾`) : null));
    card.showPicture = () => { if (!image.hasAttribute('src')) image.src = portrait(entry,selected); };
    card.selectForm = select; return card;
  }

  function detailPage(body, species, number, preferred, back, remember) {
    const rules=V3.inventoryRules, region=species.reef?'远礁观赏':'浅海相遇';
    let entry=species, form=preferred, orbit=null, appearance, formKey, recordKey, islandStage=matureIsland;
    const button=(label,action,attrs={})=>element('button',{type:'button',onclick:action,...attrs},label);
    const returnButton=button('‹ 返回鱼类图鉴',()=>back(),{class:'fish-back'}), stage=element('div',{class:'fish-view-stage'});
    const badge=element('span',{class:'fish-badge'}), description=element('p'), options=element('div',{class:'fish-forms fish-detail-forms'}), count=element('small'), residents=element('ul',{class:'fish-household'});
    const preview=species.id==='islet'?element('label',{},'岛屿生长阶段 ',element('select',{'aria-label':'岛屿生长阶段',onchange:e=>{islandStage=Number(e.target.value);show();}},
      islands.map(({day,name},i)=>element('option',{value:i,selected:i===matureIsland},`第 ${day} 天 · ${name}`)))):null;
    const page=element('section',{class:'fish-detail','data-kind':entry.id,'aria-labelledby':'fish-detail-name'},
      element('div',{class:'fish-detail-nav'},returnButton,element('span',{},region+'　/　'+figure(number))),
      element('div',{class:'fish-detail-layout'},element('figure',{class:'fish-view'},stage),
        element('div',{class:'fish-detail-info'},badge,element('h2',{id:'fish-detail-name'},entry.name),description,preview,
          element('h3',{},'观察要点'),element('p',{},entry.tip),element('h3',{},'在哪里遇见'),
          element('p',{},entry.reef?'去远礁点珊瑚旁游动的鱼，等小鲸鱼到岸边一起看清。每五分钟换三种，只能观赏，不能带回鱼缸。':entry.id==='dolphin'?'留意岸边游近的小海豚。圈变金时和它打招呼，目送它离开也会留下观察记录。':'到岸边的白色网圈旁，等网圈变金时抄网。每五分钟换一拨，观察后放归或带回鱼缸都算记录。'))),
      element('section',{class:'fish-detail-records'},element('h3',{},'我的观察记录'),element('div',{class:'fish-form-record'},count,options),residents));
    body.append(page);
    const modelLabel=()=>entry.name+' · '+(preview?islands[islandStage].name:rules.fishFormName(entry.id,form));
    const photo=()=>element('img',{src:portrait(entry,form,384,islandStage),alt:entry.observed?modelLabel():entry.name+'的剪影',draggable:'false'});
    function show() {
      const look=entry.observed?(preview?form+':'+islandStage:form):null;
      if (appearance===look) return; appearance=look;
      page.dataset.state=entry.observed?'seen':'unseen';
      if(preview)preview.hidden=!entry.observed;
      description.textContent=entry.observed?(preview?islands[islandStage].description:(formNotes[form] || entry.note)):'还没有这条鱼的观察记录。亲眼见过之后，这里会留下它的立体模型和花色。';
      for (const chip of options.querySelectorAll('button')) chip.setAttribute('aria-pressed',String(chip.dataset.form===form));
      if (!entry.observed) {
        orbit?.dispose(); orbit=null; stage.replaceChildren(photo()); return;
      }
      if (orbit) {orbit.reload(); return;}
      orbit=V3.modelOrbit.mount(stage,{view:viewFor(entry.id),bounds:preview?islandBounds:undefined,build:()=>modelFor(entry,form,islandStage),still:photo,
        label:()=>modelLabel()+'模型，可用方向键旋转，加减键缩放'});
    }
    function update(next,shore,saved) {
      entry=next; if (!entry.forms.includes(form)) form=entry.forms[0] || 'base';
      badge.textContent=statusOf(entry,saved);
      const forms=JSON.stringify(entry.forms);
      if (forms!==formKey) {
        formKey=forms; count.textContent=`已见花色 ${entry.forms.length} / ${formCount(entry.id)}`;
        options.replaceChildren(...entry.forms.map(value=>entry.forms.length===1?element('span',{},rules.fishFormName(entry.id,value)):
          button(rules.fishFormName(entry.id,value),()=>{form=value;remember(entry.id,form);show();},{'data-form':value,'aria-pressed':String(value===form)})));
      }
      const fish=(shore?.fish || []).filter(resident=>resident.kind===entry.id), key=JSON.stringify([saved,fish]);
      if (key!==recordKey) {
        recordKey=key; residents.hidden=entry.reef || !saved;
        residents.replaceChildren(...(fish.length?fish.map(resident=>element('li',{},element('b',{},resident.name || '未取名'), ' · '+rules.fishFormName(entry.id,resident.form)+' · 鱼缸住户')):
          residents.hidden?[]:[element('li',{},'鱼缸里还没有这种鱼。')]));
      }
      show();
    }
    return {id:entry.id,get form(){return form;},update,focus:()=>returnButton.focus({preventScroll:true}),dispose(){orbit?.dispose();page.remove();}};
  }
  function mount(body) {
    let far = false, signature, observer, detail=null, indexTop=0;
    const preferred=new Map(), remember=(id,form)=>preferred.set(id,form);
    const btn = next => element('button', { type: 'button', onclick: () => { far = next; refresh(); body.scrollTop = 0; } });
    const shallow = btn(false), reef = btn(true), hint = element('p', {class:'fish-hint'}), grid = element('div', {class:'fish-grid'}), tank = element('strong');
    const ready = () => V3.cabinInventory.canShore();
    const indexPage=element('div',{class:'fish-index'},element('div', {class:'fish-tabs', role:'group', 'aria-label':'观察水域'}, shallow, reef), hint, grid,
      element('footer', {class:'fish-foot'}, element('div', {}, tank, element('p', {}, '可选门廊小架或餐桌一角，收缸、搬缸都不丢鱼。')),
        element('button', {type:'button', onclick: () => { V3.collection.close(); V3.shallows.openTank(); }}, '摆放 / 查看鱼缸')));
    body.replaceChildren(indexPage);
    function openDetail(entry, number, form) {
      indexTop=body.scrollTop; indexPage.hidden=true;
      detail=detailPage(body,entry,number,form,back,remember); refresh(); body.scrollTop=0; detail.focus();
    }
    function back(restoreFocus=true) {
      if (!detail) return false;
      const source=grid.querySelector(`[data-kind="${detail.id}"]`);
      source?.selectForm(detail.form); detail.dispose(); detail=null;
      indexPage.hidden=false; body.scrollTop=indexTop;
      if (restoreFocus) source?.querySelector('.fish-open').focus({preventScroll:true});
      return true;
    }
    function refresh() {
      const saved = ready(), shore = saved ? V3.shore.shore() : null, all = entries(shore), known = all.filter(entry => entry.observed).length;
      const spot = V3.shallows.currentBerth(); tank.textContent = spot ? '鱼缸在' + spot.name : shore?.berth ? '这里没有原来的缸位，可另选位置' : '鱼缸默认收起，没有固定位置';
      const key = JSON.stringify([far, saved, shore?.observed, shore?.forms, shore?.fish?.map(fish => fish.kind)]);
      if (key !== signature) {
        signature = key; observer?.disconnect();
        if (window.IntersectionObserver) observer = new IntersectionObserver(changes => {
          for (const record of changes) if (record.isIntersecting) { record.target.showPicture(); observer?.unobserve(record.target); }
        }, {root:body, rootMargin:'140px'});
        for (const [button, region] of [[shallow,false],[reef,true]]) {
          const members = all.filter(entry => entry.reef === region);
          button.textContent = (region ? '远礁观赏' : '浅海相遇') + ` · ${members.filter(entry => entry.observed).length}/${members.length}`;
          button.setAttribute('aria-pressed', String(region === far));
        }
        hint.textContent = !saved ? '可以先翻图鉴，进入可存档的小屋后再开始观察。' : far ? '点击珊瑚边游过的鱼，小鲸鱼会走到岸边。等她认出那尾鱼，剪影才会变成彩图。' : '网圈变金时可以抄鱼；要是小海豚游来了，就和它打个招呼。目送它们离开也会点亮彩图。';
        grid.classList.toggle('fish-grid-reef', far);
        grid.replaceChildren(...all.flatMap((entry,index) => entry.reef === far ? [specimen(entry,index+1,saved,preferred.get(entry.id),remember,openDetail)] : []));
        for (const card of grid.children) { if (observer) observer.observe(card); else card.showPicture(); }
      }
      if (detail) detail.update(all.find(entry=>entry.id===detail.id),shore,saved);
      return {known:saved ? known : '—', total:all.length};
    }
    return {refresh,back,dispose() { observer?.disconnect(); detail?.dispose(); body.replaceChildren(); body.scrollTop=0; }};
  }
  V3.fishGuide = { open() { V3.shore.close(); V3.collection.open('fish'); }, entries, mount, portrait };
})(window.V3);
