/* 将原站 markets (news 145 → content 904) 的富 HTML 写入 page_contents.markets.content_html */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function main() {
  // 读取本地缓存的 content_904.html（在项目 _tmp_analysis 下，正常应随本脚本旁路）
  const htmlPath = join(__dirname, '..', '..', '_tmp_analysis', 'content_904.html');
  const html = readFileSync(htmlPath, 'utf-8').trim();

  const page = await prisma.pageContent.upsert({
    where: { pageKey: 'markets' },
    update: {
      title: '市场分类',
      contentHtml: html,
      metaTitle: '市场分类 - Gattefossé',
      metaDescription: '嘉法狮为所有给药途径提供创新辅料，服务于人用药、动物用药和保健食品市场。',
    },
    create: {
      pageKey: 'markets',
      title: '市场分类',
      contentHtml: html,
      metaTitle: '市场分类 - Gattefossé',
      metaDescription: '嘉法狮为所有给药途径提供创新辅料，服务于人用药、动物用药和保健食品市场。',
      sortOrder: 70,
    },
  });
  console.log('✅ markets pageContent saved: id=' + page.id + ' contentHtml length=' + (html.length));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
