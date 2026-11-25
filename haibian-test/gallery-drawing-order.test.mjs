import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('incoming pictures reach the album only after a completed drawing, and retries preserve the original', async () => {
  const source = readFileSync(new URL('../integration/web/cabin-gallery.js', import.meta.url), 'utf8');
  const id = 'new-picture', original = new Blob(['fixture-picture'], { type: 'image/png' });
  const photos = [], calls = [], storage = new Map();
  let completed = false, writable = true;
  const V3 = {
    houseBlocks: { model: {} },
    photos: { MAX: 64, albumTables: () => [{ cell: [0, 5, 0] }], albumAt: () => ({ photos, keep: [] }) },
    album: {
      fromFile: async file => ({ photo: { id: await file.text() } }),
      storeDrawing: async photo => {
        calls.push('save');
        if (!writable) return { ok: false };
        photos.push(photo);
        return { ok: true };
      },
    },
    artDesk: { async drawForAlbum({ imageUrl }) {
      const response = await fetch(imageUrl);
      assert.equal(await response.text(), 'fixture-picture');
      calls.push('draw');
      return completed;
    } },
  };
  const window = { V3 };
  const row = { id, name: 'test', ts: Date.now(), url: '/drawing.png', drawInLoft: true };
  const api = { ok: true, year: new Date().getFullYear(), drawings: [row] };
  const localStorage = {
    getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
  };
  vm.runInNewContext(source, { window, console, document: { hidden: false, addEventListener() {} },
    localStorage, File, URL, fetch: async url => url === '/api/cabin/art' ? Response.json(api) : new Response(original) });
  localStorage.setItem('cabinGallery.frames-filled.v1', '1');
  const sync = () => window.__cabinGallery.sync('test');
  assert.equal((await sync()).added, 0);
  assert.deepEqual(calls, ['draw']);
  completed = true;
  writable = false;
  assert.equal((await sync()).added, 0);
  assert.equal(photos.length, 0);
  assert.equal(storage.has('cabinGallery.imported.v1'), false);
  writable = true;
  assert.equal((await sync()).added, 1);
  assert.equal((await sync()).added, 0);
  assert.deepEqual(calls, ['draw', 'draw', 'save', 'draw', 'save']);
  assert.deepEqual(photos.map(p => p.id), ['fixture-picture']);
});
