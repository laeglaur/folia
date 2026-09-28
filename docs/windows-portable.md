# Windows 便携测试版

解压整个 ZIP 至可写目录后运行 folia.exe，不需要安装 folia。不要在 ZIP 内运行，不要只移动 exe：笔记数据库、附件和浏览器偏好保存在旁边的 data 文件夹。

目标为 Windows 10/11 x64。当前构建依赖系统 WebView2 Runtime；尚未打包离线运行时，缺少 WebView2 的电脑暂不能实现完全零安装。macOS WidgetKit 小组件不支持 Windows，桌面卡片另行测试。

升级前退出所有窗口并备份整个文件夹；保留 data，只替换程序。已通过 Windows 构建与启动检查，以及媒体路径迁移测试；完整交互仍需 Windows 用户试用。请先用副本验证图片、桌面卡片与导入导出，再迁移重要数据。

Ctrl 对应 macOS 的 Cmd，Alt 对应 Option。HTML 富文本可使用 Ctrl+Alt+V 原样粘贴；仅 RTF 的转换暂限 macOS。便携包不注册文件关联，不修改系统默认打开方式。未购买代码签名证书，Windows 可能显示未知发布者提示。
