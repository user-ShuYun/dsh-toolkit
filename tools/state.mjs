/**
 * state.mjs —— 生成/更新 notes/现在.md：跨会话的「工作记忆」。
 *
 * 为什么需要：每次新会话我只有 AGENTS.md + 经验库，**不知道我们停在哪儿**。
 * 2026-10-25 那次，用户隔三小时回来问"为什么点经验插件失败"，我第一步是查 PID——
 * 因为没有任何地方写着"上次改到哪、卡在哪、下一步是什么"。
 *
 * 用法:
 *   node tools/state.mjs                          # 只看，不写
 *   node tools/state.mjs --write                  # 写 notes/现在.md
 *   node tools/state.mjs --write --next "重启 dsh web 后验证经验按钮"
 *   node tools/state.mjs --hours 12               # 统计最近 12 小时改动的文件
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\deepseek';
const OUT = path.join(ROOT, 'notes', '现在.md');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const HOURS = Number(arg('hours', 6));
const NEXT = arg('next', '');

const SKIP = /node_modules|\.git|out\\harvest|out\\workflows|__pycache__|\.venv|venv|edge-cgpt|\\Default\\|\.dsh/i;
const TEXTY = /\.(md|mjs|js|json|ps1|txt|yml|yaml)$/i;

function recentFiles() {
  const cutoff = Date.now() - HOURS * 3600000;
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (SKIP.test(p)) continue;
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (st.mtimeMs >= cutoff && TEXTY.test(p)) out.push({ p, rel: p.replace(ROOT + '\\', ''), mt: st.mtimeMs, kb: st.size / 1024 });
    }
  };
  walk(ROOT, 0);
  return out.sort((a, b) => b.mt - a.mt).slice(0, 12);
}

function parseFile(file, prefix, label) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8');
  return [...raw.matchAll(new RegExp(`^## \\[(${prefix}\\d+)\\]\\s*([^·]*)\\s*·\\s*(.+)$`, 'gm'))]
    .map((m) => ({ id: m[1], date: m[2].trim(), title: m[3].trim(), label }))
    .reverse();
}

const files = recentFiles();

// 最近会话（读 sessions.mjs 建好的索引；没建就跳过，不阻塞）
let sessions = [];
try {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'sessions', 'index.json'), 'utf8'));
  sessions = Object.values(idx.items)
    .filter((s) => s.cwd === ROOT)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2);
} catch { /* 索引还没建 */ }

const lessons = parseFile('LESSONS.md', 'L', '经验').slice(0, 3);
const memos = [
  ...parseFile('CORRECTIONS.md', 'C', '纠正'),
  ...parseFile('PREFERENCES.md', 'P', '偏好'),
  ...parseFile('PLAYBOOKS.md', 'B', '打法')
].slice(0, 4);

const now = new Date();
const stamp = now.toLocaleString('zh-CN', { hour12: false });
const lines = [
  '# 现在',
  '',
  `> 自动生成，最后更新 ${stamp}。新会话开工先读这一页，再读经验库。`,
  '> 重新生成：`node tools/state.mjs --write --next "下一步动作"`',
  '',
  '## 最近改动',
  ...(files.length ? files.map((f) => `- \`${f.rel}\`  ${Math.round(f.kb)} KB`) : ['- （无）']),
  '',
  '## 最近经验',
  ...(lessons.length ? lessons.map((l) => `- ${l.id} ${l.date} ${l.title}`) : ['- （无）']),
  '',
  '## 最近会话',
  ...(sessions.length
    ? sessions.map((s) => {
        const when = new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false });
        const q = (s.prompts.find((p) => p.length > 8) || '').slice(0, 80);
        return `- ${when} ${s.origin === 'subagent' ? '子代理' : '主会话'}（${s.toolCalls} 次工具）${q ? '：' + q : ''}`;
      })
    : ['- （会话索引未建：node tools/sessions.mjs index）']),
  '',
  '## 纠正 / 偏好 / 打法',
  ...(memos.length ? memos.map((m) => `- ${m.id} [${m.label}] ${m.title}`) : ['- （无）']),
  '',
  '## 下一步',
  NEXT ? `- ${NEXT}` : '- （未填写）用 `--next` 指定，或在下面手写',
  ''
].join('\n');

if (WRITE) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines, 'utf8');
  console.log('已写 ' + OUT);
  console.log(`（${files.length} 个最近文件 / ${lessons.length} 条经验 / ${memos.length} 条纠偏）`);
} else {
  console.log(lines);
}
