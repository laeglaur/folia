# 演示数据库切换

录制 README 截图或短视频时，不要直接使用真实数据库。可以用 `folia-db` 脚本在真实库和演示库之间切换。

folia 的默认数据目录是：

```txt
~/Library/Application Support/com.laeglaur.notebook
```

脚本会同时处理这些 SQLite 文件：

```txt
notebook.sqlite3
notebook.sqlite3-wal
notebook.sqlite3-shm
```

## 查看状态

```bash
pnpm folia-db status
```

## 切到演示库

先退出 folia，然后运行：

```bash
pnpm folia-db use-demo
```

第一次切换时，脚本会把当前真实数据库保存到 `database-profiles/real`。如果还没有演示库，active 位置会留空，folia 下次启动时会自动创建一个干净数据库。

## 切回真实库

先退出 folia，然后运行：

```bash
pnpm folia-db use-real
```

脚本会把当前演示库保存到 `database-profiles/demo`，再恢复 `database-profiles/real`。

## 安全规则

- 默认会检查 folia 是否仍在运行；如果还在运行，脚本会拒绝切换。
- 如果某个 profile 目录已经存在，脚本会先归档成 `*.backup.YYYYMMDD-HHMMSS`，避免覆盖。
- 如需覆盖数据目录，可设置：

```bash
FOLIA_DATA_DIR=/custom/path pnpm folia-db status
```

不建议使用 `FOLIA_DB_SWITCH_ALLOW_RUNNING=1`，除非只是调试脚本。
