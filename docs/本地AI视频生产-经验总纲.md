# 本地 AI 视频生产 · 经验总纲

> 这台机器（RTX 5060 Laptop **8 GB** / 内存 15 GB / D 盘 396 GB）在 2026-10-25 全部跑通。
> 本文记录的是**实测出来的结论**，不是教程抄来的——每一条都标了数据来源。
> 配套工具：`tools/comfy.mjs`、`tools/shortdrama.mjs`、`tools/stitch.mjs`、`tools/abtest.mjs`、`tools/make-loops.ps1`。

---

## 一、一句话结论

**8 GB 显存能做「氛围素材 + 短镜头」，做不了「多镜头角色故事」。**
前者已经稳定可产（18 秒一条循环），后者受限于「单图条件 I2V」，跨镜人物必崩——这不是调参能解决的，是模型结构问题。

---

## 二、环境搭建（血泪部分）

### 2.1 硬件红线

| 项 | 值 | 影响 |
|---|---|---|
| 显存 | 8 GB | 720p Wan 跑不动（实测 15 分钟未出片）；480p 是甜点 |
| 内存 | 15 GB | 必须把虚拟内存调到 32 GB，否则加载模型 OOM |
| 显卡架构 | RTX 50 系（sm_120） | **必须 cu128 的 PyTorch**，cu121 装了也是 `cuda_available=False` |

### 2.2 踩过的四个坑（都已被绕过）

| 坑 | 现象 | 解法 |
|---|---|---|
| PowerShell 下载 | `Invoke-WebRequest` 报「发送时发生错误」或 0 字节 | **改用 `curl.exe` 或 Node fetch**，.NET 的 TLS 栈在这台机器上和代理冲突 |
| pip 装 torch | 2.7 GB 走 IPv6 卡到 0.3 MB/s | **curl 直接拉 wheel（22 MB/s），再本地 `pip install *.whl`** |
| 大模型下载 | hf-mirror 单连接 0.3 MB/s | **多连接分片**（16 路并发可到 40~55 MB/s），详见 `out/setup/dl-parallel.ps1` |
| 下载文件损坏 | 文件大小对、但**开头 64 字节全是 0**，ComfyUI 报 "Expecting value: line 1 column 1" | 拼接后**必须校验 safetensors 头**（前 8 字节是小端 header 长度，应在 100~1e6 之间） |

### 2.3 镜像与源（这台机器实测可用）

- PyPI：`https://mirrors.aliyun.com/pypi/simple`（约 1.5 MB/s）
- 模型：`https://hf-mirror.com`（并发下载 40~55 MB/s，但会时不时掉到 0.01 MB/s）
- torch：`https://download.pytorch.org/whl/cu128`（curl 22 MB/s，pip 反而慢）
- **网络会突发性全线降速**（阿里云/ModelScope/hf-mirror 同时 0.05 MB/s），遇到就等，别重试到天亮。

---

## 三、模型选型（8 GB 显存的最优解）

| 用途 | 模型 | 大小 | 单次耗时 | 结论 |
|---|---|---|---|---|
| **出图（资产）** | Animagine XL 4.0（SDXL 动漫） | 6.46 GB | 30 秒/张（832×1216） | ✅ 主力 |
| **出视频（快）** | LTX 0.9.8 distilled **fp8** | 4.16 GB | 18 秒 / 3 秒镜头 | ✅ 默认引擎 |
| **出视频（稳）** | Wan2.2 TI2V-5B **Q4_K_M** | 3.2 GB | 220 秒 / 2 秒镜头 | ✅ 关键镜头 |
| 文本编码 | t5xxl_fp8（LTX）/ umt5_xxl_fp8（Wan） | 4.6 / 6.3 GB | — | 各自配套 |
| 实验（已证伪） | LTX 0.9.6 **dev** 28 步 cfg4 | 5.91 GB | — | ❌ 比蒸馏版更暗更糊，**非蒸馏≠更好** |

**被排除的选项**（别再试）：
- Qwen-Image（20B）/ FLUX（12B）：8 GB 跑不动
- SD1.5：一致性撑不起三视图
- Wan2.1 I2V **1.3B**：**不存在**（1.3B 只有 T2V，I2V 最小 14B）
- Wan2.2 FLF2V 14B（28 GB）：不可行
- 720p 输出（1280×704）：能启动，但 15 分钟不出片，不可用于生产

---

## 四、工作流工程

### 4.1 界面格式 → API 格式

ComfyUI 导出的工作流是「界面格式」（nodes/links 数组），API 只吃「API 格式」。转换不用手写：

```
node out/setup/convert-workflow.mjs <ui.json> <api.json>
```

原理：打开 ComfyUI 页面，用浏览器里的 `app.loadGraphData()` + `app.graphToPrompt()` 转换（前端自己就有这个能力）。

### 4.2 参数注入

`comfy.mjs run --set 节点id.字段=值` —— 节点 id 用 `--dry-run` 一看就知道。

### 4.3 实测最优参数

| 引擎 | 分辨率 | 帧数 | 步数 | cfg | 耗时 |
|---|---|---|---|---|---|
| LTX distilled | 640×384 | 73（3 秒） | 8 | **1**（必须是 1，否则过曝发灰） | 12~18 秒 |
| Wan 5B Q4 | 832×480 | 49（2 秒） | 20 | 5 | 210~240 秒 |

### 4.4 提示词铁律

