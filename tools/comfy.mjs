/**
 * comfy.mjs —— ComfyUI 的 HTTP 客户端 + 命令行。
 *
 * 这就是「让 Agent 出视频」的那一层：
 *   DSH/我 只负责写提示词、拼工作流参数、提交任务、等结果、下载，
 *   真正的像素是 ComfyUI（本地或 RunningHub）算出来的。
 *
 * 用法:
 *   node tools/comfy.mjs status                          # 看 ComfyUI 在不在、显卡是什么
 *   node tools/comfy.mjs queue                           # 看排队
 *   node tools/comfy.mjs run --workflow w.json --out a.mp4
 *        [--set 6.text="一个女孩在雨里"] [--set 3.seed=123] [--random-seed 3.seed]
 *        [--timeout 900] [--dry-run]
 *
 * 工作流必须是 ComfyUI 的 **API 格式**（"保存 (API格式)" / Save (API Format)），
 * 不是界面格式（那个带 nodes/links 数组的跑不了）。
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';

function flag(name, def = undefined) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
function flags(name) {
  const out = [];
  argv.forEach((a, i) => { if (a === '--' + name) out.push(argv[i + 1]); });
  return out;
}

async function jget(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
  return r.json();
}
async function jpost(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 命令 ----------

async function status() {
  try {
    const s = await jget('/system_stats');
    const dev = s.devices?.[0] || {};
    console.log('ComfyUI 在跑 ✅');
    console.log('  地址:', BASE);
    console.log('  版本:', s.system?.comfyui_version || '?', '· python', s.system?.python_version?.split(' ')[0] || '?');
    console.log('  显卡:', dev.name || '?', '· VRAM', Math.round((dev.vram_total || 0) / 1024 / 1024 / 1024) + ' GB');
    console.log('  空闲显存:', Math.round((dev.vram_free || 0) / 1024 / 1024 / 1024) + ' GB');
  } catch (e) {
    console.log('连不上 ComfyUI ❌  ' + e.message);
    console.log('  先启动: D:\\ComfyUI\\run_nvidia_gpu.bat   （或 python main.py --listen 127.0.0.1 --port 8188）');
    console.log('  端口不对就设环境变量: $env:COMFY_URL="http://127.0.0.1:8188"');
    process.exitCode = 1;
  }
}

async function queue() {
  const q = await jget('/queue');
  console.log('运行中:', q.queue_running?.length ?? 0, '· 排队:', q.queue_pending?.length ?? 0);
  for (const it of q.queue_running || []) console.log('  ▶', it[1], '#' + it[0]);
}

/** 把 --set 6.text=xxx 应用到工作流 */
function applySets(wf, sets, randomSeeds) {
  for (const kv of sets) {
    const eq = kv.indexOf('=');
    if (eq < 0) throw new Error('--set 需要 node字段=值 形式: ' + kv);
    const [key, rawVal] = [kv.slice(0, eq), kv.slice(eq + 1)];
    const dot = key.indexOf('.');
    const nodeId = key.slice(0, dot);
    const field = key.slice(dot + 1);
    if (!wf[nodeId]) throw new Error('工作流里没有节点 ' + nodeId);
    wf[nodeId].inputs = wf[nodeId].inputs || {};
    wf[nodeId].inputs[field] = coerce(rawVal);
  }
  for (const key of randomSeeds) {
    const dot = key.indexOf('.');
    const nodeId = key.slice(0, dot);
    const field = key.slice(dot + 1);
    if (!wf[nodeId]) throw new Error('工作流里没有节点 ' + nodeId);
    wf[nodeId].inputs = wf[nodeId].inputs || {};
    wf[nodeId].inputs[field] = Math.floor(Math.random() * 1e15);
  }
  return wf;
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v);
  return v;
}

/** 从 history 结果里挑出产物文件 */
function pickOutputs(entry) {
  const files = [];
  for (const [nodeId, out] of Object.entries(entry.outputs || {})) {
    for (const [kind, list] of Object.entries(out)) {
      if (!Array.isArray(list)) continue;
      for (const f of list) {
        if (f && f.filename) files.push({ nodeId, kind, ...f });
      }
    }
  }
  const rank = (f) => {
    const ext = path.extname(f.filename).toLowerCase();
    if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) return 0;
    if (['.webp', '.gif', '.webp'].includes(ext)) return 1;
    if (['.png', '.jpg', '.jpeg'].includes(ext)) return 2;
    return 3;
  };
  return files.sort((a, b) => rank(a) - rank(b));
}

