/**
 * 导入原中文站「了解更多 → Journées Galéniques论坛」专题单页内容
 *
 * 数据源（.localize_tmp）：
 *   - .localize_tmp/api_186.json            原站 webNewsEvents findWebNewsEvents?ID=186 元数据
 *   - .localize_tmp/journees_content.html   原站 webContents contentId=1614 正文（107,950 chars）
 *
 * 本地入库规则（type=page, category=pharma, isPublished=true）：
 *   - title / summary / topBackground / publishedDate / views 直接取自 API 元数据
 *   - contentHtml：协议相对链接 //www.gattefosse.com → https://www.gattefosse.com（其余保留）
 *   - imageUrl = topBackground（同本地头图）
 *   - 幂等：按 (type+category+title) 匹配，命中即更新 contentHtml/topBackground/imageUrl
 *
 * 运行: cd backend && npx tsx scripts/import-journees-page.ts
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const TMP = join(__dirname, '..', '..', '.localize_tmp');

const META_PATH = join(TMP, 'api_186.json');
const CONTENT_PATH = join(TMP, 'journees_content.html');

const TYPE = 'page';
const CATEGORY = 'pharma';

/** 把正文中的协议相对链接补全为 https（其余保持不变） */
function absolutizeBody(html: string): string {
  return html.replace(/(src|href)=(["'])\/\/www\.gattefosse\.com/g, '$1=$2https://www.gattefosse.com');
}

/** 解析元数据文件，提取需要的字段 */
function loadMeta(): {
  title: string;
  summary: string;
  publishedDate: Date;
  topBackground: string;
  views: number;
} {
  const raw = JSON.parse(readFileSync(META_PATH, 'utf8'));
  const m = raw?.data?.reWebNewsEvents;
  if (!m) throw new Error('api_186.json 缺少 reWebNewsEvents');
  return {
    title: String(m.title || '').trim(),
    summary: String(m.summary || '').trim(),
    publishedDate: new Date(m.eventTime),
    topBackground: String(m.topBackground || '').trim(),
    views: typeof m.views === 'number' ? m.views : 0,
  };
}

async function upsertJounees(meta: ReturnType<typeof loadMeta>, contentHtml: string) {
  const existing = await prisma.newsEvent.findFirst({
    where: { type: TYPE, category: CATEGORY, title: meta.title },
  });

  // 原页面头部 banner 实际使用的是 cover-journees-galeniques-1140x405_0.jpg.webp（本地已下载到 site/sites/...），
  // 而 API 返回的 meta.topBackground 是另一张社交分享图（uploads/file/...），两者不同。前台 1:1 复刻应以页面 banner 为准。
  const pageBanner = '/sites/default/files/styles/page_banner_desktop_full/public/2024-01/cover-journees-galeniques-1140x405_0.jpg.webp';

  const payload = {
    type: TYPE,
    category: CATEGORY,
    title: meta.title,
    summary: meta.summary || null,
    contentHtml,
    imageUrl: pageBanner,
    topBackground: pageBanner,
    publishedDate: meta.publishedDate,
    isPublished: true,
    views: meta.views || 0,
    metaTitle: '普罗旺斯圣雷米的盖伦时代 ⋅ Gattefossé',
    metaDescription: meta.summary ? meta.summary.slice(0, 200) : null,
  };

  if (existing) {
    await prisma.newsEvent.update({ where: { id: existing.id }, data: payload });
    console.log(`[UPDATED] id=${existing.id}  title=${meta.title.slice(0, 40)}…`);
    return existing.id;
  }
  const created = await prisma.newsEvent.create({ data: payload });
  console.log(`[CREATED] id=${created.id}  title=${meta.title.slice(0, 40)}…`);
  return created.id;
}

async function main() {
  if (!existsSync(META_PATH)) throw new Error(`元数据文件不存在：${META_PATH}`);
  if (!existsSync(CONTENT_PATH)) throw new Error(`正文文件不存在：${CONTENT_PATH}`);

  const meta = loadMeta();
  if (!meta.title) throw new Error('元数据 title 为空');

  const rawHtml = readFileSync(CONTENT_PATH, 'utf8');
  const contentHtml = absolutizeBody(rawHtml);
  console.log(`正文长度：${contentHtml.length} chars  (原始 ${rawHtml.length} chars)`);

  const id = await upsertJounees(meta, contentHtml);

  // 校核：再次读取，确认 contentHtml 已落地
  const verify = await prisma.newsEvent.findUnique({ where: { id } });
  console.log(`[VERIFY]  type=${verify?.type}  category=${verify?.category}  contentHtml.length=${verify?.contentHtml?.length ?? 0}  topBackground=${verify?.topBackground}`);
}

main()
  .catch((e) => { console.error('导入失败：', e); process.exit(1); })
  .finally(() => prisma.$disconnect());