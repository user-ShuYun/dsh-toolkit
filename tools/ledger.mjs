#!/usr/bin/env node
/**
 * ledger.mjs —— 回合台账：把「每个回合发生了什么」从会话日志里抽出来，离线可跑。
 *
 * 为什么要有它：reflection 最有价值的时刻是失败发生那一秒，但证据只活在上下文里，
 * 会话一关就没了。DSH 已经把每个回合的事件落盘了（turn/start · step/start ·
 * tool/call · tool/result · turn/end），所以台账不需要插件、不用改 patch、
 * 也不需要 DSH 开着 —— 纯读文件。
 *
 * 每回合抽六件事：
 *   用户原话 / 触及的文件 / 失败的命令和 exit code / 我引用过的 L0xx / 步数 / 耗时
 *
 * 用法:
 *   node tools/ledger.mjs                 # 增量重建（只重解析变过的会话文件）
 *   node tools/ledger.mjs pending         # 还没提炼的回合（preflight 用这一条）
 *   node tools/ledger.mjs show [n]        # 人肉看最近 n 个回合
 *   node tools/ledger.mjs distill         # 把待提炼回合聚成一份提炼包 → out/ledger/distill-*.md
 *   node tools/ledger.mjs done <key...>   # 标记已提炼（或 --all）
 *   node tools/ledger.mjs hits [--apply]  # 自动记命中（同一会话同一条只 +1）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const ROOT = 'D:\\deepseek';
const SES = path.join(process.env.USERPROFILE || '', '.dsh', 'sessions');
const DIR = path.join(ROOT, 'out', 'ledger');
const CACHE = path.join(DIR, 'cache.json');
const DONE = path.join(DIR, 'distilled.json');
const HITS = path.join(DIR, 'hits-applied.json');
const MAGIC = Buffer.from('28b52ffd', 'hex');
const MAX_BYTES = 40 * 1024 * 1024;

const argv = process.argv.slice(2);
const cmd = argv[0] || 'build';
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};

// ── 读会话（多帧 zstd：单次解压只拿得到第一帧，见 L048）─────────────────
function listFiles(dir = SES, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (e.name.endsWith('.zstd')) out.push(p);
  }
  return out;
}

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

const textOf = (c) => {
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ');
  return '';
};

/** 注入类消息不是用户原话（简报、运行时上下文、插件注入都算） */
const isInjected = (t) =>
  /<system-reminder>|Current runtime context|workspace instructions may be relevant|^Time sampled while preparing|^\[auto-recall\]|^请按 TOOLS\.md 的开工顺序|^Agent [0-9a-f-]{8,} sent a message:/.test(t);

/**
 * 「判断失误」信号：这三类比 exit code 值钱——人最该记的错，在日志里从来不叫失败。
 *   ① 用户纠正：语气里带"不对/我说的是/怎么不…"
 *   ② 自我否定：我自己写着写着改主意
 *   ③ 同一条命令反复重试（在 finalize 里按命令去重统计）
 */
const CORRECT_RE = /不对|错了|不是(这样|这个|那么|我)|我说的是|搞错|理解错|怎么不|为什么不(先|早)|重新做|跑偏|偏离主题/;
const SELF_RE = /其实不对|我说错了|更正一下|推翻|重新想|刚才那个不对|等等[，,]|等一下[，,]|我搞错/;

function knownIds() {
  const ids = new Set();
  for (const [file, p] of [['LESSONS.md', 'L'], ['CORRECTIONS.md', 'C'], ['PREFERENCES.md', 'P'], ['PLAYBOOKS.md', 'B']]) {
    const fp = path.join(ROOT, file);
    if (!fs.existsSync(fp)) continue;
    for (const m of fs.readFileSync(fp, 'utf8').matchAll(new RegExp(`^## \\[(${p}\\d+)\\]`, 'gm'))) ids.add(m[1]);
  }
  return ids;
}

/** 引用判定：只认库里存在的 ID；一条消息列 ≥5 个算"罗列目录"，不算引用（L049） */
function citedIn(text, known) {
  const found = new Set();
  for (const m of String(text).matchAll(/\b([LCPB]\d{3})\b/g)) if (known.has(m[1])) found.add(m[1]);
  return found.size > 0 && found.size < 5 ? [...found] : [];
}

