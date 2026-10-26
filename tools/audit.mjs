/**
 * audit.mjs —— 经验库体检（清理用，不常跑）。
 *
 * 解决的问题：LESSONS.md 是追加式的，只增不减，久了会变成垃圾场。
 * 这里做五件事，并给出可执行建议：
 *   ① 草稿超期（默认 7 天）→ 建议删除或升格（--fix 自动删）
 *   ② 重复条目（标题相似度高）→ 建议合并
 *   ③ 单标签过多（>8 条）→ 建议蒸馏进 TOOLS.md
 *   ④ 陈货（命中 0 且超过 30 天）→ 建议淘汰
 *   ⑤ 体积告警（>80 KB 或 >60 条）→ 建议压缩
 *
 * 用法:
 *   node tools/audit.mjs
 *   node tools/audit.mjs --fix          # 超期草稿 → 归档到 notes/日志/草稿归档/（不删原文）
 *
 * 2026-10-26 改：--fix 原来是**真删**。用户长期不开 DSH 时，草稿会在没人看的情况下
 * 被清掉，坑就永久蒸发了。现在改成归档：原文移到 notes/日志/草稿归档/<日期>.md，
 * 我回来还能看到当时到底报了什么错。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\deepseek';
const argv = process.argv.slice(2);
const FIX = argv.includes('--fix');
const DRAFT_DAYS = 7;
const STALE_DAYS = 30;

const lessonsPath = path.join(ROOT, 'LESSONS.md');
const draftPath = path.join(ROOT, 'LESSONS.draft.md');

const text = fs.existsSync(lessonsPath) ? fs.readFileSync(lessonsPath, 'utf8') : '';
const blocks = [...text.matchAll(/^## \[(L\d+)\] (\d{4}-\d{2}-\d{2}) · (.+?) · (.+)$/gm)].map((m) => {
  const start = m.index;
  const next = text.indexOf('\n## [', start + 5);
  const body = text.slice(start, next < 0 ? undefined : next);
  return {
    id: m[1], date: m[2], tag: m[3], title: m[4].trim(), body,
    hit: Number(/- 命中: (\d+)/.exec(body)?.[1] || 0)
  };
});

const kb = (() => {
  try { return Math.round(fs.statSync(lessonsPath).size / 1024 * 10) / 10; } catch { return 0; }
})();
const problems = [];

// ① 草稿超期
let draftText = fs.existsSync(draftPath) ? fs.readFileSync(draftPath, 'utf8') : '';
const drafts = [...draftText.matchAll(/^## \[(D\d+)\] (\S+)/gm)].map((m) => ({
  id: m[1], time: new Date(m[2])
}));
const oldDrafts = drafts.filter((d) => (Date.now() - d.time.getTime()) / 86400000 > DRAFT_DAYS);
if (oldDrafts.length) problems.push(`草稿超期 ${oldDrafts.length} 条：${oldDrafts.map((d) => d.id).join(', ')} → 升格或归档${FIX ? '（--fix 已归档）' : '（加 --fix 自动归档）'}`);

// ② 重复（标题字符集 Jaccard）
const norm = (s) => [...new Set(s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split(''))];
const jac = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
};
const dupes = [];
for (let i = 0; i < blocks.length; i++) {
  for (let j = i + 1; j < blocks.length; j++) {
    if (blocks[i].tag !== blocks[j].tag) continue;
    if (jac(norm(blocks[i].title), norm(blocks[j].title)) > 0.62) dupes.push([blocks[i].id, blocks[j].id]);
  }
}
if (dupes.length) problems.push(`疑似重复 ${dupes.length} 对：${dupes.slice(0, 5).map((d) => d.join('≈')).join('，')} → 合并`);

// ③ 单标签过多
const byTag = {};
for (const b of blocks) (byTag[b.tag] ||= []).push(b.id);
const heavy = Object.entries(byTag).filter(([, ids]) => ids.length > 8);
if (heavy.length) problems.push(`标签过长：${heavy.map(([t, ids]) => `${t}(${ids.length})`).join('、')} → 蒸馏进 TOOLS.md`);

// ④ 陈货
const stale = blocks.filter((b) => b.hit === 0 && (Date.now() - new Date(b.date).getTime()) / 86400000 > STALE_DAYS);
if (stale.length) problems.push(`陈货 ${stale.length} 条（30 天没被命中）：${stale.map((b) => b.id).join(', ')} → 考虑淘汰`);

// ⑦ 可信度与复核（2026-10-26 新增）：人会记得"我可能记错了/这条早该重看"，它只能靠字段
// 四库都要查：只扫 LESSONS 会漏掉纠错/偏好/打法里的过期条目
const allFiles = [
  ['LESSONS.md', 'L'],
  ['CORRECTIONS.md', 'C'],
  ['PREFERENCES.md', 'P'],
  ['PLAYBOOKS.md', 'B']
];
const allBlocks = allFiles.flatMap(([file, pre]) => {
  const fp = path.join(ROOT, file);
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp, 'utf8');
  // 收尾断言要的是「字符串结尾」：m 模式下 `$` 会匹配行尾，惰性量词会在标题行就停（L056）
  return [...raw.matchAll(new RegExp(`^## \\[(${pre}\\d+)\\][\\s\\S]*?(?=\\n## \\[|$(?![\\s\\S]))`, 'gm'))]
    .map((m) => ({ id: m[1], body: m[0] }));
});
const today = new Date().toISOString().slice(0, 10);
const unverified = allBlocks.filter((b) => /- 可信度[:：]\s*推测/.test(b.body));
if (unverified.length) problems.push(`推测未验证 ${unverified.length} 条：${unverified.map((b) => b.id).join(', ')} → 验证后 node tools/memo.mjs verify <ID>`);
const overdue = allBlocks.filter((b) => {
  const m = /- 复核[:：]\s*(\d{4}-\d{2}-\d{2})/.exec(b.body);
  return m && m[1] < today;
});
if (overdue.length) problems.push(`复核过期 ${overdue.length} 条：${overdue.map((b) => b.id + '(' + /- 复核[:：]\s*(\S+)/.exec(b.body)[1] + ')').join(', ')} → 重看一遍后 node tools/memo.mjs verify <ID>`);

// ⑤ 体积
if (kb > 80 || blocks.length > 60) problems.push(`体积 ${kb} KB / ${blocks.length} 条 → 超过阈值，该压缩`);

// ⑥ 计分机制形同虚设（全库命中都是 0，说明 hit 从来没人调）
if (blocks.length > 10 && blocks.every((b) => b.hit === 0)) {
  problems.push('命中计数全为 0 → 计分机制没在用：引用某条经验救了你之后，跑 `node tools/learn.mjs hit L0xx`');
}

console.log(`经验库：${blocks.length} 条 · ${kb} KB · 草稿 ${drafts.length} 条`);
console.log(`命中分布：有命中 ${blocks.filter((b) => b.hit > 0).length} 条 / 全零 ${blocks.filter((b) => b.hit === 0).length} 条`);

if (!problems.length) {
  console.log('\n✅ 没有发现问题');
} else {
  console.log('\n需要处理的：');
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
}

if (FIX && oldDrafts.length) {
  const ARCH = path.join(ROOT, 'notes', '日志', '草稿归档');
  fs.mkdirSync(ARCH, { recursive: true });
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const time = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const archFile = path.join(ARCH, `${day}.md`);

  const archBlocks = [];
  let next = draftText;
  for (const dr of oldDrafts) {
    // 注意：不能带 m 标志 —— 带 m 时 `$` 会匹配行尾，惰性量词会在标题行就停下，
    // 只把标题归档走、正文留在草稿里（2026-10-26 实测踩到）
    const re = new RegExp(`\\n## \\[${dr.id}\\][\\s\\S]*?(?=\\n## \\[|$)`);
    const m = re.exec(next);
    if (m) archBlocks.push(m[0].replace(/^\n+/, '').trimEnd());
    next = next.replace(re, '');
  }
  const header = fs.existsSync(archFile)
    ? ''
    : `# 草稿归档 · ${day}\n\n> 由 tools/audit.mjs --fix 自动归档（超 ${DRAFT_DAYS} 天未处理）。原文保留，方便事后判断要不要升格。\n\n`;
  const body = `${header}## 归档 ${time}（${archBlocks.length} 条）\n\n${archBlocks.join('\n\n')}\n\n`;
  fs.appendFileSync(archFile, body, 'utf8');
  fs.writeFileSync(draftPath, next, 'utf8');
  console.log(`\n已归档 ${archBlocks.length} 条超期草稿 → ${path.relative(ROOT, archFile)}`);
  console.log('（原文没丢；看完不用的，删归档文件那条即可）');
}
