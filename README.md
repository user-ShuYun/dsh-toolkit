# DSH Toolkit

给 **DeepSeek Harness** 用的一小组本地工具，把「浏览器 / 视频 / PPT / GitHub」这四件重复劳动变成一句话。

不是框架，也不是插件市场里的东西——就是一堆能直接跑的 `.mjs` 脚本 + 一套 PPT 生产规程。

---

## 里面有什么

### 一、浏览器与 GPT 控制台（常驻小服务）

| 端口 | 服务 | 干什么 |
|---|---|---|
| `3100` | `browser-console.mjs` | 打开网址、截图、读文字、点击、输入、执行 JS、总结 B 站视频 |
| `3099` | `gpt-console.mjs` | 给浏览器里的 ChatGPT 发提示词、等出图、原图存盘（带哈希去重） |
| `3101` | `launcher.mjs` | 一个页面上的三盏绿灯 + 一键启动 |
| `9222` | Edge 调试端口 | 上面三个服务共用的浏览器 |

```powershell
node tools/start-all.cmd /nopause     # 一把起全
```

### 二、B 站视频总结

贴一条链接，拿字幕 → 结构化总结 → 存成 Markdown 笔记并更新索引。

```powershell
node tools/bili.mjs search "AI PPT" 10        # 搜
node tools/notes.mjs search 关键词            # 翻笔记
node tools/notes.mjs list
```

字幕走 B 站官方接口（wbi 签名），登录态直接从你已登录的浏览器里取，**不需要账号密码**。

### 三、PPT 生产（三合一）

默认流程不是「点一下生成」，而是三层叠加：

```
Default 流水线打底（锁规格：色板 / 字阶 / 页面节奏）
   + 挑 3 页手绘（结构页 / 数字页 / 链路页）
   + 电影级短片（推镜 + 溶解，ffmpeg）
```

