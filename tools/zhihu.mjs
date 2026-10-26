/**
 * zhihu.mjs —— 知乎检索（借 9222 浏览器的登录态，走 CDP）。
 *
 * 为什么必须走浏览器：知乎对服务端抓取一律 403（我 2026-10-25 实测 web_fetch 直接 403），
 * 只有真实浏览器 + 登录 cookie 才拿得到搜索结果。
 *
 * 用法:
 *   node tools/zhihu.mjs search "agent 记忆" 5
 *   node tools/zhihu.mjs read <知乎链接>          # 抓正文前 4000 字
 *   --keep   抓完不关标签页（默认关掉，避免标签页堆积）
 */
import { findTab, openTab, closeTab, evaluate, waitFor } from './cdp.mjs';

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const cmd = argv[0];
const target = argv[1];
const n = Number(argv[2]) || 5;

function die(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

if (!cmd || !target) {
  console.log('用法: node tools/zhihu.mjs search "关键词" [条数]\n       node tools/zhihu.mjs read <链接>');
  process.exit(0);
}

let tab;
let created = false;

try {
  if (cmd === 'search') {
    const url = 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(target);
    tab = await findTab(/zhihu\.com\/search/);
    if (tab) {
      await evaluate(tab, `location.href = ${JSON.stringify(url)}; 'nav'`, { awaitPromise: false }).catch(() => {});
    } else {
      tab = await openTab(url);
      created = true;
    }

    const ready = await waitFor(
      tab,
      `(() => {
         const cards = document.querySelectorAll('.SearchResult-Card, .Card.SearchResult-Card, [data-za-detail-view-path-module="SearchResult"]');
         return cards.length ? cards.length : 0;
       })()`,
      { timeout: 20000 }
    );

    if (!ready) {
      const state = await evaluate(tab, `({ title: document.title, hasLogin: !!document.querySelector('.Modal-wrapper, .signFlowModal'), n: document.querySelectorAll('a').length })`);
      die('搜索结果没渲染出来（' + JSON.stringify(state) + '）。可能需要登录，或知乎换了结构。');
    }

    const rows = await evaluate(
      tab,
      `(() => {
        const out = [];
        const cards = document.querySelectorAll('.SearchResult-Card, .Card.SearchResult-Card');
        for (const c of cards) {
          const a = c.querySelector('h2 a, .ContentItem-title a');
          const body = c.querySelector('.RichText');
          const meta = c.querySelector('.SearchItem-meta');
          const author = c.querySelector('.AuthorInfo-name') || c.querySelector('.UserLink-link') || c.querySelector('[class*="AuthorInfo"] a');
          if (!a) continue;
          const title = (a.textContent || '').replace(/\\s+/g, ' ').trim();
          let excerpt = body ? (body.textContent || '').replace(/\\s+/g, ' ').trim() : '';
          if (!excerpt && meta) excerpt = (meta.textContent || '').replace(/\\s+/g, ' ').trim();
          // 知乎的摘要容器有时直接把标题又包了一遍，去掉重复
          if (excerpt.startsWith(title)) excerpt = excerpt.slice(title.length).replace(/^[:：\\s]+/, '').trim();
          out.push({
            title,
            url: a.href,
            excerpt: excerpt.slice(0, 160),
            author: author ? author.textContent.trim() : ''
          });
          if (out.length >= ${n}) break;
        }
        return out;
      })()`
    );

    if (!rows?.length) die('页面有结果容器但没有解析出条目，可能选择器变了。');

    console.log(`\n知乎「${target}」— ${rows.length} 条\n`);
    for (const r of rows) {
      console.log(`${r.title}`);
      console.log(`  ${r.author || '-'}  ${r.url}`);
      if (r.excerpt) console.log(`  ${r.excerpt}`);
      console.log('');
    }
    // 供 harvest 解析的机读行
    console.log('---TSV---');
    for (const r of rows) console.log([r.title, r.author || '-', (r.excerpt || '').slice(0, 120), r.url].join('\t'));
  } else if (cmd === 'read') {
    tab = await openTab(target);
    created = true;
    const ok = await waitFor(tab, `!!document.querySelector('.RichText, article, .Post-RichText')`, { timeout: 20000 });
    if (!ok) die('正文容器没出现（可能要登录，或这是视频/专栏页）。');
    const text = await evaluate(tab, `(() => {
      const el = document.querySelector('.RichText, article, .Post-RichText');
      return (el.innerText || '').slice(0, 4000);
    })()`);
    console.log(text || '(空)');
  } else {
    die('未知子命令: ' + cmd);
  }
} catch (e) {
  die(e.message);
} finally {
  if (created && tab && !KEEP) await closeTab(tab.id);
}
