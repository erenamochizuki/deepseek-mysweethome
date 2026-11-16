// node --test test/mc-instance.test.mjs — no native directory prompt, browser, or ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constants, crc32, deflateRawSync, deflateSync } from 'node:zlib';
import { loadV3 } from '../tools/lib/v3-node.mjs';

const STONE = 'assets/minecraft/textures/block/stone.png';
const SLAB = 'assets/only_pack/textures/block/family/slab.png';
const text = (bytes) => Buffer.from(bytes).toString();
const openModule = (indexedDB) => loadV3(['14-mc-instance'], { globals: { indexedDB } }).V3.mcInstance;

function fakeIdb() {
  const stores = new Map();
  return {
    stores,
    open(name, version) {
      assert.equal(name, 'v3-mc-instance');
      assert.equal(version, 1);
      const req = {};
      queueMicrotask(() => {
        const first = !stores.size;
        req.result = {
          createObjectStore(storeName) { stores.set(storeName, new Map()); },
          close() {},
          transaction(storeName, mode) {
            const store = stores.get(storeName);
            assert.ok(store);
            const tx = {
              objectStore() {
                const request = (operation) => {
                  const result = {};
                  queueMicrotask(() => { result.result = operation(); tx.oncomplete(); });
                  return result;
                };
                return {
                  get: (key) => request(() => store.get(key)),
                  put: (value, key) => request(() => { assert.equal(mode, 'readwrite'); store.set(key, value); return key; }),
                  delete: (key) => request(() => { assert.equal(mode, 'readwrite'); store.delete(key); }),
                };
              },
            };
            return tx;
          },
        };
        if (first) req.onupgradeneeded();
        req.onsuccess();
      });
      return req;
    },
  };
}

function file(bytes, { size } = {}) {
  const blob = new Blob([bytes]);
  const stats = { opens: 0, reads: [] };
  return {
    kind: 'file', stats,
    async getFile() {
      stats.opens++;
      return {
        size: size ?? blob.size,
        slice(start, end) { stats.reads.push([start, end]); return blob.slice(start, end); },
        arrayBuffer() { throw new Error('Must not read the whole archive'); },
      };
    },
  };
}

function dir(name, files = {}) {
  const children = new Map(Object.entries(files));
  const stats = { query: 0, prompt: 0, listing: 0, lookups: [] };
  const state = { permission: 'granted', nextGrant: 'granted' };
  const get = (name, kind, opts) => {
    stats.lookups.push([name, kind]);
    assert.ok(!opts?.create);
    const child = children.get(name);
    if (child?.kind !== kind) throw new Error('Missing child ' + name);
    return child;
  };
  return {
    kind: 'directory', name, children, stats, state,
    async queryPermission(opts) { assert.deepEqual(opts, { mode: 'read' }); stats.query++; return state.permission; },
    async requestPermission(opts) { assert.deepEqual(opts, { mode: 'read' }); stats.prompt++; return state.permission = state.nextGrant; },
    async getFileHandle(name, opts) { return get(name, 'file', opts); },
    async getDirectoryHandle(name, opts) { return get(name, 'directory', opts); },
    async *entries() { stats.listing++; yield* children.entries(); },
  };
}

function makeZip(entries, { comment = '' } = {}) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, value, opts = {}] of entries) {
    const path = Buffer.from(name), bytes = Buffer.from(value), method = opts.method ?? 0;
    const raw = method === 8 ? deflateRawSync(bytes, opts.deflate) : bytes;
    const checksum = opts.crc ?? crc32(bytes), length = opts.length ?? bytes.length;
    const flags = opts.flags ?? (opts.descriptor ? 8 : 0);
    const head = Buffer.alloc(30), row = Buffer.alloc(46), descriptor = Buffer.alloc(opts.descriptor ? 16 : 0);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(flags, 6);
    head.writeUInt16LE(method, 8);
    if (opts.descriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(raw.length, 8);
      descriptor.writeUInt32LE(length, 12);
    } else {
      head.writeUInt32LE(checksum, 14);
      head.writeUInt32LE(raw.length, 18);
      head.writeUInt32LE(length, 22);
    }
    head.writeUInt16LE(path.length, 26);
    row.writeUInt32LE(0x02014b50, 0);
    row.writeUInt16LE(20, 4);
    row.writeUInt16LE(20, 6);
    row.writeUInt16LE(flags, 8);
    row.writeUInt16LE(method, 10);
    row.writeUInt32LE(checksum, 16);
    row.writeUInt32LE(raw.length, 20);
    row.writeUInt32LE(length, 24);
    row.writeUInt16LE(path.length, 28);
    row.writeUInt32LE(offset, 42);
    offset += head.length + path.length + raw.length + descriptor.length;
    local.push(head, path, raw, descriptor);
    central.push(row, path);
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22), commentBytes = Buffer.from(comment);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return { bytes: Buffer.concat([...local, cd, end, commentBytes]), centralStart: offset };
}

