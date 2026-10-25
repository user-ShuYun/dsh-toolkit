/**
 * bili.mjs —— 通过 CDP 借用浏览器（带你自己的登录态）读 B 站。
 *
 *   node tools/bili.mjs state                 看有没有登录
 *   node tools/bili.mjs search "古生物" 8     搜视频（标题/UP/播放/时长/BV号）
 *   node tools/bili.mjs info BV19b411g7vo     视频详情 + 字幕语言列表
 *   node tools/bili.mjs subs BV19b411g7vo 0   取第 0 条字幕的正文（需要登录）
 *
 * 为什么走浏览器：B 站的字幕 / AI 总结接口要 SESSDATA，直接 curl 拿不到；
 * 在页面里 fetch 会自动带上浏览器的 cookie。
 */
const PORT = Number(process.env.CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && /bilibili\.com/.test(t.url)) || list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error('没有可用的页面（先用 --remote-debugging-port=9222 启动浏览器并打开 bilibili.com）');
}

async function connect() {
  const page = await pickPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('cdp ws failed'));
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (!m.id || !pending.has(m.id)) return;
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await call('Runtime.enable');
  const evaluate = async (expr) => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
    return r.result?.value;
  };
  return { call, evaluate, close: () => ws.close() };
}

/** 在页面里 fetch 一个 B 站接口（自动带 cookie） */
function apiFetch(s, url) {
  return s.evaluate(`(async () => {
    const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
    return await r.text();
  })()`);
}

const dur = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

const [cmd, ...rest] = process.argv.slice(2);
const s = await connect();
try {
  if (cmd === 'state') {
    const nav = JSON.parse(await apiFetch(s, 'https://api.bilibili.com/x/web-interface/nav'));
    console.log(JSON.stringify({ loggedIn: nav.data?.isLogin ?? false, user: nav.data?.uname ?? null, vip: nav.data?.vipStatus ?? 0 }));
  } else if (cmd === 'search') {
    const kw = rest[0] ?? '科普';
    const n = Number(rest[1] ?? 8);
    const j = JSON.parse(await apiFetch(s, `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(kw)}&page=1`));
    if (j.code !== 0) throw new Error('search code ' + j.code + ' ' + j.message);
    for (const v of (j.data?.result ?? []).slice(0, n)) {
      console.log([v.bvid, (v.title ?? '').replace(/<[^>]+>/g, ''), v.author, '▶' + v.play, dur(v.duration), v.pubdate].join('\t'));
    }
  } else if (cmd === 'info') {
    const bvid = rest[0];
    const v = JSON.parse(await apiFetch(s, `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`));
    if (v.code !== 0) throw new Error('view code ' + v.code);
    const d = v.data;
    console.log(JSON.stringify({
      bvid, aid: d.aid, cid: d.cid, title: d.title, up: d.owner?.name,
      duration: dur(d.duration), views: d.stat?.view, likes: d.stat?.like,
      desc: (d.desc ?? '').slice(0, 300)
    }, null, 1));
    const p = JSON.parse(await apiFetch(s, `https://api.bilibili.com/x/player/v2?aid=${d.aid}&cid=${d.cid}`));
    const subs = p.data?.subtitle?.subtitles ?? [];
    console.log('subtitles: ' + subs.length);
    subs.forEach((x, i) => console.log(`  [${i}] ${x.lan} ${x.lan_doc}`));
  } else if (cmd === 'subs') {
    const bvid = rest[0];
    const idx = Number(rest[1] ?? 0);
    const v = JSON.parse(await apiFetch(s, `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`));
    const d = v.data;
    const p = JSON.parse(await apiFetch(s, `https://api.bilibili.com/x/player/v2?aid=${d.aid}&cid=${d.cid}`));
    const sub = (p.data?.subtitle?.subtitles ?? [])[idx];
    if (!sub) throw new Error('没有字幕（需要登录 B 站，或这个视频没 CC 字幕）');
    const body = JSON.parse(await apiFetch(s, sub.subtitle_url.startsWith('//') ? 'https:' + sub.subtitle_url : sub.subtitle_url));
    const lines = (body.body ?? []).map((x) => `[${dur(Math.floor(x.from))}] ${x.content}`);
    console.log(lines.join('\n'));
  } else {
    console.log('用法: node tools/bili.mjs state|search <kw> [n]|info <bvid>|subs <bvid> [idx]');
  }
} finally {
  s.close();
}
