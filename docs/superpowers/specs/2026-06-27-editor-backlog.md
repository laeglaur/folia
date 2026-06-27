# 编辑器与相关能力 Backlog

Date: 2026-06-27

## 说明

这份 backlog 严格按以下四层划分整理：

1. 借成熟 editor 行为
2. 外部核心 + 本地适配
3. 本地 UI / 产品层
4. 暂缓并文档化

它的目的不是记录所有历史问题，而是给后续开发一个清晰、去重、可执行的待办结构。

## 已完成基线

以下内容已经进入当前稳定基线，不再作为 backlog 待办：

### 编辑器基础稳定性

- code block paste 越界修复
- bullet / list 内 paste 稳定性增强
- markdown 风格纯文本列表重新转换为结构列表
- bullet 折叠点击区域修复
- `ListKeymap` 接入
- list 内 `Enter / 空项删除 / 合并` 的当前可用语义
- bullet / ordered list / task list 的当前基础 selection 稳定性
- 复制到外部时保留序号、层级、列表结构
- code block 内复制粘贴边界的主要问题
- bullet 内粘贴后文本偶尔逃出当前层级的主要问题
- 点击正文不触发 bullet 折叠，只点序号或折叠标记才折叠

这些已经完成，不再放入待办。

## 第一层：借成熟 editor 行为

这类问题优先借 Tiptap / ProseMirror / BlockNote 的成熟语义，不优先自己发明。

### 待做

- table 的列宽拖拽与更稳的编辑行为
- list、table、image、media 在更多复杂嵌套场景下的长期稳定性回归验证

### 备注

- 这一层主要处理 editor core 本身的行为问题
- 如果需要改动 list、selection、paste、table、image 节点行为，优先归这里

## 第二层：外部核心 + 本地适配

这类问题不能整块外包给 editor core，也不适合只在 UI 层硬写。

### 待做

- block move 的键盘语义恢复并稳定
- 图片 / 表格 / 媒体节点在正文中的位置移动与拖拽移动

### 备注

- “图片 / 表格 / 媒体节点在正文中的位置移动”
- “图片、表格、媒体节点的拖拽移动”

这两个本质上是同一组需求，这里合并成一条，避免重复。

## 第三层：本地 UI / 产品层

这类问题不属于 editor core，应该放在产品交互层推进。

### 待做

- notebook / page move 到其他 notebook
- `cmd+F` 呼出 page 搜索 / 跳转浮层
- notebook / page 特设主题
- 左右 sidebar 的快捷键收缩展开
- 左侧栏的方框缩略视图
- 主题管理入口：显示哪些主题、重命名、对应原文件、主题编辑
- block 边界视觉改成更像纸条 / 小票 / 便利贴
- pinned card、outline、sidebar 的持续 polish

## 第四层：暂缓并文档化

这类问题满足以下一个或多个条件：

- 风险高
- 语义未完全讲清
- 容易破坏稳定面
- 需要大面积重写 editor 行为

### 暂缓项

- 自定义 list 边界 `Backspace`
- 任何会大面积改写 list core 行为的需求
- 复杂 editor 命令系统重写
- 高风险但语义还没完全讲清的交互

### 已有文档

- [2026-06-27-list-backspace-requirement.md](/Users/laeglaur/Documents/code/notebook/docs/superpowers/specs/2026-06-27-list-backspace-requirement.md)

## 数据层 / 持久化专项

虽然它不属于 editor 分层四层之一，但它是当前项目里必须独立追踪的一条线，因此单列。

### 待做

- 内容丢失风险继续排查
- 结构操作后的可恢复能力
- 附件 / 图片长期保存稳定性
- 本地文档版本、最近若干版本回滚
- 回收站与清理机制
- 大量笔记下的流畅性
- 导入 / 删除时的后台任务化
- 富文本保存链路和 block/page 状态同步的一致性

## 当前推荐推进顺序

1. 先守住“已完成基线”，不随意动稳定编辑面
2. 再做第一层里的 table 相关编辑能力
3. 然后做第二层里的 block move 与媒体节点位置移动
4. 再推进第三层里的高频 UI / 产品交互
5. 第四层只继续文档化，不直接硬做
6. 数据层专项单独开，不混进 editor patch

## 工作原则

后续执行统一遵守：

1. 先分层，再实现
2. 难处理、难实现、高风险功能先沟通
3. 暂时不做的需求先写 md 留档
4. 不再用“想到一个 bug 就直接硬改”的方式推进
