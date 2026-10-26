# 本机工具箱（给任何 DSH 会话看）

> 用户可能在任何对话里说「总结这个视频 / 让 GPT 画一张 / 看看这个网页」，先读这里，别重新发明。

## 🚩 开工顺序（每次会话第一件事）

```
① node tools/preflight.mjs        ← 一条拿全：环境/经验库/记忆库/现在.md/台账/渠道
② node tools/memo.mjs recall "这次任务的一句话"   ← 跨四库检索，最多 3 条
③ 账上有待提炼的回合 → node tools/ledger.mjs distill
④ 再读本文件的相关章节（用 grep 定位，别整篇读）
```

**别跳过 ①**。经验库 `LESSONS.md` 是追加式的，里面全是真实踩过的坑；本文件是**已蒸馏的稳定规程**。
**preflight 会替你想起"该复盘了"**：它的 `=== 台账 ===` 那行就是「N 个回合待提炼」，不靠我记性。
**草稿看这里**：`node tools/reflect.mjs --drafts`（`comfy.mjs`/`shortdrama.mjs` 报错时会自动记现场）。

> 📚 两份成体系的专题总纲（比日志更完整，带实测数据）：
> - `notes/经验库/本地AI视频生产-经验总纲.md` —— 模型选型、参数、一致性、画质、循环素材
> - `notes/经验库/视频总结与浏览器自动化-经验.md` —— 分块总结流程、Cloudflare / 标签页冲突

## 🔚 收尾协议（每次会话结束前）

```powershell
node tools/reflect.mjs --hours 8      # 摆材料：改了哪些文件、经验库状态、6 问清单
node tools/ledger.mjs distill         # 把没提炼的回合聚成包（含失败聚类）
node tools/ledger.mjs hits --recount  # 重算命中（= 引用过它的去重会话数）
node tools/state.mjs --write --next "下一步动作"
```

`reflect` 只摆材料、不做判断：这次改了哪些文件、经验库条数/体积/标签、疑似重复、从没命中的陈货，外加一张 6 问自检清单。
`ledger distill` 生成 `out/ledger/distill-<时间>.md`：回合清单 + 失败聚类 + 命中统计 + 5 个要回答的问题，交给子代理或自己写草稿。

| 情况 | 动作 |
|---|---|
| 踩了新坑 / 证伪了一个做法 | `node tools/learn.mjs add --tag ... --symptom ... --cause ... --fix ... --evidence ...` |
| 流程变了（新脚本、改默认参数） | 改**本文件**对应章节，不只是记日志 |
| 同一条经验第 3 次出现 | 蒸馏进本文件，日志留原文 |
| 动过 `notes/` | `node tools/notes.mjs index` |

**六问**：查了才知道的命令？做法被证伪？新数字？流程变了？同一条第 3 次？「以为做了其实没验证」？

### ⚠️ 环境事实：工具名写着 `pwsh`，实际跑的是 Windows PowerShell 5.1

2026-10-26 实测 `$PSVersionTable` = **5.1.26100.9711 / Desktop**，不是 PowerShell 7。三个连带后果：

| 现象 | 真相 | 怎么办 |
|---|---|---|
| `Set-Content -Encoding utf8` 写的 JSON，Node 报 `Unexpected token '﻿'` | 5.1 的 utf8 编码**带 BOM**（EF BB BF） | 读 JSON 先 `replace(/^\uFEFF/,'')`；要无 BOM 用 `[IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false))` |
| `-Encoding utf8NoBOM` 报 Cannot convert value | 5.1 没这个选项 | 同上 |
| 脚本里 `$a ?? $b` 解析期报错 | 5.1 不支持空合并运算符 | 别用 7.x 语法 |
| 用 PowerShell 给 JS 模板串打补丁 → `${{variable}} reference missing closing '}}'` | 双引号里的 `${…}` 被 PS 当变量插值 | **改源码/配置一律用 write/edit 工具**，别用 PS 字符串替换（三次弯路：ParserError / BOM / file changed） |

另外：`node ... | Select-Object -First N` 会在子进程还活着时**断管**，退出码变 -1、harness 记成
`[exit code: 1]`——命令其实成功了（见 L058）。要截断就先落变量：`$x = node ...; $x | Select-Object -First N`。

同族的还有一条：**`Invoke-WebRequest` 在本机全线失败**（自带证书/代理栈），下载一律用 `curl.exe` 或 Node `fetch`
（配 L017 的显式代理）。Python 安装器、ffmpeg、模型文件都走这条路（见 L018）。

### 三层结构（为什么要分开）

| 层 | 文件 | 写作方式 | 体积 |
|---|---|---|---|
| **稳定规程** | `TOOLS.md`（本文件） | 人工蒸馏，只留能照抄的做法 | 受控，~30 KB |
| **经验日志** | `LESSONS.md` | 追加式，犯一次记一条 | 会长大，需定期压缩 |
| **检索工具** | `tools/learn.mjs` | 计分（救过几次）+ 90 天半衰期 | — |

**为什么不能只用一个文件**：`TOOLS.md` 保持"能从头读到尾"的可读性；所有细节塞进来，第二次就没人读了。

### 什么时候写一条经验

写（不必问）：

- 命令报错，查了才解决 → 记「症状 / 原因 / 修法」
- 某个做法被验证**不成立**（比如"用 `-q` 关锁"其实 `-q` 是 quiet）
- 发现某个数（体积、耗时、比例）以后要复用

不写：

- 一次性的临时路径、临时文件名
- 猜的、"可能是"的原因（**没验证就不记**，否则经验库会被污染）

### 增长控制（硬规矩）

| 触发 | 动作 |
|---|---|
| `LESSONS.md` > 80 KB 或 > 60 条 | 跑 `node tools/learn.mjs compact --dry-run` 找重复 |
| 某条 `命中` ≥ 3 | 把它**蒸馏进本文件的对应章节**，日志里保留原文 |
| 条目互相矛盾 | 以**新的、有证据的**那条为准，旧的标 `~~废弃~~` 并写明原因 |

```powershell
node tools/learn.mjs add --tag 端口 --title "3100 报 inflight 锁" `
  --symptom "gpt_ask: 有一条请求在途" --cause "abort 时锁没释放" `
  --fix "重启 3100 进程" --evidence "重启后 51 秒出结果"
node tools/learn.mjs hit L001        # 这条救了你一次，+1
node tools/learn.mjs search "锁"      # 带衰减的检索
node tools/learn.mjs stats           # 条数 / 体积 / 标签分布
```

## 一键启动

```powershell
tools\start-all.cmd
```

会检查并拉起三样东西（已在跑就跳过）：

| 端口 | 是什么 |
|---|---|
| **9222** | Edge 调试端口（`--user-data-dir=<WORKSPACE>\edge-cgpt`，已登录 B 站 / ChatGPT） |
| **3099** | GPT 控制台 http://127.0.0.1:3099 （发提示词、出图） |
| **3100** | 浏览器控制台 http://127.0.0.1:3100 （视频总结、截图、点击、读文字） |

## 命令

