/** 把新背景图登记进 design_spec §VIII，去掉 lock 里未引用的 old bg */
import { readFileSync, writeFileSync } from 'node:fs';

const proj = 'D:/deepseek/projects/dsh-toolbox_hybrid';
const dsPath = proj + '/design_spec.md';
const lkPath = proj + '/spec_lock.md';

const rows = [
  ['bg-structure.png', '内页背景（结构页）：横向岩层剖面线，暗示“分层”'],
  ['bg-numbers.png', '内页背景（数字页）：稀疏点阵与微光斑，暗示“数据密度”'],
  ['bg-entries.png', '内页背景（清单页）：淡网格与卡片阴影，暗示“界面骨架”'],
  ['bg-chain.png', '内页背景（链路页）：细刻度线与胶片颗粒，暗示“时间轴”']
]
  .map(
    ([f, purpose]) =>
      `| ${f} | 1672×941 | 1.78 | ${purpose} | Photography | 满幅低对比纹理，其上叠本页模块 | adaptive | user | Existing | GPT 生成 | none | background |`
  )
  .join('\n');

let ds = readFileSync(dsPath, 'utf8');
const anchor = '\n## IX. Content Outline';
if (!ds.includes(anchor)) throw new Error('找不到 IX 锚点');
if (ds.includes('bg-structure.png')) {
  console.log('design_spec 已包含新图，跳过');
} else {
  ds = ds.replace(anchor, '\n' + rows + anchor);
  writeFileSync(dsPath, ds, 'utf8');
  console.log('design_spec 已追加 4 行');
}

let lk = readFileSync(lkPath, 'utf8');
if (lk.includes('content-bg')) {
  lk = lk.replace(/- content-bg: images\/bg-content\.png \| source=user \| crop=adaptive\r?\n/, '');
  writeFileSync(lkPath, lk, 'utf8');
  console.log('spec_lock 已移除 content-bg');
} else {
  console.log('spec_lock 无 content-bg');
}
