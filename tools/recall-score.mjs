#!/usr/bin/env node
/**
 * tools/recall-score.mjs —— 影子召回的"真实回合"计分板。
 *
 * 为什么不能只靠 recall-eval：那是**我自己出的 20 道题**，跑 100 遍也还是那 20 道。
 * 影子模式把每次真实的用户输入都记进 out/recall/auto.log，这个脚本把日志和台账
 * 拼起来算：它到底多少次真的命中、命中的条目后来有没有被我用上、多少次是白喊。
 *
 * 用法:
 *   node tools/recall-score.mjs            # 人读
 *   node tools/recall-score.mjs --json     # 机器读
 *   node tools/recall-score.mjs --days 3   # 只看最近 3 天
 *
 * 判定口径（写清楚，免得数字好看但没意义）：
 *   · 「用上了」= 命中的 ID 出现在同一回合 assistant 的引用里（ledger 的 cited）
 *   · 「白喊」  = 命中了但同回合完全没引用 —— 不等于错，只等于没证据，抽样人工看
 *   · 「漏了」  = 没命中任何条目，但该回合最后引用了经验（说明本该有人提醒）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\deepseek';
const LOG = path.join(ROOT, 'out', 'recall', 'auto.log');
const DIR = path.join(ROOT, 'out', 'ledger');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const JSON_OUT = argv.includes('--json');
const DAYS = Number(arg('days', 7));

if (!fs.existsSync(LOG)) { console.log('还没有影子日志：out/recall/auto.log'); process.exit(0); }

// ── 台账：按时间找回合 ────────────────────────────────────────────
const turns = [];
if (fs.existsSync(DIR)) {
  for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if ((r.origin || 'user') === 'user') turns.push(r); } catch { /* 坏行 */ }
    }
  }
}
turns.sort((a, b) => a.startedAt - b.startedAt);

const matchTurn = (timeMs, turnNo, q) => {
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const key = norm(q).slice(0, 18);
  // 先按日志里记的原话前缀匹配（最可靠），再退到"同 turn 号"，最后退到时间就近
  if (key) {
    const byText = turns.filter((t) => norm(t.prompt).startsWith(key.slice(0, 12)));
    if (byText.length) return byText.sort((a, b) => Math.abs(a.startedAt - timeMs) - Math.abs(b.startedAt - timeMs))[0];
  }
  const near = turns.filter((t) => Math.abs(t.startedAt - timeMs) < 60 * 60 * 1000);
  if (!near.length) return null;
  return near.find((t) => t.turn === turnNo) || near.sort((a, b) => Math.abs(a.startedAt - timeMs) - Math.abs(b.startedAt - timeMs))[0];
};

// ── 影子日志 ──────────────────────────────────────────────────────
const since = Date.now() - DAYS * 86400000;
const rows = [];
for (const line of fs.readFileSync(LOG, 'utf8').split(/\r?\n/)) {
  const m = /^\[([^\]]+)\]\s+turn=(\d+)\s+step=1\s+(SHADOW|INJECT)\s+([A-Z0-9,]*)\s*(?:\[[^\]]*\])?\s*<-\s*"([^"]*)"/.exec(line);
  if (!m) continue;
  const at = Date.parse(m[1]);
  if (!Number.isFinite(at) || at < since) continue;
  const ids = m[4].split(',').filter(Boolean);
  rows.push({ at, turn: Number(m[2]), mode: m[3], ids, q: m[5], turnRec: matchTurn(at, Number(m[2]), m[5]) });
}

// 影子模式和"老式直接注入时代"要分开看：老数据是修打分器之前的，混进来会把新指标带偏
const shadowRows = rows.filter((r) => r.mode === 'SHADOW');
const legacyRows = rows.filter((r) => r.mode === 'INJECT');

const score = (list) => {
  const hitRows = list.filter((r) => r.ids.length);
  const emptyRows = list.filter((r) => !r.ids.length);
  let used = 0, blank = 0;
  const blankSamples = [];
  for (const r of hitRows) {
    const cited = r.turnRec?.cited || [];
    if (r.ids.some((id) => cited.includes(id))) used++;
    else { blank++; if (blankSamples.length < 5) blankSamples.push({ ids: r.ids, q: r.q, prompt: (r.turnRec?.prompt || '').slice(0, 70) }); }
  }
  const missed = emptyRows.filter((r) => (r.turnRec?.cited || []).length);
  const avg = hitRows.length ? hitRows.reduce((n, r) => n + r.ids.length, 0) / hitRows.length : 0;
  return {
    lines: list.length,
    withHits: hitRows.length,
    empty: emptyRows.length,
    avgHits: Number(avg.toFixed(2)),
    used,
    blank,
    blankRate: hitRows.length ? Number(((100 * blank) / hitRows.length).toFixed(0)) : null,
    missedTurns: missed.length,
    missedSamples: missed.slice(-5).map((r) => ({ q: r.q, cited: r.turnRec?.cited })),
    blankSamples
  };
};

const shadowStat = score(shadowRows);
const legacyStat = score(legacyRows);
const result = { windowDays: DAYS, shadow: shadowStat, legacyInjects: legacyStat.lines, legacy: legacyStat };

if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

console.log(`\n=== 影子召回计分板（最近 ${DAYS} 天）===`);
const s = shadowStat;
if (!s.lines) {
  console.log('还没有 SHADOW 行 —— 插件已装上，等下一个真实回合就会开始记。');
  if (legacyStat.lines) {
    console.log(`\n（历史上有 ${legacyStat.lines} 条老式 INJECT：平均给 ${legacyStat.avgHits} 条、白喊率 ${legacyStat.blankRate}%——`);
    console.log(' 那是修打分器之前的数据，只作对照，别当现在的成绩。）');
  }
} else {
  console.log(`回合样本 ${s.lines} · 命中 ${s.withHits}（${((100 * s.withHits) / s.lines).toFixed(0)}%）· 空手 ${s.empty}`);
  console.log(`命中时平均给 ${s.avgHits} 条`);
  console.log(`用上了（同回合被引用）${s.used} 次 · 白喊 ${s.blank} 次${s.blankRate == null ? '' : `（白喊率 ${s.blankRate}%）`}`);
  console.log(`漏了的回合（没命中但该回合引用了经验）${s.missedTurns} 个`);

  if (s.blankSamples.length) {
    console.log('\n白喊抽样（要人工判断是"真的不相关"还是"相关但我没提"）：');
    for (const x of s.blankSamples) console.log(`  ${x.ids.join(',')}  ← ${x.q}`);
  }
  if (s.missedSamples.length) {
    console.log('\n漏掉的抽样：');
    for (const x of s.missedSamples) console.log(`  引用了 ${x.cited.join(',')}  ← ${x.q}`);
  }
  if (legacyStat.lines) console.log(`\n（另有 ${legacyStat.lines} 条老式 INJECT，是修打分器之前的数据，只作对照）`);
  console.log('\n注：样本 < 20 个回合时，这些百分比只当方向看，别当结论。需要 3~5 天真实使用才有意义。');
}
