/**
 * yt-cookies.mjs —— 从调试浏览器导出 youtube.com 的 cookie（Netscape 格式），给 yt-dlp 用
 *   node tools/yt-cookies.mjs [outPath]
 */
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'D:/deepseek/out/yt-cookies.txt';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('youtube'));
if (!page) throw new Error('先让浏览器停在 youtube 页面');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout ' + m))), 20000);
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

const { cookies } = await send('Network.getCookies', {
  urls: ['https://www.youtube.com', 'https://www.youtube.com/']
});
ws.close();

const lines = [
  '# Netscape HTTP Cookie File',
  '# exported by yt-cookies.mjs',
  ''
];
for (const c of cookies) {
  const domain = c.domain;
  const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const expires = Math.round(c.expires > 0 ? c.expires : Date.now() / 1000 + 86400);
  lines.push([domain, flag, c.path || '/', c.secure ? 'TRUE' : 'FALSE', expires, c.name, c.value].join('\t'));
}
writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log('导出', cookies.length, '个 cookie →', out);
