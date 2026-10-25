/**
 * bili-sub-cdp.mjs —— 从视频页面里抓真正的字幕轨（A 方案）。
 *
 *   node tools/bili-sub-cdp.mjs BV1E7wtzaEdq [out.json]
 *
 * 为什么不走接口：/x/player/v2 那次返回的字幕内容跟视频对不上（拿到了手机评测的字幕）。
 * 这里改成打开视频页，开 Network 监听，等播放器自己去拉字幕文件，再把响应体截下来。
 */
import { writeFileSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9222);
const bvid = process.argv[2];
const outFile = process.argv[3] || `subs-${bvid}.json`;
if (!bvid) {
  console.error('用法: node tools/bili-sub-cdp.mjs <bvid> [out.json]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /bilibili\.com/.test(t.url)) || list.find((t) => t.type === 'page');
if (!page) throw new Error('没有可用页面');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let seq = 0;
const pend = new Map();
const hits = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    return;
  }
  if (m.method === 'Network.responseReceived') {
    const { url, mimeType, requestId, status } = m.params.response;
    if (status === 200 && /subtitle|aisubtitle/i.test(url) && /json/i.test(mimeType + url)) {
      hits.push({ url, requestId });
    }
  }
};
const call = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

await call('Network.enable');
await call('Page.enable');
await call('Runtime.enable');
await call('Page.navigate', { url: `https://www.bilibili.com/video/${bvid}/` });
console.log('打开视频页，等字幕轨…');

// 最多等 25 秒，同时试试点开播放（有的播放器要播才拉字幕）
let tries = 0;
while (hits.length === 0 && tries < 25) {
  await sleep(1000);
  tries++;
  if (tries === 6) {
    await call('Runtime.evaluate', {
      expression: `(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(() => {}); } return !!v; })()`,
      returnByValue: true
    });
  }
  if (tries % 5 === 0) console.log(`  …${tries}s（已捕获 ${hits.length} 条字幕请求）`);
}

if (!hits.length) {
  console.log('没捕获到字幕请求（可能这个视频没有 CC 字幕轨）');
  ws.close();
  process.exit(2);
}

const body = await call('Network.getResponseBody', { requestId: hits[hits.length - 1].requestId });
const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
const json = JSON.parse(text);
const lines = json.body ?? [];
writeFileSync(outFile, JSON.stringify(json, null, 1), 'utf8');
console.log(`\n字幕来源: ${hits[hits.length - 1].url.slice(0, 90)}…`);
console.log(`条数: ${lines.length}　写入 ${outFile}\n`);
for (const l of lines.slice(0, 5)) console.log(`[${Math.floor(l.from)}s] ${l.content}`);
ws.close();
