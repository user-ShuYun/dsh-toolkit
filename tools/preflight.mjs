/**
 * preflight.mjs —— 开工一条命令。
 *
 * 为什么要有它：AGENTS.md 里原来写的是「开工三件事」，但那是**文档提醒**，
 * 没人执行就等于没有。这里把三件事压成一条命令，跑一次就拿到：
 *   ① 环境体检（ComfyUI / 浏览器控制台 / GPT 控制台 是否在跑）
 *   ② 经验库现状（条数、体积、草稿）
 *   ③ 全库目录（只出标题，约 1.5 KB，正文按需读）
 *   ④ 最近新增的 3 条经验
 *
 * 用法: node tools/preflight.mjs [--full]
 *   --full  连正文摘要一起（约 8 KB），一般不用
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const ROOT = 'D:\\deepseek';
const argv = process.argv.slice(2);
const FULL = argv.includes('--full');

function kb(p) {
  try { return Math.round(fs.statSync(p).size / 1024 * 10) / 10; } catch { return 0; }
}

function probe(port, timeout = 400) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

const lessonsPath = path.join(ROOT, 'LESSONS.md');
const draftPath = path.join(ROOT, 'LESSONS.draft.md');
const agentsPath = path.join(ROOT, 'AGENTS.md');
const toolsPath = path.join(ROOT, 'TOOLS.md');

const lessons = fs.existsSync(lessonsPath) ? fs.readFileSync(lessonsPath, 'utf8') : '';
const entries = [...lessons.matchAll(/^## \[(L\d+)\] (\d{4}-\d{2}-\d{2}) · (.+?) · (.+)$/gm)].map((m) => ({
  id: m[1], date: m[2], tag: m[3], title: m[4].trim()
}));

const drafts = fs.existsSync(draftPath)
  ? [...fs.readFileSync(draftPath, 'utf8').matchAll(/^## \[(D\d+)\]/gm)].length
  : 0;

(async () => {
  const [comfy, browser, gpt] = await Promise.all([probe(8188), probe(3100), probe(3099)]);

  console.log('=== 开工体检 ===');
  console.log(`ComfyUI 8188 ${comfy ? '✅ 在跑' : '❌ 没起  → D:\\ComfyUI\\venv\\Scripts\\python.exe main.py --listen 127.0.0.1 --port 8188 --lowvram'}`);
  console.log(`浏览器控制台 3100 ${browser ? '✅' : '❌'}    GPT 控制台 3099 ${gpt ? '✅' : '❌'}   （要视频总结/出图才需要）`);

  // ── 待你拍板（闸门）：不点头就不进库，所以摆在最前面 ────────────
  const pendingPath = path.join(ROOT, 'out', 'pending-lessons.md');
  try {
    const praw = fs.existsSync(pendingPath) ? fs.readFileSync(pendingPath, 'utf8') : '';
    const pblocks = [...praw.matchAll(/^## \[(P\d+)\]\s*\S+\s*·\s*([^·]+?)\s*·\s*(.+)$/gm)];
    if (pblocks.length) {
      console.log(`\n=== 待你拍板（${pblocks.length}）—— 你不点头就不进库 ===`);
      pblocks.slice(0, 6).forEach((m, i) => {
        const block = praw.slice(m.index);
        const ev = /- 证据[:：]\s*(.+)/.exec(block)?.[1] || '';
        console.log(` ${i + 1}. ${m[1]} [${m[2].trim()}] ${m[3].trim()}`);
        if (ev) console.log(`    证据: ${ev.slice(0, 90)}`);
      });
      if (pblocks.length > 6) console.log(`    …还有 ${pblocks.length - 6} 条：node tools/learn.mjs pending`);
      console.log('    回「留 1 3」或「删 2」；确认全要：node tools/learn.mjs promote --all');
    }
  } catch { /* 闸门读不到不能挡住开工 */ }

  console.log('\n=== 经验库 ===');
  console.log(`${entries.length} 条 · ${kb(lessonsPath)} KB · 工具书 ${kb(toolsPath)} KB · 简报 ${kb(agentsPath)} KB · 待确认草稿 ${drafts} 条`);

  if (entries.length) {
    const last = entries.slice(-3).reverse();
    console.log('\n最近 3 条：');
    for (const e of last) console.log(`  ${e.id} ${e.date} [${e.tag}] ${e.title}`);
  }

  console.log('\n=== 全库目录（正文按需读）===');
  if (FULL) {
    for (const e of entries) {
      // `$(?![\s\S])` 才是"字符串结尾"；m 模式下光写 $ 会匹配行尾，正文只剩标题（L056）
      const body = new RegExp(`^## \\[${e.id}\\][\\s\\S]*?(?=^## \\[|$(?![\\s\\S]))`, 'm').exec(lessons)?.[0] || '';
      const fix = /- 修法: (.+)/.exec(body)?.[1] || '';
      console.log(`${e.id} [${e.tag}] ${e.title}`);
      if (fix) console.log(`    → ${fix.slice(0, 100)}`);
    }
  } else {
    const byTag = {};
    for (const e of entries) byTag[e.tag] = (byTag[e.tag] || 0) + 1;
    console.log(Object.entries(byTag).map(([k, v]) => `${k}(${v})`).join(' · '));
    console.log('（要看具体条目：node tools/preflight.mjs --full，或 node tools/reflect.mjs --index）');
  }

  // ── 记忆库（除经验之外的三类） ────────────────────────────
  const countOf = (file, prefix) => {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) return 0;
    return [...fs.readFileSync(p, 'utf8').matchAll(new RegExp(`^## \\[${prefix}\\d+\\]`, 'gm'))].length;
  };
  const nowMd = path.join(ROOT, 'notes', '现在.md');
  console.log('\n=== 记忆库 ===');
  console.log(`纠错 ${countOf('CORRECTIONS.md', 'C')} · 偏好 ${countOf('PREFERENCES.md', 'P')} · 打法 ${countOf('PLAYBOOKS.md', 'B')}`);
  if (fs.existsSync(nowMd)) {
    const t = fs.readFileSync(nowMd, 'utf8');
    const next = /## 下一步\n(- .+)/.exec(t)?.[1]?.trim();
    const when = /最后更新 ([^\n。]+)/.exec(t)?.[1];
    console.log(`现在.md ${when ? '(' + when + ')' : ''} ${next || ''}`);
  } else {
    console.log('现在.md 还没有 → node tools/state.mjs --write --next "下一步动作"');
  }

  // ── 台账（回合流水，纯离线从会话日志抽的；不靠我记得）──────────
  console.log('\n=== 台账 ===');
  try {
    const { stdout } = await exec(process.execPath, ['tools/ledger.mjs', 'pending', '--quiet'], {
      cwd: ROOT,
      timeout: 90000
    });
    for (const line of stdout.trim().split('\n')) if (line.trim()) console.log(line.trim());
  } catch (e) {
    console.log('台账自检失败: ' + (e.message || e).slice(0, 200));
  }

  // ── 渠道（外部检索能力，别再用"裸 API 不通"误判） ──────────
  console.log('\n=== 渠道 ===');
  try {
    const { stdout } = await exec(process.execPath, ['tools/channels.mjs', '--json'], { cwd: ROOT, timeout: 30000 });
    const rows = JSON.parse(stdout);
    const ok = rows.filter((r) => r.ok).map((r) => r.name);
    const bad = rows.filter((r) => !r.ok);
    console.log(`可用: ${ok.join(' / ')}`);
    for (const b of bad) console.log(`  ❌ ${b.name} — ${b.detail}${b.fix ? '  → ' + b.fix : ''}`);
  } catch (e) {
    console.log('渠道自检失败: ' + (e.message || e));
  }

  if (drafts) console.log(`\n⚠️ 有 ${drafts} 条草稿待确认：node tools/reflect.mjs --drafts`);
  console.log('\n接下来：node tools/memo.mjs recall "这次任务的一句话"   ← 先查记忆，再动手');
})();
