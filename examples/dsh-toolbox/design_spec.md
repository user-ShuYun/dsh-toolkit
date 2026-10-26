<!-- ppt-master-schema: design-spec/v1 -->
# DSH 工具箱介绍 - Design Spec

## I. Project Information

| Item | Value |
| --- | --- |
| Project Name | DSH 工具箱介绍 |
| Canvas Format | PPT 16:9 (1280 × 720) |
| Page Count | 5 |
| Primary Language | zh-Hans-CN |
| Target Audience | 同学：会用电脑、写一点代码，但没耐心看安装文档，也没见过"把重复劳动交给代理"的做法 |
| Communication Intent | 先让同学在一句话里看见"省下的操作"，再解释这套东西由哪三层拼成、有多少可核对的工作量，最后用一条从 B 站链接到 Markdown 笔记的完整链路收束，并留下"你自己也能装"的钩子 |
| Desired Audience Outcome | 同学离场时能复述"一句需求 → 它去点浏览器 / 存视频笔记 / 出 PPT / 发仓库"，并知道代码在 GitHub 上可以自己装 |
| Core Message / Ask / Action | 以前要开三个软件、点十几次的事，现在是一句话；这套东西不是一个大软件，而是插件层 + 服务层 + 脚本层拼起来的 25 个脚本 |
| Delivery Context | 主要：站着讲的现场演讲（投影，同学在 3–5 米外看）；次要：讲完把文件发群里让同学自己翻 |
| Artifact Afterlife | 留档 + 群里转发；同学可自行点开翻阅，不需批注或审批 |
| Reading Mode | balanced |
| Content Strategy | 以源材料为事实边界，按"现象 → 结构 → 数字 → 入口 → 链路"重新组织，不新增材料之外的数字或声明 |
| Design Style | Mode `showcase` + Visual style `dark-tech`：暗场、青色发光强调、等宽数字与细线几何 |
| AI Image Acquisition Path | not applicable |
| Generation Mode | continuous |
| Spec Refinement | disabled |
| Speaker Notes | disabled — final Stage-2 proactive policy: 本次只要可放映的 5 页文件，未提出讲稿或旁白需求 |
| Custom Animations | disabled — 用户仅给出整册导出级动效参数（转场 morph 0.8s、入场 entrance_fade），无逐页 / 逐对象运动规划，不生成 `animations.json` |
| Narration Audio | disabled — final Stage-2 proactive policy: 未提出旁白需求，且讲稿未启用 |
| Created Date | 2026-10-25 |

## II. Canvas Specification

| Property | Value |
| --- | --- |
| Format | PPT 16:9 |
| Dimensions | 1280 × 720 |
| viewBox | `0 0 1280 720` |
| Margins | 左右 72 px；上 56 px；下 48 px |
| Content Area | x 72–1208，y 56–672 |

## III. Visual Theme

### Theme Style

- **Mode**: showcase
- **Visual style**: dark-tech
- **Theme**: 深夜书桌的一束冷光——暗场里只有数字、等宽标签和一道细线在发光，其余退进黑暗
- **Tone**: 冷静、精确、带一点"给你看个好东西"的兴奋

### Color Scheme

| Role | HEX | Purpose |
| --- | --- | --- |
| Background | #061A24 | 整册暗场底，取自封面照片与背景图的暗部 |
| Secondary background | #0C2B38 | 卡片、数值块、链路节点的承载面 |
| Primary | #22D3EE | 关键数字、序号、链路节点、强调词 |
| Accent | #F2B45A | 全书唯一的暖色：钩子句、收尾 CTA、需要被记住的那一个词 |
| Secondary accent | #7DD3FC | 次级标签、辅助线端点 |
| Body text | #EAF6FA | 正文与标题（暗场上高对比） |
| Secondary text | #8FB3C2 | 说明、注释、页脚 |
| Divider | #1B4557 | 细线、分隔、网格 |

## IV. Typography System

### Font Plan

| Role | Character (Reference) | Primary | English if non-English | Fallback tail |
| --- | --- | --- | --- | --- |
| Title | 中性无衬线，靠字重与字号拉开层级 | Microsoft YaHei | Segoe UI | sans-serif |
| Body | 同族concord：与标题同族，靠字号与灰度区分 | Microsoft YaHei | Segoe UI | sans-serif |
| Data | 等宽，承担所有数字、端口、文件名，制造终端感 | Consolas | Consolas | monospace |

