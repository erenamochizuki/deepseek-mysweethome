import fs from 'node:fs';
import { decodePNG } from '../girl/png.mjs';

export function packModel(file) {
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cubes = new Map(source.elements.map(cube => [cube.uuid, cube]));
  const groups = new Map(source.groups.map(group => [group.uuid, group]));
  const textures = source.textures.map(texture => decodePNG(Buffer.from(texture.source.split(',')[1], 'base64')));
  const sides = ['east', 'west', 'up', 'down', 'south', 'north'];
  function groupOf(node) {
    const group = groups.get(node.uuid), boxes = [], children = [];
    for (const child of node.children) {
      if (typeof child !== 'string') { children.push(groupOf(child)); continue; }
      const cube = cubes.get(child);
      const colors = sides.map(side => {
        const face = cube.faces[side], image = textures[face.texture], [left, top, right, bottom] = face.uv;
        const column = Math.floor((left + right) * .5 * image.w / source.resolution.width);
        const row = Math.floor((top + bottom) * .5 * image.h / source.resolution.height);
        const offset = 4 * (column + row * image.w);
        return image.rgba[offset] * 65536 + image.rgba[offset + 1] * 256 + image.rgba[offset + 2];
      });
      boxes.push([cube.from, cube.to, cube.origin, cube.rotation || [0, 0, 0], colors.every(color => color === colors[0]) ? colors[0] : colors]);
    }
    return { name: group.name, pivot: group.origin, rotation: group.rotation || [0, 0, 0], visible: group.visibility !== false, boxes, children };
  }
  return source.outliner.map(groupOf);
}

export const shoreModelFiles = { hermit: 'creatures/hermit_crab', aquarium: 'shore/tide_tank', fish: 'shore/rockpool_fish' };
export function packShore() {
  const fishDir = new URL('../../../models/shore/fish/', import.meta.url);
  const fish = fs.readdirSync(fishDir).filter(name => name.endsWith('.bbmodel')).sort();
  const models = Object.fromEntries([...Object.entries(shoreModelFiles).map(([key, path]) => [key, packModel(new URL(`../../../models/${path}.bbmodel`, import.meta.url))]),
    ...fish.map(file => ['fish_' + file.slice(0, -8), packModel(new URL(file, fishDir))])]);
  const shellDir = new URL('../../../models/creatures/hermit-shells/', import.meta.url);
  const mount = models.hermit.find(group => group.name === 'body').children.find(group => group.name === 'shell_mount');
  for (const file of fs.readdirSync(shellDir).filter(name => name.endsWith('.bbmodel')).sort()) {
    const [shell] = packModel(new URL(file, shellDir));
    if (shell?.name !== 'shell_' + file.slice(0, -8) || mount.children.some(group => group.name === shell.name)) throw Error('寄居蟹壳组名称不匹配或重复：' + file);
    mount.children.push({ ...shell, visible:false });
  }
  return models;
}
