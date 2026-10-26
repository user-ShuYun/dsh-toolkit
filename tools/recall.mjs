/**
 * recall.mjs —— 事件驱动召回：在"会出事的那一刻"自动去查记忆，而不是等我想起来。
 *
 * 为什么不是 preflight 的附属功能：2026-10-25 我在改插件前，库里早有 L015
 * 「改完插件要重装并重启 DSH 才生效」，但没人提醒，我花了 20 分钟重新推导一遍。
 * 所以召回必须挂在**事件点**上。
 *
 * 2026-10-26 大改：原来只有 edit / error 两种事件，靠"路径里的词"去撞关键词；
 * 但真正会翻车的场合是**动作类型** —— 改 7 个文件、装卸插件、对外发布、跑长流水线，
 * 这些场合需要的经验，字面上和任务描述往往一个词都不重合（L009 就这么漏了）。
 * 现在加了动作类型事件，并支持在**计划阶段**一句话识别出今天要做哪些类型。
 *
 * 用法:
 *   node tools/recall.mjs --event plan --text "改 7 个文件、装个插件、然后把仓库开源"
 *   node tools/recall.mjs --event install                    # 装卸插件前
 *   node tools/recall.mjs --event longflow                   # 多步流水线开工前
 *   node tools/recall.mjs --event multifile --n 7            # 一次改多个文件前
 *   node tools/recall.mjs --event publish                    # 开源/推送前
 *   node tools/recall.mjs --event research                   # 查资料前
 *   node tools/recall.mjs --event ps                         # 写 PowerShell 脚本前
 *   node tools/recall.mjs --event edit  --file tools/foo.mjs # 改具体文件前
 *   node tools/recall.mjs --event error --text "报错原文"
 *   node tools/recall.mjs "自由文本"                          # 等价于 start
 *
 * 输出：按动作类型分组的固定经验（不靠检索，靠"这个动作本身就有坑"）+ 关键词召回 + 建议动作。
 * 安静、可解析（--json）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = 'D:\\deepseek';
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const JSON_OUT = argv.includes('--json');
const event = arg('event', 'start');
const file = arg('file', '');
const text = arg('text', '');
const nFiles = Number(arg('n', 0)) || 0;
const task = arg('task', '') || argv.filter((a) => !a.startsWith('--') && a !== event).join(' ');

// ── 读四库：动作类型直接按 ID 取，不靠相似度 ──────────────────────
const FILES = [['LESSONS.md', 'L'], ['CORRECTIONS.md', 'C'], ['PREFERENCES.md', 'P'], ['PLAYBOOKS.md', 'B']];

function loadIndex() {
  const map = new Map();
  for (const [f, prefix] of FILES) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, 'utf8');
    for (const block of raw.split(new RegExp(`\\n(?=## \\[${prefix}\\d+\\])`))) {
      const head = new RegExp(`^## \\[(${prefix}\\d+)\\]\\s*(\\S+)\\s*·\\s*(.+)$`, 'm').exec(block);
      if (!head) continue;
      const field = (name) => new RegExp(`^- ${name}[:：]\\s*(.+)$`, 'm').exec(block)?.[1]?.trim() || '';
      const actionable = field('修法') || field('对做法') || field('偏好') || field('步骤') || field('规程') || '';
      map.set(head[1], {
        id: head[1],
        date: head[2],
        title: head[3].trim(),
        action: actionable,
        hit: Number(/- 命中[:：]\s*(\d+)/.exec(block)?.[1] || 0)
      });
    }
  }
  return map;
}
const IDX = loadIndex();

/**
 * 动作类型 → 必须看一眼的条目。宁少不滥：这里每一条都是"不知道就会返工"的。
 * 写新条目时顺手加进来，比指望关键词召回可靠得多。
 */
const ACTIONS = {
  install: {
    label: '装卸插件 / 改 patch',
    ids: ['L015', 'L051', 'L052', 'L050', 'L041'],
    hint: '装卸一律在回合之间做；加插件安全、删插件会打断当轮（L051）。装之前先备份 patch。'
  },
  longflow: {
    label: '长流水线 / 多步任务',
    ids: ['L009', 'L057', 'L037'],
    hint: '先判断该不该派子代理（≥3 份长文档、≥3 遍重复、要独立视角 → 派）；连续改文件时注意每步都要重新 read。'
  },
  multifile: {
    label: '一次改多个文件',
    ids: ['L009', 'L057', 'L058'],
    hint: '3 个以上文件就别串行硬扛；被脚本改过的文件在编辑前要重新 read；截断输出会让成功命令带 exit=1。'
  },
  publish: {
    label: '对外发布 / 推送',
    ids: ['L040', 'L042', 'L043', 'L002'],
    hint: '推送前扫绝对路径/secrets/大文件；改可见性或删东西必须先问（AGENTS.md 七）。'
  },
  research: {
    label: '查资料 / 调研',
    ids: ['L034', 'L032', 'L039'],
    hint: '先 channels 自检再按渠道打；harvest 只给标题，结论必须二次核验；别只用内置 web 搜索（C001）。'
  },
  ps: {
    label: '写 PowerShell / ps1',
    ids: ['L059', 'L058', 'L036'],
    hint: 'PS 5.1：utf8 带 BOM、无 utf8NoBOM、无 ??；先用 [Text.UTF8Encoding]::new($false) 再写文件。'
  },
  ledger: {
    label: '动台账 / 会话解析',
    ids: ['L048', 'L055'],
    hint: '会话日志是多帧 zstd，要逐帧解压；事件要按 seq 排序，答案只取 content 里 type=text 的部分。'
  }
};

