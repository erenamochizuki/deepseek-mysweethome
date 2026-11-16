#!/usr/bin/env node
// tools/gen-image.mjs — call the DSH "hei-image" provider (OpenAI-compatible image API) and save PNGs.
// The API key is read from env HEI_IMAGE_API_KEY, else from ~/.dsh/.credentials.yaml. It is never printed.
//
// Usage:
//   node tools/gen-image.mjs --models                            list the image models the relay offers
//   node tools/gen-image.mjs --out refs/a.png --prompt "..."     text → image   (POST /images/generations)
//   node tools/gen-image.mjs --out a.png --prompt-file p.txt --ref refs/x.png [--ref y.png]   image(s) + text → image (POST /images/edits)
// Options: --model gpt-image-2.5-sunburst (default)  --size 1536x1024|1024x1024|1024x1536|auto  --quality high|medium|low|auto
//          --n 2 (writes a.png, a-2.png)  --base https://…/v1  --timeout 600 (seconds)  --dry-run (show the request, send nothing)
// Paths: --out is relative to the project root; --ref / --prompt-file: project root first, then the current folder.
// Exit code 0 = saved, 1 = API/network error (message printed, key masked), 2 = bad arguments / no key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALUE_OPTS = new Set(['out', 'prompt', 'prompt-file', 'model', 'size', 'quality', 'n', 'base', 'timeout']);
const argv = process.argv.slice(2);
const refs = [], opt = {}, badArgs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--models') opt.models = true;
  else if (a === '--dry-run') opt.dryRun = true;
  else if (a === '--help' || a === '-h') opt.help = true;
  else if (a === '--ref' || (a.startsWith('--') && VALUE_OPTS.has(a.slice(2)))) {
    const v = argv[++i];
    if (v === undefined) badArgs.push(`${a} needs a value`);
    else if (a === '--ref') refs.push(v);
    else opt[a.slice(2)] = v;
  } else badArgs.push(`unknown argument: ${a}`);
}
const DSH = path.join(os.homedir(), '.dsh');
function readKey() {
  if (process.env.HEI_IMAGE_API_KEY) return process.env.HEI_IMAGE_API_KEY.trim();
  try {
    const t = fs.readFileSync(path.join(DSH, '.credentials.yaml'), 'utf8');
    const m = t.match(/^\s*HEI_IMAGE_API_KEY\s*:\s*['"]?([^'"\r\n]+)['"]?\s*$/m);
    if (m) return m[1].trim();
  } catch { /* fall through */ }
  return '';
}
function readBase() {
  if (opt.base) return opt.base;
  if (process.env.HEI_IMAGE_BASE_URL) return process.env.HEI_IMAGE_BASE_URL;
  try {
    const t = fs.readFileSync(path.join(DSH, 'profiles', 'desktop', 'cordis.yml'), 'utf8');
    const i = t.indexOf('hei-image:');
    const m = i >= 0 && t.slice(i, i + 600).match(/baseURL:\s*(\S+)/);
    if (m) return m[1];
  } catch { /* fall through */ }
  return 'https://www.heilovehei.com/v1';
}
const KEY = readKey();
const BASE = readBase().replace(/\/+$/, '');
const mask = (s) => (KEY ? String(s).split(KEY).join('<key>') : String(s));
class ApiError extends Error {}
const rel = (p) => { const r = path.relative(ROOT, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : p; };
const findInput = (p) => [path.resolve(ROOT, p), path.resolve(p)].find((x) => fs.existsSync(x) && fs.statSync(x).isFile());
function usage() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1);
  return lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}

async function check(res) {
  if (res.ok) return res;
  let body = '';
  try { body = (await res.text()).slice(0, 600); } catch { /* ignore */ }
  throw new ApiError(`HTTP ${res.status} ${res.statusText}: ${body}`);
}

