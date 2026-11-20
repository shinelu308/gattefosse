/**
 * 修页面正文里的 3 类残留死链（数据层，幂等）
 *
 * 背景：原中文站 CMS 迁移遗留的坏链形态，点进去必然是空白页：
 *   1. 口服/外用给药「地标图」里 Labrafac™ MC60 指向 ?id=203/learn-more/brochures/...（原站也打不开）
 *   2. 植物化学页「活性成分」指向 ?id=202/product-finder?f[0]=functionalities:13
 *   3. 新闻媒体页折叠面板按钮 href 指向详情页 143（应为页内锚点）
 *
 * 用法：
 *   node scripts/fix-page-bad-links.js            # dry-run，只报告
 *   node scripts/fix-page-bad-links.js --apply    # 写库
 *
 * 注：1、2 的源文件在 scripts/data/*.content.html（已同步修正）；
 *     press / plant-chemistry 的正文只存在于数据库，本脚本是唯一修复入口。
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const RULES = [
  {
    name: 'MC60 地标 -> 产品详情 11038',
    from: 'formulation-technologies-detail.html?id=203/learn-more/brochures/labrafac-mc60',
    to: 'pharmaceuticals/product-finder/product-detail.html?id=11038',
    keys: ['oral-drug-delivery', 'topical-drug-delivery'],
  },
  {
    name: '植物化学「活性成分」-> 个人护理原料查找器',
    from: 'formulation-technologies-detail.html?id=202/product-finder?f%5B0%5D=functionalities%3A13',
    to: 'personal-care/product-finder.html',
    keys: ['plant-chemistry'],
  },
  {
    name: '新闻媒体折叠按钮 -> 页内锚点',
    from: 'formulation-technologies-detail.html?id=143#collapse-2024-379435767',
    to: '#collapse-2024-379435767',
    keys: ['press'],
  },
];

(async () => {
  let total = 0;
  for (const r of RULES) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT page_key, content_html FROM page_contents WHERE page_key IN (${r.keys.map((k) => `'${k}'`).join(',')})`
    );
    let n = 0;
    for (const row of rows) {
      const h = row.content_html || '';
      const cnt = h.split(r.from).length - 1;
      if (!cnt) continue;
      n += cnt;
      if (APPLY) {
        await prisma.$executeRawUnsafe(
          'UPDATE page_contents SET content_html = ? WHERE page_key = ?',
          h.split(r.from).join(r.to),
          row.page_key
        );
      }
    }
    total += n;
    console.log(`${APPLY ? '✔ 已修' : '· dry-run'} ${r.name} — ${n} 处`);
  }
  console.log(`合计 ${total} 处${APPLY ? '' : '（加 --apply 写库）'}`);
  await prisma.$disconnect();
})();
