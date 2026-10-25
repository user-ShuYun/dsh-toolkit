/**
 * journal.mjs —— 会话/任务日志（自动写，给「记忆」和「日报」当原料）。
 *
 * 和 LESSONS 的区别：
 *   LESSONS 记「知识」（以后能复用的一条结论）
 *   journal 记「流水」（今天干了什么、成没成、花了多久）
 *
 * 两者配合：日报从 journal 汇总，我在复盘时从日报里挑出值得升格成 LESSONS 的。
 *
 * 用法:
 *   node tools/journal.mjs add --kind video --ok --detail "3 镜成片 44s" --cmd "..."
 *   node tools/journal.mjs today
 *   node tools/journal.mjs last        # 最近 7 天汇总
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\deepseek';
const DIR = path.join(ROOT, 'notes', '日志');

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 追加一条流水 */
export function journalAdd({ kind = 'task', ok = true, detail = '', cmd = '', extra = '' } = {}) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${today()}.md`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${today()} 流水\n\n`, 'utf8');
    const t = new Date().toTimeString().slice(0, 8);
    const line = `- ${t} ${ok ? '✅' : '❌'} [${kind}] ${detail}${cmd ? `　\`${String(cmd).slice(0, 160)}\`` : ''}${extra ? `　${extra}` : ''}\n`;
    fs.appendFileSync(file, line, 'utf8');
    return true;
  } catch { return false; }
}

// ---------- CLI ----------
const isCli = /journal\.mjs$/.test(process.argv[1] || '');
if (isCli) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d) => {
    const i = rest.indexOf('--' + n);
    if (i < 0) return d;
    const v = rest[i + 1];
    return v && !v.startsWith('--') ? v : true;
  };
  if (cmd === 'add') {
    const ok = journalAdd({
      kind: String(flag('kind', 'task')),
      ok: !rest.includes('--fail'),
      detail: String(flag('detail', '')),
      cmd: String(flag('cmd', '')),
      extra: String(flag('extra', ''))
    });
    console.log(ok ? '已记录' : '记录失败');
  } else if (cmd === 'today') {
    const f = path.join(DIR, `${today()}.md`);
    console.log(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '今天还没有流水');
  } else if (cmd === 'last') {
    if (!fs.existsSync(DIR)) {
      console.log('还没有日志');
    } else {
      const files = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-7);
      for (const f of files) {
        const text = fs.readFileSync(path.join(DIR, f), 'utf8');
        const okN = (text.match(/✅/g) || []).length;
        const badN = (text.match(/❌/g) || []).length;
        console.log(`${f}  ✅${okN}  ❌${badN}`);
      }
    }
  } else {
    console.log('用法: node tools/journal.mjs add|today|last');
  }
}
