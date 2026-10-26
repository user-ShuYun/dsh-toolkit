/**
 * launcher —— 一个只有按钮的页面：启动/检查工具箱。
 *
 *   node tools/launcher.mjs [端口]     # 默认 3101
 *
 * 它自己不需要任何依赖，所以哪怕其它服务全挂了也能打开。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const LESSONS = 'D:\\deepseek\\LESSONS.md';

/** 读经验库：统计 + 最值钱的 8 条 + 可直接发给 agent 的摘要 */
function lessons() {
  if (!existsSync(LESSONS)) return { count: 0, top: [], digest: '（还没有 LESSONS.md）' };
  const raw = readFileSync(LESSONS, 'utf8');
  const blocks = raw.split(/\n(?=## \[L\d+\])/).slice(1);
  const entries = [];
  for (const b of blocks) {
    const m = b.match(/^## \[(L\d+)\]\s*(\d{4}-\d{2}-\d{2})\s*·\s*([^\s·]+)\s*·\s*(.+)$/m);
    if (!m) continue;
    const hit = b.match(/^- 命中[:：]\s*(\d+)/m);
    const field = (label) => {
      const r = b.match(new RegExp('^- ' + label + '[:：]\\s*(.+)$', 'm'));
      return r ? r[1].trim() : '';
    };
    entries.push({
      id: m[1],
      date: m[2],
      tag: m[3],
      title: m[4].trim(),
      symptom: field('症状'),
      fix: field('修法'),
      hits: hit ? Number(hit[1]) : 0
    });
  }
  const top = entries.sort((a, b) => b.hits - a.hits || b.date.localeCompare(a.date)).slice(0, 8);
  const lines = [
    `请按 TOOLS.md 的开工顺序，先读经验库：D:\\deepseek\\LESSONS.md（共 ${entries.length} 条）。`,
    '',
    '最值钱的几条：'
  ];
  for (const t of top) {
    lines.push(`- [${t.id}·${t.tag}] ${t.title}`);
    if (t.symptom) lines.push(`  症状：${t.symptom}`);
    if (t.fix) lines.push(`  修法：${t.fix}`);
  }
  lines.push('', '读完告诉我：这次任务可能会踩哪几条，你打算怎么避开。');
  return { count: entries.length, top, digest: lines.join('\n') };
}

const PORT = Number(process.argv[2] || 3101);
const NODE = 'D:\\Node\\node.exe';
const TOOLS = 'D:\\deepseek\\tools';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portOpen(port) {
  // 9222 是 CDP，/json/list 就是探测点；3099/3100 是普通页面服务，根路径才是
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) return true;
  } catch {
    /* 继续试根路径 */
  }
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1200) });
    return r.status > 0;
  } catch {
    return false;
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('spawn', () => {
      p.unref();
      resolve(true);
    });
  });
}

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

async function status() {
  const [edge, gpt, browser] = await Promise.all([portOpen(9222), portOpen(3099), portOpen(3100)]);
  return { edge, gpt, browser };
}

async function startAll() {
  const log = [];
  let s = await status();

  if (!s.edge) {
    const edge = EDGE_PATHS.find((p) => existsSync(p));
    if (edge) {
      await run(edge, ['--remote-debugging-port=9222', '--user-data-dir=D:\\deepseek\\edge-cgpt', 'https://chatgpt.com/']);
      log.push('已启动 Edge（9222），等它起来…');
      for (let i = 0; i < 20 && !(await portOpen(9222)); i++) await sleep(1000);
      s = await status();
      log.push(s.edge ? '  Edge ✓' : '  Edge 还没起来，可能被拦截了');
    } else {
      log.push('找不到 Edge，请手动启动');
    }
  } else log.push('Edge 已在运行 ✓');

  if (!s.gpt) {
    await run(NODE, ['--use-system-ca', `${TOOLS}\\gpt-console.mjs`, '3099'], TOOLS);
    log.push('启动 GPT 控制台（3099）…');
    for (let i = 0; i < 12 && !(await portOpen(3099)); i++) await sleep(800);
    s = await status();
    log.push(s.gpt ? '  GPT 控制台 ✓' : '  启动失败');
  } else log.push('GPT 控制台已在运行 ✓');

  if (!s.browser) {
    await run(NODE, ['--use-system-ca', `${TOOLS}\\browser-console.mjs`, '3100'], TOOLS);
    log.push('启动浏览器控制台（3100）…');
    for (let i = 0; i < 12 && !(await portOpen(3100)); i++) await sleep(800);
    s = await status();
    log.push(s.browser ? '  浏览器控制台 ✓' : '  启动失败');
  } else log.push('浏览器控制台已在运行 ✓');

  return { log, status: await status() };
}

