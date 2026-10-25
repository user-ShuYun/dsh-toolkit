# 背景纹样语言（Background Texture Presets）

一套「按题材选纹样」的模板，避免每次现想提示词。

- 词典：`presets.json`
- 生成器：`node tools/gen-bgs.mjs`
- 产物：`$WORKSPACE\art\<preset>-<page>.png`

## 为什么要有它

一页 PPT 的背景如果"抢戏"，文字就废了；如果"没有"，页面就廉价。
这套词典把背景压到**只提供氛围、不提供信息**——所有的信息都交给文字和图形。

同一套 PPT 里，**色相和对比度必须一致，只换纹样**。所以每个 preset 固定了 `base`（基色）和 `mood`（氛围描述），只有 `motifs` 随页型变。

## 六个 preset

| id | 题材 | 基色 | 适合 |
|---|---|---|---|
| `tech` | 科技 / 工具 / 产品 | 深青黑 #061A24 | 技术分享、产品介绍、工程汇报 |
| `humanities` | 人文 / 历史 / 文学 | 暖米白 #F4EDE1 | 文化、历史、演讲稿 |
| `game` | 游戏 / 影视 / 幻想 | 深紫蓝 #0B0F1A | 游戏、影视、概念设定 |
| `business` | 商业 / 汇报 / 咨询 | 冷灰白 #F5F7F9 | 商业计划、咨询报告、路演 |
| `academic` | 学术 / 教学 / 论文 | 米白 #FAF7F1 | 答辩、课堂、论文汇报 |
| `nature` | 自然 / 生物 / 地理 | 深墨绿 #0C1F1A | 生物、地理、环保题材 |

## 六种页型

每个 preset 都有这六种，对应 PPT 里的角色：

| 页型 | 用在 |
|---|---|
| `cover` | 封面 |
| `structure` | 结构 / 分层 / 分类页 |
| `numbers` | 数据 / 数字页 |
| `entries` | 清单 / 卡片 / 功能页 |
| `chain` | 流程 / 时间轴 / 链路页 |
| `ending` | 结尾 / 致谢 |

## 用法

```powershell
# 看有哪些 preset
node tools/gen-bgs.mjs --list

# 生成整套（6 张）
node tools/gen-bgs.mjs --preset game --out $WORKSPACE\art\bg-game --prefix game

# 只生成需要的页
node tools/gen-bgs.mjs --preset business --out $WORKSPACE\art\bg-biz --pages cover,numbers
```

## 生成后必须做的三处登记

否则导出会被门禁拒绝（`illustration_*` 系列错误）：

```
① 文件放进 <project>\images\
② design_spec.md 的 §VIII 表格加一行
③ spec_lock.md 的 ## images 加一行
```

表格行必须**连续**，中间空行会被当成表格结束。

## 加新 preset

在 `presets.json` 里加一个键，结构：

```json
"mytheme": {
  "label": "题材名",
  "base": "基色描述（写具体色值）",
  "mood": "氛围：对比度、光泽、质感",
  "motifs": { "cover": "...", "structure": "...", "...": "..." }
}
```

**写作要点**（踩过的）

1. `motifs` 里只描述**纹理与光**，绝不描述物体（一写"电脑""人"，模型就会画出来）
2. 每条都隐含"极淡、低对比"，不要指望通用前缀兜底
3. 明暗 preset 要分开：深色配浅字主题，浅色配深字主题，**不能混用**
4. 同一 preset 的六张必须共用 `base` 和 `mood`，否则翻页会跳色
