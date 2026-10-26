/**
 * dsh-prompt-button —— 在 GUI 右下角加一排「预设提示词」按钮，点一下就把整段提示词填进输入框，
 * 你按回车就发。目的：把每次开工/收工要说的一大段话，从"手打"变成"一下点击"。
 *
 * 为什么走 tapIndex 注入而不是写客户端插件：客户端插件要打包、要 dev:web 才能热更；
 * 而 tapIndex 只是在 index.html 的 </body> 前插一段脚本，刷新页面就生效，和「工具箱」按钮同一套机制。
 *
 * 为什么用"整段提示词"而不是让 Agent 自己判断：口头指令每次都会被压缩、漏项；
 * 写死的文本能把"读哪几个文件、跑哪几条命令、回复先贴什么"固定下来。
 */
import fs from 'node:fs';
import path from 'node:path';

// 只导出 apply，和已验证能加载的 auto-recall 保持同一形状（少一个变量，少一处失败可能）
const ROOT = 'D:\\deepseek';
const PRESET_DIR = path.join(ROOT, 'out', 'prompts');

/**
 * 预设提示词。想改内容不用重启：改 out/prompts/<id>.md 即可（每次请求都读文件）。
 * id 用来找 md；label 是按钮上的字；hint 是鼠标悬停说明。
 */
const DEFAULT_PRESETS = [
  { id: 'start', label: '开工', hint: '读工具书 + 台账 + 现在.md，贴三行快照', text: `开工。按顺序做，别跳步：

1) node tools/preflight.mjs            # 一条拿全：环境/经验库/记忆库/现在.md/台账/渠道
2) node tools/memo.mjs recall "本次任务一句话"
3) node tools/recall.mjs --event plan --text "本次要做的事"   # 按动作类型召回，不靠关键词
4) 读 notes/现在.md 的「下一步」；然后按任务 grep TOOLS.md 的对应章节（别整篇读）
5) 台账若有待提炼回合 → node tools/ledger.mjs distill，值得记的当场进库

回复第一段先贴三行快照：
开工：N 条经验 · 上次停在「…」· 渠道 X/8
相关：L0xx …
下一步：…

硬规矩：只写验证过的经验；引用经验救了自己要记账；该派子代理的长活别自己扛。` },

  { id: 'wrap', label: '收工', hint: '复盘材料 + 体检 + 提炼 + 重算命中 + 写现在.md', text: `收工。按顺序跑完再回话：

1) node tools/reflect.mjs --hours 8
2) node tools/audit.mjs
3) node tools/ledger.mjs distill        # 有值得记的写进 LESSONS.md，然后用 done 标掉
4) node tools/ledger.mjs hits --recount
5) node tools/state.mjs --write --next "下一步动作"

最后告诉我：这次该记几条经验（编号）、台账还剩几个回合、下一步具体是什么命令。` },

  { id: 'review', label: '复盘', hint: '只提炼台账，产出候选经验', text: `复盘：跑 node tools/ledger.mjs distill，读提炼包，重点看「三、判断失误信号」那三节（用户纠正 / 撞墙重试 / 自我否定）。

最多写 3 条经验进 LESSONS.md，每条必须带具体证据（来自哪个回合 key、报错原文或数字）。不够格就不写，宁可空手回来。写完用 node tools/ledger.mjs done <key> 标掉已提炼的回合。` },

  { id: 'handoff', label: '交接', hint: '中断前把进度落盘', text: `交接：把当前进度写进 notes/现在.md —— 做到哪、卡在哪、下一步的具体命令是什么；台账标掉已提炼的回合；然后给我 5 行以内摘要，不要展开。` }
];

function readPreset(id) {
  try {
    const p = path.join(PRESET_DIR, `${id}.md`);
    if (fs.existsSync(p)) {
      const t = fs.readFileSync(p, 'utf8').trim();
      if (t) return t;
    }
  } catch { /* 读不到就用默认 */ }
  return '';
}

function buildPresets(config) {
  const fromConfig = Array.isArray(config?.presets) ? config.presets : [];
  const base = fromConfig.length ? fromConfig : DEFAULT_PRESETS;
  return base.map((p) => ({
    id: String(p.id || p.label || 'preset'),
    label: String(p.label || p.id || '预设'),
    hint: String(p.hint || ''),
    // 文件优先：改 md 不用重启插件
    text: readPreset(p.id) || String(p.text || '')
  })).filter((p) => p.text);
}

