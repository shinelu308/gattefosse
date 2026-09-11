/**
 * 内容浏览埋点采集接口（2026-09-12）
 * ============================================================================
 * 路由：POST /api/track/content（公开，无需鉴权）
 * 写入：content_views 表
 *
 * 为什么要有这个接口：
 *   `page_views` 的 path 是**去掉 query** 的页面路径，产品详情页 57 个产品全压成一条，
 *   资料（PDF）走静态直链更是完全收不到。营销上需要「哪个产品 / 哪份资料被看得多」，
 *   只能由前端在**数据加载完成后**显式上报对象身份。
 *
 * 请求体（前端 site/static/js/track-*.js 组装）：
 *   {
 *     "path": "/personal-care/product-finder/product-detail.html",   // 当前页面路径（去 query）
 *     "events": [
 *       { "type":"pc_product", "id":"10920", "name":"产品名",
 *         "section":"personal_care", "event":"view" },
 *       { "type":"document", "id":"doc-7", "name":"技术数据表",
 *         "section":"personal_care", "event":"download",
 *         "parentId":"10920", "parentName":"产品名" }
 *     ]
 *   }
 *
 * 口径分层（与 page_views 同思路，详见 utils/visit-filter.ts）：
 *   - 写入层只挡「爬虫 / 脚本 UA」这类高置信噪声；
 *   - 内网 IP、自测出口 IP **照写不误**（本地自测能落库，便于验证），
 *     由展示层 isCountableView() 剔除。改白名单只改 visit-filter.ts。
 *
 * 防刷：同一 visitorId + type + id + event 在 DEDUPE_WINDOW_MS 内只落一条
 *   （防止用户反复刷新、或前端队列重试造成重复计数）。
 */
import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { success } from '../utils/response';
import { isBotUa } from '../utils/visit-filter';
import { resolveRegion, resolveVisitorId } from '../utils/analytics';

/** 允许的对象类型白名单 —— 与后台「内容热度」页的分组、前端埋点调用必须一致 */
export const ALLOWED_TYPES = new Set([
  'pc_product',       // 个人护理原料
  'formulation',      // 应用配方
  'pharma_product',   // 药用辅料
  'article',          // 文章（含技术文章 / 热点话题 / 出版物）
  'news',             // 新闻
  'event',            // 活动
  'document',         // 资料（PDF 等）
]);

/** 允许的板块 —— 后台按板块分 Tab */
export const ALLOWED_SECTIONS = new Set(['personal_care', 'pharma', 'news', 'learn_more']);

/** 允许的事件类型：view=打开详情页，download=打开/下载资料 */
const ALLOWED_EVENTS = new Set(['view', 'download']);

const MAX_EVENTS = 20;          // 单次请求最多事件数
const DEDUPE_WINDOW_MS = 30_000; // 去重时间窗
const MAX_ID_LEN = 120;
const MAX_NAME_LEN = 200;
const MAX_PATH_LEN = 200;

/** 去重表：key = visitorId|type|id|event → 上次落库时间戳（进程级，重启即清空） */
const recentKeys = new Map<string, number>();

function pruneDedupe(now: number) {
  if (recentKeys.size < 5000) return;
  for (const [k, t] of recentKeys) {
    if (now - t > DEDUPE_WINDOW_MS) recentKeys.delete(k);
  }
}

/**
 * 对象标识：允许中英文、数字、点、冒号、连字符、下划线；
 * 禁止空白 / 斜杠 / 引号 / 尖括号 / 反斜杠 —— 既容得下中文文件名（PDF 名），
 * 又不给脏值留注入空间。
 */
const ID_RE = /^[^<>"'`\\/\s]{1,120}$/;

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** 页面路径归一：去 query/hash，必须以 / 开头 */
function normalizePagePath(v: unknown): string | null {
  const s = cleanStr(v, MAX_PATH_LEN + 40);
  if (!s) return null;
  const p = s.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) return null;
  return p.slice(0, MAX_PATH_LEN);
}

export async function trackContent(req: Request, res: Response) {
  const ok = (accepted: number, reason?: string) =>
    res.json(success(reason ? { accepted, reason } : { accepted }));

  try {
    // express.json 已解析 application/json；非 json Content-Type（部分浏览器 sendBeacon
    // 会把 Blob 标成 text/plain）由路由级 express.text 兜底成字符串，这里自行解析
    let body: any = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const rawList = body && Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
    if (!rawList.length) return ok(0, 'empty');

    const clientIp = req.ip || '';
    const clientUa = (req.headers['user-agent'] as string) || '';

    // 访客标识 + 补种 cookie：**放在所有早返回之前**，保证任何一次上报都让匿名访客拿到 __gv
    //（否则「首次上报恰好被去重/过滤」时不下发 cookie，该访客会长期退化为 ip+ua hash 口径）
    const { visitorId, fromCookie } = resolveVisitorId(req);
    if (!fromCookie) {
      res.cookie('__gv', crypto.randomUUID(), { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax' });
    }

    // 写入层唯一的高置信噪声拦截：爬虫 / 脚本 UA
    if (isBotUa(clientUa)) return ok(0, 'bot');

    const pagePath = normalizePagePath(body.path) || normalizePagePath(req.headers.referer) || null;

    const now = Date.now();
    pruneDedupe(now);

    const rows: Array<Record<string, unknown>> = [];
    for (const e of rawList) {
      if (!e || typeof e !== 'object') continue;
      const type = cleanStr(e.type, 32);
      if (!type || !ALLOWED_TYPES.has(type)) continue;

      const rawId = cleanStr(e.id, MAX_ID_LEN + 20);
      if (!rawId || !ID_RE.test(rawId)) continue;

      const eventType = ALLOWED_EVENTS.has(e.event) ? e.event : 'view';
      const section = ALLOWED_SECTIONS.has(e.section) ? e.section : null;

      // 资料类事件：parentId 是归属对象（哪个产品下打开的这份 PDF）
      const parentRaw = cleanStr(e.parentId, MAX_ID_LEN + 20);
      const parentId = parentRaw && ID_RE.test(parentRaw) ? parentRaw : null;

      // 去重：同一访客 30 秒内对同一对象同一事件只记一次
      const key = visitorId + '|' + type + '|' + rawId + '|' + eventType;
      const last = recentKeys.get(key);
      if (last && now - last < DEDUPE_WINDOW_MS) continue;
      recentKeys.set(key, now);

      rows.push({
        objectType: type,
        objectId: rawId,
        objectName: cleanStr(e.name, MAX_NAME_LEN),
        section,
        eventType,
        pagePath,
        parentId,
        parentName: cleanStr(e.parentName, MAX_NAME_LEN),
        visitorId,
        ip: clientIp || null,
        ua: clientUa.slice(0, 250) || null,
        referer: (req.headers.referer || '').slice(0, 250) || null,
      });
    }

    if (!rows.length) return ok(0, 'filtered');

    // 属地解析只做一次，批量共用
    const region = await resolveRegion(clientIp);
    for (const r of rows) r.region = region;

    // 逐条 create（SQLite 的 createMany 支持情况随版本而变，条数 ≤20，稳妥优先）
    let accepted = 0;
    for (const data of rows) {
      try {
        await prisma.contentView.create({ data: data as any });
        accepted++;
      } catch { /* 单条失败不影响其余 */ }
    }

    return ok(accepted);
  } catch {
    // 埋点异常绝不影响业务
    return ok(0, 'error');
  }
}