- **Title stack**: Microsoft YaHei, Segoe UI, sans-serif
- **Body stack**: Microsoft YaHei, Segoe UI, sans-serif
- **Data stack**: Consolas, monospace
- **Role rationale**: 暗场 + 终端气质要求数字与文件名可核对、可对齐，故单独声明 data 角色使用等宽族；标题与正文维持同族 concord。

### Font Size Hierarchy

| Purpose | Anchor Size (px) |
| --- | ---: |
| Body | 24 |
| Title | 44 |
| Subtitle | 30 |
| Lead | 28 |
| Data | 40 |
| Display | 88 |
| Annotation | 18 |
| Footnote | 16 |

## V. Layout Principles

### Deck-wide Direction

- **Hierarchy direction**: 先看见一个发光的数字或一句钩子，再顺着细线读到解释；解释永远比标题低两级
- **Composition tendency**: 左侧留一个稳定的文字轴（x=72），右侧或下方放数字与模块；封面对称打破，靠照片的暗部承字
- **Cross-page continuity**: 每页左上角固定一条 2 px 青色短线 + 等宽小标签（`01 / 02 …`），作为翻阅时的定位锚
- **Spacing posture**: 变量：封面与收尾开阔（breathing / anchor），结构页与入口页紧凑（dense）
- **Spacing anchors**: 页边距 72 px、模块间距 28 px、列间距 32 px、圆角 2 px、正文行高 36 px

## VI. Icon Usage Specification

- **Primary bundled library**: none
- **Brand-logo library**: 不启用（内容提到 GitHub 时以文字链接说明，不使用品牌图标）

| Icon Path | Suitable Scenarios |
| --- | --- |

## VIII. Image Resource List

| Filename | Dimensions | Ratio | Purpose | Type | Image pattern | Crop Policy | Acquire Via | Status | Reference | text_policy | page_role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| deck-cover.png | 1672×941 | 1.78 | 封面主图：夜色书桌、亮着的笔电与代码窗口 | Photography | P1 满幅铺底，暗部在左承字 | adaptive | user | Existing | GPT 生成 / 用户素材 | none | cover |
| bg-structure.png | 1672×941 | 1.78 | 内页背景（结构页）：横向岩层剖面线，暗示“分层” | Photography | P2 满幅低对比纹理，其上叠阶梯块 | adaptive | user | Existing | GPT 生成 / 用户素材 | none | background |
| bg-numbers.png | 1672×941 | 1.78 | 内页背景（数字页）：稀疏点阵与微光斑，暗示“数据密度” | Photography | P3 满幅暗底，巨型数字压在其上 | adaptive | user | Existing | GPT 生成 / 用户素材 | none | background |
| bg-entries.png | 1672×941 | 1.78 | 内页背景（清单页）：淡网格与卡片阴影，暗示“界面骨架” | Photography | P4 满幅低对比纹理，卡片叠在其上 | adaptive | user | Existing | GPT 生成 / 用户素材 | none | background |
| bg-chain.png | 1672×941 | 1.78 | 内页背景（链路页）：细刻度线与胶片颗粒，暗示“时间轴” | Photography | P5 满幅暗底，胶片条叠在其上 | adaptive | user | Existing | GPT 生成 / 用户素材 | none | background |

## IX. Content Outline

### Part 1: 看见省下的操作

#### Slide 01 - 封面：一句话换十几次点击

- **Audience move**: 路过看手机 → 抬头想知道"这玩意儿到底替我干了什么"
- **Relationships**: 主标题、钩子句、封面照片是「结论 + 机制 + 场景证据」：标题给名字，钩子句给对比，照片给"深夜还在点"的现场
- **Composition**: 满幅夜景照片，左侧暗部压一层左深右浅的 scrim，文字全部落在左下三分之一；右下留城市灯点不压字
- **Cover impact**: 约束钩子「一句话，把三个软件合成一次点击」——必须有；构图可换
- **Title**: DSH 工具箱
- **Core message**: 你说一句需求，它替你去点浏览器、存视频、出 PPT、发仓库
- **Content**: 主标题「DSH 工具箱」；钩子句「一句话，把三个软件合成一次点击」；等宽角标 `browser · video · ppt · github`；页脚 `2026 · 同学分享`

