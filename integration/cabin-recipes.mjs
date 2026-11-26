import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensurePrivate, guardLocalOrigin, readJson } from './cabin-inventory.mjs';

const ROUTE = '/api/cabin/recipes';
const DETAILS = 'id, name, ingredients, steps, notes, source, updatedAt';
const SUMMARY = 'id, name, source, updatedAt';
const fold = text => text.normalize('NFKC').toLowerCase().replace(/\p{Cf}/gu, '');
const nameKey = text => fold(text).replace(/\s+/gu, '');
const lineKey = text => fold(text).trim().replace(/\s+/gu, ' ');

class RecipeError extends Error {
  constructor(status, code, message, recipe) {
    super(message);
    Object.assign(this, { status, code, recipe });
  }
}

function field(value, label, max, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new RecipeError(400, 'invalid_field', label + '需要填写文字');
  }
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!optional && !lineKey(text)) throw new RecipeError(400, 'required', '请填写' + label);
  if (text.length > max) throw new RecipeError(400, 'too_long', label + '最多 ' + max + ' 个字符');
  return text;
}

function getRecipe(db, id) {
  const recipe = db.prepare('SELECT ' + DETAILS + ' FROM recipes WHERE id = ?').get(id);
  if (!recipe) throw new RecipeError(404, 'missing', '没有找到这道食谱');
  return recipe;
}

function pageNumber(params, key, fallback, min, max) {
  if (!params.has(key)) return fallback;
  const raw = params.get(key);
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new RecipeError(400, 'invalid_page', '分页参数超出范围');
  }
  return n;
}

function list(db, params) {
  const q = nameKey(field(params.get('q') ?? '', '搜索词', 200, true));
  const offset = pageNumber(params, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = pageNumber(params, 'limit', 20, 1, 100);
  const where = ' FROM recipes WHERE instr(nameKey, ?) OR instr(ingredientKey, ?)';
  const { total } = db.prepare('SELECT count(*) AS total' + where).get(q, q);
  const recipes = db.prepare('SELECT ' + SUMMARY + where + ' ORDER BY updatedAt DESC, id LIMIT ? OFFSET ?')
    .all(q, q, limit, offset);
  return { total, recipes };
}

export function backupRecipes({ dataDir, webRoot }) {
  ensurePrivate(dataDir, webRoot);
  const file = path.join(dataDir, 'cabin-recipes.sqlite');
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!stat.isFile()) throw new Error('Invalid recipe database');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=1500');
    return db.prepare('SELECT ' + DETAILS + ' FROM recipes ORDER BY updatedAt, id').all();
  } finally { db.close(); }
}

function save(db, id, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RecipeError(400, 'invalid_recipe', '食谱格式不正确');
  }
  const name = field(data.name, '菜名', 80);
  const ingredients = field(data.ingredients, '食材', 3000);
  const steps = field(data.steps, '做法', 8000);
  const notes = field(data.notes, '备注', 2000, true);
  const key = nameKey(name);
  const lines = ingredients.split('\n').map(lineKey).filter(Boolean).sort();
  const contentKey = createHash('sha256').update(JSON.stringify([lines, lineKey(steps)])).digest('hex');

  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = id && getRecipe(db, id);
    if (previous && previous.updatedAt !== data.expectedUpdatedAt) {
      throw new RecipeError(409, 'stale', '这道食谱已有新版本，请核对后再保存', previous);
    }
    const duplicate = db.prepare('SELECT ' + DETAILS + ' FROM recipes WHERE id != ? AND (nameKey = ? OR contentKey = ?) LIMIT 1')
      .get(id ?? '', key, contentKey);
    if (duplicate) {
      throw new RecipeError(409, 'duplicate', '食谱里已经有「' + duplicate.name + '」了', duplicate);
    }
    const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
    const values = [name, ingredients, steps, notes, updatedAt, key, nameKey(ingredients), contentKey];
    if (previous) {
      db.prepare('UPDATE recipes SET name=?, ingredients=?, steps=?, notes=?, updatedAt=?, nameKey=?, ingredientKey=?, contentKey=? WHERE id=?')
        .run(...values, id);
    } else {
      id = randomUUID();
      db.prepare('INSERT INTO recipes (name,ingredients,steps,notes,updatedAt,nameKey,ingredientKey,contentKey,id,source) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(...values, id, data.source === 'assistant' ? 'assistant' : 'player');
    }
    const recipe = getRecipe(db, id);
    db.exec('COMMIT');
    return { recipe };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createRecipeHandler({ dataDir, webRoot, sendJson }) {
  return async (req, res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let db;
    try {
      guardLocalOrigin(req);
      const url = new URL(req.url, 'http://localhost');
      const id = url.pathname === ROUTE ? null : url.pathname.slice(ROUTE.length + 1);
      if (id !== null && !/^[0-9a-f-]{36}$/.test(id)) throw new RecipeError(404, 'missing', '没有找到这道食谱');
      const writing = req.method === (id ? 'PUT' : 'POST');
      if (!writing && req.method !== 'GET') {
        res.setHeader('Allow', id ? 'GET, PUT' : 'GET, POST');
        throw new RecipeError(405, 'method_not_allowed', '不支持此操作');
      }
      const data = writing ? await readJson(req) : null;
      ensurePrivate(dataDir, webRoot);
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      db = new DatabaseSync(path.join(dataDir, 'cabin-recipes.sqlite'));
      db.exec(`PRAGMA busy_timeout=1500;
        CREATE TABLE IF NOT EXISTS recipes (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, ingredients TEXT NOT NULL, steps TEXT NOT NULL,
          notes TEXT NOT NULL, source TEXT NOT NULL, updatedAt TEXT NOT NULL,
          nameKey TEXT NOT NULL UNIQUE, ingredientKey TEXT NOT NULL, contentKey TEXT NOT NULL UNIQUE
        );`);
      let result;
      if (writing) result = save(db, id, data);
      else if (id) result = { recipe: getRecipe(db, id) };
      else result = list(db, url.searchParams);
      return sendJson(res, req.method === 'POST' ? 201 : 200, { ok: true, ...result });
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (!req.complete) res.setHeader('Connection', 'close');
      const status = Number.isInteger(error.status) ? error.status : 503;
      const message = error instanceof RecipeError ? error.message :
        status === 503 ? '食谱暂时无法读取或保存' : '食谱请求无效';
      return sendJson(res, status, { ok: false, code: status === 503 ? 'unavailable' : error.code,
        error: message, recipe: error.recipe });
    } finally {
      db?.close();
    }
  };
}
