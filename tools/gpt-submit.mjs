/** 在 ChatGPT 页面里按一次 Enter（提交输入框里的内容） */
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('chatgpt'));
if (!page) {
  console.log('没有 chatgpt 标签页');
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
    setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error('timeout'))), 15000);
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

// 聚焦输入框
const focus = await send('Runtime.evaluate', {
  expression: `(() => { const el = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea'); if (!el) return 'no-composer'; el.focus(); return el.innerText ? 'focus:' + el.innerText.length : 'focus-empty'; })()`,
  returnByValue: true
});
console.log('输入框:', focus.result.value);

// 按 Enter
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log('已按 Enter');

await new Promise((r) => setTimeout(r, 5000));
const after = await send('Runtime.evaluate', {
  expression: `(() => { const el = document.querySelector('div[contenteditable="true"]'); return JSON.stringify({ url: location.href.slice(-30), composerLen: el ? el.innerText.length : -1, stop: !!document.querySelector('button[data-testid="stop-button"]') }); })()`,
  returnByValue: true
});
console.log('5 秒后:', after.result.value);
ws.close();
