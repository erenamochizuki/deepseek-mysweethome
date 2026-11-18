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
  return Object.fromEntries(Object.entries(shoreModelFiles).map(([key, path]) => [key, packModel(new URL(`../../../models/${path}.bbmodel`, import.meta.url))]));
}
