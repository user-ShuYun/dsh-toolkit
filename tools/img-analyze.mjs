/**
 * 分析图片：找内容边界（去掉纯色/近似纯色的边框），输出候选裁剪框。
 *   node img-analyze.mjs <file>
 */
import { createRequire } from 'node:module';
const require = createRequire('D:/deepseek/swust/package.json');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const file = process.argv[2];
const img = await loadImage(file);
const W = img.width;
const H = img.height;
const c = createCanvas(W, H);
const g = c.getContext('2d');
g.drawImage(img, 0, 0);
const data = g.getImageData(0, 0, W, H).data;

const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

// 四角取样，估计"底色"
const corners = [px(2, 2), px(W - 3, 2), px(2, H - 3), px(W - 3, H - 3)];
const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, p) => s + p[k], 0) / 4));
console.log('尺寸:', W + 'x' + H, ' 比例:', (W / H).toFixed(3));
console.log('四角颜色:', corners.map((p) => `rgb(${p.join(',')})`).join(' / '));
console.log('估计底色:', `rgb(${bg.join(',')})`);

const TH = 26; // 与底色的曼哈顿距离阈值
const isBg = (x, y) => dist(px(x, y), bg) < TH;

// 逐行/逐列统计非底色像素占比
const rowFrac = new Array(H).fill(0);
const colFrac = new Array(W).fill(0);
for (let y = 0; y < H; y += 2) {
  let n = 0;
  for (let x = 0; x < W; x += 2) if (!isBg(x, y)) n++;
  rowFrac[y] = n / (W / 2);
}
for (let x = 0; x < W; x += 2) {
  let n = 0;
  for (let y = 0; y < H; y += 2) if (!isBg(x, y)) n++;
  colFrac[x] = n / (H / 2);
}

const firstIdx = (arr, min) => arr.findIndex((v) => v >= min);
const lastIdx = (arr, min) => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= min) return i;
  return -1;
};

for (const min of [0.02, 0.05, 0.2]) {
  const top = firstIdx(rowFrac, min);
  const bottom = lastIdx(rowFrac, min);
  const left = firstIdx(colFrac, min);
  const right = lastIdx(colFrac, min);
  console.log(
    `阈值${(min * 100).toFixed(0)}%  内容框: x=${left}..${right} y=${top}..${bottom}  →  ${right - left + 1}x${bottom - top + 1}`
  );
}

// 每 10% 高度的"非底色比例"，帮助判断留白分布
console.log('\n纵向密度（每 10%）:');
for (let i = 0; i < 10; i++) {
  const a = Math.floor((H * i) / 10);
  const b = Math.floor((H * (i + 1)) / 10);
  let sum = 0;
  let cnt = 0;
  for (let y = a; y < b; y += 2) { sum += rowFrac[y]; cnt++; }
  const v = sum / Math.max(1, cnt);
  console.log(`  ${(i * 10).toString().padStart(3)}%-${((i + 1) * 10).toString().padStart(3)}%  ${(v * 100).toFixed(1)}%  ${'█'.repeat(Math.round(v * 40))}`);
}
