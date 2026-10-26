#!/usr/bin/env node
/**
 * tools/prompt.mjs —— 预设提示词的"不用点按钮"版本。
 *
 * 为什么还要它：GUI 上的按钮要重启 dsh web 才会出现（插件是服务端注入的）。
 * 在那之前，或者你人在终端里，这个脚本能把同一段提示词直接塞进剪贴板：
 *
 *   node tools/prompt.mjs                 # 列出有哪些
 *   node tools/prompt.mjs start           # 打印 + 复制（Ctrl+V 就能贴进输入框）
 *   node tools/prompt.mjs wrap --print    # 只打印，不碰剪贴板
 *
 * 提示词正文在 out/prompts/<id>.md —— 改文件比改代码方便，两个入口都读它。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = 'D:\\deepseek';
const DIR = path.join(ROOT, 'out', 'prompts');

const argv = process.argv.slice(2);
const id = argv.find((a) => !a.startsWith('--')) || '';
const onlyPrint = argv.includes('--print');

const { __test } = await import('file:///D:/deepseek/plugins/prompt-button/index.js');
const presets = __test.buildPresets({});

if (!presets.length) {
  console.log('没有可用预设：out/prompts/ 下没有 md，插件里也没有默认文本');
  process.exit(1);
}

if (!id) {
  console.log('可用提示词（正文在 out/prompts/<id>.md）：\n');
  for (const p of presets) console.log(`  ${p.id.padEnd(10)} ${p.label.padEnd(4)} ${p.hint}`);
  console.log('\n用法: node tools/prompt.mjs start        # 打印 + 复制到剪贴板');
  console.log('      node tools/prompt.mjs start --print # 只打印');
  process.exit(0);
}

const p = presets.find((x) => x.id === id) || presets.find((x) => x.label === id);
if (!p) {
  console.log(`没有这个预设：${id}。可用：${presets.map((x) => x.id).join(' / ')}`);
  process.exit(1);
}

console.log(p.text.trim());
console.log('');
if (onlyPrint) process.exit(0);

const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'], {
  input: p.text,
  encoding: 'utf8'
});
if (r.status === 0) console.log('✓ 已复制到剪贴板，到输入框 Ctrl+V 再回车');
else console.log('（复制失败，直接手动选中上面的文本吧）');
