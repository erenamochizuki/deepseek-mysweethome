#!/usr/bin/env node
// tools/check-isolation.mjs — v3 must not depend on the v1 workspace or on machine-specific absolute paths.
//
//   node tools/check-isolation.mjs [--root <dir>]
//
// Scans text files (.js .mjs .cjs .html .css .json) under ROOT, skipping node_modules/ and .git/ (any depth),
// dist/ shots/ feedback/ (top level) and test/tmp-*. Markdown is not scanned (docs may describe the history).
// FAIL (exit 1) with file:line on any of these rules:
//   old-name  the v1 workspace folder name
//   old-refs  the v1 refs sub-folder name
//   h-drive   the H drive: capital H, colon, then a slash or backslash
//   abs-path  any drive-letter absolute path: a letter, a colon, then a slash or backslash
// A drive letter glued to a word or to an escape backslash does not count (no hits on "https://", regex "\d:\d").
// Allowlist: only the two Edge install paths in tools/shoot.mjs (browser discovery fallback), any / \ \\ separators.
// The rule strings are assembled from pieces so that this file does not trip its own rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1]) ROOT = path.resolve(args[++i]);
  else if (args[i] === '--help' || args[i] === '-h') { console.log('usage: node tools/check-isolation.mjs [--root <dir>]'); process.exit(0); }
  else { console.error(`unknown argument: ${args[i]}\nusage: node tools/check-isolation.mjs [--root <dir>]`); process.exit(2); }
}

const EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json']);
const SKIP_ANY = new Set(['node_modules', '.git']);
const SKIP_TOP = new Set(['dist', 'shots', 'feedback']);
const OLD_NAME = '旧' + '工作区';
const OLD_REFS = 'beach' + '-cabin';
const NOT_GLUED = '(?<![A-Za-z0-9\\\\])';
const SEP = '[\\\\/]';
const RE_H = new RegExp(NOT_GLUED + 'H:' + SEP);
const RE_ABS = new RegExp(NOT_GLUED + '[A-Za-z]:' + SEP);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const allowRe = (parts) => new RegExp(parts.map(esc).join(SEP + '+'), 'gi');
const EDGE_TAIL = ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
const ALLOW = { 'tools/shoot.mjs': [['C:', 'Program Files (x86)', ...EDGE_TAIL], ['C:', 'Program Files', ...EDGE_TAIL]].map(allowRe) };

function* walk(dir, rel) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { console.error(`  (cannot read ${rel || '.'}: ${e.code || e.message})`); return; }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_ANY.has(e.name) || (!rel && SKIP_TOP.has(e.name)) || (rel === 'test' && e.name.startsWith('tmp-'))) continue;
      yield* walk(path.join(dir, e.name), r);
    } else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) yield r;
  }
}

const snippet = (s, i) => {
  const a = Math.max(0, i - 40), b = Math.min(s.length, i + 70);
  return `${a > 0 ? '…' : ''}${s.slice(a, b).trim()}${b < s.length ? '…' : ''}`;
};

function checkLine(file, line) {
  const hits = [];
  for (const [id, needle] of [['old-name', OLD_NAME], ['old-refs', OLD_REFS]]) {
    const i = line.indexOf(needle);
    if (i >= 0) hits.push([id, snippet(line, i)]);
  }
  let s = line;
  for (const re of ALLOW[file] || []) s = s.replace(re, '');
  const h = s.search(RE_H), a = h >= 0 ? h : s.search(RE_ABS);
  if (a >= 0) hits.push([h >= 0 ? 'h-drive' : 'abs-path', snippet(s, a)]);
  return hits;
}

console.log(`check-isolation  ${ROOT}`);
console.log('  scan .js .mjs .cjs .html .css .json · skip node_modules .git dist shots feedback test/tmp-* · .md not scanned');
let files = 0, bad = 0;
const badFiles = new Set();
for (const rel of walk(ROOT, '')) {
  files++;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { console.error(`  (cannot read ${rel}: ${e.code || e.message})`); continue; }
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    for (const [id, snip] of checkLine(rel, lines[n])) {
      bad++; badFiles.add(rel);
      console.log(`  ${rel}:${n + 1}  ${id}  ${snip}`);
    }
  }
}
if (bad) {
  console.log(`FAIL  ${bad} 处违规，涉及 ${badFiles.size} 个文件（共扫描 ${files} 个文件）`);
  process.exit(1);
}
console.log(`PASS  扫描 ${files} 个文件，0 处违规`);
