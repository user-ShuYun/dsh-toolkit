/**
 * learn.mjs —— 经验库：犯错/新体会 直接落盘，可检索、可计分、可蒸馏
 *
 *   node tools/learn.mjs add --tag 端口 --title "..." --symptom "..." --cause "..." --fix "..."
 *   node tools/learn.mjs search "关键词"        # 带 90 天半衰期排序
 *   node tools/learn.mjs hit L003               # 某条教训救了你一次，+1
 *   node tools/learn.mjs top 10                 # 命中次数最高的
 *   node tools/learn.mjs stats                  # 条数/体积/标签分布
 *   node tools/learn.mjs compact --dry-run      # 找重复，不删（人工确认）
 *
 * 数据文件：D:\deepseek\LESSONS.md（追加式，只增不删；蒸馏由 promote 完成）
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, statSync } from 'node:fs';

const FILE = 'D:/deepseek/LESSONS.md';
const PENDING = 'D:/deepseek/out/pending-lessons.md';
const HALF_LIFE = 90;

/** 读待拍板文件，切成块：{id, title, text}。编号用 P001… */
function readPending() {
  const raw = existsSync(PENDING) ? readFileSync(PENDING, 'utf8') : '';
  const parts = raw.split(/\n(?=## \[P\d+\])/);
  const blocks = parts.slice(1).map((text) => {
    const m = /^## \[(P\d+)\]\s*\S+\s*·\s*([^·]+?)\s*·\s*(.+)$/m.exec(text);
    return m ? { id: m[1], tag: m[2].trim(), title: m[3].trim(), text: text.trim() } : null;
  }).filter(Boolean);
  return { raw, blocks };
}

let argv = process.argv.slice(2);
let cmd = argv[0];
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (n) => argv.includes('--' + n);

/**
 * --json <文件>：从 JSON 读字段，替代命令行参数。
 * 为什么需要：PowerShell 传中文参数时，双引号、$、反斜杠会被吃掉 ——
 * 2026-10-26 实测把 L053/L054/L056/L057 的正文记成了半截。
 * JSON 文件由 write 工具写，不经 shell，内容原样保留。
 */
{
  const i = argv.indexOf('--json');
  // 允许 `learn.mjs --json f.json`（没有 add 子命令）：以前 i>0 才生效，这种写法会静默打印用法
  if (i >= 0 && argv[i + 1]) {
    try {
      const spec = JSON.parse(readFileSync(argv[i + 1], 'utf8').replace(/^\uFEFF/, ''));
      const keys = ['tag', 'title', 'symptom', 'cause', 'fix', 'evidence'];
      // 多行值要并成一行：写进 md 的格式是 `- 字段: 值`，续行没有前缀会让 load()/search 只读到第一行
      const flat = (v) => String(v).replace(/\r?\n+/g, ' ⏎ ').trim();
      argv = ['add', ...keys.flatMap((k) => (spec[k] == null ? [] : ['--' + k, flat(spec[k])]))];
      cmd = 'add';
    } catch (e) {
      console.error('--json 读不了：' + (e.message || e));
      process.exit(1);
    }
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function load() {
  if (!existsSync(FILE)) return { head: '', entries: [] };
  const raw = readFileSync(FILE, 'utf8');
  const parts = raw.split(/\n(?=## \[L\d+\])/);
  const head = parts[0];
  const entries = [];
  for (const block of parts.slice(1)) {
    const m = block.match(/^## \[(L\d+)\]\s*(\d{4}-\d{2}-\d{2})\s*·\s*([^\s·]+)\s*·\s*(.+)$/m);
    if (!m) continue;
    const body = block.slice(block.indexOf(m[0]) + m[0].length);
    const field = (name) => {
      const r = body.match(new RegExp('^- ' + name + '[:：]\\s*(.+)$', 'm'));
      return r ? r[1].trim() : '';
    };
    const hitM = body.match(/^- 命中[:：]\s*(\d+)/m);
    entries.push({
      id: m[1],
      date: m[2],
      tag: m[3],
      title: m[4].trim(),
      symptom: field('症状'),
      cause: field('原因'),
      fix: field('修法'),
      evidence: field('证据'),
      hits: hitM ? Number(hitM[1]) : 0,
      block: block.trim()
    });
  }
  return { head, entries };
}

function save({ head, entries }) {
  const out = head.trimEnd() + '\n\n' + entries.map((e) => e.block).join('\n\n') + '\n';
  writeFileSync(FILE, out, 'utf8');
}

const emptyHead = `# LESSONS · 经验库

> 追加式。**每次开工先看这里**（或 \`node tools/learn.mjs top 8\`）。
> 只增不删；蒸馏进 \`TOOLS.md\` 由 \`promote\` 完成。
>
> 格式：\`## [L001] 日期 · 标签 · 一句话\` + 症状/原因/修法/证据/命中
`;

function nowDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

if (cmd === 'add') {
  const tag = arg('tag', '通用');
  const title = arg('title', '');
  if (!title) {
    console.log('--title 必填。例：\n  node tools/learn.mjs add --tag 端口 --title "3100 重启清锁" --symptom "..." --cause "..." --fix "..."');
    process.exit(1);
  }
  const body = [
    `- 症状: ${arg('symptom', '—')}`,
    `- 原因: ${arg('cause', '—')}`,
    `- 修法: ${arg('fix', '—')}`,
    `- 证据: ${arg('evidence', '—')}`,
    `- 命中: 0`
  ].join('\n');

  /**
   * 默认**不直接进库**，先落待拍板（2026-10-26 用户定的闸门）：
   * 库越大，一条没用的经验就是以后每次检索多出的一条噪音，而"这条有没有用"只有用户知道。
   * 用户说"留 1 3"之后，才由 promote 升格成 L00x。
   * 想跳过闸门（例如用户已经当场点头）：加 --direct。
   */
  if (!has('direct')) {
    const pend = readPending();
    const maxP = pend.blocks.reduce((m, b) => Math.max(m, Number(b.id.slice(1))), 0);
    const pid = 'P' + String(maxP + 1).padStart(3, '0');
    const block = [
      `## [${pid}] ${nowDate()} · ${tag} · ${title}`,
      body
    ].join('\n');
    if (!existsSync(PENDING)) {
      writeFileSync(PENDING, '# 待拍板 · 经验候选\n\n> 由 learn.mjs add 自动追加；preflight 会列出它们。\n> 用户回「留 1 3」→ node tools/learn.mjs promote P001 P003；「删 2」→ drop P002。\n', 'utf8');
    }
    appendFileSync(PENDING, '\n' + block + '\n', 'utf8');
    console.log(`已进待拍板 ${pid} · ${title}（等用户点头；跳过闸门加 --direct）`);
    process.exit(0);
  }

  const { head, entries } = load();
  const maxId = entries.reduce((m, e) => Math.max(m, Number(e.id.slice(1))), 0);
  const id = 'L' + String(maxId + 1).padStart(3, '0');
  const block = [`## [${id}] ${nowDate()} · ${tag} · ${title}`, body].join('\n');
  const first = !existsSync(FILE);
  if (first) writeFileSync(FILE, emptyHead + '\n', 'utf8');
  appendFileSync(FILE, '\n' + block + '\n', 'utf8');
  console.log('已记录', id, '·', title);
  process.exit(0);
}

// ── 待拍板：列出 / 升格 / 丢弃 ──────────────────────────────────
if (cmd === 'pending') {
  const { blocks } = readPending();
  if (!blocks.length) { console.log('待拍板：0 条 ✅'); process.exit(0); }
  console.log(`待拍板 ${blocks.length} 条（回「留 1 3」我执行 promote；「删 2」执行 drop）：\n`);
  blocks.forEach((b, i) => {
    const ev = /- 证据[:：]\s*(.+)/.exec(b.text)?.[1] || '';
    console.log(`  ${i + 1}. ${b.id} ${b.title}`);
    if (ev) console.log(`     证据: ${ev.slice(0, 100)}`);
  });
  process.exit(0);
}

if (cmd === 'promote' || cmd === 'drop') {
  const want = argv.slice(1).filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase());
  const pend = readPending();
  if (!pend.blocks.length) { console.log('待拍板是空的'); process.exit(0); }
  const pick = argv.includes('--all') ? pend.blocks.map((b) => b.id) : want;
  if (!pick.length) { console.log('用法: learn.mjs promote P001 P003 ｜ drop P002 ｜ promote --all'); process.exit(1); }

  const keep = [];
  const moved = [];
  for (const b of pend.blocks) {
    if (!pick.includes(b.id)) { keep.push(b.text); continue; }
    if (cmd === 'drop') continue;
    const { head, entries } = load();
    const maxId = entries.reduce((m, e) => Math.max(m, Number(e.id.slice(1))), 0);
    const lid = 'L' + String(maxId + 1).padStart(3, '0');
    // 把 P 头改成 L 头（日期换成今天，标签/标题保留）
    const block = b.text.replace(/^## \[P\d+\] \S+/, `## [${lid}] ${nowDate()}`);
    appendFileSync(FILE, '\n' + block.trim() + '\n', 'utf8');
    moved.push(`${b.id}→${lid}`);
  }
  const headText = pend.raw.slice(0, pend.raw.indexOf('## ['));
  writeFileSync(PENDING, headText + keep.join('\n\n') + (keep.length ? '\n' : ''), 'utf8');
  console.log(cmd === 'drop' ? `已丢弃 ${pick.length} 条` : `已升格 ${moved.length} 条：${moved.join(' ')}`);
  console.log(`待拍板剩 ${keep.length} 条`);
  process.exit(0);
}

if (cmd === 'search') {
  const q = argv[1] || '';
  const { entries } = load();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const now = Date.now();
  const rows = entries
    .map((e) => {
      const text = (e.title + ' ' + e.tag + ' ' + e.symptom + ' ' + e.cause + ' ' + e.fix).toLowerCase();
      const hits = terms.reduce((n, t) => n + (text.match(new RegExp(escapeRe(t), 'g')) || []).length, 0);
      if (!hits) return null;
      const age = (now - new Date(e.date).getTime()) / 86400000;
      const decay = Math.pow(0.5, age / HALF_LIFE);
      return { ...e, score: +((hits + e.hits * 2) * decay).toFixed(2), decay: +decay.toFixed(2), hitsCount: hits };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!rows.length) {
    console.log('没命中:', q);
    process.exit(0);
  }
  for (const r of rows.slice(0, 8)) {
    console.log(`  ${String(r.score).padStart(5)}  ${r.id} [${r.tag}] ${r.title}`);
    if (r.symptom !== '—') console.log(`        症状: ${r.symptom}`);
    if (r.fix !== '—') console.log(`        修法: ${r.fix}`);
  }
  process.exit(0);
}

if (cmd === 'hit') {
  const id = (argv[1] || '').toUpperCase();
  const data = load();
  const e = data.entries.find((x) => x.id === id);
  if (!e) {
    console.log('没有', id);
    process.exit(0);
  }
  e.hits += 1;
  e.block = e.block.replace(/^- 命中[:：]\s*\d+/m, `- 命中: ${e.hits}`);
  save(data);
  console.log(id, '命中数 →', e.hits);
  process.exit(0);
}

if (cmd === 'top') {
  const n = Number(argv[1] || 8);
  const { entries } = load();
  const rows = [...entries].sort((a, b) => b.hits - a.hits || b.date.localeCompare(a.date)).slice(0, n);
  console.log(`最有价值的 ${rows.length} 条（按"救过几次"排）：\n`);
  for (const r of rows) console.log(`  ${String(r.hits).padStart(2)}× ${r.id} [${r.tag}] ${r.title}`);
  process.exit(0);
}

if (cmd === 'stats') {
  const { entries } = load();
  const size = existsSync(FILE) ? statSync(FILE).size : 0;
  const tags = {};
  for (const e of entries) tags[e.tag] = (tags[e.tag] || 0) + 1;
  console.log('条数:', entries.length, '| 体积:', (size / 1024).toFixed(1), 'KB | 行数约:', Math.round(size / 60));
  console.log('标签:', Object.entries(tags).map(([k, v]) => `${k}(${v})`).join(' · '));
  const top = [...entries].sort((a, b) => b.hits - a.hits).slice(0, 3);
  if (top.length) console.log('最高命中:', top.map((e) => `${e.id}=${e.hits}×`).join(' '));
  if (size > 80 * 1024) console.log('\n⚠ 超过 80 KB，建议跑 promote：把高命中的条目搬进 TOOLS.md，然后从本文件归档');
  process.exit(0);
}

if (cmd === 'compact') {
  const { entries } = load();
  const seen = new Map();
  const dups = [];
  for (const e of entries) {
    const key = e.tag + '|' + e.title.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) dups.push([seen.get(key), e.id]);
    else seen.set(key, e.id);
  }
  console.log('疑似重复:', dups.length ? dups.map((d) => d.join(' ↔ ')).join(', ') : '无');
  console.log(has('dry-run') ? '（dry-run，未改动）' : '本命令不自动删改，请人工确认后用 promote 处理');
  process.exit(0);
}

console.log(`用法:
  node tools/learn.mjs add --tag 端口 --title "一句话" --symptom "..." --cause "..." --fix "..." 
  node tools/learn.mjs search "关键词"
  node tools/learn.mjs hit L003
  node tools/learn.mjs top 8
  node tools/learn.mjs stats
  node tools/learn.mjs compact --dry-run`);
