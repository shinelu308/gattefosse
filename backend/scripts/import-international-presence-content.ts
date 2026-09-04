/**
 * 国际影响力（International Presence）页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=107（title=国际影响力）→ contentId=106 → webContents.content
 * 存储：page_contents (pageKey = 'international-presence')
 *
 * 正文结构：block-accroche 简介（90+ 国家、78% 国际营业额）+ 3 个章节
 *          （世界地图/生产基地/应用实验室），3 张图全部本地路径已就绪
 *
 * 数据源快照: .localize_tmp/intl_content_106.json（api/webContents/findWebContents?ID=106）
 * 运行: cd backend && npx tsx scripts/import-international-presence-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'international-presence',
  newsId: 107,
  contentId: 106,
  title: '国际影响力',
  metaTitle: '国际影响力 ⋅ 嘉法狮',
  metaDescription:
    '我们的业务遍及 90 多个国家和地区，近 78% 的营业额来自国际销售。我们开发本地化和敏捷方便的方法，在每个领域引入并分享我们的专业知识。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/presence-international2_0.jpg.jpg',
  apiFile: 'intl_content_106.json',
  sortOrder: 32,
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
  const remoteCount = (contentHtml.match(/https?:\/\/[^"']*/g) || []).filter(
    (u) => u.includes('gattefosse.com/sites') || u.includes('gattefossechina.cn/sites')
  ).length;
  console.log(
    `✅ ${PAGE.pageKey} 已保存 id=${page.id} | contentHtml=${contentHtml.length}B | images=${imgCount} | 残留外站图引用=${remoteCount}`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
