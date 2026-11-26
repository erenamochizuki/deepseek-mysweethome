import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInventoryStore, ensurePrivate, validateHouseArchive, validateModelArchive } from './cabin-inventory.mjs';
import { restoreProgress } from './cabin-progress.mjs';
import { backupRecipes, restoreRecipes } from './cabin-recipes.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => Object.assign(new Error('存档内容不完整或已损坏'), { status: 400, code: 'invalid_save' });
const required = valid => { if (!valid) throw invalid(); };
const byteTypes = ['ArrayBuffer', 'Uint8Array', 'Uint8ClampedArray'];
const files = ['cabin-inventory.json', 'cabin-progress.sqlite', 'cabin-recipes.sqlite'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const text = value => typeof value === 'string' && value.length > 0;

function bytes(row, types = byteTypes) {
  required(record(row) && row.encoding === 'base64' && types.includes(row.type) &&
    typeof row.data === 'string' && row.data.length % 4 === 0);
  const decoded = Buffer.from(row.data, 'base64');
  required(decoded.toString('base64') === row.data);
  return decoded;
}

async function validateBrowser(browser) {
  required(record(browser) && record(browser.localStorage) && Array.isArray(browser.models));
  const { house, texturePack } = browser;
  if (house !== null) {
    required(record(house) && [1, 2].includes(house.v));
    if (house.place !== undefined) required(record(house.place) &&
      ['dx','dz','k'].every(key => Number.isSafeInteger(house.place[key])));
    const data = bytes(house.bytes);
    try { await validateHouseArchive(data); } catch { throw invalid(); }
  }
  const ids = new Set();
  for (const row of browser.models) {
    required(record(row) && text(row.id) && !ids.has(row.id) && text(row.name) &&
      Array.isArray(row.files) && row.files.length > 0);
    ids.add(row.id);
    if (row.authors !== undefined) required(Array.isArray(row.authors) && row.authors.every(text));
    const files = new Map();
    for (const file of row.files) {
      required(Array.isArray(file) && file.length === 2 && text(file[0]) && !files.has(file[0]));
      files.set(file[0], bytes(file[1], ['Uint8Array']));
    }
    try { validateModelArchive(files); } catch { throw invalid(); }
  }
  if (texturePack !== null) {
    required(record(texturePack) && text(texturePack.key) && Array.isArray(texturePack.names) &&
      texturePack.names.every(text) && new Set(texturePack.names).size === texturePack.names.length);
    const blob = bytes(texturePack.blob, ['Uint8Array']);
    const offsets = bytes(texturePack.offsets, ['Uint32Array']);
    required(offsets.length === (texturePack.names.length + 1) * 4 && offsets.readUInt32LE(0) === 0);
    let previous = 0;
    for (let i = 4; i < offsets.length; i += 4) {
      const offset = offsets.readUInt32LE(i);
      required(offset >= previous && offset <= blob.length);
      previous = offset;
    }
    required(previous === blob.length);
  }
}

function syncDirectory(dir) {
  // Windows does not support opening a directory for fsync via Node.
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function createSaveGenerations({ dataDir, webRoot }) {
  const root = path.resolve(dataDir);
  ensurePrivate(root, webRoot);
  const parent = path.join(root, 'cabin-generations');
  const pointer = path.join(root, 'cabin-active-generation');
  let generation = '0';
  const active = () => generation === '0' ? root : path.join(parent, generation);
  const pointerStat = fs.lstatSync(pointer, { throwIfNoEntry: false });
  if (pointerStat) {
    if (!pointerStat.isFile() || pointerStat.size > 64) throw Error('Invalid cabin save generation');
    generation = fs.readFileSync(pointer, 'utf8').trim();
    if (!uuid.test(generation) || !files.every(file => fs.lstatSync(path.join(active(), file)).isFile())) {
      throw Error('Incomplete active cabin save');
    }
    ensurePrivate(active(), webRoot);
  }
  function guardGeneration(req, allowAssistant = false) {
    const headers = req.headers, seen = headers['x-cabin-generation'];
    if (seen === generation || (seen === undefined && (generation === '0' ||
        (allowAssistant && headers.origin === undefined && headers['sec-fetch-site'] === undefined)))) return;
    throw Object.assign(Error('小屋已导入另一份存档，请重新载入'), { status: 409, code: 'stale_generation' });
  }
  return {
    get dataDir() { return active(); },
    generation: () => generation,
    guardGeneration,
    async restore(archive, req) {
      guardGeneration(req);
      required(record(archive) && archive.format === 'cabin-save-v1' &&
        (archive.source === undefined || ['service','browser'].includes(archive.source)));
      required(Array.isArray(archive.recipes) || (archive.source === 'browser' && archive.recipes === undefined));
      await validateBrowser(archive.browser);
      // House validation decompresses asynchronously. Recheck before the synchronous switch.
      guardGeneration(req);
      const id = randomUUID();
      const next = { dataDir: path.join(parent, id), webRoot };
      ensurePrivate(next.dataDir, webRoot);
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      fs.mkdirSync(next.dataDir, { mode: 0o700 });
      const temp = path.join(root, '.cabin-active-' + id + '.tmp');
      try {
        createInventoryStore(next).restoreBackup(archive.inventory);
        restoreProgress(next, archive.browser);
        const recipes = archive.source === 'browser' && !archive.recipes?.length
          ? backupRecipes({ dataDir: active(), webRoot }) : archive.recipes;
        restoreRecipes(next, recipes);
        syncDirectory(next.dataDir);
        syncDirectory(parent);
        fs.writeFileSync(temp, id + '\n', { flag: 'wx', mode: 0o600, flush: true });
        fs.renameSync(temp, pointer);
        generation = id;
      } catch (error) {
        fs.rmSync(temp, { force: true });
        fs.rmSync(next.dataDir, { recursive: true, force: true });
        throw error;
      }
      // The pointer is already visible. A failure to flush the directory cannot undo it.
      try { syncDirectory(root); } catch {}
      return generation;
    },
  };
}
