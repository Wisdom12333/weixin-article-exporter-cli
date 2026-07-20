#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 WAE-CLI/0.1.0';
const ARTICLE_LIST_PAGE_SIZE = 20;
const ACCOUNT_LIST_PAGE_SIZE = 5;
const FULL_SYNC_ARTICLE_LIMIT = 1000;
const DOWNLOAD_ALL_DEFAULT_LIMIT = 50;
const MP_BASE = 'https://mp.weixin.qq.com';
const DATA_DIR = process.env.WAE_CLI_HOME
  ? path.resolve(process.env.WAE_CLI_HOME)
  : path.join(homedir(), '.weixin-article-exporter-cli');

const files = {
  auth: path.join(DATA_DIR, 'auth.json'),
  accounts: path.join(DATA_DIR, 'accounts.json'),
  articles: path.join(DATA_DIR, 'articles.json'),
  qrcode: path.join(DATA_DIR, 'qrcode.jpg'),
  htmlDir: path.join(DATA_DIR, 'html'),
  mdDir: path.join(DATA_DIR, 'md'),
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function usage() {
  return `
weixin-article-exporter CLI

Commands:
  --status                         获取当前登录状态
  --login                          获取登录二维码并等待扫码确认
    --qr <both|terminal|file>       二维码展示方式，默认 both
  --logout                         清空登录信息
  --search <keyword>               搜索公众号，通过方向键选择并回车添加
    --add <index|fakeid>           跳过交互，直接添加指定搜索结果
    --list-only                    只显示搜索结果，不添加
  --list                           展示已保存公众号，方向键选择，d 移除
    --list-only                    仅打印列表，不进入交互模式
    --verbose                      显示 fakeid 等详细信息
  --remove <id>                    根据 --list 返回的数字 ID 移除公众号
  --clear                          清除全部公众号的本地同步文章索引
    --id <id>                      只清除 --list 返回的数字 ID
    --fakeid <fakeid>              只清除指定公众号
  --sync                           同步已添加公众号历史文章
    --id <id>                      只同步 --list 返回的数字 ID
    --fakeid <fakeid>              只同步指定公众号
    --full                         全量同步，忽略本地增量边界，最多 1000 篇
    --since <YYYY-MM-DD>           同步到指定日期后停止
    --delay <seconds>              分页请求间隔，默认 2
  --export                         导出 JSON 文章列表，按公众号分组
    --from <YYYY-MM-DD>            开始日期
    --to <YYYY-MM-DD>              结束日期
    --out <file>                   输出路径，默认 stdout
  --download <id|url>              根据 fakeid:aid、aid 或文章 URL 下载 HTML
    --out <file>                   输出路径，默认数据目录/html/<fakeid>/<aid>.html
    --raw                          保留微信原始页面源码，不进行静态化
  --download-all                   批量下载未下载过的文章为纯文字 Markdown（不含图片）
    --id <id>                      只下载 --list 返回的数字 ID 对应公众号
    --fakeid <fakeid>              只下载指定公众号
    --limit <n>                    最多下载多少篇未下载文章，默认 50
    --delay <seconds>              每篇下载间隔，默认 2
    --out <dir>                    输出目录，默认数据目录/md/<fakeid>/<aid>.md
                                    下载成功会标记 downloadedAt，重复运行自动跳过已下载文章

Examples:
  weixin-article-exporter --login
  weixin-article-exporter --search "人民日报"
  weixin-article-exporter --list
  weixin-article-exporter --list --verbose
  weixin-article-exporter --remove 0
  weixin-article-exporter --clear --id 0
  weixin-article-exporter --sync --id 0
  weixin-article-exporter --sync --id 0 --full
  weixin-article-exporter --sync --since 2024-01-01
  weixin-article-exporter --export --from 2024-01-01 --out articles.json
  weixin-article-exporter --download Mzxxx:2247483660
  weixin-article-exporter --download-all --id 0 --limit 20
`.trim();
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(files.htmlDir, { recursive: true });
  await mkdir(files.mdDir, { recursive: true });
}

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  return query.toString();
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map(item => item.trim());
}

function parseSetCookie(setCookie) {
  const [nameValue] = setCookie.split(';');
  const eq = nameValue.indexOf('=');
  if (eq < 0) return null;
  const name = nameValue.slice(0, eq).trim();
  const value = nameValue.slice(eq + 1).trim();
  if (!name || !value || value === 'EXPIRED') return null;
  return [name, value];
}

function mergeCookies(cookieMap, setCookies) {
  const next = { ...cookieMap };
  for (const item of setCookies) {
    const parsed = parseSetCookie(item);
    if (!parsed) continue;
    next[parsed[0]] = parsed[1];
  }
  return next;
}

