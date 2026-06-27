# Editor Paste 与 List Selection 专项设计

Date: 2026-06-27

## 背景

当前桌面版已进入真实使用阶段，最影响日常记录效率的一组问题集中在编辑器底层：

- code block 内粘贴内容时，文本有时会落到 code block 之外
- 在 bullet / nested list 内编辑时，粘贴内容容易逃出当前 list 语境
- 多级 bullet 在粘贴、回车、合并时，selection / cursor 表现不稳定
- 这些问题会反复破坏 block-first 写作体验，比缺少新功能更影响可用性

这组问题高度集中在 editor core 边界，因此应该作为一个独立专项处理，而不是继续用零散 patch 叠加。

## 目标

只解决以下问题：

1. code block 内 paste 边界稳定
2. bullet / nested list 内 paste 结构更稳定
3. list 场景下的 selection / merge / enter 语义更稳定

## 非目标

- 不重做 editor UI
- 不引入新的 editor core
- 不处理 table / image move
- 不处理 sidebar / outline / search / theme
- 不在这一阶段修改 pinned card 或 block 产品语义

## 核心决策

本阶段采用：

**保留当前 Tiptap / ProseMirror 基座，专项重构 paste 与 list selection 入口，并参考 BlockNote / ProseMirror / Logseq 的成熟语义。**

这意味着：

- 不直接引入 BlockNote 作为运行时依赖
- 先借它的 paste、list、block 处理思路
- 在当前工程内把高风险入口改成统一且可验证的行为

## 问题拆分

## 1. Code Block Paste

### 当前症状

- 用户通过 ``` 创建 code block 后
- 再复制代码粘贴进去
- 部分内容会落在 code block 外部

### 初步判断

这通常不是单一渲染 bug，而是：

- paste 时 selection 所在节点判断不稳
- ProseMirror transaction 对 code block 的 slice 处理没有被专门接管
- 当前 autoformat / keyboard shortcut / tiptap update 流与 paste 行为存在交叉

### 目标行为

- 当 selection 位于 code block 内时：
  - 默认优先以纯文本方式粘贴进 code block
  - 不应把普通代码文本拆出到 code block 外部
- 当 selection 不在 code block 内时：
  - 保持现有富文本 paste 行为

### 实现策略

- 在 editor paste 入口加入“当前 selection 是否位于 code block 内”的统一判断
- 对 code block 场景单独走 plain-text paste 分支
- 避免让通用富文本 slice 直接写入 code block 外层节点结构

## 2. Bullet / Nested List Paste

### 当前症状

- 在 bullet 内粘贴文本时，文本容易跑出 bullet
- 多级 bullet 粘贴后层级结构不稳定
- 合并与继续编辑成本高

### 初步判断

这类问题通常出现在：

- 粘贴内容的 slice 结构与当前 list item 语境不匹配
- selection 落点只考虑了段落，不考虑当前 list depth
- 缺少“list 上下文归一化”步骤

### 目标行为

- 当用户在某个 bullet 的正文内粘贴普通文本时：
  - 内容优先留在当前 bullet 体系内
- 当用户粘贴多行文本时：
  - 若可映射为当前 list 的连续项，应尽量映射，而不是跳出 list
- 当用户粘贴富文本列表时：
  - 尽量保留列表结构，但不要破坏当前 list 上下文

### 实现策略

- 增加 list-context-aware 的 paste 归一化层
- 在粘贴前读取：
  - 当前 selection 所在节点
  - 当前是否处于 list item 内
  - 当前 list depth
- 对纯文本、多行文本、富文本列表分别走不同转换逻辑

## 3. Selection / Merge / Enter 语义

### 当前症状

- 光标容易逃出 bullet
- list 内文本合并与继续编辑不稳定
- 某些回车或粘贴后，用户需要手动重新整理结构

### 初步判断

这类问题本质上属于：

- list item 里的 selection 语义不够严格
- 输入命令对 paragraph 与 list item 没有统一处理
- 当前 editor 对 list 上下文的“编辑边界”定义不够明确

### 目标行为

- 在 list item 正文内输入、粘贴、合并时：
  - selection 应尽量留在当前 list 语境
- 不应轻易把文本抛到 list 外
- 只有在明确退出 list 的用户意图下，才离开当前 list 结构

### 实现策略

- 统一 list 场景下的 selection 判定工具函数
- 将回车、粘贴、合并等入口都建立在同一套“当前 list 上下文判断”之上
- 为后续“点击正文不折叠”一类交互打好底层边界

## 设计边界

本阶段明确区分：

### 应自己实现的部分

- 当前产品对 block / bullet 的交互定义
- 现有 block-first 页面模型如何接住 editor 输出
- 与 page document 保存、block 更新、draft 状态之间的应用层时序

### 优先借成熟实现思路的部分

- transformPasted
- list paste normalization
- code block 内 plain-text paste
- selection / node context 判断

## 模块划分

建议把这一组改动拆成三个局部模块，而不是散落在各个事件处理器里：

## A. Editor Context Helpers

职责：

- 判断 selection 是否在 code block 内
- 判断 selection 是否在 list item 内
- 获取当前 list depth
- 统一暴露给 paste / enter / merge 使用

## B. Paste Normalizer

职责：

- 处理 code block paste
- 处理 plain text paste
- 处理 list-context-aware paste
- 将不同 paste 场景统一成更稳定的 transaction 入口

## C. List Editing Guardrails

职责：

- 统一 list 场景下的 enter / merge / selection 边界
- 尽量减少文本从 bullet 逃逸
- 为后续更精细的 list 折叠交互提供稳定基础

## 数据与状态约束

本阶段不改以下结构：

- `Page`
- `Block`
- `draftsByPageId`
- 桌面 SQLite 文档持久化

也就是说，这一轮重点是：

**让 editor 输出更稳定，而不是改存储模型。**

## 验证标准

完成后至少满足这些行为：

1. 在 code block 内粘贴多行代码，内容不会落到 code block 外部
2. 在一级 bullet 内粘贴纯文本，多数情况下保留在当前 bullet 体系内
3. 在二级或三级 bullet 内粘贴多行内容，不应轻易跳出当前层级
4. list 场景中继续输入时，光标不会频繁掉到 list 外
5. 不影响现有：
   - block 创建
   - block 更新
   - Shift+Enter 提交 block
   - page 保存
   - pinned card 内容同步

## 风险

- paste 与 selection 改动容易引发新的边界回归
- 需要特别防止影响现有 block 更新与持久化链路
- 需要防止修改 editor 命令后，误伤图片、数学公式、code block autoformat 等行为

## 实施顺序

1. 先梳理当前 editor paste / selection / list 相关入口
2. 抽出 editor context helpers
3. 为 code block paste 建立单独分支
4. 为 bullet / list paste 建立归一化逻辑
5. 收紧 list 场景下 enter / merge / selection 行为
6. 做最小回归测试与桌面端实测

## 推荐执行方式

这一专项应在独立分支上完成，例如：

- `editor-paste-selection`

完成后再合回 `main`，避免和 theme、sidebar、search、theme manager 等功能混改。
