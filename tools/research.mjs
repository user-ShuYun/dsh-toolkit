/**
 * research.mjs —— 给一个关键词，把「本地能查到的」先扫一遍，生成调研草稿。
 *
 * 设计取舍（重要）：
 *   - 本地笔记、B 站：能自动查（B 站需要 9222 的浏览器在跑）
 *   - 通用网页检索：**CLI 里做不到**（没有 web_search 能力），留占位给 Agent 用 web_search 补
 *   ——与其假装能全网检索，不如把能做的做扎实，剩下的明确写「待补」
 *
 * 用法:
 *   node tools/research.mjs "AI 短片 工作流"
 *   node tools/research.mjs "关键词" --limit 6 --no-bili
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = 'D:\\deepseek';
const NODE = process.execPath;
const argv = process.argv.slice(2);
const kw = argv.find((a) => !a.startsWith('--'));
if (!kw) {
  console.log('用法: node tools/research.mjs "关键词" [--limit 6] [--no-bili]');
  process.exit(1);
}
const flagNum = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};
const LIMIT = flagNum('limit', 6);
const NO_BILI = argv.includes('--no-bili');

const run = (args) => {
  const r = spawnSync(NODE, args, { encoding: 'utf8', timeout: 120000 });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};

console.log(`关键词：${kw}\n`);

// ① 本地笔记
const notesRes = run([path.join(ROOT, 'tools', 'notes.mjs'), 'search', kw]);
const noteLines = notesRes.out.split('\n').filter((l) => l.includes('.md') || l.startsWith('  …'));
console.log(`本地笔记：${notesRes.ok ? (noteLines.length ? '有命中' : '没命中') : '查询失败'}`);

// ② B 站
let biliRes = { ok: false, out: '跳过' };
if (!NO_BILI) {
  biliRes = run([path.join(ROOT, 'tools', 'bili.mjs'), 'search', kw, String(LIMIT)]);
  console.log(`B 站：${biliRes.ok ? '已检索' : '不可用（9222 的浏览器没开）'}`);
} else {
  console.log('B 站：按参数跳过');
}

// ③ 落盘
const date = new Date();
const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const safe = kw.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
const dir = path.join(ROOT, 'notes', '调研');
fs.mkdirSync(dir, { recursive: true });
const outFile = path.join(dir, `${stamp}-${safe}.md`);

const body = [
  `# 调研：${kw}`,
  '',
  `> ${new Date().toISOString()} 由 tools/research.mjs 生成。**待 Agent 用 web_search 补全网部分。**`,
  '',
  '## 本地已有',
  '',
  notesRes.ok && noteLines.length ? '```\n' + noteLines.join('\n') + '\n```' : '（无命中）',
  '',
  '## B 站',
  '',
  biliRes.ok ? '```\n' + biliRes.out.split('\n').slice(0, 40).join('\n') + '\n```' : `（${biliRes.out.trim().slice(0, 120)}）`,
  '',
  '## 待补：全网检索',
  '',
  '- [ ] web_search 三组查询：`' + kw + '` / `' + kw + ' 教程` / `' + kw + ' 对比`',
  '- [ ] 取前 3 条深读（web_fetch）',
  '- [ ] 结论先行 + 3~5 条可执行项',
  ''
].join('\n');

fs.writeFileSync(outFile, body, 'utf8');
console.log(`\n已生成草稿：${outFile}`);
console.log('下一步：Agent 用 web_search 补「待补」那段，再补结论。');