```powershell
# B 站
node tools/bili.mjs state                      # 登录态
node tools/bili.mjs search "关键词" 8           # 搜视频 → BV号/标题/UP/播放
node tools/bili.mjs info BV1xrnz6gEVD          # 详情 + 字幕轨
node tools/bili.mjs subs BV1xrnz6gEVD          # 字幕正文
node tools/bili-summarize.mjs <链接> --out x.txt   # 字幕落盘

# 浏览器控制台 API（POST JSON，UTF-8）
#   /api/open      {url}                 跳转
#   /api/newtab    {url}                 新标签
#   /api/shot      {}                    截图（返回 dataUrl）
#   /api/text      {}                    读可见文字
#   /api/links     {limit}               列链接
#   /api/click     {selector|x,y,nth}    真实鼠标点击
#   /api/type      {text}                输入到焦点
#   /api/key       {name:Enter|Escape}   按键
#   /api/scroll    {dy}                  滚动
#   /api/back      {}                    后退
#   /api/eval      {code}                执行 JS
#   /api/videoText {url}                 视频字幕
#   /api/videoSummary {url, withGpt}     字幕 + ChatGPT 总结

# GPT 控制台 API（同一套）
#   /api/status              页面状态
#   /api/send    {text}      发一条（忙时拒绝）
#   /api/wait    {outPath}   等画完存盘（含 sha256）
#   /api/ask     {text}      只问答
#   /api/export  {outPath}   取最新图

# 其他
node tools/gh-publish.mjs --repo <name> --dir <path> [--desc ...]   # 推 GitHub 仓库（需 token 文件）
node tools/gh-release.mjs --repo <name> --tag v1 --asset <zip>      # 发 Release
node tools/poster-crop.mjs <图片> <输出目录>                          # 去白边 + A4/4:5
```

## 注意

1. **别用 PowerShell 的 `ConvertTo-Json` 传中文**给这些 API —— 会变成 `????`。用 Node 的 `fetch` 或 `[System.Text.Encoding]::UTF8.GetBytes(...)`。
2. **GPT 是单通道**：`/api/send` 在生成中会直接报错，等 `/api/wait` 或 `/api/status` 显示空闲再发下一条。两个控制台共用同一套发送逻辑，别同时点。
3. **B 站字幕需要登录态**，cookie 从 9222 那个 Edge 里取；没有 SESSDATA 会直接报错。
4. 视频没字幕会退到 B 站 AI 总结，再没有就只给简介。
5. 超长字幕（>1.2 万字）在总结时会被截断。
6. **`gpt_ask: 有一条请求在途，等它结束`**：这是 gpt-driver 在进程内的 inflight 锁，不是 ChatGPT 真在忙（`3099/api/status` 显示 `busy:false` 也照报）。**重启 3100 即可清掉**：

```powershell
$c = Get-NetTCPConnection -LocalPort 3100 -State Listen; Stop-Process -Id $c.OwningProcess -Force
Start-Process "D:\Node\node.exe" -ArgumentList @('--use-system-ca','tools\browser-console.mjs','3100') -WorkingDirectory '<WORKSPACE>' -WindowStyle Hidden
```

  成因：上一次请求被中止（工具调用 abort）时锁没释放。实测重启后同一条视频 51 秒出结果。

## 🧭 知识获取协议（2026-10-25 用户定的规矩，最高优先级）

> 用户原话：「我叫你总结哪方面的知识，你要跑去这四个平台上找，一定程度上你也可以使用自己的检索手段。
> 只有 B 站我会贴链接，其他平台我不怎么用，也没那个精力。」

**含义**：用户给的是**主题**，不是链接。**默认我要自己去找**，找不着再问。

### 五个渠道，各管一段

| 渠道 | 什么时候用 | 怎么进 |
|---|---|---|
| **GitHub** | 找能直接抄的代码/项目 | `harvest.mjs`（API，需代理） |
| **npm / PyPI** | 找现成的包，别自己造 | `harvest.mjs` |
| **HN / V2EX** | 找"别人踩过的坑"和最新讨论 | `harvest.mjs` |
| **知乎（已登录）** | 中文长文、深度分析 | 浏览器 + CDP 抓搜索页 |
| **B 站 / YouTube（已登录）** | 视频教程、演讲 | `bili.mjs` / `yt-text.mjs` |
| **自家网页搜索** | 兜底，前面都没结果时 | 内置搜索工具 |

### 三漏斗（别一上来就读全文）

```
① 广撒网：node tools/harvest.mjs "关键词" --top 12
   只拿标题 + 热度 + 链接，几秒钟，不读正文

② 打分：按「能不能直接用于当前任务」砍到 3 条
   标准：有代码/有命令 > 有数据 > 只有观点

③ 深读：只对这 3 条读 README / 跑一遍
   结论写进 LESSONS.md 或 notes/
```

### 输出格式（给用户看的）

1. **结论先行**：一句话说这东西有没有用
2. **3~5 条可执行项**：能抄什么、能跑什么
3. **链接**：原始出处

不要贴一大堆搜索结果，那等于没筛。

