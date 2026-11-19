import fs from 'node:fs';
import { decodePNG } from '../girl/png.mjs';

export function packModel(file) {
  return packGeometry(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function packSurface({ w, h, rgba }) {
  const runs = [];
  for (let start = 0; start < rgba.length;) {
    let length = 1;
    while (length < 255 && start + length * 4 < rgba.length && rgba.subarray(start, start + 4).every((value, channel) => value === rgba[start + length * 4 + channel])) length++;
    runs.push(length, ...rgba.subarray(start, start + 4)); start += length * 4;
  }
  return { w, h, runs: Buffer.from(runs).toString('base64') };
}

function packGeometry(source, form = 'base', palette) {
  const cubes = new Map(source.elements.map(cube => [cube.uuid, cube]));
  const groups = new Map(source.groups.map(group => [group.uuid, group]));
  const textures = source.textures.map(texture => decodePNG(Buffer.from(texture.source.split(',')[1], 'base64')));
  const sides = ['east', 'west', 'up', 'down', 'south', 'north'];
  function groupOf(node) {
    const group = groups.get(node.uuid), boxes = [], children = [];
    let surfaceIndex;
    for (const child of node.children) {
      if (typeof child !== 'string') {
        const name = groups.get(child.uuid).name;
        if (!name.startsWith('mark_') || name === 'mark_' + form) children.push(groupOf(child));
        continue;
      }
      const cube = cubes.get(child);
      const first = cube.faces.east.texture;
      if (source.textures[first].name.endsWith('.surface.png')) {
        if (surfaceIndex !== undefined && surfaceIndex !== first) throw Error('同一组只能使用一张壳面贴图：' + group.name);
        surfaceIndex = first;
        const texture = source.textures[first], width = texture.uv_width || source.resolution.width, height = texture.uv_height || source.resolution.height;
        const rects = sides.map(side => {
          const face = cube.faces[side];
          if (face.texture !== first || face.rotation) throw Error('壳面需要同一张贴图和未旋转的 UV：' + cube.name);
          return face.uv.map((value, index) => value / (index % 2 ? height : width));
        });
        boxes.push([cube.from, cube.to, cube.origin, cube.rotation || [0, 0, 0], 0xe5d4b8, rects]);
        continue;
      }
      const colors = sides.map(side => {
        const face = cube.faces[side], image = textures[palette ?? face.texture], [left, top, right, bottom] = face.uv;
        const column = Math.floor((left + right) * .5 * image.w / source.resolution.width);
        const row = Math.floor((top + bottom) * .5 * image.h / source.resolution.height);
        const offset = 4 * (column + row * image.w);
        return image.rgba[offset] * 65536 + image.rgba[offset + 1] * 256 + image.rgba[offset + 2];
      });
      boxes.push([cube.from, cube.to, cube.origin, cube.rotation || [0, 0, 0], colors.every(color => color === colors[0]) ? colors[0] : colors]);
    }
    const packed = { name: group.name, pivot: group.origin, rotation: group.rotation || [0, 0, 0], visible: group.name === 'mark_' + form || group.visibility !== false, boxes, children };
    if (surfaceIndex !== undefined) {
      if (boxes.some(box => !box[5])) throw Error('壳面与色板需要分组：' + group.name);
      packed.surface = packSurface(textures[surfaceIndex]);
    }
    return packed;
  }
  return source.outliner.map(groupOf);
}

export const shoreModelFiles = { hermit: 'creatures/hermit_crab', aquarium: 'shore/tide_tank', fish: 'shore/rockpool_fish' };
export function packShore() {
  const fishDir = new URL('../../../models/shore/fish/', import.meta.url);
  const fish = fs.readdirSync(fishDir).filter(name => name.endsWith('.bbmodel')).sort();
  const models = Object.fromEntries(Object.entries(shoreModelFiles).map(([key, path]) => [key, packModel(new URL(`../../../models/${path}.bbmodel`, import.meta.url))]));
  for (const file of fish) {
    const source = JSON.parse(fs.readFileSync(new URL(file, fishDir), 'utf8')), key = 'fish_' + file.slice(0, -8);
    models[key] = packGeometry(source);
    source.textures.forEach((texture, index) => {
      const match = /^form_([a-z0-9_]+)\.png$/.exec(texture.name);
      if (match) models[key + ':' + match[1]] = packGeometry(source, match[1], index);
    });
  }
  const shellDir = new URL('../../../models/creatures/hermit-shells/', import.meta.url);
  const mount = models.hermit.find(group => group.name === 'body').children.find(group => group.name === 'shell_mount');
  for (const file of fs.readdirSync(shellDir).filter(name => name.endsWith('.bbmodel')).sort()) {
    const [shell] = packModel(new URL(file, shellDir));
    if (shell?.name !== 'shell_' + file.slice(0, -8) || mount.children.some(group => group.name === shell.name)) throw Error('寄居蟹壳组名称不匹配或重复：' + file);
    mount.children.push({ ...shell, visible:false });
  }
  return models;
}
