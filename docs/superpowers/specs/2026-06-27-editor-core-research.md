# Editor Core 调研文档

Date: 2026-06-27

## 背景

这个项目已经进入真实使用阶段。经过一周的桌面端使用，当前问题已经不再只是“缺少几个功能”，而是逐渐暴露出一类更底层的问题：

- code block、bullet、table、image 等富文本节点在复杂编辑场景下存在边界 bug
- paste、selection、cursor、nested list 语义不够稳定
- block 拖拽、block hierarchy、table 列宽、内容移动等编辑器能力仍需补齐
- 每次继续补 editor 逻辑时，都有把现有行为再次打乱的风险

这说明接下来的重点不应该是继续无边界地手写 editor 底层，而应该先完成一次正式调研，明确：

1. 哪些开源项目适合直接作为 editor core 或长期候选
2. 哪些项目只适合借鉴局部模块
3. 哪些问题属于 editor core，哪些问题仍然应该保留在应用层自行实现

## 目的

为后续版本确定一条更稳的 editor 演进路线，减少重复 debug 底层编辑问题的成本，同时保留当前产品已经形成的 UI、主题、block 卡片和知识管理体验。

## 目标

- 识别适合本项目的开源 editor core 候选
- 比较候选项目的架构层级、扩展方式、block 模型、paste 处理和可嵌入性
- 明确哪些能力值得直接复用，哪些能力更适合自行实现
- 输出一条可执行的路线：
  - 短期如何继续稳定现有版本
  - 中期如何有选择地借用开源 editor 核心模块
  - 长期是否需要迁移到新的 editor core

## 非目标

- 本文不决定立即替换现有 editor
- 本文不讨论主题视觉设计本身
- 本文不讨论 notebook/page/theme 管理的完整产品方案
- 本文不把现有所有 bug 都归因于 editor core

## 当前项目的边界

本项目真正应该长期自己维护的部分主要是：

- notebook / page / block 的产品模型
- 本地优先的数据模型与存储
- sidebar / outline / search / pinned card
- 主题系统与主题管理
- block 的视觉表现与交互规范

最适合尽量借力开源的部分是：

- rich text editor core
- selection / paste / transform
- table / code block / image / list 等复杂节点行为
- block 拖拽、block hierarchy、内容移动等编辑能力

因此，这次调研的核心不是寻找一个完整的笔记软件，而是寻找：

**可以让当前产品保留自己 UI 和知识管理体验的前提下，尽量减少 editor 底层维护压力的“Editor Core”或“Editor Core 模块来源”。**

## 必须先明确的判断原则

后续所有实现决策，都应先回答一个问题：

**这个问题到底属于产品层、编辑器底层，还是两者交界？**

如果这个判断错了，就会出现两种常见浪费：

1. 把本应自己掌控的产品层交给外部 editor core，最后反而失去当前产品的独特交互
2. 把本可借用成熟实现的底层问题继续留给自己硬修，长期反复掉进同一类 bug

因此，后续设计和开发统一采用下面三类划分：

- **必须自己实现**
- **优先借成熟实现**
- **需要“外部核心 + 本地适配”共同完成**

## 分层判断

调研时必须先区分不同层级的项目，否则容易把“编辑器框架”“block editor”“完整笔记软件”“演示项目”混为一谈。

### A. Editor Framework

代表：Tiptap、Lexical、Milkdown

特点：

- 提供富文本编辑基础设施
- 提供插件扩展、schema、selection、command、node/mark 系统
- 自身不是完整 block 笔记产品

### B. Block Editor Core / Toolkit

代表：BlockNote、BlockSuite

特点：

- 在 framework 之上进一步抽象 block 模型
- 通常自带更强的 block 语义、拖拽、层级、内容变换逻辑
- 更接近“可复用的编辑核心”

### C. 完整笔记软件

代表：SiYuan、Logseq、TriliumNext、AFFiNE

特点：

- 包含编辑器、数据层、UI、导航、搜索、同步或知识库产品层
- 很适合借鉴产品语义和架构经验
- 不适合整块嵌入当前工程

### D. 演示或产品样板

代表：Novel

特点：

- 适合借 UI 组件、快捷菜单、示例集成方式
- 不适合当作长期 editor core

## 哪些必须自己实现