### 前置条件

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:HTTP_PROXY='http://127.0.0.1:7890'; $env:NODE_USE_ENV_PROXY='1'
```

- GitHub / HN / npm / arXiv / HF 需要代理（Node 默认不读系统代理，见 L017）
- 知乎需要浏览器已登录（已达成）
- YouTube 需要浏览器已登录 + yt-dlp（见 L016）

### 判断"够不够用"的标准

> 找到的东西**能不能省下我半天**？不能，就继续找，或者直说"没找到值得抄的"。

**禁止**：拿搜索结果当结论交差；没验证就说"这个应该能用"。

## 生产力六条（借鉴自 DSH 插件生态，2026-10-25 立）

来源：B 站《六个插件：给你的大肥鱼DSH装上灵魂》（笔记 `notes\AI技术投降派\2026-10-25-六个插件…md`）。
那六个插件是"陪伴向"的，不装；但里面的**六条工程原则**值得照搬到生产力上。

### ① 半衰期衰减：旧资料自然降权

**原则**：不是"存了就一直算数"，而是按指数衰减。旧的不删，但不再和新的抢位置。

**落地**：`node tools/notes-rank.mjs "关键词"` —— 90 天半衰期检索，一条 90 天前的笔记分值只有今天的一半。

```powershell
node tools/notes-rank.mjs "插件"            # 默认 90 天半衰期
node tools/notes-rank.mjs "PPT" --days 30   # 衰减更快（只看近期）
node tools/notes-rank.mjs "视频" --all      # 展开全部
```

**为什么有效**：笔记越攒越多，普通全文本搜索会把半年前的答案排在新答案前面。

### ② 置信度门槛：不确定就别自动做

**原则**：模型判断"没把握"时，宁可不执行、回退到问人。

**落地**：任何**写操作**（发 GitHub、发评论、改文件）之前先自问——
「我能不能指出具体证据（文件行号 / 返回体字段 / 实测输出）？」
**指不出 = 置信度不足 = 停手问一句**，不要猜着做。

**反面教材**：Inspector 插件白屏两次，都是"猜着改配置"造成的。

### ③ 概率触发 + 本地掷骰：先本地判断，省 Token

**原则**：能用本地规则判掉的事，不要送到模型。

**落地**：
- 检索先 `notes-rank.mjs`（纯本地），命中够了就别再问模型
- 浏览器操作先用 `/api/text` 拿页面文字判断，别整页截图丢给模型
- 图片先 `img-analyze.mjs` 找边界，再决定要不要裁剪

**为什么有效**：视频里那个插件"每 30 分钟 20% 概率"的设计，本质是**绝大部分判断不花钱**。

### ④ 试运行 dry-run：先记录，不执行

**原则**：新自动化上线，先跑"只记录不动作"模式，观察几天。

**落地**：
- 发布类脚本先只打印将要做什么（`--dry-run`），确认无误再真跑
- 给仓库推送前，先 `git status` 等价物：列文件清单 + 大小（本次开源就是先数出 40 文件 / 179 KB 才推）
- 批量生成图片前先跑 1 张，看风格对不对再跑剩下 5 张

**反面教材**：`game` preset 那套背景对比度过高，如果一次生成 6 张就浪费 5 张。

### ⑤ 子代理隔离：长流水线不污染主对话

**原则**：多步骤、要读大量文档的活，交给子代理；主对话只收结论。

**落地**：
```javascript
subagent({ description: '跑 ppt-master 流水线', prompt: '...' })
```
- PPT 的 Default 流水线（7 步、要读十几份规范）→ 子代理跑完只回路径和门禁结果
- B 站批量检索（27 个工具调用）→ 子代理跑完只回摘要

**为什么有效**：视频里"子代理只负责读并返回报告，主 AI 决定要不要评论"，我们今天做 PPT 时用的就是这个模式（4 分 11 秒出片，主对话没被文档淹没）。

### ⑥ 冷却限制：同一动作不连着做

**原则**：刚做过的事，短时间内不再做，避免刷屏/重复请求/账号风险。

**落地**：
- 同一条视频 10 分钟内不重复总结（先去 `notes-rank.mjs` 查有没有笔记）
- 同一个页面不连续截图（等 1.5 秒以上）
- 同一仓库不连续推送（先攒改动再推）

**反面教材**：今天连发三次 `videoSummary`，第三次才想起该先查笔记。

### 一句话用法

> 查资料先 `notes-rank`（①③），动手前问自己有无证据（②），新自动化先 dry-run（④），
> 长流程派子代理（⑤），同一件事不连做（⑥）。

## 用户可能怎么说

| 用户说 | 你应该 |
|---|---|
| “总结这个视频 <链接>” | `POST /api/videoSummary {url}`，把 summary 整理后给他 |
| “先看看有没有字幕” | `POST /api/videoText {url}`，看 source 和 chars |
| “帮我找几个 XX 的视频” | `node tools/bili.mjs search "XX" 10` |
| “让它画一张 XX” | `POST :3099/api/send` → `/api/wait` |
| “看看这个网页” | `/api/open` → `/api/text` |

## 视频笔记（自动归档）

`/api/videoSummary` 每次成功总结后，会自动存一份 Markdown 到：

```
<WORKSPACE>\notes\<UP主>\<日期>-<标题>.md     含 front matter + 总结 + 可折叠原始字幕
<WORKSPACE>\notes\INDEX.md                     自动重写的总索引
```

### 支持两个平台（2026-10-25 起）

| 平台 | 命令 | 说明 |
|---|---|---|
| **B 站** | `POST /api/videoText {url}` | wbi 签名拿字幕，已稳定 |
| **YouTube** | 同上，URL 自动识别 | 走 `yt-fetch.mjs`：导 cookie → yt-dlp 拉字幕 → VTT 转文本 |

```powershell
# 单独拿 YouTube 文本（不总结）
node tools/yt-text.mjs <视频ID或URL>
```

**YouTube 三个前置**（缺一个就失败）：
1. 浏览器已登录 YouTube（cookie 在 `<WORKSPACE>\edge-cgpt` profile 里）
2. `<PPT_MASTER_VENV>\.venv` 里装了 `yt-dlp`
3. 代理 `127.0.0.1:7890`（脚本内部已设）

**已知阻断**：ChatGPT 网页偶尔弹 `cloudflare_challenge`。表现是总结返回空、页面出现「重试」按钮。
处理：到 ChatGPT 标签页**手动点一次重试或完成人机验证**，再重新跑。

命令行：

```powershell
node tools/notes.mjs list                 # 列出全部笔记
node tools/notes.mjs search 关键词         # 全文搜索（标题/UP/正文）
node tools/notes.mjs index                # 手动重建索引
```

用户问「我之前总结过哪些视频」「找找关于 X 的笔记」时，先跑 `node tools/notes.mjs search X`。

## 短剧提示词（一句话 → 可出片的提示词包）

模板在 `<OUT>\短剧提示词包-demo-雨夜天台.md`（照抄第 0 节的 7 步公式即可换题材）：

```
一句话想法 → ① 主角锚点 ② 环境 ③ 镜头 ④ 风格 ⑤ 质感 ⑥ 负向 ⑦ 拆分镜
```

产出六件套：**角色锚点 / 人设图提示词 / 三视图提示词 / 场景提示词 / 分镜表 / 参数建议**。

三个必踩的坑（来自 net懒人小剧场 那期 BV1n2nA6cENa）：

1. 开源三视图工作流的固定提示词默认是「**真人风格**」，做动漫必须显式改，否则出来还是真人。
2. 插件/工作流必须**预留 LoRA 槽位**（至少 2 个），打击感、天气、胶片质感全靠它。
3. 分镜要满足「**上一镜末帧 = 下一镜首帧**」，别指望一条提示词出 15 秒。

出图走 ChatGPT：`gpt_send` → `gpt_wait_image outPath`。

## 本地出视频（已装好，2026-10-25）

| 东西 | 位置 |
|---|---|
| ComfyUI | `D:\ComfyUI`（venv 里 torch 2.11.0+cu128，RTX 5060 8GB 可用） |
| 启动 | `D:\ComfyUI\venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188 --lowvram` |
| 模型 | `models/checkpoints/ltxv-2b-0.9.8-distilled-fp8.safetensors`（默认）+ `ltxv-2b-0.9.6-dev.safetensors`（实验用）+ `animagine-xl-4.0-opt.safetensors`（出图） |
| 工作流 | `out/workflows/ltx-t2v-api.json`、`ltx-i2v-api.json`、`wan5b-ti2v-gguf.json`、`sdxl-t2i-api.json` |
| 客户端 | `node tools/comfy.mjs status|queue|run --workflow ... --out ...` |
| ffmpeg | `D:\tools\ffmpeg\bin\ffmpeg.exe`（7.1，拼接/抽帧用） |

### Wan2.2 TI2V-5B（GGUF Q4，慢但稳）

| 文件 | 位置 | 大小 |
|---|---|---|
| `Wan2.2-TI2V-5B-Q4_K_M.gguf` | `models/unet/` | 3.2 GB |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` | 6.4 GB |
| `wan2.2_vae.safetensors` | `models/vae/` | 1.3 GB |

需要自定义节点 `custom_nodes/ComfyUI-GGUF` + `pip install gguf`（已装）。

```powershell
node tools/comfy.mjs run --workflow out/workflows/wan5b-ti2v-gguf.json --out out/wan.mp4 ^
  --set "55.width=480" --set "55.height=832" --set "55.length=49" ^
  --set "3.steps=20" --set "3.cfg=5" --set "6.text=英文提示词"
```

实测：480×832、49 帧（2 秒）、20 步 → **约 110 秒**（5.4 s/it）。比 LTX 慢约 9 倍，但人物/构图明显更稳。
I2V 只需给 `Wan22ImageToVideoLatent` 加 `start_image`（LoadImage）——下一步接。

实测：640×384、73 帧（约 3 秒）、8 步蒸馏 → **18 秒出片**。

### 本地出图（资产：角色 / 场景）

