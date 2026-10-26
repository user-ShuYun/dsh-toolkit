/**
 * dsh-auto-recall —— 在每一步开始前，自动把"可能相关的记忆"塞进模型上下文。
 *
 * 为什么是插件而不是脚本：2026-10-25 我在改插件前，库里早有 L015「改完插件要重启」，
 * 但没有任何东西提醒我，白花 20 分钟。脚本要我主动敲，插件才叫"自动"。
 *
 * 钩子：agent/pre-step（每步都会触发；step===1 即每个用户回合的第一次请求）。
 * 注入：返回的 decision.messages 追加一条 UserMessage —— 这是 harness 允许的注入通道
 *      （同款做法见 dsh-agent 内部插件）。
 *
 * 安全：任何异常都吞掉并写日志，绝不让插件把会话搞挂。日志在 out/recall/auto.log。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = 'D:\\deepseek';
const LOG = path.join(ROOT, 'out', 'recall', 'auto.log');
// 影子开关（默认影子）：只有这个文件存在时才真正注入，否则只记日志。
// 2026-10-26：上次装上去直接开注入，"erro" 被塞了 3 条不对口的经验；
// 按 AGENTS.md 的重装前提，必须先只记日志跑一段、算准确率，再解锁注入。
const INJECT_FLAG = path.join(ROOT, 'out', 'recall', 'inject.on');
const LIMIT = 3;

function injecting() {
  try { return fs.existsSync(INJECT_FLAG); } catch { return false; }
}

function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch { /* 日志失败不能影响主流程 */ }
}

// ── 轻量检索：与 tools/memo.mjs 同规则（整词 3 分；中文退二元组；门槛 0.6） ──
const FILES = [
  ['LESSONS.md', 'L'],
  ['CORRECTIONS.md', 'C'],
  ['PREFERENCES.md', 'P'],
  ['PLAYBOOKS.md', 'B']
];

function loadItems() {
  const out = [];
  for (const [file, prefix] of FILES) {
    const fp = path.join(ROOT, file);
    if (!fs.existsSync(fp)) continue;
    const raw = fs.readFileSync(fp, 'utf8');
    const blocks = raw.split(new RegExp(`\\n(?=## \\[${prefix}\\d+\\])`)).filter((b) => new RegExp(`^## \\[${prefix}\\d+\\]`).test(b.trim()));
    for (const b of blocks) {
      const head = b.match(new RegExp(`^## \\[(${prefix}\\d+)\\]\\s*([^·]*)\\s*·\\s*(.+)$`, 'm'));
      if (!head) continue;
      out.push({ id: head[1], kind: prefix, title: head[3].trim(), body: b });
    }
  }
  return out;
}

const STOP_PHRASES = new Set([
  '之后', '之前', '什么', '不会', '不能', '可以', '需要', '如果', '因为', '所以',
  '但是', '这个', '那个', '现在', '已经', '一下', '怎么', '为什', '么做', '做的',
  '要么', '还是', '就是', '不是', '没有', '我们', '他们', '自己', '时候', '一个'
]);

/**
 * 英文虚词同样不能当证据（2026-10-26 加）：
 * 影子评估里 "now,there is a erro" 靠 "the"+"re" 两个片段凑够 hits=2，
 * 把 L006（ffmpeg xfade）拉了进来 —— 英文虚词的"命中"纯属巧合。
 */
const ASCII_STOP = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'has', 'had',
  'her', 'his', 'how', 'its', 'may', 'new', 'now', 'one', 'our', 'out', 'own', 'see',
  'the', 'two', 'use', 'was', 'way', 'who', 'why', 'will', 'with', 'this', 'that',
  'from', 'have', 'were', 'your', 'they', 'them', 'then', 'than', 'into', 'over',
  'also', 'than', 'only', 'just', 'some', 'more', 'most', 'very', 'here', 'there',
  'what', 'when', 'which', 'while', 'about', 'would', 'could', 'should', 'been'
]);

/**
 * 最长公共子串覆盖打分。
 * 为什么不用二元组/IDF：中文虚词会污染排名——2026-10-25 实测，"改插件之后要做什么"
 * 让 L035（ComfyUI 报错）靠"不会"两字排到 L015（改插件要重启）前面；
 * 改成连续子串后，命中"插件""下载很慢"这类实词短语才给高分。
 *
 * 2026-10-26 修两个真问题（用户实测"erro"被注入了 3 条不对口的经验）：
 *   ① ASCII 短串必须整词命中："erro" 不能靠 "error" 里的四个字母过关
 *   ② 返回 bestLen / hits，让上层能做"不够格就不注入"，而不是凑满 3 条
 */
function coverage(q, text) {
  if (!q || !text) return { score: 0, bestLen: 0, hits: 0 };
  let rest = q;
  let total = 0;
  let bestLen = 0;
  let hits = 0;
  for (let guard = 0; guard < 12; guard++) {
    let best = '';
    for (let i = 0; i < rest.length; i++) {
      for (let len = Math.min(12, rest.length - i); len >= 2; len--) {
        const sub = rest.slice(i, i + len);
        if (!text.includes(sub)) continue;
        const ascii = /^[a-z0-9]+$/.test(sub);
        if (ascii && sub.length < 3) continue; // "re"/"is"/"th" 两字母片段没有信息量
        // ASCII 短串只认整词：erro≠error，but 也算真实单词
        if (ascii && sub.length <= 5) {
          const re = new RegExp(`(^|[^a-z0-9])${sub}([^a-z0-9]|$)`);
          if (!re.test(text)) continue;
        }
        if (sub.length > best.length) best = sub;
        break;
      }
    }
    if (!best) break;
    const weight = STOP_PHRASES.has(best) || ASCII_STOP.has(best) ? 0.15 : 1;
    if (weight === 1) { hits++; bestLen = Math.max(bestLen, best.length); }
    total += weight * Math.pow(best.length, 1.5);
    rest = rest.replace(best, '\n');
  }
  return { score: total, bestLen, hits };
}

