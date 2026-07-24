# AGENTS.md

本仓库是独立的微信公众号文章导出 CLI，不依赖原 Nuxt 项目。

## 运行与检查

`index.mjs` 是打包产物（由 `src/cli.mjs` 构建生成），不要手工编辑；改动源码后必须重新构建再验证：

```bash
npm install       # 安装 devDependencies（含 esbuild 和运行时库，仅构建期需要）
npm run build     # 打包 src/cli.mjs -> index.mjs（自包含，无外部运行时依赖）
npm run check
node index.mjs --help
node index.mjs --status
```

注册本机命令后也可以运行：

```bash
npm link
weixin-article-exporter --help
```

## 项目结构

- `src/cli.mjs`：手工维护的源码，全部 CLI 命令、微信 HTTP 请求、登录、同步、导出和下载逻辑
- `scripts/build.mjs`：esbuild 打包脚本，产出自包含的 `index.mjs`
- `index.mjs`：构建产物，提交到仓库以便 `git clone` / `npx skills add` 后无需 `npm install` 即可直接运行；改 `src/cli.mjs` 后必须 `npm run build` 并把新的 `index.mjs` 一并提交，否则发布/分发的版本会与源码不一致
- `README.md`：用户安装与使用说明
- `package.json`：Node 版本、脚本、npm bin 配置、依赖声明和 npm 发布元数据（`files`/`license`/`author` 等）
- `package-lock.json`：依赖锁定，改动依赖后需一并更新提交
- `LICENSE`：MIT
- `.gitignore`：忽略本地数据和常见生成文件

## 数据与安全

默认数据目录为 `~/.weixin-article-exporter-cli/`，可用 `WAE_CLI_HOME` 覆盖。

- 不提交 `auth.json`、Cookie、token、二维码、文章索引或下载后的 HTML/Markdown。
- 测试破坏性命令时使用临时 `WAE_CLI_HOME`，不要清理真实数据。
- 微信接口请求保持合理间隔，避免高并发和无边界分页。

## 实现约束

- 保持 Node.js 20+ 可运行。
- 优先使用 Node.js 内置模块，新增依赖前确认确有必要。已确认引入的依赖（均为 devDependencies，仅构建期通过 esbuild 打包进 `index.mjs`，不作为运行时依赖发布）：`jpeg-js`/`jsqr`/`qrcode`（登录二维码在任意终端渲染为 Unicode，替代仅特定终端支持的图形协议）、`node-html-markdown`（`--download-all` 的 HTML→Markdown 转换，无需 jsdom）、`esbuild`（打包 `src/cli.mjs` -> `index.mjs`）。
- 保持 ESM 和单入口源码结构（`src/cli.mjs`），除非拆分能明显降低复杂度；构建产物 `index.mjs` 也是自包含单文件。
- 手工编辑文件使用 `apply_patch`，编辑对象是 `src/cli.mjs`，不要直接改 `index.mjs`。
- 登录、同步和接口解析修改后需 `npm run build` 生成最新 `index.mjs`，再验证 `node --check index.mjs` 并跑相关命令冒烟测试。
- `--sync` 默认增量；首次和 `--full` 每个公众号单次最多处理 1000 篇；每同步完一页立即落盘，避免中途报错丢失已拉取的进度；单个公众号同步失败不应中断其余公众号。
- `--clear` 只清理同步索引，不删除公众号列表和 HTML/Markdown。
- `--download` 默认生成普通图文的静态 HTML，`--raw` 保留微信原始页面。
- `--download-all` 优先提取 `#js_content` 正文，没有则回退解析页面内嵌的 `window.desc`（图片分享等 `item_show_type=8` 页面），两者都失败才跳过；统一转纯文字 Markdown（丢弃图片）。默认最多处理 50 篇未下载文章（不区分公众号数量，总数封顶），避免单次触发过多请求；成功下载的文章会在 `articles.json` 里标记 `downloadedAt`，重复运行自动跳过，失败的文章不标记以便重试；`--sync` 不应清除已有的 `downloadedAt` 标记。

## 微信接口边界

`/cgi-bin/appmsgpublish` 是微信公众平台内部接口，只返回当前登录状态和权限下可见的数据。不要假设它包含草稿、删除文章、受限内容或完整统计数据，也不要把内部参数视为稳定公开 API。
