# 用户文档核对记录

核对日期：2026-09-28。此文件用于维护文档，不是用户操作手册。

| 调研范围 | 当前实现依据 | 文档处理 |
| --- | --- | --- |
| 笔记本/页面创建、重命名、多选、移动、复制、删除 | App.tsx 页面菜单与 handlePageTreeClick；shells.tsx NotebookList | 整理页面章节；区分输入焦点与侧栏快捷键 |
| emoji | emoji-picker.tsx 搜索、分类、recent、clear；App.tsx 图标菜单与 pendingPageEmojiIdsRef | 区分 Set emoji / Set Icon；说明批量应用与英文搜索 |
| 品牌个性化 | shells.tsx NativeBrand / EditableBrandText | Logo 点击更换、右键恢复；文字双击 |
| 编辑器、列表、媒体与表格 | editor.tsx 输入规则、Toolbar、TableControls、媒体指针处理；mixed-lists.ts | 入口、保存、列宽与混合列表行为；不承诺无界面支持的表格功能 |
| 图片标注 | image-annotations.tsx 工具、Save / Cancel | 标注与原图分离，必须保存 |
| 页面属性与日历 | workspace.tsx 元数据控件与 CalendarWorkspace；page-calendar.ts；App.tsx addCalendarPage | 日期来源、跨日、字段类型、日期新建的边界情况 |
| 收藏、浮窗、小组件 | workspace.tsx block-meta-actions；shells.tsx PinnedCards / CardWindow；WidgetPicker.tsx | 日期收藏与图钉小组件分开；系统预览限制 |
| 外观与文字 | paper-shell.tsx、FishDesk | 按主题设置、本地图片、原位文字操作 |
| 导入恢复 | workspace.tsx Temporary MD；App.tsx restorePreviousPageVersion、ToolControls | 临时页面保存、上一个版本恢复、JSON 与外观存储区别 |
| 快捷键上下文 | App.tsx 全局/侧栏按键；editor.tsx；terminal-paste.ts | 正文、终端和题字分开说明 |

历史交叉核对包括 `8ef48e3`（页面日历）、`66dd4dc`（Markdown 与图片标注）、近期混合列表和小组件提交。以当前代码为准，历史记录仅用于理解设计沿革。

文档分工：README 首页给概览和快速上手；中英文介绍给功能与开发入口；USER_GUIDE.md 是应用内和仓库共用的操作手册；editor-shortcuts.md 仅链接到同一份手册，避免维护两套规则。