function options(...names) { return file('other:setting\r\nresourcePacks:' + JSON.stringify(names) + '\r\nincompatibleResourcePacks:["file/not-enabled.zip"]\r\n'); }
function folderPack(name, stone = 'folder override') {
  const png = file(stone), huge = file('', { size: 9 * 1024 * 1024 });
  const block = dir('block', { 'stone.png': png, 'huge.png': huge, 'stone.png.mcmeta': file('{"animation":{}}') });
  const ns = dir('minecraft', { textures: dir('textures', { block }) });
  return { png, block, huge, pack: dir(name, { assets: dir('assets', { minecraft: ns }) }) };
}

test('discovery uses only explicitly enabled local packs, preserves precedence, and reads textures lazily', async () => {
  const api = openModule(fakeIdb());
  const archive = makeZip([
    [STONE, 'zip base', { method: 8, descriptor: true }],
    [SLAB, 'nested texture'],
    ['assets/minecraft/textures/item/stone.png', Buffer.alloc(90_000)],
    ['assets/minecraft/textures/block/../secret.png', 'rejected'],
  ]);
  const zipped = file(archive.bytes), disabled = file(makeZip([[STONE, 'disabled']]).bytes);
  const { png, block, huge, pack } = folderPack('自选贴图');
  const resourcepacks = dir('resourcepacks', { 'a.zip': zipped, '自选贴图': pack, 'bad.zip': file('bad'), 'not-enabled.zip': disabled });
  const root = dir('Local MC', {
    'options.txt': options('vanilla', 'file/自选贴图', 'file/a.zip', 'file/bad.zip', 'file/missing.zip', 'file/自选贴图',
      'file/../secret.zip', 'file/.. ', 'file/..\\secret.zip', 'file/C:other.zip', 'not-enabled.zip'),
    resourcepacks,
  });
  const instance = await api.bind(root);
  assert.equal(instance.name, 'Local MC');
  assert.deepEqual(instance.layers.map((layer) => layer.name), ['a.zip', '自选贴图']);
  assert.deepEqual(instance.modIds, new Set());
  assert.equal(root.stats.listing, 0);
  assert.equal(resourcepacks.stats.listing, 0);
  assert.ok(resourcepacks.stats.lookups.every(([name]) => ['a.zip', '自选贴图', 'bad.zip', 'missing.zip'].includes(name)));
  assert.deepEqual(zipped.stats.reads, [[archive.bytes.length - 22, archive.bytes.length], [archive.centralStart, archive.bytes.length - 22]]);
  assert.equal(png.stats.opens, 0);
  assert.equal(disabled.stats.opens, 0);

  const [low, high] = instance.layers;
  assert.equal(text(await low.read(STONE)), 'zip base');
  assert.equal(text(await low.read(SLAB)), 'nested texture');
  assert.equal(text(await high.read(STONE)), 'folder override');
  assert.equal(text(await high.read(STONE + '.mcmeta')), '{"animation":{}}');
  assert.equal(await high.read('assets/minecraft/textures/block/huge.png'), null);
  assert.deepEqual(huge.stats.reads, []);
  const lookups = block.stats.lookups.length, zipReads = zipped.stats.reads.length;
  for (const path of ['options.txt', STONE + '\n', '/'+ STONE, STONE.replace('stone', '../secret'),
    STONE.replace('minecraft', '..'), STONE.replace('stone', './/secret'), STONE.replace('block', 'item'),
    STONE.replace('block', 'block\\..'), STONE.replace('stone', '%2e%2e/secret'), STONE.replace('stone', 'STONE')]) {
    assert.equal(await high.read(path), null, path);
    assert.equal(await low.read(path), null, path);
  }
  assert.equal(block.stats.lookups.length, lookups);
  assert.equal(zipped.stats.reads.length, zipReads);
  instance.layers.pop();
  instance.modIds.add('changed_by_caller');
  assert.deepEqual((await api.current()).layers.map((layer) => layer.name), ['a.zip', '自选贴图']);
  assert.equal((await api.current()).modIds.size, 0);
  root.children.set('options.txt', options('file/自选贴图', 'file/a.zip'));
  assert.deepEqual((await api.refresh()).layers.map((layer) => layer.name), ['自选贴图', 'a.zip']);
});

