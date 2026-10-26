/**
 * maintain.mjs —— 每日自动维护（给 Windows 计划任务用，不需要 DSH 开着）。
 *
 * 五件事，前四件是机械动作，不做判断：
 *   ① 经验库体检（调 audit.mjs）
 *   ② 超期草稿**归档**（audit.mjs --fix → notes/日志/草稿归档/，不删原文）
 *   ③ 重建会话索引 + 回合台账（sessions.mjs index / ledger.mjs build）
 *   ④ 重新生成 AGENTS.md 里的「最值钱的几条」（调 brief.mjs --write）
 *   ⑤ 汇总日报 notes/日志/日报/YYYY-MM-DD.md：断档天数 + 待提炼回合 + 失败清单
 *
 * 判断留给人/Agent：日报里会列出「需要决定的事」，下次开工读它。
 *
 * 2026-10-26 改（用户问「长期不开 DSH 会不会有影响」之后）：
 *   - ③ 让索引和台账跟着计划任务走，回来时材料是现成的，不用从零捡
 *   - ⑤ 顶部标「距上次收工 N 天」；流水为 0 时明说「没有流水 ≠ 一切正常」
 *   - ② 归档替代删除：没人看的时候也不许让坑蒸发
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

/**
 * 日志由 node 自己写（--log 路径），不让 PowerShell 转发我的输出。
 * 2026-10-26 实测：任务计划里跑的 powershell.exe 没有控制台，[Console]::OutputEncoding
 * 设置不生效，node 的 UTF-8 输出会被当 GBK 解码 → 日志里中文全乱码。绕开它。
 */
const LOG_PATH = (() => {
  const i = process.argv.indexOf('--log');
  return i > 0 ? process.argv[i + 1] : '';
})();
if (LOG_PATH) {
  const raw = console.log.bind(console);
  console.log = (...a) => {
    raw(...a);
    try {
      fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      fs.appendFileSync(LOG_PATH, a.map((x) => (typeof x === 'string' ? x : String(x))).join(' ') + '\n', 'utf8');
    } catch { /* 日志失败不影响维护 */ }
  };
}

const run = (args) => {
  const r = spawnSync(NODE, args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
};

const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

/** 距上次收工多少天：现在.md 是收工时写的，它的 mtime 就是"上次工作"的时间戳 */
const nowMd = path.join(ROOT, 'notes', '现在.md');
const gapDays = fs.existsSync(nowMd)
  ? Math.max(0, Math.floor((Date.now() - fs.statSync(nowMd).mtimeMs) / 86400000))
  : null;

console.log('=== 每日维护 ' + today + ' ===');
console.log(gapDays == null ? '断档：还没有 notes/现在.md' : `断档：距上次收工 ${gapDays} 天`);

// 顺序讲究：先归档再体检，日报里的体检结论才不会说"该归档"而实际已经归档了（2026-10-26 复核 #7）
const stepFails = [];
const step = (name, args) => {
  if (DRY) return { out: '（--dry 跳过）' };
  const r = run(args);
  if (!r.ok) stepFails.push(name);
  return r;
};

// ① 归档超期草稿
const cleanup = step('草稿归档', [path.join(ROOT, 'tools', 'audit.mjs'), '--fix']);
console.log('\n[1/5] 草稿归档\n' + (cleanup.out.split('\n').filter((l) => l.includes('草稿') || l.includes('归档') || l.includes('没有')).join('\n') || '（无变化）'));

// ② 体检（在归档之后跑，结论才是当前的）
const audit = step('体检', [path.join(ROOT, 'tools', 'audit.mjs')]);
console.log('\n[2/5] 体检\n' + audit.out);

// ③ 索引 + 台账（都是纯离线，不需要 DSH 开着）
const index = step('会话索引', [path.join(ROOT, 'tools', 'sessions.mjs'), 'index']);
console.log('\n[3/5] 会话索引\n' + (index.out.split('\n').pop() || ''));
const ledger = step('回合台账', [path.join(ROOT, 'tools', 'ledger.mjs')]);
console.log('\n[3/5] 回合台账\n' + ledger.out.split('\n').slice(0, 2).join('\n'));
const pendingM = /待提炼：(\d+)/.exec(ledger.out);
const pending = pendingM ? Number(pendingM[1]) : null;

// ④ 更新简报
const brief = step('简报', [path.join(ROOT, 'tools', 'brief.mjs'), '--write']);
console.log('\n[4/5] 更新简报\n' + brief.out.split('\n').slice(-3).join('\n'));

// ⑤ 汇总日报
const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-7)
  : [];
