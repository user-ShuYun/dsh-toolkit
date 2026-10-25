/**
 * shortdrama.mjs —— 一句话（分镜表）→ 出片。
 *
 * 把 WorkFisher 那套流程落成一条命令：
 *   镜1 用 T2V 起头
 *   镜2..n 用「上一镜最后一帧」做首帧（I2V）接戏
 *   全部跑完 → stitch.mjs 统一规格 + 胶片感调色 → 成片
 *
 * 用法:
 *   node tools/shortdrama.mjs --plan plan.json --out out/film.mp4 [--grade film] [--width 640 --height 384]
 *
 * plan.json:
 * {
 *   "title": "雨夜天台",
 *   "shots": [
 *     { "prompt": "...", "seconds": 3 },
 *     { "prompt": "...", "seconds": 3 }
 *   ]
 * }
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

const planPath = String(flag('plan', ''));
if (!planPath || !fs.existsSync(planPath)) {
  console.error('用法: node tools/shortdrama.mjs --plan plan.json --out out/film.mp4 [--grade film]');
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const W = Number(flag('width', 640));
const H = Number(flag('height', 384));
const FPS = Number(flag('fps', 24));
const grade = String(flag('grade', 'film'));
const out = String(flag('out', 'D:\\deepseek\\out\\film.mp4'));
const workDir = String(flag('workdir', path.join(path.dirname(out), 'shots')));
const CKPT = String(flag('ckpt', 'ltxv-2b-0.9.8-distilled-fp8.safetensors'));
const CLIP = String(flag('clip', 't5xxl_fp8_e4m3fn.safetensors'));
const STEPS = String(flag('steps', '8'));
const CFG = String(flag('cfg', '1'));
const NEG = String(flag('negative', 'low quality, worst quality, blurry, watermark, text, deformed, extra limbs, static frozen frame'));

fs.mkdirSync(workDir, { recursive: true });
const NODE = process.execPath;
const FF = process.env.FFMPEG || 'D:\\tools\\ffmpeg\\bin\\ffmpeg.exe';
const COMFY_INPUT = 'D:\\ComfyUI\\input';

function runNode(args, label) {
  const r = spawnSync(NODE, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(label + ' failed');
}
function ffmpeg(args) {
  const r = spawnSync(FF, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + (r.stderr || '').split('\n').slice(-5).join(' | '));
}

const shots = plan.shots || [];
if (!shots.length) { console.error('plan 里没有 shots'); process.exit(1); }

// 可选：角色锚点图。给了它，每一镜都用这张图做 I2V 条件（保人物一致性，牺牲一点运动连贯）
const anchorSrc = flag('anchor', '');
let anchorName = '';
if (anchorSrc) {
  if (!fs.existsSync(String(anchorSrc))) { console.error('anchor 图不存在: ' + anchorSrc); process.exit(1); }
  anchorName = 'sd_anchor' + path.extname(String(anchorSrc));
  fs.copyFileSync(String(anchorSrc), path.join(COMFY_INPUT, anchorName));
  console.log('角色锚点: ' + anchorSrc + ' → ' + anchorName);
}
const frames = Math.max(25, Math.round((Number(shots[0].seconds) || 3) * FPS / 4) * 4 + 1);

console.log(`《${plan.title || '未命名'}》 ${shots.length} 镜 · ${W}x${H} · ${frames} 帧/镜 · grade=${grade}`);
const clips = [];
const t0 = Date.now();

for (let i = 0; i < shots.length; i++) {
  const shot = shots[i];
  const outClip = path.join(workDir, `shot${i + 1}.mp4`);
  const framesN = Math.max(25, Math.round((Number(shot.seconds) || 3) * FPS / 4) * 4 + 1);

  const common = [
    'D:\\deepseek\\tools\\comfy.mjs', 'run',
    '--out', outClip,
    '--set', `71.steps=${STEPS}`,
    '--set', `72.cfg=${CFG}`,
    '--timeout', '1800'
  ];

  if (i === 0 && !anchorName) {
    console.log(`\n[镜 ${i + 1}/${shots.length}] T2V 起头`);
    runNode([...common,
      '--workflow', 'D:\\deepseek\\out\\workflows\\ltx-t2v-api.json',
      '--set', `44.ckpt_name=${CKPT}`,
      '--set', `38.clip_name=${CLIP}`,
      '--set', `70.width=${W}`, '--set', `70.height=${H}`, '--set', `70.length=${framesN}`,
      '--random-seed', '72.noise_seed',
      '--set', `6.text=${shot.prompt}`,
      '--set', `7.text=${NEG}`
    ].map((s) => String(s)), 'shot' + (i + 1));
  } else {
    const prev = clips[i - 1];
    const seedImg = path.join(COMFY_INPUT, `sd_seed_${i + 1}.png`);
    if (anchorName) {
      console.log(`\n[镜 ${i + 1}/${shots.length}] I2V · 角色锚点（不接尾帧，保人物一致）`);
    } else {
      console.log(`\n[镜 ${i + 1}/${shots.length}] I2V 接戏（首帧 = 镜 ${i} 末帧）`);
      ffmpeg(['-y', '-sseof', '-0.2', '-i', prev, '-update', '1', seedImg]);
    }
    const condImage = anchorName || path.basename(seedImg);
    runNode([...common,
      '--workflow', 'D:\\deepseek\\out\\workflows\\ltx-i2v-api.json',
      '--set', `44.ckpt_name=${CKPT}`,
      '--set', `38.clip_name=${CLIP}`,
      '--set', `77.width=${W}`, '--set', `77.height=${H}`, '--set', `77.length=${framesN}`,
      '--set', `78.image=${condImage}`,
      '--random-seed', '72.noise_seed',
      '--set', `6.text=${shot.prompt}`,
      '--set', `7.text=${NEG}`
    ].map((s) => String(s)), 'shot' + (i + 1));
  }
  clips.push(outClip);
}

console.log('\n拼接 + 调色…');
runNode(['D:\\deepseek\\tools\\stitch.mjs', '--in', clips.join(','), '--out', out, '--grade', grade, '--fps', String(FPS)], 'stitch');
runNode(['D:\\deepseek\\tools\\stitch.mjs', '--sheet', out, '--cols', '4', '--rows', '2'], 'sheet');

console.log(`\n完成 ✅ ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out}`);
