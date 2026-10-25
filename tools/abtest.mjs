/**
 * abtest.mjs —— A/B 对比两套视频模型配置，用同一组分镜，自动拼出对比图。
 *
 * 目的：回答「非蒸馏模型 + 多步数，能不能救回人物一致性」。
 * 做法：同一份 plan 跑两遍（不同 ckpt / steps / cfg），各自拼接，
 *       再从两条成片各抽 8 帧，上下叠成一张对比图。
 *
 * 用法:
 *   node tools/abtest.mjs --plan out/plan-rainy-short.json --out out/ab
 *   node tools/abtest.mjs --plan ... --a "ckpt=ltxv-2b-0.9.8-distilled-fp8.safetensors,steps=8,cfg=1" \
 *                         --b "ckpt=ltxv-2b-0.9.6-dev.safetensors,steps=28,cfg=4"
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const plan = String(flag('plan', 'D:\\deepseek\\out\\plan-rainy-short.json'));
const outDir = String(flag('out', 'D:\\deepseek\\out\\ab'));
const FF = process.env.FFMPEG || 'D:\\tools\\ffmpeg\\bin\\ffmpeg.exe';
const NODE = process.execPath;

function parseCfg(str, fallback) {
  const o = { ...fallback };
  for (const kv of String(str).split(',')) {
    const [k, v] = kv.split('=');
    if (k && v) o[k.trim()] = v.trim();
  }
  return o;
}

const A = parseCfg(flag('a', ''), { ckpt: 'ltxv-2b-0.9.8-distilled-fp8.safetensors', steps: 8, cfg: 1, name: 'A-distilled' });
const B = parseCfg(flag('b', ''), { ckpt: 'ltxv-2b-0.9.6-dev.safetensors', steps: 28, cfg: 4, name: 'B-dev' });
if (!A.name) A.name = 'A';
if (!B.name) B.name = 'B';

fs.mkdirSync(outDir, { recursive: true });
console.log('A =', JSON.stringify(A));
console.log('B =', JSON.stringify(B));

function run(label, cfg) {
  const out = path.join(outDir, `${cfg.name}.mp4`);
  console.log(`\n=== 跑 ${cfg.name}（${cfg.ckpt} steps=${cfg.steps} cfg=${cfg.cfg}）===`);
  const extra = [];
  const neg = flag('negative', '');
  if (neg) extra.push('--negative', String(neg));
  const r = spawnSync(NODE, [
    'D:\\deepseek\\tools\\shortdrama.mjs',
    '--plan', plan,
    '--out', out,
    '--ckpt', cfg.ckpt,
    '--steps', String(cfg.steps),
    '--cfg', String(cfg.cfg),
    '--workdir', path.join(outDir, 'shots_' + cfg.name),
    ...extra
  ], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(cfg.name + ' 失败');
  return out;
}

const aFile = run('A', A);
const bFile = run('B', B);

// 各抽 4 帧，上下拼
function grab(file, tag) {
  const out = path.join(outDir, `sheet_${tag}.png`);
  const r = spawnSync(FF, ['-y', '-i', file, '-vf', 'fps=1/1.5,scale=480:-1,tile=4x1', '-frames:v', '1', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('抽帧失败 ' + tag);
  return out;
}
const sa = grab(aFile, 'A');
const sb = grab(bFile, 'B');
const cmp = path.join(outDir, 'compare.png');
const r2 = spawnSync(FF, ['-y', '-i', sa, '-i', sb, '-filter_complex', '[0:v][1:v]vstack=inputs=2', '-update', '1', cmp], { encoding: 'utf8' });
if (r2.status !== 0) throw new Error('对比图失败');

console.log(`\n完成 ✅\n  A: ${aFile}\n  B: ${bFile}\n  对比图: ${cmp}`);
