import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../utils/prisma';

// 不统计的前缀（管理后台 / 上传文件 / API）
const EXCLUDED_PREFIXES = ['/api', '/admin', '/uploads'];
// 不统计的静态资源扩展名
const EXCLUDED_EXTS = new Set([
  'css', 'js', 'mjs', 'map', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'eot', 'otf', 'txt', 'xml', 'json', 'pdf', 'mp4', 'webm',
]);

/**
 * 页面访问埋点中间件
 * - 仅统计前台 HTML 页面 GET 请求（站点根路径 / 或 *.html）
 * - 访客标识：cookie __gv（uuid，一年有效）；无 cookie 时回退 ip+ua hash
 * - fire-and-forget 异步写入，不阻塞响应
 */
export function pageViewTracker(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.method !== 'GET') return next();
    const pathname = (req.path || '/').split('?')[0];
    if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return next();

    const ext = pathname.includes('.') ? pathname.split('.').pop()?.toLowerCase() || '' : '';
    const isPage = pathname === '/' || ext === 'html' || (!pathname.includes('.') && pathname !== '/');
    if (!isPage || EXCLUDED_EXTS.has(ext)) return next();

    // 访客标识：优先 cookie
    let visitorId = (req.cookies as Record<string, string> | undefined)?.__gv || '';
    if (!visitorId) {
      visitorId = crypto.createHash('md5').update(req.ip + '|' + (req.headers['user-agent'] || '')).digest('hex').slice(0, 16);
    }
    const path = pathname === '/' ? '/(首页)' : pathname;
    prisma.pageView.create({
      data: {
        path,
        visitorId,
        ip: req.ip || null,
        ua: (req.headers['user-agent'] || '').slice(0, 250) || null,
        referer: (req.headers.referer || '').slice(0, 250) || null,
      },
    }).catch(() => { /* 统计失败不影响业务 */ });

    // 下发访客 cookie（无则种一年）
    if (!(req.cookies as Record<string, string> | undefined)?.__gv) {
      res.cookie('__gv', crypto.randomUUID(), { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax' });
    }
  } catch {
    // 埋点异常不阻塞
  }
  next();
}
