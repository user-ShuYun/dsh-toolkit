#!/usr/bin/env node
/**
 * gh-publish.mjs —— 用 GitHub REST API 把本地目录发布成仓库（等价于 git push）。
 *
 * 为什么不用 git：这台机器上 github.com 的 HTTPS 被重置、SSH 握手卡死，
 * 只有 api.github.com 通。所以走 Git Data API：blob → tree → commit → ref。
 *
 * 用法：
 *   node gh-publish.mjs --repo permian-apex --dir D:/deepseek/gh/permian-apex --desc "..." [--private]
 *   node gh-publish.mjs --repo x --dir y --message "feat: ..." [--dry]
 *
 * token 从 D:/deepseek/.secrets/gh-token 读，绝不打印。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const API = 'https://api.github.com';
const TOKEN = readFileSync('D:/deepseek/.secrets/gh-token', 'utf8').trim();
const HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-agent',
  'content-type': 'application/json'
};

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes('--' + name);

const repoName = opt('repo');
const dir = opt('dir');
const desc = opt('desc', '');
const message = opt('message', 'chore: publish');
const isPrivate = flag('private');
const dry = flag('dry');
if (!repoName || !dir) {
  console.error('用法: node gh-publish.mjs --repo <name> --dir <path> [--desc ...] [--private] [--message ...] [--dry]');
  process.exit(1);
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.vite']);
const SKIP_FILES = /(\.zip|\.log|\.tmp|Thumbs\.db|\.DS_Store)$/i;

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!r.ok) {
    const err = new Error(`${method} ${path} -> ${r.status} ${json?.message ?? text.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

function walk(root, base = root, out = []) {
  for (const name of readdirSync(base)) {
    const p = join(base, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(root, p, out);
    } else if (!SKIP_FILES.test(name) && st.size < 40 * 1024 * 1024) {
      out.push({ abs: p, rel: relative(root, p).split(sep).join('/'), size: st.size });
    }
  }
  return out;
}

async function main() {
  const me = await api('GET', '/user');
  console.log('账号:', me.login);

  // 1) 仓库
  let repo;
  try {
    repo = await api('GET', `/repos/${me.login}/${repoName}`);
    console.log('仓库已存在:', repo.full_name);
  } catch (e) {
    if (e.status !== 404) throw e;
    repo = await api('POST', '/user/repos', {
      name: repoName,
      description: desc,
      private: isPrivate,
      auto_init: false
    });
    console.log('仓库已创建:', repo.full_name);
  }

  const files = walk(dir);
  const total = files.reduce((s, f) => s + f.size, 0);
  console.log(`文件 ${files.length} 个，合计 ${(total / 1024 / 1024).toFixed(1)} MB`);
  if (dry) return;

  // 1b) 空仓库的 git 数据库还没初始化，直接建 blob 会 409：
  //     先用 Contents API 提交一个 README 把库“点亮”。
  const branch = repo.default_branch || 'main';
  let hasCommits = false;
  try {
    const ref = await api('GET', `/repos/${me.login}/${repoName}/git/ref/heads/${branch}`);
    hasCommits = !!ref?.object?.sha;
  } catch {
    hasCommits = false;
  }
  if (!hasCommits) {
    await api('PUT', `/repos/${me.login}/${repoName}/contents/README.md`, {
      message: 'chore: init repository',
      content: Buffer.from(`# ${repoName}\n\n${desc}\n`).toString('base64')
    });
    console.log('已初始化仓库（README 引导提交）');
  }

  // 2) blob（并发 6）
  const entries = [];
  let done = 0;
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      const content = readFileSync(f.abs).toString('base64');
      const blob = await api('POST', `/repos/${me.login}/${repoName}/git/blobs`, { content, encoding: 'base64' });
      entries.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
      done++;
      if (done % 25 === 0) process.stdout.write(`  blobs ${done}/${files.length}\r`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`  blobs ${done}/${files.length} 完成`);

  // 3) tree
  const tree = await api('POST', `/repos/${me.login}/${repoName}/git/trees`, {
    tree: entries.sort((a, b) => a.path.localeCompare(b.path))
  });

  // 4) commit（有历史就挂 parent）
  let parents = [];
  try {
    const ref = await api('GET', `/repos/${me.login}/${repoName}/git/ref/heads/${repo.default_branch || 'main'}`);
    parents = [ref.object.sha];
  } catch { /* 空仓库 */ }

  const commit = await api('POST', `/repos/${me.login}/${repoName}/git/commits`, {
    message,
    tree: tree.sha,
    parents
  });

  // 5) ref
  try {
    await api('PATCH', `/repos/${me.login}/${repoName}/git/refs/heads/${repo.default_branch || 'main'}`, { sha: commit.sha, force: true });
  } catch {
    await api('POST', `/repos/${me.login}/${repoName}/git/refs`, {
      ref: `refs/heads/${repo.default_branch || 'main'}`,
      sha: commit.sha
    });
  }

  console.log('提交完成:', commit.sha.slice(0, 10));
  console.log('地址: https://github.com/' + me.login + '/' + repoName);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
