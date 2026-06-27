# 编辑器问题分层与借鉴落地路线图

Date: 2026-06-27

## 目的

这份文档不是新的调研，而是把现有调研结论转成后续实际开发时可执行的路线图。

目标是解决一个长期问题：

- 不能再继续用“来一个 bug 修一个 bug”的方式维护编辑器
- 也不能一上来就大迁移 editor core

因此需要一条中间路线：

- 保留当前产品 UI、block、主题、sidebar、outline、pinned card
- 对真正属于 editor core 的问题，优先借成熟实现或成熟语义
- 对风险高、语义不清、实现成本大的功能，先沟通，再立项，再实现

## 项目约束

后续所有编辑器相关开发，都遵守以下约束：

1. 遇到难处理、风险高、语义不明确的功能，先和用户沟通，不武断试错
2. 如果当下不适合做，整理成 md 留档，后续再做
3. 编辑器问题先分层，再实现
4. 非必要不重写 editor core
5. 非必要不混改 UI、数据层、主题层和 editor 底层

## 总体判断

当前项目最合理的路线不是：

- 继续纯手写 editor 细节
- 也不是立刻整体迁移到 BlockNote / BlockSuite

而是：

**短期继续留在 Tiptap / ProseMirror 基座上，分批借成熟实现思路；中期评估是否抽象出更稳定的 editor adapter；长期再判断是否值得更换 core。**

## 问题分层

后续问题统一分成四层。

### 第一层：直接借成熟 editor 行为

这类问题不应该继续主要靠手写 patch。

包括：

- paste / clipboard / transform
- selection / cursor / nested list 边界
- list merge / enter / split / outdent 语义
- code block 内外粘贴边界
- table / image / media 的节点级编辑行为

建议优先参考：

- Tiptap 官方扩展与命令体系
- ProseMirror 官方 commands / schema-list
- BlockNote 对 paste、list、selection 的思路

### 第二层：外部核心 + 本地适配

这类问题不能整块外包，但也不适合自己从零做。

包括：

- block move
- image / table 在 block-first 页面中的位置移动
- page 内内容结构与 editor 节点结构的桥接
- 复制 / 导出时如何保留层级、序号、富文本语义

策略：

- 底层行为借成熟实现
- 应用层适配保持本项目自己的 block / page 语义

### 第三层：本项目必须自己实现

包括：

- notebook / page / block 产品模型
- pinned card
- sidebar / outline / search
- 主题系统
- block 视觉边界和 block 卡片体验
- Tauri 桌面端行为
- 存储、附件、版本、回收站

这层即使以后换 editor core，也仍然由本项目维护。

### 第四层：暂缓并文档化

凡是满足以下任意一条的功能，都不应直接硬做：

- 风险高，容易破坏稳定面
- 语义尚未被用户和实现者共同明确
- 需要大面积重写 editor 交互
- 涉及多个层级耦合，短期难以安全验证

这类需求先单独写 md，不进入直接实现。

## 当前问题清单归类

### A. 已经相对稳定，可暂不动

- code block paste 越界
- bullet 内基础 paste 稳定性
- markdown 风格列表粘贴回结构列表
- bullet 折叠点击区域
- `ListKeymap` 接入

这些属于“已初步借成熟语义修好”的部分，不要轻易重构。

### B. 需要继续按 editor core 路线处理

#### 1. list 的 backspace / merge / outdent 边界

归类：

- 第一层，直接借成熟 editor 行为
- 同时属于高风险项

处理原则：

- 不直接武断实现
- 必须先有明确需求文档
- 每次尝试都必须是极窄补丁

当前状态：

- 需求已落档：
  [2026-06-27-list-backspace-requirement.md](/Users/laeglaur/Documents/code/notebook/docs/superpowers/specs/2026-06-27-list-backspace-requirement.md)
- 当前代码已回退，不再继续试错

#### 2. bullet 内 Enter / Backspace / merge 精细语义

归类：

- 第一层

建议：

- 参考 ProseMirror `splitListItem`、`liftListItem`、`joinBackward`
- 不要先写大改，先补测试场景和语义文档

#### 3. table / image 节点移动与编辑

归类：

- 第一层 + 第二层

建议：

- 底层参考 Tiptap / BlockNote
- 应用层保留 block-first 页面交互

### C. 应放在产品层 / UI 层处理，不要混进 editor core

- 点击正文不应触发 bullet 折叠
- sidebar / outline / pinned card 的交互
- block 边界视觉、纸条感
- notebook / page 管理体验

这些不应在 editor core 调整时顺手一起改。

### D. 涉及数据层与持久化的稳定性问题

包括：

- 内容丢失
- 保存链路脆弱
- 富文本与结构操作后的可回退能力

这类问题不应该混在 editor 交互 patch 中处理，而应放到数据层专项里。

## 推荐推进顺序

### 阶段 1：稳住当前编辑器基线

目标：

- 不引入新的大行为变更
- 把当前已经稳定的修复保住

行动：

1. 不再动已稳定的 paste / collapse 逻辑
2. 继续把高风险需求文档化
3. 补充 editor 行为用例说明

### 阶段 2：按“借成熟语义”专项修列表

目标：

- 不直接追一个 bug
- 而是把 list editing 当成一组语义问题来修

范围：

- backspace
- split
- merge
- outdent / lift

要求：

- 每次只改一条语义
- 先写需求文档
- 先确认不影响别的 list 行为

### 阶段 3：处理 table / image / media 编辑能力

目标：

- 让图表和媒体节点更接近成熟编辑器体验

策略：

- 借 Tiptap / BlockNote 的节点编辑思路
- 保留本项目 block-first UI

### 阶段 4：考虑抽象 editor adapter

当前还不做完整迁移，但如果下面这些 patch 越来越多，就应该考虑抽一层：

- context helpers
- paste normalizer
- list editing guardrails
- node interaction adapter

这样未来不管继续留在 Tiptap，还是局部借 BlockNote 思路，边界都会更清晰。

## 实施原则

后续真正开始改代码时，统一遵守这些原则：

1. 先分层，后实现
2. editor core 问题优先找现成语义，不优先自己发明
3. 复杂需求先写 md，再实现
4. 一次只动一类行为
5. 若实现开始影响稳定面，立即回退，保留需求文档，不继续硬试

## 下一步推荐

接下来最合适的动作不是继续随手修 bug，而是：

1. 基于这份路线图，把当前剩余编辑器问题整理成一个“编辑器专项 backlog”
2. 每个问题都标注所属层级：
   - 借成熟实现
   - 外部核心 + 本地适配
   - 本地 UI / 产品层
   - 暂缓文档化
3. 之后按 backlog 顺序推进，而不是按临时感受跳着修

## 结论

后续编辑器开发统一采用下面这条主线：

**保留当前产品外壳与数据模型，继续基于 Tiptap / ProseMirror；对真正属于 editor core 的问题，优先借成熟实现思路，避免继续无边界手写底层；对高风险和难实现功能，先沟通、先文档化，再决定是否进入开发。**
