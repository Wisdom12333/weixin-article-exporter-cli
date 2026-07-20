---
name: weixin-article-exporter-cli
description: 微信公众号历史文章同步、JSON 导出、HTML/Markdown 下载工具。当用户需要登录微信公众平台、搜索/管理公众号列表、同步公众号历史文章、导出文章 JSON、下载文章静态 HTML 或批量下载正文为纯文字 Markdown（用于喂给 Agent 总结）时使用。
---

# weixin-article-exporter-cli

独立 Node.js CLI，用于同步微信公众号历史文章列表、导出 JSON、下载文章 HTML 或纯文字 Markdown。不依赖 Web 服务，仅使用 Node.js 内置模块。

## 前置条件

- Node.js 20+
- 可访问 `mp.weixin.qq.com`
- 一个可扫码确认的微信公众平台账号

## 安装与调用

在技能所在目录下直接用 `node index.mjs` 调用；如果已经 `npm link` 过，也可以用全局命令 `weixin-article-exporter`。两者命令参数完全一致，以下统一用 `weixin-article-exporter` 表示。

```bash
weixin-article-exporter --help
```

## 典型流程

```bash
# 1. 登录（终端会渲染二维码，扫码确认）
weixin-article-exporter --login

# 2. 搜索并添加公众号
weixin-article-exporter --search "关键词"
weixin-article-exporter --search "关键词" --add 0

# 3. 查看已保存公众号列表（拿到 --id）
weixin-article-exporter --list --list-only --verbose

# 4. 同步文章索引（默认增量）
weixin-article-exporter --sync --id 0

# 5. 导出 JSON
weixin-article-exporter --export --from 2024-01-01 --out articles.json

# 6. 批量下载正文为纯文字 Markdown（适合喂给 Agent 总结）
weixin-article-exporter --download-all --id 0 --limit 20
```

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `--status` | 查看登录状态 |
| `--login [--qr both\|terminal\|file]` | 扫码登录 |
| `--logout` | 清空登录信息 |
| `--search <keyword> [--add <index\|fakeid>] [--list-only]` | 搜索并添加公众号 |
| `--list [--list-only] [--verbose]` | 查看已保存公众号，附带数字 `--id` |
| `--remove <id>` | 移除公众号 |
| `--sync [--id\|--fakeid] [--full] [--since YYYY-MM-DD] [--delay N]` | 同步文章索引，默认增量 |
| `--clear [--id\|--fakeid]` | 只清理同步索引，不删公众号/HTML |
| `--export [--from] [--to] [--out file]` | 按公众号分组导出 JSON |
| `--download <fakeid:aid\|url> [--out file] [--raw]` | 下载单篇文章 HTML |
| `--download-all [--id\|--fakeid] [--limit N] [--delay N] [--out dir]` | 批量下载未下载文章为纯文字 Markdown |

完整参数说明见仓库 `README.md`。

## 使用注意

- **不要绕过限流**：`--sync`/`--download-all` 都有内置 `--delay` 间隔，不要为了求快而设成 0 或并发调用多个实例。
- **`--download-all` 默认总数上限 50**，不区分公众号数量，避免一次触发过多请求；需要更多时分批多次运行，而不是调大 `--limit` 到很大的值。
- **`--sync` 默认增量**，遇到已存在的整页文章即停止；首次同步和 `--full` 单个公众号最多处理 1000 篇。
- **`--clear` 只清理文章索引**，不会删除公众号列表或已下载的 HTML/Markdown。
- **`--download` 只对普通图文做静态化**；图片分享等 `item_show_type=8` 动态页面没有正文容器，需要用 `--download-all` 走 `window.desc` 回退提取。
- **数据目录**默认在 `~/.weixin-article-exporter-cli/`（含登录凭据 `auth.json`），可用环境变量 `WAE_CLI_HOME` 覆盖；不要把这个目录提交到版本库或输出给不受信的第三方。
- **接口边界**：`/cgi-bin/appmsgpublish` 是微信内部接口，只返回当前登录账号权限内可见的文章，不包含草稿、已删除或受限内容，也没有公开的稳定性承诺。
- 使用者需自行遵守微信公众平台规则、文章版权及所在地法律，仅处理自己有权访问的内容。
