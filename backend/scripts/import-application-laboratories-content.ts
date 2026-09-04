/**
 * 应用实验室（Application Laboratories）子页内容导入脚本
 * 数据源：原中文站 webNewsEvents ID=106（title=应用实验室）→ contentId=105 → webContents.content
 * 存储：page_contents (pageKey = 'application-laboratories')
 *
 * 正文结构：block-accroche 简介 + 「四个技术卓越中心 (TCE) 激发创新」图文章节
 *          （含 2 个 youtu.be 视频外链 + 2 张实验室 webp 图）+「相关内容」3 卡片
 *          （工业运营/油脂化学/植物化学）
 * 2 张正文图从 www.gattefosse.com 下载补齐（91881/96121），3 张卡图已本地化
 *
 * 数据源快照: .localize_tmp/applic_content_105.json（api/webContents/findWebContents?ID=105）
 * 运行: cd backend && npx tsx scripts/import-application-laboratories-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const PAGE = {
  pageKey: 'application-laboratories',
  newsId: 106,
  contentId: 105,
  title: '应用实验室',
  metaTitle: '应用实验室 ⋅ 嘉法狮',
  metaDescription:
    '嘉法狮应用实验室的目标是展示我们的成分在配方中的优势。我们提供开发化妆品和药物配方所需的先进技术支持。',
  heroBg:
    '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/application-laboratories-2_0.jpg.jpg',
  apiFile: 'applic_content_105.json',
  sortOrder: 41,
};

/** 重写图片绝对 URL 为本地路径（与 CSR hub 一致；youtu.be 视频外链保留） */
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
