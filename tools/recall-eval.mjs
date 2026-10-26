#!/usr/bin/env node
/**
 * tools/recall-eval.mjs —— 给 auto-recall 的打分器做"离线影子评估"。
 *
 * 为什么需要：AGENTS.md 规定自动召回插件重装前必须先跑影子模式验证准确率，
 * 但"准确率"得有个可复现的尺子。这个脚本把 2026-10-25 真机日志里出现过的
 * 用户输入（含那次翻车的 "erro"）固化成用例，直接调插件导出的 __test.recall，
 * 不启动 DSH、不注入任何消息，几秒钟出结果。
 *
 * 用法：
 *   node tools/recall-eval.mjs           # 跑默认用例表
 *   node tools/recall-eval.mjs --show    # 额外打印每条命中的分数明细
 *   node tools/recall-eval.mjs --replay  # 把 out/recall/auto.log 里的查询原样回放
 *
 * 退出码：有 miss 或 noise 时返回 1（方便将来接进 CI / 收工体检）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:\\deepseek';
const PLUGIN = path.join(ROOT, 'plugins', 'auto-recall', 'index.js');
const LOG = path.join(ROOT, 'out', 'recall', 'auto.log');

const show = process.argv.includes('--show');
const replay = process.argv.includes('--replay');

/** expect: 期望必须出现的 ID（数组）；'none' 表示这条输入不该召回任何东西。 */
const CASES = [
  {
    q: '改插件之后要做什么才不会白干半天',
    expect: ['L015'],
    why: '日志 turn=1 原有注入 L035,L044,L015 —— 对，但正确答案排第 3'
  },
  {
    q: 'dsh plugin add 之后界面没变化、新路由 404',
    expect: ['L015'],
    why: 'L015 的原症状'
  },
  {
    q: '为什么现在我输入会有这个提示 Cannot read properties of undefined (reading kind)',
    expect: ['L052'],
    why: '日志 turn=18 当时注入 L050,L018,L013 —— 全错，因为 L052 还没写；现在应当命中'
  },
  {
    q: '本轮运行失败',
    expect: ['L052'],
    why: '日志 turn=20/40 注入 L018,L029（端口/网络），与插件无关'
  },
  {
    q: 'patch 热加载 插件',
    expect: ['L051', 'L015', 'L052'],
    why: '关键词式短查询，允许三条同族经验中的任意一条'
  },
  { q: 'erro', expect: 'none', why: '日志 turn=22 注入 L013,L035,L050 —— 用户实测的噪音源' },
  { q: 'now,there is a erro', expect: 'none', why: '日志 turn=24 注入 L013,L035,L050' },
  { q: '错了', expect: 'none', why: '日志 turn=25 no-hit，正确' },
  { q: '是', expect: 'none', why: '两个字以内不检索' },
  { q: '请回复我：', expect: 'none', why: '日志 turn=19 no-hit，正确' },

  // ── 以下是不在训练日志里的"留出集"，覆盖其他七个领域，防止只对自己挑的用例调参 ──
  { q: 'ComfyUI 报 Expecting value: line 1 column 1 (char 0)', expect: ['L020', 'L035'], why: '留出集：下载/渲染' },
  { q: 'hf-mirror 下载只有 0.3MB/s 怎么提速', expect: ['L019'], why: '留出集：分片下载' },
  { q: 'RTX 5090 装 torch 报 no kernel image', expect: ['L021'], why: '留出集：cu128' },
  { q: 'Wan2.1 1.3B 图生视频能跑吗', expect: ['L023', 'L024'], why: '留出集：8GB 显存选型' },
  { q: '8G 显存跑 Wan 720p 会爆显存吗', expect: ['L024', 'L023'], why: '留出集：显存现实' },
  { q: 'B站长视频总结只总结了前面一部分', expect: ['L030'], why: '留出集：分块总结' },
  { q: 'PowerShell 读中文 md 全是乱码', expect: ['L036', 'L054'], why: '留出集：编码（L036 = Get-Content 读乱码；L054 = 输出转发乱码，指向任一条都算对）' },
  { q: '空仓库 push 报错', expect: ['L002'], why: '留出集：发布' },
  { q: '继续', expect: 'none', why: '留出集：无信息量的口头指令' },
  { q: '好的谢谢', expect: 'none', why: '留出集：寒暄' }
];

function fmt(hits) {
  if (!hits.length) return '（空）';
  return hits
    .map((h) => `${h.id}${show ? `(${Math.round(h.score)}/b${h.bestLen})` : ''}`)
    .join(',');
}

const { __test } = await import(pathToFileURL(PLUGIN).href);
const { recall } = __test;

const cases = replay ? replayCases() : CASES;
let hit = 0, miss = 0, noise = 0, okEmpty = 0, observe = 0;

console.log(`=== auto-recall 影子评估（${cases.length} 条用例）===`);
for (const c of cases) {
  const hits = recall(c.q);
  const ids = hits.map((h) => h.id);
  let verdict;
  if (c.expect == null) {
    verdict = '观察'; observe++;                      // 回放模式：没有标准答案，只打印
  } else if (c.expect === 'none') {
    verdict = hits.length ? '噪音' : '对';
    if (hits.length) noise++; else okEmpty++;
  } else {
    const ok = ids.some((id) => c.expect.includes(id));
    verdict = ok ? '对' : '漏';
    if (ok) hit++; else miss++;
  }
  console.log(`${verdict.padEnd(2, '　')} | ${fmt(hits).padEnd(28)} | ${c.q.slice(0, 46)}`);
  if (show || verdict === '噪音' || verdict === '漏') {
    if (c.why) console.log(`     ${verdict === '对' ? '说明' : '问题'}：${c.why}`);
    if (Array.isArray(c.expect)) console.log(`     期望：${c.expect.join('/')}`);
    if (show) for (const h of hits) console.log(`     - ${h.id} [${h.kind}] ${h.title}`);
  }
}

const judged = hit + miss + noise + okEmpty;
console.log('\n--- 汇总 ---');
console.log(`该命中的 ${hit + miss} 条：命中 ${hit}，漏 ${miss}`);
console.log(`不该命中的 ${noise + okEmpty} 条：干净 ${okEmpty}，误报 ${noise}`);
if (judged) console.log(`合计正确率 ${hit + okEmpty}/${judged} = ${((100 * (hit + okEmpty)) / judged).toFixed(0)}%`);
if (observe) console.log(`另有 ${observe} 条无标准答案（回放模式只观察）`);
process.exitCode = miss + noise > 0 ? 1 : 0;

/** 从真机日志里把查询原样抽出来回放（`<- "..."` 后面那段）。 */
function replayCases() {
  const raw = fs.readFileSync(LOG, 'utf8');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/(?:INJECT|SHADOW|no-hit:)\s*(?:[A-Z0-9,]*\s*(?:\[[^\]]*\])?\s*)?<-\s*"([^"]*)"/);
    if (m && m[1].trim()) out.push({ q: m[1].trim(), expect: null, why: '' });
  }
  return out;
}