以下能力即使未来引入更成熟的 editor core，也仍然应该由本项目自己掌控。

### 1. 产品结构与知识管理层

- notebook / subpage / page tree 结构
- page 属于哪个 notebook、如何跨 notebook 移动
- pinned card、block 便签、sidebar 视图
- outline 的展示策略与跳转逻辑
- search 的产品形态（例如 cmd+F 呼出的悬浮搜索）
- trash、import、export、版本恢复、桌面存储约束

原因：

这些都不是 editor core 的职责，而是整个应用的产品边界。它们与本地数据模型、桌面交互、页面导航和长期知识管理高度耦合，不适合外包给任何一个 editor 项目。

### 2. 视觉系统与主题系统

- 主题切换
- notebook/page 特设主题
- 主题管理界面
- 当前 typora-base / swiss / zeus 等主题映射规则
- block 边界视觉、纸条感、便利贴感、底层衬底风格

原因：

这部分决定产品体验和辨识度，不应该被外部 editor 的默认 UI 结构反向塑形。

### 3. block 的产品语义

- 什么叫一个 block
- block 如何 pin、折叠、移动、显示时间、和 page 建立关系
- 哪些节点算作 page 里的可独立交互单元
- pinned card 如何从 block 映射到桌面浮窗

原因：

外部 editor 里的 “block” 只是一种编辑结构；本项目里的 block 还承担了时间、收藏、浮窗、视觉载体和知识组织职责。这部分必须由本项目定义。

### 4. 桌面端状态管理与持久化

- Tauri 窗口行为
- SQLite / 文档存储
- 附件导入与内化
- 本地资源引用
- 页面快照、修订、垃圾桶、恢复

原因：

这些是桌面软件核心，不是 editor core 的范畴。

## 哪些优先借成熟实现

以下能力原则上不应继续完全手写，优先参考或复用成熟 editor 项目的实现思路。

### 1. Paste / transform / clipboard

- 粘贴到 code block 里时的行为
- 粘贴到 bullet / nested list 里的结构保留
- 外部富文本转内部结构
- 复制带序号、带层级时的输出一致性

优先参考：

- BlockNote
- Outline
- Tiptap 社区扩展

### 2. Selection / cursor / nested list 编辑语义

- bullet 内复制粘贴后选区跑偏
- 文本容易跑出 bullet
- 多级 list 合并困难
- 点击正文时不应误触发折叠

优先参考：

- BlockNote
- Logseq
- Tiptap / ProseMirror 的 list selection 处理

### 3. Table / image / media 的编辑能力

- table 列宽拖拽
- 图片、表格节点移动
- image / table 在文档中的位置调整
- media 选中、拖动、节点级操作

优先参考：

- BlockNote
- Tiptap 官方与社区 table / image 方案

### 4. Code block / block-level editing mechanics

