// yaml-lite 的单元测试。运行：node --test mod/tools/test/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, parseYamlDocument, YamlError } from '../yaml-lite.mjs';

/** 断言解析失败：是 YamlError、行号对、（可选）原因里有某段话。 */
function failsAt(text, line, re) {
  assert.throws(
    () => parseYaml(text),
    (e) => {
      assert.ok(e instanceof YamlError, `应该是 YamlError，实际是 ${e?.name}: ${e?.message}`);
      assert.equal(e.line, line, `行号不对：${e.message}`);
      if (re) assert.match(e.message, re);
      return true;
    },
  );
}

test('映射、列表、嵌套', () => {
  const text = [
    'id: P0-001',
    'title: 放方块',
    'steps:',
    '  - open: P0-001',
    '  - leave',
    '  - wait:',
    '      inWorld: true',
    '      timeout: 180',
    '  - expect_block:',
    '      pos: [1, -60, 3]',
    '      blockEntityContains:',
    '        - a',
    '        - b',
    'tail: 1',
  ].join('\n');
  assert.deepEqual(parseYaml(text), {
    id: 'P0-001',
    title: '放方块',
    steps: [
      { open: 'P0-001' },
      'leave',
      { wait: { inWorld: true, timeout: 180 } },
      { 'expect_block': { pos: [1, -60, 3], blockEntityContains: ['a', 'b'] } },
    ],
    tail: 1,
  });
});

test('列表项里写多个键（「- 键: 值」后面接同一缩进的键）', () => {
  const text = ['at:', '  - pos: [5, -60, 3]', '    state: minecraft:air', '  - pos: [5, -61, 3]', '    state: minecraft:stone'].join('\n');
  assert.deepEqual(parseYaml(text), {
    at: [
      { pos: [5, -60, 3], state: 'minecraft:air' },
      { pos: [5, -61, 3], state: 'minecraft:stone' },
    ],
  });
});

test('列表可以和上一层的键同样缩进', () => {
  const text = ['palette:', '- minecraft:air', '- minecraft:stone', 'size: [3, 3, 3]'].join('\n');
  assert.deepEqual(parseYaml(text), { palette: ['minecraft:air', 'minecraft:stone'], size: [3, 3, 3] });
});

test('最外层是列表', () => {
  assert.deepEqual(parseYaml('- a\n- 2\n- {x: 1}\n'), ['a', 2, { x: 1 }]);
});

test('数字、true/false/null、普通字符串', () => {
  const text = [
    'a: 1',
    'b: -60',
    'c: 0.5',
    'd: -0.25',
    'e: 1e3',
    'f: true',
    'g: False',
    'h: null',
    'i: ~',
    'j:',
    'k: hello world',
    'l: 0x10',
    'm: "123"',
    "n: 'true'",
  ].join('\n');
  assert.deepEqual(parseYaml(text), {
    a: 1,
    b: -60,
    c: 0.5,
    d: -0.25,
    e: 1000,
    f: true,
    g: false,
    h: null,
    i: null,
    j: null,
    k: 'hello world',
    l: '0x10',
    m: '123',
    n: 'true',
  });
});

test('超出安全范围的整数要报错（让人加引号）', () => {
  failsAt('a: 1\nseed: 12345678901234567890\n', 2);
  assert.deepEqual(parseYaml('seed: "12345678901234567890"'), { seed: '12345678901234567890' });
});

test('双引号转义', () => {
  const text = String.raw`s: "tab\t quote\" back\\ uni\u00e9 hex\x41 slash\/"`;
  assert.deepEqual(parseYaml(text), { s: 'tab\t quote" back\\ uni\u00e9 hexA slash/' });
});

test('单引号：两个单引号表示一个，反斜杠不转义', () => {
  assert.deepEqual(parseYaml(String.raw`s: 'it''s \n'`), { s: "it's \\n" });
});

test('注释：# 前面要有空格；引号里的 # 不是注释', () => {
  const text = [
    '# 开头的注释',
    'a: 1 # 行尾注释',
    '    # 缩进的注释行',
    'b: "x # y"',
    'c: x#y',
    "d: 'p # q' # 注释",
  ].join('\n');
  assert.deepEqual(parseYaml(text), { a: 1, b: 'x # y', c: 'x#y', d: 'p # q' });
});

test('行内列表和行内映射', () => {
  const text = [
    'pos: [1, -60, 3]',
    'empty: []',
    'emptyMap: {}',
    'map: {a: 1, b: [2, 3], c: "x, y"}',
    'nested: [[1, 2], {k: v}]',
    'trailing: [1, 2,]',
    "quoted: ['minecraft:stone', \"minecraft:chest[facing=north]\"]",
  ].join('\n');
  assert.deepEqual(parseYaml(text), {
    pos: [1, -60, 3],
    empty: [],
    emptyMap: {},
    map: { a: 1, b: [2, 3], c: 'x, y' },
    nested: [[1, 2], { k: 'v' }],
    trailing: [1, 2],
    quoted: ['minecraft:stone', 'minecraft:chest[facing=north]'],
  });
});

