/**
 * 专业知识（Expertise）主页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=187（title=专业知识）→ contentId=1615 → webContents.content
 * 存储：page_contents (pageKey = 'expertise')
 *
 * 正文结构：block-accroche 简介 + 7 个 s-zone paragraph 左右交替图文区块
 *   油脂化学 / 植物化学 / 皮肤生物学 / 可持续采购 / 感官分析 / 应用实验室 / 监管和毒理学
 * 7 张正文图 + banner 图此前全站复刻时已本地化至 /sites/default/files/...
 * 7 个「发现」子页链接目标（lipid-chemistry.html 等）本地均已存在
 *
 * 数据源快照: .localize_tmp/expertise_content_1615.json（api/webContents/findWebContents?ID=1615）
 * 运行: cd backend && npx tsx scripts/import-expertise-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'expertise',
  newsId: 187,
  contentId: 1615,
  title: '专业知识',
  metaTitle: '专业知识 ⋅ 嘉法狮',
  metaDescription:
    '近 140 年来，一代又一代的嘉法狮科学家一直致力于发展在植物提取和油脂化学方面的专业知识。多年来，这种专业知识已扩展到其他互补领域，旨在开发、生产和营销始终如一的高品质一流产品和服务。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/expertise-1140x405.jpg.jpg',
  apiFile: 'expertise_content_1615.json',
  sortOrder: 35,
};

/** 重写图片绝对 URL 为本地路径（与 CSR hub 一致） */
function rewriteUrls(raw: string): string {
  return raw
    .replace(/https?:\/\/www\.gattefossechina\.cn\/sites\//g, '/sites/')
    .replace(/https?:\/\/www\.gattefosse\.com\/sites\//g, '/sites/')
    .replace(/\/\/www\.gattefosse\.com\/sites\//g, '/sites/')
    .replace(/\/\/www\.gattefossechina\.cn\/sites\//g, '/sites/');
}

async function main() {
  const apiPath = join(__dirname, '../../.localize_tmp', PAGE.apiFile);
  const raw = JSON.parse(readFileSync(apiPath, 'utf-8'));
  const contentHtml = rewriteUrls(raw.data.reWebContents.content);

  const heroBlock = {
    type: 'hero',
    data: {
      title: PAGE.title,
      summary: PAGE.metaDescription,
      backgroundImage: PAGE.heroBg,
      buttons: [] as Array<{ label: string; url: string }>,
      videoUrl: '',
      videoType: '',
    },
  };

  const page = await prisma.pageContent.upsert({
    where: { pageKey: PAGE.pageKey },
    update: {
      title: PAGE.title,
      content: JSON.stringify([heroBlock]),
      contentHtml,
      metaTitle: PAGE.metaTitle,
      metaDescription: PAGE.metaDescription,
      sortOrder: PAGE.sortOrder,
    },
    create: {
      pageKey: PAGE.pageKey,
      title: PAGE.title,
      content: JSON.stringify([heroBlock]),
      contentHtml,
      metaTitle: PAGE.metaTitle,
      metaDescription: PAGE.metaDescription,
      sortOrder: PAGE.sortOrder,
    },
  });

  const imgCount = (contentHtml.match(/<img/g) || []).length;
  console.log(
    `✅ ${PAGE.pageKey} 已保存 id=${page.id} | contentHtml=${contentHtml.length}B | images=${imgCount}`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
