/**
 * 海报裁剪：自动去掉四周白边 -> 按目标尺寸输出。
 *
 *   node poster-crop.mjs <in> <outDir> [--pad N]
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const require = createRequire('D:/deepseek/swust/package.json');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const [input, outDir = 'D:/deepseek/out'] = process.argv.slice(2);
const padIdx = process.argv.indexOf('--pad');
const pad = padIdx > 0 ? Number(process.argv[padIdx + 1]) : 0;

const img = await loadImage(input);
const W = img.width;
const H = img.height;
const src = createCanvas(W, H);
const sg = src.getContext('2d');
sg.drawImage(img, 0, 0);
const data = sg.getImageData(0, 0, W, H).data;

const INK = 18;
const isInk = (x, y) => {
  const i = (y * W + x) * 4;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return 255 - Math.min(r, g, b) > INK || Math.max(r, g, b) - Math.min(r, g, b) > INK;
};

const rowInk = new Array(H).fill(0);
const colInk = new Array(W).fill(0);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (isInk(x, y)) {
      rowInk[y]++;
      colInk[x]++;
    }
  }
}

const minRowInk = Math.max(2, Math.floor(W * 0.01));
const minColInk = Math.max(2, Math.floor(H * 0.01));
let top = 0;
while (top < H && rowInk[top] < minRowInk) top++;
let bottom = H - 1;
while (bottom > top && rowInk[bottom] < minRowInk) bottom--;
let left = 0;
while (left < W && colInk[left] < minColInk) left++;
let right = W - 1;
while (right > left && colInk[right] < minColInk) right--;

top = Math.max(0, top - pad);
left = Math.max(0, left - pad);
bottom = Math.min(H - 1, bottom + pad);
right = Math.min(W - 1, right + pad);

const cw = right - left + 1;
const ch = bottom - top + 1;
console.log(`原图 ${W}x${H} -> 内容 ${cw}x${ch} @(${left},${top})  ratio ${(cw / ch).toFixed(4)}`);

mkdirSync(outDir, { recursive: true });
const base = basename(input).replace(/\.[^.]+$/, '');

function exportAt(w, h, name, quality = 0.94) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, left, top, cw, ch, 0, 0, w, h);
  writeFileSync(join(outDir, name), c.toBuffer('image/jpeg', quality));
  console.log(`  ${name.padEnd(28)} ${w}x${h}  ratio ${(w / h).toFixed(3)}`);
}

const c0 = createCanvas(cw, ch);
c0.getContext('2d').drawImage(img, left, top, cw, ch, 0, 0, cw, ch);
writeFileSync(join(outDir, `${base}-trim.png`), c0.toBuffer('image/png'));
console.log(`  ${(base + '-trim.png').padEnd(28)} ${cw}x${ch}  native pixels`);

exportAt(2480, 3508, `${base}-a4-300dpi.jpg`, 0.92);
exportAt(1240, 1754, `${base}-a4-150dpi.jpg`, 0.94);

const target = 1080 / 1350;
let sw = cw;
let sh = Math.round(cw / target);
if (sh > ch) {
  sh = ch;
  sw = Math.round(ch * target);
}
const sx = left + Math.round((cw - sw) / 2);
const sy = top + Math.round((ch - sh) / 2);
{
  const c = createCanvas(1080, 1350);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, 1080, 1350);
  writeFileSync(join(outDir, `${base}-social-4x5.jpg`), c.toBuffer('image/jpeg', 0.94));
  console.log(`  ${(base + '-social-4x5.jpg').padEnd(28)} 1080x1350  ratio 0.800  center-crop ${sw}x${sh}`);
}
