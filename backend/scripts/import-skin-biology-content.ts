/**
 * 皮肤生物学（Skin Biology）子页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=190（title=皮肤生物学）→ contentId=1618 → webContents.content
 * 存储：page_contents (pageKey = 'skin-biology')
 *
 * 正文结构：block-accroche 简介 + 3 个纯文字章节
 *   （细胞培养模型证实化妆品活性成分 / 人造皮肤 3D 模型 / 通过皮肤生物学研究进行创新）
 * 无图片/卡片/轮播；banner 图 skin-biology-2_0.jpg.jpg 此前已本地化
 *
 * 数据源快照: .localize_tmp/skin_content_1618.json（api/webContents/findWebContents?ID=1618）
 * 运行: cd backend && npx tsx scripts/import-skin-biology-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'skin-biology',
  newsId: 190,
  contentId: 1618,
  title: '皮肤生物学',
  metaTitle: '皮肤生物学 ⋅ 嘉法狮',
  metaDescription:
    '嘉法狮于 2013 年在其总部开设了一个细胞生物学实验室，包括洁净室。实验室技术人员和科学家致力于皮肤细胞和组织的研究，并开展皮肤生物学研究，旨在开发化妆品验证测试和创新研究模型。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/skin-biology-2_0.jpg.jpg',
  apiFile: 'skin_content_1618.json',
  sortOrder: 38,
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
