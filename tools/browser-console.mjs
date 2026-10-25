/**
 * browser-console —— 通用浏览器控制台（独立进程，不碰 DSH）。
 *
 * 它连的是 9222 端口那个 Edge（--remote-debugging-port=9222），
 * 给一排按钮：打开网址 / 截图 / 读文字 / 点击 / 输入 / 回车 / 滚动 / 后退 / 新标签 / 执行 JS。
 *
 *   node browser-console.mjs [端口]     # 默认 3100
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { fetchVideoText } from './bili-text.mjs';
import { saveNote } from './notes.mjs';

const PORT = Number(process.argv[2] || 3100);
const CDP = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 复用 gpt-driver 的提问能力（同一个单通道约束：同一条一条来）
const gptMod = await import(pathToFileURL('D:/deepseek/dsh-gpt-driver/src/index.js').href);
const gptTools = new Map();
gptMod.apply({ tools: { register: (t) => gptTools.set(t.name, t) } }, { port: 9222 });
const gpt = (name, args) => gptTools.get(name).execute(args ?? {});

// ---------- CDP 基础 ----------

async function listTargets() {
  const r = await fetch(CDP + '/json/list');
  if (!r.ok) throw new Error('CDP 不可用（Edge 没带 --remote-debugging-port=9222 启动？）');
  return r.json();
}

async function pickTarget() {
  const list = await listTargets();
  const pages = list.filter((t) => t.type === 'page');
  if (!pages.length) throw new Error('没有可用的标签页');
  // 优先非 chatgpt 的标签页，其次最后一个
  return pages.find((p) => !/chatgpt\.com/.test(p.url)) ?? pages[pages.length - 1];
}

async function newTab(url = 'about:blank') {
  const r = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error('新建标签失败: ' + r.status);
  return r.json();
}

async function connect() {
  const target = await pickTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WebSocket 连接失败'));
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (!m.id || !pending.has(m.id)) return;
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await call('Page.enable');
  await call('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval 失败');
    return r.result?.value;
  };
  return { call, evaluate, close: () => ws.close(), target };
}

const withPage = async (fn) => {
  const s = await connect();
  try {
    return await fn(s);
  } finally {
    s.close();
  }
};

// ---------- 动作 ----------

/** 确保有一个 ChatGPT 标签页（没有就开一个），然后返回它的状态 */
async function ensureChatGPT() {
  try {
    return await gpt('gpt_status');
  } catch {
    await newTab('https://chatgpt.com/');
    await sleep(9000);
    return await gpt('gpt_status');
  }
}

