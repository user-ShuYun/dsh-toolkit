/**
 * maintain.mjs —— 每日自动维护（给 Windows 计划任务用，不需要 DSH 开着）。
 *
 * 做四件事，全是机械动作，不做判断：
 *   ① 经验库体检（调 audit.mjs）
 *   ② 清掉超期草稿（>7 天）
 *   ③ 重新生成 AGENTS.md 里的「最值钱的几条」（调 brief.mjs --write）
 *   ④ 把最近 7 天流水汇总成一份日报 notes/日志/日报/YYYY-MM-DD.md
 *
 * 判断留给人/Agent：日报里会列出「需要决定的事」，第二天开工读它。
 *
 * 用法: node tools/maintain.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = 'D:\\deepseek';
const NODE = process.execPath;
const DRY = process.argv.includes('--dry');
const DIR = path.join(ROOT, 'notes', '日志');
const OUT = path.join(DIR, '日报');

const run = (args) => {
  const r = spawnSync(NODE, args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
};

const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

console.log('=== 每日维护 ' + today + ' ===');

// ① 体检
const audit = run([path.join(ROOT, 'tools', 'audit.mjs')]);
console.log('\n[1/4] 体检\n' + audit.out);

// ② 清超期草稿
const cleanup = DRY ? { out: '（--dry 跳过）' } : run([path.join(ROOT, 'tools', 'audit.mjs'), '--fix']);
console.log('\n[2/4] 清草稿\n' + cleanup.out.split('\n').filter((l) => l.includes('草稿') || l.includes('没有')).join('\n'));

// ③ 更新简报
const brief = DRY ? { out: '（--dry 跳过）' } : run([path.join(ROOT, 'tools', 'brief.mjs'), '--write']);
console.log('\n[3/4] 更新简报\n' + brief.out.split('\n').slice(-3).join('\n'));

// ④ 汇总日报
const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-7)
  : [];
let okN = 0, badN = 0;
const bad = [];
const byKind = {};
for (const f of files) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const line of text.split('\n')) {
    if (line.includes('✅')) {
      okN++;
      const k = /\[(.+?)\]/.exec(line)?.[1] || 'task';
      byKind[k] = (byKind[k] || 0) + 1;
    } else if (line.includes('❌')) {
      badN++;
      bad.push(line.replace(/^- \d{2}:\d{2}:\d{2} /, ''));
    }
  }
}

const report = [
  `# 日报 ${today}`,
  '',
  `> 由 tools/maintain.mjs 自动生成，覆盖最近 ${files.length} 天的流水。`,
  '',
  `## 概览`,
  '',
  `- 成功 ${okN} 次 / 失败 ${badN} 次`,
  `- 按类型：${Object.entries(byKind).map(([k, v]) => `${k}(${v})`).join(' · ') || '—'}`,
  '',
  '## 失败清单（要决定：升格成经验，还是忽略）',
  '',
  bad.length ? bad.map((b) => '- ' + b).join('\n') : '（没有失败记录）',
  '',
  '## 体检结论',
  '',
  '```',
  audit.out.split('\n').slice(-8).join('\n'),
  '```',
  '',
  '## 明天开工先看',
  '',
  '- [ ] `node tools/preflight.mjs`',
  '- [ ] 上面失败清单里，有没有该写进 `LESSONS.md` 的',
  '- [ ] `node tools/reflect.mjs --drafts` 有没有待确认草稿',
  ''
].join('\n');

fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, `${today}.md`);
if (!DRY) fs.writeFileSync(outFile, report, 'utf8');
console.log(`\n[4/4] 日报 → ${DRY ? '（--dry 未写）' : outFile}`);
console.log(`\n成功 ${okN} · 失败 ${badN} · 覆盖 ${files.length} 天`);
