/** 组装要开源的仓库：复制工具、背景词典、规程、示例 deck，并把本机绝对路径泛化 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'D:/deepseek';
const DST = 'D:/deepseek/gh/dsh-toolkit';

const ensure = (p) => mkdirSync(p, { recursive: true });
ensure(join(DST, 'tools'));
ensure(join(DST, 'art/backgrounds'));
ensure(join(DST, 'docs'));
ensure(join(DST, 'examples/dsh-toolbox'));

// 1) 工具
let tools = 0;
for (const f of readdirSync(join(SRC, 'tools'))) {
  if (!f.endsWith('.mjs') && !f.endsWith('.cmd')) continue;
  cpSync(join(SRC, 'tools', f), join(DST, 'tools', f));
  tools++;
}

// 1b) 插件（2026-10-26 加：自动召回 + 提示词按钮）
let plugins = 0;
for (const name of ['auto-recall', 'prompt-button']) {
  const src = join(SRC, 'plugins', name);
  if (!existsSync(src)) continue;
  const dst = join(DST, 'plugins', name);
  ensure(dst);
  for (const f of readdirSync(src)) {
    if (f.startsWith('_')) continue;                     // 临时/测试文件不带
    cpSync(join(src, f), join(dst, f));
    plugins++;
  }
}

// 2) 背景词典
cpSync(join(SRC, 'art/backgrounds/presets.json'), join(DST, 'art/backgrounds/presets.json'));
cpSync(join(SRC, 'art/backgrounds/README.md'), join(DST, 'art/backgrounds/README.md'));

// 3) 规程（泛化本机路径）
let playbook = readFileSync(join(SRC, 'TOOLS.md'), 'utf8');
playbook = playbook
  .replaceAll('D:\\deepseek\\ppt-master2', '<PPT_MASTER_REPO>')
  .replaceAll('D:\\deepseek\\ppt-master', '<PPT_MASTER_VENV>')
  .replaceAll('D:\\deepseek\\projects\\dsh-toolbox_hybrid', '<PROJECT>')
  .replaceAll('D:\\deepseek\\out', '<OUT>')
  .replaceAll('D:\\deepseek\\art', '<ART>')
  .replaceAll('D:\\deepseek\\tools', 'tools')
  .replaceAll('D:\\deepseek', '<WORKSPACE>')
  .replaceAll('C:\\Users\\舒韫\\.dsh\\profiles\\web', '<DSH_PROFILE>');
writeFileSync(join(DST, 'docs/PLAYBOOK.md'), playbook, 'utf8');

// 4) 示例 deck（只要 SVG + 规格，不放图）
const proj = join(SRC, 'projects/dsh-toolbox_hybrid');
const exDir = join(DST, 'examples/dsh-toolbox');
ensure(join(exDir, 'svg_output'));
for (const f of readdirSync(join(proj, 'svg_output'))) {
  if (f.endsWith('.svg')) cpSync(join(proj, 'svg_output', f), join(exDir, 'svg_output', f));
}
for (const f of ['spec_lock.md', 'design_spec.md']) {
  if (existsSync(join(proj, f))) cpSync(join(proj, f), join(exDir, f));
}

// 5) gitignore
writeFileSync(
  join(DST, '.gitignore'),
  ['node_modules/', '*.log', '.DS_Store', 'Thumbs.db', '*.png', '*.pptx', '*.mp4', '!docs/*.png', ''].join('\n'),
  'utf8'
);

console.log('组装完成 →', DST);
console.log('工具:', tools, '个');
