/** 截图 ppt-master 的 live preview（逐页点左侧列表） */
import { writeFileSync } from 'node:fs';

const A = 'http://127.0.0.1:3100/api/';
const post = async (n, b) => {
  const r = await fetch(A + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await post('open', { url: 'http://127.0.0.1:6060/' });
await sleep(4000);

const pages = ['01', '02', '03', '04', '05'];
for (const p of pages) {
  const code = `(() => {
    const nodes = [...document.querySelectorAll('div,li,span')];
    const hit = nodes.find((e) => e.children.length === 0 && e.textContent.trim().startsWith('${p}_'));
    if (!hit) return 'not-found';
    hit.click();
    return 'clicked ' + hit.textContent.trim().slice(0, 24);
  })()`;
  const r = await post('eval', { code });
  await sleep(1500);
  const s = await post('shot');
  if (s.ok) {
    writeFileSync(`D:/deepseek/preview-p${p}.png`, Buffer.from(s.result.dataUrl.split(',')[1], 'base64'));
    console.log(p, r.result?.value, '→ ok');
  } else {
    console.log(p, 'shot failed');
  }
}