/** 注入脚本：纯 ES5 写法 + 不嵌套模板串，避免 L041（内层反斜杠/`${}` 被外层吃掉） */
function overlayScript(presets) {
  const payload = JSON.stringify(presets).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
  return [
    '<style>',
    '#dshPromptBar{position:fixed;right:14px;bottom:14px;z-index:2147483000;display:flex;gap:6px;',
    'font:12px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;align-items:flex-end}',
    '#dshPromptBar button{cursor:pointer;border:1px solid rgba(120,140,180,.35);background:rgba(22,26,34,.92);',
    'color:#cfd8e6;border-radius:8px;padding:6px 10px;box-shadow:0 2px 10px rgba(0,0,0,.25);transition:.15s}',
    '#dshPromptBar button:hover{background:rgba(38,46,60,.98);color:#fff;border-color:rgba(140,170,220,.7)}',
    '#dshPromptBar button.ok{background:#1f7a45;border-color:#2aa35c;color:#fff}',
    '#dshPromptBar button.err{background:#7a2323;border-color:#a33;color:#fff}',
    '#dshPromptToast{position:fixed;right:14px;bottom:52px;z-index:2147483000;background:rgba(18,22,30,.96);',
    'color:#dbe4f0;border:1px solid rgba(120,140,180,.35);border-radius:8px;padding:6px 10px;',
    'font:12px/1.5 sans-serif;opacity:0;transition:opacity .2s;pointer-events:none}',
    '#dshPromptToast.show{opacity:1}',
    '</style>',
    '<script>(function(){',
    'var PRESETS=' + payload + ';',
    'if(window.__dshPromptBar)return;window.__dshPromptBar=1;',
    'function toast(msg,bad){var t=document.getElementById("dshPromptToast");if(!t){t=document.createElement("div");t.id="dshPromptToast";document.body.appendChild(t);}',
    't.textContent=msg;t.style.borderColor=bad?"#a33":"rgba(120,140,180,.35)";t.classList.add("show");',
    'clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove("show");},1800);}',
    // 找输入框：优先 contenteditable，其次 textarea（取页面上最后一个可见的，通常就是主输入框）
    'function findComposer(){var sel=["[contenteditable=\'true\']","textarea","[role=\'textbox\']"];var best=null;',
    'for(var i=0;i<sel.length;i++){var list=document.querySelectorAll(sel[i]);',
    'for(var j=0;j<list.length;j++){var el=list[j];if(el.closest("#dshPromptBar"))continue;',
    'var r=el.getBoundingClientRect();if(r.width<80||r.height<10)continue;',
    'if(el.getAttribute("aria-hidden")==="true"||el.disabled)continue;best=el;}}',
    'return best;}',
    'function fill(text){var el=findComposer();if(!el)return false;el.focus();',
    'var tag=el.tagName;',
    'if(tag==="TEXTAREA"||tag==="INPUT"){var proto=tag==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;',
    'var desc=Object.getOwnPropertyDescriptor(proto,"value");',
    'if(desc&&desc.set){desc.set.call(el,text);}else{el.value=text;}',
    'el.dispatchEvent(new Event("input",{bubbles:true}));',
    '}else{var sel=window.getSelection();var range=document.createRange();range.selectNodeContents(el);',
    'sel.removeAllRanges();sel.addRange(range);',
    'var ok=document.execCommand("insertText",false,text);',
    'if(!ok){el.textContent=text;}',
    'el.dispatchEvent(new Event("input",{bubbles:true}));}',
    'el.focus();return true;}',
    'function copy(text){try{navigator.clipboard.writeText(text);return true;}catch(e){return false;}}',
    'function mount(){if(!document.body)return setTimeout(mount,50);',
    'var bar=document.createElement("div");bar.id="dshPromptBar";',
    'PRESETS.forEach(function(p){var b=document.createElement("button");b.type="button";b.textContent=p.label;',
    'if(p.hint)b.title=p.hint;',
    'b.onclick=function(){var ok=fill(p.text);',
    'if(ok){b.classList.add("ok");setTimeout(function(){b.classList.remove("ok");},900);',
    'toast("已填入「"+p.label+"」：按回车发送");}',
    'else if(copy(p.text)){toast("没找到输入框，已复制到剪贴板（Ctrl+V）",true);}',
    'else{toast("没找到输入框，也复制失败",true);}',
    '};bar.appendChild(b);});',
    'document.body.appendChild(bar);}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();',
    '})();</script>'
  ].join('\n');
}

export function apply(ctx, config) {
  // 最先写心跳：只要 apply 被调用过就留痕，跟后面哪一步失败无关（排查用）
  try {
    fs.appendFileSync(path.join(ROOT, 'out', 'prompt-button.log'),
      `[${new Date().toISOString()}] apply entered\n`, 'utf8');
  } catch { /* 忽略 */ }
  try {
    if (typeof ctx.webServer?.tapIndex !== 'function') {
      console.warn('[prompt-button] webServer.tapIndex 不可用，按钮不会出现');
      return;
    }
    ctx.webServer.tapIndex((html) => {
      try {
        // 每次请求都重读一遍：改 out/prompts/<id>.md 之后刷新页面就生效，不用重启
        const presets = buildPresets(config);
        if (!presets.length) return html;
        const tag = overlayScript(presets);
        return html.includes('</body>') ? html.replace('</body>', tag + '\n</body>') : html + tag;
      } catch (e) {
        console.warn('[prompt-button] tapIndex 处理失败（已忽略）:', e?.message ?? e);
        return html;
      }
    });
    const n = buildPresets(config).length;
    console.log(`[prompt-button] 已就绪：${n} 个预设（内容读 out/prompts/*.md，改完刷新页面即生效）`);
    // 心跳：没有控制台可看时，靠它确认"插件到底有没有被加载"（排查用，失败不影响功能）
    try {
      fs.appendFileSync(path.join(ROOT, 'out', 'prompt-button.log'),
        `[${new Date().toISOString()}] apply ok, presets=${n}\n`, 'utf8');
    } catch { /* 忽略 */ }
    // 自检口子：首页要登录，但这个路由不要，所以 curl 一下就知道插件装没装、读到哪几个预设
    try {
      ctx.webServer.register({
        kind: 'exact',
        path: '/prompt-button/health',
        handler: (req, res) => {
          const list = buildPresets(config).map((p) => ({ id: p.id, label: p.label, chars: p.text.length }));
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ ok: true, at: new Date().toISOString(), presets: list }));
        }
      });
    } catch (e) {
      console.warn('[prompt-button] 自检路由注册失败（不影响按钮）:', e?.message ?? e);
    }
  } catch (e) {
    console.warn('[prompt-button] 安装失败（已忽略）:', e?.message ?? e);
  }
}

export const __test = { buildPresets, overlayScript };