const FILE_TOOLS = new Set(['edit', 'write', 'str_replace_editor', 'present', 'read']);
const CODE_RE = /((?:[A-Za-z]:\\|(?:out|tools|notes|plugins|gh)[\\/])[^\s"'`,;|)]*\.(?:mjs|js|json|jsonl|md|ps1|yml|yaml|png|mp4|txt))/g;

function filesFrom(name, argsText) {
  const out = [];
  let a = {};
  try { a = typeof argsText === 'string' ? JSON.parse(argsText) : argsText || {}; } catch { a = {}; }
  if (!FILE_TOOLS.has(name)) {
    // 只有会改文件的工具才算"触及"；read 只读，不记
  }
  if (name !== 'read' && FILE_TOOLS.has(name)) {
    if (a.file_path) out.push(a.file_path);
    if (a.path) out.push(a.path);
    if (Array.isArray(a.files)) for (const f of a.files) if (f?.path) out.push(f.path);
  }
  if (name === 'pwsh' || name === 'bash') {
    for (const m of String(a.command || '').matchAll(CODE_RE)) out.push(m[1]);
  }
  return out
    .map((p) => String(p)
      .replace(/\\\//g, '/')      // 命令里的转义斜杠 tools\/x.mjs → tools/x.mjs
      .replace(/\\\./g, '.')      // 转义点 x\.mjs → x.mjs
      .replace(/^D:\\deepseek\\/i, '')
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/'))
    .filter((p) => p && !p.startsWith('C:/') && !/node_modules/.test(p));
}

/**
 * 标一下"现在还在不在"：`out/x.mjs` 在盘上 = 真实路径；`out/x.mjs?` = 当时抓到的字符串，
 * 现在盘上没有（可能是临时文件，也可能是抓错了）。这是启发式路径，不是精确 diff。
 */
function markExists(p) {
  try {
    return fs.existsSync(path.join(ROOT, p.replace(/[?？]$/, ''))) ? p : p + '?';
  } catch { return p + '?'; }
}

function parseSession(file, known) {
  const text = readSession(file);
  const lines = text.split('\n').filter((l) => l.startsWith('{'));
  const evs = [];
  for (const l of lines) { try { evs.push(JSON.parse(l)); } catch { /* 坏行跳过 */ } }

  const head = evs.find((e) => e.type === 'session') || {};
  const origin = head.parentSession || head.parent ? 'subagent' : head.origin || 'user';
  const records = [];
  let cur = null;

  // 事件流按 seq 排：多帧拼接后顺序不保证（2026-10-26 实测，"我最后说了什么"
  // 取到的是中途旁白而不是收尾答案，就是顺序错乱导致的）
  evs.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const finalize = (endedAt, reason) => {
    if (!cur) return;
    const steps = cur.steps;
    const r = {
      key: `${cur.session}#${cur.turn}`,
      session: cur.session,
      origin,                       // user = 我自己的回合；subagent = 委派出去的活
      turn: cur.turn,
      date: cur.date,
      startedAt: cur.startedAt,
      endedAt: endedAt || null,
      secs: cur.startedAt && endedAt ? Math.round((endedAt - cur.startedAt) / 1000) : null,
      steps,
      reason: reason || 'unclosed',
      prompt: cur.prompts.join(' ⏎ ').slice(0, 600),
      answer: cur.answer.slice(0, 400),
      reasoning: cur.reasoning,
      files: [...new Set(cur.files)].slice(0, 10).map(markExists),
      failed: cur.failed.slice(0, 6),
      cited: [...new Set(cur.cited)],
      calls: cur.calls_,
      toolNames: [...new Set(cur.toolNames)].slice(0, 12),
      signals: (() => {
        const sig = [...cur.signals];
        /**
         * 同一条命令跑 ≥2 次**且其中至少一次失败**才算"在撞墙"。
         * 只按次数算太吵（Get-Date / preflight 正常会跑好几遍），260 条里大半是噪声。
         */
        const cnt = new Map();
        for (const c of cur.cmds) cnt.set(c, (cnt.get(c) || 0) + 1);
        const failedCmds = cur.failed.map((f) => (f.cmd || '').trim()).filter(Boolean);
        const near = (a, b) => a.slice(0, 40) === b.slice(0, 40);
        for (const [c, n] of cnt) {
          if (n < 2) continue;
          if (!failedCmds.some((f) => near(c, f))) continue;
          sig.push({ kind: 'retry', text: `${n}× ${c.slice(0, 80)}` });
        }
        return sig.slice(0, 8);
      })()
    };
    records.push(r);
    cur = null;
  };

  for (const ev of evs) {
    const d = ev.data || {};
    switch (ev.type) {
      case 'turn/start': {
        finalize(null, 'superseded');
        const t = ev.time || Date.now();
        const dt = new Date(t);
        const p = (n) => String(n).padStart(2, '0');
        cur = {
          session: head.id || path.basename(path.dirname(file)),
          turn: d.turn ?? 0,
          startedAt: t,
          date: `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`,
          steps: 0, prompts: [], answer: '', reasoning: 0, files: [], failed: [], cited: [],
          calls_: 0, toolNames: [], calls: new Map(), signals: [], cmds: []
        };
        break;
      }
      case 'turn/end':
        if (cur) finalize(ev.time || Date.now(), d.reason?.kind || 'completed');
        break;
      case 'step/start':
        if (cur) cur.steps++;
        break;
      case 'user/message': {
        if (!cur) break;
        const t = textOf(d.message?.content ?? d.content).trim();
        if (t && !isInjected(t)) {
          cur.prompts.push(t.replace(/\s+/g, ' ').slice(0, 300));
          // 只认"短促的纠正"：用户真纠正一般就一句话；长文里出现"不对"多半是在引用我的原文
          if (t.length <= 200 && CORRECT_RE.test(t)) cur.signals.push({ kind: 'user-correction', text: t.replace(/\s+/g, ' ').slice(0, 160) });
        }
        break;
      }
      case 'assistant/message': {
        if (!cur) break;
        const parts = d.message?.content;
        // content 是 [{type:'reasoning'},{type:'text'}] 混合：可见答案只在 text 里，
        // reasoning 是过程（2026-10-26 实测：不分类型会被过程旁白顶替掉答案）
        const textParts = Array.isArray(parts)
          ? parts.filter((c) => c && c.type === 'text').map((c) => c.text || '').join(' ').trim()
          : textOf(parts).trim();
        if (Array.isArray(parts)) cur.reasoning += parts.filter((c) => c && c.type === 'reasoning').reduce((n, c) => n + (c.text || '').length, 0);
        if (textParts) cur.answer = textParts.replace(/\s+/g, ' ');
        const any = Array.isArray(parts) ? parts.map((c) => c.text || '').join(' ') : textOf(parts);
        if (any) for (const id of citedIn(any, known)) cur.cited.push(id);
        // 自我否定：这类"我改主意了"的时刻最容易藏着该记的经验
        const selfM = SELF_RE.exec(any || '');
        if (selfM) {
          const i = Math.max(0, selfM.index - 40);
          cur.signals.push({ kind: 'self-correction', text: String(any).slice(i, i + 140).replace(/\s+/g, ' ') });
        }
        break;
      }
      case 'tool/call': {
        if (!cur) break;
        cur.calls_++;
        cur.toolNames.push(d.name);
        cur.calls.set(d.callId, { name: d.name, args: d.arguments });
        for (const f of filesFrom(d.name, d.arguments)) cur.files.push(f);
        // 记下命令原文，用来发现"同一条命令反复重试"
        if (d.name === 'pwsh' || d.name === 'bash') {
          try {
            const a = JSON.parse(d.arguments || '{}');
            if (a.command) cur.cmds.push(String(a.command).replace(/\s+/g, ' ').trim().slice(0, 100));
          } catch { /* 参数不是 JSON */ }
        }
        break;
      }
      case 'tool/result': {
        if (!cur) break;
        const t = textOf(d.message?.content ?? d.content);
        const m = /\[exit code: (\d+)\]/.exec(t);
        const bad = (m && m[1] !== '0') || d.message?.isError || d.isError;
        if (bad) {
          // callId 在 message 里，不在 data 顶层（2026-10-26 修：一直取不到 → tool 显示成 "tool"、cmd 为空）
          const call = cur.calls.get(d.toolCallId || d.message?.toolCallId);
          const full = t.replace(/\s+/g, ' ').trim();
          const head = full.slice(0, 160);
          let cmd = '';
          try {
            const a = JSON.parse(call?.args || '{}');
            cmd = (a.command || a.description || '').slice(0, 120);
          } catch { /* 参数不是 JSON */ }
          /**
           * 假失败降噪（2026-10-26 实测，由子代理发现、我复核）：
           * 这个环境的 PowerShell 是 5.1，`node ... | Select-Object -First N` 会在子进程
           * 还活着时断管 → 退出码变 -1，harness 记成 [exit code: 1]，但输出完全正常。
           * 判据：命令里有 Select-Object -First，或者**完整输出**很长却没有任何错误关键词。
           */
          const ERR_WORDS = /error|exception|cannot|拒绝|denied|not found|no such file|ENOENT|ParserError|Traceback|失败|错误/i;
          const suspect = /Select-Object\s+-First|Select\s+-First/i.test(cmd) || (!ERR_WORDS.test(full) && full.length > 180);
          cur.failed.push({ tool: call?.name || 'tool', code: m ? Number(m[1]) : null, cmd, head, suspect });
        }
        break;
      }
      default:
        break;
    }
  }
  finalize(null, 'unclosed');
  return { head, records };
}

// ── 缓存 + 输出 ──────────────────────────────────────────────────────
// 去 BOM：这个环境的 Set-Content -Encoding utf8 会写 EF BB BF（PS 5.1），
// 不清掉 JSON.parse 直接抛 Unexpected token（L059）
const loadJson = (f, d) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return d; }
};
const saveJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v), 'utf8'); };

