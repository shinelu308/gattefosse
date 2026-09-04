/**
 * 公司历史（History）页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=236（title=历史）→ contentId=6633 → webContents.content
 * 存储：page_contents (pageKey = 'history'，覆盖 id=2 旧占位记录「公司历史内容…编辑」)
 *
 * 正文结构（33.8KB，系列最大）：7 个年代时间线章节（1880/1900-1930/1930-1950/1950-1960/
 *          1960-1975/1975-1996/1997-2023），14 张历史照片（全部本地路径已就绪），
 *          章节锚点 id 与页面静态左侧「概括」目录一一对应
 *          （1880-birth-company / 1900-1930-perfume-and-aromatics / ... / 1997-2023-growing-and-strong-international-organization）
 *
 * 数据源快照: .localize_tmp/history_content_6633.json（api/webContents/findWebContents?ID=6633）
 * 运行: cd backend && npx tsx scripts/import-history-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'history',
  newsId: 236,
  contentId: 6633,
  title: '公司历史',
  metaTitle: '公司历史 ⋅ 嘉法狮',
  metaDescription:
    '嘉法狮的故事始于 1880 年，从里昂的一家油布贸易企业起步，逐步发展为油脂化学、天然活性物与药用辅料领域的国际家族企业集团。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/histoire-1140x405-2.jpg.jpg',
  apiFile: 'history_content_6633.json',
  sortOrder: 31,
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
