/**
 * 内容热度聚合接口（2026-09-12）
 * ============================================================================
 * 路由：GET /api/stats/content-heat（编辑员及以上可见）
 * 数据源：content_views（由 POST /api/track/content 写入）
 *
 * 与 stats.controller.ts 的 getVisitOverview 的分工：
 *   - /api/stats/overview     → 流量口径：今日/昨日/累计 PV·UV、地区、页面 TOP
 *   - /api/stats/content-heat → 业务口径：哪个**产品 / 资料 / 文章**被看得多
 *
 * 查询参数：
 *   range   7d | 30d | 90d | all   默认 7d
 *   section personal_care | pharma | news | learn_more   可选，不传则返回全部板块
 *   withZero 1 时额外返回「未被浏览过的对象」清单（营销上要知道哪些产品没人看）
 *
 * ⚠️ 展示口径统一走 utils/visit-filter.ts 的 isCountableView()：爬虫 UA / 内网 IP /
 *    自测出口 IP 一律剔除。改白名单只改那个文件，历史统计立刻跟着变。
 */
import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { isCountableView } from '../utils/visit-filter';

/** 时间窗（天）；all = 不限 */
const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, all: 0 };

/** 单次最多加载行数（内存聚合，超出按最新截断；表增长到百万级后应改为 SQL GROUP BY） */
const MAX_ROWS = 50000;

/** 每个分组展示的条数 */
const TOP_N = 20;

/** 板块清单（后台 Tab 顺序） */
const SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'personal_care', label: '个人护理' },
  { key: 'pharma', label: '药用辅料' },
  { key: 'news', label: '新闻与活动' },
  { key: 'learn_more', label: '了解更多' },
  { key: 'other', label: '未归类' },
];

const TYPE_LABELS: Record<string, string> = {
  pc_product: '个人护理原料',
  pharma_product: '药用辅料',
  formulation: '应用配方',
  article: '文章',
  news: '新闻',
  event: '活动',
  document: '资料',
};

/** 分组内的展示顺序：产品 → 文章 → 新闻活动 → 资料 */
const TYPE_ORDER = [
  'pc_product', 'pharma_product', 'formulation',
  'article', 'news', 'event',
  'document',
];

/** 本地日期 key（YYYY-MM-DD），用于近 7 天趋势分桶（避免 UTC 偏移把凌晨算到前一天） */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/** 近 7 天的日期 key（旧 → 新） */
function last7DayKeys(): { keys: string[]; index: Record<string, number> } {
  const keys: string[] = [];
  const index: Record<string, number> = {};
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    keys.push(dayKey(d));
  }
  keys.forEach((k, i) => { index[k] = i; });
  return { keys, index };
}

interface Acc {
  id: string;
  name: string;
  pv: number;
  visitors: Set<string>;
  lastAt: Date | null;
  spark: number[];
  parentName: string | null;
}

interface HeatItem {
  id: string;
  name: string;
  pv: number;
  uv: number;
  lastAt: string | null;
  spark: number[];
  parentName?: string | null;
}

interface HeatGroup {
  type: string;
  label: string;
  total?: number;   // 库中该类型的对象总数（分母，仅四个可精确统计的类型有）
  viewed: number;   // 本期被浏览过的不同对象数
  items: HeatItem[];
}

/** 各类型在库中的对象总数（作为「被浏览覆盖率」的分母） */
async function loadTotals(): Promise<Record<string, number | undefined>> {
  const [pc, pharma, formulation, doc, art, news, event] = await Promise.all([
    prisma.pcIngredient.count({ where: { isPublished: true } }).catch(() => undefined),
    prisma.pharmaProduct.count({ where: { isPublished: true } }).catch(() => undefined),
    prisma.formulation.count({ where: { isPublished: true } }).catch(() => undefined),
    prisma.document.count({ where: { isPublic: true } }).catch(() => undefined),
    prisma.newsEvent
      .count({ where: { isPublished: true, type: { in: ['article', 'webinar', 'publication', 'magazine'] } } })
      .catch(() => undefined),
    prisma.newsEvent.count({ where: { isPublished: true, type: 'news' } }).catch(() => undefined),
    prisma.newsEvent.count({ where: { isPublished: true, type: 'event' } }).catch(() => undefined),
  ]);
  return {
    pc_product: pc, pharma_product: pharma, formulation,
    document: doc, article: art, news, event,
  };
}