const PAGE = String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>工具箱</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:radial-gradient(1200px 600px at 50% -10%,#15304d,#0a1220 60%);color:#dce9f7;
font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif}
.wrap{width:min(520px,92vw);text-align:center}
h1{font-size:24px;margin:0 0 6px;letter-spacing:1px}
.sub{color:#7f97b0;font-size:13px;margin-bottom:26px}
.big{width:100%;padding:22px;font-size:19px;font-weight:600;border-radius:16px;cursor:pointer;
border:1px solid #3b82f6;background:linear-gradient(180deg,#2b6fd0,#1d4e96);color:#fff;
box-shadow:0 12px 34px rgba(37,99,195,.35);transition:transform .12s,box-shadow .12s}
.big:hover{transform:translateY(-1px);box-shadow:0 16px 40px rgba(37,99,195,.45)}
.big:active{transform:translateY(1px)}
.big[disabled]{opacity:.6;cursor:not-allowed}
.dots{display:flex;gap:10px;justify-content:center;margin:22px 0 10px;flex-wrap:wrap}
.dot{display:flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;
border:1px solid #24405f;background:#101d2e;font-size:13px}
.led{width:9px;height:9px;border-radius:50%;background:#54687f}
.led.on{background:#37d67a;box-shadow:0 0 10px #37d67a}
a{color:#8fd0ff;text-decoration:none}
.links{display:flex;gap:16px;justify-content:center;margin-top:18px;font-size:13px}
pre{text-align:left;margin:18px 0 0;padding:12px;border-radius:10px;background:#08111c;
border:1px solid #1c3049;font-size:12.5px;white-space:pre-wrap;max-height:200px;overflow:auto}
</style></head><body>
<div class="wrap">
  <h1>DSH 工具箱</h1>
  <div class="sub">一键拉起 Edge(9222) · GPT 控制台(3099) · 浏览器控制台(3100)</div>
  <button class="big" id="btn">▶ 启动 / 检查</button>
  <div class="dots">
    <div class="dot"><span class="led" id="led-edge"></span>Edge 9222</div>
    <div class="dot"><span class="led" id="led-gpt"></span>GPT 3099</div>
    <div class="dot"><span class="led" id="led-browser"></span>浏览器 3100</div>
  </div>
  <div class="links">
    <a href="http://127.0.0.1:3100" target="_blank">打开浏览器控制台 ↗</a>
    <a href="http://127.0.0.1:3099" target="_blank">打开 GPT 控制台 ↗</a>
  </div>

  <div style="margin-top:26px;text-align:left;background:#0a1622;border:1px solid #1c3049;border-radius:12px;padding:16px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <strong style="font-size:14px;color:#cfe6ff">📓 经验库</strong>
      <span id="lessonCount" style="font-size:12px;color:#7f9ab5"></span>
      <button id="copyLessons" style="margin-left:auto;padding:6px 12px;border-radius:8px;border:1px solid rgba(120,190,255,.35);background:rgba(28,54,86,.75);color:#cfe6ff;font-size:12px;cursor:pointer">复制摘要给 agent</button>
    </div>
    <div id="lessonList" style="font-size:12.5px;line-height:1.65;color:#9fb6cc;max-height:260px;overflow:auto"></div>
  </div>

  <pre id="log" style="display:none"></pre>
</div>
<script>
const $=(id)=>document.getElementById(id);
async function refresh(){
  try{
    const j=await (await fetch('/api/status')).json();
    $('led-edge').className='led'+(j.edge?' on':'');
    $('led-gpt').className='led'+(j.gpt?' on':'');
    $('led-browser').className='led'+(j.browser?' on':'');
  }catch(e){}
}
$('btn').onclick=async()=>{
  $('btn').disabled=true; $('btn').textContent='启动中…';
  const logEl=$('log'); logEl.style.display='block'; logEl.textContent='检查中…';
  try{
    const j=await (await fetch('/api/start',{method:'POST'})).json();
    logEl.textContent=j.log.join('\n');
    await refresh();
  }catch(e){ logEl.textContent='失败: '+e.message; }
  $('btn').disabled=false; $('btn').textContent='▶ 启动 / 检查';
};
refresh(); setInterval(refresh,5000);

// 经验库
let digestCache = '';
async function loadLessons(){
  try{
    const j = await (await fetch('/api/lessons')).json();
    digestCache = j.digest || '';
    $('lessonCount').textContent = '共 ' + (j.count||0) + ' 条';
    $('lessonList').innerHTML = (j.top||[]).map(t =>
      '<div style="padding:6px 0;border-bottom:1px solid #152639">'
      + '<span style="color:#5f7f99;font-family:monospace">' + t.id + '</span> '
      + '<span style="color:#7f9ab5">[' + t.tag + ']</span> '
      + '<span style="color:#cfe6ff">' + t.title + '</span>'
      + (t.fix ? '<div style="color:#8aa6bd;font-size:11.5px;margin-top:2px;padding-left:44px">' + t.fix + '</div>' : '')
      + '</div>'
    ).join('');
  }catch(e){ $('lessonList').textContent = '读取失败: ' + e.message; }
}
$('copyLessons').onclick = async () => {
  try{
    await navigator.clipboard.writeText(digestCache);
    $('copyLessons').textContent = '已复制 ✓ 去对话框粘贴';
    setTimeout(()=>{ $('copyLessons').textContent='复制摘要给 agent'; }, 2500);
  }catch(e){ $('copyLessons').textContent = '复制失败'; }
};
loadLessons();
</script></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (url.pathname === '/api/status') return json(200, await status());
  if (url.pathname === '/api/lessons') {
    try {
      return json(200, lessons());
    } catch (e) {
      return json(500, { error: String(e?.message ?? e) });
    }
  }
  if (url.pathname === '/api/start' && req.method === 'POST') {
    try {
      return json(200, await startAll());
    } catch (e) {
      return json(200, { log: ['失败: ' + (e.message || e)], status: await status() });
    }
  }
  json(404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log('launcher: http://127.0.0.1:' + PORT));