async function download(file, outPath) {
  const qs = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
  const r = await fetch(`${BASE}/view?${qs}`);
  if (!r.ok) throw new Error('下载失败 HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

async function run() {
  const wfPath = flag('workflow');
  if (!wfPath) throw new Error('需要 --workflow xxx.json（ComfyUI 导出的 API 格式）');
  const outPath = flag('out', 'D:\\deepseek\\out\\comfy-result.mp4');
  const timeoutSec = Number(flag('timeout', 1800));
  const dry = flag('dry-run', false);

  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  applySets(wf, flags('set'), flags('random-seed'));

  if (dry) {
    console.log('Dry run ✅ 工作流解析成功，' + Object.keys(wf).length + ' 个节点');
    for (const [id, n] of Object.entries(wf)) {
      const inputs = Object.entries(n.inputs || {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number').slice(0, 3);
      console.log(`  [${id}] ${n.class_type}  ${inputs.map(([k, v]) => k + '=' + String(v).slice(0, 24)).join(' ')}`);
    }
    return;
  }

  const clientId = 'dsh-' + Math.random().toString(36).slice(2, 10);
  const t0 = Date.now();
  const submitted = await jpost('/prompt', { prompt: wf, client_id: clientId });
  const pid = submitted.prompt_id;
  if (!pid) throw new Error('提交失败: ' + JSON.stringify(submitted).slice(0, 300));
  console.log('已提交 prompt_id=' + pid + '，开始等…');

  let entry = null;
  while (Date.now() - t0 < timeoutSec * 1000) {
    await sleep(3000);
    const h = await jget('/history/' + pid);
    const e = h[pid];
    if (!e) {
      const q = await jget('/queue');
      const pos = (q.queue_pending || []).findIndex((it) => it[1] === pid);
      process.stdout.write(`\r  等待中 ${Math.round((Date.now() - t0) / 1000)}s${pos >= 0 ? ' 队列第 ' + (pos + 1) : ''}   `);
      continue;
    }
    if (e.status?.status_str === 'error') {
      const msg = JSON.stringify(e.status?.messages || {}).slice(0, 500);
      throw new Error('工作流报错: ' + msg);
    }
    if (e.status?.completed) { entry = e; break; }
  }
  process.stdout.write('\n');
  if (!entry) throw new Error('超时 ' + timeoutSec + 's');

  const files = pickOutputs(entry);
  if (!files.length) throw new Error('工作流跑完但没有产物（检查 SaveVideo/SaveImage 节点是否启用）');
  const best = files[0];
  const bytes = await download(best, outPath);
  console.log(`完成 ✅ ${Math.round((Date.now() - t0) / 1000)}s · ${best.filename} → ${outPath} (${Math.round(bytes / 1024)} KB)`);
  if (files.length > 1) console.log('  其它产物:', files.slice(1).map((f) => f.filename).join(', '));
  try {
    const { journalAdd } = await import('file:///D:/deepseek/tools/journal.mjs');
    journalAdd({ kind: 'comfy', ok: true, detail: `${best.filename} → ${path.basename(String(outPath))}`, cmd: 'run ' + path.basename(String(flag('workflow', ''))) });
  } catch {}
}

// ---------- 入口 ----------
const HELP = `ComfyUI 客户端（Agent 出片的那一层）

  node tools/comfy.mjs status
  node tools/comfy.mjs queue
  node tools/comfy.mjs run --workflow <api.json> --out <文件>
        [--set 6.text="提示词"] [--set 3.width=768]
        [--random-seed 3.seed] [--timeout 1800] [--dry-run]

环境变量: COMFY_URL（默认 http://127.0.0.1:8188）`;

try {
  if (cmd === 'status') await status();
  else if (cmd === 'queue') await queue();
  else if (cmd === 'run') await run();
  else console.log(HELP);
} catch (e) {
  console.error('❌ ' + (e.message || e));
  let draftId = null;
  try {
    const { draftLesson } = await import('file:///D:/deepseek/tools/lesson-draft.mjs');
    draftId = draftLesson({
      tool: 'comfy',
      cmd: argv.join(' '),
      error: String(e.message || e),
      context: { workflow: flag('workflow', ''), out: flag('out', '') }
    });
    if (draftId) console.error(`📝 已记为经验草稿 ${draftId}（LESSONS.draft.md，确认后升格）`);
  } catch {}
  try {
    const { journalAdd } = await import('file:///D:/deepseek/tools/journal.mjs');
    journalAdd({
      kind: 'comfy',
      ok: false,
      detail: String(e.message || e).slice(0, 120),
      cmd: argv.join(' ').slice(0, 150),
      extra: draftId ? `草稿 ${draftId}` : ''
    });
  } catch {}
  process.exitCode = 1;
}
