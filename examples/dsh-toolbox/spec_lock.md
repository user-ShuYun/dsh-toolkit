<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock

## canvas
- viewBox: 0 0 1280 720
- format: PPT 16:9

## communication
- primary_language: zh-Hans-CN
- audience: 会用电脑、写一点代码但没耐心看文档的同学，在 3–5 米外看投影
- objective: 让同学在一句话里看见省下的操作、看清这套工具箱由三层和 25 个脚本拼成，并在离场时知道代码在 GitHub 上可以自己装
- core_message: 以前要开三个软件、点十几次的事，现在是一句话——插件层 + 服务层 + 脚本层拼成的一套工具，不是一个大软件
- consumption_mode: balanced

## mode
- mode: showcase

## visual_style
- visual_style: dark-tech

## colors
- background: #061A24
- secondary_bg: #0C2B38
- primary: #22D3EE
- accent: #F2B45A
- secondary_accent: #7DD3FC
- body_text: #EAF6FA
- secondary_text: #8FB3C2
- divider: #1B4557

## typography
- title_family: Microsoft YaHei, Segoe UI
- body_family: Microsoft YaHei, Segoe UI
- font_family: Microsoft YaHei, Segoe UI
- data_family: Consolas, monospace
- display_family: Microsoft YaHei, Segoe UI
- hero_num_family: Consolas, monospace
- hero_num: 88
- mega: 200
- index: 64
- body: 24
- title: 44
- subtitle: 30
- lead: 28
- data: 40
- display: 88
- annotation: 18
- footnote: 16

## icons
- library: none
- inventory: none

## page_rhythm
- P01: anchor
- P02: dense
- P03: anchor
- P04: dense
- P05: anchor

## pptx_structure
- mode: flat

## images
- cover: images/deck-cover.png | source=user | crop=adaptive
- bg-structure: images/bg-structure.png | source=user | crop=adaptive
- bg-numbers: images/bg-numbers.png | source=user | crop=adaptive
- bg-entries: images/bg-entries.png | source=user | crop=adaptive
- bg-chain: images/bg-chain.png | source=user | crop=adaptive

## forbidden
- `mask`, `<style>`, `class`, external CSS, `<foreignObject>`, `textPath`, `@font-face`, `<animate*>`, `<set>`, `<script>` / event attributes, `<iframe>`
- HTML named entities in text; write typography as raw Unicode and escape XML reserved characters
