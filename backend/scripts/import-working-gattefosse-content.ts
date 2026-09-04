/**
 * 与嘉法狮共事（Working at Gattefossé）页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=133（title=与嘉法狮共事）→ contentId=132 → webContents.content
 * 存储：page_contents (pageKey = 'working-gattefosse')
 *
 * 正文结构：block-accroche 简介 + 1 个纯文字章节（加入 140 年历史的团队：价值观/企业文化）
 *          无图片引用；banner carriere_0.jpg.jpg 已本地化
 *
 * 数据源快照: .localize_tmp/working_content_132.json（api/webContents/findWebContents?ID=132）
 * 运行: cd backend && npx tsx scripts/import-working-gattefosse-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'working-gattefosse',
  newsId: 133,
  contentId: 132,
  title: '与嘉法狮共事',
  metaTitle: '与嘉法狮一起工作 ⋅ 嘉法狮',
  metaDescription:
    '加入嘉法狮意味着加入了一个国际化的科学团队，在这个团队中，你每天都可以遇到来自于化妆品和医药领域的新挑战。嘉法狮的公司文化来源于客户需求与其本身对创新的追求。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/carriere_0.jpg.jpg',
  apiFile: 'working_content_132.json',
  sortOrder: 33,
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
