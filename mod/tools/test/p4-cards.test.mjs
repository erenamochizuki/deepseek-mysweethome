// P4 卡片（task-17）：mod/cards/P4-002.yml（定稿的房子；草图时方案 A 的 P4-001 已删），房子是 fmt-js 导出的 fixtures/house-v4/。
// 1) 读卡片：盖房子的几步写对了（拷哪张鲸图、xjy place 回的格数 = 盒子大小、expect_file / expect_shapes 的
//    at = 站立点 + 文件的 Offset）；每张截图前的 tp 是绝对坐标带朝向，眼睛那一格在房子里是空气（机位没卡进墙里）。
// 2) 对着 mock 跑盖房子和核对的几步（截图那一段不跑）：expect_file、expect_shapes 都要过，
//    expect_shapes 查过的格数 = 房子里不是空气的格数。mock 的 /shapes 只算栅栏、玻璃板、灯笼、门（mock-shapes.mjs），
//    楼梯拐角要在真游戏里查。运行：node --test mod/tools/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCard, runStep, CARDS_DIR } from '../lib/cards.mjs';
import { loadModelFile } from '../lib/box.mjs';
import { tpPose } from '../lib/pose.mjs';
import { ProbeClient } from '../probe-client.mjs';
import { startMockProbe, makeTempDir, REPO_DIR } from './mock-probe.mjs';
import { xjyCommands } from './mock-xjy.mjs';
import { removeDir } from './helpers.mjs';

const HOUSES = [
  { id: 'P4-002', png: 'fixtures/house-v4/house-v4-b.png', json: 'fixtures/house-v4/house-v4-b.json' },
];
const STAND = [0, -60, 0]; // 站立点：卡片里 tp @s 0.5 -60 0.5 180 0
const EYE = 1.62; // 旁观模式的眼睛高度
const SHOTS = ['SE', 'SW', 'NE', 'NW', 'porch', 'door', 'low', 'attic'];
const isAirState = (s) => /^minecraft:(air|cave_air|void_air)$/.test(s);
const repoRel = (p) => (path.isAbsolute(p) ? path.relative(REPO_DIR, p) : p).split(path.sep).join('/');

const tmp = makeTempDir('p4-');
test.after(() => removeDir(tmp));

for (const h of HOUSES) {
  test(`${h.id}：盖房子的参数和 ${h.json} 对得上，截图机位不在墙里`, async () => {
    const card = loadCard(path.join(CARDS_DIR, `${h.id}.yml`));
    const model = await loadModelFile(path.join(REPO_DIR, h.json));
    const [W, , L] = model.size;
    const at = STAND.map((v, k) => v + model.offset[k]);
    const one = (type) => {
      const list = card.steps.filter((s) => s.type === type);
      assert.equal(list.length, 1, `${type} 要正好一步`);
      return list[0];
    };
    const cmds = card.steps.filter((s) => s.type === 'cmd').map((s) => s.params.command);

    assert.equal(repoRel(one('copy_file').params.from), h.png);
    assert.match(one('copy_file').params.to, new RegExp(`^${h.id}-.+\\.png$`));
    const place = card.steps.find((s) => s.type === 'cmd' && /^xjy place /.test(s.params.command));
    assert.equal(place.params.result, model.states.length, 'xjy place 回的是整个盒子的格数');
    assert.ok(cmds.indexOf('tp @s 0.5 -60 0.5 180 0') < cmds.indexOf(place.params.command), '放之前站到站立点朝北');
    const ef = one('expect_file').params;
    assert.deepEqual([repoRel(ef.file), ef.at, ef.size, ef.offset], [h.json, at, model.size, model.offset]);
    const es = one('expect_shapes').params;
    assert.deepEqual([repoRel(es.file), es.at], [h.json, at]);

    // 截图：8 张，都 hideGui；前面的 tp 能核对站位；眼睛那一格是空气、在地面上面
    const order = (pred) => card.steps.findIndex(pred);
    const spectator = order((s) => s.type === 'cmd' && s.params.command === 'gamemode spectator');
    assert.ok(order((s) => s.type === 'expect_shapes') < spectator && spectator < order((s) => s.type === 'shot'), '核对完再切旁观，然后截图');
    let tp = null;
    const names = [];
    for (const s of card.steps) {
      if (s.type === 'cmd' && /^tp /.test(s.params.command)) tp = s.params.command;
      if (s.type !== 'shot') continue;
      const name = s.params.name;
      names.push(name);
      assert.equal(s.params.hideGui, true, `${name} 要 hideGui`);
      const p = tpPose(tp)?.pose;
      assert.ok(p, `${name}：前面要有绝对坐标、带朝向的 tp（现在是 ${tp}）`);
      const eye = [Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)];
      const c = eye.map((v, k) => v - at[k]);
      const inside = c.every((v, k) => v >= 0 && v < model.size[k]);
      const state = inside ? model.states[c[0] + c[2] * W + c[1] * W * L] : 'minecraft:air';
      assert.ok(isAirState(state), `${name}：眼睛在 [${eye.join(', ')}]，那一格是 ${state}`);
      assert.ok(p.y + EYE > -61, `${name}：眼睛在地面下面`);
      if (name.endsWith('-low')) assert.ok(Math.abs(p.y + EYE - (-59 + 1.2)) < 1e-9, '低视角：眼睛离一楼地板 1.2 格');
    }
    assert.deepEqual(names, SHOTS.map((x) => `${h.id}-${x}`));
  });

  test(`${h.id}：对着 mock 盖房子、核对（截图那一段不跑）`, async () => {
    const card = loadCard(path.join(CARDS_DIR, `${h.id}.yml`));
    const model = await loadModelFile(path.join(REPO_DIR, h.json));
    const solid = model.states.filter((s) => !isAirState(s)).length;
    const dir = path.join(tmp, h.id);
    fs.mkdirSync(dir, { recursive: true }); // mock 不会自己建目录
    const ok = (_w, text) => ({ success: true, result: 1, output: [`ok: ${text}`] }); // mock 没有 gamerule / gamemode
    const mock = await startMockProbe({ dir, commands: { ...xjyCommands(), gamerule: ok, gamemode: ok } });
    try {
      const client = new ProbeClient({ port: mock.port, token: mock.token });
      const ctx = { client, shotsDir: path.join(dir, 'shots'), runId: '20261106-120000', gameDir: dir, snapshots: new Map() };
      const cut = card.steps.findIndex((s) => s.type === 'expect_shapes');
      const tail = card.steps.slice(-2);
      assert.deepEqual(tail.map((s) => s.type), ['leave', 'wait']);
      const out = {};
      for (const s of [...card.steps.slice(0, cut + 1), ...tail]) out[s.type] = await runStep(s, ctx);
      assert.equal(out.expect_file.cells, model.states.length);
      assert.deepEqual([out.expect_shapes.checked, out.expect_shapes.changed, out.expect_shapes.truncated], [solid, 0, false]);
      assert.equal(shapesCalls(mock), 1);
    } finally {
      await mock.close();
    }
  });
}

const shapesCalls = (mock) => mock.requests.filter((q) => q.path === '/shapes').length;
