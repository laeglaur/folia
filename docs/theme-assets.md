# 默认素材与构建资产

## 随源码提交的纸张素材

应用直接从 `public/app-assets/paper/` 加载下列文件，构建时 Vite 将其复制到发布目录。无需另行复制 `material/` 或 `target/`。

| 文件 | 用途 |
| --- | --- |
| background2.png | Tilted Paper 默认风景背景 |
| bg.png | Paper Collage 亚麻背景 |
| flower.png | 当前树叶与花枝图集 |
| material-sheet.png | 风景、回形针、胶带等图集 |
| material-sheet-2.png | 保留的第二图集分支 |
| right.png | Contents 纸张纹理 |
| rough-paper.png | 正文纸张纹理 |
| thing1.png | Contents 胶带 |
| torn-edge.svg | 纸张边缘 |
| contents-torn-edge.svg | Contents 撕边 |

这些文件均纳入 Git。`material/`、`target/` 是设计原稿与参考图目录，不是运行依赖；未被引用的 `flower1.png` 不是当前默认素材。

## Typora 主题

`src/styles/typora/manifest.json` 列出主题 CSS 来源和生成位置。构建脚本优先读取仓库中的原始 CSS；仅缺少缓存时从声明的 sourceUrl 下载。`public/typora-assets/` 是构建生成目录，不提交；`pnpm dev` 和 `pnpm build` 会运行生成脚本。部分第三方主题的远程资源仍可能需要网络，不能把默认纸张离线可用等同于所有第三方字体均已内置。

## 用户自选图片

自选图片不应加入源码仓库。桌面版通过应用附件存储导入；浏览器预览将图片缩小压缩后存到当前站点的本地存储。外观设置按 Shell 分别存储在设备上，与笔记 JSON 导出分开。网络 URL 的可用性取决于图片提供方。
