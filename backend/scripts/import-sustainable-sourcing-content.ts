/**
 * 可持续采购（Sustainable Sourcing）子页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=191（title=可持续采购）→ contentId=1619 → webContents.content
 * 存储：page_contents (pageKey = 'sustainable-sourcing')
 *
 * 正文结构：block-accroche 简介 + 2 个图文区块（植物学广泛研究/最高标准的供应）
 *          + 「相关内容」c-card 区块（3 张卡：企业社会责任/皮肤生物学/植物化学）
 * 5 张图中 4 张此前已本地化；正文大图 dji_0495.jpg.webp 从 www.gattefosse.com 下载补齐
 *
 * 数据源快照: .localize_tmp/sourcing_content_1619.json（api/webContents/findWebContents?ID=1619）
 * 运行: cd backend && npx tsx scripts/import-sustainable-sourcing-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'sustainable-sourcing',
  newsId: 191,
  contentId: 1619,
  title: '可持续采购',
  metaTitle: '可持续采购 ⋅ 嘉法狮',
  metaDescription:
    '在其历史的不同阶段，嘉法狮都非常重视植物学的研究。其投资证明了该公司对植物的强烈兴趣，因为植物是高质量、复杂的原材料，需要进行深入的科学研究才能在工业中得到充分利用。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/sourcing.jpg.jpg',
  apiFile: 'sourcing_content_1619.json',
  sortOrder: 39,
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
