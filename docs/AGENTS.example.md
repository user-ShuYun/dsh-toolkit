# AGENTS.md — 本工作区的开工简报

> 这份文件由 DSH 的 `dsh-agent-instructions` 在**每次新会话的第一条请求**自动注入。
> 你（Agent）现在读到的就是它。别跳过下面的「开工一条命令」。

---

## 一、开工一条命令（别问，直接跑）

```powershell
node tools/preflight.mjs
```

一次拿到：环境体检（ComfyUI / 控制台在不在）· 经验库规模与草稿 · 全库标签分布 · 最近 3 条经验。
要看具体条目再加 `--full`（约 8 KB），或 `node tools/reflect.mjs --index`（只出标题，1.2 KB）。

然后**按任务读** `TOOLS.md` 的对应章节（很长，别整篇读，用 grep 定位）。

三份材料的定位：

| 文件 | 是什么 | 什么时候读 |
|---|---|---|
| `TOOLS.md` | 已蒸馏的稳定规程（命令、参数、流程） | 开工看目录，按任务用 grep 定位章节 |
| `LESSONS.md` | 追加式经验日志（症状/原因/修法/证据） | `learn.mjs search` 命中时读正文 |
| `notes/经验库/*.md` | 两份专题总纲（视频生产 / 视频总结） | 做这两类任务前整篇读 |

---

## 二、收工三件事（任务结束前必须做）

```powershell
node tools/reflect.mjs --hours 8     # 摆材料：改了哪些文件、经验库状态、6 问清单
node tools/audit.mjs                 # 体检：重复/陈货/超期草稿/计分是否在用
```

1. **有坑就记**：`node tools/learn.mjs add --tag .. --symptom .. --cause .. --fix .. --evidence ..`
2. **流程变了就改 TOOLS.md**（不是只记日志）
3. **同一条经验第 3 次出现** → 蒸馏进 TOOLS.md，日志留原文

**写经验的硬规矩**：
- 只写**验证过**的；猜的、没复现的，标「未验证」或不写
- 证据要具体（数字、报错原文、对比结果）
- 一次失败自动进 `LESSONS.draft.md`，确认后才升格成 L###
- **引用某条经验救了自己，就 `node tools/learn.mjs hit L0xx`**——否则计分永远是 0

---

## 三、这台机器是什么（30 秒版）

- Windows，工作目录 `D:\deepseek`，Node 24，DSH Web GUI
- **ComfyUI 本地视频/图像生产**：`D:\ComfyUI`，端口 8188（`node tools/comfy.mjs status` 体检）
- **B 站视频总结流水线**：取字幕 → 分块 → 摘要 → 存 `notes/`
- **ChatGPT 浏览器自动化**：9222 端口 Edge + 3099 GPT 控制台 + 3100 浏览器控制台

---

## 四、最值钱的几条（自动生成，命中越多越靠前）

<!-- BRIEF:START 由 tools/brief.mjs 生成，别手改这一块 -->
1. **[环境] RTX 50 系必须 cu128 的 torch** —— pip 装 --index-url https://download.pytorch.org/whl/cu128；但 pip 走 IPv6 
2. **[总结] 长视频总结必须自己分块，内置接口只取前 1.2 万字** —— 分块：<1.2万字直接总结；否则按 1.4 万字/块切，逐块摘要后再合并
3. **[网络] ChatGPT 浏览器检查失败时程序点重载无效** —— 必须真人点一次「重新加载」；通过后会话自动恢复，不用重新登录。新开标签页必再触发，尽量在同一 tab 里点新聊天
4. **[下载] hf-mirror 单连接 0.3MB/s，多连接分片 40~55MB/s** —— 用 out/setup/dl-parallel.ps1 做 16 路分片（curl -r 分段）再按序拼接
5. **[下载] 分片拼接后文件头全 0，ComfyUI 报 Expecting value line 1 column 1** —— 拼接后读前 8 字节当小端 uint64，header_len 必须在 100~1e6 之间；不合格就重下
6. **[视频] 8GB 上 LTX 蒸馏 8 步是甜点，dev 28 步反而更糊** —— 默认用 ltxv-2b-0.9.8-distilled-fp8：8 步、cfg 1、640x384、73 帧，18 秒一条
7. **[视频] Wan2.1 I2V 1.3B 不存在** —— 8GB 要图生视频只能用 Wan2.2 TI2V-5B（Q4/Q5 GGUF），或 LTX 的 I2V
8. **[视频] 人物漂移的触发条件是景别切换，不是时间** —— 同景别内接帧可撑 2~3 镜；换景别就接受它是一组新镜头，或用多参考模型
9. **[视频] 白底立绘不能当 I2V 锚点图** —— 锚点图要出「场景内」版本：同灯光、同环境、同机位，再喂给视频模型
10. **[视频] 转头必须切镜，但切镜救不了跨镜一致性** —— 改成两镜：正面不动 + 已经转好的侧面（shortdrama 支持 cutTo / turn 字段）；跨镜一致性仍需多参考模型
<!-- BRIEF:END -->

> 这一块由 `node tools/brief.mjs --write` 自动生成，规则：命中次数×3 + 新鲜度 + 标签稀有度。
> 想改内容就改 `LESSONS.md`，不要手改这里。

---

## 五、常用命令速查

```powershell
# ComfyUI
node tools/comfy.mjs status
node tools/comfy.mjs run --workflow out/workflows/ltx-t2v-api.json --out out/a.mp4 --set "6.text=..." --set "70.length=73" --set "71.steps=8" --set "72.cfg=1"

# 分镜成片
node tools/shortdrama.mjs --engine ltx --plan out/plan-rainy.json --out out/film.mp4 --grade film
node tools/shortdrama.mjs --engine wan --plan out/plan-wan.json --out out/film-wan.mp4 --width 832 --height 480

# 拼接/调色/抽帧
node tools/stitch.mjs --in "a.mp4,b.mp4" --out final.mp4 --grade film
node tools/stitch.mjs --sheet final.mp4 --cols 4 --rows 2

# 氛围循环批量
powershell -File tools/make-loops.ps1

# B 站总结
node out/fetch-bili.mjs BV号 → 分块 → 摘要 → node out/write-note-general.mjs BV号 总结.md
node tools/notes.mjs search 关键词
```

---

## 六、三条行为准则

1. **先验证再下结论**：说「X 不存在/做不到」之前，先查仓库、先跑一次。我已经因为「凭印象说 Wan 有 1.3B I2V」记过一次教训。
2. **失败立刻留痕**：工具报错会自动写草稿，但**只有我判断后升格**才会变成真经验；别让草稿烂在文件里。
3. **能复用才写**：一次性的临时路径、临时文件名不写；下次还会用到的数字/命令/参数才写。
