/**
 * 导入原中文站「了解更多→出版物」(pharma publication, goodsCategoryId=117) 168 条
 *
 * 数据源：.localize_tmp/learn-more/full_pubs.json（原站 API 全量 168 条）
 *   - 该列表存在 2 组完全重复标题记录（173/256、248/249），
 *     summary/url/eventTime 无法 100% 区分，故幂等键采用 (type + category + adminSort)，
 *     adminSort=原站 sort，已核验 168 条 sort 唯一。
 *
 * 标签树：.localize_tmp/learn-more/api_getWebPublicationsTagList.json
 *   - 原站 publication 标签分 3 父组：父1「主题」(children 4~27)、
 *     父2「议题」(28~32)、父3「年份」(33~53)。pub 记录 tag 形如 [[1,27],[3,42]]。
 *   - 本地 learn-more 侧栏为单「主题」分组（#369 简化，与 webinar 一致），
 *     故入库仅保留父1「主题」子标签中文名；ID6 中文树缺失（同 webinar 情况）忽略。
 *
 * 入库规则（type=publication, category=pharma, isPublished=true）：
 *   - articleType：typeType→ 1电子书/2海报/3科技出版物/4白皮书（typeType null 时置 null）
 *   - publishedDate = eventTime（用于卡片 YYYY年MM月 展示）
 *   - pdfUrl = url（无 PDF 的原站卡片按钮 href 亦为空，保持一致）
 *   - publicationName / authorName 原样保留
 *   - adminSort = sort（列表复刻原站 sort desc）
 *
 * 运行: cd backend && npx tsx scripts/import-pharma-publications.ts
 * 幂等: 可重复执行，已存在则更新
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const DATA = join(__dirname, '..', '..', '.localize_tmp', 'learn-more', 'full_pubs.json');
const TAG_TREE = join(__dirname, '..', '..', '.localize_tmp', 'learn-more', 'api_getWebPublicationsTagList.json');

/** typeType → articleType 中文（与 pubtypes.json 一致） */
const TYPE_MAP: Record<number, string> = {
  1: '电子书',
  2: '海报',
  3: '科技出版物',
  4: '白皮书',
};

/** 从标签树文件提取父1「主题」子标签 ID→中文 */
function loadThemeTagMap(): { map: Record<number, string>; missing: number[] } {
  const tree = JSON.parse(readFileSync(TAG_TREE, 'utf-8'));
  const groups: any[] = tree?.data?.list || [];
  const theme = groups.find((g) => g.tagName === '主题');
  const map: Record<number, string> = {};
  if (theme?.children) {
    for (const c of theme.children) {
      if (c?.tagName && c.ID != null) map[Number(c.ID)] = String(c.tagName);
    }
  }
  return { map, missing: [] };
}

/** 解析 tag "[[1,27],[3,42]]" → 仅父1「主题」子标签中文数组 */
function parseThemeTags(raw: unknown, themeMap: Record<number, string>): { tags: string[]; unknownIds: number[] } {
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
      const parentId = Number(pair[0]);
      const childId = Number(pair[1]);
      if (parentId !== 1) continue; // 仅主题组
      const name = themeMap[childId];
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
  url?: string;
  tag?: unknown;
  typeType?: unknown;
  sort?: number;
  author?: string;
  publicationName?: string;
}

async function main() {
  if (!existsSync(DATA) || !existsSync(TAG_TREE)) {
    console.error(`找不到数据源: ${DATA} / ${TAG_TREE}`);
    process.exit(1);
  }
  const rows: Row[] = JSON.parse(readFileSync(DATA, 'utf-8'));
  const { map: themeMap } = loadThemeTagMap();
  console.log(`📦 待导入 publication: ${rows.length} 条；主题子标签 ${Object.keys(themeMap).length} 项`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const title = String(r.title || '').trim();
    if (!title || r.sort == null) {
      skipped++;
      continue;
    }
    const { tags, unknownIds } = parseThemeTags(r.tag, themeMap);
    if (unknownIds.length) {
      console.log(`  ⚠️  ID=${r.ID} 主题树缺失子标签 ${unknownIds.join(',')}（已忽略）`);
    }
    const typeNum = r.typeType != null ? Number(r.typeType) : NaN;
    const payload: Record<string, unknown> = {
      type: 'publication',
      category: 'pharma',
      title,
      summary: r.summary ? String(r.summary).trim() : null,
      publishedDate: toDate(r.eventTime),
      articleType: Number.isFinite(typeNum) && TYPE_MAP[typeNum] ? TYPE_MAP[typeNum] : null,
      pdfUrl: r.url && String(r.url).trim() ? String(r.url).trim() : null,
      publicationName: r.publicationName ? String(r.publicationName).trim() : null,
      authorName: r.author ? String(r.author).trim() : null,
      tags: tags.length ? JSON.stringify(tags) : '[]',
      isPublished: true,
      lock: false,
      views: 0,
      adminSort: r.sort,
    };

    // 幂等键：原站 sort 唯一；重复标题记录靠 sort 区分
    const existing = await prisma.newsEvent.findFirst({
      where: { type: 'publication', category: 'pharma', adminSort: r.sort },
    });
    if (existing) {
      await prisma.newsEvent.update({ where: { id: existing.id }, data: payload as any });
      updated++;
      console.log(`  ↻ 更新 id=${existing.id} 原站ID=${r.ID} sort=${r.sort}《${title.slice(0, 55)}》 type=${payload.articleType} tags=[${tags.join(',')}]`);
    } else {
      const createdRow = await prisma.newsEvent.create({ data: payload as any });
      created++;
      console.log(`  ＋ 新增 id=${createdRow.id} 原站ID=${r.ID} sort=${r.sort}《${title.slice(0, 55)}》 type=${payload.articleType} tags=[${tags.join(',')}]`);
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
