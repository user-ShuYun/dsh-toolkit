/**
 * channels.mjs —— 外部渠道自检：每条路能不能用、缺什么、怎么补。
 *
 * 为什么要有它：2026-10-25 我因为"裸 B 站搜索 API 返回 v_voucher"就断言"B站不可用"，
 * 实际上 tools/bili.mjs 借浏览器 cookie 一直好好的。教训是：**先盘工具，再下结论**。
 *
 * 用法: node tools/channels.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = 'D:\\deepseek';
const JSON_OUT = process.argv.includes('--json');

const rows = [];
const add = (name, ok, detail, fix) => rows.push({ name, ok, detail, fix });

// ── EDGE / CDP ───────────────────────────────────────────────
let tabs = [];
try {
  const r = await fetch('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(3000) });
  tabs = await r.json();
  add('Edge 9222', true, `${tabs.filter((t) => t.type === 'page').length} 个页面`, '');
} catch {
  add('Edge 9222', false, '连不上', 'curl -X POST http://127.0.0.1:3101/api/start  或  node tools/launcher.mjs 3101');
}

const hasTab = (re) => tabs.some((t) => t.type === 'page' && re.test(t.url || ''));

// ── B 站 ─────────────────────────────────────────────────────
const biliTool = fs.existsSync(path.join(ROOT, 'tools', 'bili.mjs'));
add('B站', biliTool && hasTab(/bilibili\.com/), hasTab(/bilibili\.com/) ? '标签页就绪' : '缺 bilibili 标签页（否则页面内 fetch 会被 CORS 挡）',
  'curl -X PUT "http://127.0.0.1:9222/json/new?https://www.bilibili.com/"');

// ── 知乎 ─────────────────────────────────────────────────────
const zhihuTool = fs.existsSync(path.join(ROOT, 'tools', 'zhihu.mjs'));
add('知乎', zhihuTool, zhihuTool ? 'tools/zhihu.mjs 可用' : '缺 tools/zhihu.mjs', 'node tools/zhihu.mjs search 关键词');

// ── YouTube ──────────────────────────────────────────────────
let ytdlp = '';
try {
  const { stdout } = await exec('yt-dlp', ['--version'], { timeout: 8000 });
  ytdlp = stdout.trim();
} catch {
  ytdlp = '';
}
add('YouTube', Boolean(ytdlp), ytdlp ? `yt-dlp ${ytdlp}` : 'yt-dlp 未安装 / 不在 PATH', 'pip install -U yt-dlp（还需浏览器 cookie + 代理，见 tools/yt-text.mjs）');

// ── GPT 控制台 ───────────────────────────────────────────────
try {
  const r = await fetch('http://127.0.0.1:3099/api/status', { signal: AbortSignal.timeout(3000) });
  const j = await r.json();
  add('GPT 控制台 3099', r.ok, j.busy ? '在生成中（先等或点停止）' : '空闲', '');
} catch {
  add('GPT 控制台 3099', false, '连不上', 'curl -X POST http://127.0.0.1:3101/api/start');
}

// ── 浏览器控制台 ─────────────────────────────────────────────
try {
  const r = await fetch('http://127.0.0.1:3100/', { signal: AbortSignal.timeout(3000) });
  add('浏览器控制台 3100', r.ok, `HTTP ${r.status}`, '');
} catch {
  add('浏览器控制台 3100', false, '连不上', 'curl -X POST http://127.0.0.1:3101/api/start');
}

// ── GitHub ───────────────────────────────────────────────────
const tokenFile = path.join(ROOT, '.secrets', 'gh-token');
let ghOk = false;
try {
  const r = await fetch('https://api.github.com/rate_limit', { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'dsh-channels' } });
  ghOk = r.ok;
} catch {
  ghOk = false;
}
add('GitHub API', ghOk, fs.existsSync(tokenFile) ? '匿名可用 + 本地有 token' : '匿名可用', '只读不需要 token；推送用 .secrets/gh-token');

// ── ComfyUI ──────────────────────────────────────────────────
try {
  const r = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(2500) });
  add('ComfyUI 8188', r.ok, r.ok ? '在线' : 'HTTP ' + r.status, 'cd D:\\ComfyUI && venv\\Scripts\\python.exe main.py --port 8188 --lowvram');
} catch {
  add('ComfyUI 8188', false, '没起', 'cd D:\\ComfyUI && venv\\Scripts\\python.exe main.py --port 8188 --lowvram');
}

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n渠道自检\n');
  for (const r of rows) {
    const mark = r.ok ? '✅' : '❌';
    console.log(`  ${mark} ${pad(r.name, 16)} ${r.detail}`);
    if (!r.ok && r.fix) console.log(`     ${' '.repeat(19)}修复: ${r.fix}`);
  }
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`\n  ${rows.length - bad}/${rows.length} 可用${bad ? ` · ${bad} 条不可用` : ''}\n`);
}
