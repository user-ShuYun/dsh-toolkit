/**
 * bili-comments.mjs —— 抓热门评论（无登录也能用）。
 *   node tools/bili-comments.mjs BV1E7wtzaEdq [条数]
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const bvid = process.argv[2];
const n = Number(process.argv[3] || 20);
if (!bvid) {
  console.error('用法: node tools/bili-comments.mjs <bvid> [n]');
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

const v = JSON.parse(await api(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`));
if (v.code !== 0) throw new Error('view ' + v.code);
const aid = v.data.aid;
console.log(`# ${v.data.title}  (${v.data.owner?.name})\n`);

for (const sort of [2]) {
  const j = JSON.parse(await api(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=${sort}&ps=${n}`));
  const reps = j.data?.replies ?? [];
  console.log(`热评 ${reps.length} 条（sort=${sort}）：\n`);
  for (const r of reps) {
    const msg = String(r.content?.message ?? '').replace(/\s+/g, ' ').trim();
    if (msg.length < 4) continue;
    console.log(`· [赞 ${r.like}] ${msg.slice(0, 220)}`);
  }
}
ws.close();
