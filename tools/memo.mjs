/**
 * memo.mjs —— 四库统一入口：经验(坑) / 纠正 / 偏好 / 打法。
 *
 * 为什么不塞进 LESSONS.md：四类信息的**生命周期不一样**。
 *   坑会过期（30 天没命中就该清）；纠正会被更好的纠正覆盖；
 *   偏好只在你撤销时改；打法要拿结果证据说话。混在一起，淘汰规则就会互相打架。
 *
 * 用法:
 *   node tools/memo.mjs add --kind correction --title "研究类问题先用工具箱" --scene "需要外部信息" \
 *        --wrong "只用内置 web 搜索" --right "先 channels 自检，再按渠道检索 B站/YouTube/GitHub/知乎/GPT" --evidence "..."
 *   node tools/memo.mjs add --kind preference --title "..." --pref "..." --trigger "..." --source "..."
 *   node tools/memo.mjs add --kind playbook  --title "..." --goal "..." --steps "1)... 2)..." --when "..." --result "..."
 *   node tools/memo.mjs list [--kind correction|preference|playbook|lesson]
 *   node tools/memo.mjs search "关键词" [--limit 5]
 *   node tools/memo.mjs recall "这个任务/这段报错"     # 给 preflight 和现场用，输出 ≤3 条
 *   node tools/memo.mjs hit C001
 *   node tools/memo.mjs stats
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\deepseek';
const KIND = {
  lesson: { file: 'LESSONS.md', prefix: 'L', label: '经验(坑)' },
  correction: { file: 'CORRECTIONS.md', prefix: 'C', label: '纠正' },
  preference: { file: 'PREFERENCES.md', prefix: 'P', label: '偏好' },
  playbook: { file: 'PLAYBOOKS.md', prefix: 'B', label: '打法' }
};

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (n) => argv.includes('--' + n);

function ensure(kind) {
  const { file, prefix } = KIND[kind];
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    const head = kind === 'lesson'
      ? '# LESSONS · 经验库\n\n> 技术坑。格式: `## [L###] 日期 · 标签 · 一句话` + 症状/原因/修法/证据/命中\n'
      : kind === 'correction'
        ? '# CORRECTIONS · 用户纠正\n\n> 我理解错 / 做错时，用户纠正了什么。**纠正优先于旧经验。**\n> 格式: `## [C###] 日期 · 场景` + 错做法/对做法/证据/命中\n'
        : kind === 'preference'
          ? '# PREFERENCES · 操作偏好\n\n> 用户明确表达的做法偏好。按场景触发，不按时间淘汰。\n> 格式: `## [P###] 日期 · 主题` + 偏好/触发场景/来源/命中\n'
          : '# PLAYBOOKS · 成功路径\n\n> 走通过且可复用的打法。复现失败或环境变更即降级。\n> 格式: `## [B###] 日期 · 目标` + 步骤/适用条件/结果证据/命中\n';
    fs.writeFileSync(p, head + '\n', 'utf8');
  }
  return p;
}

function parse(kind) {
  const p = ensure(kind);
  const raw = fs.readFileSync(p, 'utf8');
  const { prefix } = KIND[kind];
  const blocks = raw.split(new RegExp(`\\n(?=## \\[${prefix}\\d+\\])`)).filter((b) => new RegExp(`^## \\[${prefix}\\d+\\]`).test(b.trim()));
  return blocks.map((b) => {
    const head = b.match(new RegExp(`^## \\[(${prefix}\\d+)\\]\\s*([^·]*)\\s*·\\s*(.+)$`, 'm')) || [];
    const field = (name) => {
      // `$(?![\s\S])` 才是字符串结尾；m 模式下光写 $ 会让字段值在第一行行尾就截断（L056 同类坑）
      const m = b.match(new RegExp(`^- ${name}[:：]\\s*([\\s\\S]*?)(?=\\n- |$(?![\\s\\S]))`, 'm'));
      return m ? m[1].trim() : '';
    };
    return {
      kind,
      id: head[1] || '?',
      date: (head[2] || '').trim(),
      title: (head[3] || '').trim(),
      tag: field('标签'),
      symptom: field('症状'),
      cause: field('原因'),
      fix: field('修法'),
      evidence: field('证据'),
      hit: Number(field('命中') || 0),
      confidence: field('可信度') || '已验证',
      review: field('复核') || '',
      body: b
    };
  });
}

function all() {
  return Object.keys(KIND).flatMap((k) => parse(k));
}

function nextId(kind) {
  const p = ensure(kind);
  const raw = fs.readFileSync(p, 'utf8');
  const { prefix } = KIND[kind];
  const ids = [...raw.matchAll(new RegExp(`## \\[${prefix}(\\d+)\\]`, 'g'))].map((m) => Number(m[1]));
  return prefix + String((ids.length ? Math.max(...ids) : 0) + 1).padStart(3, '0');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

if (cmd === 'add') {
  const kind = arg('kind', 'correction');
  if (!KIND[kind]) { console.error('--kind 只能是 ' + Object.keys(KIND).join('|')); process.exit(1); }
  const title = arg('title', '');
  if (!title) { console.error('--title 必填'); process.exit(1); }
  const id = nextId(kind);
  const lines = [`## [${id}] ${today()} · ${title}`];
  if (kind === 'lesson') {
    lines.push(`- 症状: ${arg('symptom', '—')}`, `- 原因: ${arg('cause', '—')}`, `- 修法: ${arg('fix', '—')}`, `- 证据: ${arg('evidence', '—')}`);
  } else if (kind === 'correction') {
    lines.push(`- 场景: ${arg('scene', '—')}`, `- 错做法: ${arg('wrong', '—')}`, `- 对做法: ${arg('right', '—')}`, `- 证据: ${arg('evidence', '—')}`);
  } else if (kind === 'preference') {
    lines.push(`- 偏好: ${arg('pref', '—')}`, `- 触发场景: ${arg('trigger', '—')}`, `- 来源: ${arg('source', '—')}`);
  } else {
    lines.push(`- 目标: ${arg('goal', '—')}`, `- 步骤: ${arg('steps', '—')}`, `- 适用条件: ${arg('when', '—')}`, `- 结果证据: ${arg('result', '—')}`);
  }
  // 可信度 + 复核日期：人记得"我可能记错了"，它得靠字段
  const confidence = arg('confidence', '已验证');
  const days = { lesson: 180, correction: 365, preference: 365, playbook: 90 }[kind] || 180;
  const review = arg('review', new Date(Date.now() + days * 86400000).toISOString().slice(0, 10));
  lines.push(`- 可信度: ${confidence}`, `- 复核: ${review}`, '- 命中: 0');
  fs.appendFileSync(ensure(kind), '\n' + lines.join('\n') + '\n', 'utf8');
  console.log(`已记录 ${id} · ${title} → ${KIND[kind].file}`);
  process.exit(0);
}

if (cmd === 'list') {
  const kind = arg('kind', '');
  const kinds = kind ? [kind] : Object.keys(KIND);
  for (const k of kinds) {
    const items = parse(k);
    console.log(`\n── ${KIND[k].label}（${items.length}）──`);
    for (const it of items) console.log(`  ${it.id}  ${it.date}  ${it.title}${it.hit ? '  ·命中' + it.hit : ''}`);
  }
  console.log('');
  process.exit(0);
}

/** 中文按二元组切：让"改插件/要不要重启"能匹配到"改完插件要重装并重启" */
function grams(t) {
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function score(item, terms) {
  // 整条正文都参与匹配：纠正/偏好/打法的关键信息在「错做法/对做法/偏好/步骤」里，
  // 只看 title/symptom 会永远搜不到它们。
  const hay = item.body.toLowerCase();
  let base = 0;
  for (const t of terms) {
    if (!t) continue;
    const low = t.toLowerCase();
    if (hay.includes(low)) { base += 3; continue; }
    // 整词没命中就退到二元组，覆盖中文口语化查询（2026-10-25 实测：整词匹配导致 recall 全空）
    if (/[\u4e00-\u9fa5]/.test(low) && low.length >= 2) {
      const gs = grams(low);
      let hit = 0;
      for (const g of gs) if (hay.includes(g)) hit++;
      if (hit) base += Math.min(hit * 0.8, 2);
    }
  }
  if (base < 0.6) return 0; // 门槛：单个二元组的偶然命中不算数，但"下载很慢"这种短查询要能过
  return base + (item.hit || 0) * 0.2;
}

/** 同义词表：解决"换个说法就搜不到"（人会自动联想，它只能靠这张表） */
const SYNONYMS = {
  下载: ['下载', '网速', '拉取', 'fetch', '分片'],
  重启: ['重启', '重开', '重新启动', '生效'],
  插件: ['插件', '扩展', 'plugin'],
  乱码: ['乱码', '编码', 'utf8', 'utf-8'],
  报错: ['报错', '错误', '失败', 'error'],
  变脸: ['变脸', '漂移', '换人', '一致性'],
  总结: ['总结', '摘要', '归纳'],
  检索: ['检索', '搜索', '查找'],
  输入框: ['输入框', '光标', '填不进', 'textarea', '编辑器'],
  记忆: ['记忆', '经验', '知识库', 'lesson']
};

/** 查询扩展：查询里出现组内**任意一个词**（不只是主词）就整组带出。
 *  2026-10-26 实测：只按主词匹配时，"网速 慢" 不会扩展到"下载"，直接搜不到。 */
function expand(kw) {
  const raw = String(kw).toLowerCase();
  const out = new Set(raw.split(/[\s,，。、/]+/).filter((x) => x.length >= 2));
  for (const [k, list] of Object.entries(SYNONYMS)) {
    if (raw.includes(k) || list.some((w) => raw.includes(w))) {
      out.add(k);
      for (const w of list) out.add(w);
    }
  }
  return [...out];
}

function search(kw, limit = 5) {
  const terms = expand(kw);
  const rows = all()
    .map((it) => ({ ...it, score: score(it, terms) }))
    .filter((it) => it.score > 0)
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  return rows.slice(0, limit);
}

function show(it) {
  const overdue = it.review && it.review < new Date().toISOString().slice(0, 10);
  const mark = `${it.confidence === '推测' ? '  ⚠️推测' : ''}${overdue ? '  ⏰复核过期(' + it.review + ')' : ''}`;
  const lines = [`${it.id} [${KIND[it.kind].label}] ${it.title}${mark}`];
  if (it.symptom) lines.push(`  症状: ${it.symptom.slice(0, 120)}`);
  if (it.fix) lines.push(`  修法: ${it.fix.slice(0, 160)}`);
  if (it.evidence && it.kind !== 'lesson') lines.push(`  证据: ${it.evidence.slice(0, 120)}`);
  const wrong = it.body.match(/^- 错做法[:：]\s*(.+)$/m);
  const right = it.body.match(/^- 对做法[:：]\s*(.+)$/m);
  if (wrong) lines.push(`  错: ${wrong[1].slice(0, 100)}`);
  if (right) lines.push(`  对: ${right[1].slice(0, 140)}`);
  const pref = it.body.match(/^- 偏好[:：]\s*(.+)$/m);
  if (pref) lines.push(`  偏好: ${pref[1].slice(0, 140)}`);
  const steps = it.body.match(/^- 步骤[:：]\s*(.+)$/m);
  if (steps) lines.push(`  步骤: ${steps[1].slice(0, 140)}`);
  return lines.join('\n');
}

if (cmd === 'search') {
  const kw = argv[1] || '';
  const rows = search(kw, Number(arg('limit', 5)));
  if (!rows.length) { console.log('没有命中。'); process.exit(0); }
  console.log(`「${kw}」— ${rows.length} 条\n`);
  for (const it of rows) console.log(show(it) + '\n');
  process.exit(0);
}

if (cmd === 'recall') {
  const kw = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ');
  const rows = search(kw, Number(arg('limit', 3)));
  if (!rows.length) { console.log('（没有相关经验）'); process.exit(0); }
  console.log('可能相关的经验（最多 3 条）:');
  for (const it of rows) console.log('  ' + show(it).replace(/\n/g, '\n  '));
  process.exit(0);
}

if (cmd === 'verify') {
  const id = (argv[1] || '').toUpperCase();
  const kind = Object.keys(KIND).find((k) => KIND[k].prefix === id[0]);
  if (!kind) { console.error('未知 ID: ' + id); process.exit(1); }
  const p = ensure(kind);
  let raw = fs.readFileSync(p, 'utf8');
  const blockRe = new RegExp(`(## \\[${id}\\][\\s\\S]*?)(?=\\n## \\[|$)`);
  const m = raw.match(blockRe);
  if (!m) { console.error('没找到 ' + id); process.exit(1); }
  const days = { lesson: 180, correction: 365, preference: 365, playbook: 90 }[kind] || 180;
  const next = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  let body = m[1];
  body = /- 可信度[:：]/.test(body) ? body.replace(/- 可信度[:：].*/g, '- 可信度: 已验证') : body.replace(/\n?$/, '\n- 可信度: 已验证');
  body = /- 复核[:：]/.test(body) ? body.replace(/- 复核[:：].*/g, '- 复核: ' + next) : body.replace(/\n?$/, '\n- 复核: ' + next);
  raw = raw.replace(blockRe, body);
  fs.writeFileSync(p, raw, 'utf8');
  console.log(`${id} → 已验证，复核延到 ${next}`);
  process.exit(0);
}

if (cmd === 'hit') {
  const id = (argv[1] || '').toUpperCase();
  const kind = Object.keys(KIND).find((k) => KIND[k].prefix === id[0]);
  if (!kind) { console.error('未知 ID: ' + id); process.exit(1); }
  const p = ensure(kind);
  const raw = fs.readFileSync(p, 'utf8');
  const re = new RegExp(`(## \\[${id}\\][\\s\\S]*?- 命中[:：]\\s*)(\\d+)`);
  const m = raw.match(re);
  if (!m) { console.error('没找到 ' + id); process.exit(1); }
  const n = Number(m[2]) + 1;
  fs.writeFileSync(p, raw.replace(re, '$1' + n), 'utf8');
  console.log(`${id} 命中 → ${n}`);
  process.exit(0);
}

if (cmd === 'stats' || !cmd) {
  const counts = Object.keys(KIND).map((k) => {
    const items = parse(k);
    return `${KIND[k].label} ${items.length} 条（有命中 ${items.filter((i) => i.hit > 0).length}）`;
  });
  console.log('记忆库: ' + counts.join(' · '));
  process.exit(0);
}

console.log('用法: node tools/memo.mjs add|list|search|recall|hit|stats');
