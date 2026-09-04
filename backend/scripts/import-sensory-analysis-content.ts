/**
 * 感官分析（Sensory Analysis）子页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=192（title=感官分析）→ contentId=1620 → webContents.content
 * 存储：page_contents (pageKey = 'sensory-analysis')
 *
 * 正文结构：block-accroche 简介 + 3 个章节（感官分析的作用/我们的感官分析/评估产品的3个步骤）
 *          + 4 个 YouTube iframe 嵌入视频（保留原站外链 embed，无需本地化）
 *          + 「相关内容」c-card 区块（3 张卡：应用实验室/皮肤生物学/植物化学，图均已本地化）
 *
 * 数据源快照: .localize_tmp/sensory_content_1620.json（api/webContents/findWebContents?ID=1620）
 * 运行: cd backend && npx tsx scripts/import-sensory-analysis-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'sensory-analysis',
  newsId: 192,
  contentId: 1620,
  title: '感官分析',
  metaTitle: '感官分析 ⋅ 嘉法狮',
  metaDescription:
    '作为该领域的领导者，我们很早便成立了一个专门研究感官特征的专家小组——特别为化妆品和外用药物制剂。无论他们是在评估我们自己的配方还是市场上的其他产品，他们均能够准确地评估产品的物理和感官特性，并将这些感受转化为客观数据。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/sensory-analysis.jpg.jpg',
  apiFile: 'sensory_content_1620.json',
  sortOrder: 40,
};

/** 重写图片绝对 URL 为本地路径（与 CSR hub 一致；YouTube embed 外链保留） */
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
    `✅ ${PAGE.pageKey} 已保存 id=${page.id} | contentHtml=${contentHtml.length}B | images=${imgCount} | youtube=${(contentHtml.match(/youtube\.com\/embed/g) || []).length} | 残留外站图引用=${remoteCount}`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
