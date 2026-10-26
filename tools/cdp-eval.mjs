/**
 * cdp-eval.mjs —— 在指定标签页里执行一段 JS 并打印结果
 *   node tools/cdp-eval.mjs <urlMatch> "<expression>"
 */
const [match, expr] = process.argv.slice(2);
if (!match || !expr) {
  console.log('用法: node tools/cdp-eval.mjs youtube "document.title"');
  process.exit(1);
}
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes(match));
if (!page) {
  console.log('没找到标签页:', match);
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout ' + m))), 15000);
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
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (r.exceptionDetails) {
  const d = r.exceptionDetails;
  console.log('JS 异常:', d.text || '', (d.exception && d.exception.description) || '');
  process.exit(1);
}
console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value));
ws.close();
