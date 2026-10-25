/**
 * 抓 B 站视频的「可总结文本」：优先字幕，其次 AI 总结，最后退回简介+热评。
 *
 *   node tools/bili-summarize.mjs <BV号或URL> [--out file.txt]
 *
 * 做法：从浏览器里取 cookie（你已登录），在 Node 里做 wbi 签名调官方接口。
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PORT = 9222;
const arg = process.argv[2];
if (!arg) {
  console.error('用法: node tools/bili-summarize.mjs <BV号或URL> [--out file.txt]');
  process.exit(1);
}
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;
const bvid = /BV[0-9A-Za-z]{10}/.exec(arg)?.[0];
if (!bvid) {
  console.error('没识别出 BV 号');
  process.exit(1);
}

// ---------- 1) 从浏览器拿 cookie ----------
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /bilibili\.com/.test(t.url)) || list.find((t) => t.type === 'page');
if (!page) throw new Error('没有 bilibili 标签页');
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
await call('Network.enable');
const ck = await call('Network.getCookies', { urls: ['https://www.bilibili.com', 'https://api.bilibili.com'] });
ws.close();
const cookie = ck.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const loggedIn = ck.cookies.some((c) => c.name === 'SESSDATA');
console.log(`cookie: ${ck.cookies.length} 条，登录态=${loggedIn ? '已登录' : '未登录'}`);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const H = {
  cookie,
  'user-agent': UA,
  referer: `https://www.bilibili.com/video/${bvid}/`,
  origin: 'https://www.bilibili.com'
};
const getJson = async (url) => {
  const r = await fetch(url, { headers: H });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { code: -1, message: 'non-json: ' + t.slice(0, 120) };
  }
};

// ---------- 2) wbi 签名 ----------
const TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52
];

const nav = await getJson('https://api.bilibili.com/x/web-interface/nav');
const imgUrl = nav?.data?.wbi_img?.img_url ?? '';
const subUrl = nav?.data?.wbi_img?.sub_url ?? '';
const keyOf = (u) => u.slice(u.lastIndexOf('/') + 1).split('.')[0];
const imgKey = keyOf(imgUrl);
const subKey = keyOf(subUrl);
const mixin = TAB.map((i) => (imgKey + subKey)[i]).join('').slice(0, 32);
console.log('wbi keys:', imgKey ? 'ok' : '缺失', '| 登录用户:', nav?.data?.uname ?? '(未登录)');

const md5 = (s) => createHash('md5').update(s).digest('hex');
function sign(params) {
  const wts = Math.round(Date.now() / 1000);
  const all = { ...params, wts };
  const query = Object.keys(all)
    .sort()
    .map((k) => {
      const v = String(all[k]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  return `${query}&w_rid=${md5(query + mixin)}`;
}

// ---------- 3) 拿 aid/cid/up_mid ----------
const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
if (view.code !== 0) {
  console.error('取视频信息失败:', view.code, view.message);
  process.exit(1);
}
const { aid, cid, title, desc, duration, owner, stat } = view.data;
console.log(`视频: ${title}`);
console.log(`UP: ${owner.name}  时长: ${Math.round(duration / 60)} 分  播放: ${stat.view}`);

// ---------- 4) 字幕 ----------
let transcript = '';
let source = '';
const p2 = await getJson(`https://api.bilibili.com/x/player/wbi/v2?${sign({ aid, cid })}`);
const subs = p2?.data?.subtitle?.subtitles ?? [];
console.log('字幕轨:', subs.length ? subs.map((s) => s.lan + '/' + s.lan_doc).join(', ') : '(无)');

for (const s of subs) {
  const url = s.subtitle_url?.startsWith('//') ? 'https:' + s.subtitle_url : s.subtitle_url;
  if (!url) continue;
  const j = await getJson(url);
  const body = j?.body ?? [];
  if (body.length) {
    transcript = body.map((b) => b.content.replace(/\s+/g, '')).join('\n');
    source = `字幕 ${s.lan_doc}`;
    console.log(`取到字幕 ${body.length} 句，${transcript.length} 字`);
    break;
  }
}

// ---------- 5) AI 总结（没有字幕时） ----------
let conclusion = '';
if (!transcript) {
  const c = await getJson(
    `https://api.bilibili.com/x/web-interface/view/conclusion/get?${sign({ bvid, cid, up_mid: owner.mid })}`
  );
  if (c.code === 0 && c.data?.model_result) {
    const m = c.data.model_result;
    conclusion = (m.summary || '') + '\n\n' + (m.outline ?? []).map((o) => `- ${o.title}\n  ${(o.part_outline ?? []).join('\n  ')}`).join('\n');
    source = 'B站 AI 总结';
    console.log('AI 总结:', conclusion.length, '字');
  } else {
    console.log('AI 总结不可用:', c.code, c.message);
  }
}

// ---------- 6) 兜底：简介 ----------
const head = [
  `标题: ${title}`,
  `UP: ${owner.name}`,
  `时长: ${Math.round(duration / 60)} 分钟`,
  `播放: ${stat.view}`,
  `链接: https://www.bilibili.com/video/${bvid}`,
  '',
  '简介:',
  desc || '(无)'
].join('\n');

const body = transcript || conclusion || '';
const text = head + '\n\n' + (body ? `【${source}】\n${body}` : '（没有拿到字幕或 AI 总结，只有简介）');
if (outFile) {
  writeFileSync(outFile, text, 'utf8');
  console.log('已写入:', outFile);
}
console.log('\n===== 输出 =====\n' + text.slice(0, 1200) + (text.length > 1200 ? '\n…（共 ' + text.length + ' 字）' : ''));
