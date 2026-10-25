/**
 * bili-text.mjs —— 拿一个 B 站视频的「可总结文本」。
 *
 * 和 tools/bili.mjs 的区别：那个是命令行工具，这个是可以被控制台 import 的函数，
 * 且用 wbi 签名直接调 player/wbi/v2（比页面内的 player/v2 更稳），拿不到字幕就退 AI 总结。
 */
import { createHash } from 'node:crypto';

const PORT = Number(process.env.CDP_PORT || 9222);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52
];
const md5 = (s) => createHash('md5').update(s).digest('hex');

/** 从浏览器取 bilibili 的 cookie（借你的登录态） */
async function getCookies() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page =
    list.find((t) => t.type === 'page' && /bilibili\.com/.test(t.url)) || list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的标签页（先在 9222 那个 Edge 里打开一次 bilibili.com）');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP 连接失败'));
  });
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
  await call('Network.enable');
  const ck = await call('Network.getCookies', {
    urls: ['https://www.bilibili.com', 'https://api.bilibili.com']
  });
  ws.close();
  return {
    header: ck.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    count: ck.cookies.length,
    loggedIn: ck.cookies.some((c) => c.name === 'SESSDATA')
  };
}

async function getJson(url, h) {
  const r = await fetch(url, { headers: h });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { code: -1, message: 'non-json: ' + t.slice(0, 100) };
  }
}

/**
 * @param {string} input BV 号或含 BV 号的链接
 * @returns {Promise<{bvid,title,up,duration,view,desc,source,text,chars}>}
 */
export async function fetchVideoText(input) {
  const bvid = /BV[0-9A-Za-z]{10}/.exec(String(input || ''))?.[0];
  if (!bvid) throw new Error('没识别出 BV 号（链接里应该有 BVxxxxxxxxxx）');

  const ck = await getCookies();
  if (!ck.loggedIn) throw new Error('浏览器里没有 B 站登录态');
  const H = {
    cookie: ck.header,
    'user-agent': UA,
    referer: `https://www.bilibili.com/video/${bvid}/`,
    origin: 'https://www.bilibili.com'
  };

  const nav = await getJson('https://api.bilibili.com/x/web-interface/nav', H);
  const imgKey = (nav?.data?.wbi_img?.img_url ?? '').split('/').pop().split('.')[0];
  const subKey = (nav?.data?.wbi_img?.sub_url ?? '').split('/').pop().split('.')[0];
  if (!imgKey || !subKey) throw new Error('拿不到 wbi key（登录态可能失效）');
  const mixin = TAB.map((i) => (imgKey + subKey)[i]).join('').slice(0, 32);
  const sign = (params) => {
    const all = { ...params, wts: Math.round(Date.now() / 1000) };
    const q = Object.keys(all)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ''))}`)
      .join('&');
    return `${q}&w_rid=${md5(q + mixin)}`;
  };

  const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, H);
  if (view.code !== 0) throw new Error('取视频信息失败: ' + (view.message || view.code));
  const { aid, cid, title, desc, duration, owner, stat } = view.data;

  let text = '';
  let source = '';
  const p2 = await getJson(`https://api.bilibili.com/x/player/wbi/v2?${sign({ aid, cid })}`, H);
  for (const s of p2?.data?.subtitle?.subtitles ?? []) {
    const url = s.subtitle_url?.startsWith('//') ? 'https:' + s.subtitle_url : s.subtitle_url;
    if (!url) continue;
    const j = await getJson(url, H);
    const body = j?.body ?? [];
    if (body.length) {
      text = body.map((b) => b.content.replace(/\s+/g, '')).join('\n');
      source = '字幕 ' + (s.lan_doc || s.lan);
      break;
    }
  }

  if (!text) {
    const c = await getJson(
      `https://api.bilibili.com/x/web-interface/view/conclusion/get?${sign({ bvid, cid, up_mid: owner.mid })}`,
      H
    );
    if (c.code === 0 && c.data?.model_result) {
      const m = c.data.model_result;
      text =
        (m.summary || '') +
        '\n\n' +
        (m.outline ?? []).map((o) => `- ${o.title}\n  ${(o.part_outline ?? []).join('\n  ')}`).join('\n');
      source = 'B站 AI 总结';
    }
  }

  return {
    bvid,
    title,
    up: owner.name,
    duration: Math.round(duration / 60),
    view: stat.view,
    desc: desc || '',
    source: source || '(无字幕，仅简介)',
    text,
    chars: text.length
  };
}
