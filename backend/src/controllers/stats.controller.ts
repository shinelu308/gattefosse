import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success } from '../utils/response';
import { isCountableVisit } from '../utils/visit-filter';

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
 * 返回：今日/昨日/累计 PV・UV、近 7 日趋势、近 7 日热门页面 TOP、地区聚合
 *
 * ⚠️ 口径（2026-09-11 起）：所有指标统一走 utils/visit-filter 的 isCountableVisit。
 * 先全量取出再在内存中过滤，保证「今日 / 昨日 / 累计 / 趋势 / 地域 / 热门页」同一口径，
 * 历史噪声记录（HTML 片段、爬虫、扫描、内网与自测 IP）一并被剔除 —— 这正是 B 方案
 * 「历史数据回溯清洗」的实现方式：不删库，只在展示口径上过滤，改规则即刻生效。
 *
 * 数据量级：单表当前约 1 万行，内存过滤无压力。若增长到 10 万行以上，应改为在
 * page_view 表物化一个 is_valid 列（埋点写入时算好）后走 SQL 聚合。
 */
export async function getVisitOverview(_req: Request, res: Response) {
  const now = new Date();
  const today0 = dayStart(now);
  const yest0 = new Date(today0.getTime() - 24 * 3600 * 1000);
  const days7_0 = new Date(today0.getTime() - 6 * 24 * 3600 * 1000);

  const rawRows = await prisma.pageView.findMany({
    select: { path: true, ua: true, ip: true, visitorId: true, region: true, createdAt: true },
  });
  const rows = rawRows.filter((r) => isCountableVisit({ path: r.path, ip: r.ip, ua: r.ua }));

  const since = (from: Date, to?: Date) =>
    rows.filter((r) => r.createdAt >= from && (!to || r.createdAt < to));
  const uvOf = (list: { visitorId: string }[]) => new Set(list.map((r) => r.visitorId)).size;

  const todayRows = since(today0);
  const yestRows = since(yest0, today0);
  const sinceRows = since(days7_0);

  // 近 7 天趋势（含今天，共 7 天）+ 地区聚合（同一批数据）
  const trend: { date: string; pv: number; uv: number }[] = [];
  const dayMap = new Map<string, { pv: Set<string> }>();
  const keyOrder: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(days7_0.getTime() + i * 24 * 3600 * 1000);
    const key = localKey(d);
    keyOrder.push(key);
    dayMap.set(key, { pv: new Set() });
    trend.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, pv: 0, uv: 0 });
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

  // 近 7 天热门页面 TOP 8（同口径）
  const pathCount = new Map<string, number>();
  for (const r of sinceRows) pathCount.set(r.path, (pathCount.get(r.path) || 0) + 1);
  const topPages = [...pathCount.entries()]
    .map(([path, pv]) => ({ path, pv }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 8);

  res.json(success({
    today: { pv: todayRows.length, uv: uvOf(todayRows) },
    yesterday: { pv: yestRows.length, uv: uvOf(yestRows) },
    total: { pv: rows.length, uv: uvOf(rows) },
    trend,
    topPages,
    regions,
  }));
}
