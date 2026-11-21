// Focused v4 deliverable: existing built pages + verified mod + house, no game assets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const web = path.resolve(import.meta.dirname, '..'), root = path.dirname(web);
const arg = process.argv.indexOf('--out');
const out = path.resolve(web, arg >= 0 ? process.argv[arg + 1] : '成品/海边小屋-v4');
const allowed = path.join(web, '成品') + path.sep;
if (!out.startsWith(allowed)) throw new Error('--out must be inside web/成品');
const files = [
  ['web/dist/home.html', '小鲸鱼之家.html'],
  ['web/dist/cabin.html', '海边小屋.html'],
  ['web/dist/studio.html', '工作台.html'],
  ['web/assets/house/house-v4.png', 'house-v4.png'],
  ['mod/build/libs/xiaojingyu-0.1.0.jar', 'xiaojingyu-0.1.0.jar'],
  ['docs/PHOTOS.md', '说明/PHOTOS.md'],
  ['web/docs/BLOCK-EDITOR.md', '说明/BLOCK-EDITOR.md'],
  ['docs/RELEASE-V4.md', '使用说明.md'],
  ['docs/INTEGRATION-V4.md', '说明/INTEGRATION-V4.md'],
  ['LICENSE.md', 'LICENSE.md'],
  ['web/vendor/d3-celestial-LICENSE.txt', '说明/d3-celestial-LICENSE.txt'],
];
for (const [src] of files) if (!fs.statSync(path.join(root, src)).isFile()) throw new Error('Missing: ' + src);
fs.mkdirSync(out, { recursive: true });
const manifest = [];
for (const [source, destination] of files) {
  const bytes = fs.readFileSync(path.join(root, source)), target = path.join(out, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  manifest.push({ file: destination, source, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), files: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ out, files: manifest.length, bytes: manifest.reduce((n, f) => n + f.bytes, 0) }));
