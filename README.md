# weixin-article-exporter-cli

微信公众号历史文章列表同步、JSON 导出与 HTML 下载工具。项目为独立 Node.js CLI，不依赖 Nuxt 服务端，也不需要启动 Web 应用。

## 项目来源与免责声明

本项目基于 [wechat-article/wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) 进行二次开发，将其中与微信公众号文章获取相关的能力拆分并改造为独立 CLI。感谢原项目作者及贡献者的工作。

本项目是社区开发的非官方工具，与微信、腾讯及微信公众平台不存在隶属、授权或合作关系。项目调用的部分微信公众平台内部接口没有公开稳定性承诺，其可用性、参数及返回结构可能随时发生变化。

使用者应遵守微信公众平台规则、文章版权要求及所在地适用法律，仅处理自己有权访问和使用的内容。请勿将本工具用于绕过访问限制、批量侵权转载或其他未经授权的用途。因使用本项目产生的账号、数据、版权或其他风险由使用者自行承担。

## 功能

- 扫码登录微信公众平台并保存本地登录态
- 搜索公众号并维护同步列表
- 增量或全量同步公众号历史文章索引
- 按公众号分组导出 JSON
- 根据文章 ID 或 URL 下载静态 HTML
- 清除指定公众号或全部公众号的同步索引

## 环境要求

- Node.js 20 或更高版本
- 可访问 `mp.weixin.qq.com`
- 一个可以扫码确认的微信公众平台账号

CLI 仅使用 Node.js 内置模块，不需要安装运行时依赖。

## 安装

支持两种安装方式，按使用场景选择。

### 方式一：npm 全局安装（手动调用）

面向自己在终端里直接敲命令使用的场景：

```bash
npm install -g weixin-article-exporter-cli
weixin-article-exporter --help
weixin-article-exporter --status
```

卸载：

```bash
npm uninstall -g weixin-article-exporter-cli
```

### 方式二：作为 Skill 安装（通过 Agent 调用）

