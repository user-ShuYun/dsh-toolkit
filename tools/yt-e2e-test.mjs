/** 端到端测试：YouTube 链接 → 字幕 → GPT 总结 → 存笔记（客户端长超时） */
const A = 'http://127.0.0.1:3100/api/';
const t0 = Date.now();
try {
  const r = await fetch(A + 'videoSummary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=aircAruvnKk' }),
    signal: AbortSignal.timeout(900000)
  });
  const j = await r.json();
  console.log('耗时', Math.round((Date.now() - t0) / 1000) + 's | ok:', j.ok);
  if (j.ok) {
    const v = j.result;
    console.log('标题:', v.title);
    console.log('来源:', v.source, '| 字数:', v.chars, '| 笔记:', v.note || '(无)');
    console.log('=== 总结 ===');
    console.log((v.summary || '').slice(0, 900));
  } else {
    console.log('ERR', JSON.stringify(j).slice(0, 300));
  }
} catch (e) {
  console.log('客户端失败:', e.message, '| 已等', Math.round((Date.now() - t0) / 1000) + 's');
}