**依赖**：[ppt-master](https://github.com/hugohe3/ppt-master)（MIT，6.7 万星）——负责 SVG → 原生 DrawingML 的转换与质量门禁。本仓库只放**它的使用规程和我们补的工具**，不复制它的代码。

本仓库新增的部分：

| 文件 | 作用 |
|---|---|
| `art/backgrounds/presets.json` | **背景纹样词典**：6 个题材 × 6 种页型 |
| `tools/gen-bgs.mjs` | 按题材批量生成背景纹理（走浏览器里的 ChatGPT） |
| `tools/svg2png.mjs` | SVG 页面批量渲染成 PNG（走 CDP，自己开标签页不抢别的窗口） |
| `tools/cine.mjs` | 把页面合成短片：缓慢推镜 + 交叉溶解 |
| `tools/cdp-shot.mjs` | 不依赖任何服务，直接 CDP 截图 |
| `docs/PLAYBOOK.md` | **完整规程**：六步流程 + 五条硬门禁 + 踩过的坑 |

### 四、GitHub 发布

只用 API（`api.github.com`），不依赖 git 协议——因为在部分网络环境下 git over HTTPS 会被重置。

```powershell
node tools/gh-publish.mjs <目录> <owner/repo> "<提交信息>"
node tools/gh-release.mjs <owner/repo> <tag> <文件>
```

### 三、本地 AI 视频生产线（2026-10 新增）

在 8 GB 显存的笔记本上跑通「出图 → 出视频 → 拼接调色」的完整链路，全部本地、不联网、不花钱。

| 脚本 | 干什么 |
|---|---|
| `comfy.mjs` | ComfyUI 客户端：提交工作流、轮询、下载产物；`--set 节点.字段=值` 改参数 |
| `shortdrama.mjs` | 一句话 → 分镜 → 逐镜出片（T2V 起头 + I2V 接戏）→ 拼接调色 |
| `stitch.mjs` | 拼接 / 胶片调色（film、cinema）/ 抽帧检查表 |
| `abtest.mjs` | 两套模型配置同题对比，自动拼对比图 |
| `make-loops.ps1` | 批量生成氛围循环素材（ping-pong 做无缝） |

```powershell
node tools/comfy.mjs status
node tools/comfy.mjs run --workflow workflows/ltx-t2v-api.json --out out/a.mp4 ^
  --set "6.text=英文长句提示词" --set "70.width=640" --set "70.height=384" --set "70.length=73" ^
  --set "71.steps=8" --set "72.cfg=1"

node tools/shortdrama.mjs --engine ltx --plan out/plan.json --out out/film.mp4 --grade film
node tools/shortdrama.mjs --engine wan --plan out/plan.json --out out/film.mp4 --width 832 --height 480

node tools/stitch.mjs --in "a.mp4,b.mp4" --out final.mp4 --grade film
```

配套工作流（API 格式，可直接提交）：`workflows/ltx-t2v-api.json`、`ltx-i2v-api.json`、`wan5b-ti2v-gguf.json`、`wan5b-i2v-gguf.json`、`sdxl-t2i-api.json`。

**实测数据**（RTX 5060 Laptop 8 GB）：

| 引擎 | 单镜 2 秒 | 特点 |
|---|---|---|
| LTX 0.9.8 distilled fp8 | 12~18 秒 | 快，一致性弱，适合试片 |
| Wan2.2 TI2V-5B Q4（GGUF） | 3.5~4 分钟 | 稳，画风厚涂 |

结论写在 [`docs/本地AI视频生产-经验总纲.md`](docs/本地AI视频生产-经验总纲.md)：**8 GB 能做氛围素材和短镜头，做不了多镜头角色故事**——后者受限于单图条件 I2V，跨镜人物必崩。

### 四、经验系统（让 Agent 越用越聪明）

不是"记忆插件"，是**文件 + 命令 + 计划任务**拼出来的持久化闭环：

| 文件/脚本 | 作用 |
|---|---|
| `AGENTS.md` | 开工简报，由 DSH 的 `dsh-agent-instructions` **每次新会话自动注入** |
| `LESSONS.md` | 经验日志（症状/原因/修法/证据），追加式 |
| `lesson-draft.mjs` | 工具失败时**自动**写一条草稿（带哈希去重，24h 窗口） |
| `preflight.mjs` | 开工一条命令：环境体检 + 经验库状态 + 标签分布 |
| `reflect.mjs` | 收尾：改了哪些文件、六问清单、`--index` 出全库目录（1.2 KB） |
| `audit.mjs` | 体检：重复、陈货、超期草稿、体积、计分是否在用 |
| `brief.mjs` | 从 LESSONS 自动生成「最值钱的几条」，写回 AGENTS.md 的标记块 |
| `journal.mjs` | 每次任务成功/失败自动记流水 |
| `maintain.mjs` | 每日维护：体检 → 清草稿 → 更简报 → 出日报（配 Windows 计划任务） |

```powershell
node tools/preflight.mjs                 # 开工
node tools/brief.mjs --write             # 刷新简报
node tools/audit.mjs                     # 体检
node tools/maintain.mjs                  # 每日维护（日报写到 notes/日志/日报/）
schtasks /Create /TN "DSH-Agent-Maintain" /TR "powershell -File <repo>\tools\maintain-daily.ps1" /SC DAILY /ST 09:30
```

设计取舍写在 [`docs/AGENTS.example.md`](docs/AGENTS.example.md)：**脚本只做记账，判断留给模型**；"命中计数"这类靠自觉的环节是这套系统最脆弱的地方。

---

## 快速开始

```powershell
# 1) 需要 Node 22.19+
node --version

# 2) 起服务（会拉起 Edge + 三个控制台）
tools\start-all.cmd /nopause

# 3) 打开启动面板
#    http://127.0.0.1:3101
```

PPT 部分需要额外准备 Python 环境，见 [`docs/PLAYBOOK.md`](docs/PLAYBOOK.md)。

---

## 这套东西的原则

1. **能本地就本地** —— 出图、渲染、合成都在本机，不依赖云服务
2. **状态驱动而非时间驱动** —— 等 GPT 画完是「停止按钮消失 + 图片数增加」，不是 `sleep 60`
3. **一切可复现** —— 每个产物都有对应命令，写在规程里
4. **不修改第三方包** —— ppt-master 是别人的 MIT 项目，我们只调用它的 CLI

---

## 已知限制

- 只在 **Windows** 上验证过（PowerShell 7 + Node 24 + Edge）
- 浏览器自动化依赖 CDP（Edge/Chrome 的 `--remote-debugging-port`）
- B 站接口需要登录态；未登录时部分视频拿不到字幕
- PPT 的「电影级」短片是 ffmpeg 合成，不经过 PowerPoint，所以**动画不是 PPT 原生动画**（PPT 本身另有 Morph 转场，由 ppt-master 写入）

## License

MIT
