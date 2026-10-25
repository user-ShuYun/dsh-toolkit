/**
 * gen-bgs.mjs —— 按「题材 preset」批量生成 PPT 背景纹理
 *
 *   node tools/gen-bgs.mjs --list
 *   node tools/gen-bgs.mjs --preset tech --out D:\deepseek\art\raw --pages cover,structure,numbers
 *   node tools/gen-bgs.mjs --preset humanities --out D:\deepseek\art\bg --prefix hum
 *
 * 生成完记得三处登记（否则导出被门禁拒）：
 *   ① 放进 <project>\images\  ② design_spec §VIII 加行  ③ spec_lock ## images 加行
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRESETS = 'D:/deepseek/art/backgrounds/presets.json';
const presets = JSON.parse(readFileSync(PRESETS, 'utf8'));

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (n) => argv.includes('--' + n);

if (has('list') || argv.length === 0) {
  console.log('可用题材 preset：\n');
  for (const [id, p] of Object.entries(presets)) {
    if (id.startsWith('$')) continue;
    console.log(`  ${id.padEnd(12)} ${p.label}`);
    console.log(`               ${p.base}`);
    console.log(`               页型: ${Object.keys(p.motifs).join(', ')}\n`);
  }
  console.log('用法: node tools/gen-bgs.mjs --preset tech --out <dir> [--pages cover,structure,...] [--prefix tech]');
  process.exit(0);
}

const presetId = arg('preset', 'tech');
const preset = presets[presetId];
if (!preset) throw new Error(`没有 preset: ${presetId}（用 --list 看）`);

const outDir = arg('out', 'D:/deepseek/art/raw');
const prefix = arg('prefix', presetId);
const pages = arg('pages', Object.keys(preset.motifs).join(',')).split(',').map((s) => s.trim());

mkdirSync(outDir, { recursive: true });

// 起一个 ChatGPT 页
const A = 'http://127.0.0.1:3100/api/';
await fetch(A + 'newtab', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://chatgpt.com/' })
}).catch(() => {});
await new Promise((r) => setTimeout(r, 12000));

const mod = await import(pathToFileURL('D:/deepseek/dsh-gpt-driver/src/index.js').href);
const tools = new Map();
mod.apply({ tools: { register: (t) => tools.set(t.name, t) } }, { port: 9222 });

const COMMON =
  '这是一张横向宽幅 16:9 的 PPT 背景图。画面里绝对不能出现任何文字、数字、字母、logo、水印、人物或具体物体。';

for (const page of pages) {
  const motif = preset.motifs[page];
  if (!motif) {
    console.log('跳过未知页型:', page);
    continue;
  }
  const prompt = `${COMMON} 基调：${preset.base}。氛围：${preset.mood}。纹样：${motif}。`;
  const out = join(outDir, `${prefix}-${page}.png`);
  try {
    await tools.get('gpt_send').execute({ text: prompt });
    const res = await tools.get('gpt_wait_image').execute({ outPath: out, timeoutSec: 300 });
    console.log('✓', page, '→', out, Math.round(res.bytes / 1024) + 'KB');
  } catch (e) {
    console.log('✗', page, e.message.slice(0, 140));
  }
}