function cookieHeader(cookieMap = {}) {
  return Object.entries(cookieMap)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function mpRequest(endpoint, { method = 'GET', query, body, cookies, expect = 'json' } = {}) {
  const url = `${endpoint}${query ? `?${toQuery(query)}` : ''}`;
  const headers = {
    Referer: 'https://mp.weixin.qq.com/',
    Origin: 'https://mp.weixin.qq.com',
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'identity',
  };
  const cookie = cookieHeader(cookies);
  if (cookie) headers.Cookie = cookie;
  let requestBody;
  if (method === 'POST' && body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    requestBody = toQuery(body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody,
    redirect: 'follow',
  });
  const setCookies = getSetCookies(response.headers);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }
  if (expect === 'buffer') return { data: Buffer.from(await response.arrayBuffer()), setCookies };
  if (expect === 'text') return { data: await response.text(), setCookies };
  return { data: await response.json(), setCookies };
}

async function loadAuth(required = true) {
  const auth = await readJson(files.auth, null);
  if (required && (!auth || !auth.token || !auth.cookies)) {
    throw new Error('未登录。请先执行：weixin-article-exporter --login');
  }
  return auth;
}

async function startLoginSession() {
  const sid = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const body = {
    userlang: 'zh_CN',
    redirect_url: '',
    login_type: 3,
    sessionid: sid,
    token: '',
    lang: 'zh_CN',
    f: 'json',
    ajax: 1,
  };
  const { data, setCookies } = await mpRequest(`${MP_BASE}/cgi-bin/bizlogin`, {
    method: 'POST',
    query: { action: 'startlogin' },
    body,
  });
  if (!data?.base_resp || data.base_resp.ret !== 0) {
    throw new Error(`${data?.base_resp?.err_msg || '获取登录会话失败'}`);
  }
  const cookies = mergeCookies({}, setCookies);
  return { sid, data, cookies };
}

async function getLoginQrcode(cookies) {
  const { data, setCookies } = await mpRequest(`${MP_BASE}/cgi-bin/scanloginqrcode`, {
    query: { action: 'getqrcode', random: Date.now() },
    cookies,
    expect: 'buffer',
  });
  await writeFile(files.qrcode, data);
  return mergeCookies(cookies, setCookies);
}

async function showQrCode(mode) {
  const qrMode = mode === true || mode === undefined ? 'both' : String(mode);
  if (!['both', 'terminal', 'file'].includes(qrMode)) {
    throw new Error('--qr 只支持 both、terminal、file');
  }

  if (qrMode === 'file') {
    console.log(`二维码已保存：${files.qrcode}`);
    return;
  }

  const rendered = await renderQrCodeAsUnicode(files.qrcode);
  if (rendered) {
    process.stdout.write(`\n${rendered}\n`);
  } else {
    console.log('未能从二维码图片中识别出内容，已保存二维码文件。');
  }

  if (qrMode === 'both') {
    console.log(`二维码文件：${files.qrcode}`);
  }
}

// Decodes the downloaded JPEG QR image back into its encoded text, then re-renders that
// text as a Unicode half-block QR code for the terminal. This works in any terminal (no
// inline-image protocol needed) and on any OS, since jpeg-js/jsqr/qrcode are pure JS.
async function renderQrCodeAsUnicode(imagePath) {
  const jpegBuffer = await readFile(imagePath);
  let decoded;
  try {
    decoded = jpeg.decode(jpegBuffer, { useTArray: true });
  } catch {
    return null;
  }
  const pixels = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length);
  const result = jsQR(pixels, decoded.width, decoded.height);
  if (!result?.data) return null;
  return QRCode.toString(result.data, { type: 'terminal', small: true });
}


async function askScanStatus(cookies) {
  const { data, setCookies } = await mpRequest(`${MP_BASE}/cgi-bin/scanloginqrcode`, {
    query: { action: 'ask', token: '', lang: 'zh_CN', f: 'json', ajax: 1 },
    cookies,
  });
  return { data, cookies: mergeCookies(cookies, setCookies) };
}

