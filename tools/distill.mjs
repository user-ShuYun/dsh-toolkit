/**
 * distill.mjs —— 归纳候选：把同类经验摊开，方便写出「上位规律」。
 *
 * 人踩三个坑会自动总结出"这类事都得小心"；它不会。
 * 这个工具负责把"该归纳的那一堆"摆出来，归纳本身还是我（或子代理）写，写完你点头。
 *
 * 用法:
 *   node tools/distill.mjs                 # 列出够格归纳的标签（≥3 条）
 *   node tools/distill.mjs --tag 视频       # 摊开某个标签的全部条目
 *   node tools/distill.mjs --min 2
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\deepseek';
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const MIN = Number(arg('min', 3));
const TAG = arg('tag', '');

function load(file, prefix) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8');
  return [...raw.matchAll(new RegExp(`^## \\[(${prefix}\\d+)\\]\\s*(\\S+)\\s*·\\s*([^·]+?)\\s*·\\s*(.+)$`, 'gm'))]
    .map((m) => ({ id: m[1], date: m[2], tag: m[3].trim(), title: m[4].trim(), prefix }));
}

const lessons = load('LESSONS.md', 'L');
const others = [
  ...load('CORRECTIONS.md', 'C'),
  ...load('PREFERENCES.md', 'P'),
  ...load('PLAYBOOKS.md', 'B')
];

const byTag = new Map();
for (const l of lessons) {
  if (!byTag.has(l.tag)) byTag.set(l.tag, []);
  byTag.get(l.tag).push(l);
}

if (TAG) {
  const rows = byTag.get(TAG) || [];
  if (!rows.length) { console.log(`没有标签「${TAG}」。现有：${[...byTag.keys()].join('、')}`); process.exit(0); }
  console.log(`\n「${TAG}」共 ${rows.length} 条：\n`);
  for (const r of rows) console.log(`  ${r.id} ${r.title}`);
  console.log('\n→ 如果这堆里确实有一条共同的规律，写进 TOOLS.md 对应章节，并在日志里保留原文。');
  process.exit(0);
}

const heavy = [...byTag.entries()].filter(([, v]) => v.length >= MIN).sort((a, b) => b[1].length - a[1].length);
console.log(`\n够格归纳的标签（≥${MIN} 条）：\n`);
for (const [tag, rows] of heavy) {
  console.log(`  ${tag} (${rows.length})  ${rows.map((r) => r.id).join(' ')}`);
  console.log(`     ${rows.slice(0, 3).map((r) => r.title).join(' / ')}${rows.length > 3 ? ' …' : ''}`);
}
if (!heavy.length) console.log('  （还没有哪个标签够 3 条）');

if (others.length) {
  console.log(`\n非技术类（纠正/偏好/打法）：${others.map((o) => o.id + ' ' + o.title).join(' · ')}`);
}

console.log('\n展开某个标签：node tools/distill.mjs --tag <标签>');
