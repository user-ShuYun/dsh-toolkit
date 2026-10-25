/**
 * lesson-draft.mjs —— 失败自动落草稿。
 *
 * 规则（为什么这样设计）：
 *   反思最有价值的时刻是「失败发生的那一秒」，不是会话结束。
 *   所以工具报错时自动把现场（命令、报错首行、上下文）写进 LESSONS.draft.md，
 *   下一次会话开工时先看到它，由模型判断要不要升格成正式经验（L###）。
 *
 *   草稿只写不删、带哈希去重（同一条错误 24 小时内只记一次），
 *   永远不会抛异常——不能因为记日志把主流程搞挂。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'D:\\deepseek';
const DRAFT = path.join(ROOT, 'LESSONS.draft.md');
const WINDOW_MS = 24 * 3600 * 1000;

function ensureHeader() {
  if (fs.existsSync(DRAFT)) return;
  fs.writeFileSync(DRAFT, [
    '# 经验草稿（待确认）',
    '',
    '> 由工具自动写入，**不是**正式经验。',
    '> 确认后：`node tools/learn.mjs add ...` 升格成 L###，然后删掉本条。',
    '> 误报直接删：反正它只是草稿。',
    ''
  ].join('\n'), 'utf8');
}

function existingHashes() {
  if (!fs.existsSync(DRAFT)) return new Map();
  const text = fs.readFileSync(DRAFT, 'utf8');
  const map = new Map();
  for (const m of text.matchAll(/^## \[(D\d+)\] (\S+) · hash:(\w{8})/gm)) {
    map.set(m[3], new Date(m[2]).getTime());
  }
  return map;
}

function nextId(text) {
  const ids = [...text.matchAll(/^## \[D(\d+)\]/gm)].map((m) => Number(m[1]));
  return 'D' + String((ids.length ? Math.max(...ids) : 0) + 1).padStart(3, '0');
}

/**
 * @param {{tool?:string, cmd?:string, error?:string, context?:object}} info
 */
export function draftLesson(info = {}) {
  try {
    const tool = String(info.tool || 'unknown');
    const raw = String(info.error || 'unknown error');
    const first = raw.split('\n').find((l) => l.trim()) || raw;
    const hash = crypto.createHash('sha1').update(tool + '|' + first.slice(0, 80)).digest('hex').slice(0, 8);

    const seen = existingHashes();
    if (seen.has(hash) && Date.now() - seen.get(hash) < WINDOW_MS) return null; // 24h 内同错不重复记

    ensureHeader();
    const text = fs.readFileSync(DRAFT, 'utf8');
    const id = nextId(text);
    const ts = new Date().toISOString();
    const ctx = info.context ? JSON.stringify(info.context).slice(0, 400) : '';
    const block = [
      '',
      `## [${id}] ${ts} · hash:${hash} · ${tool}`,
      `- 症状: ${first.slice(0, 300)}`,
      info.cmd ? `- 命令: \`${String(info.cmd).slice(0, 300)}\`` : '- 命令: —',
      ctx ? `- 上下文: ${ctx}` : '- 上下文: —',
      '- 状态: 待确认',
      ''
    ].join('\n');
    fs.appendFileSync(DRAFT, block, 'utf8');
    return id;
  } catch {
    return null; // 记日志永远不能影响主流程
  }
}

/** 读草稿（给 reflect.mjs 用） */
export function listDrafts() {
  if (!fs.existsSync(DRAFT)) return [];
  const text = fs.readFileSync(DRAFT, 'utf8');
  return [...text.matchAll(/^## \[(D\d+)\] (\S+) · hash:\w+ · (\S+)\n- 症状: (.+)$/gm)].map((m) => ({
    id: m[1], time: m[2], tool: m[3], symptom: m[4]
  }));
}
