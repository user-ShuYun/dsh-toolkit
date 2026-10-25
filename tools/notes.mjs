/**
 * notes.mjs —— 把视频总结存成 Markdown 笔记，并生成可检索的索引。
 *
 * 目录结构：
 *   D:\deepseek\notes\<UP主>\<日期>-<标题>.md
 *   D:\deepseek\notes\INDEX.md            总目录（自动重写）
 *
 * 命令行：
 *   node tools/notes.mjs list                列出全部
 *   node tools/notes.mjs search <关键词>       按标题/UP/正文搜
 *   node tools/notes.mjs open <序号>          打印某条路径
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'D:\\deepseek\\notes';

/** Windows 文件名净化 */
function safeName(s, max = 60) {
  const cleaned = String(s || 'untitled')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned.length > max ? cleaned.slice(0, max) : cleaned) || 'untitled';
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 存一条笔记。
 * @param {{title,up,bvid,url,duration,view,source,summary,transcript}} n
 * @returns {{path:string, rel:string}}
 */
export function saveNote(n) {
  const date = n.date || today();
  const dir = join(ROOT, safeName(n.up || '未知UP', 40));
  mkdirSync(dir, { recursive: true });

  const file = join(dir, `${date}-${safeName(n.title, 50)}.md`);
  const lines = [
    '---',
    `title: ${JSON.stringify(n.title || '')}`,
    `up: ${JSON.stringify(n.up || '')}`,
    `bvid: ${n.bvid || ''}`,
    `url: ${n.url || ''}`,
    `duration: ${n.duration ?? ''}`,
    `view: ${n.view ?? ''}`,
    `source: ${JSON.stringify(n.source || '')}`,
    `saved: ${new Date().toISOString()}`,
    '---',
    '',
    `# ${n.title || '未命名'}`,
    '',
    `> **UP**：${n.up || '—'}　**时长**：${n.duration ?? '—'} 分钟　**播放**：${n.view ?? '—'}　**字幕来源**：${n.source || '—'}`,
    '',
    `[原视频](${n.url || ''})`,
    '',
    '## 总结',
    '',
    (n.summary || '(未生成)').trim(),
    ''
  ];

  if (n.transcript) {
    lines.push('---', '', '<details><summary>原始字幕（点开）</summary>', '', '```text', n.transcript.trim(), '```', '', '</details>', '');
  }

  writeFileSync(file, lines.join('\n'), 'utf8');
  rebuildIndex();
  return { path: file, rel: relative(ROOT, file).replace(/\\/g, '/') };
}

/** 扫描所有笔记（读 front matter） */
export function listNotes() {
  if (!existsSync(ROOT)) return [];
  const out = [];
  for (const up of readdirSync(ROOT)) {
    const d = join(ROOT, up);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md')) continue;
      const p = join(d, f);
      const head = readFileSync(p, 'utf8').slice(0, 800);
      const get = (k) => {
        const m = new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(head);
        if (!m) return '';
        return m[1].replace(/^"|"$/g, '');
      };
      out.push({
        up,
        file: f,
        path: p,
        title: get('title') || f.replace(/\.md$/, ''),
        bvid: get('bvid'),
        url: get('url'),
        duration: get('duration'),
        view: get('view'),
        saved: get('saved')
      });
    }
  }
  return out.sort((a, b) => String(b.saved).localeCompare(String(a.saved)));
}

/** 重写 INDEX.md */
export function rebuildIndex() {
  const all = listNotes();
  mkdirSync(ROOT, { recursive: true });
  const byUp = new Map();
  for (const n of all) {
    if (!byUp.has(n.up)) byUp.set(n.up, []);
    byUp.get(n.up).push(n);
  }
  const lines = ['# 视频笔记索引', '', `共 **${all.length}** 条 · 更新于 ${new Date().toLocaleString('zh-CN')}`, ''];
  for (const [up, items] of [...byUp.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${up}（${items.length}）`, '');
    for (const n of items.slice(0, 200)) {
      // 文件名里有中文/全角符号，用 <> 包起来，CommonMark 允许这种写法
      const link = `<./${n.up}/${n.file}>`;
      lines.push(`- [${n.title}](${link})　${n.duration ? n.duration + ' 分钟' : ''} ${n.view ? '· ▶' + n.view : ''}`);
    }
    lines.push('');
  }
  writeFileSync(join(ROOT, 'INDEX.md'), lines.join('\n'), 'utf8');
  return all.length;
}

/** 全文搜索 */
export function searchNotes(kw) {
  const q = String(kw || '').toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const n of listNotes()) {
    const body = readFileSync(n.path, 'utf8');
    const inTitle = n.title.toLowerCase().includes(q) || n.up.toLowerCase().includes(q);
    const idx = body.toLowerCase().indexOf(q);
    if (!inTitle && idx < 0) continue;
    const snippet = idx >= 0 ? body.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ') : '';
    hits.push({ ...n, snippet });
  }
  return hits;
}

// ---------- CLI ----------
const isCli = process.argv[1] && /notes\.mjs$/.test(process.argv[1]);
if (isCli) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const n of listNotes()) console.log(`${n.up}\t${n.title}\t${n.duration || ''}min\t${n.path}`);
    console.log(`\n共 ${listNotes().length} 条`);
  } else if (cmd === 'search') {
    const hits = searchNotes(rest.join(' '));
    for (const h of hits) console.log(`${h.up} | ${h.title}\n  ${h.path}\n  …${h.snippet}…\n`);
    console.log(`命中 ${hits.length} 条`);
  } else if (cmd === 'index') {
    console.log('已重建索引，共', rebuildIndex(), '条');
  } else {
    console.log('用法: node tools/notes.mjs list|search <kw>|index');
  }
}
