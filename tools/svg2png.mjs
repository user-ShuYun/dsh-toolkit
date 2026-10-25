/**
 * svg2png.mjs —— 把一批 SVG 页面按指定分辨率渲染成 PNG（走 CDP）
 *   node tools/svg2png.mjs <svgDir> <outDir> [width] [height]
 */
import { writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [svgDir, outDir, w = '1920', h = '1080'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
let page = list.find((t) => t.type === 'page' && t.url.startsWith('file://'));
if (!page) {
  // 开一个自己的标签页，别抢 ChatGPT 那个
  await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const l2 = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  page = l2.find((t) => t.type === 'page' && t.url === 'about:blank') || l2.find((t) => t.type === 'page');
}
if (!page) throw new Error('没有可用标签页');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout ' + method))), 20000);
  });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

await send('Emulation.setDeviceMetricsOverride', {
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: 1,
  mobile: false
});

const files = readdirSync(svgDir).filter((f) => f.endsWith('.svg')).sort();
for (const f of files) {
  const url = pathToFileURL(resolve(join(svgDir, f))).href;
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1200));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = join(outDir, f.replace(/\.svg$/, '.png'));
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('✓', f, '→', out);
}
await send('Emulation.clearDeviceMetricsOverride');
ws.close();
console.log('done', files.length, 'pages');
