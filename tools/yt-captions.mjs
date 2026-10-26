/**
 * yt-captions.mjs —— 取 YouTube 字幕（必须走浏览器，Node 直连会超时）
 *
 *   node tools/yt-captions.mjs <视频ID或URL> [outPath]
 *
 * 前置：Edge(9222) 里已登录 YouTube；3100 控制台在跑。
 * 原理：打开 watch 页 → 读 ytInitialPlayerResponse → 在页面上下文 fetch 字幕 → 解析 json3
 */
import { writeFileSync } from 'node:fs';

const input = process.argv[2];
const outPath = process.argv[3] || '';
if (!input) {
  console.log('用法: node tools/yt-captions.mjs <视频ID或URL> [outPath]');
  process.exit(1);
}
const id = input.includes('v=') ? input.split('v=')[1].split(/[&?]/)[0] : input;

const API = 'http://127.0.0.1:3100/api/';
const post = async (n, b) => {
  const r = await fetch(API + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
  return r.json();
};

// 1) 打开页面
await post('open', { url: `https://www.youtube.com/watch?v=${id}` });
await new Promise((r) => setTimeout(r, 6000));

// 2) CDP 连到该页
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
};

const meta = await evalIn(`(() => {
  const d = window.ytInitialPlayerResponse || {};
  const t = d.captions && d.captions.playerCaptionsTracklistRenderer;
  const v = d.videoDetails || {};
  return JSON.stringify({
    title: v.title || document.title,
    author: v.author || '',
    sec: v.lengthSeconds || 0,
    tracks: t ? t.captionTracks.map(x => ({ lang: x.languageCode, kind: x.kind || 'manual', url: x.baseUrl })) : []
  });
})()`);

const info = JSON.parse(meta);
if (!info.tracks.length) {
  console.log('这条视频没有字幕轨');
  ws.close();
  process.exit(1);
}

// 3) 选轨：中文优先，其次英文（人工优先于 asr）
const pick =
  info.tracks.find((t) => /^zh(-CN)?$/.test(t.lang) && t.kind !== 'asr') ||
  info.tracks.find((t) => /^zh/.test(t.lang)) ||
  info.tracks.find((t) => t.lang === 'en' && t.kind !== 'asr') ||
  info.tracks.find((t) => t.lang === 'en') ||
  info.tracks[0];

console.log('标题:', info.title);
console.log('作者:', info.author, '| 时长:', Math.round(Number(info.sec) / 60), '分钟');
console.log('字幕轨:', info.tracks.length, '条 → 选', pick.lang + '/' + pick.kind);

// 4) 在页面里抓字幕（借浏览器网络）
const xml = await evalIn(`fetch(${JSON.stringify(pick.url + '&fmt=json3')})
  .then(r => r.text())
  .catch(e => 'FETCH_ERR:' + e.message)`);

if (typeof xml !== 'string' || xml.startsWith('FETCH_ERR')) {
  console.log('抓取失败:', String(xml).slice(0, 120));
  ws.close();
  process.exit(1);
}

let text = '';
try {
  const j = JSON.parse(xml);
  text = j.events
    .filter((e) => e.segs)
    .map((e) => e.segs.map((s) => s.utf8).join('').replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
} catch {
  // 老格式 XML
  text = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
    .join('\n');
}

ws.close();

text = text.replace(/\n{2,}/g, '\n').trim();
console.log('字幕字数:', text.length);

if (outPath) {
  writeFileSync(
    outPath,
    `---\ntitle: "${info.title.replace(/"/g, "'")}"\nyt_id: ${id}\nauthor: "${info.author}"\nseconds: ${info.sec}\nlang: ${pick.lang}/${pick.kind}\nfetched: ${new Date().toISOString()}\n---\n\n${text}\n`,
    'utf8'
  );
  console.log('已存:', outPath);
} else {
  console.log('\n前 300 字:\n' + text.slice(0, 300));
}