/** 未被浏览过的对象（清单仅取 id + 名称） */
async function loadUnviewed(viewedKeys: Set<string>): Promise<Record<string, HeatItem[]>> {
  const pick = <T extends { id: number }>(rows: T[], nameOf: (r: T) => string, type: string): HeatItem[] =>
    rows
      .filter((r) => !viewedKeys.has(type + '|' + String(r.id)))
      .map((r) => ({ id: String(r.id), name: nameOf(r) || '(未命名)', pv: 0, uv: 0, lastAt: null, spark: [] }));

  const [pc, pharma, formulation, docs] = await Promise.all([
    prisma.pcIngredient.findMany({ where: { isPublished: true }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }).catch(() => []),
    prisma.pharmaProduct.findMany({ where: { isPublished: true }, select: { id: true, name: true } }).catch(() => []),
    prisma.formulation.findMany({ where: { isPublished: true }, select: { id: true, name: true } }).catch(() => []),
    prisma.document.findMany({ where: { isPublic: true }, select: { id: true, title: true } }).catch(() => []),
  ]);

  return {
    pc_product: pick(pc as any[], (r: any) => r.name, 'pc_product'),
    pharma_product: pick(pharma as any[], (r: any) => r.name, 'pharma_product'),
    formulation: pick(formulation as any[], (r: any) => r.name, 'formulation'),
    document: pick(docs as any[], (r: any) => r.title, 'document'),
  };
}

export async function getContentHeat(req: Request, res: Response) {
  try {
    const rangeKey = typeof req.query.range === 'string' && RANGES[req.query.range] !== undefined
      ? req.query.range
      : '7d';
    const days = RANGES[rangeKey];
    const since = days > 0 ? new Date(Date.now() - days * 86400000) : null;

    const sectionQ = typeof req.query.section === 'string' ? req.query.section : '';
    const sectionFilter = SECTIONS.some((s) => s.key === sectionQ) ? sectionQ : null;

    const withZero = req.query.withZero === '1' || req.query.withZero === 'true';

    const rows = await prisma.contentView.findMany({
      where: since ? { createdAt: { gte: since } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });

    const { keys: dayKeys, index: dayIndex } = last7DayKeys();

    // 聚合：section | type | objectId
    const acc = new Map<string, Acc>();
    const totalVisitors = new Set<string>();
    let countable = 0;

    for (const r of rows) {
      // 展示口径：爬虫 / 内网 / 自测出口 IP 一律剔除
      if (!isCountableView({ ip: r.ip, ua: r.ua })) continue;
      countable++;
      totalVisitors.add(r.visitorId);

      const section = r.section && SECTIONS.some((s) => s.key === r.section) ? r.section : 'other';
      const key = section + '|' + r.objectType + '|' + r.objectId;

      let a = acc.get(key);
      if (!a) {
        a = { id: r.objectId, name: r.objectName || r.objectId, pv: 0, visitors: new Set(), lastAt: null, spark: new Array(7).fill(0), parentName: r.parentName || null };
        acc.set(key, a);
      }
      a.pv++;
      a.visitors.add(r.visitorId);
      if (r.objectName) a.name = r.objectName;              // 取最新的名称快照
      if (r.parentName) a.parentName = r.parentName;
      if (!a.lastAt || r.createdAt > a.lastAt) a.lastAt = r.createdAt;
      const di = dayIndex[dayKey(r.createdAt)];
      if (di !== undefined) a.spark[di]++;
    }

    // 按板块 → 类型 组装
    const totals = await loadTotals();

    const viewedKeys = new Set<string>();
    for (const [key] of acc) {
      const parts = key.split('|');
      viewedKeys.add(parts[1] + '|' + parts[2]);
    }

    const sectionsOut: Array<{ key: string; label: string; groups: HeatGroup[]; pv: number; uv: number }> = [];

    for (const s of SECTIONS) {
      if (sectionFilter && s.key !== sectionFilter) continue;

      const groups: HeatGroup[] = [];
      let sectionPv = 0;
      const sectionVisitors = new Set<string>();

      for (const type of TYPE_ORDER) {
        const items: HeatItem[] = [];
        for (const [key, a] of acc) {
          const parts = key.split('|');
          if (parts[0] !== s.key || parts[1] !== type) continue;
          items.push({
            id: a.id,
            name: a.name,
            pv: a.pv,
            uv: a.visitors.size,
            lastAt: a.lastAt ? a.lastAt.toISOString() : null,
            spark: a.spark,
            parentName: a.parentName,
          });
          sectionPv += a.pv;
          a.visitors.forEach((v) => sectionVisitors.add(v));
        }
        if (!items.length) continue;
        items.sort((x, y) => y.pv - x.pv || (y.lastAt || '').localeCompare(x.lastAt || ''));
        groups.push({
          type,
          label: TYPE_LABELS[type] || type,
          total: totals[type],
          viewed: items.length,
          items: items.slice(0, TOP_N),
        });
      }

      if (!groups.length && !sectionFilter) continue;   // 无数据的板块不出现（指定 section 时保留，便于前端显示空态）

      sectionsOut.push({ key: s.key, label: s.label, groups, pv: sectionPv, uv: sectionVisitors.size });
    }

    const data: Record<string, unknown> = {
      range: rangeKey,
      since: since ? since.toISOString() : null,
      dayKeys,
      summary: {
        pv: countable,
        uv: totalVisitors.size,
        objectCount: viewedKeys.size,
        sections: sectionsOut.length,
      },
      totals,
      sections: sectionsOut,
    };

    if (withZero) {
      data.unviewed = await loadUnviewed(viewedKeys);
    }

    return res.json(success(data));
  } catch (e: any) {
    return res.status(500).json(fail(e?.message || '统计失败', 500));
  }
}
