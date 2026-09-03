/**
 * 导入原中文站药用辅料「了解更多→热点话题」(hot-topics) 5 篇文章
 *
 * 原站数据源（.localize_tmp）：
 *   - .localize_tmp/learn-more/full_articles.json   5 篇元数据（goodsCategoryId=117）
 *   - .localize_tmp/pharma-articles/content-{ID}.json 各篇正文 HTML（reWebContents.content）
 *
 * 本地入库规则（type=article, category=pharma, isPublished=true）：
 *   - imageUrl / topBackground：统一存原站完整外链 https://www.gattefossechina.cn/uploads/...
 *   - tags：仅存子标签中文名（热熔挤出 / 药用辅料），父分组「主题」由前端硬编码
 *     tag "[[322,324]]" → ["热熔挤出"]；"[[322,325]]" → ["药用辅料"]；空 → null
 *   - summary 为空时从正文自动提取首段纯文本（截断）
 *   - 正文相对图片路径补全域名、协议相对 // 补 https:
 *   - 幂等：按 (type+category+title) 匹配；DB 中 category=pc 的同标题残留记录（女性用药/儿童用药）
 *     自动迁移为 pharma 并补写正文
 *
 * 运行: cd backend && npx tsx scripts/import-hot-topics-articles.ts
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const TMP_LEARN = join(__dirname, '..', '..', '.localize_tmp', 'learn-more');
const TMP_ART = join(__dirname, '..', '..', '.localize_tmp', 'pharma-articles');

/** 原站文章 ID 列表（与 content-*.json 文件名对应） */
const ARTICLE_IDS = [194, 146, 147, 196, 195];

/** tag 树：子标签 ID → 中文名（来自 arttags.json，322=主题(父)） */
const CHILD_TAG: Record<number, string> = { 324: '热熔挤出', 325: '药用辅料' };

/** 解析原站 tag 字段 → 子标签中文数组 */
function parseChildTags(raw: unknown): string[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s || s === '""' || s === '[]') return [];
  try {
    const arr = JSON.parse(s); // e.g. [[322,324]]
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    for (const pair of arr) {
      const list = Array.isArray(pair) ? pair : [pair];
      const childId = Number(list[list.length - 1]); // 父/子中取最后一个=子标签
      const name = CHILD_TAG[childId];
      if (name && !out.includes(name)) out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

/** 规范化图片/背景 URL 为原站完整外链（兼容有/无前导斜杠与完整URL） */
function normUrl(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '/') return null;
  if (/^https?:\/\//.test(s)) return s;
  return `https://www.gattefossechina.cn/${s.replace(/^\//, '')}`;
}

/** 正文HTML：相对资源(图片/静态文件)补原站域名；协议相对 // 补 https:// */
function absolutizeBody(html: string): string {
  return html
    .replace(/(src|href)=(["'])\/(?!\/)(sites\/|uploads\/|themes\/|static\/)/g, '$1=$2https://www.gattefossechina.cn/$3')
    .replace(/(src|href)=(["'])\/\//g, '$1=$2https://');
}

/** 从正文HTML提取纯文本摘要 */
function extractSummary(html: string, maxLen = 140): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>|<\/div>|<\/h[1-6]>|<li>|<tr>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > maxLen) t = t.slice(0, maxLen).trimEnd() + '…';
  return t;
}

/** 幂等 upsert：迁移 pc 残留记录 → pharma */
async function upsertArticle(meta: any, contentHtml: string) {
  const title = String(meta.title || '').trim();
  if (!title) return 0;

  const childTags = parseChildTags(meta.tag);
  const summaryRaw = String(meta.summary || '').trim();
  const summary = summaryRaw || extractSummary(contentHtml);
  const publishedDate = meta.eventTime ? new Date(meta.eventTime) : new Date();
  const payload: Record<string, unknown> = {
    type: 'article',
    category: 'pharma',
    title,
    summary,
    contentHtml,
    imageUrl: normUrl(meta.thumb),
    topBackground: normUrl(meta.topBackground),
    publishedDate,
    isPublished: true,
    tags: childTags.length ? JSON.stringify(childTags) : null,
    articleType: null,
    views: typeof meta.views === 'number' && meta.views > 0 ? meta.views : 0,
  };

  // 1) 同类型同分类同标题已存在 → 更新
  let existing = await prisma.newsEvent.findFirst({
    where: { type: 'article', category: 'pharma', title },
  });
  // 2) pc 残留（错误历史导入）→ 迁移并补全
  if (!existing) {
    existing = await prisma.newsEvent.findFirst({
      where: { type: 'article', category: 'pc', title },
    });
  }
  if (existing) {
    await prisma.newsEvent.update({ where: { id: existing.id }, data: payload as any });
    const moved = existing.category === 'pc' ? '（pc→pharma 迁移）' : '';
    console.log(`  ↻ 更新 id=${existing.id} ${moved} 《${title}》`);
    return existing.id;
  }
  const created = await prisma.newsEvent.create({ data: payload as any });
  console.log(`  ＋ 新增 id=${created.id} 《${title}》`);
  return created.id;
}

async function main() {
  const metaFile = join(TMP_LEARN, 'full_articles.json');
  if (!existsSync(metaFile)) {
    console.error(`找不到 ${metaFile}`);
    process.exit(1);
  }
  const metas: any[] = JSON.parse(readFileSync(metaFile, 'utf-8'));
  const byId = new Map(metas.map((m) => [m.ID, m]));

  let n = 0;
  for (const id of ARTICLE_IDS) {
    const meta = byId.get(id);
    if (!meta) {
      console.warn(`  ⚠️  full_articles.json 缺少 ID=${id}，跳过`);
      continue;
    }
    const contentFile = join(TMP_ART, `content-${id}.json`);
    let contentHtml = '';
    if (existsSync(contentFile)) {
      const c = JSON.parse(readFileSync(contentFile, 'utf-8'));
      contentHtml = String(c?.data?.reWebContents?.content || '');
      contentHtml = absolutizeBody(contentHtml);
    } else {
      console.warn(`  ⚠️  缺少正文文件 content-${id}.json，正文留空`);
    }
    const rid = await upsertArticle(meta, contentHtml);
    if (rid) n++;
  }
  console.log(`✅ 热点话题导入完成：${n}/${ARTICLE_IDS.length} 篇`);
}

main()
  .catch((e) => {
    console.error('❌ 导入失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
