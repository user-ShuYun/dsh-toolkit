/**
 * reflect.mjs —— 会话收尾的「自我复盘」助手。
 *
 * 它不做判断（判断是模型的事），它只负责把复盘需要的材料一次摆齐：
 *   1. 这次会话动了哪些文件（按修改时间）
 *   2. 经验库现在的规模 / 标签分布 / 有没有该压缩
 *   3. 有没有重复条目、有没有 90 天没被命中的陈货
 *   4. 打一张固定的自检清单（照着一问一答，再决定写不写经验）
 *
 * 用法:
 *   node tools/reflect.mjs                 # 最近 8 小时
 *   node tools/reflect.mjs --hours 24
 *   node tools/reflect.mjs --json          # 只输出机器可读的结果
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listDrafts } from 'file:///D:/deepseek/tools/lesson-draft.mjs';

const ROOT = 'D:\\deepseek';
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const HOURS = Number(flag('hours', 8));
const JSON_OUT = !!flag('json', false);
const SKIP = /(node_modules|edge-cgpt|\.npm|\.git|__pycache__|_parts_|comfy-stdout|comfy-stderr)/i;

function walk(dir, out = [], depth = 0) {
  if (depth > 2) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out, depth + 1);
    else {
      try {
        const st = fs.statSync(p);
        out.push({ path: p, mtime: st.mtimeMs, size: st.size });
      } catch {}
    }
  }
  return out;
}

const cutoff = Date.now() - HOURS * 3600 * 1000;
const recent = walk(ROOT)
  .filter((f) => f.mtime >= cutoff)
  .sort((a, b) => b.mtime - a.mtime);

const lessonsPath = path.join(ROOT, 'LESSONS.md');
const toolsPath = path.join(ROOT, 'TOOLS.md');
const lessonsSize = fs.existsSync(lessonsPath) ? fs.statSync(lessonsPath).size : 0;
const toolsSize = fs.existsSync(toolsPath) ? fs.statSync(toolsPath).size : 0;
const lessonsText = fs.existsSync(lessonsPath) ? fs.readFileSync(lessonsPath, 'utf8') : '';
const entries = [...lessonsText.matchAll(/^## \[(L\d+)\] (.+)$/gm)].map((m) => ({
  id: m[1],
  title: String(m[2]).split(' · ').pop().trim()
}));
const tags = {};
for (const m of lessonsText.matchAll(/^## \[L\d+\] .*?· (.+?) · /gm)) tags[m[1]] = (tags[m[1]] || 0) + 1;

// 粗查重复：标题里去掉标点后，前 8 个字相同即疑似
const norm = (s) => s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
const dupes = [];
for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    const a = norm(entries[i].title).slice(0, 8);
    const b = norm(entries[j].title).slice(0, 8);
    if (a && a === b) dupes.push([entries[i].id, entries[j].id]);
  }
}

// 命中最少的条目（可能是没人用的陈货）
const hits = [...lessonsText.matchAll(/^## \[(L\d+)\][\s\S]*?- 命中: (\d+)/gm)].map((m) => ({ id: m[1], hit: Number(m[2]) }));
const cold = hits.filter((h) => h.hit === 0).map((h) => h.id);

const result = {
  windowHours: HOURS,
  changedFiles: recent.slice(0, 40).map((f) => ({
    path: path.relative(ROOT, f.path),
    minutesAgo: Math.round((Date.now() - f.mtime) / 60000),
    kb: Math.round(f.size / 1024)
  })),
  changedCount: recent.length,
  lessons: { count: entries.length, kb: Math.round(lessonsSize / 1024), warn: lessonsSize > 80 * 1024 || entries.length > 60 },
  tools: { kb: Math.round(toolsSize / 1024), warn: toolsSize > 60 * 1024 },
  tags,
  duplicates: dupes,
  coldEntries: cold.slice(0, 12)
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const drafts = listDrafts();
if (flag('index', false)) {
  // 只出目录（约 1.5 KB），给「想对全库有个底」的场景用，避免把 16 KB 正文全读进上下文
  console.log(`经验库目录：${entries.length} 条\n`);
  for (const m of lessonsText.matchAll(/^## \[(L\d+)\] (.+)$/gm)) {
    console.log(`${m[1]}  ${String(m[2]).replace(/\d{4}-\d{2}-\d{2} · /, '')}`);
  }
  process.exit(0);
}
if (flag('drafts', false)) {
  if (!drafts.length) console.log('没有待确认的草稿 ✅');
  else for (const d of drafts) console.log(`${d.id}  ${d.time}  [${d.tool}] ${d.symptom}`);
  process.exit(0);
}

console.log(`\n=== 复盘材料（最近 ${HOURS} 小时）===\n`);
console.log(`改动文件：${recent.length} 个`);
for (const f of result.changedFiles.slice(0, 20)) {
  console.log(`  ${String(f.minutesAgo).padStart(5)} 分钟前  ${String(f.kb).padStart(5)} KB  ${f.path}`);
}
if (recent.length > 20) console.log(`  … 还有 ${recent.length - 20} 个`);

console.log(`\n经验库：${entries.length} 条 / ${result.lessons.kb} KB ${result.lessons.warn ? '⚠️ 超过阈值，该压缩' : ''}`);
console.log(`工具书：${result.tools.kb} KB ${result.tools.warn ? '⚠️ 太长了，该往外拆' : ''}`);
console.log(`标签：${Object.entries(tags).map(([k, v]) => k + '(' + v + ')').join(' · ')}`);
if (dupes.length) console.log(`\n⚠️ 疑似重复：${dupes.map((d) => d.join(' ≈ ')).join('，')}`);
if (cold.length) console.log(`\n🧊 从没被命中过（可能是陈货）：${cold.slice(0, 12).join(', ')}`);
if (drafts.length) {
  console.log(`\n📝 待确认草稿 ${drafts.length} 条（工具自动记的，等你升格或删除）：`);
  for (const d of drafts.slice(0, 10)) console.log(`   ${d.id}  [${d.tool}] ${String(d.symptom).slice(0, 80)}`);
  console.log('   升格：node tools/learn.mjs add ...   查看：node tools/reflect.mjs --drafts');
} else {
  console.log('\n📝 待确认草稿：0 条 ✅');
}

console.log(`
=== 自检清单（逐条回答，再决定写不写）===
1. 这次有没有「查了才知道」的命令/报错？→ 记 L####（症状/原因/修法/证据）
2. 有没有哪个做法被证伪（我原本以为 X，其实 Y）？→ 记一条，标题写清「不是 X」
3. 有没有新的数字可以复用（耗时/体积/比例/参数）？→ 记一条，写进证据
4. 流程有没有变（新增脚本、改了默认参数）？→ 改 TOOLS.md 对应章节，而不是只记日志
5. 同一条经验是否第 3 次出现？→ 蒸馏进 TOOLS.md，日志留原文
6. 有没有「我以为做了、其实没验证」的结论？→ 标成未验证，或删掉

写完经验后跑一次：
  node tools/learn.mjs stats
  node tools/notes.mjs index      # 如果动过 notes/
`);
