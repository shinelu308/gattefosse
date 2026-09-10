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
};

async function main() {
  const html = fs.readFileSync(path.join(__dirname, 'data', PAGE.file), 'utf8');
  const existing = await prisma.pageContent.findUnique({ where: { pageKey: PAGE.pageKey } });
  const data = {
    title: PAGE.title,
    metaTitle: PAGE.metaTitle,
    metaDescription: PAGE.metaDescription,
    contentHtml: html,
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
