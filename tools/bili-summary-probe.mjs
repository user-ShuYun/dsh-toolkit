/** 找页面上的「AI 总结 / 笔记」入口，并顺手看评论里有没有干货 */
const PORT = 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /bilibili\.com\/video/.test(t.url)) || list.find((t) => t.type === 'page');
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
  if (r.exceptionDetails) return 'ERR: ' + r.exceptionDetails.text;
  return r.result?.value;
};

console.log('AI 相关按钮:', await ev(`(() => {
  const hits = [...document.querySelectorAll('button,div[role=button],a,span')]
    .filter(e => /总结|AI ?笔记|智能总结|课代表/i.test((e.innerText||'').trim()))
    .slice(0, 8)
    .map(e => (e.tagName + ':' + (e.innerText||'').trim().slice(0, 12) + '|' + (e.className||'').toString().slice(0, 30)));
  return JSON.stringify(hits);
})()`));

console.log('页面是否有字幕面板:', await ev(`(() => {
  const w = document.querySelector('.bpx-player-subtitle-wrap');
  return w ? 'yes: ' + (w.innerText||'').slice(0,40) : 'no';
})()`));

console.log('AI 总结接口（尝试）:', String(await ev(`(async () => {
  try {
    const st = window.__INITIAL_STATE__;
    const vd = st && st.videoData;
    if (!vd) return 'no videoData';
    const url = 'https://api.bilibili.com/x/web-interface/view/conclusion/get?bvid=' + vd.bvid + '&cid=' + vd.cid + '&up_mid=' + (vd.owner && vd.owner.mid);
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json();
    return 'code=' + j.code + ' msg=' + (j.message||'') + ' model=' + (j.data && j.data.model_result ? 'yes' : 'no');
  } catch (e) { return 'throw ' + e.message; }
})()`)));
ws.close();