test('missing, oversized, ambiguous, and corrupt options never enable disabled packs', async () => {
  const api = openModule(fakeIdb());
  const zipped = file(makeZip([[STONE, 'texture']]).bytes);
  const root = dir('Local', { resourcepacks: dir('resourcepacks', { 'a.zip': zipped }) });
  assert.deepEqual((await api.bind(root)).layers, []);
  for (const invalid of ['resourcePacks:[', 'resourcePacks:["file/a.zip", 2]', 'resourcePacks:["file/a.zip"]\nresourcePacks:[]',
    'incompatibleResourcePacks:["file/a.zip"]', 'resourcePacks:' + ' '.repeat(262_144) + '["file/a.zip"]']) {
    root.children.set('options.txt', file(invalid));
    assert.deepEqual((await api.refresh()).layers, []);
  }
  assert.equal(zipped.stats.opens, 0);
});

test('mod IDs come only from top-level supported manifests in actual enabled-suffix JAR files', async () => {
  const api = openModule(fakeIdb());
  const fabric = makeZip([
    ['fabric.mod.json', JSON.stringify({ id: 'fabric_mod', provides: ['alias_only'], depends: { minecraft: '*' } }), { method: 8 }],
    ['unrelated.class', Buffer.alloc(140_000)],
  ]);
  const fabricJar = file(fabric.bytes);
  const forge = [
    'modId = "not_a_mod"', '[[mods]] # primary', 'modId = "forge_one"', "description = '''", '[[mods]]',
    "modId = 'in_description'", "'''", '[[dependencies.forge_one]]', 'modId = "dependency_only"',
    '[[mods]]', "'modId' = 'forge_two' # other", '[[mods]]', 'modId = "duplicate_a"', 'modId = "duplicate_b"',
  ].join('\n');
  const jar = (...entries) => file(makeZip(entries).bytes);
  const mods = dir('mods', {
    'fabric.jar': fabricJar,
    'quilt.JAR': jar(['quilt.mod.json', '{"quilt_loader":{"id":"quilt_mod","provides":[{"id":"other_alias"}]}}']),
    'forge.jar': jar(['META-INF/mods.toml', forge]),
    'neo.jar': jar(['META-INF/neoforge.mods.toml', '[[mods]]\nmodId = "neo_mod"'], ['fabric.mod.json', 'bad json']),
    'fake-name.jar': jar([SLAB, 'namespace is not metadata'], ['META-INF/jarjar/fabric.mod.json', '{"id":"nested"}']),
    'disabled.jar.disabled': jar(['fabric.mod.json', '{"id":"disabled"}']),
    'broken.jar': file('broken zip'),
    'oversized.jar': file('', { size: 2 ** 31 + 1 }),
    'duplicate.jar': jar(['fabric.mod.json', '{"id":"first_dupe"}'], ['fabric.mod.json', '{"id":"last_dupe"}']),
    subdir: dir('subdir', { 'deep.jar': jar(['fabric.mod.json', '{"id":"deep"}']) }),
  });
  const root = dir('Local', { 'options.txt': options('file/pack.zip'), resourcepacks: dir('resourcepacks', { 'pack.zip': jar([SLAB, 'pack']) }), mods });
  const { modIds } = await api.bind(root);
  assert.deepEqual(Array.from(modIds).sort(), ['fabric_mod', 'forge_one', 'forge_two', 'neo_mod', 'quilt_mod']);
  assert.deepEqual(fabricJar.stats.reads.slice(0, 2), [[fabric.bytes.length - 22, fabric.bytes.length], [fabric.centralStart, fabric.bytes.length - 22]]);
  assert.equal(fabricJar.stats.reads.length, 4);
  assert.ok(fabricJar.stats.reads.slice(2).every(([, end]) => end < 1000));
  assert.equal(mods.children.get('disabled.jar.disabled').stats.opens, 0);
  assert.equal(mods.children.get('subdir').stats.listing, 0);
  assert.deepEqual(mods.children.get('oversized.jar').stats.reads, []);
});

