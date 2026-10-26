/**
 * 浠?awesome-dsh-plugin 鐨勬暟鎹噷鎸戝嚭鏈€鍊煎緱鐪嬬殑鎻掍欢銆? * 鏁版嵁锛歞ata/stars.json锛?464 鏉★級+ data/plugins/*.yml锛堟瘡涓彃浠剁殑鍏冩暟鎹級
 */
const H = { 'user-agent': 'dsh-agent', accept: 'application/vnd.github+json' };
const REPO = 'awesome-dsh-plugin/awesome-dsh-plugin';

async function json(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: H });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  const j = await r.json();
  if (!j.content) throw new Error(path + ' too large');
  return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
}

async function raw(path) {
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/HEAD/${path}`, { headers: { 'user-agent': 'dsh-agent' } });
  return r.ok ? r.text() : '';
}

const starsRaw = await json('data/stars.json');
const stars = Object.entries(starsRaw).map(([url, v]) => ({ name: url, stars: v.stars ?? 0 }));
const top = stars.sort((a, b) => b.stars - a.stars).slice(0, 22);

console.log('=== 鈽?鏈€澶氱殑 24 涓?DSH 鎻掍欢 ===');
for (const e of top) {
  const slug = e.name.replace('https://github.com/', '').replace('/', '__');
  let desc = '';
  let tags = '';
  try {
    const y = await raw(`data/plugins/${slug}.yml`);
    const m = y.match(/description:\s*(.+)/);
    if (m) desc = m[1].replace(/^["']|["']$/g, '');
    const t = y.match(/tags:\s*\[(.*?)\]/s);
    if (t) tags = t[1].replace(/\s+/g, ' ').slice(0, 40);
  } catch { /* 娌℃湁鍏冩暟鎹?*/ }
  console.log(`${String(e.stars).padStart(5)}鈽? ${e.name.replace('https://github.com/', '')}`);
  if (desc) console.log(`        ${desc.slice(0, 110)}`);
  if (tags) console.log(`        [${tags}]`);
}
