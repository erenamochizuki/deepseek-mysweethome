import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensurePrivate, guardLocalOrigin, readJson } from './cabin-inventory.mjs';

// Stored values use the same binary encoding as the downloadable JSON archive.
const storageKey = /^(v3\.|v4-furniture-play:|cabin\.snack\.|cabin\.routine\.|cabinGallery\.)/;
const assetKeys = new Set(['house', 'models', 'texturePack']);
const validKey = key => typeof key === 'string' && key.length <= 512 && key !== 'v3.inventory' &&
  (storageKey.test(key) || assetKeys.has(key));
const invalid = () => Object.assign(new Error('存档格式不正确'), { status: 400, code: 'invalid_progress' });

function open({ dataDir, webRoot }, write) {
  ensurePrivate(dataDir, webRoot);
  const file = path.join(dataDir, 'cabin-progress.sqlite');
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && !stat.isFile()) throw new Error('Invalid progress database');
  if (!stat && !write) return null;
  if (write) fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file, { readOnly: !write });
  try {
    db.exec('PRAGMA busy_timeout=2500');
    if (write) db.exec('CREATE TABLE IF NOT EXISTS progress (key TEXT PRIMARY KEY, rev INTEGER NOT NULL, value TEXT NOT NULL)');
    return db;
  } catch (error) { db.close(); throw error; }
}

function read(options, revisionsOnly) {
  const db = open(options, false);
  try {
    const result = Object.create(null);
    if (db) {
      const sql = revisionsOnly ? 'SELECT key, rev FROM progress' : 'SELECT key, rev, value FROM progress';
      for (const row of db.prepare(sql).iterate()) {
        result[row.key] = revisionsOnly ? row.rev : { rev: row.rev, value: JSON.parse(row.value) };
      }
    }
    return revisionsOnly ? { ok: true, revisions: result } : { ok: true, records: result };
  } finally { db?.close(); }
}

export function backupProgress(options) {
  const browser = { localStorage: Object.create(null), house: null, models: [], texturePack: null };
  for (const [key, { value }] of Object.entries(read(options, false).records)) {
    if (value === null) continue;
    if (assetKeys.has(key)) browser[key] = value;
    else browser.localStorage[key] = value;
  }
  return browser;
}

function commit(options, changes) {
  if (!Array.isArray(changes) || !changes.length) throw invalid();
  const keys = new Set();
  for (const change of changes) {
    if (!change || !validKey(change.key) || !Number.isSafeInteger(change.base) || change.base < 0 ||
        !Object.hasOwn(change, 'value') || keys.has(change.key)) throw invalid();
    const { key, value } = change;
    if (value !== null) {
      const valid = key === 'models' ? Array.isArray(value) : assetKeys.has(key)
        ? typeof value === 'object' && !Array.isArray(value) : typeof value === 'string';
      if (!valid) throw invalid();
    }
    keys.add(key);
  }
  const db = open(options, true);
  try {
    db.exec('BEGIN IMMEDIATE');
    const get = db.prepare('SELECT rev, value FROM progress WHERE key=?');
    const set = db.prepare('INSERT INTO progress(key,rev,value) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET rev=excluded.rev, value=excluded.value');
    const conflicts = Object.create(null), revisions = Object.create(null);
    for (const { key, base, value } of changes) {
      const old = get.get(key), rev = old?.rev ?? 0, encoded = JSON.stringify(value);
      // A lost response may resend a committed write. Unchanged values are idempotent.
      if (old?.value === encoded) revisions[key] = rev;
      else if (base !== rev) conflicts[key] = { rev, value: old ? JSON.parse(old.value) : null };
      else {
        // Keep deletion revisions so a stale tab cannot re-create a deleted record.
        revisions[key] = rev + 1;
        set.run(key, rev + 1, encoded);
      }
    }
    if (Object.keys(conflicts).length) {
      db.exec('ROLLBACK');
      return { ok: false, conflicts };
    }
    db.exec('COMMIT');
    return { ok: true, revisions };
  } finally { db.close(); }
}

export function createProgressHandler(options) {
  return async (req, res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      guardLocalOrigin(req);
      if (req.method === 'GET') {
        const revs = new URL(req.url, 'http://localhost').searchParams.get('revisions') === '1';
        return options.sendJson(res, 200, read(options, revs));
      }
      if (req.method !== 'PUT') {
        res.setHeader('Allow', 'GET, PUT');
        return options.sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      }
      if (req.headers['x-cabin-progress'] !== '1') return options.sendJson(res, 403, { ok: false, error: 'csrf_header_required' });
      const data = await readJson(req, 384 * 1024 * 1024);
      const result = commit(options, data?.changes);
      return options.sendJson(res, result.ok ? 200 : 409, result);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (!req.complete) res.setHeader('Connection', 'close');
      return options.sendJson(res, error.status || 503, { ok: false, error: error.code || 'progress_unavailable' });
    }
  };
}