async function finishLogin(cookies) {
  const payload = {
    userlang: 'zh_CN',
    redirect_url: '',
    cookie_forbidden: 0,
    cookie_cleaned: 0,
    plugin_used: 0,
    login_type: 3,
    token: '',
    lang: 'zh_CN',
    f: 'json',
    ajax: 1,
  };
  const { data, setCookies } = await mpRequest(`${MP_BASE}/cgi-bin/bizlogin`, {
    method: 'POST',
    query: { action: 'login' },
    body: payload,
    cookies,
  });
  const redirectUrl = data?.redirect_url;
  if (!redirectUrl) {
    throw new Error(`登录失败，未返回 redirect_url: ${JSON.stringify(data)}`);
  }
  const token = new URL(`http://localhost${redirectUrl}`).searchParams.get('token');
  if (!token) {
    throw new Error(`登录失败，redirect_url 中没有 token: ${redirectUrl}`);
  }
  const auth = {
    token,
    cookies: mergeCookies(cookies, setCookies),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const info = await fetchLoginInfo(auth).catch(() => null);
  if (info) auth.account = info;
  await writeJson(files.auth, auth);
  return auth;
}

async function fetchLoginInfo(auth) {
  const { data } = await mpRequest(`${MP_BASE}/cgi-bin/home`, {
    query: { t: 'home/index', token: auth.token, lang: 'zh_CN' },
    cookies: auth.cookies,
    expect: 'text',
  });
  const nickName = data.match(/wx\.cgiData\.nick_name\s*?=\s*?"(?<value>[^"]+)"/)?.groups?.value || '';
  const headImg = data.match(/wx\.cgiData\.head_img\s*?=\s*?"(?<value>[^"]+)"/)?.groups?.value || '';
  return { nickName, headImg };
}

async function commandLogin(args) {
  console.log('正在创建扫码登录会话...');
  let { cookies } = await startLoginSession();
  cookies = await getLoginQrcode(cookies);
  await showQrCode(args.qr);
  console.log('请用微信扫码并在手机上确认。CLI 将等待最多 120 秒。');

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const result = await askScanStatus(cookies);
    cookies = result.cookies;
    const status = Number(result.data?.status);
    if (status === 0) {
      continue;
    }
    if (status === 1) {
      const auth = await finishLogin(cookies);
      console.log(`登录成功：${auth.account?.nickName || '未知账号'}`);
      console.log(`本地登录态预计保留到：${auth.expiresAt}`);
      return;
    }
    if (status === 4 || status === 6) {
      console.log('扫码成功，等待手机端确认...');
      continue;
    }
    if (status === 2 || status === 3) {
      throw new Error('二维码已过期，请重新执行 --login');
    }
    if (status === 5) {
      throw new Error('该账号尚未绑定邮箱，不能扫码登录');
    }
    console.log(`扫码状态：${JSON.stringify(result.data)}`);
  }
  throw new Error('登录超时，请重新执行 --login');
}

async function commandStatus() {
  const auth = await loadAuth(false);
  if (!auth) {
    console.log('未登录');
    return;
  }
  try {
    const info = await fetchLoginInfo(auth);
    auth.account = info;
    await writeJson(files.auth, auth);
    console.log('已登录');
    console.log(`账号：${info.nickName || '未知'}`);
    console.log(`本地登录态创建：${auth.createdAt}`);
    console.log(`本地登录态过期：${auth.expiresAt}`);
  } catch (error) {
    console.log('登录态可能已失效');
    console.log(error.message);
  }
}

async function commandLogout() {
  await rm(files.auth, { force: true });
  console.log('已清空登录信息');
}

async function searchAccounts(keyword) {
  const auth = await loadAuth();
  const { data } = await mpRequest(`${MP_BASE}/cgi-bin/searchbiz`, {
    query: {
      action: 'search_biz',
      begin: 0,
      count: ACCOUNT_LIST_PAGE_SIZE,
      query: keyword,
      token: auth.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: '1',
    },
    cookies: auth.cookies,
  });
  if (data.base_resp?.ret !== 0) {
    throw new Error(`${data.base_resp?.ret}:${data.base_resp?.err_msg || '搜索公众号失败'}`);
  }
  return data.list || [];
}

function formatAccount(account, index, verbose = false) {
  const alias = account.alias ? `  微信号：${account.alias}` : '';
  const fakeid = verbose ? `  fakeid：${account.fakeid}` : '';
  return `[${index}] ${account.nickname}${alias}${fakeid}`;
}

function parseNumericArg(value, message) {
  if (value === true || !/^\d+$/.test(String(value))) {
    throw new Error(message);
  }
  return Number(value);
}

function getAccountById(accounts, id) {
  const account = accounts[id];
  if (!account) throw new Error(`找不到公众号 ID：${id}`);
  return account;
}

async function removeAccountById(id) {
  const accounts = await readJson(files.accounts, []);
  getAccountById(accounts, id);
  const [removed] = accounts.splice(id, 1);
  await writeJson(files.accounts, accounts);
  return removed;
}

function requireInteractiveTty(message) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error(message);
  }
}

