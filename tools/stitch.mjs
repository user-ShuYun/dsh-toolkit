/**
 * stitch.mjs —— 把多条镜头拼成一条片子，并做「去廉价感」的后期。
 *
 * 为什么需要它：WorkFisher 的说法是——资产/成片如果「没阴影、很平、没滤镜」，
 * 出来就是廉价感。视频模型本身不会给你胶片感，得在拼接这一层补：
 *   颗粒 + 暗角 + 轻微对比/饱和 + 统一帧率
 *
 * 用法:
 *   node tools/stitch.mjs --in "a.mp4,b.mp4,c.mp4" --out final.mp4 [--grade film] [--fps 24]
 *   node tools/stitch.mjs --in "a.mp4,b.mp4" --out final.mp4 --no-grade
 *   node tools/stitch.mjs --sheet final.mp4 --cols 4        # 抽帧检查表
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FF = process.env.FFMPEG || 'D:\\tools\\ffmpeg\\bin\\ffmpeg.exe';
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

if (!fs.existsSync(FF)) {
  console.error('找不到 ffmpeg: ' + FF + '\n用 $env:FFMPEG 指定路径');
  process.exit(1);
}

const GRADES = {
  none: null,
  // 轻胶片：颗粒 + 暗角 + 一点对比和饱和
  film: 'eq=contrast=1.06:saturation=1.08:brightness=-0.012,vignette=PI/4.6,noise=alls=7:allf=t+u,format=yuv420p',
  // 冷调电影：偏青蓝，压高光
  cinema: 'eq=contrast=1.10:saturation=0.98:brightness=-0.02:gamma=0.98,vignette=PI/4.2,noise=alls=5:allf=t+u,colorbalance=bs=0.06:ms=0.03:hs=-0.02,format=yuv420p',
  // 只统一编码，不调色
  plain: 'format=yuv420p'
};

function run(args, label) {
  const r = spawnSync(FF, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`[${label}] ffmpeg 失败:\n` + (r.stderr || '').split('\n').slice(-12).join('\n'));
    process.exit(1);
  }
  return r;
}

// ---- 抽帧检查表 ----
const sheet = flag('sheet');
if (sheet) {
  const cols = Number(flag('cols', 4));
  const rows = Number(flag('rows', 2));
  const out = flag('out', path.join(path.dirname(String(sheet)), 'contact-sheet.png'));
  const n = cols * rows;
  console.log(`抽 ${n} 帧 → ${out}`);
  run(['-y', '-i', String(sheet), '-vf', `fps=1,scale=320:-1,tile=${cols}x${rows}`, '-frames:v', '1', String(out)], 'sheet');
  console.log('完成 ' + out);
  process.exit(0);
}

// ---- 拼接 ----
const list = String(flag('in', '')).split(',').map((s) => s.trim()).filter(Boolean);
if (!list.length) {
  console.log('用法: node tools/stitch.mjs --in "a.mp4,b.mp4" --out final.mp4 [--grade film|cinema|plain|none] [--fps 24]');
  process.exit(1);
}
for (const f of list) if (!fs.existsSync(f)) { console.error('缺少文件: ' + f); process.exit(1); }

const gradeName = String(flag('grade', 'film'));
const grade = GRADES[gradeName];
if (grade === undefined) { console.error('未知 grade: ' + gradeName + '，可选: ' + Object.keys(GRADES).join(', ')); process.exit(1); }
const fps = String(flag('fps', '24'));
const out = String(flag('out', 'D:\\deepseek\\out\\final.mp4'));
const fadeIn = flag('fade-in', 0);
const fadeOut = flag('fade-out', 0);

// 逐条统一规格（分辨率取第一条、帧率统一），再 concat
const inputs = list.flatMap((f) => ['-i', f]);
const filters = list.map((_, i) => `[${i}:v]fps=${fps},scale=640:384:force_original_aspect_ratio=decrease,pad=640:384:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`);
let chain = filters.join(';') + ';' + list.map((_, i) => `[v${i}]`).join('') + `concat=n=${list.length}:v=1:a=0[cat]`;
let tail = '[cat]';
if (grade) chain += `;${tail}${grade}[g]`, tail = '[g]';
if (fadeIn > 0 || fadeOut > 0) {
  const dur = Number(flag('duration', 0)); // 不传就用末尾时间
  const parts = [];
  if (fadeIn > 0) parts.push(`fade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0) parts.push(`fade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}`);
  chain += `;${tail}${parts.join(',')}[f]`;
  tail = '[f]';
}

const args = ['-y', ...inputs, '-filter_complex', chain, '-map', tail,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];

console.log(`拼接 ${list.length} 条 → ${out}（grade=${gradeName}, fps=${fps}）`);
const t0 = Date.now();
run(args, 'concat');
const size = fs.statSync(out).size;
console.log(`完成 ✅ ${((Date.now() - t0) / 1000).toFixed(1)}s · ${Math.round(size / 1024)} KB · ${out}`);
