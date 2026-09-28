# Windows portable（开发中）

解压整个 ZIP 至可写目录后运行 folia.exe，不需要安装 folia。不要在 ZIP 内运行，不要只移动 exe：笔记数据库、附件和浏览器偏好保存在旁边的 data 文件夹。

目标为 Windows 10/11 x64。当前构建依赖系统 WebView2 Runtime；尚未打包离线运行时，缺少 WebView2 的电脑暂不能实现完全零安装。macOS WidgetKit 小组件不支持 Windows，桌面卡片另行测试。

升级前退出所有窗口并备份整个文件夹；保留 data，只替换程序。当前处于适配与迁移验证阶段，暂不用于唯一一份重要数据。
