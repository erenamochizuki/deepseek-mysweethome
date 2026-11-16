import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCard, runStep, CardError, StepFailed } from '../lib/cards.mjs';
import { ProbeClient } from '../probe-client.mjs';
import { makeTempDir } from './mock-probe.mjs';
import { writeCard, removeDir } from './helpers.mjs';
import { cardText, CARD_FILE } from '../album-carry-card.mjs';
const tmp = makeTempDir('album-carry-');
test.after(() => removeDir(tmp));
let n = 0;
const steps = text => loadCard(writeCard(tmp, `${++n}.yml`, `steps:\n${text}`)).steps;
test('P5-006 generated card is current; independent copies and disk reload are covered', () => {
  assert.equal(fs.readFileSync(CARD_FILE, 'utf8'), cardText());
  const card = loadCard(CARD_FILE);
  assert.equal(card.steps.filter(s => s.type === 'reopen').length, 1);
  assert.equal((cardText().match(/Album append value/g) ?? []).length, 64);
  assert.match(cardText(), /air destroy/);
  assert.match(cardText(), /edited independently/);
});
test('pick and reopen reject invalid parameters', () => {
  for (const line of ['  - reopen: arbitrary-path\n', '  - pick: {pos: [1, 2, 3], maxBytes: 0}\n', '  - pick: {pos: [1, 2, 3], includeData: yes}\n']) {
    assert.throws(() => steps(line), CardError);
  }
});
test('pick checks small reference payload and detects leaked album bytes', async () => {
  const [s] = steps('  - pick: {pos: [1, 2, 3], hasReference: true, hasAlbum: false, maxBytes: 1024}\n');
  const response = { reference: 'a'.repeat(64), hasAlbum: false, encodedBytes: 180 };
  const ctx = { client: { pick: async () => response } };
  assert.equal(await runStep(s, ctx), response);
  for (const bad of [{ reference: null }, { hasAlbum: true }, { encodedBytes: 3000000 }]) {
    ctx.client.pick = async () => ({ ...response, ...bad });
    await assert.rejects(runStep(s, ctx), StepFailed);
  }
});
test('ProbeClient wrappers and reopen step preserve endpoint contract', async () => {
  const client = new ProbeClient({ port: 1, token: 'test' });
  const calls = [];
  client.request = async (...args) => { calls.push(args); return { folder: 'P5-006' }; };
  await client.pick([1, 2, 3]);
  assert.deepEqual(calls[0].slice(0, 2), ['POST', '/pick']);
  assert.deepEqual(calls[0][2].body, { pos: [1, 2, 3], includeData: true });
  const [s] = steps('  - reopen:\n');
  assert.deepEqual(await runStep(s, { client }), { folder: 'P5-006' });
  assert.deepEqual(calls[1].slice(0, 2), ['POST', '/world/reopen']);
  assert.deepEqual(calls[1][2].body, {});
});
