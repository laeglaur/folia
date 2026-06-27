# 显示层 V1 重构设计

Date: 2026-06-27

## 背景

当前 Notebook 已经具备可用的编辑、搜索、移动、emoji、浮窗等能力，但显示层长期存在三个问题：

- 结构边界不够清晰，shell、sidebar、workspace、block、浮层之间容易互相影响
- 主题覆盖链过长，局部样式经常互相打架
- 视觉语言还不够统一，block 边界、标题、浮窗、搜索框、outline、sidebar 的质感没有形成稳定体系

这份设计的目标不是再做一次 editor core 重构，而是把“显示层”整理成一个更稳定、更漂亮、可维护的产品层。

## 目标

1. 建立清晰的显示层边界，让 shell / sidebar / workspace / block / floating layer 各自只做一件事。
2. 统一当前的视觉语言，让 block 更像浮在底层上的纸条、小票、卡片，而不是散乱的编辑片段。
3. 让主题、block borders、浮窗圆角、outline、搜索框、侧栏等 UI 在不同主题下保持一致的交互和可读性。
4. 在不破坏现有可用功能的前提下，修复显示层相关 bug，并继续支持已有交互。

## 非目标

本次重构不做这些事：

- 不改 editor core 的 list / paste / selection 语义
- 不重做数据模型、存储引擎、回收站、版本系统
- 不展开 collection/catalog 的完整重构
- 不做完整 theme manager
- 不改已经稳定的 page move、emoji、搜索、block 编辑主逻辑

## 范围

### 1. Shell 层

负责应用最外层结构和全局布局。

- Native shell
- Typora shell
- sidebar / workspace / right panel 的大分区
- 显示层级的入口控制

### 2. Navigation 层

负责 notebook、page、outline、search 的统一浏览体验。

- notebook 列表
- page 树 / file tree
- outline
- 全局搜索
- 页内搜索

### 3. Workspace 层

负责正文编辑区、block 视图、block borders、浮窗、卡片、注释等内容展示。

- page title / metadata / content body
- block 边界与 block 纸条感
- pinned card
- image annotation
- 文字与 block 的高亮显示

### 4. Theme Contract 层

负责主题 token 和 app contract 的关系，不负责主题内容本身。

- 统一 surface / line / accent / highlight / chip 等关键 token
- 明确哪些 token 由 app 控制，哪些 token 由 content theme 控制
- 限制主题对局部组件的越权覆盖

## 设计原则

1. 先分层，再做样式。
2. 先稳定结构，再做美化。
3. 显示层只负责表现，不负责 editor 语义。
4. 所有可见交互都要有一致的 hover、focus、selected、active、disabled 状态。
5. 主题可以换皮，但不能破坏可读性、点击命中和布局稳定性。

## 建议结构

### App Shell

最外层只保留三个职责：

- 选择当前 shell
- 提供全局 workspace preferences
- 承接全局浮层和快捷入口

### Sidebar / Right Panel

侧栏和右栏属于浏览层，不参与正文编辑逻辑。

- notebook / page 的可视化要稳定
- outline / search 的布局要统一
- 收起和展开要有明确的快捷键和视觉反馈

### Workspace Surface

正文区是这个重构的核心。

- block 之间要有一致的边界感
- block border、圆角、阴影、胶囊、浮窗等都要收束到统一视觉语言
- 任何浮层都不能遮挡正文关键操作的可见区域

### Floating Layers

包括 pinned card、搜索浮层、emoji 选择器、page move 菜单、便签弹窗等。

- 浮层优先保证可读性和不遮挡
- 浮层内交互和正文编辑必须分离
- 浮层位置要依赖锚点，而不是随机鼠标点位

## 数据与状态边界

显示层只读取这些状态：

- active notebook / active page
- shell / content theme / theme
- sidebar、outline、search、metadata 等显示开关
- block 高亮、浮层开关、展开状态

显示层不直接改这些底层数据：

- page content JSON
- block 编辑语义
- notebook/page 树结构
- SQLite / operation log / attachments

## 需要修的显示层问题类型

这次重构会优先覆盖以下问题类型：

- 文字可读性问题
- 搜索框、浮层、菜单的位置和尺寸问题
- block borders 与主题的冲突问题
- sidebar / outline / right panel 的统一性问题
- pinned card 的圆角、发光、预览和折叠展示
- page header、emoji、metadata 的对齐问题
- Typora shell 与 Native shell 的显示差异收束

## 分阶段推进

### 阶段 1：显示层骨架整理

目标：

- 明确 shell / sidebar / workspace / floating layers 的责任
- 统一显示层状态入口
- 收束当前容易互相影响的样式

结果：

- 布局不会因为某个局部组件改动而大面积抖动
- page / block / floating surface 的层级清楚

### 阶段 2：block 视觉语言统一

目标：

- block border、阴影、圆角、背景层的视觉规则统一
- 让 block 更接近“纸条浮层”的感觉

结果：

- block 之间边界更清晰
- 不同主题下 block 仍保持一致的识别度

### 阶段 3：导航与浮层统一

目标：

- notebook / page / outline / search / move / emoji 的交互样式统一
- 浮层锚点、尺寸、关闭方式、键盘导航一致

结果：

- 用户不会在不同菜单之间重新学习操作

### 阶段 4：主题 contract 收口

目标：

- 把 app 级 token 与 content theme 级 token 分离清楚
- 减少主题对局部组件的越权覆盖

结果：

- 主题可以继续扩展，但显示层不会越来越脆

## 验收标准

1. 页面首次打开时，layout 不抖动，shell / sidebar / workspace / right panel 边界清楚。
2. block 边界统一，正文区能稳定呈现“纸条浮在底层上”的感觉。
3. 搜索、page move、emoji、outline、pinned card 等浮层不会互相遮挡关键内容。
4. 主题切换后，文字可读性、浮层可读性、block border 可见性保持稳定。
5. 已经稳定的编辑功能不被破坏。

## 风险控制

- 不在显示层重写 editor core 行为。
- 不把 collection 或 catalog 的特定展示问题塞进本专项。
- 不一边做视觉重构，一边同步改数据模型。
- 每个显示层改动都要尽量可回退、可局部验证。

## 测试建议

1. 在 Native / Typora 两套 shell 下分别检查：
   - sidebar 折叠
   - outline 展开
   - search 浮层
   - page move 菜单
   - pinned card
2. 检查不同主题下：
   - block border
   - 搜索框
   - 浮层背景和文字颜色
   - page header emoji 对齐
3. 检查已有稳定功能：
   - 编辑
   - 复制粘贴
   - page / notebook 操作
   - 搜索跳转

## 结论

显示层 V1 的目标不是做更多功能，而是把 Notebook 的“看起来和用起来”先稳住。

如果这层稳了，后续无论继续扩展 collection、优化主题，还是进一步收紧 page/block 结构，代价都会低很多。
