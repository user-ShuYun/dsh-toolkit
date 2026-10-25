/**
 * cine.mjs —— 把一组 PNG 页面合成"电影级"短片：缓慢推近 + 交叉溶解
 *   node tools/cine.mjs <framesDir> <outMp4> [每页秒数] [转场秒数]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out, per = '4', xf = '0.8'] = process.argv.slice(2);
const ff = process.env.FFMPEG || 'ffmpeg'; // 装到 PATH 或设 FFMPEG 环境变量
if (!existsSync(ff)) throw new Error('找不到 ffmpeg: ' + ff);

const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
if (!files.length) throw new Error('目录里没有 PNG');

const perSec = Number(per);
const fade = Number(xf);
const fps = 25;
const frames = Math.round(perSec * fps);

const args = ['-y'];
for (const f of files) args.push('-loop', '1', '-t', String(perSec), '-i', join(dir, f));

const parts = [];
files.forEach((_, i) => {
  // 缓慢推近：z 从 1.0 到 1.06
  parts.push(
    `[${i}:v]scale=2400:-1,zoompan=z='min(zoom+0.0006,1.06)':d=${frames}:s=1920x1080:fps=${fps},` +
      `trim=duration=${perSec},setpts=PTS-STARTPTS,fps=${fps},setsar=1[v${i}]`
  );
});

let last = 'v0';
let offset = perSec - fade;
for (let i = 1; i < files.length; i++) {
  const tag = `x${i}`;
  parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(2)}[${tag}]`);
  last = tag;
  offset += perSec - fade;
}

args.push('-filter_complex', parts.join(';'), '-map', `[${last}]`);
args.push('-r', String(fps), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', out);

console.log('合成', files.length, '页 →', out);
execFileSync(ff, args, { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('完成');
