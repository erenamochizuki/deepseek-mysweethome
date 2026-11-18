// 32-snack-catalog.js — V3.snackCatalog：小店里的零食。纯数据（规则 58-inventory-rules 和 build.mjs 的 dist/inventory-rules.mjs 都读它）。
// pack：'box' 盒装 / 'bag' 袋装 = 一件里有 count 份，拿出来一份一份吃；'cup' 杯（瓶、罐）装 = count 口（满 3 → 中 2 → 低 1 → 空 0），
//   喝完的空杯算一件垃圾（扔进门廊垃圾桶再得 1 贝币）。vessel：杯装的样子（mug 马克杯 / bottle 瓶 / jar 罐 / cup 小杯）。
// price：贝币；unit：一份叫什么；sip：杯装那一口是「喝」还是「舀一勺」。colors：包装主色 / 标签色 / 内容物颜色（32-snack-models 用）。
// mine：玩家最初列的那几样（其余是扩展的）。
(function (V3) {
  'use strict';
  const S = (sku, name, pack, count, price, unit, o = {}) => Object.freeze({ sku, name, pack, count, price, unit, ...o });
  const list = [
    S('blueberry', '蓝莓', 'box', 12, 4, '颗', { mine: true, colors: [0x7fb2e5, 0xffffff, 0x3c4a99], taste: '酸酸甜甜', desc: '一小盒新鲜蓝莓，酸酸甜甜。' }),
    S('nori', '海苔', 'bag', 8, 3, '片', { mine: true, colors: [0x2f5d43, 0xf3d36b, 0x1f3a2a], taste: '咸咸的、脆脆的海味', desc: '脆脆的烤海苔，咸咸的海的味道。' }),
    S('cake', '蛋糕', 'box', 4, 8, '块', { mine: true, colors: [0xfbd6e1, 0xffffff, 0xfff1d8], taste: '奶油软软的甜，带一点草莓香', desc: '四小块草莓奶油蛋糕。' }),
    S('cocoa', '热可可', 'cup', 3, 4, '口', { mine: true, vessel: 'mug', hot: true, colors: [0xf2efe8, 0xb5674d, 0x6b3a22], taste: '热乎乎的可可香，上面还有棉花糖', desc: '一大杯热可可，上面漂着棉花糖。' }),
    S('honey', '蜂蜜', 'cup', 3, 5, '勺', { mine: true, vessel: 'jar', sip: 'spoon', colors: [0xf6c443, 0xfff4cf, 0xe89a1c], taste: '甜到心里的蜂蜜味', desc: '一罐金黄的蜂蜜，舀一勺就很甜。' }),
    S('bread', '面包', 'bag', 6, 4, '个', { mine: true, colors: [0xf3ead7, 0xd98b3a, 0xd99a52], taste: '软软的面包香', desc: '一袋软软的小餐包。' }),
    S('chips', '薯片', 'bag', 10, 3, '片', { mine: true, colors: [0xe64b3c, 0xffd84d, 0xf3c95a], taste: '咸香酥脆', desc: '咔嚓咔嚓的原味薯片。' }),
    S('fish_cracker', '小鱼饼干', 'box', 10, 4, '块', { colors: [0x6fc3f5, 0xffffff, 0xe8a85a], taste: '淡淡的海味，很脆', desc: '小鱼形状的饼干，一口一条。' }),
    S('cookie', '曲奇', 'box', 8, 5, '块', { colors: [0xb5674d, 0xfff1d8, 0xd9a463], taste: '巧克力香', desc: '巧克力豆曲奇，刚烤好一样香。' }),
    S('marshmallow', '棉花糖', 'bag', 8, 3, '颗', { colors: [0xfff0f6, 0xf59ac0, 0xfde3ee], taste: '甜甜软软，像云一样', desc: '软乎乎的粉白棉花糖。' }),
    S('onigiri', '饭团', 'box', 2, 5, '个', { colors: [0xffffff, 0x2f5d43, 0xf7f5ef], taste: '米饭香混着海苔', desc: '两个包着海苔的三角饭团。' }),
    S('milk', '牛奶', 'cup', 3, 3, '口', { vessel: 'bottle', colors: [0xffffff, 0x6fc3f5, 0xfbfbf7], taste: '凉凉的奶香', desc: '一瓶凉凉的牛奶。' }),
    S('lemonade', '柠檬汽水', 'cup', 3, 3, '口', { vessel: 'bottle', colors: [0xd8f2a8, 0xffe14d, 0xf3f7b0], taste: '酸酸的，有小气泡', desc: '冒着小气泡的柠檬汽水。' }),
    S('pudding', '布丁', 'cup', 3, 4, '勺', { vessel: 'cup', sip: 'spoon', colors: [0xffffff, 0xf6c443, 0xf7d58a], taste: '滑滑的焦糖甜', desc: '一杯滑滑的焦糖布丁。' }),
  ];
  const by = new Map(list.map((s) => [s.sku, s]));
  // 杯装的液面档位：3 满、2 中、1 低、0 空
  const LEVEL = ['空', '低', '中', '满'];
  const level = (left) => LEVEL[Math.max(0, Math.min(3, left | 0))];
  V3.snackCatalog = { list, get: (sku) => by.get(sku) || null, level, LEVEL };
})(window.V3);