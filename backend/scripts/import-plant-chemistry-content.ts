/**
 * 植物化学（Plant Chemistry）子页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=189（title=植物化学）→ contentId=1617 → webContents.content
 * 存储：page_contents (pageKey = 'plant-chemistry')
 *
 * 正文结构：block-accroche 简介 + 3 个图文区块（高效活性物质/供应链范例/创新提取工艺）
 *          + 「相关内容」c-card 区块（3 张卡：油脂化学/应用实验室/可持续采购）
 * 4 张图（正文 1 张 webp 大图 + 3 张 card_default 卡图）此前全站复刻时已本地化
 *
 * 同时删除旧占位记录 pageKey='expertise_plant'（id=4，占位文本，全代码库无引用）
 *
 * 数据源快照: .localize_tmp/plant_content_1617.json（api/webContents/findWebContents?ID=1617）
 * 运行: cd backend && npx tsx scripts/import-plant-chemistry-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'plant-chemistry',
  newsId: 189,
  contentId: 1617,
  title: '植物化学',
  metaTitle: '植物化学 ⋅ 嘉法狮',
  metaDescription:
    '嘉法狮长期以来在植物化学领域表现出色。这一切都可以追溯到上世纪之交，当时在法国普罗旺斯进行精油蒸馏。该公司逐渐扩展了这一核心专业知识，包括选择性提取植物化学物质，为化妆品行业提供创新、有效的活性物质。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/plant-chemistry.jpg.jpg',
  apiFile: 'plant_content_1617.json',
  sortOrder: 37,
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
    where: { pageKey: 'expertise_plant', contentHtml: { contains: '请在管理后台编辑' } },
  });

  const imgCount = (contentHtml.match(/<img/g) || []).length;
  console.log(
    `✅ ${PAGE.pageKey} 已保存 id=${page.id} | contentHtml=${contentHtml.length}B | images=${imgCount} | 旧占位 expertise_plant 删除 ${removed.count} 条`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