let okN = 0, badN = 0;          // 最近 7 天累计
let todayOk = 0, todayBad = 0;  // 只看今天——"今天有没有干活"必须用当天的数
const bad = [];
const badToday = [];
const byKind = {};
for (const f of files) {
  const isToday = f === `${today}.md`;
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const line of text.split('\n')) {
    if (line.includes('✅')) {
      okN++;
      if (isToday) todayOk++;
      const k = /\[(.+?)\]/.exec(line)?.[1] || 'task';
      byKind[k] = (byKind[k] || 0) + 1;
    } else if (line.includes('❌')) {
      badN++;
      const clean = line.replace(/^- \d{2}:\d{2}:\d{2} /, '');
      bad.push(clean);
      if (isToday) { todayBad++; badToday.push(clean); }
    }
  }
}

const emptyFlow = todayOk + todayBad === 0;
const gapLine = gapDays == null
  ? '断档：还没有 notes/现在.md（没写过收工记录）'
  : gapDays === 0
    ? '断档：今天有记录'
    : `⚠️ 断档：距上次收工 **${gapDays} 天**（这段时间的判断/复盘没人做，见下文）`;

const report = [
  `# 日报 ${today}`,
  '',
  gapLine,
  '',
  `> 由 tools/maintain.mjs 自动生成。数字分两栏：**今天**（当天的流水）和**最近 ${files.length} 天累计**。`,
  '',
  '## 概览',
  '',
  emptyFlow
    ? `- **今天没有流水，不代表一切正常** — 流水只有 \`comfy.mjs\` / \`shortdrama.mjs\` 会写；没开 DSH、或者只做了对话类工作时，今天这一栏天然是空的。最近 ${files.length} 天累计：成功 ${okN} / 失败 ${badN}。`
    : `- 今天：成功 ${todayOk} 次 / 失败 ${todayBad} 次`,
  emptyFlow ? '' : `- 最近 ${files.length} 天累计：成功 ${okN} 次 / 失败 ${badN} 次`,
  !emptyFlow && Object.keys(byKind).length ? `- 按类型：${Object.entries(byKind).map(([k, v]) => `${k}(${v})`).join(' · ')}` : '',
  `- 台账：${pending == null ? '没跑到' : pending + ' 个回合待提炼'}${pending ? '（`node tools/ledger.mjs distill`）' : ''}`,
  '',
  '## 失败清单（要决定：升格成经验，还是忽略）',
  '',
  emptyFlow ? '（没有流水，所以没有失败记录 —— 这不等于没出错）' : bad.length ? bad.map((b) => '- ' + b).join('\n') : '（没有失败记录）',
  '',
  '## 体检结论',
  '',
  '```',
  audit.out.split('\n').slice(-8).join('\n'),
  '```',
  '',
  '## 明天开工先看',
  '',
  '- [ ] `node tools/preflight.mjs`（会带出台账待提炼数）',
  pending ? `- [ ] 有 ${pending} 个回合没提炼：\`node tools/ledger.mjs distill\`` : '- [ ] 台账已清空',
  '- [ ] 上面失败清单里，有没有该写进 `LESSONS.md` 的',
  '- [ ] `node tools/reflect.mjs --drafts` 有没有待确认草稿（超期会被归档到 `notes/日志/草稿归档/`）',
  ''
].join('\n');

fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, `${today}.md`);
if (!DRY) {
  const prev = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (prev !== report) fs.writeFileSync(outFile, report, 'utf8');
}
console.log(`\n[5/5] 日报 → ${DRY ? '（--dry 未写）' : outFile}`);
console.log(`\n今天 成功 ${todayOk} / 失败 ${todayBad}${emptyFlow ? '（今日无流水）' : ''} · 最近 ${files.length} 天 成功 ${okN} / 失败 ${badN} · 待提炼 ${pending ?? '?'}`);

// 子步骤失败要让计划任务看得见（2026-10-26 复核 #6：以前永远 exit 0，失败只埋在日志正文里）
if (stepFails.length) {
  console.log(`\n⚠️ 有 ${stepFails.length} 步失败：${stepFails.join(' / ')} —— 详情看日志，退出码置 1`);
  process.exitCode = 1;
}
