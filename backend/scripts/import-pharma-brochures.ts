/**
 * 导入原中文站「了解更多→所有手册」(pharma brochure, goodsCategoryId=117) 27 条
 *
 * 数据源：.localize_tmp/learn-more/full_broch.json（原站 API 全量 27 条）
 *   - 注意：原站 brochure 记录 ID 与 publication 记录 ID 数字重叠（150~178），
 *     但内容实体完全不同（标题/url/thumb 均不同），属两套独立 ID 序列。
 *   - 前端隔离：#369 改造后 brochures.html 请求 articleType=资料手册，
 *     publications.html 请求 excludeArticleType=资料手册 → 两页互补显示。
 *
 * 标签树：.localize_tmp/learn-more/brotags.json
 *   - 父组 293「给药途径」(口服给药/外用透皮/直肠/阴道/肠外给药(兽医))
 *   - 父组 292「市场分类」(人用药/动物用药)
 *   - 入库合并两组的全部子标签中文（brochures.html 卡片面包屑展示 tagList）
 *
 * 入库规则（type=publication, category=pharma, articleType=资料手册, isPublished=true）：
 *   - ⚠️ 幂等键 = (type + category + articleType + adminSort)：
 *     brochure sort 范围 0~29 与 publication adminSort(1~179) 大量重叠，
 *     若沿用 pub 的 (type+category+adminSort) 会误更新 168 条 pub 记录。
 *     固定 articleType=资料手册 后查找绝不命中 pub（pub 无此 articleType）。
 *   - publishedDate = eventTime
 *   - imageUrl = thumb（相对路径补全 https://www.gattefossechina.cn/）
 *   - pdfUrl = url（原样保留；少数记录无 PDF → null，与原站卡片一致）
 *   - lock = 原站 lock（Labrasol ALF / Maisine CC 2 条需登录查看）
 *   - adminSort = sort（列表按原站 sort desc）
 *
 * 运行: cd backend && npx tsx scripts/import-pharma-brochures.ts
 * 幂等: 可重复执行，已存在则更新
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const DATA = join(__dirname, '..', '..', '.localize_tmp', 'learn-more', 'full_broch.json');
const TAG_TREE = join(__dirname, '..', '..', '.localize_tmp', 'learn-more', 'brotags.json');

/** 相对/绝对图片路径 → 原站完整 URL */
function normImgUrl(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '/' || s === '') return null;
  if (/^https?:\/\//.test(s)) return s;
  return `https://www.gattefossechina.cn/${s.replace(/^\//, '')}`;
}

/** 从标签树文件提取 293/292 全部子标签 ID→中文 */
function loadChildTagMap(): { map: Record<number, string> } {
  const tree = JSON.parse(readFileSync(TAG_TREE, 'utf-8'));
  const groups: any[] = tree?.data?.list || [];
  const map: Record<number, string> = {};
  for (const g of groups) {
    if (g?.children) {
      for (const c of g.children) {
        if (c?.tagName && c.ID != null) map[Number(c.ID)] = String(c.tagName);
      }
    }
  }
  return { map };
}

/** 解析 tag "[[293,300],[293,297],[292,294]]" → 子标签中文数组（去重保序） */
function parseChildTags(raw: unknown, childMap: Record<number, string>): { tags: string[]; unknownIds: number[] } {
  const unknownIds: number[] = [];
  if (raw == null) return { tags: [], unknownIds };
  const s = String(raw).trim();
  if (!s || s === '""' || s === '[]') return { tags: [], unknownIds };
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return { tags: [], unknownIds };
    const tags: string[] = [];
    for (const pair of arr) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const childId = Number(pair[1]);
      const name = childMap[childId];
      if (name) {
        if (!tags.includes(name)) tags.push(name);
      } else if (!unknownIds.includes(childId)) {
        unknownIds.push(childId);
      }
    }
    return { tags, unknownIds };
  } catch {
    return { tags: [], unknownIds };
  }
}

function toDate(raw: unknown): Date | null {
  if (raw == null || !String(raw).trim()) return null;
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? null : d;
}

interface Row {
  ID?: number;
  title?: string;
  summary?: string;
  eventTime?: string;
  thumb?: string;
  url?: string;
  tag?: unknown;
  sort?: number;
  lock?: unknown;
  views?: number;
}

async function main() {
  if (!existsSync(DATA) || !existsSync(TAG_TREE)) {
    console.error(`找不到数据源: ${DATA} / ${TAG_TREE}`);
    process.exit(1);
  }
  const rows: Row[] = JSON.parse(readFileSync(DATA, 'utf-8'));
  const { map: childMap } = loadChildTagMap();
  console.log(`📦 待导入 brochure: ${rows.length} 条；子标签映射 ${Object.keys(childMap).length} 项`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const title = String(r.title || '').trim();
    if (!title || r.sort == null) {
      skipped++;
      continue;
    }
    const { tags, unknownIds } = parseChildTags(r.tag, childMap);
    if (unknownIds.length) {
      console.log(`  ⚠️  ID=${r.ID} 标签树缺失子标签 ${unknownIds.join(',')}（已忽略）`);
    }

    const payload: Record<string, unknown> = {
      type: 'publication',
      category: 'pharma',
      articleType: '资料手册',
      title,
      summary: r.summary ? String(r.summary).trim() : null,
      publishedDate: toDate(r.eventTime),
      imageUrl: normImgUrl(r.thumb),
      pdfUrl: r.url && String(r.url).trim() ? String(r.url).trim() : null,
      tags: tags.length ? JSON.stringify(tags) : '[]',
      lock: r.lock === true,
      isPublished: true,
      views: typeof r.views === 'number' && r.views > 0 ? r.views : 0,
      adminSort: r.sort,
    };

    // 幂等键：type + category + articleType + adminSort（必须含 articleType，
    // brochure sort 与 publication adminSort 重叠，避免误更新 pub 记录）
    const existing = await prisma.newsEvent.findFirst({
      where: { type: 'publication', category: 'pharma', articleType: '资料手册', adminSort: r.sort },
    });
    if (existing) {
      await prisma.newsEvent.update({ where: { id: existing.id }, data: payload as any });
      updated++;
      console.log(`  ↻ 更新 id=${existing.id} 原站ID=${r.ID} sort=${r.sort}《${title.slice(0, 55)}》 tags=[${tags.join(',')}]`);
    } else {
      const createdRow = await prisma.newsEvent.create({ data: payload as any });
      created++;
      console.log(`  ＋ 新增 id=${createdRow.id} 原站ID=${r.ID} sort=${r.sort}《${title.slice(0, 55)}》 tags=[${tags.join(',')}]`);
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
