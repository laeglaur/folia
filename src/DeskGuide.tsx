const sections = [
  {
    title: '正文书写与格式',
    items: [
      ['新增文字块', '在“写点什么”中输入，按 ⇧ Enter 或点击 Add block。编辑已有块时，⇧ Enter 保存并结束本次编辑。'],
      ['⌘ B / ⌘ I / ⌘ U', '选中文字后切换加粗、斜体、下划线。'],
      ['⌘ H / ⌘ D / ⌘ E', '正文中分别切换高亮、删除线、行内代码。'],
      ['⌘ Z / ⌘ ⇧ Z', '撤销 / 重做编辑。'],
      ['Tab / ⇧ Tab', '增加 / 减少缩进，适用于列表、文本块和代码块。'],
      ['⌘ ↑ / ⌘ ↓', '在已有正文块中，将整块向上 / 向下移动。'],
      ['⌥ Backspace', '删除当前正文块；可在小鱼的 Trash 中恢复。'],
      ['代码与引用', '段首输入 ``` 或 /code 后按 Enter 创建代码块；输入 > 或 /quote 后按空格创建引用。'],
      ['更多格式', '在小鱼中打开 Toolbar，使用标题、列表、待办、表格、公式、附件等工具。先选中文字，再点击格式按钮。']
    ]
  },
  {
    title: 'iTerm2 原样粘贴与编辑',
    items: [
      ['复制与粘贴', '在 iTerm2 用 ⌘⌥C（Copy with Styles）复制。回到正文，⌘V 使用普通粘贴；⌘⌥V 保留终端原始颜色和格式。'],
      ['浏览器与桌面版', '浏览器需要剪贴板提供 HTML 并允许读取。只有 RTF 时请使用桌面版。'],
      ['修改文字', '双击片段或点击“编辑文字”。鼠标拖选文字后，可修改文字颜色、底色、字号、加粗、斜体、下划线和删除线。'],
      ['一键高亮', '浅黄 / 浅绿预设同时应用底色与配套深色文字。无选区时设置后续输入样式；“清除底色”只清除背景，文字颜色可单独修改。'],
      ['⌥ ⇧ ← / →', '按词扩展选区。'],
      ['⌘ ⇧ ← / →', '选择到行首 / 行尾。⌘ ⇧ ↑ / ↓ 选择到片段开头 / 末尾。'],
      ['⌘ B / ⌘ I / ⌘ U', '片段内切换加粗、斜体、下划线。片段中的 ⌘ ↑ / ↓ 用于移动光标，不移动正文块。'],
      ['完成与转换', '修改实时保存；点击“完成编辑”或按 Esc 退出。点击“转为普通文本”后，文字改为跟随正文主题。'],
      ['保留格式', '使用 Backup 保留片段颜色。Markdown 导出为纯文本代码块，不保留颜色。']
    ]
  },
  {
    title: '查找、侧栏与页面',
    items: [
      ['⌘ F / Esc', '打开 / 关闭当前页查找。侧栏搜索用于查找笔记内容。'],
      ['⌘ [ / ⌘ ]', '展开或收起左侧栏 / Contents。'],
      ['页面与笔记本', '使用左侧栏的增加按钮创建内容；页面右键菜单提供页面操作。'],
      ['选中侧栏页面后', '⌘C、⌘V 复制页面；Tab / ⇧ Tab 调整页面层级；⌥ Backspace 删除选中的页面或笔记本。这些操作不在文字输入框中触发。'],
      ['Contents', '点击目录条目跳转到对应内容。小鱼中的 Sidebar、Contents 也可控制两侧栏显示。']
    ]
  },
  {
    title: '主题、文件与恢复',
    items: [
      ['外观设置', '在小鱼中选择外壳主题。Typora 系列还可独立选择正文主题；支持纸张或背景设置的外壳，会在下方显示相应选项。'],
      ['显示选项', 'Toolbar 控制格式工具栏；Metadata 控制页面元信息；Newest first 控制块的排列顺序。'],
      ['Import MD / Import folder', '导入 Markdown 文件，或选择整个文件夹导入。'],
      ['Markdown / Backup', 'Markdown 用于通用文本导出；Backup 用于保存完整笔记数据，包括原样终端片段的格式。'],
      ['Restore page / Trash', 'Restore page 恢复页面历史；点击 Trash 中的条目恢复删除内容。Empty trash 会永久清空回收站。']
    ]
  }
];

export function DeskGuide() {
  return (
    <details className="desk-guide desk-settings-section">
      <summary>使用说明 · 快捷键与操作</summary>
      <p className="desk-guide-intro">Mac：⌘ Command · ⌥ Option · ⇧ Shift。正文与原样终端片段的操作范围不同，请查看对应章节。</p>
      {sections.map(section => (
        <details className="desk-guide-chapter" key={section.title}>
          <summary>{section.title}</summary>
          <dl>{section.items.map(([label, description]) => (
            <div key={label}><dt>{label}</dt><dd>{description}</dd></div>
          ))}</dl>
        </details>
      ))}
    </details>
  );
}