test('archive integrity, caps, and unusual ZIP metadata fall back independently by entry', async () => {
  const api = openModule(fakeIdb());
  const asset = (name) => STONE.replace('stone.png', name + '.png');
  const bytes = makeZip([
    [STONE, 'good'],
    [asset('crc'), 'corrupt', { crc: 42 }],
    [asset('short'), 'tiny', { method: 8, length: 20 }],
    [asset('inflated'), Buffer.alloc(128 * 1024), { method: 8, length: 16 }],
    [asset('oversized'), 'small', { method: 8, length: 9 * 1024 * 1024 }],
    [asset('encrypted'), 'ignored', { flags: 1 }],
    [asset('duplicate'), 'first'], [asset('duplicate'), 'second'],
  ], { comment: 'ZIP comment with signature-looking bytes PK\x05\x06' }).bytes;
  const corrupt = Buffer.from(makeZip([[STONE, 'contents']]).bytes);
  corrupt.writeUInt32LE(0xfffffff0, corrupt.length - 6); // EOCD directory offset cannot refer outside its file.
  const zipped = file(bytes);
  const root = dir('Local', {
    'options.txt': options('file/zip64.zip', 'file/a.zip'),
    resourcepacks: dir('resourcepacks', { 'a.zip': zipped, 'zip64.zip': file(corrupt) }),
  });
  const { layers } = await api.bind(root);
  assert.deepEqual(layers.map((layer) => layer.name), ['a.zip']);
  assert.equal(text(await layers[0].read(STONE)), 'good');
  for (const name of ['crc', 'short', 'inflated', 'oversized', 'encrypted', 'duplicate']) {
    assert.equal(await layers[0].read(asset(name)), null, name);
  }
});

test('restored handles never prompt until explicitly reauthorized; forget only clears the stored handle', async () => {
  const indexedDB = fakeIdb();
  const first = openModule(indexedDB), { pack } = folderPack('pack');
  const root = dir('Local', { 'options.txt': options('file/pack'), resourcepacks: dir('resourcepacks', { pack }) });
  const firstView = await first.bind(root);
  assert.equal(indexedDB.stores.get('binding').size, 1);
  assert.equal(indexedDB.stores.get('binding').get('directory'), root);
  assert.equal(root.stats.prompt, 0);
  root.state.permission = 'prompt';
  root.state.nextGrant = 'denied';
  const next = openModule(indexedDB), oldLookups = root.stats.lookups.length;
  assert.equal(await next.current(), null);
  assert.equal(await next.refresh(), null);
  assert.equal(root.stats.lookups.length, oldLookups);
  assert.equal(root.stats.prompt, 0);
  assert.equal(await firstView.layers[0].read(STONE), null);
  assert.equal(await next.refresh({ requestPermission: true }), null);
  assert.equal(root.stats.prompt, 1);
  root.state.nextGrant = 'granted';
  const authorized = await next.refresh({ requestPermission: true });
  assert.equal(authorized.name, 'Local');
  assert.equal(root.stats.prompt, 2);
  assert.equal(text(await authorized.layers[0].read(STONE)), 'folder override');
  await next.forget();
  assert.equal(await next.current(), null);
  assert.equal(await authorized.layers[0].read(STONE), null);
  assert.equal(await openModule(indexedDB).current(), null);
  assert.equal(indexedDB.stores.get('binding').size, 0);
  assert.equal(root.children.has('resourcepacks'), true);
});

test('failed storage does not claim binding persisted', async () => {
  const api = openModule(undefined);
  assert.equal(await api.current(), null);
  await assert.rejects(api.bind(dir('Local')), /IndexedDB/);
  await assert.rejects(api.forget(), /IndexedDB/);
  await assert.rejects(api.bind(file('not a directory')), /directory handle/);
});

test('optional bounded zlib helper supports stored, fixed and dynamic blocks and verifies actual output', () => {
  const { inflateZlib } = openModule(fakeIdb());
  const payload = Buffer.from('local png data (synthetic) '.repeat(9000));
  for (const opts of [{ level: 0 }, { strategy: constants.Z_FIXED }, {}]) {
    const bytes = deflateSync(payload, opts);
    assert.deepEqual(Buffer.from(inflateZlib(bytes, payload.length)), payload);
    assert.throws(() => inflateZlib(bytes, payload.length - 1), /Invalid or oversized/);
  }
  const bad = deflateSync(payload);
  bad[bad.length - 1] ^= 1;
  assert.throws(() => inflateZlib(bad, payload.length), /Invalid or oversized/);
});
