/**
 * 批量检索：一次跑多个 query，输出紧凑结果。
 *   node gh-find.mjs "q1" "q2" ...
 */
const H = { 'user-agent': 'dsh-agent', accept: 'application/vnd.github+json' };

async function search(q, n = 6) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${n}`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) {
    console.log(`\n### ${q}  → HTTP ${r.status}（限流就等一会儿）`);
    return [];
  }
  const j = await r.json();
  console.log(`\n### ${q}  (total ${j.total_count})`);
  const out = [];
  for (const it of j.items) {
    const upd = (it.pushed_at ?? '').slice(0, 7);
    console.log(`  ${it.full_name.padEnd(42)} ★${String(it.stargazers_count).padEnd(6)} ${upd}  ${(it.description ?? '').slice(0, 88)}`);
    out.push(it);
  }
  return out;
}

const qs = process.argv.slice(2);
for (const q of qs) {
  await search(q);
  await new Promise((r) => setTimeout(r, 1200));
}
