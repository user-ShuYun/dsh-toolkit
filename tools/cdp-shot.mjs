/**
 * cdp-shot.mjs —— 直接通过 CDP 截图（不依赖 3100 服务）
 *   node tools/cdp-shot.mjs <urlSubstring> <outPath>
 */
import { writeFileSync } from 'node:fs';

const [match, outPath] = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes(match));
if (!page) {
  console.log('没找到页面:', match);
  console.log('现有:', list.filter((t) => t.type === 'page').map((t) => t.url.slice(0, 60)));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
    setTimeout(() => {
      if (pending.has(msgId)) {
        pending.delete(msgId);
        reject(new Error('timeout ' + method));
      }
    }, 20000);
  });

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  }
});

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
console.log('saved', outPath, Math.round(Buffer.from(shot.data, 'base64').length / 1024) + 'KB');
ws.close();
