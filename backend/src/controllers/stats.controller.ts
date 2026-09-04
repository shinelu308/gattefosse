import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success } from '../utils/response';
function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
// 本地日期 key（避免 UTC 分组把凌晨访问算到前一天）
function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 访问统计总览（总览页用）
 * 返回：今日/昨日/累计 PV・UV、近 7 日趋势、近 7 日热门页面 TOP
 */
export async function getVisitOverview(_req: Request, res: Response) {
  const now = new Date();
  const today0 = dayStart(now);
  const yest0 = new Date(today0.getTime() - 24 * 3600 * 1000);
  const days7_0 = new Date(today0.getTime() - 6 * 24 * 3600 * 1000);

  const [todayPv, todayUv, yestPv, yestUv, totalPv, totalUv] = await Promise.all([
    prisma.pageView.count({ where: { createdAt: { gte: today0 } } }),
    prisma.pageView.groupBy({ by: ['visitorId'], where: { createdAt: { gte: today0 } } }).then((r) => r.length),
    prisma.pageView.count({ where: { createdAt: { gte: yest0, lt: today0 } } }),
    prisma.pageView.groupBy({ by: ['visitorId'], where: { createdAt: { gte: yest0, lt: today0 } } }).then((r) => r.length),
    prisma.pageView.count(),
    prisma.pageView.groupBy({ by: ['visitorId'] }).then((r) => r.length),
  ]);

  // 近 7 天趋势（含今天，共 7 天）+ 地区聚合（同一批数据）
  const sinceRows = await prisma.pageView.findMany({
    where: { createdAt: { gte: days7_0 } },
    select: { createdAt: true, visitorId: true, region: true },
  });
  const trend: { date: string; pv: number; uv: number }[] = [];
  const dayMap = new Map<string, { pv: Set<string> }>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(days7_0.getTime() + i * 24 * 3600 * 1000);
    const key = localKey(d);
    dayMap.set(key, { pv: new Set() });
    trend.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, pv: 0, uv: 0 });
  }
  const keyOrder: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(days7_0.getTime() + i * 24 * 3600 * 1000);
    keyOrder.push(localKey(d));
  }
  // 地区计数：中国按省份（省图名称），海外按国家（世界图名称）
  const chinaMap = new Map<string, number>();
  const overseasMap = new Map<string, number>();
  const normProvince = (p: string) =>
    p.replace(/(维吾尔|回族|壮族)?自治区$/, '').replace(/(省|市|特别行政区)$/, '');
  for (const row of sinceRows) {
    const key = localKey(row.createdAt);
    const idx = keyOrder.indexOf(key);
    if (idx >= 0) {
      trend[idx].pv++;
      dayMap.get(key)!.pv.add(row.visitorId);
    }
    if (row.region) {
      const [country, province] = row.region.split('|');
      if (country === '中国') {
        // 台湾访问归入中国省份统计
        const name = province ? normProvince(province) : '未知';
        chinaMap.set(name, (chinaMap.get(name) || 0) + 1);
      } else if (country && country !== '内网') {
        overseasMap.set(country, (overseasMap.get(country) || 0) + 1);
      }
    }
  }
  trend.forEach((t, i) => { t.uv = dayMap.get(keyOrder[i])!.pv.size; });
  const toList = (m: Map<string, number>) =>
    [...m.entries()].map(([name, pv]) => ({ name, pv })).sort((a, b) => b.pv - a.pv).slice(0, 30);
  const regions = { china: toList(chinaMap), overseas: toList(overseasMap) };

  // 近 7 天热门页面 TOP 8
  const topRows = await prisma.pageView.groupBy({
    by: ['path'],
    where: { createdAt: { gte: days7_0 } },
    _count: { _all: true },
    orderBy: { _count: { path: 'desc' } },
    take: 8,
  });
  const topPages = topRows.map((r) => ({ path: r.path, pv: r._count._all }));

  res.json(success({
    today: { pv: todayPv, uv: todayUv },
    yesterday: { pv: yestPv, uv: yestUv },
    total: { pv: totalPv, uv: totalUv },
    trend,
    topPages,
    regions,
  }));
}