- **英文长句**，写到「白卫衣 / 透明伞 / 霓虹倒影 / 浅景深」这种颗粒度；短提示词必糊
- 恒定加负向：`low quality, blurry, watermark, text, deformed, extra limbs, static frozen frame`
- LTX 蒸馏版**偶发在角落生成「西瓜视频」水印**（训练数据残留），所以 `watermark` 必须进负向
- 想要循环：`no people, static camera, seamless loop`

---

## 五、一致性（最重要的一节）

### 5.1 漂移的触发条件是「景别切换」，不是时间

实测四组：

| 拍法 | 结果 |
|---|---|
| 3 镜 × 3 秒，逐镜接尾帧 | 第 2 镜就换人 |
| 5 镜 × 2 秒，逐镜接尾帧 | 撑到第 4 镜 |
| 5 镜 × 2 秒 + 角色锚点 | 前 2 镜稳，后崩 |
| 4 镜同景别 + 场景内锚点 | **前 3 镜稳，第 4 镜（特写）崩** |

→ **同一景别内接帧能撑 2~3 镜，一换特写就崩**。

### 5.2 锚点图的两个反直觉结论

1. **不要用白底立绘做锚点**——白底会被模型带进画面（实测整片发白、背景丢失）
2. **要出「场景内」的角色参考图**（同灯光、同环境、同机位），一致性明显更好

### 5.3 转头/转身必崩，且切镜只解决一半

- 原理：单帧 I2V 要给「没拍到的半张脸」脑补，信息不存在 → 脸融化
- 切镜（改为「已经转好的侧面」）能消除旋转崩坏 ✅
- 但**每切一次镜＝重新生成一个世界**，人物还是会变 ❌
- 真正的解法只有：多参考图模型（MiniMax H3 / 可灵）或一镜到底

### 5.4 结论性建议

- **要人物故事** → 云模型，或一镜到底（每场一个 4~5 秒镜头，转场用黑场/雨幕）
- **要氛围素材** → 本地完全够，一晚几十条

---

## 六、画质

### 6.1 「画质不行」的三个真实来源

1. **分辨率**（480p 是硬上限）——头号杀手
2. **模型容量 + 量化**（5B、Q4）——次要
3. **没有放大环节**——WorkFisher 强调过：不接放大，脸就是糊的

### 6.2 有效的补救（按性价比）

| 手段 | 效果 | 成本 |
|---|---|---|
| 后期胶片调色（`stitch.mjs --grade film`） | 观感提升最明显，颗粒+暗角+轻调色能大幅抵消廉价感 | 1 秒 |
| 2× 放大（RealESRGAN / SeedVR） | 观感直接上一档 | 待接（模型没下成） |
| Q4 → Q5 / Q8 | 细节提升，速度 -20%~-50% | 需重新下载 |
| 步数 20 → 28 | 细节收敛 | +40% 时间 |

### 6.3 内容层面的判断

WorkFisher 那句话是对的：**画质只是加分项，故事才是决定性的**。抖音上大量「画质烂但故事好」的作品能爆。所以不要为了 4K 把速度拖死。

---

## 七、简单动画 / 氛围循环（这套的甜区）

**能稳定做的**：
- 雨、雪、雾、云、火焰、水面、霓虹闪烁、粒子
- 无脸物体旋转 / 漂浮
- 角色小动作（眨眼、呼吸、轻微摆动）——**一镜到底、幅度小**
- 静态场景图「活起来」（图生视频推一点点）

**不要用模型做的**：
- 扁平信息图动画（文字/图表/UI 位移）→ 用 SVG/CSS/Canvas + ffmpeg，快 100 倍且精准

**循环必须做 ping-pong**（正放+倒放），否则首尾对不齐会跳帧：

```powershell
ffmpeg -i x.mp4 -filter_complex "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]" -map "[v]" -c:v libx264 -crf 18 out/loop.mp4
```

---

## 八、操作手册（三条命令）

```powershell
# 1) 单条素材
node tools/comfy.mjs run --workflow out/workflows/ltx-t2v-api.json --out out/a.mp4 ^
  --set "6.text=英文长句提示词" --set "70.width=640" --set "70.height=384" --set "70.length=73" ^
  --set "71.steps=8" --set "72.cfg=1"

# 2) 分镜成片（LTX 快 / Wan 稳）
node tools/shortdrama.mjs --engine ltx --plan out/plan-rainy.json --out out/film.mp4 --grade film
node tools/shortdrama.mjs --engine wan --plan out/plan-wan.json --out out/film-wan.mp4 --width 832 --height 480

# 3) 批量氛围循环
powershell -File tools/make-loops.ps1
```

---

## 九、运维常识

- **ComfyUI 要常驻**：`D:\ComfyUI\venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188 --lowvram`
- 进程被杀（或手动 interrupt 后）先看 `/queue`，卡住就 `POST /interrupt` + `{clear:true}`
- 新装自定义节点（如 ComfyUI-GGUF）**必须重启** ComfyUI 才生效
- `comfy.mjs status` 是万用体检命令

---

## 十、还没做完的事

- [ ] RealESRGAN 放大接到 `stitch.mjs`（模型下载路径还没找对）
- [ ] Wan 的 I2V 多镜批量（已单条验证，未接进 shortdrama 的批量模式）
- [ ] 关键帧条件（LTX 的 `LTXVAddGuide`）钉住转头——理论可行，未实测
- [ ] 配音 + 字幕层（ffmpeg 可做，未做）
- [ ] 云模型桥接（MiniMax / 可灵）——若要做人物故事，这是唯一解