- ``` 自动转 code block
- code block 内外 paste 边界
- code block 键盘行为
- block move 快捷键

优先参考：

- BlockNote
- Outline
- Tiptap / ProseMirror 现有命令体系

## 哪些属于“外部核心 + 本地适配”

以下能力既不能完全外包，也不适合完全自己重写，最合理的是：

**借成熟 editor 核心能力，再由本项目做产品层适配。**

### 1. Block Move

外部核心可提供：

- 节点移动
- drag / selection / keyboard move 语义

本地仍需实现：

- 当前 block 时间、pin、折叠状态是否保留
- 移动后 outline、pinned card、page order 如何同步

### 2. Bullet / Collapse 交互

外部核心可提供：

- nested list 结构
- selection / list command

本地仍需实现：

- 点击序号或折叠标折叠
- 点击正文不折叠
- collapse 状态与 block 产品语义之间的映射

### 3. Table / Image Move

外部核心可提供：

- node selection
- draggable node / move command
- resize handles

本地仍需实现：

- 与当前主题样式兼容
- 与 block 边界、outline、page 持久化同步

### 4. 搜索与跳转

外部核心可提供：

- 文档内 selection / anchor / command

本地仍需实现：

- cmd+F 呼出的 UI
- page 搜索、结果列表、切页跳转、命中高亮

### 5. Page / Block 数据映射

外部核心可提供：

- editor 内部 block/node 结构

本地仍需实现：

- 如何映射到本项目的 page / block / pinned card / revisions / attachments 模型

## 借鉴与自研的决策表

| 领域 | 是否应自己实现 | 是否应借成熟实现 | 说明 |
|---|---|---|---|
| Notebook / Page / Sidebar / Outline 产品结构 | 是 | 否 | 产品层，必须自己掌控 |
| Theme / Theme 管理 / block 视觉语言 | 是 | 否 | 产品辨识度核心 |
| Pinned card / 桌面浮窗 / 小鱼交互 | 是 | 否 | 强产品定制功能 |
| Paste / clipboard / transform | 否 | 是 | 高风险底层，优先借 |
| Selection / nested list / bullet 编辑 | 否 | 是 | 高风险底层，优先借 |
| Table resize / image move / node move | 否 | 是 | 应优先借成熟编辑能力 |
| Block move 与 collapse 产品行为 | 部分 | 部分 | 核心能力可借，产品语义自己定 |
| Search UI / 跳转体验 | 是 | 部分 | 跳转能力可借，UI 与产品流自己做 |
| 数据模型 / 持久化 / 附件存储 | 是 | 否 | 桌面端基础设施 |

## 候选项目调研

## 1. Tiptap

参考：

- https://tiptap.dev/
- https://github.com/ueberdosis/tiptap

### 定位

Tiptap 是当前项目已经在使用的 editor framework。它不是新的候选替代品，而是当前系统的基础。

### 优点

- 当前项目已经接入，迁移成本最低
- 基于 ProseMirror，生态成熟
- extension 机制完善
- 对 rich text、table、code、link、math、media 等节点支持广泛
- 很多第三方 editor 或 block editor 都建立在它之上

### 缺点

- 它只提供基础设施，不会直接替项目解决 block-first 笔记产品里的高层语义
- list / paste / selection / drag / block hierarchy 这类问题，仍需要项目层自己定义
- 如果继续纯手工增强，维护压力仍然较大

### 适合本项目的角色

- 继续作为当前稳定基座
- 不建议立即废弃
- 适合作为“短期稳定 + 中期局部借鉴”的承接层

### 结论

Tiptap 不是这次调研中“替代谁”的答案，而是“当前版本还可以站稳在哪里”的答案。

## 2. BlockNote

参考：

- https://github.com/TypeCellOS/BlockNote
- https://www.blocknotejs.org/docs

### 定位

BlockNote 是建立在 ProseMirror + Tiptap 之上的 block-based rich text editor。它不是完整笔记软件，而是面向复用的 block editor。

### 优点

- 方向和本项目非常接近：block-based rich text editor
- 自带独立包 `@blocknote/core`
- 已覆盖许多本项目当前仍不稳或未完成的能力：
  - block 拖拽
  - block hierarchy
  - nested list / block 结构
  - table
  - code block
  - slash menu
  - placeholder
  - collaboration 基础设施
- 与当前技术栈距离近，迁移理解成本低于 Lexical 路线

### 值得重点借鉴的模块

- `transformPasted`
- selection / block selection 处理
- block schema 组织方式
- list / nesting 语义
- table 节点及其交互设计
- drag handle 与 block move 的实现思路

### 风险

- 它本身也是一套有明确意见的 block editor，不是无侵入的小工具
- 直接整体接入，会影响：
  - 当前 block / page 模型
  - pinned card
  - outline
  - 自定义折叠逻辑
  - 当前 UI 结构
- 不能假设“接入 BlockNote 就自动没有 bug”
- 许可证为 MPL-2.0，修改和分发时要关注文件级要求

### 适合本项目的角色

- **优先级最高的专项调研对象**
- 非常适合做局部实现借鉴
- 值得做单独 spike，验证是否适合作为未来 editor core 替换方向

### 结论

如果当前目标是“在不重做整个产品 UI 的前提下，大幅减少 editor 底层 bug 的手写成本”，BlockNote 是本调研里最值得优先研究的项目。

## 3. BlockSuite

参考：

- https://github.com/toeverything/blocksuite
- https://github.com/toeverything/blocksuite-examples

### 定位

BlockSuite 是 AFFiNE 拆出来的 editor / collaboration toolkit。它比 BlockNote 更偏“技术栈”和“构建能力”，比 BlockNote 更低一层，但又高于单纯的 ProseMirror / Tiptap framework。

### 优点

- 明确面向复用，不是单一 app 私有内核
- block 模型、selection、事件、store、协作能力较强
- 更适合做深度定制，不容易被固定 UI 套牢
- 对未来真正的 block-first 产品演化更有潜力

### 风险

- 接入复杂度高于 BlockNote
- 心智模型和现有工程差异更大
- 如果短期目标只是修现有 bug，它不如 BlockNote 那样“立刻有现成答案”
- 迁移成本显著高于继续用 Tiptap 或借 BlockNote 的局部模块

### 适合本项目的角色

- **长期 editor core 候选**
- 必须纳入调研，但不适合立刻替换现有 editor
- 更适合做“长期路线 spike”，而不是短期稳定性修复工具

### 结论

如果未来希望构建一个真正强壮、块级语义更完整的桌面知识库编辑核心，BlockSuite 是最值得认真评估的长期候选之一。

## 4. Lexical

参考：

- https://lexical.dev/docs/intro
- https://github.com/facebook/lexical

### 定位

Lexical 是 Meta 的 editor framework，更偏底层、性能导向和 React 生态。

### 优点

- 性能表现好
- 插件架构清晰
- React 集成体验不错

### 缺点

- 更偏 low-level core
- 很多 block 语义仍需项目自行实现
- 当前项目若迁移到 Lexical，等于再次进入较大规模 editor 重构

### 适合本项目的角色

- 可作为对照研究对象
- 不建议优先投入

### 结论

如果目标是尽快获得更稳的 block 编辑能力，BlockNote 明显比 Lexical 更贴近本项目需要。

## 5. Milkdown

参考：

- https://milkdown.dev/
- https://github.com/Milkdown/milkdown

### 定位

Milkdown 更偏 markdown editor。

### 优点

- markdown 路线清晰
- 文档体系不错

### 缺点

- 本项目当前最大痛点并不在 markdown 语法本身，而在 block-based rich editor 行为
- 对 block hierarchy、内容拖拽、复杂节点交互的针对性不够强

### 结论

可了解，但不建议列为核心路线。

## 6. Outline Editor

参考：

- https://github.com/outline/rich-markdown-editor

### 定位

Outline editor 是成熟知识库编辑体验的参考实现，但它不是适合本项目长期依赖的未来路线。

### 优点

- markdown / rich text 混合体验成熟
- 快捷输入和文档编辑语义值得借鉴

### 缺点

- 更偏文档级编辑，不是 block-first
- 仓库已 archived
- 不适合作为长期核心依赖

### 结论

适合借交互思路，不适合当作本项目 editor core。

## 7. Novel

参考：

- https://github.com/steven-tey/novel

### 定位

Novel 更像 Tiptap-based 示例产品或 demo。

### 结论

适合参考 toolbar、slash menu 和整体示例，但不适合成为本项目的长期 editor core。

## 8. SiYuan / Logseq / TriliumNext / AFFiNE

参考：

- https://github.com/siyuan-note/siyuan
- https://github.com/logseq/logseq
- https://github.com/TriliumNext/Notes
- https://github.com/toeverything/AFFiNE

### 定位

这些项目更适合借鉴完整笔记产品的语义和工程经验，而不是直接复用 editor core。

### 借鉴价值

- SiYuan：本地优先、块级语义、桌面知识库经验
- Logseq：bullet-first、block identity、折叠与引用语义
- TriliumNext：知识库结构与 note 管理思路
- AFFiNE：产品层很重，但其通用 editor 抽象方式值得看，尤其是它如何把核心拆到 BlockSuite

### 结论

这类项目不适合直接缝入当前工程，但很适合定义产品层语义。

## 当前问题与层级归属

并不是所有已发现问题都应该通过“换 editor core”解决。

### 更偏 editor core 的问题

- code block 粘贴跑到外面
- bullet 内 paste / merge / selection 不稳
- image / table / 内容拖动
- table 列宽拖拽
- 多级 bullet 的折叠点击区域控制
- block hierarchy / block move 语义

### 更偏应用层的问题

- outline 点击后自动收缩
- 左右栏快捷键
- page move 到其他 notebook
- cmd+F 悬浮搜索跳转
- notebook/page 特设主题
- 主题管理 UI
- icon 持久化

### 混合问题

- block 拖拽
- pinned card 与 block 内容同步
- outline 与 block 结构一致性
- page / block / draft 的保存时序

这意味着：

1. 不应因为 editor core 有问题，就假设所有问题都该通过迁移 editor 解决
2. 即使未来更换 editor core，应用层状态时序和存储问题仍需要单独治理

## 方案比较

### 方案 A：继续纯 Tiptap，自行实现全部 editor 增强

优点：

- 不需要大迁移
- 不破坏现有 UI
- 短期可继续交付

缺点：

- 仍要持续自己踩 selection / paste / drag / table / nested list 的坑
- 长期维护成本高
- 很容易再次进入“修一个，坏一个”的循环

### 方案 B：保留 Tiptap 基座，局部借 BlockNote / 其他项目的实现思路

优点：

- 风险最低
- 最符合当前项目状态
- 可以先修最痛的 editor core 问题
- 不强迫重做当前 UI

缺点：

- 仍然需要自己整合
- 不会瞬间获得完整统一的 block editor 语义

### 方案 C：中长期迁移到 BlockNote

优点：

- 更快获得成熟 block editor 语义
- 对当前问题覆盖面较大

缺点：

- 会显著影响当前 block/page/render 逻辑
- 需要验证 pinned card、outline、theme 适配成本
- 不是低成本替换

### 方案 D：中长期迁移到 BlockSuite

优点：

- 最有潜力成为强 block-first 长期技术底座
- 对深度定制更友好

缺点：

- 迁移成本最高
- 短期见效最慢

## 推荐路线

## 第一阶段：停止继续盲修 editor 底层

从现在开始，不再把 editor 底层问题视为“临时补一个 patch 就好”的事项。凡是涉及以下能力的改动，都应该先对照成熟项目做专项参考：

- paste
- selection
- nested bullet
- code block
- table
- image / block move

## 第二阶段：先走“Selective Borrow”路线

当前最合适的路线不是立刻换 core，而是：

**保留当前 UI、当前 Tiptap 基座、当前 notebook/page/theme 结构，只借最容易反复出 bug 的 editor 底层能力。**

优先借鉴方向：

1. BlockNote
   - `transformPasted`
   - block schema 组织
   - list / selection / drag 语义
   - table 行为
2. Logseq
   - bullet-first 语义
   - 点击哪里折叠、点击哪里不折叠
3. SiYuan
   - 块级内容、桌面知识库产品的稳定行为参考
4. Outline
   - markdown / code block / 输入转换交互参考

## 第三阶段：做两个 spike，而不是直接迁移

建议单独做两个最小实验分支：

### Spike 1：BlockNote Spike

验证：

- 是否能保留当前 UI
- block 数据是否能映射到现有 page/block 模型
- paste / list / drag / table 是否明显更稳
- pinned card / outline 接入成本如何

### Spike 2：BlockSuite Spike

验证：

- 是否适合长期替代当前 editor core
- 是否能支持未来真正的 block-first 数据模型
- 与 Tauri + SQLite 的桌面本地优先架构是否匹配

## 最终推荐

本项目当前最合理的 editor 路线是：

1. **短期**
   - 继续基于 Tiptap
   - 不再盲修 editor 核心问题
   - 先借 BlockNote / Logseq / SiYuan / Outline 的成熟实现思路

2. **中期**
   - 把 BlockNote 作为第一优先级专项研究对象
   - 重点解决 paste、selection、nested list、table、drag 等问题

3. **长期**
   - 将 BlockSuite 作为长期 editor core 候选做架构评估
   - 如果未来确实需要更完整、更强的 block-first 内核，再决定是否迁移

## 结论摘要

- 不建议继续无限制地手写 editor 底层逻辑
- 不建议直接缝合完整笔记软件
- 最值得先调研的 editor core 候选是 **BlockNote**
- 最适合当前项目的执行顺序是：**先按模块借成熟实现思路修当前 editor 问题，再做 BlockNote / BlockSuite spike，而不是直接重写 editor**
- 最值得长期评估的 editor 技术底座候选是 **BlockSuite**
- 当前版本最稳妥的做法是：
  - 保留自己的 UI
  - 保留当前 Tiptap 基座
  - 分模块借成熟项目的 editor 核心实现思路

这条路线最符合当前项目状态，也最符合“UI 继续保留自己的，只尽量减少 editor 底层维护成本”的产品目标。
