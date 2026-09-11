import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';
import { prisma } from '../utils/prisma';
import { newWithFileOnly, defaultDbFile } from 'ip2region-ts';
import { isSourceNoise } from '../utils/visit-filter';

// 不统计的静态资源扩展名
const EXCLUDED_EXTS = new Set([
  'css', 'js', 'mjs', 'map', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'eot', 'otf', 'txt', 'xml', 'json', 'pdf', 'mp4', 'webm',
]);

// ip2region 搜索器（惰性初始化，进程级复用）
let ipSearcher: ReturnType<typeof newWithFileOnly> | null = null;

/**
 * 页面访问埋点中间件
 * - 仅统计前台 HTML 页面 GET 请求（站点根路径 / 或 *.html / 无扩展名路由）
 * - 访客标识：cookie __gv（uuid，一年有效）；无 cookie 时回退 ip+ua hash
 * - fire-and-forget 异步写入，不阻塞响应
 *
 * ⚠️ 口径（2026-09-11 治理，原口径曾使 PV 虚高 6 倍）：
 *   1. HTML 片段不入库 —— header/footer/quickLinks/world/account-menu 等由 jQuery .load()
 *      拉取，它们同样以 .html 结尾，此前每次页面浏览会多记 5~6 条
 *   2. 爬虫 / 脚本 / 扫描路径 / 内网 IP 不入库 —— 见 utils/visit-filter.ts
 *   3. **仅在响应状态码为 200 时落库** —— 扫描器的 /containers/json、/_profiler/phpinfo、
 *      /jsonapi/node/article、/fr.html 等一律 404，按状态码过滤比维护扫描路径黑名单彻底；
 *      顺带消除 301 重复计数（/xxx → 301 → /xxx.html 200 此前两次都记）
 *   4. 自测出口 IP 在源头保留（可审计），只在统计层剔除 —— 见 visit-filter.ts 的 SELF_IPS
 */
export function pageViewTracker(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.method !== 'GET') return next();
    const pathname = (req.path || '/').split('?')[0];

    const ext = pathname.includes('.') ? pathname.split('.').pop()?.toLowerCase() || '' : '';
    const isPage = pathname === '/' || ext === 'html' || (!pathname.includes('.') && pathname !== '/');
    if (!isPage || EXCLUDED_EXTS.has(ext)) return next();

    // 口径过滤一：片段 / 非页面 / 扫描路径 / 爬虫脚本 UA / 内网 IP
    const clientIp = req.ip || '';
    const clientUa = req.headers['user-agent'] || '';
    if (isSourceNoise({ path: pathname, ip: clientIp, ua: clientUa })) return next();

    // 访客标识：优先 cookie
    let visitorId = (req.cookies as Record<string, string> | undefined)?.__gv || '';
    if (!visitorId) {
      visitorId = crypto.createHash('md5').update(clientIp + '|' + clientUa).digest('hex').slice(0, 16);
    }
    const path = pathname === '/' ? '/(首页)' : pathname;

    // 口径过滤二：等响应结束，仅 200 才落库（异步链，失败不影响业务）
    res.on('finish', () => {
      if (res.statusCode !== 200) return;
      Promise.resolve()
        .then(async () => {
          let region: string | null = null;
          try {
            const searcher = ipSearcher || (ipSearcher = newWithFileOnly(defaultDbFile));
            const r = await searcher.search(clientIp);
            if (r && r.region) {
              const parts = r.region.split('|');
              const country = parts[0] && parts[0] !== '0' ? parts[0] : '';
              const province = parts[2] && parts[2] !== '0' ? parts[2] : '';
              if (country === '0' && province.includes('内网')) region = '内网|';
              else if (country) region = country + '|' + province;
            }
          } catch { /* 解析失败忽略 */ }
          return prisma.pageView.create({
            data: {
              path,
              visitorId,
              ip: clientIp || null,
              ua: clientUa.slice(0, 250) || null,
              referer: (req.headers.referer || '').slice(0, 250) || null,
              region,
            },
          });
        })
        .catch(() => { /* 统计失败不影响业务 */ });
    });

    // 下发访客 cookie（无则种一年）
    if (!(req.cookies as Record<string, string> | undefined)?.__gv) {
      res.cookie('__gv', crypto.randomUUID(), { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax' });
    }
  } catch {
    // 埋点异常不阻塞
  }
  next();
}