/** 够格的标准：一个 3+ 字实词，或两个 2 字词。宁可不注入，也不塞噪音。 */
function relevant(q, body, title) {
  const b = coverage(q, body);
  const t = coverage(q, title);
  const bestLen = Math.max(b.bestLen, t.bestLen);
  const hits = b.hits + t.hits;
  const score = b.score + 2 * t.score;
  const ok = bestLen >= 3 || hits >= 2;
  return { score, ok, bestLen, hits };
}

function recall(text, limit = LIMIT) {
  const items = loadItems();
  if (!items.length) return [];
  const raw = String(text).toLowerCase();
  const q = raw.replace(/\s+/g, '');
  if (q.length < 3) return []; // 两个字以内的输入没有检索价值（"？"、"好"、"1"）

  // 纯英文短查询不注入（2026-10-26 加）：
  // "erro" / "now,there is a erro" 这类输入最多给一条 4 字母的实词，任何匹配都是巧合。
  // 当天实测：L053（讲"erro 是噪音"那条）因为正文里带了这个例子，反过来被 "erro" 命中了。
  const hasCJK = /[\u4e00-\u9fa5]/.test(raw);
  if (!hasCJK) {
    const solid = (raw.match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 5 && !ASCII_STOP.has(w));
    if (!solid.length) return [];
  }

  return items
    .map((it) => {
      const r = relevant(q, it.body.toLowerCase(), it.title.toLowerCase());
      return { ...it, ...r };
    })
    .filter((it) => it.ok && it.score >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit); // 不补齐：够几条给几条
}

function oneLine(it) {
  const pick = (label) => {
    const m = it.body.match(new RegExp(`^- ${label}[:：]\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  return pick('修法') || pick('对做法') || pick('偏好') || pick('步骤') || '';
}

// ── 消息构造：从 profile 里解析 dsh-llm（插件是 file:// 加载，bare import 解析不到） ──
let _llm = null;
async function llm() {
  if (_llm) return _llm;
  const dir = process.env.DSH_PROFILE_DIR || path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'web');
  // 不能硬拼 node_modules 路径：dsh-llm 可能被 hoist 到别处。
  // 用 createRequire 以 profile 的 package.json 为锚点走 Node 解析算法。
  const req = createRequire(path.join(dir, 'package.json'));
  const resolved = req.resolve('@deepseek-ai/dsh-llm');
  _llm = await import(pathToFileURL(resolved).href);
  log('resolved dsh-llm: ' + resolved);
  return _llm;
}

function toText(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ');
  return '';
}

export function apply(ctx) {  log('plugin loaded v2.1 (shadow=' + !injecting() + ')');
  try {
    ctx.on('agent/pre-step', async ({ agent, messages, step, turn, signal }, next) => {
      const decision = await next();
      try {
        if (decision?.kind === 'reject' || signal?.aborted) return decision;
        if (step !== 1) return decision;
        const text = (messages || []).map(toText).join('\n').slice(0, 600);
        if (!text.trim()) return decision;

        const hits = recall(text);
        if (!hits.length) {
          log(`turn=${turn} step=${step} no-hit: ${text.slice(0, 60).replace(/\s+/g, ' ')}`);
          return decision;
        }

        const ids = hits.map((h) => h.id).join(',');
        // 把分数也记下来，影子期判断"够不够格"要看分布，不能只看命中
        const detail = hits.map((h) => `${h.id}:${Math.round(h.score)}/b${h.bestLen}`).join(' ');
        const head = `<- "${text.slice(0, 50).replace(/\s+/g, ' ')}"`;

        if (!injecting()) {
          log(`turn=${turn} step=${step} SHADOW ${ids} [${detail}] ${head}`);
          return decision;
        }

        const { createUserMessage } = await llm();
        const note = [
          `[auto-recall] 记忆里有 ${hits.length} 条可能相关，动手前先看一眼（命中请执行 node tools/memo.mjs hit <ID>）：`,
          ...hits.map((h) => `- ${h.id} [${h.kind}] ${h.title}${oneLine(h) ? '：' + oneLine(h).slice(0, 120) : ''}`)
        ].join('\n');

        const msg = createUserMessage({ content: [{ type: 'text', text: note }] });
        log(`turn=${turn} step=${step} INJECT ${ids} [${detail}] ${head}`);
        return { ...decision, messages: [...decision.messages, msg] };
      } catch (e) {
        log('pre-step error: ' + (e && e.message ? e.message : e));
        return decision;
      }
    });
    log('hook registered: agent/pre-step');
  } catch (e) {
    log('register failed: ' + (e && e.message ? e.message : e));
  }
}

export const __test = { recall, loadItems, coverage };

