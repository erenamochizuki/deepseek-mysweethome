// No Gradle/Java/MC launch: capture the runner's child environment with a tiny Node stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir, REPO_DIR } from './mock-probe.mjs';
import { RUN_CARDS, writeCard, runNode, readRun, removeDir, show, PASS_CARD } from './helpers.mjs';
import { loadCard, CARDS_DIR } from '../lib/cards.mjs';
import { loadModelFile } from '../lib/box.mjs';

const tmp = makeTempDir('portable-runner-');
test.after(() => removeDir(tmp));
const fake = path.join(tmp, 'environment.mjs');
fs.writeFileSync(fake, 'console.log("CHILD_ENV=" + JSON.stringify({ javaHome: process.env.JAVA_HOME ?? null, path: process.env.PATH ?? process.env.Path })); process.exitCode = 1;\n');
for (const [name, env, cli, expected] of [
  ['CLI wins', { XJY_JAVA_HOME: 'ignored-xjy', JAVA_HOME: 'ignored-java' }, ['--java-home', 'chosen JDK'], 'chosen JDK'],
  ['XJY_JAVA_HOME wins', { XJY_JAVA_HOME: 'xjy JDK', JAVA_HOME: 'ignored-java' }, [], 'xjy JDK'],
  ['JAVA_HOME fallback', { XJY_JAVA_HOME: '', JAVA_HOME: 'standard JDK' }, [], 'standard JDK'],
  ['PATH fallback', { XJY_JAVA_HOME: '', JAVA_HOME: '' }, [], null],
]) {
  test(`Java selection: ${name}`, async () => {
    const dir = path.join(tmp, name.replaceAll(' ', '-')); fs.mkdirSync(dir);
    const card = writeCard(dir, 'ok.yml', PASS_CARD), out = path.join(dir, 'out');
    const r = await runNode(RUN_CARDS, [card, '--probe-file', path.join(dir, 'probe.json'), '--out', out, '--timeout-start', '10', ...cli], { env: { ...env, XJY_TEST_FAKE_GAME: fake } });
    assert.equal(r.code, 2, show(r)); // Stand-in exits deliberately; it never starts a game.
    const { results, runDir } = readRun(out);
    assert.equal(results.fatal.error, 'start_failed');
    const home = expected ? path.resolve(expected) : null;
    assert.equal(results.options.javaHome, home);
    const log = fs.readFileSync(path.join(runDir, 'gradle.log'), 'utf8');
    const child = JSON.parse(log.match(/^CHILD_ENV=(.+)$/m)[1]);
    assert.equal(child.javaHome, home);
    assert.equal(child.path, process.env.PATH ?? process.env.Path, 'Preserve PATH for Gradle fallback');
  });
}
test('Empty explicit Java home fails as usage error, before launch', async () => {
  const r = await runNode(RUN_CARDS, ['--java-home=']);
  assert.equal(r.code, 2); assert.match(r.stderr, /--java-home/);
});
test('P6 uses tracked fixtures and PNG/JSON describe the same accepted scene', async () => {
  const card = loadCard(path.join(CARDS_DIR, 'P6-001.yml'));
  const png = path.join(REPO_DIR, 'fixtures/house-v4/workbench-edited.png');
  const json = path.join(REPO_DIR, 'fixtures/house-v4/workbench-edited.json');
  assert.equal(card.steps.find(s => s.type === 'copy_file').params.from, png);
  assert.equal(card.steps.find(s => s.type === 'expect_files').params.file, json);
  const a = await loadModelFile(png), b = await loadModelFile(json);
  assert.deepEqual(a, b);
  assert.deepEqual(a.size, [16, 12, 16]);
  assert.equal(a.states.filter(s => s !== 'minecraft:air').length, 265);
});
