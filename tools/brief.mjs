/**
 * brief.mjs —— 从 LESSONS.md 自动生成「最贵的 N 条」，写进 AGENTS.md 的标记块里。
 *
 * 解决的问题：AGENTS.md 第四节原来是我手挑的 12 条，经验涨到 100 条以后挑不动了。
 *
 * 排序规则（可解释，不神秘）：
 *   分数 = 命中次数 × 3 + 时间新鲜度（30 天内 +2，90 天内 +1） + 标签稀有度（同标签越少越值钱）
 *
 * 用法:
 *   node tools/brief.mjs                 # 只看，不写
 *   node tools/brief.mjs --write         # 写进 AGENTS.md 的 BRIEF 标记块
 *   node tools/brief.mjs --n 15 --write
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\deepseek';
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const N = Number(flag('n', 12));
const WRITE = !!flag('write', false);

const lessonsPath = path.join(ROOT, 'LESSONS.md');
const agentsPath = path.join(ROOT, 'AGENTS.md');

const text = fs.readFileSync(lessonsPath, 'utf8');
const blocks = [...text.matchAll(/^## \[(L\d+)\] (\d{4}-\d{2}-\d{2}) · (.+?) · (.+)$/gm)].map((m) => {
  const start = m.index;
  const next = text.indexOf('\n## [', start + 5);
  const body = text.slice(start, next < 0 ? undefined : next);
  return {
    id: m[1], date: m[2], tag: m[3], title: m[4].trim(), body,
    hit: Number(/- 命中: (\d+)/.exec(body)?.[1] || 0),
    fix: (/- 修法: (.+)/.exec(body)?.[1] || '').replace(/\s+/g, ' ').trim()
  };
});

const tagCount = {};
for (const b of blocks) tagCount[b.tag] = (tagCount[b.tag] || 0) + 1;

const days = (d) => (Date.now() - new Date(d).getTime()) / 86400000;
const scored = blocks.map((b) => {
  const fresh = days(b.date) <= 30 ? 2 : days(b.date) <= 90 ? 1 : 0;
  const rare = 1 / Math.max(1, tagCount[b.tag]);        // 稀有的标签加分
  return { ...b, score: b.hit * 3 + fresh + rare };
}).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));

const top = scored.slice(0, N);
const withHits = scored.filter((b) => b.hit > 0);
const picked = withHits.length >= N ? top : withHits;
if (picked.length < N) {
  console.log(`\n（有命中记录的只有 ${picked.length} 条，不拿 0 命中的凑数）`);
}

const lines = picked.map((b, i) => `${i + 1}. **[${b.tag}] ${b.title}** —— ${b.fix ? b.fix.slice(0, 70) : '（无修法记录）'}`);
const block = [
  '<!-- BRIEF:START 由 tools/brief.mjs 生成，别手改这一块 -->',
  ...lines,
  '<!-- BRIEF:END -->'
].join('\n');

console.log(`从 ${blocks.length} 条里选出 ${picked.length} 条（分数 = 命中×3 + 新鲜度 + 稀有度）\n`);
for (const b of picked) {
  console.log(`${b.score.toFixed(2).padStart(5)}  ${b.id} [${b.tag}] ${b.title}`);
}

if (!WRITE) {
  console.log('\n（只预览，没有写文件；要写进 AGENTS.md 加 --write）');
  process.exit(0);
}

const agents = fs.readFileSync(agentsPath, 'utf8');
const re = /<!-- BRIEF:START[\s\S]*?<!-- BRIEF:END -->/;
if (!re.test(agents)) {
  console.error('❌ AGENTS.md 里没有 BRIEF 标记块，先手工加：\n<!-- BRIEF:START -->\n<!-- BRIEF:END -->');
  process.exit(1);
}
fs.writeFileSync(agentsPath, agents.replace(re, block), 'utf8');
console.log(`\n✅ 已写入 AGENTS.md（${block.length} 字符）`);
