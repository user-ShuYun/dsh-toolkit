/** 在 CDP 浏览器里打开隔离 profile 的页面并截图，检查按钮是否出现 */
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'D:/deepseek/button-check.png';
const API = 'http://127.0.0.1:3100/api/';
const post = async (name, body) => {
  const r = await fetch(API + name, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  return r.json();
};

console.log('newtab:', JSON.stringify(await post('newtab', { url })));
await new Promise((r) => setTimeout(r, 7000));

// 读一下页面上有没有我们的按钮
const probe = await post('eval', {
  code: `(() => {
    const b = document.querySelector('.dsh-toolbox-btn');
    return JSON.stringify({
      url: location.href,
      found: !!b,
      text: b ? b.innerText : null,
      title: b ? b.getAttribute('title') : null,
      rect: b ? (r => ({x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}))(b.getBoundingClientRect()) : null,
      errors: window.__errs || null
    });
  })()`
});
console.log('probe:', probe.result?.value ?? JSON.stringify(probe).slice(0, 300));

const shot = await post('shot');
if (shot.ok) {
  const b64 = shot.result.dataUrl.split(',')[1];
  writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('saved:', out, shot.result.width + 'x' + shot.result.height);
} else {
  console.log('shot failed:', shot.error);
}
