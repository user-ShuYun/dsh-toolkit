/**
 * sessions.mjs —— 把历史会话变成可查的索引（不用 DSH 插件，纯本地解析）。
 *
 * 为什么要它：会话文件是「多帧拼接的 zstd」，Node 的 zstdDecompressSync 只解第一帧
 * （只拿到 267 字节的 session 头），所以过去只能靠人工回忆"上次做到哪、哪条经验用过"。
 *
 * 做法：扫帧头 → 逐帧解压 → 拼成 JSONL → 只保留**索引需要**的字段（不存全文）。
 *
 * 用法:
 *   node tools/sessions.mjs index            # 建/更新索引（增量，按 mtime+size）
 *   node tools/sessions.mjs recent [n]       # 最近 n 个会话：首条提问 + 最后一句回复
 *   node tools/sessions.mjs hits             # 统计哪个 L0xx 被真实引用过（未记账的给建议）
 *   node tools/sessions.mjs search "关键词" [--limit 5]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = 'D:\\deepseek';
const SES = path.join(process.env.USERPROFILE, '.dsh', 'sessions');
const CACHE = path.join(ROOT, 'out', 'sessions', 'index.json');
const MAX_BYTES = 30 * 1024 * 1024;
const MAGIC = Buffer.from('28b52ffd', 'hex');

const argv = process.argv.slice(2);
const cmd = argv[0] || 'index';
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};

function listFiles(dir = SES, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (e.name.endsWith('.zstd')) out.push(p);
  }
  return out;
}

/** 多帧解压：逐帧头解压再拼接（单次调用只拿得到第一帧） */
function readSession(file) {
  const buf = fs.readFileSync(file);
  const pos = [];
  for (let i = 0; (i = buf.indexOf(MAGIC, i)) >= 0; i += 4) pos.push(i);
  let text = '';
  for (const p of pos) {
    try { text += zlib.zstdDecompressSync(buf.subarray(p)).toString('utf8'); } catch { /* 假帧头 */ }
  }
  return text;
}

function textOf(ev) {
  const c = ev?.data?.message?.content ?? ev?.data?.content;
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ');
  return '';
}

/** 库里真实存在的 ID —— 只认这些，避免把 L784 / C600 这种随机串当真 */
function knownIds() {
  const ids = new Set();
  for (const [file, p] of [['LESSONS.md', 'L'], ['CORRECTIONS.md', 'C'], ['PREFERENCES.md', 'P'], ['PLAYBOOKS.md', 'B']]) {
    const fp = path.join(ROOT, file);
    if (!fs.existsSync(fp)) continue;
    for (const m of fs.readFileSync(fp, 'utf8').matchAll(new RegExp(`^## \\[(${p}\\d+)\\]`, 'gm'))) ids.add(m[1]);
  }
  return ids;
}

const KNOWN = knownIds();

/** 注入类消息不是"我写的"，跳过（否则简报里的 L019~L027 会被算成引用） */
function isInjected(t) {
  return /<system-reminder>|Current runtime context|workspace instructions may be relevant|^Time sampled while preparing|^请按 TOOLS\.md 的开工顺序/.test(t);
}

function summarize(file) {
  const text = readSession(file);
  const lines = text.split('\n').filter(Boolean);
  let header = {};
  const prompts = [];
  let lastAssistant = '';
  const refs = new Set();
  let toolCalls = 0;

  for (const l of lines) {
    if (!l.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(l); } catch { continue; }
    if (ev.type === 'session') { header = ev; continue; }
    if (ev.type === 'user/message') {
      const t = textOf(ev).trim();
      if (t && !isInjected(t)) prompts.push(t.replace(/\s+/g, ' ').slice(0, 200));
    } else if (ev.type === 'assistant/message') {
      const t = textOf(ev).trim();
      if (t) {
        lastAssistant = t.replace(/\s+/g, ' ').slice(0, 240);
        // 只统计我自己写的、且库里真实存在的 ID；
        // 一条消息里列 ≥5 个 ID 视为"罗列目录"（曝光），不算引用（2026-10-25 实测：
        // 否则每份简报/清单都会把 L001~L015 刷成"被引用"）。
        const found = new Set();
        for (const m of t.matchAll(/\b([LCPB]\d{3})\b/g)) if (KNOWN.has(m[1])) found.add(m[1]);
        if (found.size > 0 && found.size < 5) for (const id of found) refs.add(id);
      }
    } else if (ev.type === 'tool/call') toolCalls++;
  }

  return {
    file: path.basename(path.dirname(file)),
    id: header.id || path.basename(path.dirname(file)),
    cwd: header.cwd || '',
    origin: header.origin || 'user',
    parent: header.parentSession || '',
    createdAt: header.createdAt || 0,
    bytes: fs.statSync(file).size,
    toolCalls,
    prompts: prompts.slice(0, 3),
    promptsTotal: prompts.length,
    last: lastAssistant,
    refs: [...refs].sort()
  };
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return { at: 0, items: {} }; }
}

