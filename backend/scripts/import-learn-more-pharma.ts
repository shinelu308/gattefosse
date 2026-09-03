/**
 * 导入原中文站「了解更多」(learn-more) 药用辅料(pharma, goodsCategoryId=117) 内容
 *
 * 4 类映射到 news_events（沿用现有 type，category='pharma'）：
 *   - 热点话题 (webArticles)      → type=article
 *   - 网络研讨会 (webWebinars)    → type=webinar
 *   - 出版物 (webPublications)    → type=publication   (articleType=电子书/海报/科技出版物/白皮书)
 *   - 资料手册 (webBrochures)     → type=publication   (articleType=资料手册)
 *
 * 数据源：原站商品化 API 已抓取存于 .localize_tmp/learn-more/full_*.json
 *   （由抓取脚本从 gattefossechina.cn/api/webXxx/getWebXxxList?goodsCategoryId=117 翻页抓取）
 *
 * 运行: cd backend && npx tsx scripts/import-learn-more-pharma.ts
 * 参数: SAMPLE=1 仅导每类前 N 条（模板渲染种子）;  默认全量
 * 幂等: 按 (type+title) upsert，已存在则更新字段不重复插入
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const SAMPLE = process.env.SAMPLE === '1';
const SAMPLE_N = 3;

/** 原站 typeType → 本地 articleType（出版物） */
const PUB_ARTICLETYPE: Record<number, string> = {
  1: '电子书',
  2: '海报',
  3: '科技出版物',
  4: '白皮书',
};

/** 网络研讨会「所属分类」不在原站字段中，全部归 pharma 即可，articleType 留空 */

interface RawRow {
  ID: number;
  title?: string;
  summary?: string;
  thumb?: string;
  topBackground?: string;
  eventTime?: string;
  tag?: string | number[][] | null;
  url?: string;
  lock?: boolean | null;
  author?: string;
  publicationName?: string;
  typeType?: number | null;
}

function loadFull(name: string): RawRow[] {
  const file = join(__dirname, '..', '..', '.localize_tmp', 'learn-more', `full_${name}.json`);
  if (!existsSync(file)) {
    console.error(`⚠️  找不到 ${file}，请先运行抓取脚本`);
    return [];
  }
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/** 相对路径图片 → 原站绝对地址（后续本地化时统一下载到 uploads） */
function abs(url: string | undefined): string {
  if (!url || url === '/' || url === '') return '';
  if (/^https?:\/\//.test(url)) return url;
  return `https://www.gattefossechina.cn/${url.replace(/^\//, '')}`;
}

/** eventTime "2024-07-19T07:07:22.579Z" → Date */
function toDate(evt?: string): Date | null {
  if (!evt) return null;
  const d = new Date(evt);
  return isNaN(d.getTime()) ? null : d;
}

async function upsert(
  type: string,
  articleType: string | null,
  title: string,
  summary: string,
  data: Record<string, unknown>
) {
  if (!title) return 0;
  const existing = await prisma.newsEvent.findFirst({
    where: { type, category: 'pharma', title, summary },
  });
  const payload = {
    type,
    category: 'pharma',
    articleType: articleType || null,
    title,
    ...data,
  };
  if (existing) {
    await prisma.newsEvent.update({ where: { id: existing.id }, data: payload });
    return 1;
  }
  await prisma.newsEvent.create({ data: payload as any });
  return 1;
}

async function importArticles() {
  const rows = loadFull('articles');
  let n = 0;
  for (const r of rows) {
    if (SAMPLE && n >= SAMPLE_N) break;
    n += await upsert('article', '专业知识', r.title || '', r.summary || '', {
      summary: r.summary || '',
      imageUrl: abs(r.thumb),
      topBackground: abs(r.topBackground),
      publishedDate: toDate(r.eventTime),
      contentHtml: '', // 正文 contentId 抓取在本地化阶段补全
      isPublished: true,
      tags: '[]',
    });
  }
  console.log(`  ✓ article 导入 ${n}/${rows.length} 条`);
}

async function importWebinars() {
  const rows = loadFull('webinars');
  let n = 0;
  for (const r of rows) {
    if (SAMPLE && n >= SAMPLE_N) break;
    n += await upsert('webinar', null, r.title || '', r.summary || '', {
      summary: r.summary || '',
      imageUrl: abs(r.thumb),
      topBackground: abs(r.topBackground),
      publishedDate: toDate(r.eventTime),
      videoUrl: r.url || '',
      lock: r.lock === true,
      isPublished: true,
      tags: '[]',
    });
  }
  console.log(`  ✓ webinar 导入 ${n}/${rows.length} 条`);
}

async function importPublications() {
  const rows = loadFull('pubs');
  let n = 0;
  for (const r of rows) {
    if (SAMPLE && n >= SAMPLE_N) break;
    const articleType = r.typeType ? PUB_ARTICLETYPE[r.typeType] || '海报' : '海报';
    n += await upsert('publication', articleType, r.title || '', r.summary || '', {
      summary: r.summary || '',
      imageUrl: abs(r.thumb),
      topBackground: abs(r.topBackground),
      publishedDate: toDate(r.eventTime),
      pdfUrl: r.url || '',
      publicationName: r.publicationName || '',
      authorName: r.author || '',
      isPublished: true,
      tags: '[]',
    });
  }
  console.log(`  ✓ publication 导入 ${n}/${rows.length} 条`);
}

async function importBrochures() {
  const rows = loadFull('broch');
  let n = 0;
  for (const r of rows) {
    if (SAMPLE && n >= SAMPLE_N) break;
    n += await upsert('publication', '资料手册', r.title || '', r.summary || '', {
      summary: r.summary || '',
      imageUrl: abs(r.thumb),
      topBackground: abs(r.topBackground),
      publishedDate: toDate(r.eventTime),
      pdfUrl: r.url || '',
      isPublished: true,
      tags: '[]',
    });
  }
  console.log(`  ✓ brochure(publication/资料手册) 导入 ${n}/${rows.length} 条`);
}

async function main() {
  console.log(SAMPLE ? `🔍 样例模式 SAMPLE=1 (每类前 ${SAMPLE_N} 条)` : '📦 全量导入模式');
  await importArticles();
  await importWebinars();
  await importPublications();
  await importBrochures();
  console.log('✅ 完成');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌', e);
  await prisma.$disconnect();
  process.exit(1);
});
