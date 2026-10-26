/**
 * yt-fetch.mjs —— YouTube 版 fetchVideoText（返回结构与 bili-text 一致，便于主程序复用）
 *
 *   import { fetchYtText } from './yt-fetch.mjs';
 *   const v = await fetchYtText('https://www.youtube.com/watch?v=xxx');
 *   // { title, up, duration, view, bvid, source, chars, text }
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PY = 'D:\\deepseek\\ppt-master\\.venv\\Scripts\\python.exe';
const PROXY = 'http://127.0.0.1:7890';
const TMP = 'D:\\deepseek\\out\\yt-tmp';
const COOKIE = 'D:\\deepseek\\out\\yt-cookies.txt';

export function ytIdOf(url) {
  if (/^[\w-]{11}$/.test(url)) return url;
  const m = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/);
  return m ? m[1] : null;
}

/** 从调试浏览器导出 youtube cookie（yt-dlp 不带 cookie 会被判机器人） */
async function exportCookies() {
  let page = null;
  for (let attempt = 0; attempt < 2 && !page; attempt++) {
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    page = list.find((t) => t.type === 'page' && t.url.includes('youtube'));
    if (!page) {
      // 没有 youtube 标签页就自己开一个（cookie 仍在 profile 里，不需要再登录）
      try {
        await fetch('http://127.0.0.1:3100/api/open', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: 'https://www.youtube.com/' })
        });
      } catch {
        /* 3100 没起就直接报错 */
      }
      await new Promise((r) => setTimeout(r, 6000));
    }
  }
  if (!page) throw new Error('打不开 youtube 标签页：先在浏览器里登录一次 YouTube');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0;
  const pend = new Map();
  const send = (m, p = {}) =>
    new Promise((res, rej) => {
      const i = ++mid;
      pend.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
      setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('cookie 导出超时'))), 20000);
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
      [
        c.domain,
        c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        Math.round(c.expires > 0 ? c.expires : Date.now() / 1000 + 86400),
        c.name,
        c.value
      ].join('\t')
    );
  }
  writeFileSync(COOKIE, lines.join('\n') + '\n', 'utf8');
}

/** VTT → 纯文本（去时间轴、去滚动重复） */
function vttToText(raw) {
  const seen = new Set();
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s === 'WEBVTT' || s.startsWith('NOTE') || s.startsWith('Kind:') || s.startsWith('Language:') || s.includes('-->') || /^\d+$/.test(s)) continue;
    const t = s
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  const merged = [];
  for (const line of out) {
    const prev = merged[merged.length - 1];
    if (prev && (prev.includes(line) || line.includes(prev))) {
      if (line.length > prev.length) merged[merged.length - 1] = line;
      continue;
    }
    merged.push(line);
  }
  return merged.join('\n');
}

export async function fetchYtText(url) {
  const id = ytIdOf(url);
  if (!id) throw new Error('认不出 YouTube 视频 ID');

  await exportCookies();
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const env = { ...process.env, HTTPS_PROXY: PROXY, HTTP_PROXY: PROXY };
  const base = ['-m', 'yt_dlp', '--proxy', PROXY, '--cookies', COOKIE, '--skip-download', '--ignore-no-formats-error'];

  // 元数据
  let meta = { title: '', uploader: '', duration: 0, view_count: 0 };
  try {
    const printed = execFileSync(
      PY,
      [...base, '--print', '%(title)s\t%(uploader)s\t%(duration)s\t%(view_count)s', `https://www.youtube.com/watch?v=${id}`],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    const [title, uploader, duration, view] = printed.split('\t');
    meta = { title, uploader, duration: Number(duration) || 0, view_count: Number(view) || 0 };
  } catch {
    /* 元数据失败不阻塞字幕 */
  }

  // 字幕
  execFileSync(
    PY,
    [...base, '--write-subs', '--write-auto-subs', '--sub-langs', 'zh-Hans,zh-CN,zh,en', '--sub-format', 'vtt', '-o', join(TMP, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${id}`],
    { stdio: 'ignore', env }
  );

  const files = readdirSync(TMP).filter((f) => f.endsWith('.vtt'));
  if (!files.length) throw new Error('这条视频没有可用字幕');

  const rank = (f) => (/\.zh-Hans\./.test(f) ? 0 : /\.zh-CN\./.test(f) ? 1 : /\.zh\./.test(f) ? 2 : 3);
  files.sort((a, b) => rank(a) - rank(b));
  const picked = files[0];
  const text = vttToText(readFileSync(join(TMP, picked), 'utf8'));
  const langTag = picked.replace(`${id}.`, '').replace('.vtt', '');

  return {
    title: meta.title || id,
    up: meta.uploader || 'YouTube',
    duration: Math.round((meta.duration || 0) / 60),
    view: meta.view_count || 0,
    bvid: id, // 复用字段：YouTube 视频 ID
    source: `YouTube 字幕 ${langTag}`,
    chars: text.length,
    text
  };
}
