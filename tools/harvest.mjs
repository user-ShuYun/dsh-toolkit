/**
 * harvest.mjs —— 一句话搜多个平台，回来一张候选表；**结果落盘，可复用**。
 *
 *   node tools/harvest.mjs "llm agent memory" --top 12 --since 365
 *   node tools/harvest.mjs "ppt automation" --sources github,hn,npm,arxiv
 *   node tools/harvest.mjs "agent 记忆" --sources bili,zhihu --refresh
 *
 * 三层设计：
 *   1) 广撒网：只拿「标题 + 指标 + 链接」，不读正文（便宜）
 *   2) 落盘：out/harvest/<slug>.json + .md，7 天内同关键词直接读缓存
 *   3) 深读：我再对 top 3~5 用 zhihu read / bili subs / yt-text 取正文
 *
 * 源分两类：
 *   API 源（无需浏览器）：github / hn / npm / arxiv / hf / v2ex
 *   浏览器源（需要 9222）：bili（需 bilibili 标签页）/ zhihu（自动开标签页）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = 'D:\\deepseek';
const OUT_DIR = path.join(ROOT, 'out', 'harvest');

const argv = process.argv.slice(2);
const query = argv.find((a) => !a.startsWith('--') && isNaN(Number(a)));
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const TOP = Number(arg('top', 10));
const SINCE = Number(arg('since', 730));
const REFRESH = argv.includes('--refresh');
const n = TOP;
const SOURCES = arg('sources', 'github,hn,bili,zhihu,youtube').split(',').map((s) => s.trim()).filter(Boolean);

if (!query) {
  console.log('用法: node tools/harvest.mjs "关键词" [--top 10] [--since 365] [--sources github,hn,npm,arxiv,hf,v2ex,bili,zhihu] [--refresh]');
  process.exit(0);
}

const slug = (query + '-' + SOURCES.join('+')).replace(/[^\w\u4e00-\u9fa5+-]+/g, '_').slice(0, 80);
const jsonPath = path.join(OUT_DIR, slug + '.json');
const mdPath = path.join(OUT_DIR, slug + '.md');

// ── 缓存 ──────────────────────────────────────────────────────
if (!REFRESH && fs.existsSync(jsonPath)) {
  const ageH = (Date.now() - fs.statSync(jsonPath).mtimeMs) / 3600000;
  if (ageH < 24 * 7) {
    const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`（缓存：${Math.round(ageH)} 小时前，${cached.rows.length} 条 → ${jsonPath}；要重搜加 --refresh）\n`);
    render(cached.rows, cached.query, cached.since);
    process.exit(0);
  }
}

const UA = { 'user-agent': 'dsh-harvest/1.1', accept: 'application/json' };
const cutoff = Date.now() - SINCE * 86400000;
const now = Date.now();
const daysAgo = (d) => (d ? Math.round((now - new Date(d).getTime()) / 86400000) : 9999);
const fresh = (d) => (d ? new Date(d).getTime() >= cutoff : true);

const rowsAll = [];
const failures = [];
const push = (o) => { if (fresh(o.date)) rowsAll.push(o); };

async function j(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** 调本地脚本（bili/zhihu），返回 stdout */
async function local(args, timeout = 60000) {
  const { stdout } = await exec(process.execPath, args, { cwd: ROOT, timeout, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

const tasks = [];

if (SOURCES.includes('github')) tasks.push((async () => {
  const d = await j(`https://api.github.com/search/repositories?q=${encodeURIComponent(query + ' in:name,description')}&sort=stars&order=desc&per_page=6`);
  for (const x of d.items || []) push({ src: 'GitHub', title: x.full_name, note: (x.description || '').slice(0, 70), metric: x.stargazers_count + '★', date: x.pushed_at, url: x.html_url });
})());

if (SOURCES.includes('hn')) tasks.push((async () => {
  const d = await j(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=8`);
  for (const x of d.hits || []) push({ src: 'HN', title: x.title, note: '', metric: (x.points || 0) + '分', date: x.created_at, url: x.url || `https://news.ycombinator.com/item?id=${x.objectID}` });
})());

if (SOURCES.includes('npm')) tasks.push((async () => {
  const d = await j(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=6`);
  for (const o of d.objects || []) {
    const p = o.package;
    push({ src: 'npm', title: p.name, note: (p.description || '').slice(0, 60), metric: (o.score?.final || 0).toFixed(2) + '分', date: p.date, url: p.links?.npm || '' });
  }
})());

if (SOURCES.includes('arxiv')) tasks.push((async () => {
  const r = await fetch(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=5`, { signal: AbortSignal.timeout(15000) });
  const xml = await r.text();
  for (const e of xml.split('<entry>').slice(1)) {
    const t = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const id = (e.match(/<id>([\s\S]*?)<\/id>/) || [])[1] || '';
    const pub = (e.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || '';
    push({ src: 'arXiv', title: t.replace(/\s+/g, ' ').trim(), note: '', metric: 'paper', date: pub, url: id.trim() });
  }
})());

if (SOURCES.includes('hf')) tasks.push((async () => {
  const d = await j(`https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=6&sort=downloads&direction=-1`);
  for (const m of d || []) push({ src: 'HF', title: m.modelId || m.id, note: '', metric: (m.downloads || 0) + '下载', date: m.lastModified, url: 'https://huggingface.co/' + (m.modelId || m.id) });
})());

if (SOURCES.includes('v2ex')) tasks.push((async () => {
  const d = await j(`https://www.sov2ex.com/api/search?q=${encodeURIComponent(query)}&size=6`);
  for (const h of d.hits || []) {
    const s = h._source || {};
    push({ src: 'V2EX', title: s.title, note: '', metric: (s.replies || 0) + '回复', date: s.created, url: 'https://www.v2ex.com/t/' + (s.tid || h._id || '') });
  }
})());

if (SOURCES.includes('youtube')) tasks.push((async () => {
  const { stdout } = await exec('yt-dlp', ['--flat-playlist', '--dump-json', '--no-warnings', `ytsearch${Math.max(n, 6)}:${query}`], { timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    push({
      src: 'YouTube',
      title: j.title || '',
      note: j.channel || j.uploader || '',
      metric: j.duration ? Math.round(j.duration) + 's' : '',
      date: j.timestamp ? new Date(j.timestamp * 1000).toISOString() : null,
      url: 'https://www.youtube.com/watch?v=' + j.id
    });
  }
})());

if (SOURCES.includes('bili')) tasks.push((async () => {
  const out = await local(['tools/bili.mjs', 'search', query, '8']);
  for (const line of out.split('\n')) {
    const c = line.split('\t');
    if (c.length < 6 || !/^BV/.test(c[0])) continue;
    push({ src: 'B站', title: (c[1] || '').replace(/<[^>]+>/g, ''), note: c[2] || '', metric: c[3] || '', date: null, url: 'https://www.bilibili.com/video/' + c[0] });
  }
})());

if (SOURCES.includes('zhihu')) tasks.push((async () => {
  const out = await local(['tools/zhihu.mjs', 'search', query, '6'], 90000);
  const tsv = out.split('---TSV---')[1] || '';
  for (const line of tsv.split('\n')) {
    const c = line.split('\t');
    if (c.length < 4 || !c[3]) continue;
    push({ src: '知乎', title: c[0], note: (c[1] !== '-' ? c[1] + ' · ' : '') + (c[2] || ''), metric: '', date: null, url: c[3] });
  }
})());

const settled = await Promise.allSettled(tasks);
settled.forEach((r, i) => { if (r.status === 'rejected') failures.push(String(r.reason?.message || r.reason).slice(0, 80)); });

// ── 排序 & 渲染 ───────────────────────────────────────────────
const bySrc = new Map();
for (const r of rowsAll) {
  if (!bySrc.has(r.src)) bySrc.set(r.src, []);
  bySrc.get(r.src).push(r);
}
for (const list of bySrc.values()) {
  list.sort((a, b) => {
    const na = parseFloat(String(a.metric).replace(/[^\d.]/g, '')) || 0;
    const nb = parseFloat(String(b.metric).replace(/[^\d.]/g, '')) || 0;
    return nb - na || daysAgo(a.date) - daysAgo(b.date);
  });
}

function render(rows, q, sinceDays) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.src)) groups.set(r.src, []);
    groups.get(r.src).push(r);
  }
  const perSrc = Math.max(2, Math.round(TOP / Math.max(1, groups.size)));
  console.log(`「${q}」— ${rows.length} 条 / ${groups.size} 个来源（窗口 ${sinceDays} 天，每源最多 ${perSrc} 条）\n`);
  for (const [src, list] of groups) {
    console.log(`── ${src} ──`);
    for (const r of list.slice(0, perSrc)) {
      const age = r.date ? daysAgo(r.date) : null;
      console.log(`  ${String(r.metric || '').padEnd(9)} ${age === null ? '  --' : String(age).padStart(3) + '天前'}  ${r.title}`);
      if (r.note) console.log(`  ${' '.repeat(21)}${r.note}`);
      if (r.url) console.log(`  ${' '.repeat(21)}${r.url}`);
    }
    console.log('');
  }
}

render(rowsAll, query, SINCE);
if (failures.length) console.log('（部分源失败：' + [...new Set(failures)].join(' / ') + '）');
if (!rowsAll.length) { console.log('没结果——换关键词，或加 --since 730'); process.exit(0); }

// ── 落盘 ─────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify({ query, since: SINCE, sources: SOURCES, at: new Date().toISOString(), failures, rows: rowsAll }, null, 2), 'utf8');

const md = [
  `# harvest: ${query}`,
  '',
  `- 时间: ${new Date().toISOString()}`,
  `- 来源: ${SOURCES.join(', ')}`,
  `- 条数: ${rowsAll.length}`,
  failures.length ? `- 失败源: ${[...new Set(failures)].join(' / ')}` : '',
  '',
  '| 源 | 指标 | 标题 | 备注 | 链接 |',
  '|---|---|---|---|---|',
  ...rowsAll.map((r) => `| ${r.src} | ${r.metric || ''} | ${String(r.title).replace(/\|/g, '\\|')} | ${String(r.note || '').replace(/\|/g, '\\|').slice(0, 80)} | ${r.url || ''} |`)
].filter(Boolean).join('\n');
fs.writeFileSync(mdPath, md + '\n', 'utf8');

console.log(`已存: ${jsonPath}`);
console.log(`     ${mdPath}`);
