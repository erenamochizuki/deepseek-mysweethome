// Build a small, optional Minecraft 26.1.2 client resource pack. No game or instance writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadV3 } from './lib/v3-node.mjs';
import { encodePng, makeZip } from './mc-lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'mod', 'src', 'main', 'resources');
const NS = 'xiaojingyu';
const IDs = { sea_urchin_test: '海胆空壳', rainbow_abalone: '虹彩鲍壳' };
const DISPLAY = {
  gui: { rotation: [45, 215, 0], translation: [0, 0, 0], scale: [.82, .82, .82] },
  ground: { rotation: [0, 0, 0], translation: [0, 3.5, 0], scale: [.35, .35, .35] },
  fixed: { rotation: [45, 0, 0], translation: [0, 0, 0], scale: [.8, .8, .8] },
  firstperson_righthand: { rotation: [0, 50, 0], translation: [0, 4, 0], scale: [.45, .45, .45] },
  firstperson_lefthand: { rotation: [0, 230, 0], translation: [0, 4, 0], scale: [.45, .45, .45] },
  thirdperson_righthand: { rotation: [60, 45, 0], translation: [0, 2, 0], scale: [.45, .45, .45] },
};
const filesForPot = ['models/block/flower_pot.json', 'models/item/flower_pot.json', 'textures/block/flower_pot.png'];
const json = (x) => Buffer.from(JSON.stringify(x, null, 2) + '\n');
const at = (name) => `assets/${NS}/${name}`;

export function makeCollectiblePack() {
  const { V3 } = loadV3(['31-collectible-abalone', '31-collectible-cubes', '31-collectible-render']);
  const files = new Map();
  const stats = [];
  files.set('pack.mcmeta', json({ pack: {
    description: '海边小屋 · 花盆与海滩收藏（Minecraft 26.1.2）', min_format: [84, 0], max_format: [84, 0],
  } }));
  for (const [id, name] of Object.entries(IDs)) {
    const spec = V3.collectibleCubes.build(id), elements = V3.collectibleRender.elements(spec);
    const texture = `${NS}:item/${id}`;
    files.set(at(`models/item/${id}.json`), json({
      credit: "Xiaojingyu's Home, CC BY-NC-SA 4.0",
      textures: { skin: texture, particle: texture }, gui_light: 'front', display: DISPLAY, elements,
    }));
    files.set(at(`textures/item/${id}.png`), encodePng(spec.width, spec.height, spec.rgba));
    files.set(at(`items/${id}.json`), json({ model: { type: 'minecraft:model', model: `${NS}:item/${id}` } }));
    stats.push({ id, name, boxes: elements.length, faces: elements.reduce((sum, box) => sum + Object.keys(box.faces).length, 0) });
  }
  for (const name of filesForPot) files.set(at(name), fs.readFileSync(path.join(SRC, at(name))));
  const pot = JSON.parse(files.get(at('models/block/flower_pot.json')));
  stats.push({ id: 'flower_pot', name: '台阶花盆', boxes: pot.elements.length, faces: pot.elements.reduce((sum, box) => sum + Object.keys(box.faces).length, 0) });
  files.set('README.txt', Buffer.from([
    '海边小屋 · 三个低元素模型', '', 'Minecraft Java 26.1.2（资源包格式 84.0）。',
    '把 ZIP 放进该游戏实例的 resourcepacks，在游戏资源包菜单启用。无须替换存档或模组。',
    '已安装小鲸鱼之家模组时，原有 xiaojingyu:flower_pot 只更新外观。未安装模组的原版没有这个花盆方块。',
    '两个收藏可用以下命令预览（需要命令权限），不添加掉落逻辑或独立注册物品：', '',
    ...Object.entries(IDs).map(([id, name]) => `/give @s minecraft:nautilus_shell[minecraft:item_model="${NS}:${id}",minecraft:custom_name={text:"${name}",italic:false}]`),
    '', '源模型：网页 31-collectible-cubes.js、models/furniture/flower_pot.bbmodel。', '原有花盆设计及派生素材保留上游 CC BY-NC-SA 4.0 许可。', '',
  ].join('\n')));
  return { files, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !/\.zip$/i.test(process.argv[2])) throw new Error('Usage: node tools/collectible-mc-pack.mjs <new-file.zip>');
  const output = path.resolve(process.argv[2]);
  const { files, stats } = makeCollectiblePack();
  fs.writeFileSync(output, makeZip([...files]), { flag: 'wx' });
  console.log(JSON.stringify({ output, stats }, null, 2));
}
