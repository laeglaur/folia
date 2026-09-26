# iTerm2 原样粘贴

- iTerm2 选择文本后执行 Copy with Styles（⌘⌥C）。
- 普通 ⌘V 沿用富文本清理、代码识别流程。
- ⌘⌥V 插入保留颜色的终端片段；片段文字可选中，节点可删除。双击或点击“编辑文字”进入原样编辑，支持输入、换行、Tab、撤销/重做；修改实时保存，点击“完成编辑”或按 Escape 退出。新文字继承光标所在位置的样式。编辑工具栏支持文字颜色、底色、字号、加粗、斜体、下划线、删除线、浅黄/浅绿高亮预设与清除底色；⌘B / ⌘I / ⌘U 可快捷切换。选区修改只替换指定样式，保留各文本原有的其他颜色和字体。也可点击“转为普通文本”改成跟随正文主题的段落。
- 桌面端读取 macOS NSPasteboard 的 HTML，或将 RTF 交给系统 textutil 转成 HTML。只读取，不改写剪贴板。
- 浏览器需要允许读取剪贴板，并提供 text/html；仅有 RTF/纯文本时提示使用桌面端，不假装恢复颜色。

## 保存格式

沿用 RichContent.html 与 RichContent.plainText，不改数据库 schema。原样片段序列化为：

```html
<pre data-terminal-version="1" data-terminal-fragment="JSON 属性值"><code>纯文本</code></pre>
```

JSON 内是 `{version:1, html, plainText}`。html 仅包含重建的 div/span/br 与白名单文字样式，不含脚本、事件、外部资源或页面定位规则。读取节点时再次清理。阅读态以 Shadow DOM 隔离正文主题；编辑态使用带局部样式的插槽区域，让浏览器正确处理鼠标选区与 Mac 选词/选行快捷键，保存的是数据而不是 Shadow DOM；JSON 备份与页面历史自然保留。plainText 纳入现有搜索。Markdown 导出为代码围栏，不能保存颜色；回导 Markdown 将得到普通代码块。

单次限制 2 MB；剪贴板读取期间正文变化时停止插入，防止落入错误位置。

## 验证

开发预览下打开 `/scripts/terminal-paste-fixture.html`，验证样式清理、序列化重载、纯文本提取和 Markdown 导出。
桌面版重启编译后，用真实 iTerm2 的彩色输出检查 RTF 转换、两种快捷键、保存重开与撤销。字体可用性由本机决定。