模型 `animagine-xl-4.0-opt.safetensors`（动漫 SDXL），832×1216 约 **30 秒/张**。

```powershell
node tools/comfy.mjs run --workflow out/workflows/sdxl-t2i-api.json --out out/asset-char.png ^
  --set "4.ckpt_name=animagine-xl-4.0-opt.safetensors" ^
  --set "6.text=1girl, solo, long black hair, white hoodie, holding clear umbrella, rainy rooftop at night, cinematic lighting, anime movie still, masterpiece" ^
  --set "3.steps=28" --set "3.cfg=6"
```

**做锚点图的经验**：不要用白底立绘做 `--anchor`（白底会被带进画面），要出**场景内**的角色参考图（同一灯光、同一环境），一致性明显更好。

### 两个出片引擎（`--engine`）

```powershell
node tools/shortdrama.mjs --engine ltx --plan ... --out a.mp4     # 默认：快
node tools/shortdrama.mjs --engine wan --plan ... --out b.mp4 --width 832 --height 480   # 稳但慢
```

| 引擎 | 2 秒单镜耗时 | 一致性 | 风格 |
|---|---|---|---|
| `ltx`（0.9.8 distilled 8 步） | **12~18 秒** | 弱，换景别就崩 | 干净、偏 2D |
| `wan`（2.2 TI2V-5B Q4，20 步） | **3.5~4 分钟** | 明显更强，场景光位能锁住 | 厚涂感、色彩浓 |

实测（3 镜 × 2 秒）：LTX 约 50 秒出片；Wan 约 12 分钟出片。Wan 在换视角时人物仍会变（背面 → 侧面），但场景、光线、画风是连贯的。

```powershell
node tools/comfy.mjs run --workflow out/workflows/ltx-t2v-api.json --out out/a.mp4 ^
  --set "6.text=英文提示词" --set "70.width=640" --set "70.height=384" --set "70.length=73" ^
  --set "71.steps=8" --set "72.cfg=1"
```

界面格式 → API 格式：`node out/setup/convert-workflow.mjs <ui.json> <api.json>`（借浏览器里的 app.graphToPrompt()）。

### 图生视频（尾帧接首帧）

```powershell
# 1) 抽上一镜最后一帧，放进 ComfyUI 的 input 目录
ffmpeg -sseof -0.2 -i out/shot1.mp4 -update 1 D:\ComfyUI\input\shot1_last.png -y
# 2) 用这张图当首帧生成下一镜
node tools/comfy.mjs run --workflow out/workflows/ltx-i2v-api.json --out out/shot2.mp4 ^
  --set "44.ckpt_name=ltxv-2b-0.9.8-distilled-fp8.safetensors" ^
  --set "38.clip_name=t5xxl_fp8_e4m3fn.safetensors" ^
  --set "71.steps=8" --set "72.cfg=1" ^
  --set "77.width=640" --set "77.height=384" --set "77.length=73" ^
  --set "78.image=shot1_last.png" --set "6.text=英文提示词"
```

### 一句话出片（整条流水线）

```powershell
# plan.json: { "title": "...", "shots": [ { "prompt": "...", "seconds": 2 }, ... ] }
node tools/shortdrama.mjs --plan out/plan-rainy.json --out out/film.mp4 --grade film
node tools/shortdrama.mjs --plan ... --anchor "<ART>\shortdrama\01-character.png"   # 角色锚点模式
```

实测：5 镜 × 2 秒，**62 秒**出片（含拼接调色）。`--anchor` 让每一镜都用同一张角色图做 I2V 条件。

**实测结论（2026-10-25）**：LTX 2B 蒸馏 8 步模型的一致性不够——逐镜接尾帧会累积漂移（第 2~3 镜就换人），用角色锚点也只稳前 2 镜，且会把角色图的白底带进画面。要真正锁人物，需要非蒸馏 LTX（25~30 步）或支持多参考图的 I2V（Wan2.2 / MiniMax H3）。

**A/B 实测（同组分镜，2026-10-25）**：

| 配置 | 结果 |
|---|---|
| `ltxv-2b-0.9.8-distilled-fp8` 8 步 / cfg 1 | 画面明亮、构图稳定，本次一致性最好；偶发在角落生成「西瓜视频」类水印（训练数据残留），negative 里要加 `watermark` |
| `ltxv-2b-0.9.6-dev` 28 步 / cfg 4 | **更暗、成剪影**，主体丢失，反而更差 —— 不能直接替换，需要重调 cfg/scheduler |
| 命令 | `node tools/abtest.mjs --plan out/plan-rainy-short.json --out out/ab` |

结论：**默认仍用蒸馏版**；dev 版权重（`ltxv-2b-0.9.6-dev.safetensors`，5.91 GB）先留着做实验，调参方向是 cfg 降到 2.5~3、`LTXVScheduler` 的 max_shift 提高，并在 negative 里补 `dark, silhouette, underexposed`。

### 别让模型转头（coverage 切镜）

「转头/转身」用 I2V 生成必崩——模型要给没拍到的半张脸脑补。**改成切镜**：

```json
{ "seconds": 2, "prompt": "她正面站着，撑伞", "cutTo": "同一场景，侧面中景，她已经转向左侧低头看" }
```

或者更省事，写 `{ "seconds": 2, "prompt": "... turns her head ...", "turn": "left" }`，脚本会自动补后半镜。
提示词里出现 turn/rotate/walk away 但没给切镜方案时，脚本会打警告。

实测（2026-10-25）：切镜能消除「脸在画面里旋转」的崩坏，但**每个新镜头都是独立重新生成**，人物仍会变——切镜解决的是动作崩，不解决跨镜一致性。跨镜一致性只能靠多参考图模型（MiniMax H3 / 可灵）或一镜到底。

### 拼接 + 去廉价感（胶片感后期）

```powershell
node tools/stitch.mjs --in "out/shot1.mp4,out/shot2.mp4,out/shot3.mp4" --out out/final.mp4 --grade film
node tools/stitch.mjs --sheet out/final.mp4 --cols 4 --rows 2     # 抽帧检查表
```

`--grade` 可选 `film`（颗粒+暗角+轻调色）/ `cinema`（冷调压高光）/ `plain` / `none`。
来自 WorkFisher 的经验：资产和成片「没阴影、很平、没滤镜」= 廉价感，所以这一步不能省。

### 流程原则（来自 BV197pS6WEoq）

1. **只用官方模型**，不叠融合模型、不堆 LoRA（会显著降低提示词遵循度）；加速/步数蒸馏类可以留。
2. **资产先行**：角色图 → 放大 → 三视图 → 场景图（要有滤镜感），再去做视频。
3. **单镜 3~4 秒**，靠「尾帧接首帧」接戏；跨场景直接切。
4. 参考图不超过 6 张。

## 已开源的仓库

