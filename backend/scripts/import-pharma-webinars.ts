/**
 * 导入原中文站「了解更多→网络研讨会」(pharma webinar, goodsCategoryId=117) 31 条
 *
 * 数据源：.localize_tmp/learn-more/full_webinars.json（原站 API 全量 31 条）
 *   - 注意：原站该列表存在多组同标题记录（Breaking boundaries ×4、
 *     Introduction to oral bioavailability ×2 等），summary(Part 1~4) 区分，
 *     因此幂等键用 (type + category + title + summary)，已验证 31 条组合唯一。
 *
 * 入库规则（type=webinar, category=pharma, isPublished=true）：
 *   - title：存英文原名（原站中文页卡片标题即英文）
 *   - summary：原文保留
 *   - publishedDate = eventTime；eventEndDate = eventEndTime
 *   - imageUrl / topBackground：统一补全原站域名 https://www.gattefossechina.cn/
 *   - videoUrl = url（gotowebinar register/recording 外链）
 *   - lock = true（原站 DOM 全部带 c-card--private，需登录观看）
 *   - tags：子标签「主题」中文名数组；tag 树取自 api_getWebWebniarsTagList
 *     （父1/子3~16）。ID 6 在中文标签树缺失（原站侧栏筛选项亦无 6），
 *     两条 Cannabinoids 记录引用 6 → 无法映射的部分忽略，仅保留可映射主题
 *
 * 运行: cd backend && npx tsx scripts/import-pharma-webinars.ts
 * 幂等: 可重复执行，已存在则更新
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const DATA = join(__dirname, '..', '..', '.localize_tmp', 'learn-more', 'full_webinars.json');

/** 子标签 ID → 中文名（来自原站 api_getWebWebniarsTagList，父=1「主题」） */
const CHILD_TAG: Record<number, string> = {
  3: '3D打印',
  4: '动物健康',
  5: '提高生物利用度',
  // 6: 中文标签树缺失（Cannabinoids），忽略
  7: '食物效应',
  8: '肠道渗透促进剂',
  9: '脂质基制剂',
  10: '脂质基配方开发',
  11: '脂质和聚合物',
  12: '改良释放',
  13: '口服肽输送',
  14: '临床前研究',
  15: '皮肤给药',
  16: '掩味',
};

/** 解析 tag "[[1,4]]" / "[[1,6],[1,15]]" → 可映射子标签中文数组 */
function parseChildTags(raw: unknown): { tags: string[]; unknownIds: number[] } {
  if (raw == null) return { tags: [], unknownIds: [] };
  const s = String(raw).trim();
  if (!s || s === '""' || s === '[]') return { tags: [], unknownIds: [] };
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return { tags: [], unknownIds: [] };
    const tags: string[] = [];
    const unknownIds: number[] = [];
    for (const pair of arr) {
      const list = Array.isArray(pair) ? pair : [pair];
      const childId = Number(list[list.length - 1]);
      const name = CHILD_TAG[childId];
      if (name) {
        if (!tags.includes(name)) tags.push(name);
      } else {
        if (!unknownIds.includes(childId)) unknownIds.push(childId);
      }
    }
    return { tags, unknownIds };
  } catch {
    return { tags: [], unknownIds: [] };
  }
}

/** 相对/绝对图片路径 → 原站完整 URL */
function normUrl(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '/' || s === '') return null;
  if (/^https?:\/\//.test(s)) return s;
  return `https://www.gattefossechina.cn/${s.replace(/^\//, '')}`;
}

function toDate(raw: unknown): Date {
  const d = new Date(String(raw || ''));
  return isNaN(d.getTime()) ? new Date() : d;
}

interface Row {
  ID?: number;
  title?: string;
  summary?: string;
  eventTime?: string;
  eventEndTime?: string;
  thumb?: string;
  topBackground?: string;
  url?: string;
  tag?: unknown;
  lock?: unknown;
  views?: number;
  sort?: number;
}

async function main() {
  if (!existsSync(DATA)) {
    console.error(`找不到数据源: ${DATA}`);
    process.exit(1);
  }
  const rows: Row[] = JSON.parse(readFileSync(DATA, 'utf-8'));
  console.log(`📦 待导入 webinar: ${rows.length} 条`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const title = String(r.title || '').trim();
    const summary = String(r.summary || '').trim();
    if (!title) {
      skipped++;
      continue;
    }
    const { tags, unknownIds } = parseChildTags(r.tag);
    if (unknownIds.length) {
      console.log(`  ⚠️  ID=${r.ID} 标签树缺失子标签 ${unknownIds.join(',')}（已忽略，保留其他主题）`);
    }

    const payload: Record<string, unknown> = {
      type: 'webinar',
      category: 'pharma',
      title,
      summary: summary || null,
      publishedDate: toDate(r.eventTime),
      eventEndDate: r.eventEndTime ? new Date(r.eventEndTime) : null,
      imageUrl: normUrl(r.thumb),
      topBackground: normUrl(r.topBackground),
      videoUrl: r.url || null,
      lock: r.lock === true,
      isPublished: true,
      tags: tags.length ? JSON.stringify(tags) : '[]',
      articleType: null,
      views: typeof r.views === 'number' && r.views > 0 ? r.views : 0,
      adminSort: typeof r.ID === 'number' ? r.sort ?? null : null,
    };

    const existing = await prisma.newsEvent.findFirst({
      where: { type: 'webinar', category: 'pharma', title, summary: summary || null },
    });
    if (existing) {
      await prisma.newsEvent.update({ where: { id: existing.id }, data: payload as any });
      updated++;
      console.log(`  ↻ 更新 id=${existing.id} 原站ID=${r.ID}《${title.slice(0, 60)}》 tags=[${tags.join(',')}]`);
    } else {
      const createdRow = await prisma.newsEvent.create({ data: payload as any });
      created++;
      console.log(`  ＋ 新增 id=${createdRow.id} 原站ID=${r.ID}《${title.slice(0, 60)}》 tags=[${tags.join(',')}]`);
    }
  }

  console.log(`\n✅ 完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}`);
}

main()
  .catch((e) => {
    console.error('❌ 导入失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
