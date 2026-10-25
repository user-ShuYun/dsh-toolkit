/**
 * bili-notes.mjs —— 取字幕并压缩成「能读得动」的逐段摘要素材。
 *
 *   node tools/bili-notes.mjs BV1E7wtzaEdq [每段秒数=75] > notes.txt
 *
 * 做法：把字幕按时间合并成 N 秒一段，每段取该段内字数最多的那句作为代表，
 * 输出 [mm:ss] 文本。这样 30 分钟的视频会压成 20~25 行，够我读、也够提炼。
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bvid = process.argv[2];
const blockSec = Number(process.argv[3] || 75);
if (!bvid) {
  console.error('用法: node tools/bili-notes.mjs <bvid> [blockSec]');
  process.exit(1);
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /bilibili\.com/.test(t.url)) || list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (!pend.has(m.id)) return;
  const p = pend.get(m.id);
  pend.delete(m.id);
  m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
};
const call = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
await call('Runtime.enable');
const ev = async (x) => {
  const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};
const api = (u) => ev(`(async () => (await fetch(${JSON.stringify(u)}, { credentials: 'include' })).text())()`);

try {
  const v = JSON.parse(await api(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`));
  if (v.code !== 0) throw new Error('view ' + v.code);
  const d = v.data;
  // B站对字幕接口有风控：同样的请求有时返回空字幕，重试几次（1.5s 间隔）直到出现
  let sub = null;
  let lastP = null;
  for (let attempt = 0; attempt < 8 && !sub; attempt++) {
    lastP = JSON.parse(await api(`https://api.bilibili.com/x/player/v2?aid=${d.aid}&cid=${d.cid}`));
    sub = (lastP.data?.subtitle?.subtitles ?? [])[0] ?? null;
    if (!sub) await sleep(1500);
  }
  if (!sub) throw new Error(`没有字幕（重试 8 次仍为空，code=${lastP?.code}）`);
  const url = sub.subtitle_url.startsWith('//') ? 'https:' + sub.subtitle_url : sub.subtitle_url;
  // 字幕文件在 aisubtitle.hdslb.com，页面里 fetch 会被 CORS 挡；签名 URL 本身是公开的，直接 Node 取
  const raw = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' } });
  if (!raw.ok) throw new Error('subtitle fetch ' + raw.status);
  const body = await raw.json();
  const lines = body.body ?? [];

  console.log(`# ${d.title} | ${d.owner?.name} | ${Math.round(d.duration / 60)} 分钟 | ${lines.length} 条字幕\n`);

  // 按 blockSec 分段，每段挑最长的一句做代表
  const blocks = new Map();
  for (const l of lines) {
    const k = Math.floor(l.from / blockSec);
    const prev = blocks.get(k);
    if (!prev || l.content.length > prev.content.length) blocks.set(k, l);
  }
  for (const [k, l] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    const t = Math.floor(k * blockSec);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    console.log(`[${mm}:${ss}] ${l.content.replace(/\s+/g, ' ')}`);
  }
} finally {
  ws.close();
}
