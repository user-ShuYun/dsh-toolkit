/** 重建 design_spec §VIII 表格：去掉 bg-content，五张图连续成表 */
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'D:/deepseek/projects/dsh-toolbox_hybrid/design_spec.md';
let s = readFileSync(p, 'utf8');

const start = s.indexOf('| Filename |');
const end = s.indexOf('## IX.');
if (start < 0 || end < 0 || end < start) throw new Error('找不到表格区间');

const header = [
  '| Filename | Dimensions | Ratio | Purpose | Type | Image pattern | Crop Policy | Acquire Via | Status | Reference | text_policy | page_role |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
].join('\n');

const row = (f, purpose, pattern, role) =>
  `| ${f} | 1672×941 | 1.78 | ${purpose} | Photography | ${pattern} | adaptive | user | Existing | GPT 生成 / 用户素材 | none | ${role} |`;

const rows = [
  row('deck-cover.png', '封面主图：夜色书桌、亮着的笔电与代码窗口', 'P1 满幅铺底，暗部在左承字', 'cover'),
  row('bg-structure.png', '内页背景（结构页）：横向岩层剖面线，暗示“分层”', 'P2 满幅低对比纹理，其上叠阶梯块', 'background'),
  row('bg-numbers.png', '内页背景（数字页）：稀疏点阵与微光斑，暗示“数据密度”', 'P3 满幅暗底，巨型数字压在其上', 'background'),
  row('bg-entries.png', '内页背景（清单页）：淡网格与卡片阴影，暗示“界面骨架”', 'P4 满幅低对比纹理，卡片叠在其上', 'background'),
  row('bg-chain.png', '内页背景（链路页）：细刻度线与胶片颗粒，暗示“时间轴”', 'P5 满幅暗底，胶片条叠在其上', 'background')
];

const table = header + '\n' + rows.join('\n') + '\n\n';
s = s.slice(0, start) + table + s.slice(end);
writeFileSync(p, s, 'utf8');
console.log('§VIII 已重建为 5 行连续表格');
