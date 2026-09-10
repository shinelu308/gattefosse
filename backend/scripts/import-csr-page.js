/**
 * 社会责任页（corporate-social-responsability）内容导入
 * 对齐原站 https://www.gattefosse.com/innovating-care-and-responsibility（2026 版）
 * 数据源：backend/scripts/data/csr-page.content.html（随仓库走）
 * 配套：页面静态部分（banner + 全宽轮播）直接改 site/corporate-social-responsability.html
 *
 * 用法：cd backend && node scripts/import-csr-page.js
 * 幂等：已有 pageKey 则更新，否则创建
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const PAGE = {
  pageKey: 'corporate-social-responsability',
  file: 'csr-page.content.html',
  title: '创新，以关爱与责任为本',
  metaTitle: '创新，以关爱与责任为本 ⋅ 嘉法狮',
  metaDescription:
    '嘉法狮企业社会责任路线图 Gatt\'Up&Act：三大承诺领域、25 项 2035 目标、科学碳目标、EcoVadis 金牌与负责任采购承诺。',
  sortOrder: 30,
  // 结构化区块（后台「内容管理 → 结构化区块」编辑用），需与前台静态 banner/contentHtml 保持一致
  heroBlock: {
    type: 'hero',
    data: {
      title: '创新，以关爱与责任为本',
      summary:
        '多年来，嘉法狮始终践行负责任的发展之道，凝聚成一个共同的愿景：在环境与社会挑战面前，负责任地创新，用关爱付诸行动。这一进取的姿态，凝结为结构化的行动路线图 Gatt\'Up&Act：以 25 项雄心勃勃且切实可行的目标为基石，指引集团未来十年的前行方向。',
      backgroundImage:
        '/sites/default/files/styles/page_banner_desktop_full/public/2026-03/copie_de_website_news_cover_1140x405.jpg.webp',
      buttons: [],
      videoUrl: '',
      videoType: '',
    },
  },
};

async function main() {
  const html = fs.readFileSync(path.join(__dirname, 'data', PAGE.file), 'utf8');
  const existing = await prisma.pageContent.findUnique({ where: { pageKey: PAGE.pageKey } });
  const data = {
    title: PAGE.title,
    metaTitle: PAGE.metaTitle,
    metaDescription: PAGE.metaDescription,
    contentHtml: html,
    content: JSON.stringify([PAGE.heroBlock]),
    sortOrder: PAGE.sortOrder,
  };
  if (existing) {
    await prisma.pageContent.update({ where: { pageKey: PAGE.pageKey }, data });
    console.log(`[csr] updated pageContent id=${existing.id} pageKey=${PAGE.pageKey}`);
  } else {
    const created = await prisma.pageContent.create({ data: { pageKey: PAGE.pageKey, ...data } });
    console.log(`[csr] created pageContent id=${created.id} pageKey=${PAGE.pageKey}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
