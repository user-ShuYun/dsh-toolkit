/**
 * GitHub 检索小工具（只读，走 api.github.com —— 这台机器上 github.com 的 git 通道被重置，API 是通的）
 *
 *   node gh-search.mjs "dsh-plugin"
 *   node gh-search.mjs --file octocat/Hello-World README
 */
const H = { 'user-agent': 'dsh-agent', accept: 'application/vnd.github+json' };

async function search(q, n = 8) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=${n}`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`search ${r.status} ${await r.text()}`);
  const j = await r.json();
  console.log(`\n=== ${q}  (total ${j.total_count}) ===`);
  for (const it of j.items) {
    console.log(`  ${it.full_name.padEnd(46)} ★${String(it.stargazers_count).padEnd(6)} ${it.description ?? ''}`);
  }
}

async function file(repo, path) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${r.status}`);
  const j = await r.json();
  if (Array.isArray(j)) {
    for (const f of j) console.log(`${f.type}\t${f.size}\t${f.name}`);
    return;
  }
  console.log(Buffer.from(j.content, 'base64').toString('utf8'));
}

const args = process.argv.slice(2);
if (args[0] === '--file') await file(args[1], args[2] ?? '');
else for (const q of args.length ? args : ['dsh-plugin']) await search(q);
