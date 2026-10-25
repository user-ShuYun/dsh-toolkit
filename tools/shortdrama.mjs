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

// 失败时自动落一条经验草稿（不改变原有行为，只是多记一笔）
process.on('unhandledRejection', async (e) => {
  console.error('❌ ' + (e && e.message || e));
  try {
    const { draftLesson } = await import('file:///D:/deepseek/tools/lesson-draft.mjs');
    const id = draftLesson({
      tool: 'shortdrama',
      cmd: process.argv.slice(2).join(' '),
      error: String(e && e.message || e)
    });
    if (id) console.error(`📝 已记为经验草稿 ${id}（LESSONS.draft.md）`);
  } catch {}
  process.exit(1);
});

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
const ENGINE = String(flag('engine', 'ltx'));            // ltx | wan
const W = Number(flag('width', ENGINE === 'wan' ? 832 : 640));
const H = Number(flag('height', ENGINE === 'wan' ? 480 : 384));
const FPS = Number(flag('fps', ENGINE === 'wan' ? 24 : 24));
const grade = String(flag('grade', 'film'));
const out = String(flag('out', 'D:\\deepseek\\out\\film.mp4'));
const workDir = String(flag('workdir', path.join(path.dirname(out), 'shots')));
const CKPT = String(flag('ckpt', 'ltxv-2b-0.9.8-distilled-fp8.safetensors'));
const CLIP = String(flag('clip', 't5xxl_fp8_e4m3fn.safetensors'));
const STEPS = String(flag('steps', ENGINE === 'wan' ? '20' : '8'));
const CFG = String(flag('cfg', ENGINE === 'wan' ? '5' : '1'));
const NEG = String(flag('negative', ENGINE === 'wan'
  ? 'Low contrast, overexposed, static, blurry details, subtitles, watermark, text, still frame, gray, worst quality, deformed limbs'
  : 'low quality, worst quality, blurry, watermark, text, deformed, extra limbs, static frozen frame'));

const WF = ENGINE === 'wan'
  ? { t2v: 'D:\\deepseek\\out\\workflows\\wan5b-ti2v-gguf.json', i2v: 'D:\\deepseek\\out\\workflows\\wan5b-i2v-gguf.json' }
  : { t2v: 'D:\\deepseek\\out\\workflows\\ltx-t2v-api.json', i2v: 'D:\\deepseek\\out\\workflows\\ltx-i2v-api.json' };
const LAT = ENGINE === 'wan' ? '55' : '77';
const SMP = ENGINE === 'wan' ? '3' : '72';

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

// ---- 切镜拆解（coverage）：把「转头 / 转身 / 走开」拆成两镜，而不是让模型在画面里转 ----
// plan 里写 { "seconds": 1.5, "prompt": "她站着，正面", "cutTo": "她已经转向左侧，侧脸" }
// 或者写 { "seconds": 1.5, "prompt": "...", "turn": "left" } 由脚本自动补后半句
const TURN_WORDS = /\b(turn(s|ing)? (her|his|the) head|turn(s|ing)? around|spins?|rotates?|walks? away|turns? away)\b/i;
const expanded = [];
for (const s of shots) {
  if (s.cutTo) {
    expanded.push({ seconds: s.seconds, prompt: s.prompt });
    expanded.push({ seconds: s.seconds, prompt: s.cutTo, afterCut: true });
  } else if (s.turn) {
    const dir = String(s.turn) === 'left' ? 'left' : String(s.turn) === 'right' ? 'right' : 'away';
    expanded.push({ seconds: s.seconds, prompt: s.prompt });
    expanded.push({
      seconds: s.seconds,
      afterCut: true,
      prompt: `${s.prompt.replace(TURN_WORDS, '')}, she has already turned ${dir} and is now seen from the ${dir === 'away' ? 'back' : dir + ' side'}, the camera does not rotate, steady shot`
    });
  } else {
    if (TURN_WORDS.test(String(s.prompt))) {
      console.warn(`⚠️ 第 ${expanded.length + 1} 镜的提示词里有「转头/转身」——模型大概率会崩脸。建议改成两镜（prompt + cutTo），见 TOOLS.md。`);
    }
    expanded.push({ seconds: s.seconds, prompt: s.prompt });
  }
}
const shotsToRun = expanded;
if (shotsToRun.length !== shots.length) console.log(`切镜拆解：${shots.length} 镜 → ${shotsToRun.length} 镜（转头改切镜）`);

console.log(`《${plan.title || '未命名'}》 ${shotsToRun.length} 镜 · ${W}x${H} · ${frames} 帧/镜 · grade=${grade}`);
const clips = [];
const t0 = Date.now();

for (let i = 0; i < shotsToRun.length; i++) {
  const shot = shotsToRun[i];
  const outClip = path.join(workDir, `shot${i + 1}.mp4`);
  const framesN = Math.max(25, Math.round((Number(shot.seconds) || 3) * FPS / 4) * 4 + 1);

  const common = [
    'D:\\deepseek\\tools\\comfy.mjs', 'run',
    '--out', outClip,
    '--set', `${SMP}.steps=${STEPS}`,
    '--set', `${SMP}.cfg=${CFG}`,
    '--timeout', '3000'
  ];
  const modelSets = ENGINE === 'wan'
    ? []
    : ['--set', `44.ckpt_name=${CKPT}`, '--set', `38.clip_name=${CLIP}`];

  if (i === 0 && !anchorName) {
    console.log(`\n[镜 ${i + 1}/${shotsToRun.length}] T2V 起头（${ENGINE}）`);
    runNode([...common,
      '--workflow', WF.t2v,
      ...modelSets,
      '--set', `${LAT}.width=${W}`, '--set', `${LAT}.height=${H}`, '--set', `${LAT}.length=${framesN}`,
      '--random-seed', `${SMP}.seed`,
      '--set', `6.text=${shot.prompt}`,
      '--set', `7.text=${NEG}`
    ].map((s) => String(s)), 'shot' + (i + 1));
  } else {
    const prev = clips[i - 1];
    const seedImg = path.join(COMFY_INPUT, `sd_seed_${i + 1}.png`);
    if (anchorName) {
      console.log(`\n[镜 ${i + 1}/${shotsToRun.length}] I2V · 角色锚点（${ENGINE}）`);
      ffmpeg(['-y', '-i', String(anchorSrc), '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-update', '1', seedImg]);
    } else {
      console.log(`\n[镜 ${i + 1}/${shotsToRun.length}] I2V 接戏（首帧 = 镜 ${i} 末帧，${ENGINE}）`);
      ffmpeg(['-y', '-sseof', '-0.2', '-i', prev, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-update', '1', seedImg]);
    }
    const condImage = path.basename(seedImg);
    runNode([...common,
      '--workflow', WF.i2v,
      ...modelSets,
      '--set', `${LAT}.width=${W}`, '--set', `${LAT}.height=${H}`, '--set', `${LAT}.length=${framesN}`,
      ENGINE === 'wan' ? '--set' : '--set', `${ENGINE === 'wan' ? '90' : '78'}.image=${condImage}`,
      '--random-seed', `${SMP}.seed`,
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

