/**
 * 新闻媒体（Press）页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=143（title=新闻媒体）→ contentId=756 → webContents.content
 * 存储：page_contents (pageKey = 'press')
 *
 * 正文结构（33.2KB）：block-accroche（记者引导 + 嘉法狮基金会外链）
 *          + 按年份分组的新闻稿 accordion（2024/2023/2022/2021…collapse 折叠组）
 *          每组内为新闻稿条目（标题 + 日期 + PDF 下载链接 + 配图）
 * 18 个 PDF（/files/9xx/*.pdf）与 1 张图此前全站复刻时已本地化，零补资源
 *
 * 数据源快照: .localize_tmp/press_content.json（api/webContents/findWebContents?ID=756）
 * 运行: cd backend && npx tsx scripts/import-press-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'press',
  newsId: 143,
  contentId: 756,
  title: '新闻媒体',
  metaTitle: '新闻媒体 ⋅ 嘉法狮',
  metaDescription:
    '如果您是一名记者，有兴趣了解更多有关嘉法狮、其新闻或产品的信息吗？在本部分中，您可以找到我们的新闻稿、照片等更多内容。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/microsoftteams-image-11.png.png',
  apiFile: 'press_content.json',
  sortOrder: 34,
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
  const pdfCount = (contentHtml.match(/\.pdf/g) || []).length;
  console.log(
    `✅ ${PAGE.pageKey} 已保存 id=${page.id} | contentHtml=${contentHtml.length}B | images=${imgCount} | pdf链接=${pdfCount}`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
