/**
 * GPT 控制台 —— 一个独立的小网页，给 gpt-driver 插件加一排按钮。
 *
 * 为什么独立：它跑在自己进程里（3099 端口），只调用插件模块，**完全不碰 DSH**，
 * 所以不会出现之前那种"装个插件把 GUI 弄炸"的情况。
 *
 *   node gpt-console.mjs           # 打开 http://127.0.0.1:3099
 *   node gpt-console.mjs 3100      # 换端口
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.argv[2] || 3099);
const PLUGIN = 'D:/deepseek/dsh-gpt-driver/src/index.js';

// 用假 ctx 把插件的 5 个工具注册出来（和端到端测试同一套做法）
const mod = await import(pathToFileURL(PLUGIN).href);
const tools = new Map();
mod.apply({ tools: { register: (t) => tools.set(t.name, t) } }, { port: 9222 });
const call = (name, args) => tools.get(name).execute(args ?? {});

const log = [];
function note(msg) {
  const line = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + msg;
  log.unshift(line);
  if (log.length > 60) log.pop();
  console.log(line);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

const PAGE = String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GPT 控制台</title>
<style>
:root{color-scheme:dark}
body{margin:0;padding:22px;background:#0b1522;color:#dce9f7;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}
h1{font-size:17px;margin:0 0 4px}.sub{color:#7f97b0;font-size:12px;margin-bottom:16px}
.card{border:1px solid #1d3350;border-radius:12px;padding:14px;margin-bottom:14px;background:#101d2e}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
button{padding:7px 14px;border-radius:9px;cursor:pointer;border:1px solid #3a628f;background:#1b3352;color:#dceaf9;font:inherit}
button:hover{background:#25456b}button:disabled{opacity:.45;cursor:not-allowed}
button.primary{background:#2563c0;border-color:#3b82f6}
textarea,input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:9px;border:1px solid #29456a;
background:#0a1320;color:#dceaf9;font:13px/1.5 ui-monospace,Consolas,monospace}
textarea{min-height:96px;resize:vertical}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid #2c4a6e;color:#9fc3e8}
.badge.ok{color:#63e6a8;border-color:#2f6b4f}.badge.busy{color:#ffcf6b;border-color:#6b5a2f}
pre{margin:8px 0 0;padding:10px;border-radius:9px;background:#08111c;border:1px solid #1c3049;
white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;font-size:12.5px}
img.preview{max-width:100%;border-radius:10px;border:1px solid #1d3350;margin-top:10px}
.hint{color:#7f97b0;font-size:12px}
.ok{color:#63e6a8}.err{color:#ff9b9b}
</style></head><body>
<h1>GPT 控制台</h1>
<div class="sub">独立进程 · 操作的是 9222 端口那个已登录的 ChatGPT 标签页</div>

<div class="card">
  <div class="row"><span class="badge" id="st">连接中…</span><span class="hint" id="stx"></span></div>
  <div class="row"><button onclick="refresh()">刷新状态</button><button onclick="exportLast()">取最新一张图</button></div>
</div>

<div class="card">
  <div class="row"><strong>发提示词 / 出图</strong></div>
  <textarea id="prompt" placeholder="比如：一张二叠纪海底的手绘插画，奇虾在捕食三叶虫…"></textarea>
  <div class="row" style="margin-top:10px">
    <input id="out" value="D:\deepseek\art\raw\console-1.png" style="flex:1;min-width:260px">
  </div>
  <div class="row">
    <button class="primary" id="btnGen" onclick="gen()">发一条 → 等画完 → 存盘</button>
    <button id="btnAsk" onclick="ask()">只问文字（不出图）</button>
  </div>
  <pre id="out1"></pre>
  <div id="imgbox"></div>
</div>

<div class="card">
  <div class="row"><strong>最近操作</strong></div>
  <pre id="logs">—</pre>
</div>

<script>
const $ = (id) => document.getElementById(id);
let busy = false;

function setBusy(v, label) {
  busy = v;
  $('btnGen').disabled = v; $('btnAsk').disabled = v;
  if (label) $('out1').textContent = label;
}

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
}

async function refresh() {
  try {
    const s = await api('/api/status');
    const el = $('st');
    if (s.ok) {
      el.textContent = s.result.busy ? '正在生成' : '空闲';
      el.className = 'badge ' + (s.result.busy ? 'busy' : 'ok');
      $('stx').textContent = '页面 ' + s.result.images + ' 张图 · ' + (s.result.url || '');
    } else {
      el.textContent = '连不上'; el.className = 'badge'; $('stx').textContent = s.error || '';
    }
  } catch (e) { $('st').textContent = '连不上'; $('stx').textContent = e.message; }
  const l = await api('/api/log');
  $('logs').textContent = (l.lines || []).join('\n') || '—';
}

function show(r, okText) {
  const ok = r && r.ok;
  $('out1').innerHTML = '<span class="' + (ok ? 'ok' : 'err') + '">' + (ok ? okText : ('失败：' + (r.error || '未知'))) + '</span>\n' + JSON.stringify(r.result ?? r, null, 2);
}

async function gen() {
  const text = $('prompt').value.trim();
  const out = $('out').value.trim();
  if (!text) return alert('先写提示词');
  setBusy(true, '发送中…');
  $('imgbox').innerHTML = '';
  try {
    const s = await api('/api/send', { text });
    if (!s.ok) return show(s, '');
    $('out1').textContent = '已发送，基线 ' + s.result.baseline + ' 张图，等待生成…（通常 40 秒 ~ 3 分钟）';
    const w = await api('/api/wait', { outPath: out, timeoutSec: 300 });
    show(w, '已存盘');
    if (w.ok) {
      $('imgbox').innerHTML = '<div class="hint">预览：' + w.result.path + '（' + Math.round(w.result.bytes / 1024) + ' KB · ' + w.result.seconds + ' 秒）</div>' +
        '<img class="preview" src="/api/image?path=' + encodeURIComponent(w.result.path) + '&t=' + Date.now() + '">';
    }
  } finally { setBusy(false); refresh(); }
}

async function ask() {
  const text = $('prompt').value.trim();
  if (!text) return alert('先写问题');
  setBusy(true, '提问中…');
  try {
    const r = await api('/api/ask', { text });
    if (r.ok) {
      $('out1').innerHTML = '<span class="ok">回答（' + r.result.chars + ' 字）：</span>\n' + r.result.answer;
    } else show(r, '');
  } finally { setBusy(false); refresh(); }
}

async function exportLast() {
  const out = $('out').value.trim() || 'D:\\deepseek\\art\\raw\\console-last.png';
  const r = await api('/api/export', { outPath: out });
  show(r, '已取回最新一张');
  if (r.ok) $('imgbox').innerHTML = '<img class="preview" src="/api/image?path=' + encodeURIComponent(r.result.path) + '&t=' + Date.now() + '">';
  refresh();
}

refresh(); setInterval(refresh, 4000);
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (url.pathname === '/api/log') return json(res, 200, { lines: log });

    if (url.pathname === '/api/image') {
      const p = url.searchParams.get('path') || '';
      const abs = resolve(p);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      const ext = extname(abs).toLowerCase();
      const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(readFileSync(abs));
    }

    if (url.pathname === '/api/status') {
      try {
        return json(res, 200, { ok: true, result: await call('gpt_status') });
      } catch (e) {
        return json(res, 200, { ok: false, error: String(e.message || e) });
      }
    }

    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      let result;
      try {
        if (url.pathname === '/api/send') {
          if (!body.text || body.text.trim().length < 4) throw new Error('提示词太短');
          result = await call('gpt_send', { text: body.text });
          note('发送提示词，基线 ' + result.baseline + ' 张');
        } else if (url.pathname === '/api/wait') {
          const out = body.outPath || 'D:/deepseek/art/raw/console-1.png';
          result = await call('gpt_wait_image', { outPath: out, timeoutSec: body.timeoutSec || 300 });
          note('出图完成 ' + result.path + '  ' + Math.round(result.bytes / 1024) + 'KB  ' + result.seconds + 's');
        } else if (url.pathname === '/api/ask') {
          if (!body.text || body.text.trim().length < 2) throw new Error('问题太短');
          result = await call('gpt_ask', { text: body.text, timeoutSec: body.timeoutSec || 240 });
          note('问答完成 ' + result.chars + ' 字');
        } else if (url.pathname === '/api/export') {
          const out = body.outPath || 'D:/deepseek/art/raw/console-last.png';
          result = await call('gpt_export_latest', { outPath: out });
          note('取回最新图 ' + result.path);
        } else {
          return json(res, 404, { ok: false, error: 'unknown endpoint' });
        }
        return json(res, 200, { ok: true, result });
      } catch (e) {
        note('失败：' + (e.message || e));
        return json(res, 200, { ok: false, error: String(e.message || e) });
      }
    }

    json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    json(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('GPT 控制台: http://127.0.0.1:' + PORT);
  note('服务启动，端口 ' + PORT);
});