#### Slide 02 - 三层：不是一个软件

- **Audience move**: 以为是"又一个软件" → 明白它是三层拼起来的一套工具
- **Relationships**: membership —— 插件层 / 服务层 / 脚本层 三层自上而下共同构成一个工具箱；上层依赖下层，越往下越靠近机器
- **Composition**: 三层横向条带自上而下堆叠，左侧竖排层名，右侧一行"是什么 + 例子"；层与层之间用 1 px 细线分隔而非卡片
- **Title**: 它不是一个大软件，是三样东西拼起来的
- **Core message**: 装进去的（插件）、常驻的（服务）、底下的脚本（25 个 .mjs）各管一段
- **Content**: 插件层 · 装进 DSH 的插件：侧边栏工作台、插件市场、视觉能力、PPT 生成、工具箱按钮；服务层 · 本机常驻小服务：浏览器控制台 3100、GPT 控制台 3099、启动面板 3101、调试端口 9222；脚本层 · `D:\deepseek\tools\` 下 25 个 `.mjs`，共 2789 行

#### Slide 03 - 硬数字

- **Audience move**: 觉得是"个人折腾的小玩意" → 看见可以一个一个数出来的规模
- **Relationships**: contrast —— 五个可核对数字并列，25 与 2789 是主量级，6 / 4 / 1 是配套证据
- **Composition**: 左上一个巨大的 25 与 2789 构成主视觉，右下一排三个小数值块；数字用等宽，单位字用说明级
- **Title**: 都能数出来
- **Core message**: 25 个脚本、2789 行；6 个插件、4 个常驻服务、1 条归档笔记
- **Content**: 25 个脚本 · `tools/*.mjs`；2789 行 · 脚本总行数；6 个 · 安装的 DSH 插件；4 个 · 常驻本地服务（9222 / 3099 / 3100 / 3101）；1 条 · 已归档视频笔记
- **Fact IDs**: 无外部事实库；以上数字全部来自 `sources/materials.md` 的硬数字表

#### Slide 04 - 五个入口

- **Audience move**: 记住"有很多功能" → 能复述五个入口各自做什么
- **Relationships**: order —— 五个入口按演示顺序排列，前一个是后一个的原料（浏览器 → 视频 → GPT → PPT → GitHub）
- **Composition**: 五行等距列表，左侧等宽序号 01–05，中间入口名，右侧一句"它能做什么"；行间用细线，不用卡片
- **Title**: 五个入口，一条流水线
- **Core message**: 打开网址、总结视频、存 ChatGPT 原图、一句话出 PPT、把目录推成仓库
- **Content**: 01 浏览器控制台 · 打开网址、截图、读文字、点击、输入、执行 JS；02 视频总结 · 贴 B 站链接，抓字幕 → ChatGPT 总结 → 自动存 Markdown；03 GPT 控制台 · 发提示词、等出图、原图存盘（一次一条，哈希去重）；04 PPT 生成 · 一句话出可编辑的 `.pptx`；05 GitHub 发布 · 不用命令行，目录直接推成仓库 + 发 Release

#### Slide 05 - 一分钟链路 + 钩子

- **Audience move**: 觉得"也就是几个按钮" → 看见一整条无人值守的链路，并想自己装一套
- **Relationships**: order / link —— 一条单向因果链：B 站链接 → 取 cookie → wbi 签名 → 751 句字幕 → ChatGPT 总结 → Markdown 笔记 + 索引
- **Composition**: 横向五节点链路贯穿页面中部，节点之间用 1 px 细线加方向端点；链路下方一行收尾 CTA，用暖色压住
- **Closing impact**: 约束收尾「这套东西你自己也能装，代码在 GitHub」——必须有；构图可换
- **Title**: 一分钟，从链接到笔记
- **Core message**: 751 句字幕、9912 字，全程不用人动手
- **Content**: 链路五步：B 站链接 → 取 cookie（用你已登录的浏览器）→ wbi 签名调官方接口 → 拿到 AI 字幕 751 句 / 9912 字 → ChatGPT 结构化总结 → 自动存 Markdown 笔记 + 更新索引；收尾句「这套东西你自己也能装，代码在 GitHub」

## X. Speaker Notes Requirements

- **Generation**: disabled
