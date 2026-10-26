/**
 * gh-init-repo.mjs —— 用 Git Data API 一次性把目录推成仓库（不依赖 git 协议）
 *   $env:GITHUB_TOKEN=... ; node tools/gh-init-repo.mjs <dir> <repoName> [description] [--private]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('缺 GITHUB_TOKEN 环境变量');

const [dir, repoName, desc = '', ...rest] = process.argv.slice(2);
const isPrivate = rest.includes('--private');
const API = 'https://api.github.com';
const H = {
  authorization: `Bearer ${TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-toolkit-publisher',
  'content-type': 'application/json'
};

const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
  return json;
};

// 0) 我是谁
const me = await call('GET', '/user');
console.log('账号:', me.login);

// 1) 建仓库（已存在就沿用）
let repo;
try {
  repo = await call('POST', '/user/repos', {
    name: repoName,
    description: desc,
    private: isPrivate,
    auto_init: false,
    has_issues: true,
    has_wiki: false
  });
  console.log('已创建仓库:', repo.full_name);
} catch (e) {
  if (!String(e.message).includes('422')) throw e;
  repo = await call('GET', `/repos/${me.login}/${repoName}`);
  console.log('仓库已存在，沿用:', repo.full_name);
}

// 1.5) 空仓库不能用 Git Data API（409 Git Repository is empty），先用 Contents API 落一个占位文件
let parentSha = null;
try {
  const ref = await call('GET', `/repos/${repo.full_name}/git/refs/heads/main`);
  parentSha = ref.object.sha;
} catch {
  const boot = await call('PUT', `/repos/${repo.full_name}/contents/README.md`, {
    message: 'chore: 初始化仓库',
    content: Buffer.from('# dsh-toolkit\n\n初始化中…\n', 'utf8').toString('base64')
  });
  parentSha = boot.commit.sha;
  console.log('已提交占位 README（用于激活 Git 数据接口）');
}

// 2) 收集文件
const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dir);
console.log('待推送文件:', files.length);

// 3) 逐个建 blob
const tree = [];
for (const p of files) {
  const rel = relative(dir, p).split(sep).join('/');
  const content = readFileSync(p).toString('base64');
  const blob = await call('POST', `/repos/${repo.full_name}/git/blobs`, { content, encoding: 'base64' });
  tree.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
}

// 4) 建 tree + commit + ref
const t = await call('POST', `/repos/${repo.full_name}/git/trees`, { tree });
const c = await call('POST', `/repos/${repo.full_name}/git/commits`, {
  message: 'feat: DSH Toolkit —— 浏览器/视频/PPT/GitHub 自动化工具集\n\n- 25 个可直接跑的 .mjs 工具\n- 背景纹样词典（6 题材 × 6 页型）\n- PPT 三合一生产规程（含 5 条硬门禁）\n- 一份完整示例 deck',
  tree: t.sha,
  parents: [parentSha]
});
await call('PATCH', `/repos/${repo.full_name}/git/refs/heads/main`, { sha: c.sha, force: true });

console.log('已推送 commit:', c.sha.slice(0, 10));
console.log('仓库地址: https://github.com/' + repo.full_name);