/** 从一句话里识别"今天要做哪些动作"（计划阶段用） */
function detectActions(t) {
  const s = String(t || '');
  const found = new Set();
  if (/插件|plugin|patch|cordis/i.test(s)) found.add('install');
  if (/开源|发布|推送|push|release|上线/i.test(s)) found.add('publish');
  if (/查(一下|查)|调研|检索|搜一下|看看别人/i.test(s)) found.add('research');
  if (/\.ps1|powershell|pwsh/i.test(s)) found.add('ps');
  if (/台账|ledger|会话日志|会话索引/i.test(s)) found.add('ledger');
  if (/流水线|多步|端到端|成片|pipeline|一整套/i.test(s)) found.add('longflow');
  const m = s.match(/(\d+)\s*个?\s*(文件|工具|脚本|模块)/);
  if (m && Number(m[1]) >= 3) found.add('multifile');
  if (/批量|多文件|好几个文件|一堆文件/i.test(s)) found.add('multifile');
  if (found.size >= 2) found.add('longflow');
  return [...found];
}

// ── 自由文本召回（关键词那条路，保留）────────────────────────────
function buildQuery() {
  if (event === 'edit' && file) {
    const rel = file.replace(ROOT + '\\', '');
    const parts = rel.split(/[\\/]/).filter(Boolean);
    const base = parts.pop() || '';
    const dir = parts.pop() || '';
    return `${base} ${dir}`.replace(/\.(mjs|js|json|md|ps1)$/, '');
  }
  if (event === 'error') return text.slice(0, 200);
  return task || text;
}

const targets = new Set();
if (event === 'plan') {
  for (const a of detectActions(text || task)) targets.add(a);
} else if (ACTIONS[event]) {
  targets.add(event);
}

const query = event === 'plan' ? (text || task) : buildQuery();

let memoRows = [];
if (query && query.trim()) {
  try {
    const { stdout } = await exec(process.execPath, ['tools/memo.mjs', 'recall', query, '--limit', '3'], { cwd: ROOT, timeout: 20000 });
    memoRows = stdout.trim().split('\n').filter((l) => /^  [LCPB]\d{3}/.test(l));
  } catch { /* 召回失败不能挡住主流程 */ }
}

// ── 事件专属硬提示 ────────────────────────────────────────────────
const hints = [];
const groups = [];
for (const t of targets) {
  const def = ACTIONS[t];
  if (!def) continue;
  const items = def.ids.map((id) => IDX.get(id)).filter(Boolean);
  groups.push({ type: t, label: def.label, items, hint: def.hint });
  if (def.hint) hints.push(def.hint);
}

if (event === 'edit') {
  const rel = file.replace(ROOT + '\\', '');
  if (/\.(mjs|js)$/.test(file)) hints.push('改完插件/脚本：确认是否需要重启进程才生效（L015），并核对文件 mtime 是否晚于进程启动时间');
  if (/^tools[\\/]/.test(rel)) hints.push('改 tools/ 下的工具：先 node --check 或跑一次最小用例，别只看语法');
  if (/cordis\.patch\.yml/.test(rel)) hints.push('改 patch：只在回合之间做，改完看插件自己的日志确认挂载/卸载（L051）');
} else if (event === 'error') {
  hints.push('报错先看原文，不要凭印象改；出现 "not a git repository" / "HTTP 4xx" / "Cannot find" 时先确认前置条件');
} else if (event === 'start') {
  hints.push('开工先 preflight；研究类任务先 channels 自检，别默认只用 web 搜索（C001）');
} else if (event === 'multifile' && nFiles) {
  hints.unshift(`这次要动 ${nFiles} 个文件：${nFiles >= 3 ? '按 AGENTS.md 准则 4 判断该不该派子代理' : '可以自己扛'}`);
} else if (event === 'plan' && !targets.size) {
  hints.push('没识别出动作类型 —— 把要做的事写具体点（"改 7 个文件 / 装插件 / 开源"），或直接 --event <类型>');
}

const payload = {
  event,
  query: query.slice(0, 120),
  detected: [...targets],
  groups: groups.map((g) => ({ type: g.type, label: g.label, items: g.items.map((i) => `${i.id} ${i.title}`) })),
  keywordHits: memoRows.map((s) => s.trim()),
  hints
};

if (JSON_OUT) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

if (!groups.length && !memoRows.length && !hints.length) {
  console.log(`（${event}: 没有相关记忆）`);
  process.exit(0);
}

console.log(`\n[${event}] ${query ? query.slice(0, 80) : ''}${targets.size ? `  → 识别到动作：${[...targets].join(' / ')}` : ''}`);
for (const g of groups) {
  console.log(`\n【${g.label}】`);
  for (const it of g.items) {
    console.log(`  ${it.id} ${it.title}`);
    if (it.action) console.log(`       → ${it.action.slice(0, 130)}`);
  }
}
if (memoRows.length) {
  console.log('\n关键词也撞到几条:');
  for (const r of memoRows) console.log(r);
}
if (hints.length) {
  console.log('\n按规矩先确认:');
  for (const h of [...new Set(hints)]) console.log('  · ' + h);
}
console.log('');