function build(verbose = true) {
  const cache = loadJson(CACHE, { at: 0, sessions: {} });
  if (argv.includes('--rebuild')) cache.sessions = {};   // 改了抽取规则之后要能强制全量重解析
  const known = knownIds();
  const files = listFiles();
  let parsed = 0, skipped = 0, big = 0;

  for (const f of files) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    const prev = cache.sessions[f];
    if (prev && prev.mtime === st.mtimeMs && prev.bytes === st.size) { skipped++; continue; }
    if (st.size > MAX_BYTES) { big++; continue; }
    try {
      const { records } = parseSession(f, known);
      // 只留本工作区的会话（子代理/别处的会话不是"我的回合"）
      const mine = records.filter((r) => r.prompt);
      if (!mine.length) { skipped++; continue; }
      cache.sessions[f] = { mtime: st.mtimeMs, bytes: st.size, records: mine };
      parsed++;
    } catch { skipped++; }
  }
  cache.at = Date.now();
  saveJson(CACHE, cache);

  // 按本地日期写 jsonl
  const byDate = new Map();
  for (const s of Object.values(cache.sessions)) for (const r of s.records) {
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    byDate.get(r.date).set(r.key, r); // 同 key 以最新解析为准
  }
  fs.mkdirSync(DIR, { recursive: true });
  let total = 0;
  for (const [date, map] of byDate) {
    const rows = [...map.values()].sort((a, b) => a.startedAt - b.startedAt);
    total += rows.length;
    fs.writeFileSync(path.join(DIR, `${date}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  }
  if (verbose) {
    console.log(`台账：解析/更新 ${parsed} 个会话 · 未变 ${skipped} · 超大跳过 ${big}`);
    console.log(`共 ${total} 个回合 · ${byDate.size} 天 · → ${path.relative(ROOT, DIR)}\\YYYY-MM-DD.jsonl`);
  }
  return { cache, byDate, total };
}

function allRecords(cache) {
  // 同一个会话可能有多份 .zstd（检查点），key 会重复 → 只留一条
  const byKey = new Map();
  for (const s of Object.values(cache.sessions)) for (const r of s.records) byKey.set(r.key, r);
  return [...byKey.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** 待复盘队列只放"我自己的回合"：子代理的回合是委派出去的活，不该混进我的复盘清单 */
const mine = (rows) => rows.filter((r) => (r.origin || 'user') === 'user');

const brief = (r) => `${r.key} · ${r.steps}步 ${r.secs == null ? '?' : r.secs + 's'} · 失败${r.failed.length} · ${r.prompt.slice(0, 60)}`;

if (cmd === 'build' || argv.includes('--rebuild')) {
  const { cache } = build(true);
  const pending = mine(allRecords(cache)).filter((r) => !loadJson(DONE, []).includes(r.key));
  console.log(`待提炼：${pending.length} 个回合（node tools/ledger.mjs distill）`);
  process.exit(0);
}

if (cmd === 'pending') {
  const { cache } = build(false);
  const done = new Set(loadJson(DONE, []));
  const pending = mine(allRecords(cache)).filter((r) => !done.has(r.key));
  if (process.argv.includes('--quiet')) {
    if (!pending.length) { console.log('台账：无待提炼回合'); process.exit(0); }
    const lastR = allRecords(cache).slice(-1)[0];
    console.log(`台账：${pending.length} 个回合待提炼  → node tools/ledger.mjs distill`);
    if (lastR) console.log(`最近一回合：${brief(lastR)}`);
    process.exit(0);
  }
  if (!pending.length) { console.log('没有待提炼的回合 ✅'); process.exit(0); }
  console.log(`待提炼 ${pending.length} 个回合：\n`);
  for (const r of pending.slice(-20)) console.log('  ' + brief(r));
  if (pending.length > 20) console.log(`  … 还有 ${pending.length - 20} 个`);
  process.exit(0);
}

if (cmd === 'done') {
  const keys = argv.slice(1).filter((a) => !a.startsWith('--'));
  const before = arg('before', '');
  const done = new Set(loadJson(DONE, []));
  const { cache } = build(false);
  const all = allRecords(cache);
  const target = argv.includes('--all')
    ? all.map((r) => r.key)
    : before
      ? all.filter((r) => r.date < before).map((r) => r.key)
      : keys;
  for (const k of target) done.add(k);
  saveJson(DONE, [...done]);
  console.log(`已标记 ${target.length} 个回合为已提炼（累计 ${done.size}）`);
  process.exit(0);
}

if (cmd === 'show') {
  const n = Number(argv[1]) || 8;
  const { cache } = build(false);
  const rows = allRecords(cache).slice(-n);
  for (const r of rows) {
    console.log(`\n── ${r.key}  ${new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false })}  ${r.steps}步 ${r.secs ?? '?'}s  (${r.reason})`);
    if (r.prompt) console.log(`   问: ${r.prompt.slice(0, 160)}`);
    if (r.answer) console.log(`   答: ${r.answer.slice(0, 160)}`);
    if (r.files.length) console.log(`   触及: ${r.files.join(' · ')}`);
    if (r.cited.length) console.log(`   引用: ${r.cited.join(' ')}`);
    for (const f of r.failed) console.log(`   ❌ ${f.tool} exit=${f.code ?? '?'} ${f.cmd} :: ${f.head.slice(0, 110)}`);
  }
  console.log('');
  process.exit(0);
}

if (cmd === 'distill') {
  const { cache } = build(false);
  const done = new Set(loadJson(DONE, []));
  const LAST = Number(arg('last', 40));
  const pendingAll = mine(allRecords(cache)).filter((r) => !done.has(r.key));
  if (!pendingAll.length) { console.log('没有待提炼的回合 ✅'); process.exit(0); }
  // 提炼包默认只装最近 40 个回合：599 个回合一次塞给子代理，它只会挑容易的写
  const pending = pendingAll.slice(-LAST);

  const failed = pending.flatMap((r) => r.failed.map((f) => ({ ...f, key: r.key })));
  const realFailed = failed.filter((f) => !f.suspect);
  const suspectFailed = failed.filter((f) => f.suspect);
  const cited = {};
  for (const r of pending) for (const id of r.cited) cited[id] = (cited[id] || 0) + 1;
  const byBucket = new Map();
  const bucketOf = (f) => (/comfy|workflow|出片|显存|视频|ffmpeg/i.test(f.cmd + f.head) ? '视频/ComfyUI'
    : /plugin|cordis|patch|插件/i.test(f.cmd + f.head) ? '插件'
    : /pwsh|PowerShell|Get-Content|编码/i.test(f.cmd + f.head) ? 'Windows/编码'
    : /net|ECONN|timeout|403|401|proxy|代理/i.test(f.cmd + f.head) ? '网络'
    : '其他');
  for (const f of realFailed) {
    const b = bucketOf(f);
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b).push(f);
  }

  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  const file = path.join(DIR, `distill-${stamp}.md`);

  const L = [];
  const sigRows = pending.flatMap((r) => (r.signals || []).map((s) => ({ ...s, key: r.key })));
  L.push(`# 提炼包 ${stamp}`, '',
    `> 由 tools/ledger.mjs distill 生成。待提炼 ${pendingAll.length} 个回合，本次装最近 ${pending.length} 个、${failed.length} 条失败（其中 ${suspectFailed.length} 条疑似假失败）、${sigRows.length} 条判断失误信号。`,
    '> 交给子代理或我自己读；结论写进 LESSONS.draft.md，人工审完才升格成 L###。', '');

  L.push('## 一、回合清单', '');
  if (pendingAll.length > pending.length) {
    L.push(`> 另有 ${pendingAll.length - pending.length} 个更早的回合没装进来（默认只装最近 40 个）。`, `> 要连它们一起看：\`node tools/ledger.mjs distill --last ${pendingAll.length}\``, '');
  }
  for (const r of pending) {
    L.push(`### ${r.key} · ${new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false })} · ${r.steps}步 ${r.secs ?? '?'}s`);
    L.push(`- 问：${r.prompt.slice(0, 200)}`);
    if (r.answer) L.push(`- 答：${r.answer.slice(0, 200)}`);
    if (r.files.length) L.push(`- 触及：${r.files.join(' · ')}（带 ? 的是当时抓到、现在盘上没有的路径）`);
    if (r.cited.length) L.push(`- 引用：${r.cited.join(' ')}`);
    L.push('');
  }

  L.push('## 二、失败聚类', '');
  if (!realFailed.length) L.push('（这批没有真失败记录）', '');
  for (const [b, rows] of byBucket) {
    L.push(`### ${b}（${rows.length}）`, '');
    for (const f of rows) L.push(`- [${f.key.split('#')[0].slice(0, 12)}…] \`${f.cmd || f.tool}\` exit=${f.code ?? '?'} → ${f.head.slice(0, 150)}`);
    L.push('');
  }
  if (suspectFailed.length) {
    L.push(`### 疑似假失败（${suspectFailed.length}）—— 输出正常但退出码非 0`, '',
      '> 多半是 `node ... | Select-Object -First N` 断管：PowerShell 5.1 在子进程还活着时掐管道，退出码变 -1（L058）。', '');
    for (const f of suspectFailed) L.push(`- [${f.key.split('#')[0].slice(0, 12)}…] \`${f.cmd || f.tool}\` exit=${f.code ?? '?'} → ${f.head.slice(0, 120)}`);
    L.push('');
  }

  L.push('## 三、判断失误信号（比 exit code 值钱）', '');
  if (!sigRows.length) L.push('（这批没有信号）', '');
  const KIND_LABEL = { 'user-correction': '用户纠正（我说错/做错了什么）', retry: '撞墙重试（同一条命令反复跑且失败过）', 'self-correction': '自我否定（我改主意的那一刻）' };
  for (const [k, label] of Object.entries(KIND_LABEL)) {
    const rows = sigRows.filter((s) => s.kind === k);
    if (!rows.length) continue;
    L.push(`### ${label}（${rows.length}）`, '');
    for (const s of rows.slice(0, 15)) L.push(`- [${s.key.split('#')[0].slice(0, 12)}…] ${s.text}`);
    if (rows.length > 15) L.push(`- …还有 ${rows.length - 15} 条`);
    L.push('');
  }
  L.push('> 这一节的用法：用户纠正 → 可能该进 CORRECTIONS.md；重试 → 当时缺哪条经验？自我否定 → 我的第一个判断错在哪？', '');

  L.push('## 四、命中统计', '');
  const citeRows = Object.entries(cited).sort((a, b) => b[1] - a[1]);
  L.push(citeRows.length ? citeRows.map(([id, n]) => `${id}×${n}`).join(' · ') : '（这批没有引用经验）', '');

  L.push('## 五、要回答的问题', '',
    '1. 失败聚类里，有没有「同一个原因出现 ≥2 次」的？→ 合并成一条经验',
    '2. 判断失误信号里，有没有「本可以避免」的？→ 那说明缺一条经验，或召回该在那一刻响',
    '3. 有没有哪条已有经验本该提醒我、但没提醒到？→ 记下来当作召回的失败样本',
    '4. 有没有新数字（耗时/体积/参数/比例）值得写进证据？',
    '5. 有没有流程变了（新脚本、改默认值）？→ 改 TOOLS.md，而不是只记日志',
    '6. 哪些回合其实没什么可提炼的？→ `node tools/ledger.mjs done <key>` 标掉，下次不再出现',
    '');

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, L.join('\n'), 'utf8');
  console.log(`提炼包 → ${file}`);
  console.log(`覆盖 ${pending.length} 个回合 / ${failed.length} 条失败`);
  console.log(`键：${pending.map((r) => r.key).join(' ')}`);
  process.exit(0);
}