const actions = {
  async open({ url }) {
    if (!url) throw new Error('需要 url');
    return withPage(async (s) => {
      await s.call('Page.navigate', { url });
      await sleep(1500);
      return { url: await s.evaluate('location.href'), title: await s.evaluate('document.title') };
    });
  },

  async text() {
    return withPage(async (s) => ({
      url: await s.evaluate('location.href'),
      title: await s.evaluate('document.title'),
      text: (await s.evaluate('(document.body.innerText||"")')).slice(0, 6000)
    }));
  },

  async links({ limit = 40 } = {}) {
    return withPage(async (s) =>
      s.evaluate(`(() => {
        const out = [];
        for (const a of document.querySelectorAll('a[href]')) {
          const t = (a.innerText || a.getAttribute('title') || '').trim().replace(/\\s+/g, ' ');
          if (!t || t.length < 2) continue;
          out.push({ text: t.slice(0, 80), href: a.href });
          if (out.length >= ${Number(limit)}) break;
        }
        return out;
      })()`)
    );
  },

  async shot() {
    return withPage(async (s) => {
      const r = await s.call('Page.captureScreenshot', { format: 'png' });
      return { dataUrl: 'data:image/png;base64,' + r.data };
    });
  },

  async click({ selector, x, y, nth = 0 }) {
    return withPage(async (s) => {
      let pt = null;
      if (typeof x === 'number' && typeof y === 'number') {
        pt = { x, y, what: '坐标' };
      } else {
        if (!selector) throw new Error('需要 selector 或 x,y');
        pt = await s.evaluate(`(() => {
          const list = [...document.querySelectorAll(${JSON.stringify(selector)})];
          const el = list[${Number(nth)}];
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), what: (el.innerText || el.tagName).trim().slice(0, 40) };
        })()`);
        if (!pt) throw new Error('找不到元素: ' + selector);
      }
      for (const type of ['mousePressed', 'mouseReleased']) {
        await s.call('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
        await sleep(80);
      }
      await sleep(800);
      return { clicked: pt, url: await s.evaluate('location.href') };
    });
  },

  async type({ text }) {
    return withPage(async (s) => {
      const focused = await s.evaluate(`(() => {
        const el = document.activeElement;
        return el ? (el.tagName + (el.getAttribute('placeholder') ? ':' + el.getAttribute('placeholder') : '')) : 'none';
      })()`);
      await s.call('Input.insertText', { text: String(text ?? '') });
      await sleep(300);
      return { focused, typed: String(text ?? '').slice(0, 120) };
    });
  },

  async key({ name = 'Enter' }) {
    const map = {
      Enter: { key: 'Enter', code: 'Enter', vk: 13 },
      Escape: { key: 'Escape', code: 'Escape', vk: 27 },
      Tab: { key: 'Tab', code: 'Tab', vk: 9 },
      PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
      Space: { key: ' ', code: 'Space', vk: 32 }
    };
    const k = map[name] || map.Enter;
    return withPage(async (s) => {
      for (const type of ['keyDown', 'keyUp']) {
        await s.call('Input.dispatchKeyEvent', { type, key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk });
        await sleep(60);
      }
      await sleep(600);
      return { pressed: name, url: await s.evaluate('location.href') };
    });
  },

  async scroll({ dy = 600 }) {
    return withPage(async (s) => {
      const before = await s.evaluate('window.scrollY');
      await s.evaluate(`window.scrollBy(0, ${Number(dy)})`);
      await sleep(700);
      const after = await s.evaluate('window.scrollY');
      return { from: before, to: after };
    });
  },

  async back() {
    return withPage(async (s) => {
      await s.evaluate('history.back()');
      await sleep(1500);
      return { url: await s.evaluate('location.href') };
    });
  },

  async eval({ code }) {
    if (!code) throw new Error('需要 code');
    return withPage(async (s) => ({ value: await s.evaluate(code) }));
  },

  async tabs() {
    const list = await listTargets();
    return list.filter((t) => t.type === 'page').map((t) => ({ title: t.title, url: t.url }));
  },

  async newtab({ url = 'https://www.bilibili.com/' }) {
    const t = await newTab(url);
    await sleep(1800);
    return { opened: t.url };
  },

  // ---------- 视频总结 ----------

  async videoText({ url }) {
    const v = await fetchVideoText(url);
    return {
      title: v.title,
      up: v.up,
      duration: v.duration + ' 分钟',
      view: v.view,
      source: v.source,
      chars: v.chars,
      transcript: v.text
    };
  },

  async videoSummary({ url, withGpt = true }) {
    const v = await fetchVideoText(url);
    const head = `标题：${v.title}\nUP：${v.up}\n时长：${v.duration} 分钟\n播放：${v.view}`;
    if (!withGpt || !v.text) {
      return { title: v.title, head, source: v.source, chars: v.chars, summary: '(未生成总结)', transcript: v.text };
    }
    await ensureChatGPT();
    // 让浏览器里的 ChatGPT 总结（长字幕会截断到 12000 字，够用）
    const body = v.text.length > 12000 ? v.text.slice(0, 12000) + '\n…（后略）' : v.text;
    const prompt =
      '你是一个中文视频内容总结助手。下面是一条 B 站视频的完整字幕，请输出结构化总结，要求：\n' +
      '1) 先用一句话给出结论；\n2) 再按主题分点，每点不超过两行；\n' +
      '3) 保留具体数字、型号、结论性判断；\n' +
      '4) 不要复述原句，不要客套，不要加“这个视频介绍了”。\n\n' +
      `视频标题：${v.title}\nUP：${v.up}\n\n【字幕】\n${body}`;
    const r = await gpt('gpt_ask', { text: prompt, timeoutSec: 300 });
    let note = null;
    try {
      const saved = saveNote({
        title: v.title,
        up: v.up,
        bvid: v.bvid,
        url: `https://www.bilibili.com/video/${v.bvid}`,
        duration: v.duration,
        view: v.view,
        source: v.source,
        summary: r.answer,
        transcript: v.text
      });
      note = saved.rel;
    } catch (e) {
      note = '保存失败: ' + (e.message || e);
    }
    return { title: v.title, head, source: v.source, chars: v.chars, summary: r.answer, transcript: v.text, note };
  }
};

// ---------- HTTP ----------

const PAGE = String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>浏览器控制台</title>
<style>
:root{color-scheme:dark}
body{margin:0;padding:20px;background:#0b1522;color:#dce9f7;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}
h1{font-size:17px;margin:0 0 4px}.sub{color:#7f97b0;font-size:12px;margin-bottom:14px}
.card{border:1px solid #1d3350;border-radius:12px;padding:13px;margin-bottom:12px;background:#101d2e}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
button{padding:6px 13px;border-radius:9px;cursor:pointer;border:1px solid #3a628f;background:#1b3352;color:#dceaf9;font:inherit}
button:hover{background:#25456b}button.primary{background:#2563c0;border-color:#3b82f6}
input,textarea{box-sizing:border-box;padding:8px 10px;border-radius:9px;border:1px solid #29456a;background:#0a1320;color:#dceaf9;font:13px/1.5 ui-monospace,Consolas,monospace}
input{flex:1;min-width:220px}
pre{margin:8px 0 0;padding:10px;border-radius:9px;background:#08111c;border:1px solid #1c3049;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;font-size:12.5px}
img.shot{max-width:100%;border-radius:10px;border:1px solid #1d3350;margin-top:8px}
.hint{color:#7f97b0;font-size:12px}.ok{color:#63e6a8}.err{color:#ff9b9b}
</style></head><body>
<h1>浏览器控制台</h1>
<div class="sub">独立进程 · 操作 9222 端口那个 Edge（<span id="tab">…</span>）</div>

<div class="card">
  <div class="row"><input id="url" value="https://www.bilibili.com/" placeholder="网址">
    <button class="primary" onclick="act('open',{url:$('url').value})">打开</button>
    <button onclick="act('newtab',{url:$('url').value})">新标签打开</button>
    <button onclick="act('tabs')">列出标签</button>
  </div>
  <div class="row">
    <button onclick="act('shot')">截图</button>
    <button onclick="act('text')">读文字</button>
    <button onclick="act('links')">列链接</button>
    <button onclick="act('scroll',{dy:800})">下滚</button>
    <button onclick="act('scroll',{dy:-800})">上滚</button>
    <button onclick="act('back')">后退</button>
  </div>
</div>

<div class="card">
  <div class="row"><strong>📺 视频总结</strong><span class="hint">贴 B 站链接或 BV 号，抓字幕后让 ChatGPT 总结</span></div>
  <div class="row"><input id="vid" value="" placeholder="https://www.bilibili.com/video/BV1xrnz6gEVD">
    <button class="primary" onclick="videoSummary()">取字幕 + 总结</button>
    <button onclick="videoText()">只要字幕</button>
  </div>
  <pre id="vidout">—</pre>
  <div id="vidbox"></div>
</div>

<div class="card">
  <div class="row"><strong>点击</strong></div>
  <div class="row"><input id="sel" value=".bili-video-card" placeholder="CSS 选择器，例如 .bili-video-card">
    <button onclick="act('click',{selector:$('sel').value})">点击第一个</button>
    <button onclick="act('click',{selector:$('sel').value,nth:1})">点击第二个</button>
  </div>
  <div class="row"><strong>输入</strong><input id="txt" placeholder="要输入的文字">
    <button onclick="act('type',{text:$('txt').value})">输入到焦点</button>
    <button onclick="act('key',{name:'Enter'})">回车</button>
    <button onclick="act('key',{name:'Escape'})">Esc</button>
  </div>
  <div class="row"><strong>JS</strong><input id="code" placeholder="要执行的 JS，例如 document.title">
    <button onclick="act('eval',{code:$('code').value})">执行</button>
  </div>
</div>

<div class="card">
  <div class="row"><strong>结果</strong><span class="hint" id="ms"></span></div>
  <pre id="out">—</pre>
  <div id="shotbox"></div>
</div>

<script>
const $=(id)=>document.getElementById(id);
async function act(name,args){
  $('out').textContent='执行中…'; $('ms').textContent='';
  const t0=Date.now();
  try{
    const r=await fetch('/api/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args||{})});
    const j=await r.json();
    $('ms').textContent=(Date.now()-t0)+' ms';
    if(name==='shot'&&j.ok){
      $('out').textContent='已截图 '+j.result.width+'x'+j.result.height;
      $('shotbox').innerHTML='<img class="shot" src="'+j.result.dataUrl+'">';
      return;
    }
    $('out').innerHTML = j.ok ? JSON.stringify(j.result,null,2).replace(/</g,'&lt;') : '<span class="err">'+(j.error||'失败')+'</span>';
    if(name==='open'||name==='newtab'||name==='click') refreshTab();
  }catch(e){ $('out').innerHTML='<span class="err">'+e.message+'</span>'; }
}
async function refreshTab(){
  try{
    const r=await fetch('/api/current'); const j=await r.json();
    if(j.ok) $('tab').textContent=(j.result.title||'')+' · '+j.result.url;
  }catch(e){}
}

async function videoText(){
  const url=$('vid').value.trim(); if(!url) return alert('先贴链接或 BV 号');
  $('vidout').textContent='抓字幕中…';
  try{
    const r=await fetch('/api/videoText',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
    const j=await r.json();
    if(!j.ok){ $('vidout').innerHTML='<span class="err">'+(j.error||'失败')+'</span>'; return; }
    const t=j.result;
    $('vidout').textContent=[t.title,'UP: '+t.up,'时长: '+t.duration,'播放: '+t.view,'来源: '+t.source,t.chars+' 字','','------ 字幕 ------',''].join('\n')+t.transcript;
  }catch(e){ $('vidout').innerHTML='<span class="err">'+e.message+'</span>'; }
}

async function videoSummary(){
  const url=$('vid').value.trim(); if(!url) return alert('先贴链接或 BV 号');
  $('vidout').textContent='抓字幕 + 等 ChatGPT 总结…（通常 30~90 秒）';
  $('vidbox').innerHTML='';
  try{
    const r=await fetch('/api/videoSummary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,withGpt:true})});
    const j=await r.json();
    if(!j.ok){ $('vidout').innerHTML='<span class="err">'+(j.error||'失败')+'</span>'; return; }
    const t=j.result;
    $('vidout').innerHTML='<span class="ok">'+t.summary.replace(/</g,'&lt;')+'</span>';
    $('vidbox').innerHTML='<div class="hint">'+t.head.replace(/\\n/g,' · ')+'　|　文本来源: '+t.source+'（'+t.chars+' 字）'+
      (t.note ? '　|　已存档: notes/'+t.note : '')+'</div>'+
      '<button onclick="showRaw()">查看原始字幕</button><pre id="raw" style="display:none"></pre>';
    window.__raw=t.transcript;
  }catch(e){ $('vidout').innerHTML='<span class="err">'+e.message+'</span>'; }
}

function showRaw(){
  const el=$('raw');
  if(!el) return;
  el.style.display = el.style.display==='none'?'block':'none';
  if(!el.textContent) el.textContent=window.__raw||'';
}

refreshTab(); setInterval(refreshTab,5000);
</script></body></html>`;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (url.pathname === '/api/current') {
      const t = await pickTarget();
      return json(res, 200, { ok: true, result: { title: t.title, url: t.url } });
    }
    if (req.method !== 'POST') return json(res, 404, { ok: false, error: 'not found' });

    const name = url.pathname.replace('/api/', '');
    const fn = actions[name];
    if (!fn) return json(res, 404, { ok: false, error: 'unknown action: ' + name });

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

    const result = await fn(body);
    if (name === 'shot') {
      const m = /^data:image\/png;base64,(.*)$/.exec(result.dataUrl);
      const buf = Buffer.from(m[1], 'base64');
      // 宽高从 PNG 头里读（IHDR: 第 16-24 字节）
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return json(res, 200, { ok: true, result: { dataUrl: result.dataUrl, width, height, bytes: buf.length } });
    }
    json(res, 200, { ok: true, result });
  } catch (e) {
    json(res, 200, { ok: false, error: String(e.message || e) });
  }
}).listen(PORT, '127.0.0.1', () => console.log('浏览器控制台: http://127.0.0.1:' + PORT));
