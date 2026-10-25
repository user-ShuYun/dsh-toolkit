#!/usr/bin/env node
/**
 * gh-release.mjs —— 建 Release 并上传附件（走 uploads.github.com）。
 *
 *   node gh-release.mjs --repo permian-apex --tag v1.0.0 --name "..." --body-file notes.md --asset D:/x.zip
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const TOKEN = readFileSync('D:/deepseek/.secrets/gh-token', 'utf8').trim();
const OWNER = 'user-ShuYun';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const repo = opt('repo');
const tag = opt('tag');
const name = opt('name', tag);
const bodyFile = opt('body-file');
const asset = opt('asset');
const body = bodyFile ? readFileSync(bodyFile, 'utf8') : opt('body', '');

const H = { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'dsh-agent' };

async function api(method, path, json) {
  const r = await fetch('https://api.github.com' + path, {
    method,
    headers: { ...H, 'content-type': 'application/json' },
    body: json ? JSON.stringify(json) : undefined
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const release = await api('POST', `/repos/${OWNER}/${repo}/releases`, {
  tag_name: tag,
  name,
  body,
  draft: false,
  prerelease: false
});
console.log('release:', release.html_url);

if (asset) {
  const data = readFileSync(asset);
  console.log(`上传 ${basename(asset)}（${(data.length / 1024 / 1024).toFixed(1)} MB）…`);
  const started = Date.now();
  const r = await fetch(`https://uploads.github.com/repos/${OWNER}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(basename(asset))}`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/zip', 'content-length': String(data.length) },
    body: data
  });
  const text = await r.text();
  if (!r.ok) {
    console.error('上传失败:', r.status, text.slice(0, 300));
    process.exit(1);
  }
  const j = JSON.parse(text);
  console.log(`已上传: ${j.name}  ${(j.size / 1024 / 1024).toFixed(1)} MB  用时 ${Math.round((Date.now() - started) / 1000)}s`);
  console.log('下载地址:', j.browser_download_url);
}