if (cmd === 'hits') {
  const MANUAL = path.join(DIR, 'manual-hits.json');
  const manual = loadJson(MANUAL, {});
  const mi = argv.indexOf('--manual');
  if (mi > 0 && argv[mi + 1]) {
    // 手工加分：会话日志里看不出来的那种"这条救了我"
    const id = String(argv[mi + 1]).toUpperCase();
    manual[id] = (manual[id] || 0) + 1;
    saveJson(MANUAL, manual);
    console.log(`${id} 手工加分 → ${manual[id]}（下次 --recount 会跟会话数相加）`);
    process.exit(0);
  }

  const { cache } = build(false);
  const apply = argv.includes('--apply');
  // --apply 以前是"每个 ID 调一次 memo hit（+1）却把该 ID 的全部会话标成已记账"，
  // 差额再也补不回来（2026-10-26 复核 #1）。现在等价于 --recount：按会话数直接算，
  // 确定性、幂等，不会记错。
  const recount = argv.includes('--recount') || apply;
  const records = allRecords(cache);
  if (apply && !argv.includes('--recount')) console.log('（--apply 已等价于 --recount：按会话数重算，避免逐次 +1 记错账）');

  if (recount) {
    // 重算：命中 = 引用过这条的去重会话数 + 手工加分。确定性、幂等，不怕重复跑。
    const bySess = new Map();
    for (const r of records) for (const id of r.cited) {
      if (!bySess.has(id)) bySess.set(id, new Set());
      bySess.get(id).add(r.session);
    }
    const counts = new Map([...bySess].map(([id, s]) => [id, s.size + (manual[id] || 0)]));
    let touched = 0;
    for (const [file, prefix] of [['LESSONS.md', 'L'], ['CORRECTIONS.md', 'C'], ['PREFERENCES.md', 'P'], ['PLAYBOOKS.md', 'B']]) {
      const fp = path.join(ROOT, file);
      if (!fs.existsSync(fp)) continue;
      const raw = fs.readFileSync(fp, 'utf8');
      const out = raw.split(/\n(?=## \[)/).map((block) => {
        const id = new RegExp(`^## \\[(${prefix}\\d+)\\]`).exec(block)?.[1];
        if (!id) return block;
        const n = counts.get(id) || (manual[id] || 0);
        touched++;
        return /- 命中[:：]\s*\d+/.test(block)
          ? block.replace(/(- 命中[:：]\s*)\d+/, '$1' + n)
          : block.trimEnd() + `\n- 命中: ${n}`;
      }).join('\n');
      if (out !== raw) fs.writeFileSync(fp, out, 'utf8');
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`重算完成：${touched} 条 · 被引用过 ${counts.size} 条 · 手工加分 ${Object.keys(manual).length} 条`);
    console.log('最高：' + top.map(([id, n]) => `${id}×${n}`).join(' '));
    process.exit(0);
  }

  const applied = new Set(loadJson(HITS, []));
  const want = new Map(); // id → sessions set
  for (const r of records) {
    for (const id of r.cited) {
      const k = `${r.session}|${id}`;
      if (applied.has(k)) continue;
      if (!want.has(id)) want.set(id, new Set());
      want.get(id).add(r.session);
    }
  }
  if (!want.size) { console.log('没有新的引用需要记账 ✅'); process.exit(0); }
  for (const [id, sessions] of want) {
    console.log(`  ${id}  ${sessions.size} 个会话引用${apply ? ' → 记账' : ''}`);
    if (!apply) continue;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'memo.mjs'), 'hit', id], { cwd: ROOT, encoding: 'utf8' });
    if (r.status === 0) for (const s of sessions) applied.add(`${s}|${id}`);
    else console.log(`    ⚠️ 记账失败：${(r.stderr || r.stdout || '').trim().slice(0, 120)}`);
  }
  if (apply) { saveJson(HITS, [...applied]); console.log(`\n已记账 ${want.size} 条（累计 ${applied.size} 个会话×ID）`); }
  else console.log('\n加 --apply 才真的记账；要按会话数重算用 --recount（推荐）');
  process.exit(0);
}

console.log(`用法: node tools/ledger.mjs [build|pending|show [n]|distill|done <key>|hits [--apply]]`);
console.log(`（当前可用参数见文件头；数据在 ${path.relative(ROOT, DIR)}）`);
