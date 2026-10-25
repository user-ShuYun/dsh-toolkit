# 本机工具箱（给任何 DSH 会话看）

> 用户可能在任何对话里说「总结这个视频 / 让 GPT 画一张 / 看看这个网页」，先读这里，别重新发明。

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
| 模型 | `models/checkpoints/ltxv-2b-0.9.8-distilled-fp8.safetensors` + `models/text_encoders/t5xxl_fp8_e4m3fn.safetensors` |
| 工作流 | `<OUT>\workflows\ltx-t2v-api.json`（API 格式，12 节点） |
| 客户端 | `node tools/comfy.mjs status|queue|run --workflow ... --out ...` |
| ffmpeg | `D:\tools\ffmpeg\bin\ffmpeg.exe`（7.1，拼接/抽帧用） |

实测：640×384、73 帧（约 3 秒）、8 步蒸馏 → **18 秒出片**。

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
