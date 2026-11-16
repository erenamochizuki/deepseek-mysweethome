// Run pure invariants; pass --url http://.../studio.html for real UI + PNG fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadV3 } from '../tools/lib/v3-node.mjs';
import { WEB_DIR, launchBrowser, encodePng } from '../tools/mc-lib.mjs';
const { V3 } = loadV3(['12-nbt', '13-share', '15-mcmodel', '44-furn-mc', '45-photos', '46-block-editor']);
const E = V3.blockEditor, F = V3.furnMc, S = V3.share;
let n = 0;
function check(label, fn) { fn(); n++; console.log('PASS ' + label); }
const blank = E.empty();
check('put immutable and bounds', () => { const m = E.put(blank, [1, 1, 1], 'minecraft:stone'); assert.equal(E.stateAt(blank, [1, 1, 1]), 'minecraft:air'); assert.equal(E.stateAt(m, [1, 1, 1]), 'minecraft:stone'); assert.throws(() => E.put(m, [-1, 0, 0], 'minecraft:stone')); });
check('same-id state edits preserve vanilla BE; replacing id drops it', () => { let m = E.put(blank, [1, 1, 1], 'minecraft:chest[facing=north,type=single,waterlogged=false]'); const be = { pos: [1, 1, 1], id: 'minecraft:chest', data: { compound: { CustomName: { string: 'kept' }, Items: { list: [{ compound: { Slot: { byte: 0 }, id: { string: 'minecraft:diamond' }, count: { int: 3 } } }] } } } }; m = { ...m, blockEntities: [be] }; const turned = E.put(m, [1, 1, 1], 'minecraft:chest[facing=east,type=single,waterlogged=false]'); assert.deepEqual(turned.blockEntities, [be]); assert.equal(E.put(turned, [1, 1, 1], 'minecraft:stone').blockEntities.length, 0); assert.deepEqual(m.blockEntities, [be]); });
check('malformed furniture is inspectable and removable', () => { const m = { ...blank, palette: ['minecraft:air', 'xiaojingyu:bed[facing=invalid,part=unknown]'], cells: Int32Array.from(blank.cells) }; m.cells[0] = 1; assert.equal(E.pieceAt(m, [0, 0, 0]).broken, true); assert.equal(E.stateAt(E.remove(m, [0, 0, 0]), [0, 0, 0]), 'minecraft:air'); });
check('explicit state validation and facing', () => { assert.throws(() => E.validateState('bad state')); assert.throws(() => E.validateState('minecraft:stone[a=1,a=2]')); assert.equal(E.withFacing('minecraft:oak_stairs[facing=north,half=top]', 'east'), 'minecraft:oak_stairs[facing=east,half=top]'); });
for (const f of F.list) for (const facing of ['north', 'east', 'south', 'west']) check(f.id + '/' + facing + ' atomic placement/move/removal', () => {
  const m = E.placeFurniture(blank, f.id, [5, 3, 5], facing), pc = E.pieceAt(m, [5, 3, 5]);
  assert.equal(pc.broken, false); assert.equal(pc.cells.length, f.cells.length);
  for (const c of pc.cells) { assert.equal(E.pieceAt(m, c.pos).main.join(), '5,3,5'); assert.throws(() => E.put(m, c.pos, 'minecraft:stone')); }
  const moved = E.placeFurniture(m, f.id, [10, 3, 10], 'east', pc.cells.at(-1).pos);
  assert.equal(E.pieceAt(moved, [10, 3, 10]).broken, false);
  for (const c of pc.cells) assert.equal(E.stateAt(moved, c.pos), 'minecraft:air');
  const gone = E.remove(m, pc.cells.at(-1).pos); for (const c of pc.cells) assert.equal(E.stateAt(gone, c.pos), 'minecraft:air');
});
check('collision fails without mutating model/history', () => { const m = E.put(blank, [5, 3, 5], 'minecraft:stone'), before = S.dump(m); assert.throws(() => E.placeFurniture(m, 'bed', [5, 3, 5], 'north')); assert.deepEqual(S.dump(m), before); });
let photo = E.placeFurniture(blank, 'photo_frame', [3, 2, 3], 'north');
photo.blockEntities[0].data = { compound: { Marker: { string: 'preserve me' }, Pixels: { byteArray: Uint8Array.from([1, 2, 3]) } } };
const movedPhoto = E.placeFurniture(photo, 'photo_frame', [6, 2, 6], 'east', [3, 2, 3]);
check('photo block entity NBT survives movement', () => { assert.equal(movedPhoto.blockEntities.length, 1); assert.deepEqual(movedPhoto.blockEntities[0].data, photo.blockEntities[0].data); assert.deepEqual(movedPhoto.blockEntities[0].pos, [6, 2, 6]); });
check('history undo/redo/branch', () => { const d = E.session(blank); d.apply(photo); d.apply(movedPhoto); d.undo(); assert.equal(d.model, photo); d.redo(); assert.equal(d.model, movedPhoto); d.undo(); d.apply(E.put(d.model, [1, 1, 1], 'minecraft:stone')); assert.equal(d.redoCount, 0); });
check('fill layer preserves occupied cells and is one undo', () => { const m = E.put(blank, [1, 0, 1], 'minecraft:glass'), d = E.session(m); d.apply(E.fillLayer(m, 0, 'minecraft:oak_planks')); assert.equal(E.stateAt(d.model, [1, 0, 1]), 'minecraft:glass'); assert.equal(E.stateAt(d.model, [0, 0, 0]), 'minecraft:oak_planks'); d.undo(); assert.deepEqual(S.dump(d.model), S.dump(m)); });
const png = await S.writePng(movedPhoto, encodePng(8, 8, new Uint8Array(8 * 8 * 4).fill(255)));
const round = await S.read(png);
check('PNG roundtrip states/entities/offset', () => { const a = S.dump(round), b = S.dump(movedPhoto); delete a.meta.compound.RequiredMods; delete b.meta.compound.RequiredMods; assert.deepEqual(a, b); });
const urlAt = process.argv.indexOf('--url');
if (urlAt >= 0) {
  const browser = await launchBrowser({ width: 1440, height: 1000 });
  try {
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    const url = new URL(process.argv[urlAt + 1]); url.searchParams.set('model', 'blockeditor');
    await page.goto(url.href, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForFunction(() => window.V3?.blockEditor?.current(), { timeout: 120000 });
    await page.evaluate(() => V3.blockEditor.current().ready);
    assert.equal(await page.evaluate(() => V3.blockEditor.current().error), null);
    await page.select('#be-scene', 'blank'); await page.click('#be-load-scene');
    async function coords(p) { await page.evaluate(p => ['x', 'y', 'z'].forEach((a, i) => document.getElementById('be-' + a).value = p[i]), p); }
    await page.click('#be-fill');
    await page.select('#be-tool', 'erase');
    await page.$eval('#be-grid', e => e.scrollIntoView({ block: 'center' }));
    const gr = await page.$eval('#be-grid', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
    await page.mouse.click(gr.x + gr.w * 1.5 / 16, gr.y + gr.w * 1.5 / 16);
    assert.equal(await page.evaluate(() => V3.blockEditor.stateAt(V3.blockEditor.current().model, [1, 0, 1])), 'minecraft:air');
    await page.focus('#be-grid'); await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => V3.blockEditor.stateAt(V3.blockEditor.current().model, [1, 0, 1])), 'minecraft:oak_planks');
    await page.select('#be-tool', 'place'); await coords([2, 0, 2]); await page.click('#be-apply');
    assert.equal(await page.evaluate(() => V3.blockEditor.stateAt(V3.blockEditor.current().model, [2, 0, 2])), 'minecraft:oak_planks');
    async function put(p, state) { await page.select('#be-tool', 'place'); await page.evaluate(s => document.getElementById('be-state').value = s, state); await coords(p); await page.click('#be-apply'); }
    for (const [y, half] of [[1, 'lower'], [2, 'upper']]) await put([2, y, 2], 'minecraft:oak_door[facing=east,half=' + half + ',hinge=left,open=false,powered=false]');
    await put([8, 1, 10], 'minecraft:oak_planks'); await put([8, 2, 10], 'minecraft:oak_planks');
    await page.select('#be-tool', 'furniture'); await page.select('#be-furniture', 'bed'); await coords([5, 1, 5]); await page.click('#be-apply');
    await page.click('#be-rotate');
    assert.equal(await page.evaluate(() => V3.blockEditor.pieceAt(V3.blockEditor.current().model, [5, 1, 5]).facing), 'east');
    await page.click('#be-undo'); assert.equal(await page.evaluate(() => V3.blockEditor.pieceAt(V3.blockEditor.current().model, [5, 1, 5]).facing), 'north');
    await page.click('#be-redo');
    await page.select('#be-furniture', 'telescope'); await coords([10, 1, 5]); await page.click('#be-apply');
    await page.select('#be-furniture', 'photo_album_table'); await coords([3, 1, 10]); await page.click('#be-apply');
    await page.select('#be-furniture', 'photo_frame'); await coords([8, 1, 8]); await page.click('#be-apply');
    const rgba = new Uint8Array(128 * 128 * 4); for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) rgba.set(x < 64 ? [40, 160, 230, 255] : y < 64 ? [255, 215, 70, 255] : [240, 70, 70, 255], (x + y * 128) * 4);
    const photoBytes = Array.from(encodePng(128, 128, rgba));
    await page.evaluate(bytes => { const e = V3.blockEditor.current(), P = V3.photos, p = P.make(Uint8Array.from(bytes), 'P6 三色方向图', 0), org = P.originOf(e.model), world = c => c.map((n, i) => n + org[i]); let m = P.setAlbum(e.model, world([3, 1, 10]), [p]); m = P.setSlot(m, world([8, 1, 8]), 0, p); e.session.apply(m); return e.refresh(); }, photoBytes);
    await page.select('#be-tool', 'select'); await page.select('#be-facing', 'south'); await coords([8, 2, 11]); await page.click('#be-move');
    assert.equal(await page.evaluate(() => V3.blockEditor.current().model.blockEntities.filter(b => b.id === 'xiaojingyu:photo_frame')[0].pos.join()), '8,2,11');
    await page.click('#be-undo'); await page.click('#be-redo');
    await page.select('#be-tool', 'select');
    await page.click('#be-clip'); await page.click('#be-frame');
    await page.evaluate(() => V3.blockEditor.current().ready);
    const result = await page.evaluate(async () => { const e = V3.blockEditor.current(), dump = m => { const d = V3.share.dump(m); delete d.meta.compound.RequiredMods; return JSON.stringify(d); }, before = dump(e.model); let failed = false; try { await e.importBytes(new Uint8Array([1, 2, 3])); } catch { failed = true; } const retained = dump(e.model) === before; const bytes = await e.exportPng(); await e.importBytes(bytes); return { failed, retained, bytes: Array.from(bytes), roundtrip: dump(e.model) === before }; });
    assert.ok(result.failed && result.retained && result.roundtrip, 'invalid import safe and PNG roundtrip');
    assert.equal(await page.evaluate(() => { let n = 0; V3.blockEditor.current().root.traverse(o => { if (o.name === 'editor-photo') n++; }); return n; }), 1, 'photo decoded and rendered');
    const dir = path.resolve(WEB_DIR, '..', 'tmp', 'recovery-20261109', 'editor'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'workbench-edited.png'), Buffer.from(result.bytes));
    const exported = await S.read(Uint8Array.from(result.bytes));
    fs.writeFileSync(path.join(dir, 'workbench-edited.json'), JSON.stringify(S.dump(exported), null, 2) + '\n');
    console.log('MC fixture volume=' + exported.cells.length + ', blocks=' + Array.from(exported.cells).filter(i => exported.palette[i] !== 'minecraft:air').length);
    const oldCount = await page.evaluate(() => V3.blockEditor.current().session.undoCount);
    await (await page.$('#be-file')).uploadFile(path.join(dir, 'workbench-edited.png'));
    await page.waitForFunction(c => V3.blockEditor.current().session.undoCount > c, {}, oldCount);
    await page.evaluate(() => V3.blockEditor.current().ready);
    await page.screenshot({ path: path.join(dir, 'editor-ui.png') });
    await page.evaluate(() => { const id = V3.models.list().find(m => m.id !== 'blockeditor').id; V3.models.show(id); });
    assert.equal(await page.$('#block-editor'), null);
    await page.evaluate(() => V3.models.show('blockeditor')); await page.evaluate(() => V3.blockEditor.current().ready);
    assert.equal(await page.$$eval('#block-editor', els => els.length), 1);
    assert.deepEqual(errors, []);
    console.log('PASS real browser UI, roundtrip, disposal; fixture: ' + path.join(dir, 'workbench-edited.png'));
  } finally { await browser.close(); }
}
console.log('PASS ' + n + ' pure editor checks');
