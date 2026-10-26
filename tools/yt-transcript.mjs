/**
 * yt-transcript.mjs —— 走「显示字幕记录」面板抓 YouTube 逐句文本
 *
 *   node tools/yt-transcript.mjs <视频ID或URL> [outPath]
 *
 * 为什么不用 timedtext 接口：2024 之后 baseUrl 需要 pot 令牌，
 * fetch 回来是 200 + 空 body。面板是唯一稳定路径。
 */
import { writeFileSync } from 'node:fs';

const input = process.argv[2];
const outPath = process.argv[3] || '';
if (!input) {
  console.log('用法: node tools/yt-transcript.mjs <视频ID或URL> [outPath]');
  process.exit(1);
}
const id = input.includes('v=') ? input.split('v=')[1].split(/[&?]/)[0] : input;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fetch('http://127.0.0.1:3100/api/open', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${id}` })
});
await sleep(7000);

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes(id));
if (!page) throw new Error('没找到视频标签页');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pend = new Map();
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++msgId;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout ' + m))), 30000);
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
const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
};

const title = await evalIn('document.title');
console.log('页面:', title.slice(0, 70));

// 1) 展开简介
await evalIn(`(() => {
  const btn = document.querySelector('tp-yt-paper-button#expand') || document.querySelector('#expand');
  if (btn) btn.click();
  return !!btn;
})()`);
await sleep(1200);

// 2) 点「显示字幕记录」
const clicked = await evalIn(`(() => {
  const cands = [...document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button')];
  const hit = cands.find(function (b) {
    const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
    return /transcript/i.test(t) || /字幕记录|显示字幕|字幕稿/.test(t);
  });
  if (hit) { hit.click(); return (hit.innerText || hit.getAttribute('aria-label') || '').trim().slice(0, 40); }
  return null;
})()`);
console.log('字幕按钮:', clicked || '没找到');
if (!clicked) {
  console.log('提示：先把页面语言切到中文或英文，或该视频确实没有字幕记录面板');
  ws.close();
  process.exit(1);
}
await sleep(3000);

// 3) 读分段
const raw = await evalIn(`(() => {
  const segs = [...document.querySelectorAll('ytd-transcript-segment-renderer')];
  if (!segs.length) return JSON.stringify({ n: 0 });
  const rows = segs.map(function (s) {
    const tm = s.querySelector('.segment-timestamp');
    const tx = s.querySelector('.segment-text');
    return { t: tm ? tm.textContent.trim() : '', x: tx ? tx.textContent.trim() : s.textContent.trim().replace(/\\s+/g, ' ') };
  });
  return JSON.stringify({ n: rows.length, rows: rows });
})()`);

const data = JSON.parse(raw);
ws.close();
if (!data.n) {
  console.log('面板打开了但没读到分段（可能需要等更久，或被地区限制）');
  process.exit(1);
}

const text = data.rows.map((r) => (r.t ? `[${r.t}] ` : '') + r.x).join('\n');
console.log('分段数:', data.n, '| 字数:', text.length);

if (outPath) {
  writeFileSync(outPath, `---\ntitle: "${title.replace(/"/g, "'")}"\nyt_id: ${id}\nfetched: ${new Date().toISOString()}\n---\n\n${text}\n`, 'utf8');
  console.log('已存:', outPath);
} else {
  console.log('\n前 200 字:\n' + text.slice(0, 200));
}
