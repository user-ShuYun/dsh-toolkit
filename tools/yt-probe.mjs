/** 探测：YouTube 字幕能不能在不登录的情况下拿到 */
const id = process.argv[2] || 'aircAruvnKk';
const res = await fetch('https://www.youtube.com/watch?v=' + id, {
  headers: {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9'
  }
});
const html = await res.text();
const title = (html.match(/<title>(.*?)<\/title>/) || [])[1] || '(无标题)';
console.log('HTTP', res.status, '| 页面长度', html.length);
console.log('标题:', title.slice(0, 80));

const idx = html.indexOf('"captionTracks"');
console.log('含 captionTracks:', idx > 0);
if (idx > 0) {
  const start = html.indexOf('[', idx);
  let depth = 0;
  let end = start;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const arr = JSON.parse(html.slice(start, end));
  console.log('字幕轨:', arr.map((t) => `${t.languageCode}/${t.kind || 'manual'}`).join(', '));
  const url = arr[0].baseUrl;
  console.log('首条 URL 长度:', url.length);
  const capRes = await fetch(url);
  const xml = await capRes.text();
  console.log('抓字幕 HTTP', capRes.status, '| 字节', xml.length);
  const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]);
  console.log('条数:', texts.length);
  console.log('前两句:', texts.slice(0, 2).map(decode).join(' / ').slice(0, 120));
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '');
}