// Shared raw-mode keyboard menu used by `selectAccount` (pick one search result) and
// `commandList` (browse + delete saved accounts). `getItems` is read fresh on every
// keypress so callers may mutate the underlying array (e.g. delete) between renders.
async function runInteractiveMenu({ getItems, header, renderItem, onEnter, onEscape, onNavigate, onKey, isBusy }) {
  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  let selected = 0;
  let renderedLines = 0;

  const render = () => {
    const items = getItems();
    if (renderedLines > 0) process.stdout.write(`\u001b[${renderedLines}A\u001b[J`);
    process.stdout.write('\u001b[?25l');
    process.stdout.write(`${header()}\u001b[K\n`);
    items.forEach((item, index) => {
      process.stdout.write(`${renderItem(item, index, index === selected)}\u001b[K\n`);
    });
    renderedLines = items.length + 1;
  };

  render();
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdin.pause();
      process.stdout.write('\u001b[?25h');
    };

    const onKeypress = async (_text, key = {}) => {
      if (isBusy && isBusy()) return;
      const items = getItems();
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('已取消'));
        return;
      }
      if (key.name === 'up' || _text === 'k') {
        selected = (selected - 1 + items.length) % items.length;
        if (onNavigate) onNavigate();
        render();
        return;
      }
      if (key.name === 'down' || _text === 'j') {
        selected = (selected + 1) % items.length;
        if (onNavigate) onNavigate();
        render();
        return;
      }
      if (key.name === 'return') {
        cleanup();
        resolve(onEnter(items[selected], selected));
        return;
      }
      if (key.name === 'escape' || _text === 'q') {
        cleanup();
        resolve(onEscape ? onEscape() : null);
        return;
      }
      if (onKey) {
        await onKey({
          text: _text,
          key,
          selected,
          items,
          setSelected: value => {
            selected = value;
          },
          render,
          cleanup,
          resolve,
          reject,
        });
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

async function selectAccount(results) {
  requireInteractiveTty('当前不是交互式终端，请使用 --add <index|fakeid> 指定公众号，或使用 --list-only 只查看结果');

  return runInteractiveMenu({
    getItems: () => results,
    header: () => '请选择要添加的公众号（↑/↓ 移动，回车确认，Esc/q 取消）',
    renderItem: (account, index, isSelected) => {
      const marker = isSelected ? '\u001b[36m❯\u001b[0m' : ' ';
      const label = isSelected ? `\u001b[36m${formatAccount(account, index)}\u001b[0m` : formatAccount(account, index);
      return `${marker} ${label}`;
    },
    onEnter: account => account,
    onEscape: () => {
      process.stdout.write('\n已取消添加\n');
      return null;
    },
  });
}

async function commandSearch(args) {
  const keyword = args.search;
  if (typeof keyword !== 'string') throw new Error('--search 需要关键词');
  const results = await searchAccounts(keyword);
  if (results.length === 0) {
    console.log('没有搜索到公众号');
    return;
  }
  if (args['list-only']) {
    results.forEach((account, index) => console.log(formatAccount(account, index)));
    return;
  }

  let account;
  if (args.add !== undefined) {
    if (args.add === true) throw new Error('--add 需要搜索结果序号或 fakeid');
    const add = String(args.add);
    account = /^\d+$/.test(add) ? results[Number(add)] : results.find(item => item.fakeid === add);
    if (!account) throw new Error(`找不到要添加的搜索结果：${add}`);
  } else {
    account = await selectAccount(results);
    if (!account) return;
  }
  const accounts = await readJson(files.accounts, []);
  const next = accounts.filter(item => item.fakeid !== account.fakeid);
  next.push({
    fakeid: account.fakeid,
    nickname: account.nickname,
    alias: account.alias,
    round_head_img: account.round_head_img,
    service_type: account.service_type,
    signature: account.signature,
    addedAt: new Date().toISOString(),
  });
  await writeJson(files.accounts, next);
  console.log(`已添加公众号：${account.nickname} (${account.fakeid})`);
}

async function commandList(args) {
  const accounts = await readJson(files.accounts, []);
  if (accounts.length === 0) {
    console.log('公众号列表为空');
    return;
  }
  if (args['list-only']) {
    accounts.forEach((account, index) => console.log(formatAccount(account, index, Boolean(args.verbose))));
    return;
  }
  requireInteractiveTty('当前不是交互式终端，请使用 --list --list-only 仅打印列表，或使用 --remove <ID> 移除');

  let status = '';
  let busy = false;

  await runInteractiveMenu({
    getItems: () => accounts,
    header: () => status || '已保存公众号（↑/↓ 移动，d 移除，Esc/q/回车 退出）',
    renderItem: (account, index, isSelected) => {
      const marker = isSelected ? '\u001b[36m❯\u001b[0m' : ' ';
      const formatted = formatAccount(account, index, Boolean(args.verbose));
      const label = isSelected ? `\u001b[36m${formatted}\u001b[0m` : formatted;
      return `${marker} ${label}`;
    },
    isBusy: () => busy,
    onNavigate: () => {
      status = '';
    },
    onEnter: () => {
      process.stdout.write('\n');
    },
    onEscape: () => {
      process.stdout.write('\n');
    },
    onKey: async ({ text, selected, items, setSelected, render, cleanup, resolve, reject }) => {
      if (text !== 'd') return;
      busy = true;
      try {
        const [removed] = items.splice(selected, 1);
        await writeJson(files.accounts, items);
        if (items.length === 0) {
          cleanup();
          process.stdout.write(`\n已移除公众号：${removed.nickname}\n公众号列表为空\n`);
          resolve();
          return;
        }
        setSelected(Math.min(selected, items.length - 1));
        status = `已移除公众号：${removed.nickname}`;
        render();
      } catch (error) {
        cleanup();
        reject(error);
      } finally {
        busy = false;
      }
    },
  });
}

async function commandRemove(args) {
  const id = parseNumericArg(args.remove, '--remove 需要 --list 返回的数字 ID');
  const removed = await removeAccountById(id);
  console.log(`已移除公众号：${removed.nickname} (${removed.fakeid})`);
}

async function fetchArticlePage(auth, account, begin) {
  const { data } = await mpRequest(`${MP_BASE}/cgi-bin/appmsgpublish`, {
    query: {
      sub: 'list',
      search_field: 'null',
      begin,
      count: ARTICLE_LIST_PAGE_SIZE,
      query: '',
      fakeid: account.fakeid,
      type: '101_1',
      free_publish_type: 1,
      sub_action: 'list_ex',
      token: auth.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    cookies: auth.cookies,
  });
  if (data.base_resp?.ret !== 0) {
    throw new Error(`${data.base_resp?.ret}:${data.base_resp?.err_msg || '文章列表接口失败'}`);
  }
  return JSON.parse(data.publish_page);
}

// `article` is the freshly fetched WeChat record; `existing` (if any) is the previously
// stored local copy. Re-syncing must not wipe locally-added state like `downloadedAt`
// (set by `--download-all`) just because the article still shows up in a synced page.
function normalizeArticle(account, article, existing) {
  return {
    ...article,
    fakeid: account.fakeid,
    accountNickname: account.nickname,
    syncedAt: new Date().toISOString(),
    ...(existing?.downloadedAt ? { downloadedAt: existing.downloadedAt } : {}),
  };
}

async function syncOneAccount(store, auth, account, options) {
  const current = store[account.fakeid] || [];
  const startCount = current.length;
  const byKey = new Map(current.map(article => [article.aid, article]));
  const incremental = !options.full && current.length > 0;
  const articleLimit = incremental ? Number.POSITIVE_INFINITY : FULL_SYNC_ARTICLE_LIMIT;
  const sinceTs = dateToTs(options.since) || 0;
  let begin = 0;
  let processed = 0;

  const persist = async () => {
    store[account.fakeid] = Array.from(byKey.values()).sort((a, b) => b.create_time - a.create_time);
    await writeJson(files.articles, store);
  };

  // Persisted after every page (not just once at the end) so a network error or WeChat
  // rate-limit mid-sync doesn't throw away pages already fetched in this run.
  while (true) {
    const page = await fetchArticlePage(auth, account, begin);
    const publishList = (page.publish_list || []).filter(item => item.publish_info);
    if (publishList.length === 0) break;

    const pageArticles = publishList.flatMap(item => JSON.parse(item.publish_info).appmsgex || []);
    const articles = pageArticles.slice(0, articleLimit - processed);
    const newArticleCount = articles.filter(article => !byKey.has(article.aid)).length;
    for (const article of articles) {
      byKey.set(article.aid, normalizeArticle(account, article, byKey.get(article.aid)));
    }
    processed += articles.length;
    await persist();

    const messageCount = pageArticles.filter(article => article.itemidx === 1).length;
    begin += messageCount;
    const lastArticle = articles.at(-1);
    console.log(`${account.nickname}: 已同步 ${byKey.size} 篇，begin=${begin}`);

    if (sinceTs && lastArticle && lastArticle.create_time < sinceTs) break;
    if (processed >= articleLimit) {
      console.log(`${account.nickname}: 已达到全量同步上限 ${FULL_SYNC_ARTICLE_LIMIT} 篇`);
      break;
    }
    if (incremental && newArticleCount === 0) {
      console.log(`${account.nickname}: 已到达本地同步边界`);
      break;
    }
    if (messageCount === 0) break;
    await sleep(options.delay * 1000);
  }

  await persist();
  return { total: store[account.fakeid].length, touched: byKey.size - startCount, processed };
}

async function commandSync(args) {
  const auth = await loadAuth();
  const accounts = await readJson(files.accounts, []);
  if (args.id !== undefined && args.fakeid !== undefined) {
    throw new Error('--id 和 --fakeid 不能同时使用');
  }

  let targets = accounts;
  if (args.id !== undefined) {
    const id = parseNumericArg(args.id, '--id 需要 --list 返回的数字 ID');
    targets = [getAccountById(accounts, id)];
  } else if (args.fakeid !== undefined) {
    if (args.fakeid === true) throw new Error('--fakeid 需要公众号 fakeid');
    targets = accounts.filter(item => item.fakeid === args.fakeid);
    if (targets.length === 0) throw new Error(`未添加公众号：${args.fakeid}`);
  }
  if (targets.length === 0) throw new Error('公众号列表为空，请先 --search 添加');
  const delay = Number(args.delay || 2);
  const articles = await readJson(files.articles, {});
  const failures = [];
  for (const account of targets) {
    const mode = args.full || !articles[account.fakeid]?.length ? '全量' : '增量';
    console.log(`开始${mode}同步：${account.nickname} (${account.fakeid})`);
    try {
      const result = await syncOneAccount(articles, auth, account, {
        since: args.since,
        delay,
        full: Boolean(args.full),
      });
      const summary = [
        `完成：${account.nickname}`,
        `本次处理 ${result.processed} 篇`,
        `新增 ${result.touched} 篇`,
        `当前缓存 ${result.total} 篇`,
      ];
      console.log(summary.join('，'));
    } catch (error) {
      console.log(`同步失败：${account.nickname} (${account.fakeid})：${error.message}`);
      failures.push(account.nickname);
    }
  }
  if (failures.length > 0) {
    throw new Error(`以下公众号同步失败，已跳过（此前页面的进度已保存）：${failures.join('、')}`);
  }
}

async function commandClear(args) {
  if (args.id !== undefined && args.fakeid !== undefined) {
    throw new Error('--id 和 --fakeid 不能同时使用');
  }

  const articles = await readJson(files.articles, {});
  let fakeid;
  let nickname;

  if (args.id !== undefined) {
    const accounts = await readJson(files.accounts, []);
    const id = parseNumericArg(args.id, '--id 需要 --list 返回的数字 ID');
    const account = getAccountById(accounts, id);
    fakeid = account.fakeid;
    nickname = account.nickname;
  } else if (args.fakeid !== undefined) {
    if (args.fakeid === true) throw new Error('--fakeid 需要公众号 fakeid');
    const accounts = await readJson(files.accounts, []);
    fakeid = String(args.fakeid);
    nickname = accounts.find(account => account.fakeid === fakeid)?.nickname || fakeid;
  }

  if (fakeid) {
    const count = Array.isArray(articles[fakeid]) ? articles[fakeid].length : 0;
    delete articles[fakeid];
    await writeJson(files.articles, articles);
    console.log(`已清除同步数据：${nickname}，共 ${count} 篇文章索引`);
    return;
  }

  const count = Object.values(articles).reduce((total, list) => total + (Array.isArray(list) ? list.length : 0), 0);
  await writeJson(files.articles, {});
  console.log(`已清除全部同步数据，共 ${count} 篇文章索引`);
}

function dateToTs(value, endOfDay = false) {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59+08:00' : 'T00:00:00+08:00';
  return Math.floor(new Date(`${value}${suffix}`).getTime() / 1000);
}

async function commandExport(args) {
  const accounts = await readJson(files.accounts, []);
  const articles = await readJson(files.articles, {});
  const from = dateToTs(args.from);
  const to = dateToTs(args.to, true);
  const grouped = accounts.map(account => {
    const list = (articles[account.fakeid] || []).filter(article => {
      if (from && article.create_time < from) return false;
      if (to && article.create_time > to) return false;
      return true;
    });
    return {
      fakeid: account.fakeid,
      nickname: account.nickname,
      alias: account.alias,
      articleCount: list.length,
      articles: list,
    };
  });
  const output = {
    exportedAt: new Date().toISOString(),
    range: { from: args.from || null, to: args.to || null },
    accountCount: grouped.length,
    accounts: grouped,
  };
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) {
    await writeFile(path.resolve(String(args.out)), text, 'utf8');
    console.log(`已导出：${path.resolve(String(args.out))}`);
  } else {
    process.stdout.write(text);
  }
}

async function findArticle(identifier) {
  const articles = await readJson(files.articles, {});
  if (identifier.startsWith('http')) {
    const all = Object.values(articles).flat();
    return all.find(article => article.link === identifier) || { link: identifier, fakeid: 'unknown', aid: String(Date.now()) };
  }
  if (identifier.includes(':')) {
    const [fakeid, aid] = identifier.split(':');
    return (articles[fakeid] || []).find(article => article.aid === aid);
  }
  return Object.values(articles).flat().find(article => article.aid === identifier);
}

function validateHtml(html) {
  if (/\bid=["']js_article["']/.test(html)) return ['Success', null];
  const msg =
    html
      .match(/<div[^>]+class=["'][^"']*(?:weui-msg__title|mesg-block)[^"']*["'][^>]*>(?<value>[\s\S]*?)<\/div>/)
      ?.groups?.value?.replace(/<[^>]+>/g, '')
      .trim()
      .replace(/\s+/g, ' ') || '';
  if (msg) return ['Exception', msg];
  return ['Error', null];
}

function makeStaticHtml(html) {
  let output = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  output = output.replace(/<img\b[^>]*>/gi, tag => {
    const dataSrc = tag.match(/\sdata-src=(["'])([\s\S]*?)\1/i);
    if (!dataSrc) return tag;
    if (/\ssrc=(["'])[\s\S]*?\1/i.test(tag)) {
      return tag.replace(/\ssrc=(["'])[\s\S]*?\1/i, ` src=${dataSrc[1]}${dataSrc[2]}${dataSrc[1]}`);
    }
    return tag.replace(/<img\b/i, `<img src=${dataSrc[1]}${dataSrc[2]}${dataSrc[1]}`);
  });

  output = output.replace(/(\s(?:src|href)=["'])\/\//gi, '$1https://');

  const staticStyle = `
<style id="wae-static-html">
  #js_content { visibility: visible !important; opacity: 1 !important; }
  #js_content img { max-width: 100%; height: auto; }
</style>`;
  return /<\/head>/i.test(output) ? output.replace(/<\/head>/i, `${staticStyle}\n</head>`) : `${staticStyle}\n${output}`;
}

async function commandDownload(args) {
  const identifier = args.download;
  if (typeof identifier !== 'string') throw new Error('--download 需要 fakeid:aid、aid 或文章 URL');
  const article = await findArticle(identifier);
  if (!article?.link) throw new Error(`找不到文章：${identifier}`);

  const { data } = await mpRequest(article.link, { expect: 'text' });
  const [status, reason] = validateHtml(data);
  if (status !== 'Success') {
    throw new Error(`文章 HTML 下载异常：${status}${reason ? ` ${reason}` : ''}`);
  }

  let out = args.out ? path.resolve(String(args.out)) : null;
  if (out) {
    await mkdir(path.dirname(out), { recursive: true });
  } else {
    const dir = path.join(files.htmlDir, article.fakeid || 'unknown');
    await mkdir(dir, { recursive: true });
    out = path.join(dir, `${article.aid || Date.now()}.html`);
  }
  const outputHtml = args.raw ? data : makeStaticHtml(data);
  await writeFile(out, outputHtml, 'utf8');
  console.log(`已下载${args.raw ? '原始' : '静态'} HTML：${out}`);
}

// Pulls out the inner HTML of the `id="js_content"` element (WeChat's article body wrapper)
// by counting matching open/close tags of that element's own tag name, so nested elements
// with the same tag name don't prematurely close the match. Returns null if not found
// (e.g. non-standard article types like image shares, per AGENTS.md).
function extractContentHtml(html) {
  const openMatch = html.match(/<([a-z][\w:-]*)\b[^>]*\bid=["']js_content["'][^>]*>/i);
  if (!openMatch) return null;
  const tagName = openMatch[1];
  const startIdx = openMatch.index + openMatch[0].length;
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  let depth = 1;
  let cursor = startIdx;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return html.slice(startIdx);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return html.slice(startIdx, nextClose.index);
    }
  }
  return null;
}

const markdownConverter = new NodeHtmlMarkdown({ ignore: ['img', 'script', 'style'] });

function convertToMarkdown(contentHtml) {
  return markdownConverter.translate(contentHtml).trim();
}

const HTML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtmlEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|amp|quot|apos|nbsp);/g, (_, name) => HTML_ENTITIES[name]);
}

// Image-share articles (item_show_type=8) have no #js_content — the caption text instead
// ships as a JS string literal (`window.desc = "..."`), hex-escaped (`\xHH`) and with any
// embedded HTML further entity-escaped (`&lt;a ...&gt;` etc). Converting `\xHH` to `\u00HH`
// lets JSON.parse do the JS-string unescaping, then a second entity-decode pass recovers
// any real embedded markup before handing it to the same HTML->Markdown converter.
function extractDescMarkdown(html) {
  const match = html.match(/window\.desc\s*=\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  let raw;
  try {
    raw = JSON.parse(`"${match[1].replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')}"`);
  } catch {
    return null;
  }
  const decoded = decodeHtmlEntities(raw);
  const paragraphHtml = decoded
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  if (!paragraphHtml) return null;
  return convertToMarkdown(paragraphHtml);
}

function extractArticleMarkdown(html) {
  const contentHtml = extractContentHtml(html);
  if (contentHtml) return convertToMarkdown(contentHtml);
  return extractDescMarkdown(html);
}

async function commandDownloadAll(args) {
  if (args.id !== undefined && args.fakeid !== undefined) {
    throw new Error('--id 和 --fakeid 不能同时使用');
  }

  const accounts = await readJson(files.accounts, []);
  let targetAccounts = accounts;
  if (args.id !== undefined) {
    const id = parseNumericArg(args.id, '--id 需要 --list 返回的数字 ID');
    targetAccounts = [getAccountById(accounts, id)];
  } else if (args.fakeid !== undefined) {
    if (args.fakeid === true) throw new Error('--fakeid 需要公众号 fakeid');
    targetAccounts = accounts.filter(item => item.fakeid === args.fakeid);
    if (targetAccounts.length === 0) throw new Error(`未添加公众号：${args.fakeid}`);
  }
  if (targetAccounts.length === 0) throw new Error('公众号列表为空，请先 --search 添加');

  const limit = args.limit === undefined ? DOWNLOAD_ALL_DEFAULT_LIMIT : Number(args.limit);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('--limit 需要正整数');
  }
  const delay = Number(args.delay || 2);
  const outBase = args.out ? path.resolve(String(args.out)) : files.mdDir;

  const articles = await readJson(files.articles, {});
  const accountByFakeid = new Map(accounts.map(account => [account.fakeid, account]));

  // Not specifying --id/--fakeid pools undownloaded articles across ALL accounts and still
  // caps at `limit` total (not per account), so a large account list can't balloon a single
  // invocation into hundreds of requests against WeChat's anti-scraping limits.
  const candidates = targetAccounts
    .flatMap(account => (articles[account.fakeid] || []).filter(article => !article.downloadedAt))
    .sort((a, b) => b.create_time - a.create_time)
    .slice(0, limit);

  if (candidates.length === 0) {
    console.log('没有待下载的文章（可能都已下载，或尚未 --sync）。');
    return;
  }

  console.log(`本次将下载 ${candidates.length} 篇未下载文章，每篇间隔 ${delay} 秒`);

  let downloaded = 0;
  let failed = 0;
  for (const article of candidates) {
    const account = accountByFakeid.get(article.fakeid);
    const label = `${account?.nickname || article.fakeid}《${article.title || article.aid}》`;
    try {
      const { data } = await mpRequest(article.link, { expect: 'text' });
      const [status, reason] = validateHtml(data);
      if (status !== 'Success') {
        throw new Error(`HTML 异常：${status}${reason ? ` ${reason}` : ''}`);
      }
      const markdown = extractArticleMarkdown(data);
      if (!markdown) {
        throw new Error('未找到正文内容（既不是标准图文也不是图片分享）');
      }
      const dir = path.join(outBase, article.fakeid);
      await mkdir(dir, { recursive: true });
      const outPath = path.join(dir, `${article.aid}.md`);
      const heading = article.title ? `# ${article.title}\n\n` : '';
      await writeFile(outPath, `${heading}${markdown}\n`, 'utf8');

      article.downloadedAt = new Date().toISOString();
      article.mdPath = outPath;
      await writeJson(files.articles, articles);
      downloaded++;
      console.log(`已下载：${label} -> ${outPath}`);
    } catch (error) {
      failed++;
      console.log(`下载失败：${label}：${error.message}`);
    }
    if (article !== candidates.at(-1)) {
      await sleep(delay * 1000);
    }
  }

  console.log(`完成：成功 ${downloaded} 篇，失败 ${failed} 篇`);
  if (failed > 0) {
    throw new Error(`${failed} 篇文章下载失败，可重新执行 --download-all 重试（已成功的文章会自动跳过）`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureDataDir();

  if (args.help || Object.keys(args).length === 1) {
    console.log(usage());
  } else if (args.status) {
    await commandStatus();
  } else if (args.login) {
    await commandLogin(args);
  } else if (args.logout) {
    await commandLogout();
  } else if (args.search) {
    await commandSearch(args);
  } else if (args.list) {
    await commandList(args);
  } else if (args.remove) {
    await commandRemove(args);
  } else if (args.clear) {
    await commandClear(args);
  } else if (args.sync) {
    await commandSync(args);
  } else if (args.export) {
    await commandExport(args);
  } else if (args.download) {
    await commandDownload(args);
  } else if (args['download-all']) {
    await commandDownloadAll(args);
  } else {
    console.log(usage());
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
