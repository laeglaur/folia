# folia

[English](README.en.md)

folia 是一个本地优先的块状笔记应用，基于 Tauri、React 和 TipTap 构建。它适合快速记录、Markdown 写作、桌面便签卡片、图片标注，以及使用 Typora 风格主题阅读正文。

## 功能

- 块状笔记：先在顶部输入框记录，再保存成独立 block。
- 本地存储：桌面版使用 SQLite 保存数据。
- Notebook / Page 树：支持嵌套页面、图标、多选、移动、复制、删除和独立页面窗口。
- 收藏卡片：可以把 block 收藏到侧栏，并打开为置顶桌面浮窗。
- Markdown 支持：可打开 `.md`、`.markdown`、`.txt`，也可以临时查看后再导入。
- 文件夹导入：支持 Markdown 文件夹、frontmatter、wiki link、页面链接、任务、数学公式、脚注、提示块和媒体资源。
- Typora 正文主题：内置 Proof、Swiss、Folio、Flexoki、Gruvbox、Chocolate Box、Torillic、Everforest、Paperglow、LaTeX 等主题。
- Shell 外观：支持 Native Garden、Native Ledger、Typora Base、Garden Typora。
- 搜索与导航：支持全局页面搜索、当前页搜索、outline 和页面缩略图。
- 粘贴清理：针对网页、论文和 LLM 输出做了清理，尽量移除脏 span、转义 HTML、数学 HTML 和空代码块占位。
- 图片编辑：支持插入本地图片、缩放、缩进/反缩进和内置图片标注。
- 富文本能力：支持表格、行内公式、块级公式、脚注、键帽、代码块、引用、todo、附件、音视频嵌入和日期插入。
- 元数据与日历：支持 page metadata 和 notebook calendar view。
- 外部卡片调用：支持 `.notecard` 文件，方便桌宠或其他工具打开某个 page 的新 block 浮窗。

## 安装

普通使用时，从 GitHub Release 下载 macOS DMG，然后把 `folia.app` 拖进 `Applications`。

当前本地打包产物路径：

```txt
src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg
src-tauri/target/release/bundle/macos/folia.app
```

如果 macOS 因为应用未签名而阻止打开，可以在访达里右键 `folia.app`，选择“打开”；也可以到“系统设置 -> 隐私与安全性”里允许打开。

## 基本用法

1. 在左侧栏创建 notebook 和 page。
2. 在页面顶部输入框里写内容。
3. 按 `Shift+Enter` 或点击 `Add block`，把草稿保存成 block。
4. 点击 block 日期可以收藏或取消收藏。
5. 点击收藏卡片可以打开桌面浮窗。
6. 右键 page 可以设置图标、单独开窗、移动、收藏首个 block。
7. 拖动 block 左侧轨道可以调整顺序。
8. 从访达打开 Markdown，或在应用内使用 `Import MD` / `Import folder` 导入。

## Markdown 输入规则

更完整的编辑器快捷键和自动触发规则见 [docs/editor-shortcuts.md](docs/editor-shortcuts.md)。

| 输入 | 效果 |
| --- | --- |
| `[] ` 或 `【】 ` | todo |
| `- [ ] ` / `- [x] ` | 默认任务列表 |
| `- ` / `+ ` / `* ` | 无序列表 |
| `1. ` | 有序列表 |
| `# ` 到 `###### ` | 标题 |
| `> ` 或 `/quote ` | 引用块 |
| `` ``` `` 或 `/code ` | 代码块 |
| `` ``` `` 或 `/code` 后按 `Enter` | 代码块 |
| `$$ ` 或 `/math ` | 块级公式 |
| `$$` 或 `/math` 后按 `Enter` | 块级公式 |
| `$a+b$` | 行内公式 |
| `/table ` 或 `[[[ ` | 3x3 表格 |
| `/link ` | 插入链接或媒体 URL |
| `/at ` | 插入本地附件 |
| `/date ` | 插入当前日期时间 |
| `**text**` 或 `__text__` | 加粗 |
| `*text*` 或 `_text_` | 斜体 |
| `` `code` `` | 行内代码 |
| `~text~` | 下划线 |
| `~~text~~` | 删除线 |
| `---` / `___ ` / `*** ` | 分割线 |

容易记错的点：