async function main() {
  if (opt.help) { console.log(usage()); return 0; }
  if (badArgs.length) { console.error(`${badArgs.join('\n')}\n(usage: node tools/gen-image.mjs --help)`); return 2; }
  if (!KEY && !opt.dryRun) { console.error('no HEI_IMAGE_API_KEY (env or ~/.dsh/.credentials.yaml)'); return 2; }
  const signal = AbortSignal.timeout((+opt.timeout || 600) * 1000);
  const auth = { Authorization: 'Bearer ' + KEY };
  if (opt.models) {
    const j = await (await check(await fetch(BASE + '/models', { headers: auth, signal }))).json();
    const ids = (j.data || []).map((m) => m.id).sort();
    console.log(ids.filter((id) => /image|dall|flux|banana|imagen|seedream|midjourney/i.test(id)).join('\n') || ids.join('\n'));
    return 0;
  }
  let prompt = opt.prompt || '';
  if (opt['prompt-file']) {
    const pf = findInput(opt['prompt-file']);
    if (!pf) { console.error(`prompt file not found: ${opt['prompt-file']}`); return 2; }
    prompt = fs.readFileSync(pf, 'utf8');
  }
  if (!prompt.trim() || !opt.out) { console.error('need --out and --prompt / --prompt-file (usage: --help)'); return 2; }
  const refFiles = [];
  for (const r of refs) {
    const f = findInput(r);
    if (!f) { console.error(`--ref not found: ${r}`); return 2; }
    refFiles.push(f);
  }
  const out = path.resolve(ROOT, opt.out);
  const model = opt.model || 'gpt-image-2.5-sunburst';
  const size = opt.size || '1536x1024';
  const quality = opt.quality || 'high';
  const n = opt.n === undefined ? 1 : Number(opt.n);
  if (!Number.isInteger(n) || n < 1 || n > 10) { console.error('--n must be an integer 1..10'); return 2; }
  const endpoint = refFiles.length ? '/images/edits' : '/images/generations';
  if (opt.dryRun) {
    console.log(`dry run (nothing sent): POST ${BASE}${endpoint}`);
    console.log(`  model ${model}  size ${size}  quality ${quality}  n ${n}  key ${KEY ? 'found' : 'MISSING'}`);
    for (const f of refFiles) console.log(`  ref ${rel(f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
    console.log(`  prompt ${prompt.length} chars: ${prompt.replace(/\s+/g, ' ').trim().slice(0, 100)}${prompt.length > 100 ? '…' : ''}`);
    console.log(`  out ${rel(out)}`);
    return 0;
  }
  const t0 = Date.now();
  let res;
  if (refFiles.length) {
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', prompt); fd.append('size', size);
    fd.append('quality', quality); fd.append('n', String(n));
    for (const r of refFiles) {
      const ext = path.extname(r).toLowerCase();
      const type = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      fd.append(refFiles.length > 1 ? 'image[]' : 'image', new Blob([fs.readFileSync(r)], { type }), path.basename(r));
    }
    res = await check(await fetch(BASE + '/images/edits', { method: 'POST', headers: auth, body: fd, signal }));
  } else {
    res = await check(await fetch(BASE + '/images/generations', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model, prompt, size, quality, n }),
    }));
  }
  const j = await res.json();
  const items = j.data || [];
  if (!items.length) throw new ApiError('no image in response: ' + JSON.stringify(j).slice(0, 400));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const po = path.parse(out);
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    let buf;
    if (it.b64_json) buf = Buffer.from(it.b64_json, 'base64');
    else if (it.url) buf = Buffer.from(await (await check(await fetch(it.url, { signal }))).arrayBuffer());
    else { console.error('item has neither b64_json nor url'); continue; }
    const file = k === 0 ? out : path.join(po.dir, `${po.name}-${k + 1}${po.ext}`);
    fs.writeFileSync(file, buf);
    const png = buf[1] === 0x50 && buf[2] === 0x4e;
    console.log(`wrote ${rel(file)}  ${png ? buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20) : '(not png)'}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
  console.log(`model ${model}  ${((Date.now() - t0) / 1000).toFixed(1)} s${j.usage ? '  usage ' + JSON.stringify(j.usage) : ''}`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  console.error(mask(e instanceof ApiError ? e.message : (e && e.name === 'TimeoutError' ? 'timed out' : (e && e.stack) || e)));
  process.exitCode = 1;
});