| 仓库 | 内容 |
|---|---|
| [user-ShuYun/dsh-toolkit](https://github.com/user-ShuYun/dsh-toolkit) | 本文件里的工具集 + 背景纹样词典 + PPT 三合一规程 + 示例 deck（v1.0.0，MIT） |
| [user-ShuYun/permian-apex](https://github.com/user-ShuYun/permian-apex) | 二叠纪大鱼吃小鱼（Phaser 3 游戏，105 文件） |
| [user-ShuYun/dsh-tool-gpt-driver](https://github.com/user-ShuYun/dsh-tool-gpt-driver) | GPT 驱动插件（5 个工具） |

本地源码在 `<WORKSPACE>\gh\dsh-toolkit\`，发布脚本 `tools/gh-init-repo.mjs`（走 Git Data API）。

**发布踩的坑**：新建的空仓库不能直接建 blob（`409 Git Repository is empty`）。必须先用 Contents API 落一个占位 README 激活，之后才能用 Git Data API 批量推、并用 `parents: [占位 commit]` 提交。

## PPT：三合一（**默认流程**，2026-10-25 用户定稿）

> 用户原话：「以后默认采用 3 合 1」「这种混合使用的效果很不错」。
> 三合一 = **Default 打底**（规格+动画） + **手绘 3 页**（视觉爆点） + **电影级 MP4**（开场/循环）。

### 六步，照抄即可

```powershell
$py = '<PPT_MASTER_VENV>\.venv\Scripts\python.exe'
$sk = '<PPT_MASTER_REPO>\skills\ppt-master\scripts'
$proj = '<WORKSPACE>\projects\<项目名>'

# ① 打底：走 Default 流水线（SKILL.md → routing.md → generate-pptx.md）
#    产出 $proj\svg_output\*.svg + spec_lock.md + design_spec.md

# ② 手绘 3 页：直接在 svg_output\ 里覆盖对应页（封面/结构/数字/链路 挑 3 个）
#    用新字号/新色 → 先在 spec_lock.md 的 ## typography 里加一行声明

# ③ 门禁（必跑，导出时读它写的报告）
& $py "$sk\svg_quality_checker.py" $proj --stage final --json

# ④ 导出 PPT（Morph 转场 + 逐元素淡入）
& $py "$sk\svg_to_pptx.py" $proj -t morph -a entrance_fade --transition-duration 0.8 `
  -o "$proj\exports\<名>-final.pptx"

# ⑤ 自播放版（展台/循环，每页 8 秒）
& $py "$sk\svg_to_pptx.py" $proj -t morph -a entrance_fade --transition-duration 0.8 `
  --auto-advance 8 --kiosk -o "$proj\exports\<名>-kiosk.pptx"

# ⑥ 电影级 MP4（按 1280x720 原生尺寸渲染，再推镜+溶解）
node tools\svg2png.mjs "$proj\svg_output" "<OUT>\cine-frames" 1280 720
node tools\cine.mjs "<OUT>\cine-frames" "<OUT>\<名>-cine.mp4" 4 0.8
```

### 手绘页怎么挑（这是"高级感"的关键）

| 页类型 | 该做成什么 | 参考 |
|---|---|---|
| 结构页 | **阶梯/长度递减的块**，表达层级或分量 | 三个 01/02/03 块逐级变短 |
| 数字页 | **一个巨型数字当主角**（200px 渐变），其余退成小账本 | 2789 + 右侧四行细目 |
| 链路页 | **胶片条 / 时间轴**，带刻度 | 五格 + 0/5/12/30/60s 刻度 |
| 封面 | 交给 Default（GPT 全幅图），别手绘 | — |

节奏原则：**一静、一动、一爆、一整、一收**。

### 四条硬规矩（都实测踩过）

1. **新字号必须先声明**：门禁原话 `undeclared font-size 64 (3 occurrences) exceeds the sparse-display limit of 2`。修法：`spec_lock.md` 的 `## typography` 加一行 `- index: 64` / `- mega: 200`。
2. **`data-pptx-bounds` 按"实际外框"写**：200px 的字，外框是 `baseline-170 ~ baseline+70`（240 高），不是 200。模块间**重叠 0px 才行**（4px 就报错）。
3. **背景图/遮罩必须在根级**，带 `id` + `data-pptx-role="background"`；放进 `<g>` 会被拒（根级模块也不能互相重叠）。
4. **`xfade` 要求恒定帧率**：`trim + setpts` 后 fps 变 `1/0`，每条分支末尾必须补 `fps=25,setsar=1`。
5. **新增图片必须三处同时登记**，少一处就报 `illustration_*` 错：
   ① 文件放进 `<project>\images\` ② `design_spec.md` 的 §VIII 表格加一行 ③ `spec_lock.md` 的 `## images` 加一行。
   表格行必须**连续**（中间有空行，解析器就当表格断了，认不出这行）。
   旧图不再使用 → 从 §VIII 和 lock 里**都**删掉，只删一处会报 `planned_image_missing_lock`。

### 每页一张背景（2026-10-25 新增，效果明显更好）

别再让 4 个内页共用一张纹理。按页面功能各画一张，**色相/对比度必须一致**，只换纹样。

**已做成可复用词典**：`<ART>\backgrounds\presets.json`（说明在同目录 `README.md`）

六个题材 preset，每个含 6 种页型（cover/structure/numbers/entries/chain/ending）：

| preset | 题材 | 基色 |
|---|---|---|
| `tech` | 科技 / 工具 / 产品 | 深青黑 #061A24 |
| `humanities` | 人文 / 历史 / 文学 | 暖米白 #F4EDE1 |
| `game` | 游戏 / 影视 / 幻想 | 深紫蓝 #0B0F1A |
| `business` | 商业 / 汇报 / 咨询 | 冷灰白 #F5F7F9 |
| `academic` | 学术 / 教学 / 论文 | 米白 #FAF7F1 |
| `nature` | 自然 / 生物 / 地理 | 深墨绿 #0C1F1A |

```powershell
node tools/gen-bgs.mjs --list                                   # 看词典
node tools/gen-bgs.mjs --preset game --out <ART>\bg-game --prefix game
node tools/gen-bgs.mjs --preset business --out ... --pages cover,numbers   # 只出需要的页
```

**注意**：
- 深色 preset（tech/game/nature）配浅字主题；浅色 preset（humanities/business/academic）配深字主题，**不能混用**
- `game` 这类戏剧化 preset 对比度高，叠字前要把 scrim 加深到 0.55~0.65（tech 用 0.42~0.45 就够）
- 生成后仍要走「三处登记」（上一条硬规矩 5）

### 时间账（5 页实测）

| 阶段 | 耗时 |
|---|---|
| Default 打底 | 4 分 11 秒 |
| 手绘 3 页 | 13 分钟（含门禁返工） |
| 门禁 + 导出 2 版 | 2 分钟 |
| 电影级 MP4 | 3 分钟 |
| **合计** | **约 22 分钟** |

### 成品参考

- PPT：`<PROJECT>\exports\dsh-toolbox-final.pptx`
- 自播放：`...\exports\dsh-toolbox-kiosk.pptx`
- 短片：`<OUT>\dshtoolbox-cine.mp4`（5.1 MB，16.8 秒，1920×1080）
- 帧图：`<OUT>\cine-frames\*.png`

### 用户怎么说

| 用户说 | 你走 |
|---|---|
| "做个 PPT"（没说别的） | **三合一**（默认） |
| "先出个大概 / 只要 PPT" | 只做 ①②③④，跳过 ⑤⑥ |
| "要能动 / 要能发人看" | 加 ⑥（MP4） |
| "版式全部我自己定" | Quick 手写全篇（20~40 分钟） |

## PPT：本机唯一路线 = ppt-master（开源 MIT）

> ⚠️ 2026-10-25 起 **pptwise 插件已卸载**（用户对效果不满意）。不要再提 pptwise、不要再调 `pptwise_*` 工具、不要再写 `.pptwise/decks`。
> `<WORKSPACE>\.pptwise` 目录已清空，`tools\deck-maker.mjs` 已作废（保留文件但别用）。

PPT 只走 **ppt-master**（GitHub 6.7 万星，MIT）：**逐元素动画、50+ 转场（含 Morph）、旁白、导出 MP4**，出的是原生可编辑 .pptx。

| 东西 | 位置 |
|---|---|
| 仓库 | `<PPT_MASTER_REPO>`（**完整**解压，13111 文件） |
| 技能入口 | `<PPT_MASTER_REPO>\skills\ppt-master\SKILL.md` |
| Python | `<PPT_MASTER_VENV>\.venv\Scripts\python.exe`（3.12，依赖齐全；`ppt-master` 目录里只剩这个 venv） |
| 已出成品 | `<WORKSPACE>\projects\dsh-toolbox_20261025\exports\dsh-toolbox_20261025_121710.pptx`（5 页，Morph + 逐元素淡入） |

## PPT：混合做法的细节（已被上面的三合一取代，保留作参考）

> 用户原话：「这种混合使用的效果很不错，以后我要生成 PPT，默认就是这种了。」

**混合 = Default 打底 + 挑 1~3 页手绘**。既拿到锁定规格（色板/字阶/节奏/动画），又能在视觉重点页做自由构图。

```
① 跑 Default 流水线出全篇（4~8 分钟）→ 得到 spec_lock.md + svg_output/*.svg
② 挑“视觉重点页”（结构页 / 数字页 / 封面）手绘替换（每页 +4 分钟）
③ 手绘页若用新字号/新色 → 先在 spec_lock.md 里声明角色（否则门禁拒绝）
④ 一起过 svg_quality_checker（--stage final --json）
⑤ 一起导出：-t morph -a entrance_fade --transition-duration 0.8
```

**实测**：5 页 + 手绘 2 页 ≈ 12 分钟；产物 `<PROJECT>\exports\dsh-toolbox-hybrid-v2.pptx`。

### 手绘页的两条硬规矩（都实测踩过）

1. **新字号必须先声明**。门禁原话：`undeclared font-size 64 (3 occurrences) exceeds the sparse-display limit of 2`。
   修法：`spec_lock.md` 的 `## typography` 里加一行，如 `- index: 64`、`- mega: 200`。
2. **`data-pptx-bounds` 要按“实际外框”写，不是按“看起来的框”**。
   200px 的巨型数字，视觉上占 200 高，实际外框是 `baseline-170 ~ baseline+70`（240 高）。
   门禁会精确算出溢出百分比并给出 `≈111.8 px per Latin char at 200px` 这类换算，按它调。
   模块之间**不能有任何重叠**（重叠 4px 就报错），贴着（0px）可以。

### 用户怎么说

| 用户说 | 你走 |
|---|---|
| “做个 PPT”（没说别的） | **混合**（默认） |
| “要动画 / 带特效” | 混合 + 逐元素动画编排 |
| “先出个大概 / 别花时间” | 只跑 Default，不手绘 |
| “版式全部我自己定” | Quick 手写全篇（20~40 分钟） |

## PPT：另外两条路线（备用，按需）

| 路线 | 用途 | 状态 |
|---|---|---|
| **Create Template** | 从现成 pptx/网站/品牌素材抽模板，之后所有 PPT 统一风格 | 未实测 |
| **Edit Native PPTX** | 拿现成 pptx 只换内容/加动画，保留原设计 | 未实测 |

## PPT：特效档（ppt-master，开源 MIT）

除了两档，本机还装了 **ppt-master**，它能做「高级」做不到的事：**逐元素动画编排、旁白、导出 MP4**。

| 东西 | 位置 |
|---|---|
| 仓库 | `<PPT_MASTER_REPO>`（**完整**解压，13111 文件；`ppt-master` 那个是早期残缺版，别用） |
| 技能 | `<PPT_MASTER_REPO>\skills\ppt-master\SKILL.md` |
| Python | `<PPT_MASTER_VENV>\.venv\Scripts\python.exe`（3.12，依赖齐全） |
| 已有成品 | `ppt-master2\projects\demo-motion2_20261025\dsh-toolbox-motion.pptx`（3 页：GPT 背景 + Morph + 淡入） |

**手写 SVG 快路（已验证可行）**：

```powershell
$py = '<PPT_MASTER_VENV>\.venv\Scripts\python.exe'
$sk = '<PPT_MASTER_REPO>\skills\ppt-master\scripts'
# 1) 写页面到 <project>\svg_output\*.svg
# 2) 质量门禁（必须先跑，导出时读它的报告）
& $py "$sk\svg_quality_checker.py" <project> --quick-generate --canonical-authoring --stage final --json
# 3) 导出（带转场 + 元素动画）
& $py "$sk\svg_to_pptx.py" <project> --quick-generate -t morph -a entrance_fade --transition-duration 0.8 -o "<project>\out.pptx"
```

**SVG 三条硬门禁**（我踩过，不满足直接拒绝导出）：

1. 每个根级 `<g>` 必须有 `data-pptx-bounds="x y w h"`，且**互不重叠**
2. 背景图/遮罩**不能放进 `<g>`**——必须在根级，带 `id` + `data-pptx-role="background"`
3. 根 `<svg>` 要有 `lang="zh-CN"`；字体建议在根上写一次 `font-family`

**完整 Default 流水线（7 步，含强制 Strategist 规划）**：入口是 `SKILL.md` → `workflows/routing.md` → `workflows/generate-pptx.md`。适合“要最高质量、可以等十几分钟”的场合。

实测：**5 页 / 4 分 11 秒 / 0 errors**，产物 `<WORKSPACE>\projects\dsh-toolbox_20261025\exports\*.pptx`。

### Default 流水线的坑（实测，照抄即可避开）

1. **图片状态枚举是 `Existing`**，不是 `Ready`；`project_manager validate` 不校验 §VIII，写错不报错，直到导出才暴露。
2. **`svg_editor --live --daemon` 成功时 stdout 为空**，端口在 `live_preview/lock.json`（`{"pid":…,"port":6060}`）和 stderr 的 `[INFO]` 里；`--daemon` 还会自动开浏览器。
3. **等宽数字要在 lock 里声明 family 角色**（`display_family` / `hero_num_family`），否则 `text_measure.py calibrate` 报 `role display has no display_family`。
4. **根 `<svg fill>` 稳定产 advisory warning**；想清零就把默认 fill 下沉到各 `<g>`，或跑 `compact_svg_styles.py --inplace` 后重跑 gate。
5. **`data-pptx-bounds` 要按“文字实际外框并集”写**；居中文本（`text-anchor="middle"`）很容易超右边界 8px 就判溢出——**放宽 bounds，别缩字号**。
6. **`svg_to_pptx.py --help` 输出极大**（枚举打印两遍，几百行），必须过滤，否则吃上下文。
7. **`-t` 与 `-a` 是两件事**：`-t morph` 写 `<p:transition>`，`-a entrance_fade` 写 `<p:timing>` 逐元素；`--transition-duration 0.8` 落成 `p14:dur="800"`（毫秒）。
8. **`project_manager init` 不锁画布**，画布要落到 `design_spec §II` + `spec_lock.md viewBox` 才算数。
9. **GBK 控制台打印中文会乱码**，文件本身没问题，别据此判断编码坏了。
10. 页数 ≤6 时 early gate 整个跳过，只跑一次 final gate；`--json` 写报告，stdout 保持摘要。

## 经验系统的四个维护命令（2026-10-25 起）

```powershell
node tools/preflight.mjs            # 开工一条命令：环境体检 + 经验库 + 标签分布
node tools/reflect.mjs --index      # 全库目录（只标题，约 1.2 KB）
node tools/audit.mjs                # 体检：重复 / 陈货 / 超期草稿 / 体积 / 计分是否在用
node tools/brief.mjs --write        # 重新生成 AGENTS.md 里「最值钱的几条」
node tools/research.mjs "关键词"     # 调研草稿：本地笔记 + B 站，全网部分留给 Agent
```

- `brief.mjs` 的排序：命中×5 + 新鲜度 + 标签稀有度；**只挑有命中记录的**，不拿 0 命中凑数
- `research.mjs` 需要 9222 的浏览器才查 B 站；网页检索 CLI 做不了，会写 TODO 给 Agent

---

## 记忆工具链（2026-10-25 重做）

四库分工 + 三个入口，全部靠 Node 脚本，不依赖插件：

```powershell
# 开工（一条命令拿全量：环境/经验/记忆库/现在.md/渠道）
node tools/preflight.mjs

# 召回：任务开始时 / 改关键文件前 / 工具报错后
node tools/memo.mjs recall "这次任务一句话"

# 召回：计划阶段按"动作类型"召回（2026-10-26 加，比关键词可靠）
node tools/recall.mjs --event plan --text "今天要做的事一句话"   # 自动识别 install/longflow/multifile/publish/research/ps
node tools/recall.mjs --event install       # 装卸插件
node tools/recall.mjs --event multifile --n 7   # 一次改多个文件
node tools/recall.mjs --event longflow      # 多步流水线
node tools/recall.mjs --event publish       # 开源/推送
node tools/recall.mjs --event ps            # 写 PowerShell
node tools/recall.mjs --event edit  --file tools/xxx.mjs
node tools/recall.mjs --event error --text "报错原文"

# 写：四库分开，生命周期不同
node tools/memo.mjs add --kind correction --title "..." --scene "..." --wrong "..." --right "..." --evidence "..."
node tools/memo.mjs add --kind preference  --title "..." --pref "..." --trigger "..." --source "..."
node tools/memo.mjs add --kind playbook    --title "..." --goal "..." --steps "..." --when "..." --result "..."
node tools/memo.mjs hit L015            # 任意库的 ID 都能记账

# 会话考古（多帧 zstd 解析，114 个会话 3 秒建索引）
node tools/sessions.mjs index [--rebuild]
node tools/sessions.mjs recent 5        # 最近在干什么
node tools/sessions.mjs hits            # 我真正引用过哪些经验（未记账的给命令）
node tools/sessions.mjs search "关键词"

# 收工
node tools/state.mjs --write --next "下一步动作"   # 写 notes/现在.md
```

### 用法上的硬规矩

- **召回在看代码之前**：`recall --event edit` 会直接命中 L015/L041 这类"改插件必踩"的条目
- **hits 只统计 assistant 消息**，且一条消息里列 ≥5 个 ID 视为"罗列目录"，不算引用
- **sessions.mjs 解析多帧**：Node 的 `zstdDecompressSync` 只解第一帧（只有 267 字节的 session 头），
  必须扫 `28b52ffd` 帧头逐帧解压再拼接
- **harvest 四渠道**：`--sources github,hn,bili,zhihu,youtube`，结果落 `out/harvest/*.json|.md`，7 天缓存
- **录经验优先用 `--json`**：`node tools/learn.mjs add --json out/lesson.json`（JSON 用 write 工具写，脚本会去 BOM）。
  PowerShell 直传中文参数会把 `$`、双引号、反斜杠吃掉 —— 2026-10-26 实测把 L053/L054/L056/L057 记成了半截，只好回头修
- **`learn.mjs top N` 不是全库**（L037）：它按命中+衰减排序取前 N，命中全零时退化成编号升序，看着像全集。
  要总数就数 `## [L` 标题（`$t = Get-Content LESSONS.md -Raw -Encoding UTF8; ([regex]::Matches($t,'(?m)^## \[L\d+\]')).Count`）
- **文档提醒不如一条命令**（L038）：开工三件事已压成 `preflight.mjs`，别指望自己记住清单

### 插件改动规程（2026-10-26 从 L015/L041/L050/L051/L052 归纳）

改任何 DSH 插件前，按这个顺序，不要跳：

1. **先确认加载方式**：`file:` 依赖（profile 里是拷贝，要双写）还是 `file://` overlay（用 patch 挂）
2. **改完先过语法/注入校验**：`new Function(注入脚本)`；模板字符串里的 `\n` 要写成 `\\n`
3. **依赖解析不要硬拼路径**：用 `createRequire(profile/package.json).resolve(...)`
4. **确认何时生效**：已装插件的**代码改动**要重启；`cordis.patch.yml` 的**增删**走热加载
5. **绝不在回合进行中改 patch**：热加载会把 agent 的 phase 重置，当轮直接报 `Cannot read properties of undefined (reading 'kind')`
6. **改完必须看这两样，别只看配置文件**：`apply()` 第一行写心跳（append 到 `out/<插件>.log`），再注册一个免鉴权自检路由
   （如 `/prompt-button/health` 返回预设清单，首页要登录、自定义路由不用）。两者都没有 = **根本没重载**，只能重启 dsh web
   （会话持久化，不丢）。`patchReload: live` 不可靠——2026-10-26 实测同一个文件 09:05 生效、10:12 之后改了毫无反应（见 L061）

### 自动召回插件的装 / 卸 / 影子评估（2026-10-26 加）

插件在 `plugins/auto-recall/index.js`。**2026-10-26 09:05 已按影子模式装上**（加载日志 `plugin loaded v2.1 (shadow=true)`，
只写日志、不注入消息）；积累够真实回合再用 `--inject` 解锁。装卸一律走脚本，别手改 YAML：

```powershell
node tools/recall-arm.mjs status      # 装没装、是不是影子、最近 5 行日志
node tools/recall-arm.mjs arm         # 插入条目（默认影子：只写日志，不注入）
node tools/recall-arm.mjs --inject    # 只翻开关：允许真的塞消息
node tools/recall-arm.mjs --shadow    # 翻回影子
node tools/recall-arm.mjs disarm      # 摘掉条目
```

- **默认影子**：只有 `out/recall/inject.on` 存在时才注入，否则日志里是 `SHADOW L051,L015 [9/b2]` 这种行
- **装卸脚本只在回合之间跑**（L051）；脚本每次改动前自动备份成 `cordis.patch.yml.bak-arm-<时间戳>`
- **准确率尺子**：`node tools/recall-eval.mjs [--show|--replay]` —— 20 条用例（10 条来自 2026-10-25 真机日志 + 10 条跨领域留出集），有漏/噪音时退出码 1
- 解锁注入的前提：影子日志里连续若干回合没有明显误报，且 eval 保持干净（当前 20/20）

### 回合台账 ledger.mjs（2026-10-26 新增）

**解决的漏洞**：证据只活在上下文里，会话一关就没了；而"该复盘了"没有任何东西提醒。
DSH 已经把每个回合的事件落盘（`turn/start · step/start · tool/call · tool/result · turn/end`），
所以台账**纯离线读文件**，不需要插件、不改 patch、不需要 DSH 开着。

```powershell
node tools/ledger.mjs                 # 增量重建 → out/ledger/YYYY-MM-DD.jsonl
node tools/ledger.mjs pending         # 还没提炼的回合（preflight 里那行就是它）
node tools/ledger.mjs show 8          # 人肉看最近 8 个回合
node tools/ledger.mjs distill         # 提炼包 → out/ledger/distill-<时间>.md（默认只装最近 40 个）
node tools/ledger.mjs done <key|--all|--before 2026-10-26>   # 标记已提炼
node tools/ledger.mjs hits --recount  # 重算命中 = 去重会话数 + 手工加分
node tools/ledger.mjs hits --manual L036   # 手工加分（日志里看不出的"这条救了我"）
```

每回合抽六件事：**用户原话 / 触及的文件 / 失败命令和 exit code / 引用过的 L0xx / 步数 / 耗时**（另存推理字数）。

三个实现上的坑（都已踩过）：

1. **事件流要按 `seq` 排序**：多帧 zstd 拼接后顺序不保证 —— 不排序时"我最后说了什么"取到的是中途旁白
2. **`assistant/message.content` 是 `[{type:'reasoning'},{type:'text'}]` 混排**：可见答案只在 `text` 里，全部拼起来会拿到过程
3. **同一会话可能有多份 `.zstd`（检查点）**：按 `session#turn` 去重，否则总数会多出 20 多个

**命中语义变了**（`hits --recount`）：命中 = **引用过这条的去重会话数 + 手工加分**。
原来是手敲 `memo.mjs hit` +1，结果是 53 条里 41 条全零、计分形同虚设；
现在由会话日志自动算，`brief.mjs` 的「命中×3」才真的在排。
注意：**`memo.mjs hit` 的加分会被下一次 `--recount` 覆盖**；想留住的加分改用
`node tools/ledger.mjs hits --manual L0xx`（记在 `out/ledger/manual-hits.json`，重算时相加）。
同一条消息列 ≥5 个 ID 视为"罗列目录"，不算引用（沿用 L049 的规则）。

**比条数先确认口径**（L063，2026-10-26 踩过）：`learn.mjs stats` 和 `audit.mjs` 只扫 `LESSONS.md`；
`ledger.mjs hits --recount` 扫的是**四库合计**（L+C+P+B）。两者差值应刚好等于 C+P+B 的条数，对不上才是 bug。

**三处降噪（都是 2026-10-26 用出来的）**：

1. **只收我自己的回合**：记录带 `origin`（user/subagent）。子代理的回合不进"待提炼"队列——
   606 个回合里 231 个是子代理的，混进来会把我的复盘清单淹掉
2. **疑似假失败单独分节**：`Select-Object -First N` 断管会让成功命令带 `exit=1`（L058）。
   判据 = 命令里有 `Select-Object -First`，或完整输出很长却没有任何错误关键词；提炼包里单列一节
3. **`?` 标记**：`触及` 里的路径带 `?` = 当时从命令里抓到的字符串，现在盘上没有（临时文件或抓歪了）。
   这是启发式路径，不是精确 diff——判断"改了什么"仍要 `git diff` / 文件 mtime

**提炼包只装最近 40 个**：包顶部会写明"另有 N 个更早的没装"，并给出 `--last <N>` 的命令。

**判断失误信号（2026-10-26 加，提炼包第三节）**——exit code 只抓得到"命令失败"，
抓不到"我判断错了"。所以从会话里另抓三类：

| 信号 | 抓什么 | 怎么用 |
|---|---|---|
| 用户纠正 | 短消息（≤200 字）里带「不对 / 我说的是 / 怎么不 / 搞错 / 重新做」 | 可能该进 `CORRECTIONS.md` |
| 自我否定 | 我的文字里出现「其实不对 / 等等，/ 我说错了 / 推翻 / 刚才那个不对」 | 第一个判断错在哪 |
| 撞墙重试 | 同一条命令跑 ≥2 次**且其中一次失败** | 当时缺的是哪条经验 |

实测过滤后：376 个我的回合里 48 个带信号（用户纠正 6 / 重试 54 / 自我否定 22）。
只按次数算重试会有 260 条噪声（preflight、Get-Date 正常会跑好几遍），所以必须叠"失败过"这个条件。

### 影子召回的计分板（2026-10-26 加）

```powershell
node tools/recall-score.mjs             # 最近 7 天：命中率 / 用上了多少 / 白喊多少 / 漏了多少
node tools/recall-score.mjs --days 3 --json
```

口径（写在脚本头里，别改口）：**用上了** = 命中的 ID 出现在同回合我的引用里；
**白喊** = 命中了但同回合没引用（不等于错，只等于没证据）；**漏了** = 没命中但该回合确实引用了经验。
影子行（`SHADOW`）和老式注入行（`INJECT`）分开统计——后者是修打分器之前的数据，只作对照。

**样本 < 20 个回合时百分比没意义**，这是设计给"跑 3~5 天之后看"的。

### 自动维护与计划任务（2026-10-26 加固）

```powershell
node tools/maintain.mjs --dry         # 预演，不写文件
powershell -File tools/maintain-daily.ps1   # 手动跑一次真维护（计划任务跑的就是它）
Get-ScheduledTaskInfo -TaskName 'DSH-Agent-Maintain' | fl LastRunTime,LastTaskResult,NextRunTime
```

任务 `DSH-Agent-Maintain` 跑五件事：① 体检 ② 超期草稿**归档**（不删）③ 会话索引 + 台账 ④ brief 简报 ⑤ 日报。

| 加固点 | 改前 | 改后 | 为什么 |
|---|---|---|---|
| 错过补跑 | `StartWhenAvailable=False` | `True` | 关机/睡眠错过 09:30 就永久没了 |
| 电池 | 禁止启动 | 允许 | 笔记本用电池时维护悄悄停摆 |
| 触发 | 只有每天 09:30 | + 一个「登录时」 | 断档几天后一登录就补上 |
| 草稿 | `--fix` 真删 | 归档到 `notes/日志/草稿归档/<日期>.md` | 没人看的时候不许让坑蒸发 |
| 日报 | 只列成功/失败数 | + 断档天数 + 待提炼回合 + **空流水时明说"不代表一切正常"** | 空白不能被读成健康 |
| 日志编码 | 中文全乱码 | node 自己 `fs.appendFileSync` 写 UTF-8 | 任务计划里没有控制台，`[Console]::OutputEncoding` 不生效 |

**为什么要 node 自己写日志**：`powershell.exe` 用 `Out-File` 转发 node 的 UTF-8 输出时，会先按 GBK 解码
（任务计划里没有控制台，设编码也没用）。现在 `maintain.mjs --log <path>` 自己落盘，绕开这一层。
`.ps1` 本身要**纯 ASCII + UTF-8 BOM**：5.1 读无 BOM 脚本按 ANSI，中文字面量会变成能破坏解析的乱码。

**长期不开 DSH 会发生什么**（说清楚，避免误解）：

- 经验库/四库/本文件是静态的，**不会坏**
- 会话索引和台账由计划任务重建，回来时是**现成**的（不再从零捡）
- 计划任务需要「机器醒着 + 用户已登录」；两个条件都不满足就跳过那天（但现在会补跑）
- **复盘永远需要我**：reflect/distill/done 都是判断，没有自动层
