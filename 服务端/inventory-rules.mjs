// dist/inventory-rules.mjs — 由 web/build.mjs 从 web/src/58-inventory-rules.js 生成，别手改。用法见 docs/INVENTORY-V2.md。
// build 20261126-1840
const __root = {};
(function (window, globalThis) {
// 58-inventory-rules.js — 小屋收藏存档的规则（v2）。纯数据、纯函数：不碰 DOM、THREE、localStorage、网络。
// 两处共用同一份规则：
//   · 页面（V3.inventoryRules）：59-cabin-inventory 的本地存档（离线成品）直接用它算每一个操作；
//   · 本机小屋服务：build.mjs 另外产出 dist/inventory-rules.mjs，服务端 import 后只负责 rev / 幂等 / 落盘（见 docs/INVENTORY-V2.md）。
// 存档 inventory（v2）：
//   found[kind]  = { n, first, last, items: [{ uid, size, pat, at }] }   n === items.length；n 可以是 0（见过、但都卖掉了：图鉴仍算找到）
//                  size = 最长边（毫米，一位小数），pat = 花纹 id（PATTERNS）
//   placements[slot] = { id, kind, uid, placedAt, by, returnAt? }        摆件：具体哪一枚
//   trash, cleaned  垃圾：待清理 / 已清理件数
//   coins           贝币（清理垃圾、卖贝壳得到；买零食花掉）
//   snacks          [{ uid, sku, left, at }]                               一件 = 一盒 / 一袋 / 一杯（瓶），left = 还剩几份 / 几口
//   tray            { rev, items: [{ uid, x, z, ry, flip }] }              沙盘展示盒：厘米，原点在沙盘中心（内框 TRAY.w × TRAY.d）
// 王冠不存盘：按尺寸在本种区间里的位置算（crown）。区间以后调了，王冠跟着变。
(function (root) {
  'use strict';
  const VERSION = 2;
  const FORMAT = 'cabin-inventory-v2', FORMAT_V1 = 'cabin-inventory-v1';
  const MAX_KINDS = 128, MAX_SLOTS = 128, MAX_ITEMS = 20000, MAX_SNACKS = 500, MAX_QTY = 20;
  const MAX_COUNT = 1_000_000_000, MAX_TIME = 253_402_300_799_999, MAX_REV = MAX_COUNT;   // 服务端自己的 id 账本另有上限
  const TRAY = Object.freeze({ w: 90, d: 60, max: 80 });            // 沙盘内框（厘米）和最多摆几枚
  const CHIME_SLOTS = Object.freeze({ door: Object.freeze({ strands: 5, beads: 5, length: 80, name: '门上的风铃' }),
    window: Object.freeze({ strands: 3, beads: 4, length: 45, name: '窗边的风铃' }) });
  const CHIME = Object.freeze({ minGap: 2, maxGap: 12, gap: 4 });
  const emptyChimes = () => Object.fromEntries(Object.entries(CHIME_SLOTS).map(([slot, spec]) =>
    [slot, { rev: 0, bar: 'driftwood', strands: Array.from({ length: spec.strands }, () => []) }]));
  const decoratable = k => !!k && (!k.category || k.category === 'collectible' && k.decoratable === true);
  const chimeable = k => decoratable(k) && k.chimeable !== false;
  const SIZE_SPAN = [0.7, 1.3];                                       // 默认尺寸区间 = 标准尺寸 × 这个范围
  const CROWN = 0.05;                                                 // 落在区间两端 5% 内 → 王冠
  const PRICE = Object.freeze({ common: 1, uncommon: 3, rare: 5, ultra: 50 });  // 卖一枚贝壳得几个贝币（按稀有度）
  const TRASH_COIN = 1;                                               // 清理一件垃圾得几个贝币
  const SELL_LIMIT = 200;
  // 花纹：w = 冲上岸时的权重（合计 100）；rare = 稀有花纹（界面上特别标出）。具体怎么上色在 30-shell-variants.js
  const PATTERNS = Object.freeze([
    { id: 'plain', name: '原色', w: 70 },
    { id: 'sunset', name: '晚霞', w: 9 },
    { id: 'mist', name: '雾蓝', w: 8 },
    { id: 'ring', name: '环纹', w: 6 },
    { id: 'dots', name: '斑点', w: 4 },
    { id: 'albino', name: '白化', w: 1.5, rare: true },
    { id: 'iris', name: '虹彩', w: 1.5, rare: true },
  ].map(Object.freeze));
  const PAT = new Map(PATTERNS.map((p) => [p.id, p]));

  const reserved = new Set(['__proto__', 'prototype', 'constructor']);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const dict = () => Object.create(null);
  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  const time = (v) => integer(v, 0, MAX_TIME);
  const count = (v) => integer(v, 0, MAX_COUNT);
  const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:\/-]{0,159}$/.test(v) && !reserved.has(v);
  const label = (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(v) && !reserved.has(v);
  const actor = (v) => v === 'player' || v === 'girl';
  const round1 = (v) => Math.round(v * 10) / 10;

  class InventoryError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const bad = (ok) => { if (!ok) throw new InventoryError(400, 'invalid_input'); };
  const conflict = (code) => { throw new InventoryError(409, code); };
  function shape(v, required, optional = []) {
    return record(v) && required.every((k) => own(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
  }

  // ---- 稳定的哈希（FNV-1a）→ [0, 1)：旧存档补实例、旧沙滩物件补尺寸，同一个输入永远同一个结果 ----
  function hash01(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }
  const seeded = (s) => { let i = 0; return () => hash01(s + '#' + (i++)); };

  // ---- 目录：kind(id) → { id, rarity, size(米), category, sizeRange?: [毫米, 毫米] } | null；snack(sku) → { sku, pack, count, price } | null ----
  // 规则对目录宽容：不认识的种类照样能收（尺寸只查是不是个合理的正数，卖价按常见算），新版页面配旧版服务端不会卡住。
  function catalogFrom(kinds = [], snacks = []) {
    const K = new Map(), S = new Map();
    for (const k of kinds) if (k && k.id) K.set(k.id, { id: k.id, rarity: k.rarity || 'common', size: +k.size || 0, category: k.category || 'collectible', decoratable: decoratable(k), chimeable: chimeable(k), ...(k.sizeRange ? { sizeRange: k.sizeRange } : {}) });
    for (const s of snacks) if (s && s.sku) S.set(s.sku, { sku: s.sku, pack: s.pack, count: s.count, price: s.price });
    return { kind: (x) => K.get(x) || null, snack: (x) => S.get(x) || null, kinds: () => [...K.values()], snacks: () => [...S.values()] };
  }
  const NO_CATALOG = catalogFrom();

  function sizeRange(kind) {
    if (!kind) return null;
    if (Array.isArray(kind.sizeRange)) return kind.sizeRange;
    if (!(kind.size > 0)) return null;
    return [round1(kind.size * 1000 * SIZE_SPAN[0]), round1(kind.size * 1000 * SIZE_SPAN[1])];
  }
  // 尺寸在本种区间里的位置 0..1（不认识的种类 → null）
  function sizeT(kind, mm) {
    const r = sizeRange(kind);
    return r && r[1] > r[0] ? Math.min(1, Math.max(0, (mm - r[0]) / (r[1] - r[0]))) : null;
  }
  function crown(kind, mm) {
    const t = sizeT(kind, mm);
    return t == null ? null : t >= 1 - CROWN - 1e-9 ? 'big' : t <= CROWN + 1e-9 ? 'small' : null;   // 边界算在王冠里
  }
  // 冲上岸时掷一次尺寸：70% 三角分布（偏中间）+ 30% 均匀分布 → 大 / 小金冠各约 1.9%
  function rollSize(kind, rnd) {
    const r = sizeRange(kind); if (!r) return 0;
    const t = rnd() < 0.7 ? (rnd() + rnd()) / 2 : rnd();
    return round1(r[0] + t * (r[1] - r[0]));
  }
  function rollPattern(rnd) {
    let x = rnd() * PATTERNS.reduce((a, p) => a + p.w, 0);
    for (const p of PATTERNS) { x -= p.w; if (x < 0) return p.id; }
    return PATTERNS[0].id;
  }
  // 一枚贝壳的固定属性（同一个 seed 永远一样）：旧版沙滩物件、旧版客户端发来的 collect 都用它补
  function seededTraits(kind, seed) {
    const rnd = seeded('traits:' + seed);
    return { size: rollSize(kind, rnd) || 0, pat: rollPattern(rnd) };
  }
  // v1 存档只有数量：每一枚按 (种类, 序号) 固定生成；原色、不会出王冠（t 夹在 0.06–0.94）
  function legacyItem(kind, kindId, i, at) {
    const r = sizeRange(kind), rnd = seeded('legacy:' + kindId + ':' + i);
    const t = 0.06 + 0.88 * (rnd() + rnd()) / 2;
    return { uid: 'legacy:' + kindId + ':' + i, size: r ? round1(r[0] + t * (r[1] - r[0])) : 0, pat: 'plain', at };
  }

  const SHELL_LOANS = Object.freeze(['moon', 'top_shell', 'nassa', 'periwinkle', 'wentletrap', 'carrier_shell', 'violet_snail', 'conch', 'nautilus', 'sundial', 'miter']);
  const FISH = Object.freeze({ goby: '点纹虾虎', silverside: '银线小鱼', wrasse: '青纹隆头鱼', blenny: '琥珀鳚', cardinal: '珊瑚天竺鲷', pipefish: '海草海龙', puffer: '星点小河鲀', mullet: '灰背鲻鱼', damsel: '蓝尾雀鲷', ponyfish: '月光鲾', halfbeak: '红尾半嘴鱼', filefish: '翡翠革鲀', flounder: '金沙比目鱼', anchovy: '玻璃鳀',
    seahorse: '卷尾海马', boxfish: '柠檬箱鲀', flyingfish: '银翼飞鱼', goatfish: '双须羊鱼', dragonet: '彩带鼠衔鱼', squirrelfish: '灯眼金鳞鱼', knifejaw: '黑带石鲷', sandray: '沙纹鳐',
    frogfish:'枫叶蛙鱼', pinecone:'金灯松球鱼', archer:'银弦射水鱼', bamboo:'星带竹鲨', dory:'铜镜海鲂', moray:'雪花海鳝', dolphin:'浪花小海豚', foldsail:'折帆鱼', rainbell:'雨铃鱼', moonray:'月蚀鳐', islet:'驮岛鱼' });
  const REEF_FISH = Object.freeze({ clown: '小丑鱼', tang: '蓝倒吊', bannerfish: '长鳍马夫鱼', butterfly: '铜带蝶鱼', parrotfish: '薄荷鹦嘴鱼', triggerfish: '星夜鳞鲀',
    lionfish: '绯羽狮子鱼', emperor: '金环神仙鱼', ribboneel: '蓝绸带鳗', manta: '云翼蝠鲼' });
  const FISH_FORMS = Object.freeze({ puffer: Object.freeze({ lagoon: '潟湖蓝带' }), seahorse: Object.freeze({ coral: '珊瑚环带' }),
    boxfish: Object.freeze({ midnight: '墨蓝星点' }), dragonet: Object.freeze({ orchid: '紫藤珠斑' }), lionfish: Object.freeze({ plum: '梅紫雪点' }),
    emperor: Object.freeze({ tide: '青潮弧带' }), manta: Object.freeze({ pearl: '珍珠星斑' }) });
  const shallowsPool = Object.keys(FISH), reefPool = Object.keys(REEF_FISH);
  // Nominal in-game adult length in centimetres. Size rolls and crown cutoffs
  // use the same distribution and within-species range as collectible shells.
  const fishCm = Object.freeze({
    goby:9, silverside:12, wrasse:18, blenny:11, cardinal:9, pipefish:20, puffer:16, mullet:32, damsel:10,
    ponyfish:15, halfbeak:24, filefish:21, flounder:25, anchovy:12, seahorse:13, boxfish:18, flyingfish:26,
    goatfish:24, dragonet:11, squirrelfish:22, knifejaw:33, sandray:54, frogfish:19, pinecone:16, archer:21,
    bamboo:70, dory:40, moray:62, dolphin:145, foldsail:26, rainbell:18, moonray:64, islet:78,
    clown:11, tang:23, bannerfish:21, butterfly:19, parrotfish:36, triggerfish:28, lionfish:29, emperor:32, ribboneel: 80, manta:165,
  });
  const fishPatterns = Object.freeze(['本纹','细珠斑','斜鞍带','波状纵纹']);
  const ribbonTail = new Set(['pipefish','seahorse','ribboneel','moray','sandray','moonray','manta','bamboo']);
  function fishTraits(kind, uid) {
    const rnd = seeded('fish-individual-v1:' + kind + ':' + uid);
    const standard = fishCm[kind] * 10, nominal = {size:standard / 1000};
    const size = rollSize(nominal,rnd);
    const pattern = Math.floor(rnd()*4), fin = Math.floor(rnd()*3);
    const finNames = ribbonTail.has(kind) ? ['常形尾','修长尾','短圆尾'] : ['常形鳍','舒展鳍','圆短鳍'];
    return {size, crown:crown(nominal,size), scale:size/standard, pattern, fin,
      patternName:fishPatterns[pattern], finName:finNames[fin]};
  }
  const reefUid = (epoch,index) => 'reef:' + epoch + ':' + index;
  function fishCrowns(shore, kind) {
    const measurements = shore?.measurements?.[kind];
    if (!measurements) return [];
    const nominal = {size:fishCm[kind]/100}, awards = [];
    if (crown(nominal, measurements.max) === 'big') awards.push('big');
    if (crown(nominal, measurements.min) === 'small') awards.push('small');
    return awards;
  }
  function fishLengthLabel(kind, size) {
    const award = crown({size:fishCm[kind]/100},size);
    return (size/10).toFixed(1) + ' 厘米' + (award === 'big' ? ' · 大金冠' : award === 'small' ? ' · 小金冠' : '');
  }
  function recordFish(shore, kind, traits) {
    const table = shore.measurements ||= dict(), previous = table[kind];
    const min = Math.min(previous?.min ?? traits.size,traits.size);
    const max = Math.max(previous?.max ?? traits.size,traits.size);
    const patterns = (previous?.patterns || 0) | (1 << traits.pattern);
    if (previous?.min === min && previous.max === max && previous.patterns === patterns) return false;
    table[kind] = { min, max, patterns }; return true;
  }
  const TANKS = Object.freeze([{ name:'原木小缸', slots:3, price:0 }, { name:'加宽鱼缸', slots:6, price:12 }, { name:'门廊落地缸', slots:12, price:24 }, { name:'潮湾超级大缸',slots:24,price:48 }].map(Object.freeze));
  const tankOf = shore => TANKS[shore?.tankTier ?? 0];
  const spaces=Object.freeze({knifejaw:2,frogfish:2,pinecone:2,archer:2,foldsail:2,rainbell:2,sandray:4,bamboo:4,dory:4,moray:4,moonray:4,islet:4,dolphin:6});
  const fishSlots = kind => spaces[kind] ?? 1;
  const fitsTank = (tier,kind) => kind!=='dolphin' || tier>=3;
  const usedSlots = shore => (shore?.fish || []).reduce((sum, fish) => sum + fishSlots(fish.kind), 0);
  const fitsBerth = (tier, berth) => tier < 2 || berth === null || berth === 'east' || berth === 'west';
  function arrival(fish) {
    if (fish.caughtAt !== undefined) return fish.caughtAt;
    const match = /^fish:(\d+)$/.exec(fish.uid), at = match ? Number(match[1]) * 300000 : NaN;
    return time(at) ? at : null;
  }
  const CAPTURES_PER_KIND = 10;
  function captureEntry(fish) {
    return { uid: fish.uid, form: fish.form || 'base', name: fish.name, caughtAt: arrival(fish) };
  }
  function legacyCaptures(shore, kind) {
    // Old saves retained individuals in the tank and in the list of released friends.
    // A species observation or a size record alone cannot identify the caught fish.
    return [...(shore?.fish || []), ...(shore?.released || [])]
      .filter(f => f.kind === kind).map(captureEntry)
      .sort((a, b) => (b.caughtAt ?? -1) - (a.caughtAt ?? -1))
      .slice(0, CAPTURES_PER_KIND);
  }
  function fishCaptures(shore, kind) {
    const rows = shore?.captures ? shore.captures[kind] || [] : legacyCaptures(shore, kind);
    return rows.map(row => ({ ...row, kind, status: shore.fish.some(f => f.uid === row.uid) ? 'resident' : 'released' }));
  }
  const homeDay = (fish, now) => { const at=arrival(fish); return at === null ? null : 1+Math.max(0,Math.floor(((fish.releasedAt ?? now)-at)/86400000)); };
  const ISLET_STAGES=Object.freeze([
    {day:1,name:'苔石',group:null,description:'鱼背上卧着一块覆满青苔的小石头。'},
    {day:3,name:'初枝',group:'coral_1',description:'第一枝杏红色的珊瑚从苔石的缝隙里探出头。'},
    {day:7,name:'双礁',group:'coral_2',description:'淡紫的珊瑚靠在红枝旁，两枝随鱼一起巡底。'},
    {day:10,name:'潮池',group:'tide_pool',description:'两丛珊瑚之间，浅浅的石洼里蓄起一汪水。'},
    {day:14,name:'穿潮拱',group:'tide_arch',description:'潮池旁拱起一道石桥，水从桥洞里穿过。'},
    {day:21,name:'花冠屿',group:'flower_crown',description:'一丛扇珊瑚朝鱼尾舒展开来，浅色海葵在枝下开成花冠。'},
  ].map(Object.freeze));
  function growthStage(day,kind) {
    if(day===null)return 2; // Undated legacy residents keep their previous adult / double-reef appearance.
    if(kind==='islet') {
      for(let i=ISLET_STAGES.length-1;i>0;i--)if(day>=ISLET_STAGES[i].day)return i;
      return 0;
    }
    return day>=7 ? 2 : day>=3 ? 1 : 0;
  }
  // Records without a snapshot predate six-stage islets; that release could only show stages 0–2.
  const departureStage=f=>f.islandStage ?? growthStage(homeDay(f,f.releasedAt));
  const emptyShore = () => ({ gift: null, loan: null, memory: null, berth: null, fish: [], observed: [], lastCatch: -1, tankTier:0, released:[] });
  const empty = () => ({ found: dict(), placements: dict(), trash: 0, cleaned: 0, coins: 0, snacks: [], tray: { rev: 0, items: [] }, shore: emptyShore(), chimes: emptyChimes(), garden: emptyGarden() });
  let zoneName, zoneFormat;
  function halfDay(at, zone) {
    if (zoneName !== zone || !zoneFormat) {
      bad(typeof zone === 'string' && zone.length > 0 && zone.length <= 64);
      try { zoneFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); }
      catch { throw new InventoryError(400, 'invalid_input'); }
      zoneName = zone;
    }
    const parts = Object.fromEntries(zoneFormat.formatToParts(at).map(part => [part.type, part.value]));
    return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}/${+parts.hour < 12 ? 'am' : 'pm'}`;
  }
  const slotKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}\/(am|pm)$/.test(value);
  const fishName = value => typeof value === 'string' && value === value.trim() && value.length <= 24 && !/[\u0000-\u001f\u007f]/.test(value);
  const encounter = at => Math.floor(at / 300000);
  const fishAt = epoch => shallowsPool[Math.floor(hash01('shallows:' + epoch) * shallowsPool.length)];
  const DAY=86400000, FRIEND_LIMIT=128;
  function friendAt(shore, epoch, rain=false) {
    const list=shore?.released, at=epoch*300000;
    if (!list?.length || hash01('return-tide:'+epoch)>=.25 || list.some(f=>f.visitedAt!==undefined && at-f.visitedAt<2*DAY)) return null;
    const eligible=list.filter(f=>at-f.releasedAt>=2*DAY && (f.visitedAt===undefined || at-f.visitedAt>=5*DAY) && (f.kind!=='rainbell' || rain));
    return eligible[Math.floor(hash01('return-friend:'+epoch)*eligible.length)] || null;
  }
  function fishFormAt(kind, epoch) {
    if (!own(FISH_FORMS, kind)) return 'base';
    const roll = hash01('fish-form:' + kind + ':' + epoch), forms = Object.keys(FISH_FORMS[kind]);
    return roll < .65 ? 'base' : forms[Math.floor((roll - .65) / .35 * forms.length)];
  }
  const knownForms = (shore, kind) => shore?.forms?.[kind] || (shore?.observed?.includes(kind) ? ['base'] : []);
  const fishFormName = (kind, form) => FISH_FORMS[kind]?.[form] || '原色';
  function noteFish(shore, kind, form) {
    const previous = knownForms(shore, kind);
    if (previous.includes(form)) return false;
    if (!shore.observed.includes(kind)) shore.observed.push(kind);
    if (own(FISH_FORMS, kind)) (shore.forms ||= dict())[kind] = [...previous, form];
    return true;
  }
  function observeFish(shore, kind, epoch, uid) {
    const learned = noteFish(shore, kind, fishFormAt(kind, epoch));
    const measured = recordFish(shore, kind, fishTraits(kind, uid));
    return learned || measured;
  }
  function reefAt(epoch) {
    const choices = reefPool.slice(), draw = seeded('reef:' + epoch);
    for (let index = 0; index < 3; index++) {
      const swap = index + Math.floor(draw() * (choices.length - index));
      [choices[index], choices[swap]] = [choices[swap], choices[index]];
    }
    return choices.slice(0, 3);
  }
  function parseShore(value, owner, used) {
    const next = emptyShore();
    if (value === undefined) return next;
    bad(shape(value, Object.keys(next).filter(key => key !== 'tankTier' && key !== 'released'), ['forms','tankTier','released','measurements','captures']));
    if (own(value,'tankTier')) { bad(integer(value.tankTier,0,TANKS.length-1)); next.tankTier=value.tankTier; }
    if (value.gift !== null) {
      bad(shape(value.gift, ['zone', 'slot']) && slotKey(value.gift.slot)); halfDay(0, value.gift.zone);
      next.gift = { ...value.gift };
    }
    if (value.loan !== null) { bad(id(value.loan) && SHELL_LOANS.includes(owner[value.loan]) && !used.has(value.loan)); next.loan = value.loan; }
    if (value.memory !== null) {
      const memory = value.memory;
      bad(shape(memory, ['uid', 'kind', 'pat', 'size', 'at']) && id(memory.uid) && SHELL_LOANS.includes(memory.kind) && label(memory.pat) && num(memory.size, 0, 5000) && time(memory.at));
      next.memory = { ...memory };
    }
    bad((value.berth === null || id(value.berth)) && fitsBerth(next.tankTier,value.berth)); next.berth = value.berth;
    bad(Array.isArray(value.observed) && value.observed.length <= shallowsPool.length + reefPool.length && value.observed.every(kind => own(FISH, kind) || own(REEF_FISH, kind)) && new Set(value.observed).size === value.observed.length);
    bad(integer(value.lastCatch, -1, encounter(MAX_TIME)) && Array.isArray(value.fish) && value.fish.length <= tankOf(next).slots);
    next.observed = [...value.observed]; next.lastCatch = value.lastCatch;
    if (own(value,'measurements')) {
      bad(record(value.measurements)); next.measurements = dict();
      for (const [kind,row] of Object.entries(value.measurements)) {
        bad(next.observed.includes(kind) && shape(row,['min','max','patterns']));
        const [lo,hi] = sizeRange({size:fishCm[kind]/100});
        bad(num(row.min,lo,hi) && num(row.max,row.min,hi) && integer(row.patterns,1,15));
        next.measurements[kind] = {...row};
      }
    }
    if (own(value, 'forms')) {
      bad(record(value.forms)); next.forms = dict();
      for (const [kind, forms] of Object.entries(value.forms)) {
        bad(own(FISH_FORMS, kind) && next.observed.includes(kind) && Array.isArray(forms) && forms.length > 0 && forms.length <= 1 + Object.keys(FISH_FORMS[kind]).length &&
          forms.every(form => typeof form === 'string' && (form === 'base' || own(FISH_FORMS[kind], form))) && new Set(forms).size === forms.length);
        next.forms[kind] = [...forms];
      }
    }
    const residents = new Set();
    next.fish = value.fish.map(fish => {
      bad(shape(fish, ['uid', 'kind', 'name', 'fed'], ['form','caughtAt']) && (!own(fish,'caughtAt') || time(fish.caughtAt)) && id(fish.uid) && !residents.has(fish.uid) && own(FISH, fish.kind) && fishName(fish.name) && time(fish.fed) &&
        knownForms(next, fish.kind).includes(own(fish, 'form') ? fish.form : 'base'));
      residents.add(fish.uid); return { ...fish };
    });
    bad(usedSlots(next) <= tankOf(next).slots && next.fish.every(fish=>fitsTank(next.tankTier,fish.kind)));
    if (own(value,'released')) {
      bad(Array.isArray(value.released) && value.released.length<=FRIEND_LIMIT);
      next.released=value.released.map(f=>{
        bad(shape(f,['uid','kind','name','releasedAt'],['form','caughtAt','visitedAt','islandStage']) && id(f.uid) && !residents.has(f.uid) && own(FISH,f.kind) && fishName(f.name) && time(f.releasedAt) &&
          (!own(f,'islandStage') || f.kind==='islet' && integer(f.islandStage,0,ISLET_STAGES.length-1)) &&
          (!own(f,'caughtAt') || time(f.caughtAt) && f.caughtAt<=f.releasedAt) && (!own(f,'visitedAt') || time(f.visitedAt) && f.visitedAt>=f.releasedAt) && knownForms(next,f.kind).includes(own(f,'form')?f.form:'base'));
        residents.add(f.uid);return {...f};
      });
    }
    // Existing residents and visiting friends carry an immutable uid from their encounter.
    // Reconstruct only records of actual individuals when opening a pre-measurement save.
    for (const fish of [...next.fish,...next.released]) recordFish(next,fish.kind,fishTraits(fish.kind,fish.uid));
    if (own(value,'captures')) {
      bad(record(value.captures));
      next.captures = dict();
      const seen = new Set();
      for (const [kind, rows] of Object.entries(value.captures)) {
        bad(own(FISH,kind) && next.observed.includes(kind) && Array.isArray(rows) && rows.length <= CAPTURES_PER_KIND);
        next.captures[kind] = rows.map(row => {
          bad(shape(row,['uid','form','name','caughtAt']) && id(row.uid) && !seen.has(row.uid) &&
            knownForms(next,kind).includes(row.form) && fishName(row.name) && (row.caughtAt === null || time(row.caughtAt)));
          seen.add(row.uid);
          recordFish(next,kind,fishTraits(kind,row.uid));
          return { ...row };
        }).sort((a,b) => (b.caughtAt ?? -1) - (a.caughtAt ?? -1));
      }
    } else if (residents.size) {
      next.captures = dict();
      for (const kind of new Set([...next.fish,...next.released].map(f => f.kind))) next.captures[kind] = legacyCaptures(next, kind);
    }
    return next;
  }
  const isV1 = (inv) => record(inv) && !own(inv, 'coins');

  // ---- 解析 + 校验（服务端读盘、restore、本地存档读盘都走这里）。v1 的 inventory 自动升级成 v2 ----
  function parseFound(v, catalog, v1) {
    bad(record(v) && Object.keys(v).length <= MAX_KINDS);
    const out = dict(), uids = new Set();
    let total = 0;
    for (const key of Object.keys(v).sort()) {
      const row = v[key];
      bad(label(key) && record(row) && time(row.first) && time(row.last) && row.first <= row.last);
      let items;
      if (v1 || !own(row, 'items')) {
        bad(shape(row, ['n', 'first', 'last'], ['items']) && integer(row.n, 1, MAX_ITEMS));
        const k = catalog.kind(key);
        items = Array.from({ length: row.n }, (_, i) => legacyItem(k, key, i, row.n > 1 ? Math.round(row.first + (row.last - row.first) * i / (row.n - 1)) : row.first));
      } else {
        bad(shape(row, ['n', 'first', 'last', 'items']) && Array.isArray(row.items) && integer(row.n, 0, MAX_ITEMS) && row.n === row.items.length);
        items = row.items.map((it) => {
          bad(shape(it, ['uid', 'size', 'pat', 'at']) && id(it.uid) && num(it.size, 0, 5000) && label(it.pat) && time(it.at));
          return { uid: it.uid, size: it.size, pat: it.pat, at: it.at };
        });
      }
      for (const it of items) { bad(!uids.has(it.uid)); uids.add(it.uid); }
      total += items.length;
      bad(total <= MAX_ITEMS);
      out[key] = { n: items.length, first: row.first, last: row.last, items };
    }
    return out;
  }
  function parseInventory(v, opt = {}) {
    const catalog = opt.catalog || NO_CATALOG, v1 = isV1(v);
    bad(record(v) && count(v.trash) && count(v.cleaned));
    bad(v1 ? shape(v, ['found', 'placements', 'trash', 'cleaned']) : shape(v, ['found', 'placements', 'trash', 'cleaned', 'coins', 'snacks', 'tray'], ['shore', 'chimes', 'garden']));
    const found = parseFound(v.found, catalog, v1);
    const owner = dict();
    for (const [k, f] of Object.entries(found)) for (const it of f.items) owner[it.uid] = k;
    const placements = dict(), used = new Set(), ids = new Set();
    bad(record(v.placements) && Object.keys(v.placements).length <= MAX_SLOTS);
    for (const slot of Object.keys(v.placements).sort()) {
      const row = v.placements[slot];
      const req = ['kind', 'placedAt', 'by'];
      bad(label(slot) && shape(row, opt.allowMissingPlacementId ? req : [...req, 'id'], ['id', 'returnAt', 'uid']) &&
        label(row.kind) && own(found, row.kind) && time(row.placedAt) && actor(row.by));
      let uid = row.uid;
      if (uid === undefined) uid = found[row.kind].items.map((it) => it.uid).find((u) => !used.has(u));   // v1 摆件：补上同种里第一枚没用上的
      bad(id(uid) && owner[uid] === row.kind && !used.has(uid));
      used.add(uid);
      const place = { kind: row.kind, uid, placedAt: row.placedAt, by: row.by };
      if (own(row, 'id')) { bad(id(row.id) && !ids.has(row.id)); ids.add(row.id); place.id = row.id; }
      if (own(row, 'returnAt')) { bad(time(row.returnAt)); place.returnAt = row.returnAt; }
      placements[slot] = place;
    }
    const inv = { found, placements, trash: v.trash, cleaned: v.cleaned, coins: 0, snacks: [], tray: { rev: 0, items: [] } };
    inv.shore = emptyShore();
    inv.chimes = emptyChimes();
    inv.garden = parseGarden(v.garden);
    if (v1) return inv;
    bad(count(v.coins) && Array.isArray(v.snacks) && v.snacks.length <= MAX_SNACKS && record(v.tray));
    inv.coins = v.coins;
    const su = new Set();
    inv.snacks = v.snacks.map((s) => {
      bad(shape(s, ['uid', 'sku', 'left', 'at']) && id(s.uid) && !su.has(s.uid) && label(s.sku) && integer(s.left, 1, 1000) && time(s.at));
      su.add(s.uid);
      return { uid: s.uid, sku: s.sku, left: s.left, at: s.at };
    });
    bad(shape(v.tray, ['rev', 'items']) && integer(v.tray.rev, 0, MAX_COUNT) && Array.isArray(v.tray.items));
    inv.tray = { rev: v.tray.rev, items: parseTrayItems(v.tray.items, owner, used) };
    for (const item of inv.tray.items) used.add(item.uid);
    inv.shore = parseShore(v.shore, owner, used);
    if (own(v, 'chimes')) {
      bad(shape(v.chimes, Object.keys(CHIME_SLOTS)));
      const seen = new Set();
      for (const slot of Object.keys(CHIME_SLOTS)) {
        const c = v.chimes[slot];
        bad(shape(c, ['rev', 'bar', 'strands']) && count(c.rev) && c.bar === 'driftwood');
        const strands = parseStrands(c.strands, slot, seen);
        checkChime(inv, slot, strands, catalog);
        inv.chimes[slot] = { rev: c.rev, bar: c.bar, strands };
      }
    }
    return inv;
  }
  function parseStrands(rows, slot, seen = new Set()) {
    const spec = CHIME_SLOTS[slot];
    bad(Array.isArray(rows) && rows.length === spec.strands);
    return Array.from(rows, row => {
      bad(Array.isArray(row) && row.length <= spec.beads);
      return Array.from(row, b => {
        bad(shape(b, ['uid', 'gap']) && id(b.uid) && !seen.has(b.uid) && integer(b.gap, CHIME.minGap, CHIME.maxGap));
        seen.add(b.uid); return { uid: b.uid, gap: b.gap };
      });
    });
  }
  // 读取快照时按原有布置资格验整串。提交新设计时，仅这座风铃原已挂着的实例可以沿用旧资格。
  function checkChime(inv, slot, rows, catalog, previouslyHung) {
    if (!rows.some(row => row.length)) return;
    const used = usedUids(inv, slot), items = new Map();
    for (const [kind, f] of Object.entries(inv.found)) for (const item of f.items) items.set(item.uid, { kind, size: item.size });
    for (const row of rows) {
      let mm = 0;
      for (const b of row) {
        const item = items.get(b.uid);
        if (!item) conflict('not_owned');
        if (used.has(b.uid)) conflict('in_use');
        const kind = catalog.kind(item.kind);
        bad(decoratable(kind));
        if (previouslyHung) bad(previouslyHung.has(b.uid) || chimeable(kind));
        mm += b.gap * 10 + item.size;
      }
      bad(mm <= CHIME_SLOTS[slot].length * 10 + 1e-9);
    }
  }
  function parseTrayItems(list, owner, used) {
    bad(Array.isArray(list) && list.length <= TRAY.max);
    const seen = new Set();
    return list.map((t) => {
      bad(shape(t, ['uid', 'x', 'z', 'ry'], ['flip']) && id(t.uid) && !seen.has(t.uid) &&
        num(t.x, -TRAY.w / 2, TRAY.w / 2) && num(t.z, -TRAY.d / 2, TRAY.d / 2) && num(t.ry, -1000, 1000) &&
        (t.flip === undefined || typeof t.flip === 'boolean'));
      if (owner) {
        if (!owner[t.uid]) conflict('not_owned');
        if (used && used.has(t.uid)) conflict('in_use');
      }
      seen.add(t.uid);
      const r = { uid: t.uid, x: round1(t.x), z: round1(t.z), ry: Math.round(t.ry * 1000) / 1000 };
      if (t.flip) r.flip = true;
      return r;
    });
  }

  // ---- 窗台花盆：播种当天先留一盆土，浇过水才算第一个生长日 ----
  const seedKinds = new Set(['beach_morning_glory', 'beach_bean', 'naupaka', 'crinum', 'sea_hibiscus']);
  const emptyGarden = () => ({ seeds: dict(), seen: [], bloomed: dict(), pot: null });
  const gardenDay = (at, zone) => halfDay(at, zone).split('/')[0];
  const gardenZone = (inv, preferred) => inv.shore?.gift?.zone || inv.garden?.zone || preferred || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const GARDEN_DAYS = Object.freeze([1, 3, 6, 9, 12]);
  const gardenStage = days => GARDEN_DAYS.filter(at => days >= at).length;
  const gardenReady = pot => !!pot && pot.watered.length >= Math.max(12, pot.harvested) + 3;
  const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().startsWith(day + 'T');
  function parseGarden(value) {
    const g = emptyGarden();
    if (value === undefined) return g;
    bad(shape(value, Object.keys(g), ['zone']) && record(value.seeds) && record(value.bloomed) && Array.isArray(value.seen));
    bad(value.seen.length <= seedKinds.size && value.seen.every(k => seedKinds.has(k)) && new Set(value.seen).size === value.seen.length);
    g.seen = value.seen.slice();
    for (const [k, n] of Object.entries(value.seeds)) { bad(g.seen.includes(k) && count(n)); g.seeds[k] = n; }
    for (const [k, at] of Object.entries(value.bloomed)) { bad(g.seen.includes(k) && time(at)); g.bloomed[k] = at; }
    if (own(value, 'zone')) { halfDay(0, value.zone); g.zone = value.zone; }
    const p = value.pot;
    if (p !== null) {
      bad(shape(p, ['kind','plantedAt','watered','harvested','by']) && g.seen.includes(p.kind) && time(p.plantedAt));
      bad(Array.isArray(p.watered) && p.watered.length <= MAX_ITEMS && Array.isArray(p.by) && p.by.length === p.watered.length && p.by.every(actor));
      bad(p.watered.every((day,i) => validDay(day) && (!i || day > p.watered[i-1])) &&
        (p.harvested === 0 || integer(p.harvested, 15, p.watered.length)) && (p.watered.length < 12 || own(g.bloomed, p.kind)));
      g.pot = { kind: p.kind, plantedAt: p.plantedAt, watered: p.watered.slice(), harvested: p.harvested, by: p.by.slice() };
    }
    return g;
  }
  function addSeeds(g, kind, n) {
    const total = (g.seeds[kind] || 0) + n;
    if (!count(total)) conflict('inventory_limit');
    const first = !g.seen.includes(kind);
    if (first) g.seen.push(kind);
    g.seeds[kind] = total;
    return { kind, first, gained: n };
  }
  function applyGarden(inv, cmd, now) {
    const g = inv.garden, p = g.pot;
    if (cmd.op === 'garden_plant') {
      if (p) conflict('pot_busy');
      if (!g.seeds[cmd.kind]) conflict('no_seed');
      g.seeds[cmd.kind]--;
      g.pot = { kind: cmd.kind, plantedAt: now, watered: [], harvested: 0, by: [] };
      return { kind: cmd.kind };
    }
    if (!p) conflict('pot_empty');
    if (cmd.op === 'garden_water') {
      const zone = gardenZone(inv, cmd.zone), day = gardenDay(now, zone);
      if (cmd.day !== day || cmd.zone && cmd.zone !== zone) conflict('day_changed');
      if (p.watered.length && p.watered[p.watered.length - 1] >= day) return false;
      if (p.watered.length >= MAX_ITEMS) conflict('inventory_limit');
      g.zone = zone; p.watered.push(day); p.by.push(cmd.by);
      const firstBloom = p.watered.length === 12 && !own(g.bloomed, p.kind);
      if (firstBloom) g.bloomed[p.kind] = now;
      return { kind: p.kind, day, by: cmd.by, firstBloom };
    }
    if (cmd.op === 'garden_harvest') {
      if (!gardenReady(p)) conflict('not_ready');
      const result = addSeeds(g, p.kind, hash01(cmd.id) < .5 ? 1 : 2);
      p.harvested = p.watered.length;
      return result;
    }
    g.pot = null;
    return { kind: p.kind };
  }

  // ---- 操作 ----
  function parseCommand(v, opt = {}) {
    const catalog = opt.catalog || NO_CATALOG;
    bad(record(v) && id(v.id) && v.id.length <= 128);
    const base = ['op', 'id'], cmd = { op: v.op, id: v.id };
    switch (v.op) {
      case 'garden_plant':
        bad(shape(v, [...base, 'kind']) && seedKinds.has(v.kind)); return { ...cmd, kind: v.kind };
      case 'garden_water':
        bad(shape(v, [...base, 'day', 'by'], ['zone']) && validDay(v.day) && actor(v.by));
        if (own(v, 'zone')) halfDay(0, v.zone);
        return { ...cmd, day: v.day, by: v.by, ...(v.zone ? { zone: v.zone } : {}) };
      case 'garden_clear': case 'garden_harvest':
        bad(shape(v, base)); return cmd;
      case 'shore_gift':
        bad(shape(v, [...base, 'zone', 'slot']) && slotKey(v.slot)); halfDay(0, v.zone);
        return { ...cmd, zone: v.zone, slot: v.slot };
      case 'shore_loan':
      case 'shore_berth':
        bad(shape(v, [...base, 'next', 'expected']) && [v.next, v.expected].every(value => value === null || id(value)));
        return { ...cmd, next: v.next, expected: v.expected };
      case 'shore_upgrade':
        bad(shape(v,[...base,'expected']) && integer(v.expected,0,TANKS.length-2));
        return { ...cmd, expected:v.expected };
      case 'shore_catch':
        bad(shape(v, [...base, 'epoch', 'berth'], ['kind']) && integer(v.epoch, 0, encounter(MAX_TIME)) && (v.berth === null || id(v.berth)) && (!own(v, 'kind') || own(FISH, v.kind)));
        return { ...cmd, epoch: v.epoch, berth: v.berth, ...(own(v, 'kind') ? {kind:v.kind} : {}) };
      case 'shore_inspect':
        bad(shape(v, [...base, 'epoch', 'kind']) && integer(v.epoch, 0, encounter(MAX_TIME)) && own(FISH, v.kind));
        return { ...cmd, epoch: v.epoch, kind: v.kind };
      case 'shore_visit':
        bad(shape(v,[...base,'epoch','uid','rain']) && integer(v.epoch,0,encounter(MAX_TIME)) && id(v.uid) && typeof v.rain==='boolean');
        return {...cmd,epoch:v.epoch,uid:v.uid,rain:v.rain};
      case 'shore_watch':
        bad(shape(v, [...base, 'epoch', 'kind'], ['index']) && integer(v.epoch, 0, encounter(MAX_TIME)) && own(REEF_FISH, v.kind));
        if (own(v,'index')) {
          // Six fish share the first species (two shoals), then three and two in the other slots.
          const capacity = [6,3,2][reefAt(v.epoch).indexOf(v.kind)] ?? 0;
          bad(integer(v.index,0,capacity-1));
        }
        return { ...cmd, epoch: v.epoch, kind: v.kind, ...(own(v,'index') ? {index:v.index} : {}) };
      case 'shore_fish':
        bad(shape(v, [...base, 'uid', 'action'], v.action === 'name' ? ['name'] : []) && id(v.uid) && ['name', 'feed', 'release'].includes(v.action));
        if (v.action === 'name') { bad(fishName(v.name)); cmd.name = v.name; }
        return { ...cmd, uid: v.uid, action: v.action };
      case 'collect': {
        if (v.category === 'seed') {
          bad(shape(v, [...base, 'kind', 'at', 'category']) && seedKinds.has(v.kind) && time(v.at));
          return { ...cmd, kind: v.kind, at: v.at, category: 'seed' };
        }
        bad(!seedKinds.has(v.kind));
        bad(shape(v, [...base, 'kind', 'at', 'category'], ['size', 'pat']) && label(v.kind) && time(v.at) &&
          (v.category === 'collectible' || v.category === 'trash'));
        Object.assign(cmd, { kind: v.kind, at: v.at, category: v.category });
        if (v.category === 'collectible') {
          const k = catalog.kind(v.kind), t = seededTraits(k, v.id);
          let size = own(v, 'size') ? v.size : t.size, pat = own(v, 'pat') ? v.pat : t.pat;
          bad(num(size, 0, 5000) && label(pat));
          const r = sizeRange(k);
          if (r) size = Math.min(r[1], Math.max(r[0], size));             // 认识的种类：夹进区间
          cmd.size = round1(size); cmd.pat = PAT.has(pat) ? pat : 'plain';
        }
        return cmd;
      }
      case 'place':
        bad(shape(v, [...base, 'kind', 'slot', 'by'], ['returnAt', 'uid']) && label(v.kind) && label(v.slot) && actor(v.by));
        if (own(v, 'returnAt')) { bad(time(v.returnAt)); cmd.returnAt = v.returnAt; }
        if (own(v, 'uid')) { bad(id(v.uid)); cmd.uid = v.uid; }
        return { ...cmd, kind: v.kind, slot: v.slot, by: v.by };
      case 'return':
        bad(shape(v, [...base, 'slot', 'by'], ['expectedId']) && label(v.slot) && actor(v.by));
        if (v.by === 'girl' || own(v, 'expectedId')) { bad(id(v.expectedId)); cmd.expectedId = v.expectedId; }
        return { ...cmd, slot: v.slot, by: v.by };
      case 'dispose':
        bad(shape(v, base));
        return cmd;
      case 'sell':
        bad(shape(v, [...base, 'uids']) && Array.isArray(v.uids) && v.uids.length >= 1 && v.uids.length <= SELL_LIMIT &&
          v.uids.every(id) && new Set(v.uids).size === v.uids.length);
        return { ...cmd, uids: v.uids.slice() };
      case 'buy':
        bad(shape(v, [...base, 'sku', 'qty']) && label(v.sku) && integer(v.qty, 1, MAX_QTY));
        return { ...cmd, sku: v.sku, qty: v.qty };
      case 'consume':
        bad(shape(v, [...base, 'uid', 'by']) && id(v.uid) && actor(v.by));
        return { ...cmd, uid: v.uid, by: v.by };
      case 'chime_set':
        bad(shape(v, [...base, 'slot', 'base', 'bar', 'strands', 'by'], ['via']) && typeof v.slot === 'string' && own(CHIME_SLOTS, v.slot) && count(v.base) && actor(v.by) && v.bar === 'driftwood' &&
          (!own(v, 'via') || typeof v.via === 'string' && v.via.length <= 128));
        return { ...cmd, slot: v.slot, base: v.base, bar: v.bar, strands: parseStrands(v.strands, v.slot), by: v.by, ...(own(v, 'via') ? { via: v.via } : {}) };
      case 'tray_set':
        bad(shape(v, [...base, 'base', 'items', 'by'], ['via']) && integer(v.base, 0, MAX_COUNT) && actor(v.by) &&
          (v.via === undefined || (typeof v.via === 'string' && v.via.length <= 128)));
        if (own(v, 'via')) cmd.via = v.via;
        return { ...cmd, base: v.base, items: parseTrayItems(v.items), by: v.by };
      case 'legacy': {
        bad(shape(v, [...base, 'found']));
        const found = parseFound(v.found, catalog, true);
        return { ...cmd, found };
      }
      case 'restore':
        bad(shape(v, [...base, 'rev', 'inventory']) && integer(v.rev, 0, MAX_REV));
        return { ...cmd, rev: v.rev, inventory: parseInventory(v.inventory, { catalog, allowMissingPlacementId: true }) };
      case 'reset':
        bad(shape(v, [...base, 'rev']) && integer(v.rev, 0, MAX_REV));
        return { ...cmd, rev: v.rev };
      default:
        throw new InventoryError(400, 'invalid_input');
    }
  }

  // 正在用的贝壳（摆件 + 沙盘）：不能卖、不能再摆
  function usedUids(inv, except) {
    const s = new Set();
    if (inv.shore?.loan) s.add(inv.shore.loan);
    for (const p of Object.values(inv.placements)) s.add(p.uid);
    if (except !== 'tray') for (const t of inv.tray.items) s.add(t.uid);
    for (const [slot, design] of Object.entries(inv.chimes || {})) if (slot !== except) for (const row of design.strands) for (const b of row) s.add(b.uid);
    return s;
  }
  function ownerOf(inv) {
    const m = dict();
    for (const [k, f] of Object.entries(inv.found)) for (const it of f.items) m[it.uid] = k;
    return m;
  }
  function available(inv, kind) {
    const f = inv.found[kind]; if (!f) return [];
    const used = usedUids(inv);
    return f.items.filter((it) => !used.has(it.uid));
  }
  const isEmpty = (inv) => !Object.keys(inv.found).length && !Object.keys(inv.placements).length && !inv.trash && !inv.cleaned &&
    !inv.coins && !inv.snacks.length && !inv.tray.items.length && !inv.garden?.seen.length &&
    !Object.values(inv.chimes || {}).some(c => c.strands.some(row => row.length)) && !(inv.shore?.tankTier || inv.shore?.gift || inv.shore?.memory || inv.shore?.berth || inv.shore?.observed.length);
  const priceOf = (catalog, kindId) => PRICE[(catalog.kind(kindId) || {}).rarity] || PRICE.common;

  function addFound(found, kind, items, first, last) {
    const f = found[kind];
    if (!f) {
      if (Object.keys(found).length >= MAX_KINDS) conflict('inventory_limit');
      found[kind] = { n: items.length, first, last, items: items.slice() };
      return;
    }
    if (f.n + items.length > MAX_ITEMS) conflict('inventory_limit');
    f.items.push(...items);
    f.n = f.items.length; f.first = Math.min(f.first, first); f.last = Math.max(f.last, last);
  }

  // apply(state, cmd, { clock, catalog }) → 结果对象 | false（什么也没变，例如 legacy 已经导入过）。state = { initialized, rev, inventory }；就地修改 state。
  function apply(s, cmd, opt = {}) {
    const clock = opt.clock || Date.now, catalog = opt.catalog || NO_CATALOG, inv = s.inventory;
    switch (cmd.op) {
      case 'garden_plant': case 'garden_water': case 'garden_harvest': case 'garden_clear':
        return applyGarden(inv, cmd, clock());
      case 'shore_gift': {
        const shore = inv.shore, zone = gardenZone(inv, cmd.zone), slot = halfDay(clock(), zone);
        if (cmd.slot !== slot || zone !== cmd.zone) conflict('shift_changed');
        if (shore.gift && shore.gift.slot >= slot) return false;
        if (!count(inv.coins + 1)) conflict('inventory_limit');
        shore.gift = { zone, slot }; inv.coins++; return { earned: 1 };
      }
      case 'shore_loan': {
        const shore = inv.shore;
        if (cmd.expected !== shore.loan) conflict('shore_changed');
        if (cmd.next === shore.loan) return false;
        if (cmd.next !== null) {
          const kind = ownerOf(inv)[cmd.next];
          if (!SHELL_LOANS.includes(kind)) conflict('shell_unsuitable');
          const item = available(inv, kind).find(row => row.uid === cmd.next);
          if (!item) conflict('in_use');
          if (!shore.memory) shore.memory = { kind, uid: item.uid, pat: item.pat, size: item.size, at: clock() };
        }
        shore.loan = cmd.next; return { loan: shore.loan };
      }
      case 'shore_berth': {
        if (cmd.expected !== inv.shore.berth) conflict('shore_changed');
        if (!fitsBerth(inv.shore.tankTier,cmd.next)) conflict('tank_berth');
        inv.shore.berth = cmd.next; return { berth: cmd.next };
      }
      case 'shore_upgrade': {
        const tier=(inv.shore.tankTier ?? 0)+1, offer=TANKS[tier];
        if (!offer || tier !== cmd.expected+1) conflict('shore_changed');
        if (!fitsBerth(tier,inv.shore.berth)) conflict('tank_berth');
        if (inv.coins < offer.price) conflict('not_enough_coins');
        inv.coins-=offer.price; inv.shore.tankTier=tier; return { tankTier:tier };
      }
      case 'shore_catch': {
        const shore = inv.shore, now = clock(), epoch = encounter(now);
        if (cmd.epoch !== epoch || epoch <= shore.lastCatch) conflict('fish_gone');
        if (cmd.berth !== null && cmd.berth !== shore.berth) conflict('shore_changed');
        const kind = fishAt(epoch);
        if (cmd.kind !== undefined && cmd.kind !== kind) conflict('fish_gone');
        if (cmd.berth !== null && !fitsTank(shore.tankTier,kind)) conflict('tank_too_small');
        if (cmd.berth !== null && usedSlots(shore)+fishSlots(kind)>tankOf(shore).slots) conflict('tank_full');
        const form = fishFormAt(kind, epoch);
        const uid = 'fish:' + epoch;
        if (cmd.berth !== null) shore.fish.push({ uid, kind, ...(form === 'base' ? {} : {form}), name: '', fed: 0, caughtAt:now });
        observeFish(shore,kind,epoch,uid);
        // A free-swimming dolphin greeting is recorded as an observation; no net was used.
        if (kind !== 'dolphin' || cmd.berth !== null) {
          const captures = shore.captures ||= dict();
          const rows = captures[kind] ||= [];
          rows.unshift({ uid, form, name: '', caughtAt: now });
          if (rows.length > CAPTURES_PER_KIND) rows.pop();
        }
        shore.lastCatch = epoch; return { kind };
      }
      case 'shore_visit': {
        const now=clock(), friend=friendAt(inv.shore,cmd.epoch,cmd.rain);
        if (encounter(now)!==cmd.epoch || !friend || friend.uid!==cmd.uid) conflict('fish_gone');
        friend.visitedAt=now;return {visitor:friend.uid};
      }
      case 'shore_watch': {
        const shore = inv.shore;
        if (cmd.epoch !== encounter(clock()) || !reefAt(cmd.epoch).includes(cmd.kind)) conflict('fish_gone');
        return observeFish(shore,cmd.kind,cmd.epoch,reefUid(cmd.epoch,cmd.index ?? 0)) ? {kind:cmd.kind} : false;
      }
      case 'shore_inspect': {
        if (cmd.epoch !== encounter(clock()) || cmd.kind !== fishAt(cmd.epoch)) conflict('fish_gone');
        return observeFish(inv.shore, cmd.kind, cmd.epoch, 'fish:' + cmd.epoch) ? {kind:cmd.kind} : false;
      }
      case 'shore_fish': {
        const residents = inv.shore.fish, index = residents.findIndex(fish => fish.uid === cmd.uid);
        if (index < 0) conflict('fish_gone');
        if (cmd.action === 'release') {
          const fish=residents[index], now=clock(), at=arrival(fish), list=inv.shore.released ||= [];
          list.push({uid:fish.uid,kind:fish.kind,name:fish.name,...(fish.form?{form:fish.form}:{}),...(at!==null?{caughtAt:Math.min(now,at)}:{}),releasedAt:now,
            ...(fish.kind==='islet'?{islandStage:growthStage(homeDay(fish,now),fish.kind)}:{})});
          if(list.length>FRIEND_LIMIT)list.shift();residents.splice(index,1);
        }
        else if (cmd.action === 'name') {
          const fish = residents[index];
          fish.name = cmd.name;
          const row = inv.shore.captures?.[fish.kind]?.find(f => f.uid === fish.uid);
          if (row) row.name = cmd.name;
        }
        else residents[index].fed = clock();
        return {};
      }
      case 'collect': {
        if (cmd.category === 'trash') {
          if (!count(inv.trash + 1)) conflict('inventory_limit');
          inv.trash++;
          return { kind: cmd.kind };
        }
        if (cmd.category === 'seed') return addSeeds(inv.garden, cmd.kind, 1);
        const owner = ownerOf(inv);
        if (owner[cmd.id]) conflict('id_reused');
        const item = { uid: cmd.id, size: cmd.size, pat: cmd.pat, at: cmd.at };
        addFound(inv.found, cmd.kind, [item], cmd.at, cmd.at);
        return { item, kind: cmd.kind, crown: crown(catalog.kind(cmd.kind), cmd.size) };
      }
      case 'place': {
        if (own(inv.placements, cmd.slot)) conflict('slot_occupied');
        if (Object.keys(inv.placements).length >= MAX_SLOTS) conflict('inventory_limit');
        const free = available(inv, cmd.kind);
        const it = cmd.uid ? free.find((x) => x.uid === cmd.uid) : free[0];
        if (!it) conflict(cmd.uid && ownerOf(inv)[cmd.uid] === cmd.kind ? 'in_use' : 'out_of_stock');
        const place = { id: cmd.id, kind: cmd.kind, uid: it.uid, placedAt: clock(), by: cmd.by };
        if (own(cmd, 'returnAt')) place.returnAt = cmd.returnAt;
        inv.placements[cmd.slot] = place;
        return { uid: it.uid };
      }
      case 'return': {
        const place = inv.placements[cmd.slot];
        if (!place) conflict('slot_empty');
        if (cmd.expectedId !== undefined && cmd.expectedId !== place.id) conflict('placement_changed');
        if (cmd.by === 'girl' && (place.returnAt === undefined || clock() < place.returnAt)) conflict('return_not_due');
        delete inv.placements[cmd.slot];
        return { uid: place.uid };
      }
      case 'dispose': {
        const disposed = inv.trash, earned = disposed * TRASH_COIN;
        if (!count(inv.cleaned + disposed) || !count(inv.coins + earned)) conflict('inventory_limit');
        // 回放一次已确认的清理时，不能把之后新捡的垃圾也清掉（幂等由调用方的 id 账本保证）
        inv.cleaned += disposed; inv.trash = 0; inv.coins += earned;
        return { disposed, earned };
      }
      case 'sell': {
        const owner = ownerOf(inv), used = usedUids(inv);
        for (const u of cmd.uids) { if (!owner[u]) conflict('not_owned'); if (used.has(u)) conflict('in_use'); }
        let earned = 0;
        const drop = new Set(cmd.uids);
        for (const u of cmd.uids) earned += priceOf(catalog, owner[u]);
        if (!count(inv.coins + earned)) conflict('inventory_limit');
        for (const k of new Set(cmd.uids.map((u) => owner[u]))) {
          const f = inv.found[k];
          f.items = f.items.filter((it) => !drop.has(it.uid)); f.n = f.items.length;   // n = 0 时保留：图鉴还记得见过
        }
        inv.coins += earned;
        return { sold: cmd.uids.length, earned };
      }
      case 'buy': {
        const sk = catalog.snack(cmd.sku);
        if (!sk || !(sk.price > 0) || !(sk.count > 0)) conflict('unknown_item');
        const cost = sk.price * cmd.qty;
        if (inv.coins < cost) conflict('not_enough_coins');
        if (inv.snacks.length + cmd.qty > MAX_SNACKS) conflict('inventory_limit');
        const at = clock(), bought = [];
        for (let i = 0; i < cmd.qty; i++) bought.push({ uid: cmd.id + ':' + i, sku: cmd.sku, left: sk.count, at });
        inv.snacks.push(...bought);
        inv.coins -= cost;
        return { cost, bought: bought.map((b) => b.uid) };
      }
      case 'consume': {
        const i = inv.snacks.findIndex((x) => x.uid === cmd.uid);
        if (i < 0) conflict('snack_gone');
        const sn = inv.snacks[i], sk = catalog.snack(sn.sku);
        sn.left--;
        let emptied = false;
        if (sn.left <= 0) {
          inv.snacks.splice(i, 1);
          // 杯 / 瓶喝完 → 空杯算一件垃圾，扔进垃圾桶再得 1 贝币
          if (sk && sk.pack === 'cup') { if (!count(inv.trash + 1)) conflict('inventory_limit'); inv.trash++; emptied = true; }
        }
        return { sku: sn.sku, left: Math.max(0, sn.left), emptied };
      }
      case 'chime_set': {
        if (cmd.base !== inv.chimes[cmd.slot].rev) conflict('chime_changed');
        if (cmd.base >= MAX_REV) conflict('inventory_limit');
        const previouslyHung = new Set(inv.chimes[cmd.slot].strands.flat().map(bead => bead.uid));
        checkChime(inv, cmd.slot, cmd.strands, catalog, previouslyHung);
        inv.chimes[cmd.slot] = { rev: cmd.base + 1, bar: cmd.bar, strands: cmd.strands.map(row => row.map(b => ({ ...b }))) };
        return { slot: cmd.slot, chimeRev: cmd.base + 1 };
      }
      case 'tray_set': {
        if (cmd.base !== inv.tray.rev) conflict('tray_changed');
        const owner = ownerOf(inv), placed = usedUids(inv, 'tray');
        for (const t of cmd.items) { if (!owner[t.uid]) conflict('not_owned'); if (placed.has(t.uid)) conflict('in_use'); }
        inv.tray = { rev: inv.tray.rev + 1, items: cmd.items.map((t) => ({ ...t })) };
        return { trayRev: inv.tray.rev };
      }
      case 'legacy':
        if (s.initialized || !Object.keys(cmd.found).length) return false;
        for (const [k, row] of Object.entries(cmd.found)) {
          // 旧浏览器档按种类计数；uid 已存在（同一份旧档导入第二次）就跳过
          const have = new Set((inv.found[k] ? inv.found[k].items : []).map((it) => it.uid));
          const items = row.items.filter((it) => !have.has(it.uid));
          if (items.length) addFound(inv.found, k, items, row.first, row.last);
        }
        s.initialized = true;
        return {};
      case 'restore':
        if (cmd.rev !== s.rev) conflict('revision_mismatch');
        if (!isEmpty(inv)) conflict('inventory_not_empty');
        // 还在路上的旧回调不能对上恢复出来的摆件
        for (const [slot, place] of Object.entries(cmd.inventory.placements)) place.id = 'restored/' + cmd.id.slice(0, 80) + '/' + slot;
        s.inventory = cmd.inventory;
        s.initialized = true;
        return {};
      case 'reset':
        if (cmd.rev !== s.rev) conflict('revision_mismatch');
        s.inventory = empty();
        s.initialized = true;
        return {};
    }
    throw new InventoryError(400, 'invalid_input');
  }

  // 一份完整存档文件（服务端 / 本地）：{ v, initialized, rev, inventory, seen }；v1 文件读进来就升级
  function parseState(v, opt = {}) {
    bad(record(v) && (v.v === 1 || v.v === VERSION) && typeof v.initialized === 'boolean' && integer(v.rev, 0, MAX_REV) && record(v.seen));
    const seen = dict();
    for (const k of Object.keys(v.seen)) { bad(id(k) && typeof v.seen[k] === 'string' && v.seen[k].length <= 128); seen[k] = v.seen[k]; }
    return { v: VERSION, initialized: v.initialized, rev: v.rev, inventory: parseInventory(v.inventory, opt), seen };
  }
  const freshState = () => ({ v: VERSION, initialized: false, rev: 0, inventory: empty(), seen: dict() });

  // 导出 / 导入的备份
  const exportData = (inv) => ({ format: FORMAT, inventory: inv });
  const isBackup = (b) => record(b) && (b.format === FORMAT || b.format === FORMAT_V1) && record(b.inventory);

  const R = {
    CHIME_SLOTS, CHIME, emptyChimes, decoratable, chimeable,
    gardenDay, gardenZone, gardenStage, gardenReady, GARDEN_DAYS,
    TANKS, tankOf, fishSlots, usedSlots, fitsBerth, fitsTank, homeDay, growthStage, ISLET_STAGES, departureStage, friendAt,
    fishTraits, fishCm, fishPatterns, reefUid, fishLengthLabel, fishCaptures, fishCrowns,
    VERSION, FORMAT, FORMAT_V1, TRAY, PATTERNS, PRICE, TRASH_COIN, SELL_LIMIT, CROWN, SIZE_SPAN, SHELL_LOANS, FISH, REEF_FISH, FISH_FORMS, halfDay, encounter, fishAt, reefAt, fishFormAt, fishFormName, knownForms,
    InventoryError, hash01, seeded, catalogFrom, sizeRange, sizeT, crown, rollSize, rollPattern, seededTraits, legacyItem,
    pattern: (p) => PAT.get(p) || PAT.get('plain'),
    empty, isV1, parseInventory, parseCommand, apply, parseState, freshState, usedUids, available, isEmpty, priceOf,
    exportData, isBackup,
  };
  if (root.V3) root.V3.inventoryRules = R;
  root.__cabinInventoryRules = R;
})(typeof window !== 'undefined' ? window : globalThis);

})(__root, __root);
const R = __root.__cabinInventoryRules;
export const CATALOG = {
 "kinds": [
  {
   "id": "scallop",
   "name": "扇贝",
   "rarity": "common",
   "size": 0.13,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "clam",
   "name": "花蛤",
   "rarity": "common",
   "size": 0.07,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "mussel",
   "name": "青口",
   "rarity": "common",
   "size": 0.09,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "moon",
   "name": "白玉螺",
   "rarity": "common",
   "size": 0.06,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "nassa",
   "name": "织纹螺",
   "rarity": "common",
   "size": 0.045,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "cowrie",
   "name": "虎斑宝贝",
   "rarity": "uncommon",
   "size": 0.12,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "starfish",
   "name": "海星",
   "rarity": "uncommon",
   "size": 0.15,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "miter",
   "name": "笔螺",
   "rarity": "uncommon",
   "size": 0.1,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "dollar",
   "name": "沙钱",
   "rarity": "uncommon",
   "size": 0.1,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "conch",
   "name": "女王凤凰螺",
   "rarity": "rare",
   "size": 0.16,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "nautilus",
   "name": "鹦鹉螺",
   "rarity": "rare",
   "size": 0.15,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "pearl",
   "name": "珍珠贝",
   "rarity": "rare",
   "size": 0.12,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "limpet",
   "name": "帽贝",
   "rarity": "common",
   "size": 0.07,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "oyster_shell",
   "name": "牡蛎壳",
   "rarity": "common",
   "size": 0.12,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "razor_clam",
   "name": "竹蛏壳",
   "rarity": "common",
   "size": 0.13,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "green_sea_glass",
   "name": "青绿海玻璃",
   "rarity": "common",
   "size": 0.065,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "striped_pebble",
   "name": "白纹卵石",
   "rarity": "common",
   "size": 0.09,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "driftwood",
   "name": "分叉浮木",
   "rarity": "common",
   "size": 0.16,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "kelp_ribbon",
   "name": "褐藻带",
   "rarity": "common",
   "size": 0.15,
   "category": "collectible",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "sea_bean",
   "name": "海漂心豆",
   "rarity": "common",
   "size": 0.065,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "barnacle_cluster",
   "name": "藤壶空壳",
   "rarity": "common",
   "size": 0.095,
   "category": "collectible",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "coral_fragment",
   "name": "珊瑚残枝",
   "rarity": "uncommon",
   "size": 0.12,
   "category": "collectible",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "sea_urchin_test",
   "name": "海胆空壳",
   "rarity": "uncommon",
   "size": 0.09,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "blue_glass_float",
   "name": "蓝玻璃浮球",
   "rarity": "uncommon",
   "size": 0.11,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "rainbow_abalone",
   "name": "虹彩鲍壳",
   "rarity": "rare",
   "size": 0.14,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "cockle",
   "name": "蜜桃鸟蛤",
   "rarity": "common",
   "size": 0.082,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "coquina",
   "name": "彩霞蝶贝",
   "rarity": "common",
   "size": 0.065,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "tusk_shell",
   "name": "象牙角贝",
   "rarity": "common",
   "size": 0.089,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "top_shell",
   "name": "薄荷钟螺",
   "rarity": "common",
   "size": 0.073,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "mermaids_eye",
   "name": "猫眼螺盖",
   "rarity": "common",
   "size": 0.056,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "winged_kelp",
   "name": "琥珀气囊藻",
   "rarity": "common",
   "size": 0.115,
   "category": "collectible",
   "decoratable": true,
   "chimeable": false
  },
  {
   "id": "sea_pottery",
   "name": "青花海陶片",
   "rarity": "common",
   "size": 0.08,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "ark_shell",
   "name": "栗纹蚶壳",
   "rarity": "common",
   "size": 0.097,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "venus_comb",
   "name": "维纳斯骨螺",
   "rarity": "uncommon",
   "size": 0.146,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "sundial",
   "name": "日晷螺",
   "rarity": "uncommon",
   "size": 0.096,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "violet_snail",
   "name": "紫罗兰浮螺",
   "rarity": "uncommon",
   "size": 0.084,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "lions_paw",
   "name": "狮爪扇贝",
   "rarity": "uncommon",
   "size": 0.132,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "red_coral",
   "name": "红珊瑚",
   "rarity": "rare",
   "size": 0.158,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "opal_ammonite",
   "name": "欧泊菊石",
   "rarity": "rare",
   "size": 0.147,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "periwinkle",
   "name": "灰纹玉黍螺",
   "rarity": "common",
   "size": 0.032,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "cuttlebone",
   "name": "乌贼白骨",
   "rarity": "common",
   "size": 0.154,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "pumice",
   "name": "蜂孔浮石",
   "rarity": "common",
   "size": 0.086,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "float_knot",
   "name": "盘绳浮标结",
   "rarity": "common",
   "size": 0.12,
   "category": "collectible",
   "decoratable": true,
   "chimeable": false
  },
  {
   "id": "wentletrap",
   "name": "梯纹螺",
   "rarity": "uncommon",
   "size": 0.065,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "carrier_shell",
   "name": "负壳螺",
   "rarity": "uncommon",
   "size": 0.092,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "chiton_plate",
   "name": "石鳖甲片",
   "rarity": "uncommon",
   "size": 0.041,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "skate_eggcase",
   "name": "鳐鱼空卵鞘",
   "rarity": "uncommon",
   "size": 0.101,
   "category": "collectible",
   "decoratable": true,
   "chimeable": false
  },
  {
   "id": "spiny_oyster",
   "name": "棘牡蛎壳",
   "rarity": "uncommon",
   "size": 0.122,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "crinoid_fossil",
   "name": "海百合茎化石",
   "rarity": "rare",
   "size": 0.081,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "giant_clam",
   "name": "砗磲空壳",
   "rarity": "rare",
   "size": 0.113,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "crab_molt_claw",
   "name": "螃蟹蜕下的小钳",
   "rarity": "common",
   "size": 0.054,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "drift_cork",
   "name": "海漂软木塞",
   "rarity": "common",
   "size": 0.047,
   "category": "collectible",
   "decoratable": true,
   "chimeable": false
  },
  {
   "id": "sea_bamboo",
   "name": "波纹海竹节",
   "rarity": "common",
   "size": 0.106,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "fan_alga",
   "name": "海扇藻叶",
   "rarity": "common",
   "size": 0.091,
   "category": "collectible",
   "decoratable": true,
   "chimeable": false
  },
  {
   "id": "mermaid_comb",
   "name": "人鱼梳",
   "rarity": "uncommon",
   "size": 0.104,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "gooseneck_cluster",
   "name": "鹅颈藤壶空簇",
   "rarity": "uncommon",
   "size": 0.083,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "crinoid_crown",
   "name": "海百合冠化石",
   "rarity": "rare",
   "size": 0.143,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "wreck_compass",
   "name": "沉船罗盘",
   "rarity": "rare",
   "size": 0.085,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "amber_shrimp",
   "name": "琥珀封虾",
   "rarity": "rare",
   "size": 0.064,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "silver_sail_badge",
   "name": "银帆船徽",
   "rarity": "rare",
   "size": 0.068,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "jade_branch",
   "name": "矿化流木",
   "rarity": "ultra",
   "size": 0.18,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "dragon_pearl",
   "name": "虹光海石",
   "rarity": "ultra",
   "size": 0.105,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "swallow_cowrie",
   "name": "瓷白宝螺",
   "rarity": "ultra",
   "size": 0.079,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "stone_bowl",
   "name": "凹面黑石",
   "rarity": "ultra",
   "size": 0.155,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "treasure_shell",
   "name": "宝藏螺",
   "rarity": "ultra",
   "size": 0.139,
   "category": "collectible",
   "decoratable": true,
   "chimeable": true
  },
  {
   "id": "plastic_cap",
   "name": "塑料瓶盖",
   "rarity": "common",
   "size": 0.06,
   "category": "trash",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "crushed_can",
   "name": "压扁的易拉罐",
   "rarity": "common",
   "size": 0.13,
   "category": "trash",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "tangled_fishing_line",
   "name": "缠成团的钓线",
   "rarity": "common",
   "size": 0.12,
   "category": "trash",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "broken_flipflop",
   "name": "断带拖鞋",
   "rarity": "common",
   "size": 0.15,
   "category": "trash",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "foil_wrapper",
   "name": "褪色糖纸",
   "rarity": "common",
   "size": 0.09,
   "category": "trash",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "beach_morning_glory",
   "name": "厚藤（马鞍藤）种子",
   "rarity": "common",
   "size": 0.036,
   "category": "seed",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "beach_bean",
   "name": "滨豇豆种子",
   "rarity": "common",
   "size": 0.049,
   "category": "seed",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "naupaka",
   "name": "草海桐种子",
   "rarity": "uncommon",
   "size": 0.041,
   "category": "seed",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "crinum",
   "name": "文殊兰种子",
   "rarity": "uncommon",
   "size": 0.081,
   "category": "seed",
   "decoratable": false,
   "chimeable": false
  },
  {
   "id": "sea_hibiscus",
   "name": "黄槿种子",
   "rarity": "rare",
   "size": 0.034,
   "category": "seed",
   "decoratable": false,
   "chimeable": false
  }
 ],
 "snacks": [
  {
   "sku": "blueberry",
   "name": "蓝莓",
   "pack": "box",
   "count": 12,
   "price": 4
  },
  {
   "sku": "nori",
   "name": "海苔",
   "pack": "bag",
   "count": 8,
   "price": 3
  },
  {
   "sku": "cake",
   "name": "蛋糕",
   "pack": "box",
   "count": 4,
   "price": 8
  },
  {
   "sku": "cocoa",
   "name": "热可可",
   "pack": "cup",
   "count": 3,
   "price": 4
  },
  {
   "sku": "honey",
   "name": "蜂蜜",
   "pack": "cup",
   "count": 3,
   "price": 5
  },
  {
   "sku": "bread",
   "name": "面包",
   "pack": "bag",
   "count": 6,
   "price": 4
  },
  {
   "sku": "chips",
   "name": "薯片",
   "pack": "bag",
   "count": 10,
   "price": 3
  },
  {
   "sku": "fish_cracker",
   "name": "小鱼饼干",
   "pack": "box",
   "count": 10,
   "price": 4
  },
  {
   "sku": "cookie",
   "name": "曲奇",
   "pack": "box",
   "count": 8,
   "price": 5
  },
  {
   "sku": "marshmallow",
   "name": "棉花糖",
   "pack": "bag",
   "count": 8,
   "price": 3
  },
  {
   "sku": "onigiri",
   "name": "饭团",
   "pack": "box",
   "count": 2,
   "price": 5
  },
  {
   "sku": "milk",
   "name": "牛奶",
   "pack": "cup",
   "count": 3,
   "price": 3
  },
  {
   "sku": "lemonade",
   "name": "柠檬汽水",
   "pack": "cup",
   "count": 3,
   "price": 3
  },
  {
   "sku": "pudding",
   "name": "布丁",
   "pack": "cup",
   "count": 3,
   "price": 4
  },
  {
   "sku": "strawberry",
   "name": "草莓",
   "pack": "box",
   "count": 6,
   "price": 5
  },
  {
   "sku": "mandarin",
   "name": "蜜橘",
   "pack": "box",
   "count": 8,
   "price": 3
  },
  {
   "sku": "apple",
   "name": "红苹果",
   "pack": "box",
   "count": 6,
   "price": 4
  },
  {
   "sku": "kiwi",
   "name": "猕猴桃",
   "pack": "box",
   "count": 6,
   "price": 4
  },
  {
   "sku": "watermelon",
   "name": "西瓜",
   "pack": "box",
   "count": 4,
   "price": 4
  },
  {
   "sku": "mango",
   "name": "芒果",
   "pack": "box",
   "count": 4,
   "price": 5
  },
  {
   "sku": "pretzel",
   "name": "海盐扭结饼",
   "pack": "box",
   "count": 4,
   "price": 4
  },
  {
   "sku": "sandwich",
   "name": "芝士三明治",
   "pack": "box",
   "count": 2,
   "price": 5
  },
  {
   "sku": "madeleine",
   "name": "贝壳玛德琳",
   "pack": "box",
   "count": 6,
   "price": 5
  },
  {
   "sku": "donut",
   "name": "巧克力甜甜圈",
   "pack": "box",
   "count": 2,
   "price": 6
  },
  {
   "sku": "barley_tea",
   "name": "焙麦茶",
   "pack": "cup",
   "count": 3,
   "price": 3
  },
  {
   "sku": "matcha",
   "name": "抹茶拿铁",
   "pack": "cup",
   "count": 3,
   "price": 5
  },
  {
   "sku": "peach_yogurt",
   "name": "白桃酸奶",
   "pack": "cup",
   "count": 3,
   "price": 4
  },
  {
   "sku": "sea_soda",
   "name": "海盐蓝汽水",
   "pack": "cup",
   "count": 3,
   "price": 4
  },
  {
   "sku": "durian",
   "name": "榴莲",
   "pack": "box",
   "count": 3,
   "price": 7
  },
  {
   "sku": "dried_fish",
   "name": "小鱼干",
   "pack": "box",
   "count": 6,
   "price": 4
  },
  {
   "sku": "berry_star",
   "name": "海星莓心饼",
   "pack": "box",
   "count": 4,
   "price": 5
  },
  {
   "sku": "osmanthus_oolong",
   "name": "桂花乌龙",
   "pack": "cup",
   "count": 3,
   "price": 4
  },
  {
   "sku": "birthday_cake",
   "name": "生日蛋糕",
   "pack": "box",
   "count": 6,
   "price": 12
  },
  {
   "sku": "bottled_milk",
   "name": "瓶装牛奶",
   "pack": "cup",
   "count": 3,
   "price": 4
  }
 ]
};
// 规则要用的目录（尺寸区间、卖价、零食价格）；服务端 parseCommand / apply / parseState 都传 { catalog }
export const catalog = R.catalogFrom(CATALOG.kinds, CATALOG.snacks);
export const { VERSION, FORMAT, FORMAT_V1, TRAY, CHIME_SLOTS, decoratable, chimeable, PATTERNS, PRICE, TRASH_COIN, CROWN, InventoryError, catalogFrom, sizeRange, sizeT, crown, rollSize, rollPattern, seededTraits, parseInventory, parseCommand, apply, parseState, freshState, usedUids, available, isEmpty, isV1, exportData, isBackup, gardenZone, gardenDay, gardenStage, gardenReady, GARDEN_DAYS } = R;
export default R;

// Use the same bounded NBT and schematic readers as the game for full-save imports.
const archive = { err() {} };
(function (window) {
// 12-nbt.js — Java 版 NBT（大端）读写、modified UTF-8、无符号 LEB128 varint、gzip。
//
// 约定以 docs/FORMAT.md 第 2、4 节为准。这里只管「字节 ↔ 带类型的 NBT 值」，不懂 Schematic
// （那是 13-share.js 的事）。所有页面都会加载本文件，所以加载时只定义函数，不碰 DOM。
//
// 带类型的 NBT 值，形状和 FORMAT.md 第 4 节 dump 里的 typed JSON 一样：
//   {byte:n} {short:n} {int:n} {long:"十进制字符串"} {float:"8 位小写十六进制（IEEE 位）"}
//   {double:"16 位小写十六进制"} {string:s} {byteArray:Int8Array} {intArray:Int32Array}
//   {longArray:BigInt64Array} {list:[值…]} {compound:{键:值}}
// - 读出来的 compound 是 N.Compound 的实例：原型链上没有 Object.prototype（没有 toString、
//   hasOwnProperty 这些继承来的键，键叫 "__proto__" 也只是普通的键）；比 Object.create(null)
//   省内存（实测一个空 compound 67 字节 vs 227 字节，标签数到上限时差 300 多 MB）。
//   判断有没有某个键用 `k in c` 或 Object.hasOwn(c, k)，别用 c.hasOwnProperty。
// - 标签总数最多 N.MAX_TAGS（2^21）个，读、写都数（FORMAT.md 第 2 节），超了 too_large。
// - 写的时候数组也可以是普通数组（byteArray 还可以是 Uint8Array，按原始字节写），
//   long 也可以给 BigInt。N.toJSON / N.fromJSON 在它和纯 JSON 之间转换。
// - list 不记元素类型（FORMAT.md 第 2 节，照 MC 26.1 ListTag）：读时「只有一个空键」的
//   compound 元素换成里面的值；写时同类型 → 那个类型，混合 → 10 并把需要的元素包一层。
//
// 出错一律抛 N.NbtError，code：
//   bad_nbt   读到的 NBT 不对（截断、未知类型、嵌套超过 512 层、编码不对……）
//   bad_gzip  解压失败
//   too_large 解压后超过上限（默认 64 MiB），或者标签总数超过 N.MAX_TAGS（读和写都会）
//   bad_value 要写的值不对（类型、范围、字符串太长、嵌套太深）
//   bad_varint  varint 数据不对（13-share.js 把它报成 bad_schematic）
(function (V3) {
  'use strict';

  const N = V3.nbt = {};

  const KIND_BY_ID = ['end', 'byte', 'short', 'int', 'long', 'float', 'double',
    'byteArray', 'string', 'list', 'compound', 'intArray', 'longArray'];
  const KIND_ID = Object.create(null);
  KIND_BY_ID.forEach((k, i) => { if (i) KIND_ID[k] = i; });
  // 每种标签的载荷最少几个字节（检查「声明的长度比剩下的字节还多」用）
  const MIN_SIZE = [0, 1, 2, 4, 8, 4, 8, 4, 2, 5, 1, 4, 4];

  N.TAG = Object.freeze(Object.assign(Object.create(null), KIND_ID, { end: 0 }));
  N.KINDS = Object.freeze(KIND_BY_ID.slice(1));
  N.MAX_DEPTH = 512;
  N.MAX_STRING_BYTES = 65535;
  N.MAX_UNZIPPED = 64 * 1024 * 1024;
  // 标签总数上限（FORMAT.md 第 2 节）：根 1 个；compound 每个成员 1 个；list 每个元素 1 个
  // （展开 {"": v} 之前数，包装和里面的值各 1 个）；数组不管多长 1 个；结束标记不算。
  N.MAX_TAGS = 2097152;

  // compound 的对象。原型是一个冻结的、自己也没有原型的空对象：读到 "__proto__"、
  // "constructor" 这种键只是普通的自有属性；V8 对这种对象用快速属性，比字典模式省很多内存。
  function Compound() {}
  Compound.prototype = Object.freeze(Object.create(null));
  N.Compound = Compound;
  const tooManyTags = (max) => `标签超过 ${String(max).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 个`;

  class NbtError extends Error {
    constructor(code, detail) {
      super(detail ? code + ': ' + detail : code);
      this.name = 'NbtError';
      this.code = code;
      this.detail = detail || '';
    }
  }
  N.NbtError = NbtError;
  function fail(code, detail) { throw new NbtError(code, detail); }

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const hex8 = (u) => (u >>> 0).toString(16).padStart(8, '0');
  const LONG_RE = /^(0|-?[1-9][0-9]*)$/;
  const HEX8_RE = /^[0-9a-f]{8}$/;
  const HEX16_RE = /^[0-9a-f]{16}$/;
  const LONG_MIN = -(2n ** 63n), LONG_MAX = 2n ** 63n - 1n;

  function asBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new TypeError('需要字节（Uint8Array 或 ArrayBuffer）');
  }
  N.asBytes = asBytes;

  function sub(path, key) {
    return path ? path + '.' + key : key;
  }

  // ---------- modified UTF-8（Java DataOutput.writeUTF / DataInput.readUTF） ----------

  function utfLength(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      n += (c >= 1 && c <= 0x7f) ? 1 : (c <= 0x7ff ? 2 : 3);
    }
    return n;
  }

  // 编码进 out[p…]，返回新的 p；调用方先保证空间够
  function utfEncodeInto(out, p, s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 1 && c <= 0x7f) {
        out[p++] = c;
      } else if (c <= 0x7ff) {
        out[p++] = 0xc0 | (c >> 6);
        out[p++] = 0x80 | (c & 0x3f);
      } else {
        out[p++] = 0xe0 | (c >> 12);
        out[p++] = 0x80 | ((c >> 6) & 0x3f);
        out[p++] = 0x80 | (c & 0x3f);
      }
    }
    return p;
  }

  // 和 JDK 的 readUTF 一样宽松：裸 00、过长编码（C0 80、E0 80 80）、单独的代理项都接受；
  // 首字节是 10xxxxxx / 1111xxxx、后续字节不是 10xxxxxx、字符没写完 → bad_nbt
  function utfDecode(b, start, end) {
    let out = '';
    let units = [];
    let i = start;
    while (i < end) {
      const c = b[i];
      let u;
      if (c < 0x80) {
        u = c;
        i += 1;
      } else if ((c & 0xe0) === 0xc0) {
        if (i + 2 > end) fail('bad_nbt', `字符串在第 ${i} 字节处，最后一个字没写完`);
        const c2 = b[i + 1];
        if ((c2 & 0xc0) !== 0x80) fail('bad_nbt', `字符串编码不对（第 ${i + 1} 字节）`);
        u = ((c & 0x1f) << 6) | (c2 & 0x3f);
        i += 2;
      } else if ((c & 0xf0) === 0xe0) {
        if (i + 3 > end) fail('bad_nbt', `字符串在第 ${i} 字节处，最后一个字没写完`);
        const c2 = b[i + 1], c3 = b[i + 2];
        if ((c2 & 0xc0) !== 0x80 || (c3 & 0xc0) !== 0x80) fail('bad_nbt', `字符串编码不对（第 ${i + 1} 字节）`);
        u = ((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f);
        i += 3;
      } else {
        fail('bad_nbt', `字符串编码不对（第 ${i} 字节是 0x${c.toString(16)}）`);
      }
      units.push(u);
      if (units.length >= 4096) {
        out += String.fromCharCode.apply(null, units);
        units = [];
      }
    }
    if (units.length) out += String.fromCharCode.apply(null, units);
    return out;
  }

  N.mutf8 = Object.freeze({
    byteLength(s) { return utfLength(String(s)); },
    encode(s) {
      if (typeof s !== 'string') fail('bad_value', '不是字符串');
      const n = utfLength(s);
      if (n > N.MAX_STRING_BYTES) fail('bad_value', `字符串编码后 ${n} 字节，超过 65535`);
      const out = new Uint8Array(n);
      utfEncodeInto(out, 0, s);
      return out;
    },
    decode(bytes, start, end) {
      const b = asBytes(bytes);
      return utfDecode(b, start == null ? 0 : start, end == null ? b.length : end);
    },
  });

  // ---------- 无符号 LEB128 varint（Blocks.Data） ----------

  N.varint = Object.freeze({
    // values：整数数组或 TypedArray，每个 0..2147483647 → Uint8Array
    encode(values) {
      const n = values.length;
      let len = 0;
      for (let i = 0; i < n; i++) {
        const v = values[i];
        if (!Number.isInteger(v) || v < 0 || v > 0x7fffffff) fail('bad_value', `第 ${i} 个值 ${v} 不是 0..2147483647 的整数`);
        len += v < 0x80 ? 1 : v < 0x4000 ? 2 : v < 0x200000 ? 3 : v < 0x10000000 ? 4 : 5;
      }
      const out = new Uint8Array(len);
      let p = 0;
      for (let i = 0; i < n; i++) {
        let v = values[i];
        while (v >= 0x80) {
          out[p++] = (v & 0x7f) | 0x80;
          v >>>= 7;
        }
        out[p++] = v;
      }
      return out;
    },
    // 正好读 count 个值，不能多也不能少字节；最多 5 字节、值 ≤ 2³¹−1；不要求最短编码
    decode(bytes, count) {
      const b = asBytes(bytes);
      const n = b.length;
      const out = new Int32Array(count);
      let p = 0;
      for (let i = 0; i < count; i++) {
        if (p >= n) fail('bad_varint', `只写了 ${i} 格，应该有 ${count} 格`);
        let c = b[p++];
        if (c < 0x80) {
          out[i] = c;
          continue;
        }
        let v = c & 0x7f;
        let shift = 7;
        for (;;) {
          if (p >= n) fail('bad_varint', `第 ${i} 格的编号没写完`);
          c = b[p++];
          if (shift === 28) {
            if (c > 0x07) fail('bad_varint', `第 ${i} 格的编号超过 5 字节或大于 2147483647`);
            v |= c << 28;
            break;
          }
          v |= (c & 0x7f) << shift;
          if (c < 0x80) break;
          shift += 7;
        }
        out[i] = v;
      }
      if (p !== n) fail('bad_varint', `${count} 格读完后还多出 ${n - p} 字节`);
      return out;
    },
  });

  // ---------- 读 ----------

  // 返回 {name, value: {compound:{…}}, end, tags}；根后面多出来的字节不管（end = 根结束的位置，
  // tags = 按 FORMAT.md 第 2 节数出来的标签数）。
  // opts.maxTags：标签总数上限，默认 N.MAX_TAGS（测试用小的值查数法）。
  N.read = function (bytes, opts) {
    const b = asBytes(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = b.length;
    const maxTags = opts && opts.maxTags != null ? opts.maxTags : N.MAX_TAGS;
    let p = 0;
    let depth = 0;
    let tags = 0;

    function need(k) {
      if (k > n - p) fail('bad_nbt', `数据在第 ${p} 字节处提前结束`);
    }
    // 每个标签在读它之前数（FORMAT.md 第 2 节）；第 maxTags+1 个就停，不再分配
    function countTag() {
      if (tags >= maxTags) fail('too_large', tooManyTags(maxTags));
      tags++;
    }
    function str() {
      need(2);
      const len = dv.getUint16(p);
      p += 2;
      need(len);
      const s = utfDecode(b, p, p + len);
      p += len;
      return s;
    }
    function arrayLength(size, what) {
      need(4);
      const len = dv.getInt32(p);
      p += 4;
      if (len < 0) fail('bad_nbt', `${what} 的长度是负数（${len}）`);
      if (len * size > n - p) fail('bad_nbt', `${what} 声明 ${len} 个元素，比剩下的字节还多`);
      return len;
    }
    function push() {
      if (depth >= N.MAX_DEPTH) fail('bad_nbt', '嵌套超过 512 层');
      depth++;
    }
    function compound() {
      push();
      const c = new Compound();
      for (;;) {
        need(1);
        const t = b[p++];
        if (t === 0) break;
        countTag();
        const key = str();
        if (t > 12) fail('bad_nbt', `未知的标签类型 ${t}（键 ${JSON.stringify(key)}）`);
        c[key] = payload(t);
      }
      depth--;
      return { compound: c };
    }
    function list() {
      push();
      need(5);
      const et = b[p];
      const count = dv.getInt32(p + 1);
      p += 5;
      if (count < 0) fail('bad_nbt', `列表长度是负数（${count}）`);
      if (et === 0 && count > 0) fail('bad_nbt', '列表元素类型是 0，长度却不是 0');
      const items = [];
      if (count > 0) {
        if (et > 12) fail('bad_nbt', `未知的列表元素类型 ${et}`);
        if (count * MIN_SIZE[et] > n - p) fail('bad_nbt', `列表声明 ${count} 个元素，比剩下的字节还多`);
        for (let i = 0; i < count; i++) {
          countTag();
          let v = payload(et);
          if (et === 10) {
            const c = v.compound;
            if ('' in c && Object.keys(c).length === 1) v = c[''];
          }
          items.push(v);
        }
      }
      depth--;
      return { list: items };
    }
    function payload(t) {
      switch (t) {
        case 1: need(1); return { byte: dv.getInt8(p++) };
        case 2: { need(2); const v = dv.getInt16(p); p += 2; return { short: v }; }
        case 3: { need(4); const v = dv.getInt32(p); p += 4; return { int: v }; }
        case 4: { need(8); const v = dv.getBigInt64(p); p += 8; return { long: String(v) }; }
        case 5: { need(4); const v = dv.getUint32(p); p += 4; return { float: hex8(v) }; }
        case 6: { need(8); const v = hex8(dv.getUint32(p)) + hex8(dv.getUint32(p + 4)); p += 8; return { double: v }; }
        case 7: {
          const len = arrayLength(1, 'byte array');
          const a = new Int8Array(len);
          a.set(new Int8Array(b.buffer, b.byteOffset + p, len));
          p += len;
          return { byteArray: a };
        }
        case 8: return { string: str() };
        case 9: return list();
        case 10: return compound();
        case 11: {
          const len = arrayLength(4, 'int array');
          const a = new Int32Array(len);
          for (let i = 0; i < len; i++, p += 4) a[i] = dv.getInt32(p);
          return { intArray: a };
        }
        case 12: {
          const len = arrayLength(8, 'long array');
          const a = new BigInt64Array(len);
          for (let i = 0; i < len; i++, p += 8) a[i] = dv.getBigInt64(p);
          return { longArray: a };
        }
        default: return fail('bad_nbt', `未知的标签类型 ${t}`);
      }
    }

    need(1);
    const t = b[p++];
    if (t !== 10) fail('bad_nbt', `根标签类型是 ${t}，必须是 compound（10）`);
    countTag();
    const name = str();
    const value = compound();
    return { name, value, end: p, tags };
  };

  // ---------- 写 ----------

  class Out {
    constructor(cap, maxTags) {
      this.b = new Uint8Array(cap);
      this.dv = new DataView(this.b.buffer);
      this.p = 0;
      this.tags = 0;
      this.maxTags = maxTags;
    }
    // 和读的时候一样数标签（顺序也一样：先数，再查这一层的深度）
    tag(path) {
      if (this.tags >= this.maxTags) fail('too_large', `${path || '根'}：${tooManyTags(this.maxTags)}`);
      this.tags++;
    }
    ensure(k) {
      if (this.p + k <= this.b.length) return;
      let cap = this.b.length * 2;
      while (cap < this.p + k) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(this.b.subarray(0, this.p));
      this.b = nb;
      this.dv = new DataView(nb.buffer);
    }
    u8(v) { this.ensure(1); this.b[this.p++] = v; }
    i16(v) { this.ensure(2); this.dv.setInt16(this.p, v); this.p += 2; }
    i32(v) { this.ensure(4); this.dv.setInt32(this.p, v); this.p += 4; }
    u32(v) { this.ensure(4); this.dv.setUint32(this.p, v); this.p += 4; }
    i64(v) { this.ensure(8); this.dv.setBigInt64(this.p, v); this.p += 8; }
    raw(bytes) { this.ensure(bytes.length); this.b.set(bytes, this.p); this.p += bytes.length; }
    utf(s, path) {
      if (typeof s !== 'string') fail('bad_value', `${path || '值'}：不是字符串`);
      const len = utfLength(s);
      if (len > N.MAX_STRING_BYTES) fail('bad_value', `${path || '值'}：字符串编码后 ${len} 字节，超过 65535`);
      this.ensure(2 + len);
      this.dv.setUint16(this.p, len);
      this.p = utfEncodeInto(this.b, this.p + 2, s);
    }
    result() { return this.b.slice(0, this.p); }
  }

  function kindOf(tag, path) {
    if (tag === null || typeof tag !== 'object' || Array.isArray(tag)) {
      fail('bad_value', `${path || '值'}：不是带类型的 NBT 值（应该像 {int: 1}）`);
    }
    const keys = Object.keys(tag);
    if (keys.length !== 1 || !(keys[0] in KIND_ID)) {
      fail('bad_value', `${path || '值'}：应该是只有一个类型键的对象（byte、short、int、long、float、double、string、byteArray、intArray、longArray、list、compound），实际键是 ${JSON.stringify(keys)}`);
    }
    return keys[0];
  }
  N.kindOf = function (tag) {
    try { return kindOf(tag, ''); } catch (e) { return null; }
  };

  function checkInt(v, lo, hi, path) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      fail('bad_value', `${path || '值'}：${String(v)} 不是 ${lo}..${hi} 的整数`);
    }
    return v;
  }
  function parseLong(v, path) {
    let big;
    if (typeof v === 'bigint') big = v;
    else if (typeof v === 'string' && LONG_RE.test(v)) big = BigInt(v);
    else fail('bad_value', `${path || '值'}：long 要写成十进制字符串（比如 "-5"），实际是 ${JSON.stringify(String(v))}`);
    if (big < LONG_MIN || big > LONG_MAX) fail('bad_value', `${path || '值'}：${v} 超出 long 的范围`);
    return big;
  }
  function parseHex(v, re, digits, path) {
    if (typeof v !== 'string' || !re.test(v)) {
      fail('bad_value', `${path || '值'}：要写成 ${digits} 位小写十六进制（IEEE 754 的位），实际是 ${JSON.stringify(String(v))}`);
    }
    return v;
  }
  function isWrapperShape(c) {
    return c !== null && typeof c === 'object' && hasOwn(c, '') && Object.keys(c).length === 1;
  }

  function writePayload(o, kind, v, path, depth) {
    switch (kind) {
      case 'byte': o.u8(checkInt(v, -128, 127, path) & 0xff); break;
      case 'short': o.i16(checkInt(v, -32768, 32767, path)); break;
      case 'int': o.i32(checkInt(v, -2147483648, 2147483647, path)); break;
      case 'long': o.i64(parseLong(v, path)); break;
      case 'float': o.u32(parseInt(parseHex(v, HEX8_RE, 8, path), 16)); break;
      case 'double': {
        const h = parseHex(v, HEX16_RE, 16, path);
        o.u32(parseInt(h.slice(0, 8), 16));
        o.u32(parseInt(h.slice(8), 16));
        break;
      }
      case 'string': o.utf(v, path); break;
      case 'byteArray': {
        if (v instanceof Int8Array || v instanceof Uint8Array || v instanceof Uint8ClampedArray) {
          o.i32(v.length);
          o.raw(v instanceof Uint8Array ? v : new Uint8Array(v.buffer, v.byteOffset, v.length));
        } else if (Array.isArray(v)) {
          o.i32(v.length);
          o.ensure(v.length);
          for (let i = 0; i < v.length; i++) o.b[o.p++] = checkInt(v[i], -128, 127, `${path}[${i}]`) & 0xff;
        } else {
          fail('bad_value', `${path || '值'}：byteArray 要是数组或 Int8Array`);
        }
        break;
      }
      case 'intArray': {
        if (!(v instanceof Int32Array) && !Array.isArray(v)) fail('bad_value', `${path || '值'}：intArray 要是数组或 Int32Array`);
        o.i32(v.length);
        for (let i = 0; i < v.length; i++) o.i32(checkInt(v[i], -2147483648, 2147483647, `${path}[${i}]`));
        break;
      }
      case 'longArray': {
        if (!(v instanceof BigInt64Array) && !Array.isArray(v)) fail('bad_value', `${path || '值'}：longArray 要是数组或 BigInt64Array`);
        o.i32(v.length);
        for (let i = 0; i < v.length; i++) o.i64(parseLong(v[i], `${path}[${i}]`));
        break;
      }
      case 'list': writeList(o, v, path, depth); break;
      case 'compound': writeCompound(o, v, path, depth); break;
      default: fail('bad_value', `${path || '值'}：未知类型 ${kind}`);
    }
  }

  // depth = 外面已经套了几层 compound / list；读的时候第 513 层会被拒，所以写的时候也拒
  function writeCompound(o, c, path, depth) {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) fail('bad_value', `${path || '值'}：compound 的值要是对象`);
    if (depth >= N.MAX_DEPTH) fail('bad_value', `${path || '值'}：嵌套超过 512 层`);
    for (const k of Object.keys(c)) {
      const kp = sub(path, k);
      o.tag(kp);
      const tag = c[k];
      const kind = kindOf(tag, kp);
      o.u8(KIND_ID[kind]);
      o.utf(k, kp + '（键）');
      writePayload(o, kind, tag[kind], kp, depth + 1);
    }
    o.u8(0);
  }

  function writeList(o, items, path, depth) {
    if (!Array.isArray(items)) fail('bad_value', `${path || '值'}：list 的值要是数组`);
    if (depth >= N.MAX_DEPTH) fail('bad_value', `${path || '值'}：嵌套超过 512 层`);
    const n = items.length;
    if (n === 0) {
      o.u8(0);
      o.i32(0);
      return;
    }
    const kinds = new Array(n);
    let same = true;
    for (let i = 0; i < n; i++) {
      kinds[i] = kindOf(items[i], `${path}[${i}]`);
      if (kinds[i] !== kinds[0]) same = false;
    }
    const et = same ? KIND_ID[kinds[0]] : 10;
    o.u8(et);
    o.i32(n);
    for (let i = 0; i < n; i++) {
      const k = kinds[i];
      const v = items[i][k];
      const ip = `${path}[${i}]`;
      o.tag(ip);
      if (et !== 10 || (k === 'compound' && !isWrapperShape(v))) {
        writePayload(o, k, v, ip, depth + 1);
      } else {
        // 包一层「只有一个空键」的 compound（MC 26.1 ListTag.wrapIfNeeded）。
        // 包装算 1 个标签（上面已经数了），里面的 "" 成员再算 1 个
        if (depth + 1 >= N.MAX_DEPTH) fail('bad_value', `${ip}：嵌套超过 512 层`);
        o.tag(ip);
        o.u8(KIND_ID[k]);
        o.utf('', ip);
        writePayload(o, k, v, ip, depth + 2);
        o.u8(0);
      }
    }
  }

  // root = {compound:{…}}；返回 Uint8Array（没压缩）。opts.maxTags 同 N.read（默认 N.MAX_TAGS）
  N.write = function (root, name, opts) {
    const kind = kindOf(root, '根');
    if (kind !== 'compound') fail('bad_value', `根标签必须是 compound，实际是 ${kind}`);
    const o = new Out(1024, opts && opts.maxTags != null ? opts.maxTags : N.MAX_TAGS);
    o.u8(10);
    o.tag('');
    o.utf(name == null ? '' : String(name), '根的名字');
    writeCompound(o, root.compound, '', 0);
    return o.result();
  };

  // ---------- gzip ----------

  // 时间戳 0、不写文件名、默认级别（CompressionStream 本来就是这样）。
  // 头里的 OS 字节在不同系统上不一样（zlib：Windows 10、Linux 3），统一改成 255（未知，
  // 和 Java 的 GZIPOutputStream 一样），保证同一份数据在哪台机器上写出来字节都一样。
  N.gzip = async function (bytes) {
    if (typeof CompressionStream !== 'function') throw new Error('这个浏览器不支持 CompressionStream，没法压缩（请换新版 Chrome / Edge / Firefox / Safari）');
    const stream = new Blob([asBytes(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    if (out.length >= 10 && out[0] === 0x1f && out[1] === 0x8b && out[3] === 0) out[9] = 0xff;
    return out;
  };

  // 解压出错时的说明：Node 的 DecompressionStream 抛的 TypeError 没有 message，有用的是 code（比如 Z_DATA_ERROR）
  function errText(e) {
    if (!e || typeof e !== 'object') return String(e);
    return [e.name, e.code, e.message].filter((s) => typeof s === 'string' && s).join(' ') || String(e);
  }

  // 边解压边数字节，超过 limit（默认 64 MiB）马上停 → too_large；其他问题 → bad_gzip
  N.gunzip = async function (bytes, limit) {
    if (typeof DecompressionStream !== 'function') throw new Error('这个浏览器不支持 DecompressionStream，没法解压（请换新版 Chrome / Edge / Firefox / Safari）');
    const max = limit == null ? N.MAX_UNZIPPED : limit;
    const input = asBytes(bytes);
    let reader;
    try {
      reader = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    } catch (e) {
      fail('bad_gzip', errText(e));
    }
    const chunks = [];
    let total = 0;
    for (;;) {
      let r;
      try {
        r = await reader.read();
      } catch (e) {
        fail('bad_gzip', errText(e));
      }
      if (r.done) break;
      const c = r.value instanceof Uint8Array ? r.value : asBytes(r.value);
      total += c.length;
      if (total > max) {
        reader.cancel().catch(() => {});
        fail('too_large', `解压后超过 ${max} 字节`);
      }
      chunks.push(c);
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  };

  N.readGzip = async function (bytes, limit, opts) {
    return N.read(await N.gunzip(bytes, limit), opts);
  };
  N.writeGzip = async function (root, name, opts) {
    return N.gzip(N.write(root, name, opts));
  };

  // ---------- 构造、转换、比较 ----------

  const scratch = new DataView(new ArrayBuffer(8));
  N.floatBits = function (x) { scratch.setFloat32(0, x); return hex8(scratch.getUint32(0)); };
  N.doubleBits = function (x) { scratch.setFloat64(0, x); return hex8(scratch.getUint32(0)) + hex8(scratch.getUint32(4)); };
  N.floatValue = function (h) { scratch.setUint32(0, parseInt(parseHex(h, HEX8_RE, 8, 'float'), 16)); return scratch.getFloat32(0); };
  N.doubleValue = function (h) {
    parseHex(h, HEX16_RE, 16, 'double');
    scratch.setUint32(0, parseInt(h.slice(0, 8), 16));
    scratch.setUint32(4, parseInt(h.slice(8), 16));
    return scratch.getFloat64(0);
  };

  N.byte = (v) => ({ byte: checkInt(v, -128, 127, 'byte') });
  N.short = (v) => ({ short: checkInt(v, -32768, 32767, 'short') });
  N.int = (v) => ({ int: checkInt(v, -2147483648, 2147483647, 'int') });
  N.long = (v) => ({ long: String(parseLong(typeof v === 'number' && Number.isSafeInteger(v) ? BigInt(v) : v, 'long')) });
  N.float = (x) => ({ float: N.floatBits(x) });
  N.double = (x) => ({ double: N.doubleBits(x) });
  N.string = (s) => { if (typeof s !== 'string') fail('bad_value', 'string：不是字符串'); return { string: s }; };
  N.byteArray = (a) => ({ byteArray: a instanceof Int8Array ? a : Int8Array.from(a) });
  N.intArray = (a) => ({ intArray: a instanceof Int32Array ? a : Int32Array.from(a) });
  N.longArray = (a) => ({ longArray: a instanceof BigInt64Array ? a : BigInt64Array.from(a, (x) => parseLong(typeof x === 'number' ? BigInt(x) : x, 'longArray')) });
  N.list = (items) => ({ list: Array.from(items) });
  N.compound = (obj) => {
    const c = new Compound();
    if (obj) for (const k of Object.keys(obj)) c[k] = obj[k];
    return { compound: c };
  };

  // 键叫 "__proto__" 时普通赋值会改原型，要用 defineProperty
  function setKey(o, k, v) {
    if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
    else o[k] = v;
  }

  // 带类型的值 → 纯 JSON（数组变普通数组、long 变十进制字符串），就是 dump 里的样子
  N.toJSON = function toJSON(tag) {
    const kind = kindOf(tag, '值');
    const v = tag[kind];
    switch (kind) {
      case 'byte': return { byte: v };
      case 'short': return { short: v };
      case 'int': return { int: v };
      case 'long': return { long: String(parseLong(v, 'long')) };
      case 'float': return { float: v };
      case 'double': return { double: v };
      case 'string': return { string: v };
      case 'byteArray': return { byteArray: Array.from(v, (x) => (x << 24) >> 24) };
      case 'intArray': return { intArray: Array.from(v, (x) => x | 0) };
      case 'longArray': return { longArray: Array.from(v, (x) => String(typeof x === 'bigint' ? x : parseLong(x, 'longArray'))) };
      case 'list': return { list: v.map(toJSON) };
      case 'compound': {
        const out = {};
        for (const k of Object.keys(v)) setKey(out, k, toJSON(v[k]));
        return { compound: out };
      }
    }
    return null;
  };

  // 纯 JSON → 带类型的值，严格检查（形状、范围、long 和十六进制的写法）
  N.fromJSON = function (json, path) {
    return fromJSON(json, path || '', 0);
  };
  function fromJSON(j, path, depth) {
    const kind = kindOf(j, path);
    const v = j[kind];
    switch (kind) {
      case 'byte': return { byte: checkInt(v, -128, 127, path) };
      case 'short': return { short: checkInt(v, -32768, 32767, path) };
      case 'int': return { int: checkInt(v, -2147483648, 2147483647, path) };
      case 'long': {
        if (typeof v !== 'string') fail('bad_value', `${path || '值'}：long 要写成十进制字符串`);
        parseLong(v, path);
        return { long: v };
      }
      case 'float': return { float: parseHex(v, HEX8_RE, 8, path) };
      case 'double': return { double: parseHex(v, HEX16_RE, 16, path) };
      case 'string':
        if (typeof v !== 'string') fail('bad_value', `${path || '值'}：不是字符串`);
        return { string: v };
      case 'byteArray': {
        if (!Array.isArray(v)) fail('bad_value', `${path || '值'}：byteArray 要是数组`);
        const a = new Int8Array(v.length);
        for (let i = 0; i < v.length; i++) a[i] = checkInt(v[i], -128, 127, `${path}[${i}]`);
        return { byteArray: a };
      }
      case 'intArray': {
        if (!Array.isArray(v)) fail('bad_value', `${path || '值'}：intArray 要是数组`);
        const a = new Int32Array(v.length);
        for (let i = 0; i < v.length; i++) a[i] = checkInt(v[i], -2147483648, 2147483647, `${path}[${i}]`);
        return { intArray: a };
      }
      case 'longArray': {
        if (!Array.isArray(v)) fail('bad_value', `${path || '值'}：longArray 要是数组`);
        const a = new BigInt64Array(v.length);
        for (let i = 0; i < v.length; i++) {
          if (typeof v[i] !== 'string') fail('bad_value', `${path}[${i}]：long 要写成十进制字符串`);
          a[i] = parseLong(v[i], `${path}[${i}]`);
        }
        return { longArray: a };
      }
      case 'list': {
        if (!Array.isArray(v)) fail('bad_value', `${path || '值'}：list 要是数组`);
        if (depth >= N.MAX_DEPTH) fail('bad_value', `${path || '值'}：嵌套超过 512 层`);
        return { list: v.map((x, i) => fromJSON(x, `${path}[${i}]`, depth + 1)) };
      }
      case 'compound': {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('bad_value', `${path || '值'}：compound 要是对象`);
        if (depth >= N.MAX_DEPTH) fail('bad_value', `${path || '值'}：嵌套超过 512 层`);
        const c = new Compound();
        for (const k of Object.keys(v)) c[k] = fromJSON(v[k], sub(path, k), depth + 1);
        return { compound: c };
      }
    }
    return null;
  }

  // 按 JSON 值比较（对象不管键的顺序）
  N.equalJSON = function eq(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    const arr = Array.isArray(a);
    if (arr !== Array.isArray(b)) return false;
    if (arr) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!hasOwn(b, k) || !eq(a[k], b[k])) return false;
    return true;
  };
})(window.V3);

// 13-share.js — 鲸图：方块数据（Sponge Schematic 第 3 版，.schem）+ 分享 PNG（数据放在 xjSc 块里）。
//
// 约定以 docs/FORMAT.md 为准；这里用 12-nbt.js（V3.nbt）读写 NBT。所有页面都会加载本文件，
// 加载时只定义函数，不碰 DOM。
//
// 模型（read 读出来的就是规范形式，FORMAT.md 第 4 节）：
//   {
//     size: [W, H, L],          // x / y / z 方向的格数
//     offset: [x, y, z],        // 第 (0,0,0) 格相对站立点的位置
//     dataVersion: 4790,        // MC 数据版本
//     meta: {compound:{…}} | null,   // Metadata 原样（带类型的 NBT，见 12-nbt.js）
//     palette: ['minecraft:air', …], // 状态字符串，原样保留
//     cells: Int32Array,        // 长 W×H×L，值是 palette 下标；格子 i = x + z×W + y×W×L
//     blockEntities: [{pos: [x, y, z], id: 'minecraft:chest', data: {compound:{…}} | null}],
//     warnings: ['data_version', …],
//   }
// 写的时候 cells 也可以是普通数组；palette 可以有没用到的、顺序随意（写出去会规范化）。
//
// API（都在 V3.share 上）：
//   await read(bytes)            PNG 或裸 .schem（也收 Blob/File）→ 模型；出错抛 ShareError
//   await readSchem(bytes)       只读 .schem（gzip）
//   extract(pngBytes)            从 PNG 里取出 .schem 字节（按 FORMAT.md 第 1 节检查）
//   await writeSchem(model)      → .schem 字节
//   await writePng(model, png?)  → 鲸图 PNG 字节；不给 png 就用 16×16 纯色占位图
//   dump(model) / fromDump(json) 和 FORMAT.md 第 4 节的 dump 互转
//   canonicalize(model)          规范化（不改原模型）
//   requiredMods(palette)        调色板里不是 minecraft 的命名空间，排好序
//   ShareError                   e.code = FORMAT.md 第 5 节的代码，e.message = 给用户看的中文
//   png.{isPng, crc32, chunks, chunk, setChunk, solid}   PNG 小工具
(function (V3) {
  'use strict';

  const S = V3.share = {};

  S.DATA_VERSION = 4790;       // MC 26.1.2
  S.SPONGE_VERSION = 3;
  S.FORMAT_VERSION = 1;
  S.SOURCE = 'haibian-web/4.0.0-dev';
  S.CHUNK_TYPE = 'xjSc';
  S.LIMITS = Object.freeze({
    side: 1024,
    cells: 4194304,
    palette: 65536,
    chunk: 16777216,
    unzipped: 67108864,
    tags: 2097152,
  });

  S.MESSAGES = Object.freeze({
    unknown_file: '这不是鲸图（PNG）也不是 .schem 文件。',
    bad_png: '图片文件不完整，可能没下载完。请重新保存原图再试。',
    no_data: '这张图里没有方块数据。聊天软件（微信、QQ 等）发图时常会压缩图片、去掉附加数据。请让对方「发送原图」或者把图片当文件发，再试一次。',
    multiple_data: '这张图里有好几份方块数据，不知道该用哪份。',
    bad_crc: '方块数据损坏了。请让对方重新发原文件。',
    too_large: '这个建筑太大了，或者里面的东西太多了（上限：每边 1024 格，总共 4,194,304 格）。',
    bad_gzip: '方块数据损坏了（解压失败）。',
    bad_nbt: '方块数据损坏了（数据结构不对）。',
    unsupported_version: '这个文件是 Sponge 第 N 版格式，现在只支持第 3 版。',
    bad_schematic: '方块数据不完整：',
    bad_dump: 'dump 不对：',
  });

  // code：FORMAT.md 第 5 节的代码（另有 bad_dump：fromDump 收到的 JSON 不对）
  // detail：具体哪里不对（bad_schematic、bad_dump 会接在 message 后面，其他只留在 e.detail 里）
  class ShareError extends Error {
    constructor(code, detail, extra) {
      let msg = S.MESSAGES[code] || code;
      if (code === 'unsupported_version') msg = msg.replace('N', String(extra && extra.version));
      if (code === 'bad_schematic' || code === 'bad_dump') msg += detail || '（没写具体原因）';
      super(msg);
      this.name = 'ShareError';
      this.code = code;
      this.detail = detail || '';
      if (extra) Object.assign(this, extra);
    }
  }
  S.ShareError = ShareError;

  function bad(detail) { throw new ShareError('bad_schematic', detail); }
  function nbt() {
    if (!V3.nbt) throw new Error('13-share.js 需要先加载 12-nbt.js');
    return V3.nbt;
  }
  async function toBytes(x) {
    if (typeof Blob !== 'undefined' && x instanceof Blob) return new Uint8Array(await x.arrayBuffer());
    return nbt().asBytes(x);
  }
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isInt32 = (v) => typeof v === 'number' && (v | 0) === v;
  const q = (s) => JSON.stringify(s);

  // ---------- PNG 小工具 ----------

  const SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  let CRC_TABLE = null;

  function crc32(bytes, start, end) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c;
      }
    }
    const b = nbt().asBytes(bytes);
    const e = end == null ? b.length : end;
    let c = -1;
    for (let i = start || 0; i < e; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function isPng(b) {
    if (b.length < 8) return false;
    for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) return false;
    return true;
  }

  function typeAt(b, p) {
    return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  }

  function concat(parts) {
    let n = 0;
    for (const x of parts) n += x.length;
    const out = new Uint8Array(n);
    let p = 0;
    for (const x of parts) {
      out.set(x, p);
      p += x.length;
    }
    return out;
  }

  // 一个完整的块：长度 + 类型 + 数据 + CRC（类型 + 数据）
  function chunk(type, data) {
    if (typeof type !== 'string' || !/^[A-Za-z]{4}$/.test(type)) throw new TypeError('PNG 块类型要是 4 个英文字母：' + q(type));
    const d = nbt().asBytes(data || new Uint8Array(0));
    const out = new Uint8Array(12 + d.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, d.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(d, 8);
    dv.setUint32(8 + d.length, crc32(out, 4, 8 + d.length));
    return out;
  }

  // 走一遍块，到 IEND 为止：[{type, start, length, end, crc, crcOk?}]；结构坏了 → bad_png
  // （通用的走法，给写入和 info 用；读鲸图用 extract，那里的检查顺序按 FORMAT.md 第 1 节）
  function chunks(bytes, opts) {
    const b = nbt().asBytes(bytes);
    if (!isPng(b)) throw new ShareError('bad_png', '开头不是 PNG 签名');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const withCrc = !!(opts && opts.crc);
    const list = [];
    let p = 8;
    for (;;) {
      if (p + 8 > b.length) throw new ShareError('bad_png', p >= b.length ? '到文件末尾还没遇到 IEND' : `第 ${p} 字节处块头不完整`);
      const len = dv.getUint32(p);
      const type = typeAt(b, p + 4);
      if (len > b.length - p - 12) throw new ShareError('bad_png', `${q(type)} 块的长度 ${len} 超出文件`);
      const c = { type, start: p, length: len, end: p + 12 + len, crc: dv.getUint32(p + 8 + len) };
      if (withCrc) c.crcOk = crc32(b, p + 4, p + 8 + len) === c.crc;
      list.push(c);
      p = c.end;
      if (type === 'IEND') return list;
    }
  }

  // 把 type 块换成 data（先删掉所有 type 块，新的放在 IEND 紧前面；IEND 后面多出来的字节丢掉）
  function setChunk(bytes, type, data) {
    const b = nbt().asBytes(bytes);
    const list = chunks(b);
    const parts = [SIG];
    for (const c of list) {
      if (c.type === 'IEND') parts.push(chunk(type, data));
      if (c.type !== type) parts.push(b.subarray(c.start, c.end));
    }
    return concat(parts);
  }

  // zlib 流，全部用「不压缩」块（结果和 zlib 版本无关，每次都一样）
  function zlibStored(raw) {
    const n = raw.length;
    const blocks = Math.max(1, Math.ceil(n / 65535));
    const out = new Uint8Array(2 + n + blocks * 5 + 4);
    out[0] = 0x78;
    out[1] = 0x01;
    let p = 2;
    for (let i = 0; i < blocks; i++) {
      const s = i * 65535;
      const len = Math.min(65535, n - s);
      out[p++] = i === blocks - 1 ? 1 : 0;
      out[p++] = len & 0xff;
      out[p++] = len >> 8;
      out[p++] = ~len & 0xff;
      out[p++] = (~len >> 8) & 0xff;
      out.set(raw.subarray(s, s + len), p);
      p += len;
    }
    let a = 1, c = 0;
    for (let i = 0; i < n; i++) {
      a = (a + raw[i]) % 65521;
      c = (c + a) % 65521;
    }
    new DataView(out.buffer).setUint32(p, ((c << 16) | a) >>> 0);
    return out;
  }

  // 纯色 RGB 小图（样例和「没给图」时的占位图）
  function solid(w, h, rgb) {
    w = w || 16;
    h = h || 16;
    const color = rgb || [0x4a, 0x90, 0xc8];
    const row = 1 + w * 3;
    const raw = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = y * row + 1 + x * 3;
        raw[o] = color[0];
        raw[o + 1] = color[1];
        raw[o + 2] = color[2];
      }
    }
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr[8] = 8;   // 每通道 8 位
    ihdr[9] = 2;   // RGB
    return concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND')]);
  }

  S.png = Object.freeze({ SIG, isPng: (x) => isPng(nbt().asBytes(x)), crc32, chunks, chunk, setChunk, solid });

  // ---------- 读 ----------

  // FORMAT.md 第 1 节：从第 9 字节起走到 IEND，遇到 xjSc 当场依次查 too_large → bad_png → bad_crc
  S.extract = function (bytes) {
    const b = nbt().asBytes(bytes);
    if (!isPng(b)) throw new ShareError('unknown_file');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let found = null;
    let count = 0;
    let p = 8;
    for (;;) {
      if (p + 8 > b.length) throw new ShareError('bad_png', p >= b.length ? '到文件末尾还没遇到 IEND' : `第 ${p} 字节处块头不完整`);
      const len = dv.getUint32(p);
      const type = typeAt(b, p + 4);
      if (type === S.CHUNK_TYPE) {
        if (len > S.LIMITS.chunk) throw new ShareError('too_large', `xjSc 声明 ${len} 字节，超过 16 MiB`);
        if (len > b.length - p - 12) throw new ShareError('bad_png', 'xjSc 块的数据不完整');
        if (crc32(b, p + 4, p + 8 + len) !== dv.getUint32(p + 8 + len)) throw new ShareError('bad_crc', `第 ${count + 1} 个 xjSc 块 CRC 不对`);
        count++;
        if (!found) found = b.slice(p + 8, p + 8 + len);
      } else if (len > b.length - p - 12) {
        throw new ShareError('bad_png', `${q(type)} 块的长度 ${len} 超出文件`);
      }
      p += 12 + len;
      if (type === 'IEND') break;
    }
    if (count === 0) throw new ShareError('no_data');
    if (count > 1) throw new ShareError('multiple_data', `有 ${count} 个 xjSc 块`);
    return found;
  };

  S.read = async function (input) {
    const b = await toBytes(input);
    if (isPng(b)) return S.readSchem(S.extract(b));
    if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return S.readSchem(b);
    throw new ShareError('unknown_file');
  };

  // NbtError / 栈溢出 → ShareError；别的异常（代码错误、浏览器不支持）原样抛
  function asShare(e, code) {
    if (e instanceof ShareError) return e;
    if (e instanceof nbt().NbtError) return new ShareError(e.code === 'too_large' ? 'too_large' : code, e.detail);
    if (e instanceof RangeError) return new ShareError(code, e.message);
    return e;
  }

  S.readSchem = async function (input) {
    const N = nbt();
    const b = await toBytes(input);
    let raw;
    try {
      raw = await N.gunzip(b, S.LIMITS.unzipped);
    } catch (e) {
      throw asShare(e, 'bad_gzip');
    }
    let root;
    try {
      root = N.read(raw, { maxTags: S.LIMITS.tags });
    } catch (e) {
      throw asShare(e, 'bad_nbt');
    }
    return S.fromNbt(root.value);
  };

  function kindIs(tag, kind) {
    return tag !== null && typeof tag === 'object' && hasOwn(tag, kind) && Object.keys(tag).length === 1;
  }
  const compoundOf = (t) => (kindIs(t, 'compound') && t.compound && typeof t.compound === 'object' ? t.compound : null);
  const intOf = (t) => (kindIs(t, 'int') && isInt32(t.int) ? t.int : null);
  const shortOf = (t) => (kindIs(t, 'short') && isInt32(t.short) ? t.short : null);
  const stringOf = (t) => (kindIs(t, 'string') && typeof t.string === 'string' ? t.string : null);
  const listOf = (t) => (kindIs(t, 'list') && Array.isArray(t.list) ? t.list : null);
  function intArrayOf(t) {
    if (!kindIs(t, 'intArray')) return null;
    const a = t.intArray;
    if (a instanceof Int32Array) return a;
    return Array.isArray(a) && a.every(isInt32) ? a : null;
  }
  function byteArrayOf(t) {
    if (!kindIs(t, 'byteArray')) return null;
    const a = t.byteArray;
    if (ArrayBuffer.isView(a) && a.BYTES_PER_ELEMENT === 1) return new Uint8Array(a.buffer, a.byteOffset, a.length);
    return Array.isArray(a) ? Uint8Array.from(a, (x) => x & 0xff) : null;
  }

  // 带类型的 NBT 根（{compound:{…}}）→ 模型。检查顺序按 FORMAT.md 第 3 节
  S.fromNbt = function (rootTag) {
    const R = compoundOf(rootTag);
    if (!R) bad('根不是 compound');
    let s;
    if (hasOwn(R, 'Schematic')) {
      s = compoundOf(R.Schematic);
      if (!s) bad('Schematic 不是 compound');
    } else if (hasOwn(R, 'Version')) {
      s = R;
    } else {
      bad('没有 Schematic');
    }

    if (!hasOwn(s, 'Version')) bad('没有 Version');
    const version = intOf(s.Version);
    if (version === null) bad('Version 不是 int');
    if (version !== S.SPONGE_VERSION) throw new ShareError('unsupported_version', `Version = ${version}`, { version });

    if (!hasOwn(s, 'DataVersion')) bad('没有 DataVersion');
    const dataVersion = intOf(s.DataVersion);
    if (dataVersion === null) bad('DataVersion 不是 int');

    let meta = null;
    if (hasOwn(s, 'Metadata')) {
      if (!compoundOf(s.Metadata)) bad('Metadata 不是 compound');
      meta = s.Metadata;
    }

    const size = ['Width', 'Height', 'Length'].map((k) => {
      if (!hasOwn(s, k)) bad(`没有 ${k}`);
      const v = shortOf(s[k]);
      if (v === null) bad(`${k} 不是 short`);
      const u = v & 0xffff;
      if (u < 1) bad(`${k} 是 0`);
      return u;
    });
    const [W, H, L] = size;
    const L_ = S.LIMITS;
    if (W > L_.side || H > L_.side || L > L_.side || W * H * L > L_.cells) throw new ShareError('too_large', `尺寸 ${W}×${H}×${L}`);
    const count = W * H * L;

    let offset = [0, 0, 0];
    if (hasOwn(s, 'Offset')) {
      const o = intArrayOf(s.Offset);
      if (!o || o.length !== 3) bad('Offset 不是 3 个数的 int array');
      offset = [o[0], o[1], o[2]];
    }

    if (!hasOwn(s, 'Blocks')) bad('没有 Blocks');
    const B = compoundOf(s.Blocks);
    if (!B) bad('Blocks 不是 compound');

    if (!hasOwn(B, 'Palette')) bad('没有 Blocks.Palette');
    const P = compoundOf(B.Palette);
    if (!P) bad('Blocks.Palette 不是 compound');
    const byId = new Map();
    let maxId = -1;
    const states = Object.keys(P);
    for (const k of states) {
      const id = intOf(P[k]);
      if (id === null) bad(`Blocks.Palette 里 ${q(k)} 的编号不是 int`);
      if (id < 0) bad(`Blocks.Palette 里 ${q(k)} 的编号是负数（${id}）`);
      if (byId.has(id)) bad(`Blocks.Palette 里 ${q(byId.get(id))} 和 ${q(k)} 都是编号 ${id}`);
      byId.set(id, k);
      if (id > maxId) maxId = id;
    }
    if (states.length > L_.palette) throw new ShareError('too_large', `调色板有 ${states.length} 种状态`);

    if (!hasOwn(B, 'Data')) bad('没有 Blocks.Data');
    const data = byteArrayOf(B.Data);
    if (!data) bad('Blocks.Data 不是 byte array');
    let cells;
    try {
      cells = nbt().varint.decode(data, count);
    } catch (e) {
      if (e instanceof nbt().NbtError) bad(`Blocks.Data：${e.detail}`);
      throw e;
    }
    // 编号 → 规范下标（按第一次出现的顺序）；NOT = 不在 Palette 里，UNSEEN = 还没出现过
    const NOT = -2, UNSEEN = -1;
    const dense = maxId < (1 << 20);
    const table = dense ? new Int32Array(maxId + 1).fill(NOT) : null;
    const sparse = dense ? null : new Map();
    for (const id of byId.keys()) {
      if (dense) table[id] = UNSEEN;
      else sparse.set(id, UNSEEN);
    }
    const palette = [];
    for (let i = 0; i < count; i++) {
      const id = cells[i];
      let c = dense ? (id <= maxId ? table[id] : NOT) : (sparse.has(id) ? sparse.get(id) : NOT);
      if (c < 0) {
        if (c === NOT) {
          const x = i % W, z = Math.floor(i / W) % L, y = Math.floor(i / (W * L));
          bad(`Blocks.Data 第 ${i} 格（x=${x}, y=${y}, z=${z}）的编号 ${id} 不在 Palette 里`);
        }
        c = palette.length;
        palette.push(byId.get(id));
        if (dense) table[id] = c;
        else sparse.set(id, c);
      }
      cells[i] = c;
    }

    const blockEntities = [];
    if (hasOwn(B, 'BlockEntities')) {
      const list = listOf(B.BlockEntities);
      if (!list) bad('Blocks.BlockEntities 不是 list');
      const seen = new Map();
      const tmp = [];
      list.forEach((el, n) => {
        const what = `Blocks.BlockEntities 第 ${n} 个`;
        const e = compoundOf(el);
        if (!e) bad(`${what}不是 compound`);
        if (!hasOwn(e, 'Pos')) bad(`${what}没有 Pos`);
        const pos = intArrayOf(e.Pos);
        if (!pos || pos.length !== 3) bad(`${what}的 Pos 不是 3 个数的 int array`);
        if (!hasOwn(e, 'Id')) bad(`${what}没有 Id`);
        const id = stringOf(e.Id);
        if (id === null) bad(`${what}的 Id 不是 string`);
        let d = null;
        if (hasOwn(e, 'Data')) {
          if (!compoundOf(e.Data)) bad(`${what}的 Data 不是 compound`);
          d = e.Data;
        }
        const [x, y, z] = pos;
        if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= L) bad(`${what}的 Pos [${x},${y},${z}] 超出范围`);
        const idx = x + z * W + y * W * L;
        if (seen.has(idx)) bad(`Blocks.BlockEntities 第 ${seen.get(idx)} 个和第 ${n} 个都在 [${x},${y},${z}]`);
        seen.set(idx, n);
        tmp.push({ idx, be: { pos: [x, y, z], id, data: d } });
      });
      tmp.sort((a, b) => a.idx - b.idx);
      for (const t of tmp) blockEntities.push(t.be);
    }

    const warnings = [];
    if (dataVersion !== S.DATA_VERSION) warnings.push('data_version');
    if (hasOwn(s, 'Biomes')) warnings.push('ignored_biomes');
    if (hasOwn(s, 'Entities')) {
      const ents = listOf(s.Entities);
      if (ents && ents.length > 0) warnings.push('ignored_entities');
    }
    if (meta) {
      const xj = compoundOf(meta.compound.Xiaojingyu);
      const fv = xj && hasOwn(xj, 'FormatVersion') ? intOf(xj.FormatVersion) : null;
      if (fv !== null && fv > S.FORMAT_VERSION) warnings.push('newer_format');
    }
    if (palette.length < byId.size) warnings.push('unused_palette');
    warnings.sort();

    return { size, offset, dataVersion, meta, palette, cells, blockEntities, warnings };
  };

  // ---------- 写 ----------

  // 检查模型（规则和读的时候一样）并规范化；不改原模型
  function prepare(model) {
    if (!model || typeof model !== 'object') bad('模型不是对象');
    const size = model.size;
    if (!Array.isArray(size) || size.length !== 3 || !size.every(Number.isInteger)) bad('size 要是 3 个整数');
    const [W, H, L] = size;
    if (W < 1 || H < 1 || L < 1) bad(`尺寸 ${W}×${H}×${L} 有小于 1 的边`);
    const L_ = S.LIMITS;
    if (W > L_.side || H > L_.side || L > L_.side || W * H * L > L_.cells) throw new ShareError('too_large', `尺寸 ${W}×${H}×${L}`);
    const offset = model.offset == null ? [0, 0, 0] : model.offset;
    if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(isInt32)) bad('offset 要是 3 个 int');
    const dataVersion = model.dataVersion == null ? S.DATA_VERSION : model.dataVersion;
    if (!isInt32(dataVersion)) bad('dataVersion 不是 int');
    const meta = model.meta == null ? null : model.meta;
    if (meta !== null && !compoundOf(meta)) bad('meta 要是 {compound:{…}} 或 null');

    const pal = model.palette;
    if (!Array.isArray(pal)) bad('palette 要是数组');
    const seenState = new Set();
    pal.forEach((st, i) => {
      if (typeof st !== 'string') bad(`palette[${i}] 不是字符串`);
      if (seenState.has(st)) bad(`palette 里 ${q(st)} 出现了不止一次`);
      seenState.add(st);
    });

    const n = W * H * L;
    const src = model.cells;
    if (!src || typeof src.length !== 'number' || src.length !== n) bad(`cells 要有 ${n} 个（W×H×L），实际 ${src && src.length}`);
    const np = pal.length;
    const map = new Int32Array(np).fill(-1);
    const cells = new Int32Array(n);
    const palette = [];
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if ((v | 0) !== v || v < 0 || v >= np) bad(`cells[${i}] = ${v} 不是 palette 的下标`);
      let c = map[v];
      if (c < 0) {
        c = map[v] = palette.length;
        palette.push(pal[v]);
      }
      cells[i] = c;
    }
    if (palette.length > L_.palette) throw new ShareError('too_large', `调色板有 ${palette.length} 种状态`);

    const bes = model.blockEntities == null ? [] : model.blockEntities;
    if (!Array.isArray(bes)) bad('blockEntities 要是数组');
    const seen = new Map();
    const tmp = bes.map((be, k) => {
      const what = `blockEntities[${k}]`;
      if (!be || typeof be !== 'object') bad(`${what} 不是对象`);
      const pos = be.pos;
      if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isInt32)) bad(`${what} 的 pos 要是 3 个 int`);
      const [x, y, z] = pos;
      if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= L) bad(`${what} 的 pos [${x},${y},${z}] 超出范围`);
      if (typeof be.id !== 'string') bad(`${what} 的 id 不是字符串`);
      const data = be.data == null ? null : be.data;
      if (data !== null && !compoundOf(data)) bad(`${what} 的 data 要是 {compound:{…}} 或 null`);
      const idx = x + z * W + y * W * L;
      if (seen.has(idx)) bad(`blockEntities[${seen.get(idx)}] 和 [${k}] 都在 [${x},${y},${z}]`);
      seen.set(idx, k);
      return { idx, be: { pos: [x, y, z], id: be.id, data } };
    });
    tmp.sort((a, b) => a.idx - b.idx);

    const warnings = Array.isArray(model.warnings) ? Array.from(new Set(model.warnings.map(String))).sort() : [];
    return {
      size: [W, H, L], offset: offset.slice(), dataVersion, meta, palette, cells,
      blockEntities: tmp.map((t) => t.be), warnings,
    };
  }

  // 规范化：palette 按第一次出现的顺序、去掉没用到的；blockEntities 按格子编号排（不加警告）
  S.canonicalize = function (model) {
    return prepare(model);
  };

  // FORMAT.md 第 3.1 节：命名空间 = 状态字符串 [ 前面部分的第一个 : 前面，没有 : 就是 minecraft
  S.requiredMods = function (palette) {
    const set = new Set();
    for (const st of palette) {
      const b = st.indexOf('[');
      const id = b < 0 ? st : st.slice(0, b);
      const c = id.indexOf(':');
      const ns = c < 0 ? 'minecraft' : id.slice(0, c);
      if (ns !== 'minecraft') set.add(ns);
    }
    return Array.from(set).sort();
  };

  function metaForWrite(meta, palette) {
    const src = meta.compound;
    const c = Object.create(null);
    for (const k of Object.keys(src)) if (k !== 'RequiredMods') c[k] = src[k];
    const mods = S.requiredMods(palette);
    if (mods.length) c.RequiredMods = { list: mods.map((m) => ({ string: m })) };
    return { compound: c };
  }

  function buildNbt(m) {
    const N = nbt();
    const P = Object.create(null);
    m.palette.forEach((st, i) => { P[st] = { int: i }; });
    const s = Object.create(null);
    s.Version = { int: S.SPONGE_VERSION };
    s.DataVersion = { int: m.dataVersion };
    if (m.meta) s.Metadata = metaForWrite(m.meta, m.palette);
    s.Width = { short: m.size[0] };
    s.Height = { short: m.size[1] };
    s.Length = { short: m.size[2] };
    s.Offset = { intArray: Int32Array.from(m.offset) };
    const blocks = Object.create(null);
    blocks.Palette = { compound: P };
    blocks.Data = { byteArray: N.varint.encode(m.cells) };
    blocks.BlockEntities = {
      list: m.blockEntities.map((be) => {
        const c = Object.create(null);
        c.Pos = { intArray: Int32Array.from(be.pos) };
        c.Id = { string: be.id };
        if (be.data) c.Data = be.data;
        return { compound: c };
      }),
    };
    s.Blocks = { compound: blocks };
    const root = Object.create(null);
    root.Schematic = { compound: s };
    return { compound: root };
  }

  // 模型 → 带类型的 NBT 根（写文件前的样子；RequiredMods 已按调色板重算）
  S.toNbt = function (model) {
    return buildNbt(prepare(model));
  };

  S.writeSchem = async function (model) {
    const N = nbt();
    const m = prepare(model);
    let raw;
    try {
      raw = N.write(buildNbt(m), '', { maxTags: S.LIMITS.tags });
    } catch (e) {
      // 标签太多 → too_large（FORMAT.md 第 2 节「写的时候也照样数」）；别的写不出来 → bad_schematic
      if (e instanceof N.NbtError) throw new ShareError(e.code === 'too_large' ? 'too_large' : 'bad_schematic', e.detail);
      throw e;
    }
    if (raw.length > S.LIMITS.unzipped) throw new ShareError('too_large', `NBT 有 ${raw.length} 字节，超过 64 MiB`);
    return N.gzip(raw);
  };

  // png：底图（PNG 字节）；不给就用 16×16 纯色图。底图里原有的 xjSc 全部删掉
  S.writePng = async function (model, png) {
    const schem = await S.writeSchem(model);
    if (schem.length > S.LIMITS.chunk) throw new ShareError('too_large', `.schem 有 ${schem.length} 字节，超过 16 MiB`);
    const base = png == null ? solid(16, 16) : await toBytes(png);
    return setChunk(base, S.CHUNK_TYPE, schem);
  };

  // ---------- dump ----------

  S.dump = function (model) {
    const N = nbt();
    const m = prepare(model);
    const c = m.cells;
    const runs = [];
    let cur = c[0], run = 1;
    for (let i = 1; i < c.length; i++) {
      if (c[i] === cur) {
        run++;
      } else {
        runs.push([run, cur]);
        cur = c[i];
        run = 1;
      }
    }
    runs.push([run, cur]);
    try {
      return {
        dump: 1,
        size: m.size,
        offset: m.offset,
        dataVersion: m.dataVersion,
        meta: m.meta ? N.toJSON(m.meta) : null,
        palette: m.palette,
        cells: runs,
        blockEntities: m.blockEntities.map((be) => ({ pos: be.pos, id: be.id, data: be.data ? N.toJSON(be.data) : null })),
        warnings: m.warnings,
      };
    } catch (e) {
      if (e instanceof N.NbtError) throw new ShareError('bad_schematic', e.detail);
      throw e;
    }
  };

  const DUMP_KEYS = ['dump', 'size', 'offset', 'dataVersion', 'meta', 'palette', 'cells', 'blockEntities', 'warnings'];

  // dump（纯 JSON）→ 模型；严格检查形状
  S.fromDump = function (d) {
    const N = nbt();
    const badDump = (detail) => { throw new ShareError('bad_dump', detail); };
    if (!d || typeof d !== 'object' || Array.isArray(d)) badDump('不是对象');
    const keys = Object.keys(d);
    for (const k of keys) if (!DUMP_KEYS.includes(k)) badDump(`多了键 ${q(k)}`);
    for (const k of DUMP_KEYS) if (!hasOwn(d, k)) badDump(`少了键 ${q(k)}`);
    if (d.dump !== 1) badDump('dump 要是 1');
    const ints3 = (a) => Array.isArray(a) && a.length === 3 && a.every(isInt32);
    if (!ints3(d.size) || !d.size.every((v) => v >= 1)) badDump('size 要是 3 个 ≥ 1 的整数');
    const [W, H, L] = d.size;
    const L_ = S.LIMITS;
    if (W > L_.side || H > L_.side || L > L_.side || W * H * L > L_.cells) throw new ShareError('too_large', `尺寸 ${W}×${H}×${L}`);
    if (!ints3(d.offset)) badDump('offset 要是 3 个 int');
    if (!isInt32(d.dataVersion)) badDump('dataVersion 要是 int');
    if (!Array.isArray(d.palette) || !d.palette.every((s) => typeof s === 'string')) badDump('palette 要是字符串数组');
    if (!Array.isArray(d.cells)) badDump('cells 要是数组');
    const n = W * H * L;
    const cells = new Int32Array(n);
    let p = 0;
    d.cells.forEach((r, k) => {
      if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[0]) || r[0] < 1 || !Number.isInteger(r[1]) || r[1] < 0 || r[1] >= d.palette.length) {
        badDump(`cells[${k}] 要是 [格数 ≥ 1, palette 下标]`);
      }
      if (p + r[0] > n) badDump(`cells 加起来超过 ${n} 格`);
      cells.fill(r[1], p, p + r[0]);
      p += r[0];
    });
    if (p !== n) badDump(`cells 加起来是 ${p} 格，应该是 ${n}`);
    if (!Array.isArray(d.blockEntities)) badDump('blockEntities 要是数组');
    if (!Array.isArray(d.warnings) || !d.warnings.every((s) => typeof s === 'string')) badDump('warnings 要是字符串数组');
    try {
      const meta = d.meta === null ? null : N.fromJSON(d.meta, 'meta');
      if (meta && !compoundOf(meta)) badDump('meta 要是 {"compound":{…}} 或 null');
      const blockEntities = d.blockEntities.map((be, k) => {
        const what = `blockEntities[${k}]`;
        if (!be || typeof be !== 'object' || Array.isArray(be)) badDump(`${what} 不是对象`);
        const ks = Object.keys(be);
        if (ks.length !== 3 || !hasOwn(be, 'pos') || !hasOwn(be, 'id') || !hasOwn(be, 'data')) badDump(`${what} 要正好有 pos、id、data 三个键`);
        if (!ints3(be.pos)) badDump(`${what}.pos 要是 3 个 int`);
        if (typeof be.id !== 'string') badDump(`${what}.id 要是字符串`);
        const data = be.data === null ? null : N.fromJSON(be.data, `${what}.data`);
        if (data && !compoundOf(data)) badDump(`${what}.data 要是 {"compound":{…}} 或 null`);
        return { pos: be.pos.slice(), id: be.id, data };
      });
      return {
        size: [W, H, L], offset: d.offset.slice(), dataVersion: d.dataVersion, meta,
        palette: d.palette.slice(), cells, blockEntities, warnings: d.warnings.slice(),
      };
    } catch (e) {
      if (e instanceof N.NbtError) badDump(e.detail);
      throw e;
    }
  };

  // 两个 dump 按 JSON 值比较
  S.equalDump = function (a, b) {
    return nbt().equalJSON(a, b);
  };

  // 格子编号 ↔ 坐标
  S.index = function (size, x, y, z) {
    return x + z * size[0] + y * size[0] * size[2];
  };
  S.posOf = function (size, i) {
    const W = size[0], L = size[2];
    return [i % W, Math.floor(i / (W * L)), Math.floor(i / W) % L];
  };
})(window.V3);

// 29-ysm.js — 导入 YSM（我的世界「是，史蒂夫模型」模组）的**不加密**模型：文件 → 模型描述 → 场景里能动的角色。
// 支持：新版（ysm.json + models/ animations/ textures/ functions/）和旧版（main.json + *.animation.json + png）。
// 加密的 .ysm（文件头 YSGP）不解密，只读文件头里本来就是明文的信息：Y.header(bytes)。
// 几何：照 Blockbench 读基岩版模型的规则（x 取反；骨骼 / 方块旋转取 (−rx, −ry, rz)，欧拉 ZYX；盒子 UV / 逐面 UV / 镜像 / inflate），
//   整个模型放进转了 180° 的组里（Blockbench 里模型脸朝 −Z，我们约定脸朝 +Z）。
//   全部方块合成一个蒙皮网格（每个顶点只跟一根骨骼），一次绘制；每根骨骼一个面组（faceTags），反馈工具能按骨骼点选。
// 动画：基岩版 1.8.0 关键帧（数字 / Molang、pre/post、linear / catmullrom / step），位置 x 取反、旋转 x y 取反后加到骨骼上，
//   缩放相乘。主动画（idle / walk …）切换时 0.2 s 交叉淡化；extra 表情动作按需播放；时间轴 timeline、音效 sound_effects 按时间触发。
//   槽位 pre_parallel_0–7 → 主动画 → 手 → parallel_0–7：默认放 main 文件里同名的并行动画，动画控制器（JSON）或
//   脚本控制器（@player_ctrl_<槽位>.molang）可以接管；ysmGlow* 骨骼全亮（单独一个网格）。粒子、手持物品还不支持。
// Y.load(files: Map) → model；Y.build(model, { height, anchor, vars, tune }) → inst（65-girl-actor 和工作台都能用，约定见 docs/接入新小鲸鱼.md、docs/YSM.md）。
(function (V3) {
  'use strict';
  const Y = V3.ysm = V3.ysm || {};
  const DEG = Math.PI / 180;
  const dec = new TextDecoder('utf-8');
  const text = (b) => dec.decode(b).replace(/^﻿/, '');
  // JSON with // and /* */ comments (seen in Bedrock files)
  const stripComments = (s) => {
    let out = '', i = 0, str = false;
    while (i < s.length) {
      const c = s[i];
      if (str) { out += c; if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; } if (c === '"') str = false; i++; continue; }
      if (c === '"') { str = true; out += c; i++; continue; }
      if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
      out += c; i++;
    }
    return out;
  };
  const parseJSON = (b, name) => {
    const s = text(b);
    try { return JSON.parse(s); } catch (e) {
      try { return JSON.parse(stripComments(s).replace(/,(\s*[}\]])/g, '$1')); } catch (e2) { throw new Error(name + ' 不是有效的 JSON：' + e.message); }
    }
  };

  // ---- 加密的 .ysm：只读明文文件头 ------------------------------------------------------------------------------
  Y.isEncrypted = (b) => !!b && b.length > 8 && /^﻿?YSGP/.test(dec.decode(b.subarray(0, 8)));
  Y.header = (b) => {
    const lines = dec.decode(b.subarray(0, Math.min(b.length, 32768))).replace(/^﻿/, '').split(/\r?\n/);
    const h = { name: '', authors: [], license: '', free: null, tips: [], anims: [], textures: [], sounds: [], functions: [], format: '', crypto: '' };
    let sec = '', au = null;
    for (const raw of lines) {
      const s = raw.replace(/�/g, '');
      const m = /^-{3,}\s*\[\s*(.+?)\s*\]\s*-{3,}$/.exec(s.trim());
      if (m) { sec = m[1]; continue; }
      if (/^-{20,}$/.test(s.trim()) && sec === 'Codec Version') break;     // end of the plaintext header
      const t = /^(\s*)<([^>]+)>\s*(.*)$/.exec(s);
      if (sec === 'Tips') { if (s.trim()) h.tips.push(s.trim()); continue; }
      if (!t) continue;
      const ind = t[1].length, k = t[2], v = t[3].trim();
      if (sec === 'Metadata') {
        if (k === 'author') { au = { name: '', role: '', comment: '' }; h.authors.push(au); }
        else if (ind > 0 && au && /^(name|role|comment|contact)$/.test(k)) au[k] = v;
        else if (k === 'name') { h.name = v; au = null; }
        else if (k === 'license') h.license = v;
        else if (k === 'free') h.free = v === 'true';
      } else if (sec === 'Source SHA-256') {
        if (/^animation-/.test(k)) h.anims.push(k.slice(10));
        else if (k === 'texture') h.textures.push(v.split(/\s+/)[0]);
        else if (k === 'sound') h.sounds.push(v.split(/\s+/)[0]);
        else if (k === 'function') h.functions.push(v.split(/\s+/)[0]);
      } else if (sec === 'Codec Version') {
        if (k === 'format') h.format = v; else if (k === 'crypto') h.crypto = v;
      }
    }
    return h;
  };

  // ---- 文件 → 模型描述 -------------------------------------------------------------------------------------------------
  const stripTop = (files) => {
    const keys = [...files.keys()];
    if (!keys.length) return files;
    const top = keys[0].split('/')[0];
    if (keys.length > 0 && keys.every(k => k.startsWith(top + '/'))) {
      const m = new Map(); for (const [k, v] of files) m.set(k.slice(top.length + 1), v); return stripTop(m);
    }
    return files;
  };
  const baseName = (p) => String(p).split('/').pop().replace(/\.[^.]+$/, '');
  // geometry json (format 1.12+ 'minecraft:geometry' or older 'geometry.xxx') → { texW, texH, bones }
  function geoOf(j, name) {
    let g = j && j['minecraft:geometry'] && j['minecraft:geometry'][0], tw = 0, th = 0;
    if (g) { const d = g.description || {}; tw = d.texture_width; th = d.texture_height; }
    else {
      const k = j && Object.keys(j).find(x => /^geometry\./.test(x));
      if (!k) throw new Error(name + ' 里没有模型（minecraft:geometry）');
      g = j[k]; tw = g.texturewidth; th = g.textureheight;
    }
    return { texW: +tw || 64, texH: +th || 64, bones: Array.isArray(g.bones) ? g.bones : [] };
  }
  // 模型自带设置：properties.extra_animation_buttons[].config_forms → [{ group, type: range|checkbox|radio, title, desc, key, min, max, step, labels }]
  // value 必须是变量（v.roaming.Tail）；key 是去掉 v. 的小写名（和 Molang 上下文里的键一样）
  const mcText = (s) => String(s == null ? '' : s).replace(/§[0-9a-fk-or]/gi, '');   // MC 的颜色 / 粗体代码（§c §l §r …）
  function formsOf(props) {
    const out = [];
    for (const btn of (props && props.extra_animation_buttons) || []) for (const f of (btn && btn.config_forms) || []) {
      const m = /^\s*(?:v|variable)\.([\w.]+)\s*$/i.exec(String((f && f.value) || ''));
      if (!m || !/^(range|checkbox|radio)$/.test(f.type)) continue;
      const key = m[1].toLowerCase();
      const it = { group: mcText(btn.name || btn.id || '设置').trim(), type: f.type, title: mcText(f.title || m[1]).replace(/[\s:：]+$/, ''),
        desc: mcText(f.description || '').trim(), key };
      if (f.type === 'range') Object.assign(it, { min: Number.isFinite(+f.min) ? +f.min : 0, max: Number.isFinite(+f.max) ? +f.max : 1, step: +f.step || 0.1 });
      if (f.type === 'radio') {
        // 每个选项是一句 Molang（"v.roaming.x=2;v.roaming.y=2"）：从里面找给本设置赋的值，用来标出当前选中的是哪个
        const set = new RegExp('(?:^|[^\\w.])(?:v|variable)\\.' + key.replace(/\./g, '\\.') + '\\s*=\\s*(-?\\d+(?:\\.\\d+)?)(?![\\w.])', 'i');
        it.labels = Object.entries(f.labels || {}).map(([label, stmt]) => [mcText(label), String(stmt)]);
        it.vals = it.labels.map(([, stmt]) => { const x = set.exec(stmt); return x ? +x[1] : null; });
      }
      out.push(it);
    }
    return out;
  }
  // load(files: Map(path → Uint8Array)) → { layout, meta, props, geo, anims: { group: { name: json } }, textures: [{ name, bytes }], functions, files }
  // 这根 ysmGlow* 骨骼是不是眼睛：自己或任何一级父骨骼的名字里有 eye / pupil / iris（不算 eyebrow、eyelash 这种）。
  // 自带模型和它的换装版：ysmGlowRightEyesBase → RightEyesBase → … → Eyes，八组都能认出来。
  // 父骨骼也要看：有的作者把发光方块放在叫 ysmGlow1 的骨骼里，再挂到 LeftEye 下面。
  const EYE_WORD = /eye|pupil|iris|瞳|眼/i, NOT_EYE = /eyebrow|eyelash|brow|眉|睫/i;
  const eyeName = (n) => { const s = String(n || '').replace(/^ysmGlow/i, ''); return EYE_WORD.test(s.replace(new RegExp(NOT_EYE.source, 'gi'), '')); };
  Y.isEyeGlowBone = (bone) => {
    if (!bone || !/^ysmGlow/.test(String(bone.name))) return false;
    for (let b = bone, i = 0; b && i < 32; b = b.parent, i++) { if (!b.isBone && i) break; if (eyeName(b.name)) return true; }
    return false;
  };

  Y.load = (input, opts) => {
    let files = new Map([...input].filter(([k]) => !/^__MACOSX\//.test(k) && !/(^|\/)\.DS_Store$/.test(k)));
    files = stripTop(files);
    const lower = new Map(); for (const k of files.keys()) lower.set(k.toLowerCase(), k);
    const get = (p) => { if (!p) return null; const k = lower.get(String(p).replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase()); return k ? files.get(k) : null; };
    const out = { layout: '', meta: {}, props: {}, geo: null, anims: {}, textures: [], functions: [], controllers: {}, sounds: {}, files };
    let fnDir = 'functions', soundDir = 'sounds';
    const yj = get('ysm.json');
    if (yj) {
      const j = parseJSON(yj, 'ysm.json');
      out.layout = 'v' + (j.spec || 2); out.meta = j.metadata || {}; out.props = j.properties || {};
      const P = (j.files && j.files.player) || {}, M = P.model || {};
      const mainPath = M.main || 'models/main.json', mb = get(mainPath);
      if (!mb) throw new Error('ysm.json 里写的模型文件找不到：' + mainPath);
      out.geo = geoOf(parseJSON(mb, mainPath), mainPath);
      const A = P.animation || {};
      for (const k in A) { const f = get(A[k]); if (f) { try { out.anims[k] = parseJSON(f, A[k]).animations || {}; } catch (e) { V3.err('ysm: ' + e.message); } } }
      for (const t of [].concat(P.texture || [])) {
        const p = typeof t === 'string' ? t : t && (t.uv || t.path);
        const b = get(p);
        if (b) out.textures.push({ name: baseName(p), bytes: b });
      }
      // 动画控制器：键是槽位名（player.parallel_7 …），见 YSM-FORMAT「Animation controllers」；同名后面的覆盖前面的
      for (const cp of [].concat(P.animation_controllers || [])) {
        const f = get(cp); if (!f) continue;
        try { Object.assign(out.controllers, parseJSON(f, cp).animation_controllers || {}); } catch (e) { V3.err('ysm: ' + e.message); }
      }
      if (P.function_path) fnDir = String(P.function_path).replace(/\\/g, '/').replace(/^\.?\/|\/$/g, '').toLowerCase();
      if (j.files && j.files.sound_path) soundDir = String(j.files.sound_path).replace(/\\/g, '/').replace(/^\.?\/|\/$/g, '').toLowerCase();
    } else if (get('main.json')) {
      out.layout = 'legacy';
      out.geo = geoOf(parseJSON(get('main.json'), 'main.json'), 'main.json');
      for (const [k, real] of lower) {
        const m = /^([^/]+)\.animation\.json$/.exec(k);
        if (m) { try { out.anims[m[1]] = parseJSON(files.get(real), real).animations || {}; } catch (e) { V3.err('ysm: ' + e.message); } }
      }
      for (const [k, real] of [...lower].sort()) if (/^[^/]+\.png$/.test(k)) out.textures.push({ name: baseName(real), bytes: files.get(real) });
      const info = get('info.json');
      if (info) { try { const j = parseJSON(info, 'info.json'); out.meta = { name: j.name, tips: j.tips, authors: j.authors, license: j.license }; } catch (e) { /* optional */ } }
    } else throw new Error('不是 YSM 模型：找不到 ysm.json，也找不到 main.json');
    // default texture first
    const def = out.props.default_texture;
    if (def) out.textures.sort((a, b) => (a.name === def ? -1 : b.name === def ? 1 : 0));
    // functions/*.molang: "name@hook.molang" → { name, hook, src }（目录按 ysm.json 的 function_path）
    const fnRe = new RegExp('^' + fnDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/(?:.*\\/)?([^/]*)@([^/]+)\\.molang$');
    for (const [k, real] of lower) {
      const m = fnRe.exec(k);
      if (m) out.functions.push({ name: m[1], hook: m[2], src: text(files.get(real)) });
    }
    // 音效：sounds/<名字>.ogg（动画的 sound_effects 用名字找；sound_path 可以改目录）
    const sdPre = soundDir + '/';
    for (const [k, real] of lower) if (k.startsWith(sdPre) && /\.(ogg|wav|mp3)$/.test(k)) out.sounds[k.slice(sdPre.length).replace(/\.(ogg|wav|mp3)$/, '')] = files.get(real);
    if (!out.meta.name) out.meta.name = (opts && opts.name) || 'YSM 模型';
    out.forms = formsOf(out.props);
    return out;
  };

  // ---- 几何：方块 → 蒙皮网格（Blockbench 的坐标规则）---------------------------------------------------------------
  // face corners TL TR BR BL seen from outside, as (x, y, z) picks of [min, max]; the box-UV rect's top-left texel goes to TL
  const FACE = {
    north: { n: [0, 0, -1], c: [[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]] },
    south: { n: [0, 0, 1], c: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]] },
    east: { n: [1, 0, 0], c: [[1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]] },
    west: { n: [-1, 0, 0], c: [[0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]] },
    up: { n: [0, 1, 0], c: [[1, 1, 1], [0, 1, 1], [0, 1, 0], [1, 1, 0]] },
    down: { n: [0, -1, 0], c: [[1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1]] },
  };
  const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
  // box UV rects [x1, y1, x2, y2] (x2 < x1 = flipped) for size w h d at offset u v (Blockbench floors sizes for box UV)
  function boxRects(u, v, size, mirror) {
    const w = Math.floor(size[0] + 1e-4), h = Math.floor(size[1] + 1e-4), d = Math.floor(size[2] + 1e-4);
    const R = {
      east: [u, v + d, u + d, v + d + h], north: [u + d, v + d, u + d + w, v + d + h],
      west: [u + d + w, v + d, u + 2 * d + w, v + d + h], south: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
      up: [u + d, v, u + d + w, v + d], down: [u + d + w, v + d, u + d + 2 * w, v],
    };
    if (mirror) {
      const e = R.east; R.east = R.west; R.west = e;
      for (const k in R) { const r = R[k]; R[k] = [r[2], r[1], r[0], r[3]]; }
    }
    return R;
  }
  const eulerZYX = (r) => new THREE.Euler(-(+r[0] || 0) * DEG, -(+r[1] || 0) * DEG, (+r[2] || 0) * DEG, 'ZYX');   // Bedrock → Blockbench
  const bbPos = (p) => [-(+p[0] || 0), +p[1] || 0, +p[2] || 0];
  const CAT = [[/^(all)?head$/i, '头'], [/arm|hand/i, '手臂'], [/leg|foot/i, '腿'], [/tail/i, '尾巴'], [/hair|ear|ahoge/i, '头']];
  // ---- 连成一体（2026-11-14）----------------------------------------------------------------------------------------
  // YSM 模型是几千个互相穿插的方块，原样画出来有三样毛病（Y.SOFT 是可调的数，长度单位：模型像素 px = 1/16）：
  //   ① 共面打架：两个方块各有一面落在同一个平面上、朝同一边、又互相盖着一部分。深度一样，谁在上面每个像素、每一帧都不一样，
  //      看起来是接缝上一条条互相干涉的条纹。给互相打架的方块排级（打架的两个不同级；只有两个时排在后面的那个高，和 MC 里
  //      后画的盖住先画的一样），按级整个往外胀一点（每级 lift px，最多 4 级 ≈ 1.5 mm）。一模一样大、叠在同一处的面不用管：
  //      顶点相同、深度逐位相同，一次绘制里后面的三角形稳定盖住前面的。
  //   ② 边上漏线：开着多重采样时，面边缘那一圈像素按像素中心取贴图，中心落在面外面 → 取到贴图上隔壁那一格（别的面的颜色），
  //      方块的棱上出现一段段虚线。贴图坐标往面里收 uvIn 格；材质再把贴图坐标改成 centroid 插值（centroidUv，WebGL2）。
  //   ③ 明暗一块一块：每个面一个法线，头发、裙摆这种一片片稍微错开角度的方块，太阳一照每片一个亮度。每个顶点的法线换成
  //      「radius px 以内、朝向相差不到 angle 度的面」按面积和距离加权的平均，再和原来的法线按 mix 混合：一缕头发、一圈裙摆的亮度
  //      连成一片，方块自己的棱（90°）不受影响。只算现在显示着的方块（备用的嘴型、收起来的饭盆这些缩成 0 的不参加，也不改）。
  // ①② 在建网格时做（soften），③ 在摆好默认姿势以后做（smoothNormals，Y.build 里；玩家改了模型设置可以再调 inst.resmooth()）。
  // 网址加 ysmsoft=0 可以整个关掉对照；Y.build(model, { soft: false }) 也一样。
  Y.SOFT = { on: true, lift: 0.012, uvIn: 0.02, radius: 3, angle: 55, mix: 0.8 };
  const softOn = (pre) => {
    if (pre && pre.soft === false) return false;
    try { if (typeof location !== 'undefined' && /[?&]ysmsoft=0(&|$)/.test(location.search)) return false; } catch (e) { /* no location (Node) */ }
    return Y.SOFT.on !== false;
  };
  const PX = 1 / 16, QW = 15;
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  // 每个面（4 个顶点，顺序 TL TR BR BL）15 个数：中心 c(0..2)、法线 n(3..5)、两条边的方向 e1(6..8) e2(9..11)、半长 h1 h2(12, 13)、外接半径(14)
  function quadsOf(pos, nor, nq) {
    const Q = new Float32Array(nq * QW);
    for (let i = 0; i < nq; i++) {
      const o = i * 12, q = i * QW;
      const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];          // TL → TR
      const bx = pos[o + 9] - pos[o], by = pos[o + 10] - pos[o + 1], bz = pos[o + 11] - pos[o + 2];        // TL → BL
      const la = Math.hypot(ax, ay, az) || 1e-9, lb = Math.hypot(bx, by, bz) || 1e-9;
      Q[q] = (pos[o] + pos[o + 3] + pos[o + 6] + pos[o + 9]) / 4; Q[q + 1] = (pos[o + 1] + pos[o + 4] + pos[o + 7] + pos[o + 10]) / 4;
      Q[q + 2] = (pos[o + 2] + pos[o + 5] + pos[o + 8] + pos[o + 11]) / 4;
      Q[q + 3] = nor[o]; Q[q + 4] = nor[o + 1]; Q[q + 5] = nor[o + 2];
      Q[q + 6] = ax / la; Q[q + 7] = ay / la; Q[q + 8] = az / la; Q[q + 9] = bx / lb; Q[q + 10] = by / lb; Q[q + 11] = bz / lb;
      Q[q + 12] = la / 2; Q[q + 13] = lb / 2; Q[q + 14] = Math.hypot(la, lb) / 2;
    }
    return Q;
  }
  // ①②：pos / nor / uv 是 buildRig 的顶点数组，就地改；quadCube[i] = 第 i 个面属于第几个方块
  function soften(pos, nor, uv, quadCube, tw, th, noLift) {
    const S = Y.SOFT, nq = quadCube.length, t0 = nowMs(), info = { quads: nq, coplanar: 0, same: 0, lifted: 0, levels: 0, ms: 0 };
    if (!nq) return info;
    // ---- ① 共面又互相盖着的面 → 哪些方块互相打架 → 排级 → 按级往外胀 ----
    if (S.lift > 0) {
      const Q = quadsOf(pos, nor, nq);
      // 按（法线，平面位置）分格：共面的两个面这四个数几乎一样，只会落在同一格，或者正好跨在格子边上（那时才去看隔壁那一格）
      const NS = 64, DS = 256, TN = 0.1, TD = 0.05, cells = new Map();
      const keyOf = (a, b, c, d) => (((a + 80) * 161 + (b + 80)) * 161 + (c + 80)) * 20001 + (d + 10000);
      const F = new Float64Array(4), B = new Int32Array(4);
      const place = (i) => {
        const q = i * QW;
        F[0] = Q[q + 3] * NS + 0.5; F[1] = Q[q + 4] * NS + 0.5; F[2] = Q[q + 5] * NS + 0.5;
        F[3] = Math.max(-9990, Math.min(9990, (Q[q + 3] * Q[q] + Q[q + 4] * Q[q + 1] + Q[q + 5] * Q[q + 2]) * DS + 0.5));
        for (let k = 0; k < 4; k++) B[k] = Math.floor(F[k]);
      };
      for (let i = 0; i < nq; i++) {
        place(i);
        const k = keyOf(B[0], B[1], B[2], B[3]), L = cells.get(k);
        if (L) L.push(i); else cells.set(k, [i]);
      }
      // 长方形 i 在方向 (x, y, z) 上的两头（sign −1 / +1）
      const end = (i, x, y, z, sign) => {
        const q = i * QW;
        return Q[q] * x + Q[q + 1] * y + Q[q + 2] * z
          + sign * (Math.abs(Q[q + 6] * x + Q[q + 7] * y + Q[q + 8] * z) * Q[q + 12] + Math.abs(Q[q + 9] * x + Q[q + 10] * y + Q[q + 11] * z) * Q[q + 13]);
      };
      // 两个共面的长方形盖着多少：四条边方向上的分离轴。> 0 = 盖着，值是最浅的那个方向上的重叠宽度
      const overlap = (i, j) => {
        let pen = Infinity;
        for (let s = 0; s < 2; s++) for (let e = 6; e <= 9; e += 3) {
          const q = (s ? j : i) * QW + e, x = Q[q], y = Q[q + 1], z = Q[q + 2];
          const w = Math.min(end(i, x, y, z, 1), end(j, x, y, z, 1)) - Math.max(end(i, x, y, z, -1), end(j, x, y, z, -1));
          if (w <= 0) return 0;
          if (w < pen) pen = w;
        }
        return pen;
      };
      const foes = new Map();                        // 方块 → 和它打架的方块
      const link = (a, b) => { let L = foes.get(a); if (!L) foes.set(a, L = new Set()); L.add(b); };
      const off = [[0], [0], [0], [0]];
      for (let i = 0; i < nq; i++) {
        const q = i * QW, ci = quadCube[i];
        if (noLift && noLift[ci]) continue;                          // 脸上那层贴图纸片不参加 ①（见 buildRig 里的说明）
        place(i);
        for (let k = 0; k < 4; k++) {
          const fr = F[k] - B[k], t = k < 3 ? TN : TD, o = off[k];
          o.length = 1;
          if (fr < t) o.push(-1); else if (fr > 1 - t) o.push(1);
        }
        for (const da of off[0]) for (const db of off[1]) for (const dc of off[2]) for (const dd of off[3]) {
          const L = cells.get(keyOf(B[0] + da, B[1] + db, B[2] + dc, B[3] + dd));
          if (!L) continue;
          for (let n = 0; n < L.length; n++) {
            const j = L[n];
            if (j <= i || quadCube[j] === ci) continue;
            if (noLift && noLift[quadCube[j]]) continue;
            const p = j * QW, dx = Q[p] - Q[q], dy = Q[p + 1] - Q[q + 1], dz = Q[p + 2] - Q[q + 2];
            if (Q[q + 3] * Q[p + 3] + Q[q + 4] * Q[p + 4] + Q[q + 5] * Q[p + 5] < 0.999999) continue;        // 朝向一样
            if (Math.abs(Q[q + 3] * dx + Q[q + 4] * dy + Q[q + 5] * dz) > 0.0025 * PX) continue;             // 在同一个平面上
            const reach = Q[q + 14] + Q[p + 14];
            if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
            if (!(overlap(i, j) > 0.02 * PX)) continue;                                                      // 互相盖着
            // 一模一样大、叠在同一个位置（换装 / 表情的备用件，或者贴在上面的一层花纹）：不会闪，不用动
            let same = dx * dx + dy * dy + dz * dz < 1e-10;
            for (let e = 6; same && e <= 9; e += 3) {
              const x = Q[q + e], y = Q[q + e + 1], z = Q[q + e + 2];
              same = Math.abs(end(i, x, y, z, 1) - end(j, x, y, z, 1)) < 1e-5 && Math.abs(end(i, x, y, z, -1) - end(j, x, y, z, -1)) < 1e-5;
            }
            if (same) { info.same++; continue; }
            info.coplanar++;
            link(ci, quadCube[j]); link(quadCube[j], ci);
          }
        }
      }
      // 排级：按方块的先后，每个方块取「排在它前面、和它打架的方块都没用过」的最小一级（每一堆的第一个是 0 级，不动）。
      // 最多 MAXL 级：表情、换装的备用件（几十个嘴型叠在同一个位置，同一时间只显示一个）会排出几十级，再往上就循环用，不把它们越胀越远
      const level = new Map(), used = [], MAXL = 4;
      for (const c of [...foes.keys()].sort((a, b) => a - b)) {
        used.length = 0;
        for (const f of foes.get(c)) { const l = level.get(f); if (l != null) used[l] = true; }
        let l = 0;
        while (used[l]) l++;
        if (l > MAXL) l = 1 + (l - 1) % MAXL;
        level.set(c, l);
        if (l) info.lifted++;
        if (l > info.levels) info.levels = l;
      }
      for (let i = 0; i < nq; i++) {
        if (noLift && noLift[quadCube[i]]) continue;
        const l = level.get(quadCube[i]);
        if (!l) continue;
        const q = i * QW, o = i * 12, k = l * S.lift * PX;
        for (let v = 0; v < 4; v++) {
          const s1 = v === 1 || v === 2 ? 1 : -1, s2 = v >= 2 ? 1 : -1;            // TL TR BR BL：e1 往 TR，e2 往 BL
          pos[o + v * 3] += k * (Q[q + 3] + s1 * Q[q + 6] + s2 * Q[q + 9]);
          pos[o + v * 3 + 1] += k * (Q[q + 4] + s1 * Q[q + 7] + s2 * Q[q + 10]);
          pos[o + v * 3 + 2] += k * (Q[q + 5] + s1 * Q[q + 8] + s2 * Q[q + 11]);
        }
      }
    }
    // ---- ② 贴图坐标往面里收一点 ----
    if (S.uvIn > 0) {
      const iu = S.uvIn / tw, iv = S.uvIn / th;
      for (let i = 0; i < nq; i++) {
        const o = i * 8, cu = (uv[o] + uv[o + 2] + uv[o + 4] + uv[o + 6]) / 4, cv = (uv[o + 1] + uv[o + 3] + uv[o + 5] + uv[o + 7]) / 4;
        for (let v = 0; v < 4; v++) { uv[o + v * 2] += Math.sign(cu - uv[o + v * 2]) * iu; uv[o + v * 2 + 1] += Math.sign(cv - uv[o + v * 2 + 1]) * iv; }
      }
    }
    info.ms = Math.round(nowMs() - t0);
    return info;
  }
  Y._soften = soften;
  // ③：pos = 顶点，flat = 每个面原来的法线（每个顶点一份），out = 写进去的新法线；hidden[i] 非 0 = 第 i 个面现在不显示
  // （不参加平均，法线照原样）。→ { quads: 参加的面数, ms }
  function smoothNormals(pos, flat, out, hidden) {
    const S = Y.SOFT, nq = pos.length / 12, t0 = nowMs();
    for (let i = 0; i < flat.length; i++) out[i] = flat[i];
    const R = S.radius * PX, cosA = Math.cos(S.angle * DEG), cell = R, grid = new Map(), info = { quads: 0, ms: 0 };
    if (!(S.mix > 0) || !(R > 0) || !nq) return info;
    const Q = quadsOf(pos, flat, nq);
    const gk = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
    const box = new Float32Array(nq * 6);
    for (let i = 0; i < nq; i++) {
      if (hidden && hidden[i]) continue;
      info.quads++;
      const o = i * 12, b = i * 6;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let v = 0; v < 4; v++) {
        const x = pos[o + v * 3], y = pos[o + v * 3 + 1], z = pos[o + v * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      box[b] = x0; box[b + 1] = y0; box[b + 2] = z0; box[b + 3] = x1; box[b + 4] = y1; box[b + 5] = z1;
      const a1 = Math.floor(x1 / cell), b1 = Math.floor(y1 / cell), c1 = Math.floor(z1 / cell);
      for (let a = Math.floor(x0 / cell); a <= a1; a++) for (let bb = Math.floor(y0 / cell); bb <= b1; bb++) for (let c = Math.floor(z0 / cell); c <= c1; c++) {
        const k = gk(a, bb, c), L = grid.get(k);
        if (L) L.push(i); else grid.set(k, [i]);
      }
    }
    const lim = 2 * R, seen = new Int32Array(nq).fill(-1), near = [];
    for (let i = 0; i < nq; i++) {
      if (hidden && hidden[i]) continue;
      const o = i * 12, q = i * QW, b = i * 6, nx = Q[q + 3], ny = Q[q + 4], nz = Q[q + 5];
      // 这个面周围 R 以内、朝向差不多的面（四个顶点共用这一份）
      near.length = 0;
      const a1 = Math.floor((box[b + 3] + R) / cell), b1 = Math.floor((box[b + 4] + R) / cell), c1 = Math.floor((box[b + 5] + R) / cell);
      for (let a = Math.floor((box[b] - R) / cell); a <= a1; a++) for (let bb = Math.floor((box[b + 1] - R) / cell); bb <= b1; bb++) for (let c = Math.floor((box[b + 2] - R) / cell); c <= c1; c++) {
        const L = grid.get(gk(a, bb, c));
        if (!L) continue;
        for (let n = 0; n < L.length; n++) {
          const j = L[n];
          if (seen[j] === i) continue;
          seen[j] = i;
          const p = j * QW, d = j * 6;
          if (nx * Q[p + 3] + ny * Q[p + 4] + nz * Q[p + 5] <= cosA) continue;
          if (box[d] - box[b + 3] < R && box[b] - box[d + 3] < R && box[d + 1] - box[b + 4] < R && box[b + 1] - box[d + 4] < R
            && box[d + 2] - box[b + 5] < R && box[b + 2] - box[d + 5] < R) near.push(p);            // 两个面的包围盒相隔不到 R
        }
      }
      for (let v = 0; v < 4; v++) {
        const x = pos[o + v * 3], y = pos[o + v * 3 + 1], z = pos[o + v * 3 + 2];
        let sx = 0, sy = 0, sz = 0;
        for (let n = 0; n < near.length; n++) {
          const p = near[n], dx = x - Q[p], dy = y - Q[p + 1], dz = z - Q[p + 2];
          const h = dx * Q[p + 3] + dy * Q[p + 4] + dz * Q[p + 5];
          const u = Math.max(0, Math.abs(dx * Q[p + 6] + dy * Q[p + 7] + dz * Q[p + 8]) - Q[p + 12]);
          const w = Math.max(0, Math.abs(dx * Q[p + 9] + dy * Q[p + 10] + dz * Q[p + 11]) - Q[p + 13]);
          const d2 = h * h + u * u + w * w;
          if (d2 >= R * R) continue;
          const f = 1 - Math.sqrt(d2) / R, dot = nx * Q[p + 3] + ny * Q[p + 4] + nz * Q[p + 5];
          const k = Math.min(2 * Q[p + 12], lim) * Math.min(2 * Q[p + 13], lim) * f * f * (dot - cosA) / (1 - cosA);
          sx += Q[p + 3] * k; sy += Q[p + 4] * k; sz += Q[p + 5] * k;
        }
        const sl = Math.hypot(sx, sy, sz);
        if (!(sl > 1e-12)) continue;
        const mx = nx * (1 - S.mix) + sx / sl * S.mix, my = ny * (1 - S.mix) + sy / sl * S.mix, mz = nz * (1 - S.mix) + sz / sl * S.mix;
        const ml = Math.hypot(mx, my, mz) || 1;
        out[o + v * 3] = mx / ml; out[o + v * 3 + 1] = my / ml; out[o + v * 3 + 2] = mz / ml;
      }
    }
    info.ms = Math.round(nowMs() - t0);
    return info;
  }
  Y._smoothNormals = smoothNormals;
  // 贴图坐标改成 centroid 插值（WebGL2）：多重采样时面边缘的像素不再取到面外面的那一格（见上面 ②）
  function centroidUv(m) {
    m.onBeforeCompile = (sh, renderer) => {
      const C = THREE.ShaderChunk;
      if (!C || !renderer || !renderer.capabilities || !renderer.capabilities.isWebGL2) return;
      const fix = (s) => String(s).replace('varying vec2 vMapUv;', 'centroid varying vec2 vMapUv;');
      sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', fix(C.uv_pars_vertex));
      sh.fragmentShader = sh.fragmentShader.replace('#include <uv_pars_fragment>', fix(C.uv_pars_fragment));
    };
    m.customProgramCacheKey = () => 'ysm-centroid-uv';
    return m;
  }
  // build geometry + bones. → { root (our frame), turn (π group), bones: { name: Bone }, list: [Bone], mesh, rest: Map(bone → { p, r }) }
  function buildRig(model, pre) {
    const G = model.geo, list = [], byName = {}, byLower = {}, pv = new Map(), restR = new Map();
    const root = new THREE.Group(); root.name = 'ysm';
    const turn = new THREE.Group(); turn.name = 'ysm-turn'; turn.rotation.y = Math.PI; root.add(turn);
    const U = 1 / 16;
    for (const b of G.bones) {
      if (!b || !b.name) continue;
      const bone = new THREE.Bone(); bone.name = b.name;
      list.push(bone); byName[b.name] = bone; byLower[b.name.toLowerCase()] = bone;
      pv.set(bone, bbPos(b.pivot || [0, 0, 0]));
      bone.userData.def = b;
    }
    for (const bone of list) {
      const b = bone.userData.def, par = b.parent && (byName[b.parent] || byLower[String(b.parent).toLowerCase()]);   // 父骨骼：先精确，再不分大小写（Blockbench 的做法）
      let p = par && par !== bone ? par : null;
      for (let q = p; q; q = q.parent) if (q === bone) { p = null; break; }          // parent cycle guard
      (p || turn).add(bone);
      const P = pv.get(bone), Q = p ? pv.get(p) : [0, 0, 0];
      bone.position.set((P[0] - Q[0]) * U, (P[1] - Q[1]) * U, (P[2] - Q[2]) * U);
      bone.rotation.copy(eulerZYX(b.rotation || [0, 0, 0]));
      restR.set(bone, [bone.rotation.x, bone.rotation.y, bone.rotation.z]);
      bone.userData.rest = bone.position.clone();                                     // 65-girl-actor contract
    }
    root.updateMatrixWorld(true);
    const turnInv = new THREE.Matrix4().copy(turn.matrixWorld).invert();
    // part path per bone: 小鲸鱼/<类别>/<骨骼>
    const catOf = (bone) => { for (let q = bone; q && q.isBone; q = q.parent) for (const [re, c] of CAT) if (re.test(q.name)) return c; return '身体'; };
    const pos = [], nor = [], uv = [], si = [], sw = [], idx = [], groups = [], tags = [], quadCube = [], noLift = [];
    let cubeN = 0;
    // 脸上那一层「贴图纸片」不参加 ①「按级往外胀」（2026-11-15 修）：
    //   眼睛：眼球 / 眼白 / 瞳孔 / 高光 / 眼睑 / 睫毛 / 眉毛
    //   嘴：smile / catMouth / toothSmile / openMouth…（父骨骼 Mouth / GuiMouth / AutoMouth 都算）
    //   其他脸部配件：腮红 Shy / 胡须 Whiskers / 眼泪 Tears / 问号（父骨骼 ExtraFace 一类）
    // 这些方块本来就是一层贴图叠在另一层前面、位置几乎完全一样，MC 里靠绘制顺序决定谁盖谁。按级一胀，
    // 谁高谁低整个反过来 —— 眼白上的高光被眼睑盖掉、嘴的边被相邻的嘴型/牙齿压出锯齿，剩下的两个面只差
    // 零点几毫米，跟随镜头默认 9 米远时深度精度只有约 ±0.24 mm，那片像素就在两层之间来回跳（用户反馈「一直闪」）。
    // 保持原样：深度逐位相同 → 后画的稳定盖住先画的。② 贴图坐标内收、③ 法线平均照做，不影响这一层。
    const FACE_LIFT_SKIP = /eye|pupil|iris|lid|lash|brow|mouth|tooth|teeth|tongue|lip|smile|cry|sulk|extraface|tear|whisker|shy|cheek|question|瞳|眼|睫|眉|嘴|牙|舌|唇|泪|腮|须/i;
    const noLiftOf = (bone) => { for (let q = bone; q && q.isBone; q = q.parent) if (FACE_LIFT_SKIP.test(q.name)) return true; return false; };
    const tw = G.texW, th = G.texH, v = new THREE.Vector3(), m4 = new THREE.Matrix4(), nm = new THREE.Matrix3();
    const inHead = (bone) => { for (let q = bone; q && q.isBone; q = q.parent) if (/^(all)?head$/i.test(q.name)) return true; return false; };
    let headTop = -Infinity, top = -Infinity;
    const headVerts = [];
    list.forEach((bone, bi) => {
      const b = bone.userData.def, cubes = Array.isArray(b.cubes) ? b.cubes : [];
      if (!cubes.length) return;
      const start = idx.length;
      const bindM = new THREE.Matrix4().multiplyMatrices(turnInv, bone.matrixWorld);   // bone-local → turn space at rest
      const P = pv.get(bone), headSub = inHead(bone);
      for (const c of cubes) {
        if (!c || !c.origin || !c.size) continue;
        const cubeI = cubeN++;
        noLift[cubeI] = noLiftOf(bone) ? 1 : 0;
        // Blockbench: from = (−(ox+sx), oy, oz), to = from + size（尺寸可以是负的：盒子翻过来、绕向反过来，描边模型靠它）；inflate 往外长
        const inf = +(c.inflate != null ? c.inflate : b.inflate || 0) || 0, s = c.size;
        const lo = [-(+c.origin[0] + +s[0]), +c.origin[1], +c.origin[2]], hi = [-(+c.origin[0]), +c.origin[1] + +s[1], +c.origin[2] + +s[2]];
        for (let a = 0; a < 3; a++) { const g = hi[a] >= lo[a] ? 1 : -1; lo[a] -= inf * g; hi[a] += inf * g; }
        const rot = c.rotation && c.rotation.some(x => +x) ? new THREE.Matrix4().makeRotationFromEuler(eulerZYX(c.rotation)) : null;
        const cp = bbPos(c.pivot || [0, 0, 0]);
        const mirror = c.mirror != null ? !!c.mirror : !!b.mirror;
        const rects = Array.isArray(c.uv) ? boxRects(+c.uv[0] || 0, +c.uv[1] || 0, s, mirror) : null;
        for (const f of FACES) {
          let r;
          if (rects) r = rects[f];
          else if (c.uv && c.uv[f]) {
            const F = c.uv[f], o = F.uv || [0, 0], z = F.uv_size || [0, 0];
            r = [+o[0], +o[1], +o[0] + +z[0], +o[1] + +z[1]];
            const k = ((+F.uv_rotation || 0) / 90 | 0) & 3;
            if (k) r = { rect: r, rot: k };
          } else continue;                                                               // face without UV: not drawn
          const F = FACE[f], ax = f === 'north' || f === 'south' ? [0, 1] : f === 'east' || f === 'west' ? [2, 1] : [0, 2];
          if (!(Math.abs(hi[ax[0]] - lo[ax[0]]) > 1e-6) || !(Math.abs(hi[ax[1]] - lo[ax[1]]) > 1e-6)) continue;   // zero-area face
          const rect = r.rect || r, rk = r.rot || 0;
          const tex = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];   // TL TR BR BL
          const base = pos.length / 3;
          for (let q = 0; q < 4; q++) {
            const k = F.c[q];
            v.set(k[0] ? hi[0] : lo[0], k[1] ? hi[1] : lo[1], k[2] ? hi[2] : lo[2]);
            if (rot) { v.x -= cp[0]; v.y -= cp[1]; v.z -= cp[2]; v.applyMatrix4(rot); v.x += cp[0]; v.y += cp[1]; v.z += cp[2]; }
            v.set((v.x - P[0]) * U, (v.y - P[1]) * U, (v.z - P[2]) * U).applyMatrix4(bindM);
            pos.push(v.x, v.y, v.z);
            if (v.y > top) top = v.y;
            if (headSub) { if (v.y > headTop) headTop = v.y; headVerts.push(pos.length / 3 - 1); }
            const t = tex[(q - rk + 4) & 3];
            uv.push(t[0] / tw, t[1] / th);
            si.push(bi, 0, 0, 0); sw.push(1, 0, 0, 0);
          }
          const n = new THREE.Vector3(F.n[0], F.n[1], F.n[2]);
          if (rot) n.applyMatrix4(m4.extractRotation(rot));
          n.applyMatrix3(nm.getNormalMatrix(bindM)).normalize();
          for (let q = 0; q < 4; q++) nor.push(n.x, n.y, n.z);
          quadCube.push(cubeI);
          idx.push(base, base + 3, base + 2, base, base + 2, base + 1);   // TL BL BR · TL BR TR (CCW from outside)
        }
      }
      const count = idx.length - start;
      if (count) { groups.push({ start, count, bone: bi }); tags.push(pre.root + '/' + catOf(bone) + '/' + bone.name); }
    });
    const soft = softOn(pre) ? soften(pos, nor, uv, quadCube, tw, th, noLift) : null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    const triTag = new Uint16Array(idx.length / 3);
    groups.forEach((gr, i) => { g.addGroup(gr.start, gr.count, i); triTag.fill(i, gr.start / 3, (gr.start + gr.count) / 3); });
    g.computeBoundingBox(); g.computeBoundingSphere();
    return { root, turn, list, byName, byLower, restR, geometry: g, faceTags: tags, triTag, tris: idx.length / 3, groups, soft,
      height: Number.isFinite(headTop) ? headTop : Number.isFinite(top) ? top : 32 / 16, headVerts };
  }
  Y._buildRig = buildRig;
  // ---- 动画：基岩版关键帧 + Molang ----------------------------------------------------------------------------------
  const ML = () => V3.molang;
  const comp = (x) => (typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0)
    : typeof x === 'string' ? (x.trim() !== '' && Number.isFinite(+x) ? +x : ML().compile(x)) : 0);
  const vec = (v) => { if (Array.isArray(v)) return [comp(v[0] == null ? 0 : v[0]), comp(v[1] == null ? 0 : v[1]), comp(v[2] == null ? 0 : v[2])]; const c = comp(v); return [c, c, c]; };
  const isKey = (o) => o && typeof o === 'object' && !Array.isArray(o) && ('pre' in o || 'post' in o || 'lerp_mode' in o);
  // channel json → { st: vec } | { keys: [{ t, pre, post, lerp }] }
  function chan(j) {
    if (j == null) return null;
    if (Array.isArray(j) || typeof j !== 'object') return { st: vec(j) };
    if (isKey(j)) return { st: vec(j.post !== undefined ? j.post : j.pre) };
    if (j.vector) return { st: vec(j.vector) };
    const keys = [];
    for (const k in j) {
      const t = parseFloat(k), v = j[k];
      if (!Number.isFinite(t)) continue;
      if (isKey(v)) { const post = vec(v.post !== undefined ? v.post : v.pre); keys.push({ t, pre: v.pre !== undefined ? vec(v.pre) : post, post, lerp: v.lerp_mode || 'linear' }); }
      else { const x = vec(v); keys.push({ t, pre: x, post: x, lerp: 'linear' }); }
    }
    keys.sort((a, b) => a.t - b.t);
    return keys.length ? { keys } : null;
  }
  // animation json → { name, group, len, loop: 'loop' | 'hold' | 'once', bones: [{ bone, rot, pos, scl }], tl: [{ t, fn }], weight }
  function animOf(name, group, a, rig) {
    const bones = [];
    let last = 0;
    for (const bn in (a && a.bones) || {}) {
      // 骨骼名区分大小写（YSM 基于 GeckoLib，按名字精确匹配）：dsV4P 动画里的小写 tail 对不上 Tail，在 YSM 里也不起作用
      const B = a.bones[bn] || {}, e = { bone: rig.byName[bn] || null, rot: chan(B.rotation), pos: chan(B.position), scl: chan(B.scale) };
      for (const c of [e.rot, e.pos, e.scl]) if (c && c.keys) last = Math.max(last, c.keys[c.keys.length - 1].t);
      if (e.rot || e.pos || e.scl) bones.push(e);
    }
    const tl = [];
    for (const k in (a && a.timeline) || {}) {
      const t = parseFloat(k), v = a.timeline[k];
      if (Number.isFinite(t)) tl.push({ t, fn: ML().compile(Array.isArray(v) ? v.join('\n') : String(v)) });   // 拆成多行的 { } 块要先拼起来
    }
    // 音效关键帧 sound_effects: { "4.58": { "effect": "aaa" } }（effect = sounds/ 里的文件名）→ 和 timeline 一起触发
    for (const k in (a && a.sound_effects) || {}) {
      const t = parseFloat(k);
      if (!Number.isFinite(t)) continue;
      for (const e of [].concat(a.sound_effects[k])) {
        const n = e && (typeof e === 'string' ? e : e.effect || e.sound);
        if (n) tl.push({ t, fn: (c) => { if (c.sound) c.sound(String(n)); } });
      }
    }
    tl.sort((x, y) => x.t - y.t);
    const loop = a && (a.loop === true || a.loop === 'true') ? 'loop' : a && a.loop === 'hold_on_last_frame' ? 'hold' : 'once';
    return { name, group, len: +(a && a.animation_length) || last || 0, loop, bones, tl, weight: a && a.blend_weight != null ? comp(a.blend_weight) : 1 };
  }
  const evc = (c, ctx) => (typeof c === 'number' ? c : ML().num(c(ctx)));
  const S3 = [0, 0, 0];
  // edges (Blockbench): before the first key → its pre; after the last → its post; linear post → next pre; catmull-rom if either end says so
  function sample(ch, t, ctx, o) {
    if (ch.st) { o[0] = evc(ch.st[0], ctx); o[1] = evc(ch.st[1], ctx); o[2] = evc(ch.st[2], ctx); return o; }
    const K = ch.keys, n = K.length;
    let v;
    if (n === 1 || t <= K[0].t) v = K[0].pre;
    else if (t >= K[n - 1].t) v = K[n - 1].post;
    else {
      let i = 0;
      while (i < n - 2 && K[i + 1].t <= t) i++;
      const a = K[i], b = K[i + 1], f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      if (a.lerp === 'step') v = a.post;
      else if (a.lerp === 'catmullrom' || b.lerp === 'catmullrom') {
        const p0 = (K[i - 1] || a).post, p3 = (K[i + 2] || b).pre, f2 = f * f, f3 = f2 * f;
        for (let k = 0; k < 3; k++) {
          const P0 = evc(p0[k], ctx), P1 = evc(a.post[k], ctx), P2 = evc(b.pre[k], ctx), P3 = evc(p3[k], ctx);
          o[k] = 0.5 * (2 * P1 + (-P0 + P2) * f + (2 * P0 - 5 * P1 + 4 * P2 - P3) * f2 + (-P0 + 3 * P1 - 3 * P2 + P3) * f3);
        }
        return o;
      } else {
        for (let k = 0; k < 3; k++) { const A = evc(a.post[k], ctx), B = evc(b.pre[k], ctx); o[k] = A + (B - A) * f; }
        return o;
      }
    }
    o[0] = evc(v[0], ctx); o[1] = evc(v[1], ctx); o[2] = evc(v[2], ctx);
    return o;
  }
  // one playing animation: { A, t (seconds since start), done }
  const localTime = (P) => {
    const A = P.A, len = A.len;
    if (!(len > 0)) return P.t;
    if (A.loop === 'loop') return P.t % len;
    return Math.min(P.t, len);                     // hold / once (once: P.done after len)
  };
  // apply one layer: replace (weight w) per bone + channel it animates; parallel layers ADD rotation
  function applyLayer(P, ctx, out, w, additiveRot, sleepChannels, sleepWeight = 0) {
    const A = P.A, lt = localTime(P);
    ctx.q.anim_time = P.t; ctx.q.life_time = lt;   // YSM 文档：anim_time 不随循环清零，life_time 是这一圈里的秒数
    if (A.weight !== 1) w *= Math.max(0, Math.min(1, evc(A.weight, ctx)));
    if (!(w > 0)) return;
    for (const e of A.bones) {
      const o = e.bone ? out.get(e.bone) : null;  // 没有这根骨骼（如 molang 假骨骼）：照样求值，只为里面的赋值
      if (e.rot) {
        sample(e.rot, lt, ctx, S3);
        if (o) {
          const x = -S3[0] * DEG, y = -S3[1] * DEG, z = S3[2] * DEG;
          if (additiveRot) { o.r[0] += x * w; o.r[1] += y * w; o.r[2] += z * w; }
          else { o.r[0] += (x - o.r[0]) * w; o.r[1] += (y - o.r[1]) * w; o.r[2] += (z - o.r[2]) * w; }
        }
      }
      if (e.pos) {
        sample(e.pos, lt, ctx, S3);
        const pw = sleepChannels?.get(e.bone)?.pos ? w * (1 - sleepWeight) : w;
        if (o) { o.p[0] += (-S3[0] - o.p[0]) * pw; o.p[1] += (S3[1] - o.p[1]) * pw; o.p[2] += (S3[2] - o.p[2]) * pw; }
      }
      if (e.scl) {
        sample(e.scl, lt, ctx, S3);
        const sw = sleepChannels?.get(e.bone)?.scl ? w * (1 - sleepWeight) : w;
        if (o) { o.s[0] += (S3[0] - o.s[0]) * sw; o.s[1] += (S3[1] - o.s[1]) * sw; o.s[2] += (S3[2] - o.s[2]) * sw; }
      }
    }
  }
  function runTimeline(P, t0, t1, ctx) {           // timeline keys crossed between local times t0 → t1 (wrapping on loop)
    const tl = P.A.tl;
    if (!tl.length) return;
    const hit = (t) => (t1 >= t0 ? t > t0 && t <= t1 : t > t0 || t <= t1);
    for (const k of tl) if (hit(k.t) || (P.first && k.t <= t1)) k.fn(ctx);
    P.first = false;
  }
  // ---- 贴图 ----------------------------------------------------------------------------------------------------------
  function texOf(bytes) {
    const tex = new THREE.Texture();
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    if (bytes && typeof Image !== 'undefined') {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), img = new Image();
      img.onload = () => { tex.image = img; tex.needsUpdate = true; URL.revokeObjectURL(url); };
      img.onerror = () => { URL.revokeObjectURL(url); V3.err('ysm: 贴图读不出来'); };
      img.src = url;
    }
    return tex;
  }

  // ---- 角色：Y.build(model, { height, anchor, partRoot, studio }) → inst -----------------------------------------------
  // 游戏里的动作 → YSM 动画（找到第一个有的）；捡东西时再叠一个伸手（hand 层）
  // cheer 用模型自带的 jump（一整个循环 0.75 s 正好是一下蹦，由 65-girl-actor 只放 CHEER_ACT 这么久），之后换成 idle 只举手
  const STATE = { stand: ['idle'], walk: ['walk'], pickup: ['sneaking', 'sneak', 'idle'], cheer: ['jump', 'idle'], huddle: ['sneaking', 'sneak', 'idle'] };   // sit 是 MC 的骑乘坐姿，坐得比门廊沿高：缩着就用蹲下
  const HAND = { pickup: ['use_mainhand', 'use_righthand', 'swing_hand'] };
  // ---- 音效（WebAudio，第一次用才建；浏览器要等页面上点过一次才出声）----
  let actx = null;
  const sndBuf = new WeakMap();                    // bytes → Promise<AudioBuffer>
  Y.soundOn = () => !(V3.game && V3.game.get && V3.game.get('girlSound') === false);
  Y.soundCount = 0;
  function playSound(model, name, vol) {
    if (!Y.soundOn()) return;
    const S = (model && model.sounds) || {}, bytes = S[name] || S[String(name).toLowerCase()];
    if (!bytes) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      let p = sndBuf.get(bytes);
      if (!p) { p = actx.decodeAudioData(bytes.slice().buffer); sndBuf.set(bytes, p); p.catch(() => {}); }
      p.then((buf) => {
        const src = actx.createBufferSource(), g = actx.createGain();
        g.gain.value = vol == null ? 0.7 : vol; src.buffer = buf; src.connect(g); g.connect(actx.destination); src.start();
        Y.soundCount++;
      }).catch(() => {});
    } catch (e) { /* no audio here */ }
  }
  const PAR = /^(pre_)?parallel(\d+)$/;
  // MC 画蹲着的玩家时整个模型往下挪 0.125 格（2 px），作者的 sneaking / sneak 动画都按这个做（脚抬高约 2 px）：我们也挪，不然蹲着会飘起来
  const CROUCH = /^sneak(ing)?$/, CROUCH_DY = 2 / 16;
  const UMB_POSE = { arm: [-10, 0, 80], fore: [0, 0, 40] };   // 撑伞时右大臂往外侧抬、小臂往上弯，手在脸颊外侧（Blockbench 度数，加在静止姿势上；大头小手的 Q 版模型够不到头顶）
  // 欢呼时大臂、小臂的角度（Blockbench 度数，加在静止姿势上；左臂取镜像），wave = 手来回晃的幅度。Q 版模型头大手短，手举不过头顶：
  // 直着往上举（z 105 以上、不往前）整条手臂被两边的头发挡住，看不见；往前带 50° 以后两只手举在脸的两侧，正面、侧面都看得到
  // 2026-11-16：原来的 [-50, 0, 98] / [0, 0, 32] 抬得太高（看着约 60°），两只手正好挡在脸前面；降到约 40–45°：手在脸颊外侧，不挡脸
  const CHEER_POSE = { arm: [-40, 0, 75], fore: [0, 0, 20], wave: 6 };
  const CHEER_WAVE_T = 0.6;                        // 手只晃一个来回（秒），晃完停在举起的姿势上，不再一直晃
  Y.build = function (model, opts) {
    opts = opts || {};
    V3.molang.radians = true;                      // YSM：asin / acos / atan 返回弧度
    const root0 = opts.partRoot || '小鲸鱼', pre = { root: root0, soft: opts.soft };
    const rig = buildRig(model, pre);
    const texs = model.textures.map(t => ({ name: t.name, bytes: t.bytes, tex: null }));
    const texAt = (i) => { const T = texs[i]; if (!T) return null; if (!T.tex) T.tex = texOf(T.bytes); return T.tex; };
    const mat = new THREE.MeshStandardMaterial({ map: texAt(0), roughness: 0.85, metalness: 0, alphaTest: 0.1 });
    mat.name = 'ysm';
    if (rig.soft) centroidUv(mat);
    const mesh = new THREE.SkinnedMesh(rig.geometry, rig.faceTags.length ? rig.faceTags.map(() => mat) : mat);
    mesh.name = 'ysm-body'; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    Object.assign(mesh.userData, { faceTags: rig.faceTags, triTag: rig.triTag, anchor: (opts.anchor || 'ysm:') + 'body' });
    rig.turn.add(mesh);
    rig.root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(rig.list);
    mesh.bind(skeleton);
    // ysmGlow* 骨骼自己的方块（不含子骨骼）在 YSM 里全亮、不受光照：单独一个网格（同一份顶点、同一套骨骼）叠在上面画，
    // 主体照样一次绘制。点选、阴影都不算它
    // 眼睛例外（Y.isEyeGlowBone）：全亮的眼睛在阴天、夜里像两盏灯。默认不给眼睛画全亮叠层，让它和脸一起受光；
    // 眼睛的面本来就在主体网格里，所以什么都不会少。这条规则对所有模型都生效（自带的、导入的、同一作者的换装版），
    // 不再只认某一个模型 id。opts.eyeGlow === true（玩家在「模型设置」里勾了「眼睛发光」）时按作者原样全亮。
    // 灯、光环这类非眼睛的 ysmGlow 骨骼不受影响。opts.tune.disableGlowBones 仍可按名字额外关掉个别骨骼。
    const gIndex = rig.geometry.index.array;
    const skipGlow = new Set(opts.tune && opts.tune.disableGlowBones || []);
    const glowBones = [];                            // [{ name, eye, start, count }]：这个模型所有可以全亮的骨骼
    for (const gr of rig.groups) {
      const bone = rig.list[gr.bone], name = bone.name;
      if (/^ysmGlow/.test(name) && !skipGlow.has(name)) glowBones.push({ name, eye: Y.isEyeGlowBone(bone), start: gr.start, count: gr.count });
    }
    const hasEyeGlow = glowBones.some(b => b.eye);
    let eyeGlow = opts.eyeGlow === true;
    const glowIndexFor = (withEyes) => {
      const out = [];
      for (const b of glowBones) if (withEyes || !b.eye) for (let i = b.start; i < b.start + b.count; i++) out.push(gIndex[i]);
      return out;
    };
    let glowMat = null, glowMesh = null;
    if (glowBones.length) {
      const gg = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) gg.setAttribute(k, rig.geometry.attributes[k]);
      gg.setIndex(glowIndexFor(eyeGlow));
      glowMat = new THREE.MeshBasicMaterial({ map: texAt(0), alphaTest: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      glowMat.name = 'ysm-glow';
      if (rig.soft) centroidUv(glowMat);
      glowMesh = new THREE.SkinnedMesh(gg, glowMat);
      Object.assign(glowMesh, { name: 'ysm-glow', frustumCulled: false, castShadow: false, receiveShadow: false, renderOrder: 1 });
      Object.assign(glowMesh.userData, { noShadow: true, noReceive: true, fbOverlay: true });
      glowMesh.raycast = () => {};
      rig.turn.add(glowMesh);
      glowMesh.bind(skeleton, mesh.bindMatrix);
      glowMesh.visible = glowMesh.geometry.index.count > 0;      // 只有眼睛会亮、又没开眼睛发光：整层不画
    }
    const P = V3.parts;
    if (P && P.tagFaces) { P.tagFaces(mesh); if (P.declare) P.declare(rig.faceTags); }
    if (P && P.solo) P.solo(mesh);                 // 一次绘制；反馈工具要按骨骼隐藏时会自己拆开
    // animations: groups (main / extra / arm / tac …) → name → anim
    const A = {}, list = [];
    for (const g in model.anims) for (const n in model.anims[g]) {
      if (/^——/.test(n)) continue;                // separators
      const an = animOf(n, g, model.anims[g][n], rig);
      list.push(an);
      if (!A[n] || g === 'main') A[n] = an;        // main wins on name clashes
    }
    // Molang context (per model instance)
    const fo = new Map(), so = new Map();
    const ctx = { q: {}, v: {}, t: {}, c: {}, ns: { ysm: {}, ctrl: {}, fn: {} } };
    const Q = ctx.q, YS = ctx.ns.ysm, CT = ctx.ns.ctrl;
    Object.assign(YS, {
      first_order: (name, x, k) => { const p = fo.has(name) ? fo.get(name) : +x; const r = p + (+x - p) * Math.max(0, Math.min(1, +k || 0.5)); fo.set(name, r); return r; },
      second_order: (name, x, f, c, r) => {
        let s = so.get(name); if (!s) { s = { y: +x, v: 0, xp: +x }; so.set(name, s); }
        const dt = Math.max(1e-3, Q.delta_time || 0.016), w = 2 * Math.PI * Math.max(0.1, +f || 1), z = Math.max(0, +c || 0.5), R = +r || 0;
        const xd = (+x - s.xp) / dt; s.xp = +x;
        const acc = w * w * (+x + R * z * xd / w * 0 - s.y) - 2 * z * w * s.v;
        s.v += acc * dt; s.y += s.v * dt;
        return s.y;
      },
      play_sound: () => 0, stop_sound: () => 0, particle: () => 0, sync: () => 0,
    });
    for (const k in A) { /* nothing: names only */ }
    // @player_init 一次（种下 v.* / v.roaming.* 的默认值）
    for (const F of model.functions) if (/^player_init$/i.test(F.hook)) { try { ML().compile(F.src)(ctx); } catch (e) { /* ignored */ } }
    const updFns = model.functions.filter(F => /^player_update$/i.test(F.hook)).map(F => ML().compile(F.src));
    // ---- 槽位（YSM-FORMAT「Animation controllers」）：pre_parallel_0…7 → main → 手 → parallel_0…7 ----
    // 槽位可以被动画控制器（JSON，键 = 槽位名，如 player.parallel_7）或脚本控制器（@player_ctrl_<槽位>.molang）接管；
    // 没接管的放 main 文件里的同名并行动画（pre_parallelN / parallelN）。main 槽位被接管时决定主动画（ysm-builtin / bypass = 照我们的动作表）。
    const valE = (e) => (typeof e === 'number' ? e : ML().num(e(ctx)));
    const compE = (x) => {
      if (typeof x === 'number') return x;
      if (typeof x === 'boolean') return x ? 1 : 0;
      try { return ML().compile(String(x)); } catch (e) { return 0; }
    };
    const stmts = (arr) => [].concat(arr || []).map(s => { try { return ML().compile(String(s)); } catch (e) { return null; } }).filter(Boolean);
    const compileCtrl = (def) => {
      const S = {};
      for (const [name, st0] of Object.entries((def && def.states) || {})) {
        const st = st0 || {}, bt = st.blend_transition;
        S[name] = {
          anims: [].concat(st.animations || []).map(a => (typeof a === 'string' ? { n: a, w: null }
            : a && typeof a === 'object' ? Object.entries(a).map(([n, w]) => ({ n, w: compE(w) }))[0] : null)).filter(Boolean),
          tr: [].concat(st.transitions || []).map(t => { const e = t && Object.entries(t)[0]; return e ? { to: e[0], cond: compE(e[1]) } : null; }).filter(Boolean),
          onEntry: stmts(st.on_entry), onExit: stmts(st.on_exit),
          blend: typeof bt === 'number' ? bt : bt && typeof bt === 'object' ? Math.max(0, ...Object.keys(bt).map(Number).filter(Number.isFinite)) : 0,
        };
      }
      return { S, init: def && def.initial_state && S[def.initial_state] ? def.initial_state : Object.keys(S)[0] || null, cur: null };
    };
    const slots = new Map();
    const slotOf = (key) => {
      let S = slots.get(key);
      if (!S) {
        const m = /^(pre_)?parallel_(\d+)$/.exec(key);
        S = { key, pre: !!(m && m[1]), idx: m ? +m[2] : -1, builtin: null, C: null, script: null, act: [], old: [], fadeT: 0, fadeLen: 0,
          want: null, tlen: null, reset: false, pause: false, bypass: false, builtinOn: false };
        slots.set(key, S);
      }
      return S;
    };
    const SLOT_OK = /^(main|(pre_)?parallel_\d+)$/;
    for (const a of list) if (a.group === 'main') { const m = PAR.exec(a.name); if (m) slotOf((m[1] ? 'pre_' : '') + 'parallel_' + m[2]).builtin = { A: a, t: 0, first: true }; }
    for (const [k, def] of Object.entries(model.controllers || {})) { const key = String(k).toLowerCase().replace(/^player\./, ''); if (SLOT_OK.test(key)) slotOf(key).C = compileCtrl(def); }
    for (const F of model.functions) {
      const m = /^player_ctrl_(.+)$/i.exec(F.hook), key = m && m[1].toLowerCase();
      if (key && SLOT_OK.test(key)) { try { slotOf(key).script = ML().compile(F.src); } catch (e) { /* bad script: slot keeps its built-in */ } }
    }
    const preSlots = [...slots.values()].filter(S => S.pre).sort((a, b) => a.idx - b.idx);
    const parSlots = [...slots.values()].filter(S => !S.pre && S.key !== 'main').sort((a, b) => a.idx - b.idx);
    const mainSlot = slots.get('main') || null;
    const enterState = (S, name) => {
      const C = S.C, st = C.S[name];
      C.cur = name; S.builtinOn = name === 'ysm-builtin';
      for (const f of st.onEntry) f(ctx);
      S.act = st.anims.map(a => (A[a.n] ? { Pl: { A: A[a.n], t: 0, first: true }, wf: a.w, w: 1 } : null)).filter(Boolean);
    };
    const ctrlTick = (S) => {                      // 一帧最多换一次状态（基岩版也是）
      const C = S.C;
      if (!C.init) return;
      if (!C.cur) { enterState(S, C.init); return; }
      const st = C.S[C.cur];
      for (const t of st.tr) {
        if (!C.S[t.to] || !(valE(t.cond) !== 0)) continue;
        for (const f of st.onExit) f(ctx);
        S.old = S.act.filter(x => !x.Pl.done).map(x => ({ Pl: x.Pl, w: x.w })); S.fadeLen = st.blend; S.fadeT = 0;
        enterState(S, t.to);
        break;
      }
    };
    // 脚本控制器：每帧跑一次；ctrl.set_animation('名字'[, ctrl.loop | ctrl.play_once | ctrl.hold_on_last_frame])，
    // 返回 ctrl.state_continue / state_pause / state_stop / state_bypass（bypass = 这个槽位照内置的走）
    let scriptSlot = null;
    const ST = { state_continue: 11, state_pause: 12, state_stop: 13, state_bypass: 14 };
    Object.assign(CT, ST, { loop: 1, play_once: 2, hold_on_last_frame: 3,
      set_animation: (n, mode) => { if (scriptSlot) scriptSlot.want = { n: String(n), mode: +mode || 0 }; return 0; },
      set_beginning_transition_length: (s) => { if (scriptSlot) scriptSlot.tlen = Math.max(0, +s || 0); return 0; },
      reset: () => { if (scriptSlot) scriptSlot.reset = true; return 0; }, indicate_reload: () => 0 });
    Object.assign(YS, ST);
    const LOOPS = { 1: 'loop', 2: 'once', 3: 'hold' }, variants = new Map();
    const withMode = (an, mode) => {               // 脚本指定的播放方式和动画自己写的不一样：复制一份换掉 loop
      const lm = LOOPS[mode];
      if (!lm || lm === an.loop) return an;
      const k = an.group + ':' + an.name + '|' + lm;
      if (!variants.has(k)) variants.set(k, Object.assign({}, an, { loop: lm }));
      return variants.get(k);
    };
    const scriptTick = (S) => {
      scriptSlot = S; S.want = null;
      let r = 0;
      try { r = ML().num(S.script(ctx)); } catch (e) { r = 0; }
      scriptSlot = null;
      S.bypass = r === ST.state_bypass; S.pause = r === ST.state_pause;
      const fadeOut = (len) => { S.old = S.act.filter(x => !x.Pl.done).map(x => ({ Pl: x.Pl, w: x.w })); S.fadeLen = len; S.fadeT = 0; S.act = []; };
      if (S.bypass || r === ST.state_stop) { if (S.act.length) fadeOut(0.15); }
      else if (S.want && A[S.want.n]) {
        const an = withMode(A[S.want.n], S.want.mode), curPl = S.act[0] && S.act[0].Pl;
        if (!curPl || curPl.A !== an || S.reset) { fadeOut(S.tlen != null ? S.tlen : 0.15); S.act = [{ Pl: { A: an, t: 0, first: true }, wf: null, w: 1 }]; }
      }
      S.reset = false; S.tlen = null;
    };
    // ---- 音效：模型自带的 sounds/*.ogg；游戏设置「角色音效」关掉就不放 ----
    ctx.sound = (n) => playSound(model, n);
    YS.play_sound = (n) => { playSound(model, n); return 0; };
    const v0 = Object.assign({}, ctx.v);           // 作者的默认值：量身高只按这一套（见 normalize）
    for (const k in opts.vars || {}) ctx.v[k] = +opts.vars[k];   // 玩家在「模型设置」里改过的值（每个模型单独存）
    // bones for 65-girl-actor (missing → dummy Object3D, so overlays never crash)
    const B = (...names) => { for (const n of names) { const b = rig.byLower[n.toLowerCase()]; if (b) return b; } return null; };
    const dummy = (n) => { const o = new THREE.Object3D(); o.name = 'ysm-dummy-' + n; o.userData.rest = new THREE.Vector3(); rig.turn.add(o); return o; };
    const bones = {
      hips: B('AllBody', 'MAllBody', 'Root') || dummy('hips'), chest: B('UpperBody', 'UpBody', 'AllBody') || dummy('chest'),
      head: B('Head', 'AllHead', 'MHead') || dummy('head'), armR: B('RightArm') || dummy('armR'), armL: B('LeftArm') || dummy('armL'),
      legR: B('RightLeg') || dummy('legR'), legL: B('LeftLeg') || dummy('legL'),
    };
    const legBone = B('LeftLeg', 'RightLeg');
    // 我们自己的「腿长」（不是作者的设置，2026-11-05 用户要的）：LeftLeg / RightLeg 沿自身长度缩放，脚掌按反比补回去不压扁，
    // 整个模型往下挪 (1 − k)·胯高，脚还踩在地上；之后按头顶重新缩放到设定的身高。存在每个模型的设置里，键 '@legs'
    const LL = rig.byName.LeftLeg || null, RL = rig.byName.RightLeg || null, LF = rig.byName.LeftFoot || null, RF = rig.byName.RightFoot || null;
    const hipY = ((LL || RL) ? +((LL || RL).userData.def.pivot || [0, 0, 0])[1] : 0) / 16;
    const clampLegs = (k) => Math.max(0.4, Math.min(1.3, +k || 1));
    let legs = clampLegs((opts.vars || {})['@legs']);
    const legOff = () => -(1 - legs) * hipY;
    rig.turn.position.y = legOff();
    // 蹲下往下挪多少（量身高时一起量）：sneaking 第一帧脚比站着高多少就挪多少，最多 MC 的 2 px；旧版模型脚没抬高就不挪
    let crouchDy = 0;
    const crouchAnim = ['sneaking', 'sneak'].find(n => A[n] && A[n].group === 'main') || null;
    const legIdx = new Set();
    rig.list.forEach((b, i) => { for (let o = b; o && o.isBone; o = o.parent) if (/^(Left|Right)(Leg|Foot)/.test(o.name)) { legIdx.add(i); break; } });
    const out = new Map(rig.list.map(b => [b, { r: [0, 0, 0], p: [0, 0, 0], s: [1, 1, 1] }]));
    const clips = new Map(list.map(a => [a.group + ':' + a.name, a]));
    const sleepClip = clips.get('main:sleep');
    // 主睡眠动作写了位置或缩放时，让它在床上持有这些通道（如闭眼和睫毛）。并行发丝旋转仍然叠加。
    const sleepChannels = new Map((sleepClip?.bones || []).filter(e => e.bone && (e.pos || e.scl)).map(e => [e.bone, e]));
    let actorBase = null, actorOverlay = null, actorHand = null, actorLift = 0, actorPosed = false, actorDrawing = false, actorSleeping = false, actorWater = null;
    // 站在地上演的底层动画（不坐、不躺），比如 tlm:bookshelf「翻几页书」：作者按女仆坐在 TLM 家具上做的，AllBody 往下挪了 18.5 px，
    // 我们这里没有座位托着她，直接放会整个人陷进地板里（脚低 0.66 m）。setActorAnimation(…, { ground: true }) 时量一下这个动画摆出来
    // 最低的脚比站着的脚低多少，把模型往上抬这么多（只抬不压；跟着淡入淡出）。每个动画量一次，换腿长重新量。
    let standFoot = NaN;
    const liftCache = new Map();
    let clock = 0, cur = null, prev = null, fade = 1, hand = null, blinkT = 3, blink = 0, look = 0, lookUp = 0, wxK = 0, wxWet = 0;
    const lastPos = new THREE.Vector3(), wp = new THREE.Vector3();
    let speed = 0, havePos = false;
    const animOpts = [['', '（跟着动作走）']].concat(list.filter(a => !PAR.test(a.name) || a.group !== 'main')
      .map(a => [a.group + ':' + a.name, (a.group === 'main' ? '' : a.group + ' · ') + a.name]));
    let dtNow = 0;                                 // 暂停（dt = 0）时切动画直接切过去，不淡入（量 REACH、工作台暂停时）
    const play = (name) => {
      const a = A[name];
      if (cur?.A === a) return;
      prev = cur; cur = a ? { A: a, t: 0, first: true } : null;
      fade = prev && dtNow > 0 ? 0 : 1;
    };
    // 游戏里的调校（只给自带的模型配，29-ysmui 的 BUILTIN.tune）：表情对照表 face、偶尔久站 longIdle（秒）、撑伞姿势 umbrella
    const tune = opts.tune || {}, faceMap = tune.face || null;
    const RUA = rig.byName.RightArm || null, RFA = rig.byName.RightForeArm || null;
    const bottleGoal = new THREE.Vector3(), armRay = new THREE.Vector3(), goalRay = new THREE.Vector3();
    const armTurn = new THREE.Quaternion(), parentRotation = new THREE.Quaternion();
    function aimAtGrip(joint, hand, target = bottleGoal) {
      joint.getWorldPosition(goalRay);
      hand.getWorldPosition(armRay).sub(goalRay).normalize();
      goalRay.subVectors(target,goalRay).normalize();
      joint.parent.getWorldQuaternion(parentRotation).invert();
      armRay.applyQuaternion(parentRotation); goalRay.applyQuaternion(parentRotation);
      joint.quaternion.premultiply(armTurn.setFromUnitVectors(armRay,goalRay));
    }
    const LUA = rig.byName.LeftArm || null, LFA = rig.byName.LeftForeArm || null;
    const drawingArm = B('RightArm'), drawingForearm = B('RightForeArm');
    const supportArm = B('LeftArm'), supportForearm = B('LeftForeArm');
    const leftShin = B('LeftShin','LeftLowerLeg'), rightShin = B('RightShin','RightLowerLeg');
    const neck = B('AllHead','Head'), leftHand = B('LeftHandLocator','LeftHand');
    const whaleTail = B('WhaleTail'), supportGoal = new THREE.Vector3(), supportStep = new THREE.Vector3();
    const inst = {
      id: 'ysm', label: (model.meta && model.meta.name) || 'YSM 模型', root: rig.root, partRoot: root0, bones, mesh, rig, model,
      face: null, solo: true, noOverlay: true, noUmbrella: !RUA, umbUp: 0.97, longIdle: +tune.longIdle || 0, glow: glowMesh,
      states: {
        pose: { label: '动作', options: [['stand', '站立'], ['walk', '走路'], ['pickup', '蹲下捡'], ['cheer', '欢呼'], ['huddle', '缩着坐']], value: 'stand' },
        anim: { label: '动画', options: animOpts, value: '' },
        texture: { label: '贴图', options: texs.map((t, i) => [String(i), t.name]), value: '0' },
        expr: { label: '表情', options: [['happy', '（模型自己控制）']], value: 'happy' },
        ...(opts.studio ? { weather: { label: '天气', options: [['0', '晴'], ['1', '下雨'], ['2', '雷雨']], value: '0' } } : {}),   // 工作台预览；游戏里由 actor 调 setWeather
      },
      views: { front: { az: 0, el: 0.06, dist: 3.0, target: [0, 0.62, 0] }, side: { az: Math.PI / 2, el: 0.06, dist: 3.0, target: [0, 0.62, 0] },
        back: { az: Math.PI, el: 0.06, dist: 3.0, target: [0, 0.62, 0] }, q34: { az: 0.6, el: 0.15, dist: 3.1, target: [0, 0.62, 0] },
        face: { az: 0, el: 0.05, dist: 1.35, target: [0, 0.95, 0] } },
      poseK: null,
      leg: legBone ? Math.max(0.1, legBone.getWorldPosition(wp).y) : 0.35, swing: 0.5,
      handBone: B('RightHandLocator', 'RightHand', 'RightForeArm', 'RightArm') || bones.armR, handOff: new THREE.Vector3(),
      drawingPose(t, k, target) {
        // Keep the neck extended and the elbows on the mat. Local X is reversed
        // by YSM's half-turn at the base of the rig.
        if (neck) neck.rotateX(.94*k);
        if (supportArm) { supportArm.rotateX(.82*k); supportArm.rotateZ(.17*k); }
        if (supportForearm) supportForearm.rotateX(1.02*k);
        if (drawingArm) drawingArm.rotateX(.85*k);
        if (drawingForearm) drawingForearm.rotateX(.82*k);
        function foldLeg(side,shin,foot,leg) {
          const swing = .14*Math.sin(t*3.2+side*.9);
          if (shin && foot) {
            shin.rotateX((-1.52+swing)*k);
            foot.rotateX(.25*k);
          } else if (leg) {
            leg.rotateX((-.60+swing)*k);
          }
        }
        foldLeg(-1,rightShin,RF,RL);
        foldLeg(1,leftShin,LF,LL);
        if (whaleTail) whaleTail.rotateX(-.73*k);
        if (supportArm && supportForearm && leftHand && k>.02) {
          const [x,y,z]=target.center, yaw=target.yaw;
          supportGoal.set(x-.17*Math.cos(yaw)+.34*Math.sin(yaw),y+.045,z+.17*Math.sin(yaw)+.34*Math.cos(yaw));
          supportGoal.lerp(leftHand.getWorldPosition(supportStep),1-k);
          for (let i=0;i<3;i++) {
            aimAtGrip(supportForearm,leftHand,supportGoal);
            aimAtGrip(supportArm,leftHand,supportGoal);
          }
        }
      },
      aimHand(target) {
        const hand = inst.handBone;
        if (!drawingArm || hand === drawingArm) return false;
        for (let i = 0; i < 3; i++) {
          if (drawingForearm && hand !== drawingForearm) aimAtGrip(drawingForearm, hand, target);
          aimAtGrip(drawingArm, hand, target);
        }
        return true;
      },
      holdBottle() {
        const hand = inst.handBone;
        if (!RUA || !RFA || hand === RFA || !hand.parent) return;
        rig.root.worldToLocal(hand.getWorldPosition(bottleGoal));
        rig.root.worldToLocal(RUA.getWorldPosition(armRay));
        const lift = THREE.MathUtils.smoothstep(bottleGoal.y-armRay.y,-.18,0);
        bottleGoal.x -= .075*lift;
        bottleGoal.y += .045*lift;
        bottleGoal.z += .09*lift;
        rig.root.localToWorld(bottleGoal);
        for (let i=0;i<4;i++) { aimAtGrip(RFA,hand); aimAtGrip(RUA,hand); }
      },
      setLook(yaw, up) { look = +yaw || 0; lookUp = +up || 0; },
      // 天气（65-girl-actor 每帧调）：w = 0 晴 / 1 雨 / 2 雷雨（ysm.weather），wet = 正淋着雨（q.is_in_water_or_rain；躲在门廊下不算）
      setWeather(w, wet) { wxK = +w || 0; wxWet = wet ? 1 : 0; },
      // 撑伞（65-girl-actor 在 update 之后调，h = 0..1）：右大臂抬起、小臂竖起来，手在头的右边。角度是 Blockbench 的度数，加在静止姿势上
      umbrellaArm(h) {
        if (!(h > 0) || !RUA) return;
        const pose = inst.umbPose || tune.umbrella || UMB_POSE;   // inst.umbPose：调试时可以直接换
        const to = (b, d) => {
          if (!b || !d) return;
          const r = rig.restR.get(b), tx = r[0] - d[0] * DEG, ty = r[1] - d[1] * DEG, tz = r[2] + d[2] * DEG;
          b.rotation.set(b.rotation.x + (tx - b.rotation.x) * h, b.rotation.y + (ty - b.rotation.y) * h, b.rotation.z + (tz - b.rotation.z) * h, 'ZYX');
        };
        to(RUA, pose.arm); to(RFA, pose.fore);
      },
      // 欢呼（65-girl-actor 在 update 之后调，h = 0..1）：两只手举过头顶（捡到贝壳以后）。模型自带的 jump 手只往两边张开一点，
      // 没有举手的动画，所以和撑伞一样按骨骼摆：大臂往外上方抬、小臂再往上弯一点，左边是右边的镜像。
      // t = 欢呼开始后的秒数：前 CHEER_WAVE_T 秒手晃一个来回，之后定住（只演一遍，再保持姿势）
      cheerArms(h, t) {
        if (!(h > 0) || !RUA) return;
        const pose = inst.cheerPose || tune.cheer || CHEER_POSE, k = Math.max(0, Math.min(1, (+t || 0) / CHEER_WAVE_T));
        const wave = Math.sin(k * Math.PI * 2) * (pose.wave || 0);
        const to = (b, d, m) => {
          if (!b || !d) return;
          const r = rig.restR.get(b), tx = r[0] - d[0] * DEG, ty = r[1] - d[1] * DEG * m, tz = r[2] + (d[2] + wave) * DEG * m;
          b.rotation.set(b.rotation.x + (tx - b.rotation.x) * h, b.rotation.y + (ty - b.rotation.y) * h, b.rotation.z + (tz - b.rotation.z) * h, 'ZYX');
        };
        to(RUA, pose.arm, 1); to(RFA, pose.fore, 1); to(LUA, pose.arm, -1); to(LFA, pose.fore, -1);
      },
      // 调试 / 测试用：每个槽位现在放什么（控制器状态、脚本、内置并行动画）
      slotInfo() {
        return [...slots.values()].map(S => ({ key: S.key, ctrl: S.C ? S.C.cur : null, script: !!S.script, bypass: S.bypass,
          act: S.act.map(x => x.Pl.A.name), builtin: S.builtin ? S.builtin.A.name : null }));
      },
      forms: model.forms || [],
      getVar(k) { const x = ctx.v[k]; return typeof x === 'number' ? x : x ? 1 : 0; },
      setVar(k, x) { ctx.v[k] = +x || 0; resmoothSoon(); },
      runStmt(src) { try { ML().compile(String(src))(ctx); } catch (e) { /* ignored */ } resmoothSoon(); },
      hasAnimation(key) { return clips.has(key); },
      findAnimation(name) { const a = list.find(x => x.name.toLowerCase() === String(name).toLowerCase()); return a ? a.group + ':' + a.name : null; },
      // o.ground：站在地上演（量脚抬多少）；o.posed：65-girl-actor 把她摆着（坐着 / 躺着），不是「站着不动」——
      // 有 base / overlay 或 posed 时模型自己的待机计时不走（ctrl.idle = 0、ctrl.playing_extra_animation = 1，见 update）
      setActorAnimation(base, overlay, mode, o) {
        actorBase = clips.get(base) || null;
        actorPosed = !!(o && o.posed);
        actorDrawing = !!o?.drawing;
        actorSleeping = !!o?.sleeping;
        actorWater = o?.water || null;
        actorLift = actorBase && o && o.ground ? liftOf(actorBase.group + ':' + actorBase.name) : 0;
        const clip = clips.get(overlay);
        actorOverlay = clip ? withMode(clip, mode === 'hold' ? 3 : mode === 'loop' ? 1 : 0) : null;
      },
      get actorAnimation() {
        const key = clip => clip ? clip.group + ':' + clip.name : null;
        return { base: key(actorBase), overlay: key(actorOverlay), overlayMode: actorOverlay && actorOverlay.loop, lift: actorLift, posed: actorPosed };
      },
      setState(k, v) {
        if (!this.states[k]) return;
        this.states[k].value = v;
        if (k === 'texture') { const t = texAt(+v || 0); if (t) { mat.map = t; mat.needsUpdate = true; if (glowMat) { glowMat.map = t; glowMat.needsUpdate = true; } } }
      },
      update(dt, t) {
        dt = Math.max(0, Math.min(0.1, +dt || 0));
        clock += dt; dtNow = dt;
        rig.root.getWorldPosition(wp);                 // ground speed from the root's world motion (the actor moves it)
        if (havePos && dt > 0) speed += (Math.hypot(wp.x - lastPos.x, wp.z - lastPos.z) / dt - speed) * Math.min(1, dt * 8);
        lastPos.copy(wp); havePos = true;
        const st = inst.states, want = st.anim.value, pose = st.pose.value;
        const hn = !want && !actorBase && !actorOverlay && HAND[pose] ? HAND[pose].find(n => A[n]) : null;
        // queries (YSM names; see YSM-FORMAT §6)：先算好，控制器的条件、主动画、动画里的 Molang 都用这一帧的值
        if ((blinkT -= dt) <= 0) { blink = 0.15; blinkT = 2.5 + Math.random() * 3; }
        blink = Math.max(0, blink - dt);
        const moving = speed > 0.08, sp = speed / Math.max(0.2, rig.root.scale.y * 1.0);
        const W = st.weather ? +st.weather.value || 0 : wxK, wet = st.weather ? (W > 0 ? 1 : 0) : wxWet;
        const swimming = actorWater === 'swim', wetFeet = swimming || actorWater === 'wade', running = !wetFeet && speed > 1.3;
        Object.assign(Q, { delta_time: dt, ground_speed: sp * 1.7, vertical_speed: 0, is_on_ground: swimming ? 0 : 1, is_moving: moving ? 1 : 0,
          is_jumping: pose === 'cheer' ? 1 : 0, is_sneaking: pose === 'pickup' || pose === 'huddle' ? 1 : 0, is_sprinting: running ? 1 : 0,
          is_swimming: +swimming, is_riding: 0, is_sleeping: +actorSleeping, is_in_water: +wetFeet, is_in_water_or_rain: wetFeet ? 1 : wet, is_first_person: 0, is_alive: 1,
          health: 20, max_health: 20, hurt_time: 0, body_y_rotation: 0, yaw_speed: 0, cardinal_facing_2d: 2, moon_phase: 0,
          time_of_day: V3.env && V3.env.state && V3.env.state.hour != null ? V3.env.state.hour / 24 : 0.5,
          head_x_rotation: look / DEG, head_y_rotation: lookUp / DEG });
        Object.assign(YS, { head_yaw: look / DEG, head_pitch: lookUp / DEG, ground_speed2: sp * 1.7, time_delta: dt,
          input_vertical: moving ? 1 : 0, input_horizontal: 0, food_level: 20, armor_value: 0, weather: W, is_close_eyes: blink > 0 ? 1 : 0,
          person_view: 2, rendering_in_inventory: 0, rendering_in_paperdoll: 0, texture_name: (texs[+st.texture.value || 0] || {}).name || '',
          swinging: hn ? 1 : 0, swinging_arm: hn ? 1 : 0 });
        // 我们在放动作（躺着睡、坐着打字 / 吃饭、翻书…）或把她摆着（坐、躺）：对模型来说她不是「站着发呆」，在演额外动画。
        // 自带模型的 parallel_7 靠 ctrl.idle 计时，站满约 38 秒演 idle_1（铁盆那段），躺着、坐着时不该叠上去
        const busy = !!(actorBase || actorOverlay || actorPosed);
        Object.assign(CT, { idle: !moving && pose === 'stand' && !busy ? 1 : 0, walk: !swimming && pose === 'walk' ? 1 : 0, run: running ? 1 : 0, sneak: pose === 'pickup' || pose === 'huddle' ? 1 : 0,
          jump: pose === 'cheer' ? 1 : 0, swim: +swimming, fly: 0, sleep: +actorSleeping, death: 0, attacked: 0, playing_extra_animation: want || busy ? 1 : 0 });
        // 表情（游戏里说话 / 开心 / 害怕…；tune.face 只给自带的模型配）：这一帧临时改脸部变量，算完动画再换回玩家自己的设置
        const fx = faceMap && faceMap[st.expr.value];
        let faceKeep = null;
        if (fx) {
          const keys = Object.keys(fx.vars || {}).concat(fx.seq ? fx.seq.keys : []);
          faceKeep = keys.map(k => [k, ctx.v[k]]);
          Object.assign(ctx.v, fx.vars || {});
          if (fx.seq) { const v = fx.seq.values[Math.floor(clock / (fx.seq.every || 0.13)) % fx.seq.values.length]; for (const k of fx.seq.keys) ctx.v[k] = v; }
        }
        for (const f of updFns) f(ctx);
        for (const S of slots.values()) { if (S.C) ctrlTick(S); else if (S.script) scriptTick(S); }
        // 主动画：工作台里选的动画 > main 槽位的控制器 / 脚本 > 我们的动作表（STATE）
        const mainOv = !want && mainSlot && (mainSlot.C || mainSlot.script) && !mainSlot.bypass && !mainSlot.builtinOn && mainSlot.act[0] ? mainSlot.act[0].Pl.A : null;
        const selected = want ? clips.get(want) : actorBase || mainOv;
        // The actor animates the prone pose directly on the bones. Use the rest skeleton underneath,
        // leaving the model's parallel layers (blinks, hair and tail physics) running.
        if (actorDrawing && !want) {
          prev = cur = null;
          fade = 1;
        } else if (selected) {
          if (!cur || cur.A !== selected) { prev = cur; cur = { A: selected, t: 0, first: true }; fade = prev && dt > 0 ? 0 : 1; }
        } else if (!want) play((STATE[pose] || STATE.stand).find(n => A[n]) || 'idle');
        if (cur) cur.lift = !want && cur.A === actorBase ? actorLift : 0;   // prev 留着它自己的，淡出时一起落回去
        if (hn) { if (!hand || hand.A !== A[hn]) hand = { A: A[hn], t: 0, first: true }; } else hand = null;
        if (!want && actorOverlay) {
          if (!actorHand || actorHand.A !== actorOverlay) actorHand = { A: actorOverlay, t: 0, first: true };
        } else actorHand = null;
        // layers: pre_parallel 槽位 → main (cross-fade) → hand → parallel 槽位 (rotation adds)
        for (const o of out.values()) { o.r[0] = o.r[1] = o.r[2] = 0; o.p[0] = o.p[1] = o.p[2] = 0; o.s[0] = o.s[1] = o.s[2] = 1; }
        const step = (Pl, k) => { if (!Pl) return; const t0 = localTime(Pl); Pl.t += dt * (k || 1); runTimeline(Pl, t0, localTime(Pl), ctx); if (Pl.A.loop === 'once' && Pl.A.len > 0 && Pl.t > Pl.A.len) Pl.done = true; };
        const slotApply = (S, additive, protectedChannels, sleepWeight) => {
          if (S.old.length) { S.fadeT += dt; if (!(S.fadeLen > 0) || S.fadeT >= S.fadeLen) S.old = []; }
          const k = S.old.length ? S.fadeT / S.fadeLen : 1;
          for (const o of S.old) { step(o.Pl); if (!o.Pl.done) applyLayer(o.Pl, ctx, out, (1 - k) * o.w, additive, protectedChannels, sleepWeight); }
          if ((!S.C && !S.script) || S.bypass || S.builtinOn) {        // 没接管 / bypass / ysm-builtin：内置的同名并行动画
            const B0 = S.builtin;
            if (B0) { step(B0); if (!B0.done) applyLayer(B0, ctx, out, 1, additive, protectedChannels, sleepWeight); }
            return;
          }
          for (const x of S.act) {
            if (!S.pause) step(x.Pl);
            x.w = x.wf == null ? 1 : Math.max(0, Math.min(1, valE(x.wf)));
            if (!x.Pl.done) applyLayer(x.Pl, ctx, out, x.w * k, additive, protectedChannels, sleepWeight);
          }
        };
        for (const S of preSlots) slotApply(S, false);
        fade = Math.min(1, fade + dt / 0.2);
        const isCrouch = (Pl) => !!(Pl && Pl.A.group === 'main' && CROUCH.test(Pl.A.name));   // 蹲着往下挪，跟着淡入淡出
        rig.turn.position.y = legOff() - crouchDy * ((isCrouch(cur) ? fade : 0) + (prev && fade < 1 && isCrouch(prev) ? 1 - fade : 0))
          + (cur && cur.lift ? cur.lift * fade : 0) + (prev && fade < 1 && prev.lift ? prev.lift * (1 - fade) : 0);
        if (prev && fade < 1) { step(prev); applyLayer(prev, ctx, out, 1 - fade, false); } else prev = null;
        if (cur) { step(cur, cur.A.name === 'walk' && !opts.studio ? Math.max(0.6, Math.min(1.6, speed / 1.0)) : 1); applyLayer(cur, ctx, out, fade, false); }
        if (hand) { step(hand); applyLayer(hand, ctx, out, 1, false); }
        const sleepingWithClip = actorSleeping && sleepClip && cur?.A === sleepClip;
        for (const S of parSlots) slotApply(S, true, sleepingWithClip ? sleepChannels : undefined, fade);
        // Authored arm clips replace only their keyed channels, leaving the seated base intact.
        if (actorHand) { step(actorHand); applyLayer(actorHand, ctx, out, 1, false); }
        // write bones: rest + offsets (Blockbench: Euler ZYX, position in px)
        for (const [b, o] of out) {
          const r = rig.restR.get(b), rp = b.userData.rest;
          b.rotation.set(r[0] + o.r[0], r[1] + o.r[1], r[2] + o.r[2], 'ZYX');
          b.position.set(rp.x + o.p[0] / 16, rp.y + o.p[1] / 16, rp.z + o.p[2] / 16);
          b.scale.set(o.s[0] || 1e-4, o.s[1] || 1e-4, o.s[2] || 1e-4);
        }
        if (legs !== 1) {                              // 腿长：腿沿自身 y 缩放，脚掌反比补回
          for (const L of [LL, RL]) if (L) L.scale.y *= legs;
          for (const F of [LF, RF]) if (F) F.scale.y /= legs;
        }
        const H = bones.head;                          // 头跟着视线（YSM 自己在动画之后加；Blockbench 空间里 x = 抬头、y = 往左转）
        if (H && H.isBone) { H.rotation.x += lookUp; H.rotation.y += look; }
        if (faceKeep) for (const [k, v] of faceKeep) { if (v === undefined) delete ctx.v[k]; else ctx.v[k] = v; }   // 换回玩家自己的脸部设置
      },
      dispose() {
        rig.geometry.dispose(); mat.dispose(); skeleton.dispose();
        if (glowMesh) { glowMesh.geometry.dispose(); glowMat.dispose(); }
        for (const T of texs) if (T.tex) T.tex.dispose();
      },
    };
    // 身高：按作者的默认设置摆好（含模型自己的「模型大小」默认值、我们的腿长）以后，量头顶的实际高度，再缩放到 height。
    // 玩家改过的「模型大小」「头部缩放」之类量的时候先换回默认值，量完再换回来：不然刷新页面后又被缩回 height，改了等于没改
    const H = opts.height || (V3.layout && V3.layout.girlH) || 1.26;
    const normalize = () => {
      const mine = ctx.v;
      ctx.v = Object.assign({}, v0);
      try { measure(); } finally { ctx.v = mine; }
      inst.update(0, 0);
    };
    const measure = () => {                          // 总按站着量（工作台里蹲着的时候拖腿长滑条，也不会把她放大）
      const st = inst.states, keep = [st.pose.value, st.anim.value];
      st.pose.value = 'stand'; st.anim.value = '';
      try { measureNow(); } finally { st.pose.value = keep[0]; st.anim.value = keep[1]; }
    };
    const measureNow = () => {
      inst.update(0, 0);
      rig.root.scale.setScalar(1); rig.root.updateMatrixWorld(true); skeleton.update();
      const P0 = rig.geometry.attributes.position, sv = new THREE.Vector3(), verts = rig.headVerts.length ? rig.headVerts : null;
      let top = -Infinity;
      const n0 = verts ? verts.length : P0.count;
      for (let i = 0; i < n0; i++) { const vi = verts ? verts[i] : i; mesh.applyBoneTransform(vi, sv.fromBufferAttribute(P0, vi)); if (sv.y > top) top = sv.y; }
      top += legOff();                               // applyBoneTransform 给的是网格（turn 组）里的坐标：加上腿长带来的下移
      crouchDy = 0;                                  // 还在 scale 1、站着：量站着和蹲着时最低的脚
      liftCache.clear(); standFoot = legIdx.size ? footLow() : NaN;
      if (crouchAnim && legIdx.size) {
        const stand = standFoot;
        inst.states.anim.value = 'main:' + crouchAnim; inst.update(0, 0);
        const lift = footLow() - stand;
        if (Number.isFinite(lift)) crouchDy = Math.max(0, Math.min(CROUCH_DY, lift));
      }
      rig.root.scale.setScalar(H / Math.max(0.3, Number.isFinite(top) ? top : rig.height));
    };
    // 网格（turn 组）坐标里，现在这一帧最低的脚（腿、脚下面的所有顶点）
    function footLow() {
      const P0 = rig.geometry.attributes.position, SI = rig.geometry.attributes.skinIndex, sv = new THREE.Vector3();
      rig.root.updateMatrixWorld(true); skeleton.update();
      let low = Infinity;
      for (let i = 0; i < P0.count; i++) if (legIdx.has(SI.getX(i))) { mesh.applyBoneTransform(i, sv.fromBufferAttribute(P0, i)); if (sv.y < low) low = sv.y; }
      return low;
    }
    // 这个动画（第一帧）的脚比站着低多少（网格单位，≥ 0）：临时摆一下量完，把播放状态原样放回去（下一帧照常重算姿势）
    function liftOf(key) {
      if (liftCache.has(key)) return liftCache.get(key);
      let lift = 0;
      if (legIdx.size && Number.isFinite(standFoot)) {
        const st = inst.states, keep = { pose: st.pose.value, anim: st.anim.value, cur, prev, fade, hand, actorBase, actorOverlay, actorHand };
        try {
          st.pose.value = 'stand'; st.anim.value = key; actorOverlay = null;
          inst.update(0, 0);
          const low = footLow();
          if (Number.isFinite(low) && standFoot - low > 1 / 16) lift = Math.min(2, standFoot - low);   // 不到 1 px（跑步第一帧之类）不算
        } catch (e) { lift = 0; }
        finally {
          st.pose.value = keep.pose; st.anim.value = keep.anim;
          ({ cur, prev, fade, hand, actorBase, actorOverlay, actorHand } = keep);
        }
      }
      liftCache.set(key, lift);
      return lift;
    }
    inst.canLegs = !!(LL || RL);
    // 眼睛发光（本游戏的设置，29-ysmui 的「模型设置」里一个勾）：模型有眼睛全亮骨骼时才有
    inst.canEyeGlow = hasEyeGlow;
    inst.getEyeGlow = () => eyeGlow;
    inst.setEyeGlow = (on) => {
      on = !!on;
      if (!glowMesh || on === eyeGlow) { eyeGlow = on; return; }
      eyeGlow = on;
      glowMesh.geometry.setIndex(glowIndexFor(eyeGlow));
      glowMesh.visible = glowMesh.geometry.index.count > 0;
    };
    inst.getLegs = () => legs;
    // 头顶（头骨骼局部坐标）：65-girl-actor 用它放对话框、瞄伞尖。骨骼本身没有网格，Box3 量不出来，所以按头部顶点算
    const headTopNow = () => {
      const Hb = bones.head;
      if (!Hb || !Hb.isBone || !rig.headVerts.length) return null;
      rig.root.updateMatrixWorld(true); skeleton.update();
      const P0 = rig.geometry.attributes.position, v = new THREE.Vector3(), best = new THREE.Vector3();
      let top = -Infinity;
      for (const i of rig.headVerts) { mesh.applyBoneTransform(i, v.fromBufferAttribute(P0, i)); v.applyMatrix4(mesh.matrixWorld); if (v.y > top) { top = v.y; best.copy(v); } }
      if (!Number.isFinite(top)) return null;
      const c = Hb.getWorldPosition(new THREE.Vector3());
      return Hb.worldToLocal(new THREE.Vector3(c.x, best.y, c.z));
    };
    inst.setLegs = (k) => { legs = clampLegs(k); rig.turn.position.y = legOff(); normalize(); inst.headTop = headTopNow(); };
    normalize();
    inst.headTop = headTopNow();
    // 明暗连成一片（soften 上面说明里的 ③）：按现在显示着的方块重算一遍法线。骨骼自己或哪一级父骨骼缩成 0 = 这块现在不显示。
    // 玩家在「模型设置」里开关了部件以后可以再调 inst.resmooth()；没开 soft 时什么都不做
    const flatN = rig.soft ? rig.geometry.attributes.normal.array.slice() : null;
    inst.resmooth = () => {
      if (!flatN) return null;
      const GA = rig.geometry.attributes, SI = GA.skinIndex.array, gone = new Uint8Array(rig.list.length), tiny = (b) => Math.min(Math.abs(b.scale.x), Math.abs(b.scale.y), Math.abs(b.scale.z)) < 0.01;
      rig.list.forEach((b, i) => { for (let o = b; o && o.isBone; o = o.parent) if (tiny(o)) { gone[i] = 1; break; } });
      const hidden = new Uint8Array(flatN.length / 12);
      for (let i = 0; i < hidden.length; i++) hidden[i] = gone[SI[i * 16]];
      const r = smoothNormals(GA.position.array, flatN, GA.normal.array, hidden);
      GA.normal.needsUpdate = true;
      return (rig.soft.normals = r);
    };
    inst.resmooth();
    // 模型设置里开关了部件（setVar / runStmt）：等下一帧把新的显示状态摆出来，再重算一遍（连着拖滑条只算最后一次）
    let smoothT = 0, gone = false;
    function resmoothSoon() {
      if (!flatN || gone || typeof setTimeout !== 'function') return;
      clearTimeout(smoothT);
      smoothT = setTimeout(() => { if (!gone) inst.resmooth(); }, 250);
      if (smoothT && smoothT.unref) smoothT.unref();
    }
    const dispose0 = inst.dispose;
    inst.dispose = () => { gone = true; clearTimeout(smoothT); dispose0(); };
    // 腿长（米，胯到地面）：65-girl-actor 算步幅 / 脚印间距用，要在缩放到身高之后量
    inst.leg = legBone ? Math.max(0.1, legBone.getWorldPosition(wp).y) : 0.35;
    return inst;
  };
})(window.V3);

})({ V3: archive });
export async function validateHouseArchive(bytes) { await archive.share.read(bytes); }
export function validateModelArchive(files) { archive.ysm.load(files); }