- `-text-` 不会触发删除线。
- 删除线的自动触发写法是 `~~text~~`。
- `$text$` 是行内公式。
- 公式块是 `$$` 或 `/math`。

## 快捷键

macOS 使用 `Cmd`，Windows/Linux 使用 `Ctrl`。

### 全局

| 快捷键 | 功能 |
| --- | --- |
| `Cmd/Ctrl+F` | 搜索当前页 |
| 搜索框内 `Enter` / `ArrowDown` | 下一个匹配 |
| 搜索框内 `ArrowUp` | 上一个匹配 |
| 搜索框内 `Esc` | 关闭搜索 |
| `Cmd/Ctrl+[` | 显示/隐藏左侧栏 |
| `Cmd/Ctrl+]` | 显示/隐藏 outline / 右侧抽屉 |

### 编辑器

| 快捷键 | 功能 |
| --- | --- |
| `Cmd/Ctrl+B` | 加粗 |
| `Cmd/Ctrl+I` | 斜体 |
| `Cmd/Ctrl+U` | 下划线 |
| `Cmd/Ctrl+D` | 删除线 |
| `Cmd/Ctrl+Shift+S` | 删除线，兼容 Tiptap 默认快捷键 |
| `Cmd/Ctrl+E` | 行内代码 |
| `Cmd/Ctrl+H` | 高亮 |
| `Cmd/Ctrl+Alt+1..6` | 标题 1 到标题 6 |
| `Cmd/Ctrl+Alt+0` | 普通段落 |
| `Cmd/Ctrl+Shift+7` | 有序列表 |
| `Cmd/Ctrl+Shift+8` | 无序列表 |
| 输入框内 `Shift+Enter` | 保存草稿为 block |
| block / 卡片内 `Shift+Enter` | 保存并退出编辑 |
| `Tab` | 缩进列表项或选中的图片 |
| `Shift+Tab` | 反缩进列表项或选中的图片 |
| `Cmd/Ctrl+ArrowUp` | 当前 block 上移 |
| `Cmd/Ctrl+ArrowDown` | 当前 block 下移 |
| `Cmd/Ctrl+Backspace` | 删除当前 block |
| 编辑区右键 | 在开启 toolbar 后呼出浮动工具栏 |

### 页面树

| 快捷键 | 功能 |
| --- | --- |
| `Cmd/Ctrl+C` | 复制选中的 page |
| `Cmd/Ctrl+V` | 复制出一个新 page |
| `Cmd/Ctrl+Backspace` 或 `Cmd/Ctrl+Delete` | 删除选中的 page |
| `Tab` | 把选中 page 缩进到上一个兄弟 page 下 |
| `Shift+Tab` | 把选中 page 提升到父级同层 |
| `Shift+click` | 连续选择同层 page |
| `Cmd/Ctrl+click` | 切换多选 page |

## 桌面卡片与外部调用

收藏的 block 可以打开成置顶小浮窗，适合任务、参考内容和快速记录。

folia 也注册了 `.notecard` 文件。外部工具可以生成下面这样的 JSON 文件，并用 folia 打开：

```json
{
  "pageId": "page_xxx"
}
```

folia 会在对应 page 里创建一个新的收藏空 block，并打开成桌面卡片。

## 开发

依赖：

- Node.js 和 pnpm
- Rust toolchain
- 当前平台的 Tauri 2 依赖

安装依赖：

```bash
pnpm install
```

启动前端开发服务器：

```bash
pnpm dev
```

启动 Tauri 开发版：

```bash
pnpm tauri:dev
```

构建前端：

```bash
pnpm build
```

打包桌面应用：

```bash
pnpm tauri:build
```

常用检查：

```bash
pnpm exec tsc --noEmit
pnpm test:editor
pnpm test:view-model
pnpm test:markdown
pnpm test:markdown-folder
pnpm test:theme
pnpm test:persistence
```

`pnpm test:editor` 需要先启动 `http://127.0.0.1:5173/` 的开发服务器。

## 发布

推荐流程：

1. 把源码推到 GitHub。
2. 运行 `pnpm tauri:build`。
3. 创建 GitHub Release。
4. 上传 `src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg`。

## 注意

- 目前主要面向 macOS。
- 上面的本地安装包是 Apple Silicon (`aarch64`) 版本。
- 应用暂时还没有签名和 notarize。
- 打包产物、生成的 Typora assets、Tauri target 不会提交到 git。
