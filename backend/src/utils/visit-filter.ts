/**
 * 访问统计过滤口径（2026-09-11）
 *
 * 背景：原埋点只按「GET + 非静态资源 + 是页面」记录，导致三类噪声混入统计：
 *   1. 页头/页脚等 HTML 片段（jQuery .load 拉取）也被当成页面 → 每次浏览多记 5~6 条
 *   2. 无爬虫 UA 过滤 → AI 爬虫 / 安全扫描器 / curl 全数入库
 *   3. 无内网与自测 IP 排除 → 本地与自测流量占比可达 80% 以上
 * 线上实测：8282 条记录逐层剥离后，真实外部访问只剩 32 条（放大 6.07 倍）。
 *
 * 分层策略：
 *   - 源头（middleware/tracker.ts）只丢弃「高置信度噪声」——片段 / 非页面 / 扫描路径 /
 *     爬虫脚本 UA / 内网 IP。这些不可能是真人，丢弃后库里只剩干净数据。
 *   - 统计层（controllers/stats.controller.ts）再叠加「自测出口 IP」过滤。自测 IP 属于
 *     推定判断（万一判断有误会误杀真实客户），所以**原始记录仍保留在库内**可审计，
 *     只在展示口径里剔除 —— 改白名单只改本文件 SELF_IPS，历史统计立刻跟着变。
 *
 * ⚠️ 两处共用本文件，口径必须一致；调整规则只改这里，不要在两处各写一份。
 */

/** 页头 / 页脚 / 菜单等 HTML 片段路径（前台 jQuery .load 异步拉取），不是页面 */
export const FRAGMENT_PATHS = new Set([
  '/header.html',
  '/footer.html',
  '/quickLinks.html',
  '/world.html',
  '/account-menu.html',
  '/account-menu-after-login.html',
  '/search-dialog.html',
]);

/** 非页面路径前缀：接口 / 后台 / 上传 / 内部代理通道 */
const NON_PAGE_PREFIX_RE = /^\/(?:api|admin|uploads|fetch|proxy)(?:\/|$)/i;

/** 静态目录被当成 .html 命中（如 /themes/.../favicons/site.html） */
const PSEUDO_HTML_RE = /\/favicons\//i;

/** 漏洞扫描 / 服务探测路径 */
const SCAN_PATH_RE =
  /(?:\/wp-|phpmyadmin|\.env|xmlrpc|\.git|backup|shell|eval|setup|install|vendor|\.php|\.sql|manager\/|druid|actuator|jenkins)/i;

/** 爬虫 / 脚本 UA 特征（含 AI 爬虫与安全扫描器） */
const BOT_UA_RE =
  /(?:bot|spider|crawl|slurp|yandex|ahrefs|semrush|mj12|dotbot|petal|bytespider|facebookexternalhit|telegrambot|whatsapp|python-requests|python-urllib|curl\/|wget\/|go-http-client|okhttp|java\/|scrapy|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|uptime|monitor|nmap|masscan|zmap|censys|expanse|dataprovider|zgrab|nuclei|sqlmap|nikto|gobuster|sogou|360spider|baiduspider|yisouspider|shenmaspider|toutiaospider|gptbot|claudebot|ccbot|perplexity|amazonbot|applebot|duckduckbot|petalbot|seznam|bravebot|qqbot|headless|grokbot|oai-searchbot|searchbot)/i;

/**
 * 自测 / 内部出口 IP 白名单（仅统计层剔除，原始记录保留在库）
 * - 139.227.67.39、183.195.186.70 为上海自测出口，长期贡献全站 82% 记录；
 *   单一 cookie 身份 `8986cace-…` 横跨这两个 IP 产生 5418 条、凌晨 0~4 时仍在访问，
 *   判定为自测/巡检流量而非真实客户。
 * - ⚠️ 出口 IP 会随网络变化，新增/删除只改这一行即可。
 */
export const SELF_IPS = new Set(['139.227.67.39', '183.195.186.70']);

function normIp(ip: string | null | undefined): string {
  return (ip || '').replace(/^::ffff:/i, '').trim();
}

/** HTML 片段（不是页面） */
export function isFragmentPath(path: string): boolean {
  return FRAGMENT_PATHS.has(path) || PSEUDO_HTML_RE.test(path);
}

/** 非页面路径（接口 / 上传 / 代理） */
export function isNonPagePath(path: string): boolean {
  return NON_PAGE_PREFIX_RE.test(path);
}

/** 漏洞扫描 / 服务探测路径 */
export function isScanPath(path: string): boolean {
  return SCAN_PATH_RE.test(path);
}

/** 爬虫 / 脚本 UA；空 UA 一并视为非真人 */
export function isBotUa(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true;
  return BOT_UA_RE.test(ua);
}

/** 内网 / 环回地址 */
export function isInternalIp(ip: string | null | undefined): boolean {
  const v = normIp(ip);
  if (!v) return true;
  if (v === '::1' || v === 'localhost') return true;
  if (v.startsWith('127.')) return true;
  if (v.startsWith('10.') || v.startsWith('192.168.')) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(v)) return true;
  return false;
}

/** 自测 / 内部出口 IP */
export function isSelfTraffic(ip: string | null | undefined): boolean {
  return SELF_IPS.has(normIp(ip));
}

export interface VisitLike {
  path?: string | null;
  ip?: string | null;
  ua?: string | null;
}

/**
 * 高置信度噪声：不可能是真人，埋点层直接丢弃（不入库）
 * 判定项：片段 / 非页面 / 扫描路径 / 爬虫脚本 UA / 内网 IP
 */
export function isSourceNoise(v: VisitLike): boolean {
  const p = (v.path || '').trim();
  if (!p) return true;
  if (isFragmentPath(p)) return true;
  if (isNonPagePath(p)) return true;
  if (isScanPath(p)) return true;
  if (isBotUa(v.ua)) return true;
  if (isInternalIp(v.ip)) return true;
  return false;
}

/**
 * 是否计入统计口径（统计层用）
 * = 非高置信度噪声，且不属于自测出口 IP
 */
export function isCountableVisit(v: VisitLike): boolean {
  if (isSourceNoise(v)) return false;
  return !isSelfTraffic(v.ip);
}