function saveCache(c) {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(c), 'utf8');
}

function buildIndex(verbose = true) {
  const cache = argv.includes('--rebuild') ? { at: 0, items: {} } : loadCache();
  const files = listFiles();
  let added = 0, skipped = 0, big = 0;
  for (const f of files) {
    const st = fs.statSync(f);
    const key = f;
    const hit = cache.items[key];
    if (hit && hit.mtime === st.mtimeMs && hit.bytes === st.size) { skipped++; continue; }
    if (st.size > MAX_BYTES) { big++; continue; }
    try {
      const s = summarize(f);
      s.mtime = st.mtimeMs;
      cache.items[key] = s;
      added++;
    } catch { /* 读不了就跳过，不能因为一个坏文件拖垮索引 */ }
  }
  cache.at = Date.now();
  saveCache(cache);
  if (verbose) console.log(`索引: 新增/更新 ${added} · 未变 ${skipped} · 超大跳过 ${big} · 总计 ${Object.keys(cache.items).length}`);
  return cache;
}

function items(cache, { cwd } = {}) {
  return Object.values(cache.items)
    .filter((x) => (cwd ? x.cwd === cwd : true))
    .sort((a, b) => b.createdAt - a.createdAt);
}

if (cmd === 'index') {
  buildIndex(true);
  process.exit(0);
}

if (cmd === 'recent') {
  const n = Number(argv[1]) || 5;
  const cache = loadIndexFresh();
  const list = items(cache, { cwd: ROOT }).slice(0, n);
  if (!list.length) { console.log('没有会话记录'); process.exit(0); }
  for (const s of list) {
    const when = new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false });
    console.log(`\n[${when}] ${s.origin === 'subagent' ? '子代理' : '主会话'} · ${s.toolCalls} 次工具 · ${s.refs.join(',') || '无经验引用'}`);
    for (const p of s.prompts) console.log(`  问: ${p.slice(0, 110)}`);
    if (s.last) console.log(`  答: ${s.last.slice(0, 110)}`);
  }
  console.log('');
  process.exit(0);
}

if (cmd === 'hits') {
  const cache = loadIndexFresh();
  const count = new Map();
  for (const s of Object.values(cache.items)) for (const r of s.refs) count.set(r, (count.get(r) || 0) + 1);
  const rows = [...count.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) { console.log('没有在会话里发现经验引用'); process.exit(0); }
  const lessons = fs.readFileSync(path.join(ROOT, 'LESSONS.md'), 'utf8');
  const show = rows.filter(([id]) => KNOWN.has(id)).slice(0, 25);
  console.log('我在回复里真正引用过的经验（只统计 assistant 消息 + 库里存在的 ID）:\n');
  for (const [id, n] of show) {
    const m = new RegExp(`^## \\[${id}\\] \\S+ · (.+?) · (.+)$`, 'm').exec(lessons);
    const hit = new RegExp(`## \\[${id}\\][\\s\\S]*?- 命中[:：]\\s*(\\d+)`).exec(lessons);
    const cur = hit ? Number(hit[1]) : 0;
    const flag = cur === 0 ? '  ← 未记账: node tools/memo.mjs hit ' + id : `  (已记 ${cur})`;
    console.log(`  ${id} ×${n}  ${m ? m[2] : ''}${flag}`);
  }
  console.log(`\n共 ${rows.length} 个 ID 有引用，显示前 ${show.length} 个`);
  process.exit(0);
}

if (cmd === 'search') {
  const kw = (argv[1] || '').toLowerCase();
  if (!kw) { console.log('用法: node tools/sessions.mjs search "关键词"'); process.exit(0); }
  const cache = loadIndexFresh();
  const rows = Object.values(cache.items).filter((s) =>
    s.prompts.some((p) => p.toLowerCase().includes(kw)) || (s.last || '').toLowerCase().includes(kw)
  ).sort((a, b) => b.createdAt - a.createdAt);
  console.log(`「${kw}」命中 ${rows.length} 个会话\n`);
  for (const s of rows.slice(0, Number(arg('limit', 5)))) {
    const when = new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false });
    console.log(`[${when}] ${s.origin === 'subagent' ? '子代理' : '主会话'}`);
    for (const p of s.prompts) if (p.toLowerCase().includes(kw)) console.log(`  问: ${p.slice(0, 140)}`);
    console.log('');
  }
  process.exit(0);
}

function loadIndexFresh() {
  const cache = loadCache();
  if (!cache.at || Date.now() - cache.at > 3600000) return buildIndex(false);
  return cache;
}

console.log('用法: node tools/sessions.mjs index|recent|hits|search');
