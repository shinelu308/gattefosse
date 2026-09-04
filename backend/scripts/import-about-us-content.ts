/**
 * 关于我们（About Us）页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=135（title=关于我们）→ contentId=748 → webContents.content
 * 存储：page_contents (pageKey = 'about-us')；同时删除旧键 'about'（id=1，336B 旧占位，无代码引用）
 *
 * 正文结构（32KB）：完整 article 内层 DOM（含 block-title h1「关于我们」+ block-accroche
 *          + 3 个章节「我们发展的核心/140年家族史/数字嘉法狮」+ 5 张图 + 基金会外链）
 *          → 前端 region-content 整体 v-html 注入（与原中文站同款模式）
 *
 * 图片：5 张中 2 张从 gattefosse.com 下载成功（segolene 引言图、labo-et-machines webp）；
 *      3 张卡图（people-make-our-name / presence-internationale / notre-demarche-rse）
 *      在两站均已 404（原中文站线上即坏图），但本地已有同名 .jpg.jpg 变体
 *      → rewriteUrls 特例重写为本地 .jpg.jpg 路径
 *
 * 数据源快照: .localize_tmp/about_content_748.json（api/webContents/findWebContents?ID=748）
 * 运行: cd backend && npx tsx scripts/import-about-us-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'about-us',
  newsId: 135,
  contentId: 748,
  title: '关于我们',
  metaTitle: '关于我们 ⋅ 嘉法狮',
  metaDescription:
    '我们的使命是以科学进步推动人类福祉。嘉法狮公司于 1880 年在法国里昂创立，是为全球美丽和健康行业提供特种成分和配方解决方案的领先供应商。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-06/about-us.jpg.jpg',
  apiFile: 'about_content_748.json',
  sortOrder: 30,
};

/** 重写图片绝对 URL 为本地路径；3 张 404 的 .jpg.webp 卡图重写为本地 .jpg.jpg 变体 */
function rewriteUrls(raw: string): string {
  let html = raw
    .replace(/https?:\/\/www\.gattefossechina\.cn\/sites\//g, '/sites/')
    .replace(/https?:\/\/www\.gattefosse\.com\/sites\//g, '/sites/')
    .replace(/\/\/www\.gattefosse\.com\/sites\//g, '/sites/')
    .replace(/\/\/www\.gattefossechina\.cn\/sites\//g, '/sites/');
  const deadToLocalJpg: Array<[string, string]> = [
    ['people-make-our-name-302x201.jpg.webp', 'people-make-our-name-302x201.jpg.jpg'],
    ['presence-internationale-302x201.jpg.webp', 'presence-internationale-302x201.jpg.jpg'],
    ['notre-demarche-rse-302x201.jpg.webp', 'notre-demarche-rse-302x201.jpg.jpg'],
  ];
  for (const [dead, local] of deadToLocalJpg) {
    html = html.split(dead).join(local);
  }
  return html;
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

  // 清理被取代的旧键记录（336B 旧占位，全代码库无引用）
  const removed = await prisma.pageContent.deleteMany({
    where: { pageKey: 'about', contentHtml: { not: { contains: 'block-title' } } },
  });

  const imgCount = (contentHtml.match(/<img/g) || []).length;
  const deadCount = (contentHtml.match(/people-make-our-name-302x201\.jpg\.webp|presence-internationale-302x201\.jpg\.webp|notre-demarche-rse-302x201\.jpg\.webp/g) || []).length;
  console.log(
    `✅ ${PAGE.pageKey} 已保存 id=${page.id} | contentHtml=${contentHtml.length}B | images=${imgCount} | 残留404图引用=${deadCount} | 旧键 about 删除 ${removed.count} 条`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
