/**
 * 油脂化学（Lipid Chemistry）子页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=188（title=油脂化学）→ contentId=1616 → webContents.content
 * 存储：page_contents (pageKey = 'lipid-chemistry')
 *
 * 正文结构：block-accroche 简介 + 4 个图文区块（历史渊源/稳健工艺/脂质材料/科学与CSR）
 *          + 「相关内容」c-card 区块（3 张卡：植物化学/感官分析/皮肤生物学）
 * 3 张卡图虽引用 www.gattefosse.com 域名，但 rewriteUrls 后走本地路径，
 * card_default style 3 张图此前全站复刻时已本地化
 *
 * 同时删除旧占位记录 pageKey='expertise_lipid'（id=3，内容为「请在管理后台编辑」占位文本，
 * 全代码库无任何引用，被 lipid-chemistry 正式取代）
 *
 * 数据源快照: .localize_tmp/lipid_content_1616.json（api/webContents/findWebContents?ID=1616）
 * 运行: cd backend && npx tsx scripts/import-lipid-chemistry-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'lipid-chemistry',
  newsId: 188,
  contentId: 1616,
  title: '油脂化学',
  metaTitle: '油脂化学 ⋅ 嘉法狮',
  metaDescription:
    '过去 70 年来，嘉法狮在油脂化学领域积累了独特的、受公众认可的专业知识。我们为化妆品和制药行业设计和生产功能性成分。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/lipid-chemistry.jpg.jpg',
  apiFile: 'lipid_content_1616.json',
  sortOrder: 36,
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

  // 清理被取代的旧占位记录（无代码引用）
  const removed = await prisma.pageContent.deleteMany({
    where: { pageKey: 'expertise_lipid', contentHtml: { contains: '请在管理后台编辑' } },
  });

  const imgCount = (contentHtml.match(/<img/g) || []).length;
  console.log(
    `✅ ${PAGE.pageKey} 已保存 id=${page.id} | contentHtml=${contentHtml.length}B | images=${imgCount} | 旧占位 expertise_lipid 删除 ${removed.count} 条`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
