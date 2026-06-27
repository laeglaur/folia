# 列表自定义退格需求说明

## 背景

当前编辑器基于 Tiptap / ProseMirror，`bullet list` / `ordered list` / `task list` 的基础行为大多沿用默认实现。

现有默认行为在大多数场景可接受，但有一个用户高频使用的场景不符合预期：

- 当光标位于某个列表项正文最开头
- 且这个列表项已经不能再继续向左退级
- 用户按下 `Backspace` 或 `Shift-Tab`

用户期望的不是“维持默认行为”，也不是“把整个列表项删掉”，而是一种更像大纲软件的结构性合并行为。

## 目标行为

### 触发条件

仅在以下条件同时满足时触发自定义行为：

1. 选区为空
2. 光标位于某个 `listItem` / `taskItem` 的首个正文文本块最开头
3. 当前列表项已经不能再继续 `outdent`
4. 当前文档视觉顺序中，当前项前面确实存在“上一个列表项”

这里的“上一个列表项”是视觉顺序上的上一个，不一定是同层级兄弟项。

### 预期语义

触发后，应执行以下结构变换：

1. 当前列表项的首段正文内容，拼接到“视觉上的上一个列表项”的首段正文末尾
2. 当前列表项除首段正文之外的剩余内容，不丢失
3. 这些剩余内容应继续作为“被并入目标项”的下一级内容存在

换句话说：

- 不是删除整个当前项
- 不是把当前项直接移出列表
- 不是把剩余内容打平到外层
- 而是“首段并入，剩余部分保留为下级结构”

## 例子

### 输入结构

```md
- Final Conclusion
  - Answer the following questions:
  - Should we stay on Tiptap?
  - Which ideas/components should be borrowed?
  - Is a full migration worthwhile?
```

当光标位于 `Should we stay on Tiptap?` 的最开头，并按下 `Backspace` 时，用户期望接近如下结果：

```md
- Final Conclusion
  - Answer the following questions: Should we stay on Tiptap?
    - Which ideas/components should be borrowed?
    - Is a full migration worthwhile?
```

注意：

- `Should we stay on Tiptap?` 的首段正文并入了前一个列表项
- 它后面的内容没有丢
- 后面的内容变成了并入目标项的下一级

### 再举一个更简单的例子

输入：

```md
- A
  - B
  - C
```

光标在 `C` 最开头按 `Backspace`，预期更接近：

```md
- A
  - BC
```

如果 `C` 自己还有下级内容，则这些下级内容也应继续挂在 `B` 下面，而不是丢失或跑到列表外。

## 不应该发生的行为

以下都属于错误行为：

1. 当前项跑出列表边界
2. 当前项首段并入后，出现乱码、重复文本或错位拼接
3. 当前项剩余结构被删除
4. 当前项剩余结构被错误打平成同级内容
5. 影响普通段落、普通 `Backspace`、code block、table、blockquote 等非目标场景
6. 影响普通 list 的默认 `Backspace` 行为
7. 影响 `Tab` / `Shift-Tab` 的普通缩进退级语义

## 作用范围约束

该功能必须是一个“极窄补丁”：

- 只覆盖列表边界上的自定义回退语义
- 其他所有退格行为继续交给默认编辑器逻辑

建议不要重写整个列表键盘系统，也不要在第一次实现时同时改 `Backspace` 与 `Shift-Tab`。

更安全的顺序是：

1. 先只实现 `Backspace`
2. 验证稳定后，再决定 `Shift-Tab` 是否在“最左边界”复用同一逻辑

## 现状说明

当前仓库中：

- code block paste 修复已稳定
- bullet paste 修复已稳定
- bullet 折叠点击区域修复已稳定
- `ListKeymap` 已接入

之前已经尝试过一版自定义 `Backspace`，但效果不好，现已回退，不应作为实现依据。

## 实现建议

更推荐的策略：

1. 先只做“命中条件判断”
2. 明确找到：
   - 当前列表项
   - 当前首段正文块
   - 视觉顺序上的上一个列表项
3. 用尽可能小的 transaction 范围完成结构更新
4. 不要直接重建整棵外层列表树，除非证明这样是必要且稳定的

## 验收标准

以下场景都需要通过：

1. 简单二级 bullet，在最左边界 `Backspace` 后正确并入
2. 当前项存在更多后续内容时，这些内容继续作为下一级保留
3. 当前项存在嵌套子列表时，子列表不丢失
4. ordered list 同类场景不出现结构损坏
5. task list 同类场景不出现结构损坏
6. 不满足触发条件时，`Backspace` 保持默认行为
7. 不影响已有的 paste、collapse、普通输入、删除、选择逻辑
