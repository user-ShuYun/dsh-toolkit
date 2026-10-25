/**
 * deck-cover.mjs —— 让 ChatGPT 给 PPT 画一张封面背景。
 *   node tools/deck-cover.mjs "<prompt>" <outPath> [timeoutSec]
 */
import { pathToFileURL } from 'node:url';

const [prompt, outPath = 'D:/deepseek/art/raw/deck-cover.png', timeout] = process.argv.slice(2);
const API = 'http://127.0.0.1:3100/api/';
const post = async (n, b) => {
  const r = await fetch(API + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
  return r.json();
};

// 确保有一个 ChatGPT 标签页
await post('newtab', { url: 'https://chatgpt.com/' });
await new Promise((r) => setTimeout(r, 9000));

const mod = await import(pathToFileURL('D:/deepseek/dsh-gpt-driver/src/index.js').href);
const tools = new Map();
mod.apply({ tools: { register: (t) => tools.set(t.name, t) } }, { port: 9222 });

const st = await tools.get('gpt_status').execute({});
console.log('页面:', st.url, '| busy:', st.busy, '| 已有图:', st.images);

const sent = await tools.get('gpt_send').execute({ text: prompt });
console.log('已发送，基线', sent.baseline);
const res = await tools.get('gpt_wait_image').execute({ outPath, timeoutSec: Number(timeout || 300) });
console.log('已存盘:', res.path, Math.round(res.bytes / 1024) + 'KB', res.seconds + 's', res.sha256.slice(0, 12));
