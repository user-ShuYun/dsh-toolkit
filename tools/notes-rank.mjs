/**
 * notes-rank.mjs —— 带「半衰期衰减」的笔记检索
 *
 *   node tools/notes-rank.mjs "关键词" [--days 90] [--top 8] [--all]
 *
 * 借鉴自「鱼的记忆」插件：记忆不是永久的，越旧权重越低。
 * 这里用 90 天半衰期：一条 90 天前的笔记，分值只有今天的一半。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'D:/deepseek/notes';
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const query = argv.find((a) => !a.startsWith('--') && isNaN(Number(a))) || '';
const HALF_LIFE = Number(arg('days', 90));
const TOP = Number(arg('top', 8));
const showAll = argv.includes('--all');

if (!query) {
  console.log('用法: node tools/notes-rank.mjs "关键词" [--days 90] [--top 8] [--all]');
  process.exit(0);
}

const terms = query
  .toLowerCase()
  .split(/\s+/)
  .filter(Boolean);

const walk = (d) => {
  const out = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.md') && name !== 'INDEX.md') out.push(p);
  }
  return out;
};

const now = Date.now();
const rows = [];

for (const p of walk(ROOT)) {
  const raw = readFileSync(p, 'utf8');
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta = {};
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
  const title = meta.title || p.split(/[\\/]/).pop().replace(/\.md$/, '');
  const up = meta.up || '未知';
  const saved = meta.saved ? new Date(meta.saved).getTime() : statSync(p).mtimeMs;
  const ageDays = Math.max(0, (now - saved) / 86400000);

  // 命中次数（标题里命中算 3 分）
  const body = raw.toLowerCase();
  let hits = 0;
  let titleHits = 0;
  for (const t of terms) {
    titleHits += (title.toLowerCase().match(new RegExp(escapeRe(t), 'g')) || []).length;
    hits += (body.match(new RegExp(escapeRe(t), 'g')) || []).length;
  }
  if (hits === 0) continue;

  const base = titleHits * 3 + Math.min(hits, 40);
  const decay = Math.pow(0.5, ageDays / HALF_LIFE);
  rows.push({
    title,
    up,
    ageDays: Math.round(ageDays),
    hits,
    titleHits,
    raw: base,
    score: +(base * decay).toFixed(2),
    decay: +decay.toFixed(3),
    path: p
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

rows.sort((a, b) => b.score - a.score);

if (!rows.length) {
  console.log('没有命中「' + query + '」的笔记');
  process.exit(0);
}

console.log(`「${query}」命中 ${rows.length} 条，按「90 天半衰期」排序：\n`);
for (const r of rows.slice(0, showAll ? rows.length : TOP)) {
  const age = r.ageDays === 0 ? '今天' : r.ageDays + ' 天前';
  console.log(`  ${String(r.score).padStart(6)}  │ ${r.title.slice(0, 34)}`);
  console.log(`          │ ${r.up} · ${age} · 权重 ${r.decay} · 命中 ${r.hits} 次`);
  console.log(`          │ ${r.path.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
}
console.log('\n提示：--days 30 会让旧笔记衰减更快；--all 显示全部');
