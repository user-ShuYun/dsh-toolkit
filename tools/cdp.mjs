/**
 * cdp.mjs —— 极简 Chrome DevTools Protocol 客户端（只依赖 Node 内置 WebSocket）。
 *
 * 为什么单独抽出来：bili / zhihu / youtube 三条链路都要"开标签页 → 等加载 → 在页面里取数"，
 * 每个脚本各写一遍 CDP 是重复劳动，且容易各写各的 bug。
 */
const PORT = Number(process.env.CDP_PORT || 9222);

export async function version(port = PORT) {
  const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error('CDP HTTP ' + r.status);
  return r.json();
}

export async function targets(port = PORT) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error('CDP HTTP ' + r.status);
  return r.json();
}

/** 找第一个 url 匹配的页面标签 */
export async function findTab(re, port = PORT) {
  const list = await targets(port);
  return list.find((t) => (t.type === 'page' || t.type === 'tab') && re.test(t.url || ''));
}

/**
 * 开新标签页。注意 Edge/Chrome 的 /json/new 需要 PUT，且 url 直接拼在 query 里。
 * 返回 target 对象（含 id / webSocketDebuggerUrl）。
 */
export async function openTab(url, port = PORT) {
  // 必须整体编码：直接拼 `?<url>` 时，url 里的 `&` 会被当成 CDP 自己的 query 分隔符，后面全丢
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('openTab HTTP ' + r.status);
  return r.json();
}

export async function closeTab(id, port = PORT) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${id}`, { signal: AbortSignal.timeout(5000) });
  } catch {
    /* 关不掉就算了，不影响结果 */
  }
}

/** 在指定标签页里求值；expression 必须是"返回可序列化值"的表达式 */
export function evaluate(tab, expression, { timeout = 20000, awaitPromise = true } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('CDP 求值超时'));
    }, timeout);
    let id = 0;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: ++id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise, userGesture: true }
      }));
    });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (m.error) return reject(new Error(m.error.message || 'CDP error'));
      const r = m.result || {};
      if (r.exceptionDetails) {
        return reject(new Error(r.exceptionDetails.text || r.exceptionDetails.exception?.description || '页面内抛错'));
      }
      resolve(r.result?.value);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket 连接失败'));
    });
  });
}

/** 轮询直到表达式返回真值（用于等页面渲染完），超时返回 null */
export async function waitFor(tab, expression, { timeout = 15000, every = 500 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const v = await evaluate(tab, expression, { timeout: 5000 });
      if (v) return v;
    } catch {
      /* 页面还在跳，继续等 */
    }
    await new Promise((r) => setTimeout(r, every));
  }
  return null;
}
