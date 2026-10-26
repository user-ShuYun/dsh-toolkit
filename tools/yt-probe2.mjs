/** 探测：Node + 代理 能否拿到 YouTube 字幕（对比浏览器上下文） */
const id = process.argv[2] || 'aircAruvnKk';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const r = await fetch('https://www.youtube.com/watch?v=' + id, {
  headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }
});
const html = await r.text();
console.log('页面 HTTP', r.status, '| 长度', html.length, '| 含 captionTracks:', html.includes('"captionTracks"'));

const i = html.indexOf('"captionTracks"');
if (i < 0) process.exit(1);
const s = html.indexOf('[', i);
let depth = 0;
let e = s;
for (let k = s; k < html.length; k++) {
  if (html[k] === '[') depth++;
  else if (html[k] === ']') {
    depth--;
    if (depth === 0) {
      e = k + 1;
      break;
    }
  }
}
const tracks = JSON.parse(html.slice(s, e));
console.log(
  '字幕轨:',
  tracks
    .slice(0, 6)
    .map((t) => t.languageCode + '/' + (t.kind || 'manual'))
    .join(', '),
  '… 共',
  tracks.length
);

const pick = tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') || tracks[0];
for (const variant of ['&fmt=json3', '&fmt=srv3', '']) {
  const url = pick.baseUrl + variant;
  try {
    const cr = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', referer: 'https://www.youtube.com/' } });
    const body = await cr.text();
    console.log(`  ${variant || '(原始)'}: HTTP ${cr.status} | 字节 ${body.length} | ${body.slice(0, 60).replace(/\n/g, ' ')}`);
  } catch (err) {
    console.log(`  ${variant || '(原始)'}: ERR ${err.message}`);
  }
}
