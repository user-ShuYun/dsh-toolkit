#!/usr/bin/env node
/**
 * tools/recall-arm.mjs —— auto-recall 的装/卸/开关，一条命令。
 *
 * 为什么不用手改 cordis.patch.yml：L051 记着"回合中途改 patch 会打断当轮"，
 * 而且每次手改都要自己备份、自己核对有没有重复插入。这里把三件事固定下来：
 *   ① 改之前一定先备份成 cordis.patch.yml.bak-autorecall-<时间戳>
 *   ② 幂等：已经装了就不重复插；没装就不重复删
 *   ③ 默认影子（只写日志不注入），要真正注入必须显式 --inject
 *
 * 用法（注意：在**回合之间**跑，别在我干活跑到一半时跑）：
 *   node tools/recall-arm.mjs status
 *   node tools/recall-arm.mjs arm          # 插入插件条目（默认影子）
 *   node tools/recall-arm.mjs arm --inject # 插入并立刻允许注入（不推荐，先跑影子）
 *   node tools/recall-arm.mjs disarm       # 摘掉插件条目
 *   node tools/recall-arm.mjs --inject     # 只翻转注入开关（不增删插件）
 *   node tools/recall-arm.mjs --shadow     # 只翻转回影子
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\deepseek';
const PLUGIN = 'file:///D:/deepseek/plugins/auto-recall/index.js';
const ID = 'auto-recall';
const FLAG = path.join(ROOT, 'out', 'recall', 'inject.on');
const LOG = path.join(ROOT, 'out', 'recall', 'auto.log');

const profileDir =
  process.env.DSH_PROFILE_DIR || path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'web');
const patch = path.join(profileDir, 'cordis.patch.yml');

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('--')) || 'status';

function backup(tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dst = `${patch}.bak-${tag}-${stamp}`;
  fs.copyFileSync(patch, dst);
  return dst;
}

function installed(text) {
  return new RegExp(`^\\s*-\\s*id:\\s*${ID}\\s*$`, 'm').test(text);
}

function arm(text, inject) {
  if (installed(text)) return { text, changed: false, why: '已经装了' };
  const sep = text.endsWith('\n') ? '' : '\n';
  const block = `${sep}- insert:\n    - id: ${ID}\n      name: ${PLUGIN}\n`;
  if (inject) fs.writeFileSync(FLAG, 'inject\n');
  return { text: text + block, changed: true, why: '插入完成' };
}

function disarm(text) {
  if (!installed(text)) return { text, changed: false, why: '本来就没装' };
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 命中 auto-recall 的 insert 头，连同它的子行一起跳过；顺手去掉可能残留的空 insert:
    if (/^\s*-\s*insert:\s*$/.test(line) && new RegExp(`^\\s*-\\s*id:\\s*${ID}\\s*$`).test(lines[i + 1] || '')) {
      i += 1;
      while (i + 1 < lines.length && /^\s{4,}/.test(lines[i + 1])) i += 1;
      continue;
    }
    out.push(line);
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), changed: true, why: '摘除完成' };
}

function lastLog(n = 5) {
  if (!fs.existsSync(LOG)) return ['（还没有日志）'];
  return fs.readFileSync(LOG, 'utf8').trim().split(/\r?\n/).slice(-n);
}

if (!fs.existsSync(patch)) {
  console.error(`找不到 profile 补丁文件：${patch}`);
  process.exit(1);
}
const cur = fs.readFileSync(patch, 'utf8');

if (cmd === 'status') {
  console.log(`profile   ${profileDir}`);
  console.log(`patch     ${patch}（${fs.statSync(patch).size} B）`);
  console.log(`已安装    ${installed(cur) ? '是' : '否'}`);
  console.log(`注入开关  ${fs.existsSync(FLAG) ? '开（会真的塞消息）' : '关（影子：只写日志）'}`);
  console.log('最近日志:');
  for (const l of lastLog()) console.log('  ' + l);
  process.exit(0);
}

let result;
if (cmd === 'arm') {
  result = arm(cur, args.includes('--inject'));
} else if (cmd === 'disarm') {
  result = disarm(cur);
} else if (!cmd || cmd.startsWith('--')) {
  result = { text: cur, changed: false, why: '只切开关' };
} else {
  console.error(`不认识的命令：${cmd}`);
  process.exit(1);
}

if (args.includes('--inject') && cmd !== 'arm') {
  fs.writeFileSync(FLAG, 'inject\n');
  result.why += ' · 注入开关已打开';
}
if (args.includes('--shadow') && cmd !== 'disarm') {
  if (fs.existsSync(FLAG)) fs.unlinkSync(FLAG);
  result.why += ' · 已回到影子模式';
}

if (result.changed) {
  const bak = backup(cmd);
  fs.writeFileSync(patch, result.text, 'utf8');
  console.log(`${result.why}；备份 ${path.basename(bak)}`);
  console.log(`当前已安装：${installed(fs.readFileSync(patch, 'utf8')) ? '是' : '否'}`);
  console.log('注意：patchReload=live，改动会立刻热加载；下次会话生效最稳。');
} else {
  console.log(result.why + '，未改动文件。');
}