test('方块状态在块里可以不加引号', () => {
  const text = [
    'state: minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]',
    'list:',
    '  - minecraft:lantern[hanging=false,waterlogged=false]',
    'cmd: setblock 1 -60 3 minecraft:chest[facing=north]',
    'sel: kill @e[type=!minecraft:player]',
    'nbt: \'id:"minecraft:chest"\'',
  ].join('\n');
  assert.deepEqual(parseYaml(text), {
    state: 'minecraft:oak_stairs[facing=east,half=top,shape=straight,waterlogged=false]',
    list: ['minecraft:lantern[hanging=false,waterlogged=false]'],
    cmd: 'setblock 1 -60 3 minecraft:chest[facing=north]',
    sel: 'kill @e[type=!minecraft:player]',
    nbt: 'id:"minecraft:chest"',
  });
});

test('方块状态写在 [ ] 里必须加引号', () => {
  failsAt('a: 1\npalette: [minecraft:chest[facing=north]]\n', 2, /引号/);
});

test('值里有「: 」或者以 : 结尾，要加引号', () => {
  failsAt('a: b: c\n', 1, /引号/);
  failsAt('x: 1\nmsg: 结尾是冒号:\n', 2, /引号/);
  assert.deepEqual(parseYaml('a: "b: c"'), { a: 'b: c' });
});

test('@ 开头的值要加引号', () => {
  failsAt('a: 1\ntarget: @s\n', 2);
  assert.deepEqual(parseYaml('target: "@s"'), { target: '@s' });
});

test('带引号的键、空 BOM、CRLF', () => {
  assert.deepEqual(parseYaml('\uFEFF"a b": 1\r\n\'c:d\': 2\r\n'), { 'a b': 1, 'c:d': 2 });
});

test('空文档和只有注释的文档是 null', () => {
  assert.equal(parseYaml(''), null);
  assert.equal(parseYaml('# 只有注释\n\n   # 又一行\n'), null);
});

test('__proto__ 只是普通的键，不会改原型', () => {
  const v = parseYaml('__proto__: {polluted: 1}\nconstructor: 2\n');
  assert.deepEqual(Object.keys(v), ['__proto__', 'constructor']);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(v['__proto__'], { polluted: 1 });
});

test('不支持的写法报错，并且带行号', () => {
  failsAt('a: 1\n\tb: 2\n', 2, /tab|制表/i);
  failsAt('a: 1\nb: &x 2\n', 2);
  failsAt('a: 1\nb: *x\n', 2);
  failsAt('a: 1\nb: |\n  text\n', 2);
  failsAt('a: 1\nb: >\n  text\n', 2);
  failsAt('a: 1\nb: !tag x\n', 2);
  failsAt('---\na: 1\n', 1);
  failsAt('a: 1\n...\n', 2);
  failsAt('a: 1\nb: 2\na: 3\n', 3, /重复|一样/);
  failsAt('a: 1\nb: [1,\n  2]\n', 2);
  failsAt('a: 1\nb: "abc\n', 2);
  failsAt('a: 1\nb: - x\n', 2);
});

test('缩进不对报错', () => {
  failsAt('a: 1\n  b: 2\n', 2, /缩进/);
  failsAt('steps:\n  - wait:\n      inWorld: true\n     timeout: 3\n', 4, /缩进/);
});

test('错误信息带文件名', () => {
  assert.throws(
    () => parseYaml('a: 1\nb: *x\n', { filename: 'card.yml' }),
    (e) => e instanceof YamlError && e.filename === 'card.yml' && e.message.startsWith('card.yml:2:'),
  );
  assert.throws(
    () => parseYaml('a: 1\nb: *x\n'),
    (e) => e instanceof YamlError && e.message.startsWith('第 2 行'),
  );
});

test('parseYamlDocument 能查到键和列表项的行号', () => {
  const text = ['id: x', '', 'steps:', '  - open: a', '  # 注释', '  - wait:', '      inWorld: true', '  - leave'].join('\n');
  const doc = parseYamlDocument(text, { filename: 'x.yml' });
  const steps = doc.value.steps;
  assert.equal(doc.keyLine(doc.value, 'id'), 1);
  assert.equal(doc.keyLine(doc.value, 'steps'), 3);
  assert.equal(doc.itemLine(steps, 0), 4);
  assert.equal(doc.itemLine(steps, 1), 6);
  assert.equal(doc.itemLine(steps, 2), 8);
  assert.equal(doc.keyLine(steps[1].wait, 'inWorld'), 7);
});
