/**
 * yt-text.mjs —— YouTube 视频 → 纯文本（可直接喂给总结）
 *
 *   node tools/yt-text.mjs <URL或ID> [outPath]
 *
 * 走的是 yt-dlp + 浏览器 cookie + 本地代理，因为：
 *   1) 浏览器上下文里 timedtext 返回空（需要 pot 令牌）
 *   2) yt-dlp 不带 cookie 会被判「确认你不是机器人」
 *   3) Node 直连 youtube 会超时（系统代理 127.0.0.1:7890 只在浏览器里生效）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const input = process.argv[2];
if (!input) {
  console.log('用法: node tools/yt-text.mjs <URL或ID> [outPath]');
  process.exit(1);
}
const id = input.includes('v=') ? input.split('v=')[1].split(/[&?]/)[0] : input;
const PY = 'D:\\deepseek\\ppt-master\\.venv\\Scripts\\python.exe';
const PROXY = 'http://127.0.0.1:7890';
const TMP = 'D:\\deepseek\\out\\yt-tmp';
const COOKIE = 'D:\\deepseek\\out\\yt-cookies.txt';
const outPath = process.argv[3] || `D:\\deepseek\\out\\yt-${id}.txt`;

// 1) 导出 cookie
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('youtube'));
if (!page) throw new Error('浏览器里先打开 youtube.com 并保持登录');
{
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0;
  const pend = new Map();
  const send = (m, p = {}) =>
    new Promise((res, rej) => {
      const i = ++mid;
      pend.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
      setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 20000);
    });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const { cookies } = await send('Network.getCookies', { urls: ['https://www.youtube.com'] });
  ws.close();
  const lines = ['# Netscape HTTP Cookie File', ''];
  for (const c of cookies) {
    lines.push(
      [c.domain, c.domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', Math.round(c.expires > 0 ? c.expires : Date.now() / 1000 + 86400), c.name, c.value].join('\t')
    );
  }
  writeFileSync(COOKIE, lines.join('\n') + '\n', 'utf8');
}

// 2) 拉字幕
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
execFileSync(
  PY,
  [
    '-m', 'yt_dlp',
    '--proxy', PROXY,
    '--cookies', COOKIE,
    '--skip-download',
    '--write-subs', '--write-auto-subs',
    '--sub-langs', 'zh-Hans,zh-CN,zh,en',
    '--sub-format', 'vtt',
    '--ignore-no-formats-error',
    '-o', join(TMP, '%(id)s.%(ext)s'),
    `https://www.youtube.com/watch?v=${id}`
  ],
  { stdio: 'ignore', env: { ...process.env, HTTPS_PROXY: PROXY, HTTP_PROXY: PROXY } }
);

const files = readdirSync(TMP).filter((f) => f.endsWith('.vtt'));
if (!files.length) throw new Error('没拿到字幕文件（视频可能没有字幕）');

// 优先顺序：zh-Hans > zh-CN > zh > en
const rank = (f) => (/\.zh-Hans\./.test(f) ? 0 : /\.zh-CN\./.test(f) ? 1 : /\.zh\./.test(f) ? 2 : 3);
files.sort((a, b) => rank(a) - rank(b));
const picked = files[0];

// 3) VTT → 纯文本（去时间轴、去重复行）
const raw = readFileSync(join(TMP, picked), 'utf8');
const seen = new Set();
const out = [];
for (const line of raw.split(/\r?\n/)) {
  const s = line.trim();
  if (!s || s === 'WEBVTT' || s.startsWith('NOTE') || s.startsWith('Kind:') || s.startsWith('Language:') || s.includes('-->') || /^\d+$/.test(s)) continue;
  const clean = s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  if (!clean || seen.has(clean)) continue;
  seen.add(clean);
  out.push(clean);
}
// 重叠去重：很多 VTT 是滚动窗口，去掉被上一行包含的碎片
const merged = [];
for (const line of out) {
  const prev = merged[merged.length - 1];
  if (prev && (prev.includes(line) || line.includes(prev))) {
    if (line.length > prev.length) merged[merged.length - 1] = line;
    continue;
  }
  merged.push(line);
}

const text = merged.join('\n');
writeFileSync(outPath, text, 'utf8');
console.log('字幕文件:', picked, '| 行数:', merged.length, '| 字数:', text.length);
console.log('已存:', outPath);
console.log('\n前 200 字:\n' + text.slice(0, 200));
