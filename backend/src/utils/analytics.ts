/**
 * 访问分析共用工具（2026-09-12）
 * ============================================================================
 * 两处埋点共用同一套「属地解析」与「访客标识」口径：
 *   - middleware/tracker.ts        → page_views   （流量口径：按页面路径）
 *   - controllers/track.controller → content_views（业务口径：按内容对象）
 *
 * ⚠️ 口径只改这一个文件。历史上两处各写一份是这个项目反复踩的坑
 *    （见 utils/visit-filter.ts 顶部注释）。
 */
import crypto from 'crypto';
import type { Request } from 'express';
import { newWithFileOnly, defaultDbFile } from 'ip2region-ts';

/** ip2region 搜索器（惰性初始化，进程级复用） */
let ipSearcher: ReturnType<typeof newWithFileOnly> | null = null;

/**
 * 解析 IP 归属地 → "国家|省份"（如 `中国|上海`、`美国|`）
 * 解析失败或无法判定时返回 null（不写脏值）。
 * 内网地址返回 `内网|`，与 page_views 里历史数据的写法保持一致。
 */
export async function resolveRegion(ip: string): Promise<string | null> {
  try {
    const searcher = ipSearcher || (ipSearcher = newWithFileOnly(defaultDbFile));
    const r = await searcher.search(ip);
    if (!r || !r.region) return null;
    const parts = r.region.split('|');
    const country = parts[0] && parts[0] !== '0' ? parts[0] : '';
    const province = parts[2] && parts[2] !== '0' ? parts[2] : '';
    if (country === '0' && province.includes('内网')) return '内网|';
    if (country) return country + '|' + province;
    return null;
  } catch {
    return null;
  }
}

/** 访客标识：优先 cookie `__gv`（一年有效），无则回退 ip+ua 的 md5 前 16 位 */
export function resolveVisitorId(req: Request): { visitorId: string; fromCookie: boolean } {
  const cookies = req.cookies as Record<string, string> | undefined;
  const cookieId = cookies?.__gv || '';
  if (cookieId) return { visitorId: cookieId, fromCookie: true };
  const ip = req.ip || '';
  const ua = (req.headers['user-agent'] as string) || '';
  return {
    visitorId: crypto.createHash('md5').update(ip + '|' + ua).digest('hex').slice(0, 16),
    fromCookie: false,
  };
}