面向让 Claude Code 等支持 [skills](https://github.com/vercel-labs/skills) 的 Agent 自动识别并调用本 CLI 完成同步/导出任务的场景，无需自己记命令：

```bash
npx skills add Wisdom12333/weixin-article-exporter-cli
```

该命令会把仓库中的 `SKILL.md`（以及同目录下的 `index.mjs`、`package.json` 等文件）安装到 Agent 的技能目录（如 Claude Code 的 `.claude/skills/`）。Agent 后续在合适的场景（登录、同步、导出、下载文章等）会自动读取 `SKILL.md` 并调用 `node index.mjs ...`，不需要额外执行方式一的全局安装步骤，只需本机具备 Node.js 20+ 环境。

### 从源码运行（开发/贡献）

克隆仓库后可直接运行，无需安装：

```bash
git clone https://github.com/Wisdom12333/weixin-article-exporter-cli.git
cd weixin-article-exporter-cli
node index.mjs --help
node index.mjs --status
```

也可以用 `npm link` 在本机注册为全局命令，方便边改代码边用真实命令名测试：

```bash
npm link
weixin-article-exporter --help
```

解除：

```bash
npm unlink -g weixin-article-exporter-cli
```

## 常用流程

```bash
# 1. 扫码登录，默认在支持的终端中显示二维码并同时保存文件
weixin-article-exporter --login

# 2. 搜索公众号，方向键选择，回车添加
weixin-article-exporter --search "少数派"

# 3. 查看已保存公众号
weixin-article-exporter --list
weixin-article-exporter --list --list-only --verbose

# 4. 同步全部已保存公众号
weixin-article-exporter --sync

# 5. 导出 JSON
weixin-article-exporter --export --out articles-export.json

# 6. 下载文章静态 HTML
weixin-article-exporter --download "https://mp.weixin.qq.com/s/..."
```

## 命令说明

### 登录

```bash
weixin-article-exporter --status
weixin-article-exporter --login
weixin-article-exporter --login --qr terminal
weixin-article-exporter --login --qr file
weixin-article-exporter --logout
```

`--login` 默认使用 `--qr both`：CLI 会从下载的二维码图片中解码出登录链接，再用 Unicode 半块字符重新绘制成二维码直接打印在终端里，不依赖 iTerm2/Kitty 等特定终端图形协议，任意终端（包括 SSH 远程会话）都能显示和扫码；同时仍会保存 `qrcode.jpg` 供需要时查看。若图片中未能识别出二维码内容，会回退为仅提示文件路径。

### 公众号列表

```bash
weixin-article-exporter --search "公众号名称"
weixin-article-exporter --search "公众号名称" --add 0
weixin-article-exporter --search "公众号名称" --list-only

weixin-article-exporter --list
weixin-article-exporter --list --list-only
weixin-article-exporter --list --list-only --verbose
weixin-article-exporter --remove 0
```

交互列表使用上下方向键或 `j` / `k` 移动。搜索结果按回车确认添加；已保存列表按 `d` 移除当前公众号。

### 同步

```bash
# 所有公众号默认增量同步
weixin-article-exporter --sync

# 只同步列表 ID 为 0 的公众号
weixin-article-exporter --sync --id 0

# 也可以使用 fakeid
weixin-article-exporter --sync --fakeid "Mz...=="

# 忽略本地增量边界，重新获取最新 1000 篇
weixin-article-exporter --sync --id 0 --full

# 同步到指定日期后停止
weixin-article-exporter --sync --since 2024-01-01
```

同步规则：

- 有本地数据时默认增量同步，从最新页开始，遇到一整页已存在文章后停止。
- 首次同步和 `--full` 单次最多处理每个公众号最新 1000 篇。
- `--full` 仍会遵守 `--since`。
- 同步内容是文章列表元数据，不包括正文、评论、阅读量和点赞量。

### 清理同步数据

```bash
weixin-article-exporter --clear --id 0
weixin-article-exporter --clear --fakeid "Mz...=="
weixin-article-exporter --clear
```

`--clear` 只清理文章索引，不移除公众号列表，也不删除已经下载的 HTML。

### 导出

```bash
weixin-article-exporter --export --out articles-export.json
weixin-article-exporter --export --from 2024-01-01 --to 2024-12-31 --out articles-2024.json
```

导出结果按公众号分组。未指定 `--out` 时输出到 stdout。

### 下载 HTML

```bash
weixin-article-exporter --download "Mz...==:2247483660_1"
weixin-article-exporter --download "2247483660_1"
weixin-article-exporter --download "https://mp.weixin.qq.com/s/..."
weixin-article-exporter --download "https://mp.weixin.qq.com/s/..." --out article.html
weixin-article-exporter --download "https://mp.weixin.qq.com/s/..." --raw
```

默认下载模式会对普通图文进行静态化：显示 `#js_content`、激活懒加载图片、修正协议相对资源，并移除微信运行脚本。`--raw` 保存微信返回的原始页面源码。

图片分享（`item_show_type=8`）等动态页面没有 `#js_content`，`--download` 的静态化逻辑目前仍只针对普通图文；这类文章的文字说明可以用下面的 `--download-all` 提取为 Markdown。

### 批量下载为纯文字 Markdown

```bash
weixin-article-exporter --download-all --id 0
weixin-article-exporter --download-all --fakeid Mz...== --limit 20
weixin-article-exporter --download-all --limit 30 --delay 3
```

`--download-all` 面向"喂给 Agent 做总结"这类自动化场景：只提取正文并转换成纯文字 Markdown（丢弃图片、脚本、样式），不做 HTML 静态化。

- 普通图文优先提取 `#js_content`；图片分享（`item_show_type=8`）等没有 `#js_content` 的动态页面，会退而解析页面内嵌的 `window.desc` 图文说明文本（反转义并按段落重排），两者都失败才判定为"未找到正文内容"跳过。
- 不加 `--id`/`--fakeid` 时会跨所有公众号按发布时间取最新的未下载文章，但总数仍然按 `--limit`（默认 50）封顶，不会因为公众号数量多而放大成百上千个请求，避免触发微信风控。
- 每篇下载成功后立即把 `downloadedAt` 写回 `articles.json` 并落盘，下次运行会自动跳过已下载文章，只处理剩余/新增的部分；下载失败的文章不会被标记，会在下次运行时重新尝试。
- `--sync` 增量/全量重新同步不会清除已有的 `downloadedAt` 标记。

## 数据目录

默认数据目录：

```text
~/.weixin-article-exporter-cli/
├── auth.json
├── accounts.json
├── articles.json
├── qrcode.jpg
├── html/
└── md/
```

- `auth.json`：登录 Cookie、token 和登录账号信息
- `accounts.json`：已添加公众号
- `articles.json`：按 fakeid 分组的文章索引（含每篇文章的 `downloadedAt` 下载标记）
- `qrcode.jpg`：最近一次登录二维码
- `html/`：`--download` 下载的文章 HTML
- `md/`：`--download-all` 下载的纯文字 Markdown

通过环境变量覆盖数据目录：

```bash
WAE_CLI_HOME=/path/to/data weixin-article-exporter --status
```

复用原项目数据，无需复制：

```bash
WAE_CLI_HOME=/Users/wisdom/Documents/project.nosync/wechat-article-exporter/cli/.data \
  weixin-article-exporter --list --list-only
```

也可以把原数据复制到新的默认目录：

```bash
cp -R /Users/wisdom/Documents/project.nosync/wechat-article-exporter/cli/.data \
  ~/.weixin-article-exporter-cli
```

不要把数据目录提交到版本库，其中包含登录凭据和抓取数据。

## 接口边界

文章列表来自微信公众平台内部接口 `/cgi-bin/appmsgpublish`。它只能返回当前登录状态和权限下可见的文章，不保证包含草稿、已删除、受限或接口不再返回的内容。接口没有公开稳定性承诺，参数和返回结构可能变化。

请合理设置请求频率；使用约束与责任说明参见上方“项目来源与免责声明”。

## 开发

```bash
npm run check
node index.mjs --help
```

项目刻意保持单文件和零运行时依赖。修改接口解析或登录流程后，应至少验证登录状态、搜索、增量同步、导出和 HTML 下载。
