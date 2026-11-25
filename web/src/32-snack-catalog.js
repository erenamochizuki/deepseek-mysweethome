// 32-snack-catalog.js — V3.snackCatalog：小店里的零食。纯数据（规则 58-inventory-rules 和 build.mjs 的 dist/inventory-rules.mjs 都读它）。
// pack：'box' 盒装 / 'bag' 袋装 = 一件里有 count 份，拿出来一份一份吃；'cup' 杯（瓶、罐）装 = count 口（满 3 → 中 2 → 低 1 → 空 0），
//   喝完的空杯算一件垃圾（扔进门廊垃圾桶再得 1 贝币）。vessel：杯装的样子（mug 马克杯 / bottle 瓶 / jar 罐 / cup 小杯）。
// price：贝币；unit：一份叫什么；sip：杯装那一口是「喝」还是「舀一勺」。colors：包装主色 / 标签色 / 内容物颜色（32-snack-models 用）。
// mine：玩家最初列的那几样（其余是扩展的）。
(function (V3) {
  'use strict';
  const shelves = Object.freeze({ fruit: '新鲜水果', savory: '咸点与轻食', sweet: '甜点', drink: '饮品' });
  const onShelf = category => (sku, name, pack, count, price, unit, options = {}) => Object.freeze({ sku, name, pack, count, price, unit, category, fruit: category === 'fruit', ...options });
  const [fruit, savory, sweet, drink] = ['fruit', 'savory', 'sweet', 'drink'].map(onShelf);
  const list = [
    fruit('blueberry', '蓝莓', 'box', 12, 4, '颗', { mine: true, colors: [0x7fb2e5, 0xffffff, 0x3c4a99], taste: '酸酸甜甜', desc: '一小盒新鲜蓝莓，酸酸甜甜。' }),
    savory('nori', '海苔', 'bag', 8, 3, '片', { mine: true, colors: [0x2f5d43, 0xf3d36b, 0x1f3a2a], taste: '咸咸的、脆脆的海味', desc: '脆脆的烤海苔，咸咸的海的味道。' }),
    sweet('cake', '蛋糕', 'box', 4, 8, '块', { mine: true, colors: [0xfbd6e1, 0xffffff, 0xfff1d8], taste: '奶油软软的甜，带一点草莓香', desc: '四小块草莓奶油蛋糕。' }),
    drink('cocoa', '热可可', 'cup', 3, 4, '口', { mine: true, vessel: 'mug', hot: true, colors: [0xf2efe8, 0xb5674d, 0x6b3a22], taste: '热乎乎的可可香，上面还有棉花糖', desc: '一大杯热可可，上面漂着棉花糖。' }),
    sweet('honey', '蜂蜜', 'cup', 3, 5, '勺', { mine: true, vessel: 'jar', sip: 'spoon', colors: [0xf6c443, 0xfff4cf, 0xe89a1c], taste: '甜到心里的蜂蜜味', desc: '一罐金黄的蜂蜜，舀一勺就很甜。' }),
    savory('bread', '面包', 'bag', 6, 4, '个', { mine: true, colors: [0xf3ead7, 0xd98b3a, 0xd99a52], taste: '软软的面包香', desc: '一袋软软的小餐包。' }),
    savory('chips', '薯片', 'bag', 10, 3, '片', { mine: true, colors: [0xe64b3c, 0xffd84d, 0xf3c95a], taste: '咸香酥脆', desc: '咔嚓咔嚓的原味薯片。' }),
    savory('fish_cracker', '小鱼饼干', 'box', 10, 4, '块', { colors: [0x6fc3f5, 0xffffff, 0xe8a85a], taste: '淡淡的海味，很脆', desc: '小鱼形状的饼干，一口一条。' }),
    sweet('cookie', '曲奇', 'box', 8, 5, '块', { colors: [0xb5674d, 0xfff1d8, 0xd9a463], taste: '巧克力香', desc: '巧克力豆曲奇，刚烤好一样香。' }),
    sweet('marshmallow', '棉花糖', 'bag', 8, 3, '颗', { colors: [0xfff0f6, 0xf59ac0, 0xfde3ee], taste: '甜甜软软，像云一样', desc: '软乎乎的粉白棉花糖。' }),
    savory('onigiri', '饭团', 'box', 2, 5, '个', { colors: [0xffffff, 0x2f5d43, 0xf7f5ef], taste: '米饭香混着海苔', desc: '两个包着海苔的三角饭团。' }),
    drink('milk', '牛奶', 'cup', 3, 3, '口', { vessel: 'bottle', colors: [0xffffff, 0x6fc3f5, 0xfbfbf7], taste: '凉凉的奶香', desc: '一瓶凉凉的牛奶。' }),
    drink('lemonade', '柠檬汽水', 'cup', 3, 3, '口', { vessel: 'bottle', colors: [0xd8f2a8, 0xffe14d, 0xf3f7b0], taste: '酸酸的，有小气泡', desc: '冒着小气泡的柠檬汽水。' }),
    sweet('pudding', '布丁', 'cup', 3, 4, '勺', { vessel: 'cup', sip: 'spoon', colors: [0xffffff, 0xf6c443, 0xf7d58a], taste: '滑滑的焦糖甜', desc: '一杯滑滑的焦糖布丁。' }),
    fruit('strawberry', '草莓', 'box', 6, 5, '颗', { colors: [0x628572, 0xf4d5b4, 0xcd3849], taste: '先酸后甜，带着草莓香', desc: '六颗带绿萼的红草莓，挑一颗尖尖的先吃。' }),
    fruit('mandarin', '蜜橘', 'box', 8, 3, '瓣', { colors: [0xd99557, 0xffedc0, 0xf59a32], taste: '一咬满口橘汁，甜里透点酸', desc: '剥好的八瓣蜜橘，在圆盒里摆成一朵花。' }),
    fruit('apple', '红苹果', 'box', 6, 4, '片', { colors: [0xa46250, 0xf6ddbb, 0xb93741], taste: '脆生生的，带一点清酸', desc: '红果皮留成一弯细边，六片苹果刚好排成两列。' }),
    fruit('kiwi', '猕猴桃', 'box', 6, 4, '片', { colors: [0x779167, 0xeee2b3, 0x94b94a], taste: '鲜酸多汁，细籽轻轻咯吱响', desc: '切开是青绿色的小圆片，白芯外绕着一圈黑籽。' }),
    fruit('watermelon', '西瓜', 'box', 4, 4, '角', { colors: [0x438775, 0xffdfca, 0xea5861], taste: '清甜，咬下去都是瓜汁', desc: '四角红瓤西瓜，每角都留了一截绿皮当把手。' }),
    fruit('mango', '芒果', 'box', 4, 5, '块', { colors: [0xbc8246, 0xf9e6b5, 0xf4aa36], taste: '软糯香甜，芒果香很浓', desc: '金黄果肉划成小方格，翻开就成了四朵芒果花。' }),
    savory('pretzel', '海盐扭结饼', 'box', 4, 4, '个', { colors: [0x867052, 0xf4ddae, 0xb77138], taste: '麦香里带着小粒海盐', desc: '四个烤成蝴蝶结的小饼，粗盐粒藏在弯弯的面包结上。' }),
    savory('sandwich', '芝士三明治', 'box', 2, 5, '块', { colors: [0x56795e, 0xf1ddb4, 0xe5a53f], taste: '松软吐司夹着咸香芝士', desc: '两块三角吐司，切面露出芝士、生菜和番茄。' }),
    sweet('madeleine', '贝壳玛德琳', 'box', 6, 5, '块', { colors: [0x738f9e, 0xf9dfb2, 0xd5964c], taste: '焦边酥香，里面是软软的黄油蛋糕', desc: '六枚金黄的小蛋糕，背上烤出了扇贝一样的纹路。' }),
    sweet('donut', '巧克力甜甜圈', 'box', 2, 6, '个', { colors: [0x9c646d, 0xf1d4b5, 0x643a31], taste: '可可糖衣裹着松软的圈圈', desc: '两个迷你甜甜圈，巧克力糖衣上撒着彩糖针。' }),
    drink('barley_tea', '焙麦茶', 'cup', 3, 3, '口', { vessel: 'mug', hot: true, colors: [0x9b6943, 0xf5ddb0, 0xad672e], taste: '暖暖的烘麦香，不带甜味', desc: '琥珀色的热麦茶，茶包的小纸签垂在陶杯边。' }),
    drink('matcha', '抹茶拿铁', 'cup', 3, 5, '口', { vessel: 'mug', hot: true, colors: [0x64836b, 0xf5e7c7, 0x80994f], taste: '一点茶苦，接着是温柔的奶香', desc: '青瓷杯里打了奶泡，抹茶上浮着一枚小叶子拉花。' }),
    drink('peach_yogurt', '白桃酸奶', 'cup', 3, 4, '口', { vessel: 'bottle', colors: [0xcf8897, 0xffedcf, 0xefbdbe], taste: '稠稠的奶香里带一点白桃酸甜', desc: '矮胖玻璃瓶装的白桃饮用酸奶，瓶盖是桃粉色。' }),
    drink('sea_soda', '海盐蓝汽水', 'cup', 3, 4, '口', { vessel: 'bottle', colors: [0x539ca9, 0xe5f3dc, 0x65bfd3], taste: '清凉的气泡，收尾有一丝咸', desc: '细颈瓶里冒着小气泡，蓝得像小屋外的浅海。' }),
    fruit('durian', '榴莲', 'box', 3, 7, '瓣', { colors: [0x67794e, 0xffedcc, 0xeab745], taste: '浓浓的果香，果肉软得像奶油', desc: '剖开的刺壳里卧着三瓣金黄果肉，只取软软的部分吃。' }),
    savory('dried_fish', '小鱼干', 'box', 6, 4, '条', { colors: [0x526c76, 0xecd8b0, 0xb89968], taste: '越嚼越香，带一点海盐的鲜', desc: '六条银皮小鱼干，烘得微微卷起，连小尾巴都是酥的。' }),
    sweet('berry_star', '海星莓心饼', 'box', 4, 5, '块', { colors: [0xab7884, 0xf7dfbb, 0xb53f66], taste: '黄油饼干酥酥的，中间是酸甜的莓果酱', desc: '四块海星形黄油饼，五个小角围着一颗红亮的莓酱心。' }),
    drink('osmanthus_oolong', '桂花乌龙', 'cup', 3, 4, '口', { vessel: 'mug', hot: true, colors: [0x577975, 0xfbe4ae, 0xbb7935], taste: '先闻到桂花香，咽下去还有一点茶的回甘', desc: '青瓷杯盛着琥珀色热乌龙，几朵金桂浮在茶面上。' }),
    sweet('birthday_cake', '生日蛋糕', 'box', 6, 12, '块', { colors: [0xc46c83, 0xfff2d9, 0xe8b878], taste: '松软的蛋糕里夹着奶油和莓果酱', desc: '圆蛋糕切成了六块，点缀着生日蜡烛。挑一块，分给今天想祝福的人。' }),
    drink('bottled_milk', '瓶装牛奶', 'cup', 3, 4, '口', { vessel: 'bottle', colors: [0xb6493b, 0xffefd2, 0xfff8e8], taste: '冰凉顺滑，抿完还有一点奶甜', desc: '红纸封口的牧场玻璃奶瓶，一瓶刚好喝三口。' }),
  ];
  const by = new Map(list.map((s) => [s.sku, s]));
  // 杯装的液面档位：3 满、2 中、1 低、0 空
  const LEVEL = ['空', '低', '中', '满'];
  const level = (left) => LEVEL[Math.max(0, Math.min(3, left | 0))];
  V3.snackCatalog = { list, shelves, get: (sku) => by.get(sku) || null, level, LEVEL };
})(window.V3);
