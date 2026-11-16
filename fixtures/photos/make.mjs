#!/usr/bin/env node
// fixtures/photos/make.mjs — 第 6 件（docs/PHOTOS.md）：网页导出的「带照片的房子」，给卡片 mod/cards/P5-005.yml 用。
//
//   node fixtures/photos/make.mjs        先 node web/build.mjs cabin；用无头 Edge 打开 web/dist/cabin.html，
//                                        用网页自己的接口（V3.photos、V3.share）在默认房子上：相册矮桌放 3 张照片，
//                                        画框墙第 0、2、4 个小框各挂一张，写 house-photos.png（鲸图）和 house-photos.json（dump）
//
// 照片是 128 × 128 的纯色块：左上白、右上黄、左下黑（看截图就知道贴得正不正，和 P5-004 一样），中间一个色块区分是哪张。
// 只用 fillRect 画，同一个浏览器每次出来一样；换了浏览器版本可能字节不同，重跑以后卡片照样能比（卡片比的是这个文件本身）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const require = createRequire(path.join(ROOT, 'web/package.json'));
const puppeteer = require('puppeteer-core');
const exe = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));
if (!exe) throw new Error('找不到 Edge');
const page0 = path.join(ROOT, 'web/dist/cabin.html');
if (!fs.existsSync(page0)) throw new Error('先 node web/build.mjs cabin');

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files'] });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(page0).href + '?time=noon', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__READY === true, { timeout: 120000 });
  const out = await page.evaluate(async () => {
    await V3.houseBlocks.ready;
    const HB = V3.houseBlocks, P = V3.photos, S = V3.share;
    const mk = async (mid) => {
      const c = new OffscreenCanvas(128, 128), g = c.getContext('2d');
      g.fillStyle = '#4f7fc0'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#f2c94c'; g.fillRect(96, 0, 32, 32);
      g.fillStyle = '#000000'; g.fillRect(0, 96, 32, 32);
      g.fillStyle = mid; g.fillRect(44, 44, 40, 40);
      return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    };
    const photos = [];
    for (const [mid, name] of [['#e05050', '红'], ['#50c060', '绿'], ['#f0f0f0', '白']]) photos.push(P.make(await mk(mid), name, 1794100000000 + photos.length));
    let m = HB.defaultModel;
    const album = P.albumTables(m)[0].cell, wall = P.frames(m).find((f) => f.kind === 'wall').cell;
    m = P.setAlbum(m, album, photos);
    m = P.setSlot(m, wall, 0, photos[0]);
    m = P.setSlot(m, wall, 2, photos[1]);
    m = P.setSlot(m, wall, 4, photos[2]);
    const N = V3.nbt, meta = N.fromJSON(N.toJSON(HB.defaultModel.meta));
    meta.compound.Name = { string: '小鲸鱼之家 v4（网页相册 3 张，画框墙挂了 3 张）' };
    meta.compound.Xiaojingyu.compound.Source = { string: 'fixtures/photos/make.mjs' };
    const model = Object.assign({}, m, { meta });
    const bytes = await S.writePng(model);
    const back = await S.read(bytes);
    const enc = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    return { png: enc(bytes), dump: S.dump(back), bes: back.blockEntities.length, photos: photos.map((p) => [p.id, p.png.length]) };
  });
  const png = Buffer.from(out.png, 'base64');
  fs.writeFileSync(path.join(HERE, 'house-photos.png'), png);
  fs.writeFileSync(path.join(HERE, 'house-photos.json'), JSON.stringify(out.dump, null, 1) + '\n');
  console.log(`写了 fixtures/photos/house-photos.png（${png.length} 字节）和 house-photos.json；方块实体 ${out.bes} 个；照片 ${out.photos.map((p) => p.join(' ')).join('、')}`);
} finally { await browser.close(); }
