/**
 * 法务/导航页内容导入（page_contents）
 * 数据源：中文原站 gattefossechina.cn
 *   - 法律声明      webNewsEvents ID=235 → webContents contentId=6278
 *   - 条款和条件    webNewsEvents ID=210 → webContents contentId=2265
 *   - 隐私政策      webNewsEvents ID=144 → webContents contentId=865
 *   - 全站导航      webNewsEvents ID=234 → webContents contentId=6083
 * 正文快照：backend/scripts/data/*.content.html（随仓库走；已把绝对站内地址改写成根相对路径）
 *
 * 用法：cd backend && node scripts/import-legal-pages.js
 * 幂等：pageContent.upsert 覆盖
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, 'data');

const PAGES = [
  {
    pageKey: 'legal-notice',
    file: 'legal-notice.content.html',
    title: '法律声明',
    metaTitle: '法律声明 ⋅ 嘉法狮',
    metaDescription:
      '本网站由嘉法狮（上海）贸易有限公司拥有、管理和维护。使用本网站前请仔细阅读《条款与条件》及《隐私政策》。',
    sortOrder: 80,
  },
  {
    pageKey: 'terms-and-conditions',
    file: 'terms-and-conditions.content.html',
    title: '条款和条件',
    metaTitle: '条款和条件 ⋅ 嘉法狮',
    metaDescription:
      '本《一般条款和条件》适用于用户浏览嘉法狮中国官网及使用其功能的场景，包含网站使用条款与销售通用条款。',
    sortOrder: 81,
  },
  {
    pageKey: 'personal-data-policy',
    file: 'personal-data-policy.content.html',
    title: '隐私政策',
    metaTitle: '隐私政策 ⋅ 嘉法狮',
    metaDescription:
      '嘉法狮（上海）贸易有限公司网站隐私政策，说明我们如何收集、使用、存储和保护您的个人信息，以及您享有的相关权利。',
    sortOrder: 82,
  },
  {
    pageKey: 'sitemap',
    file: 'sitemap.content.html',
    title: '全站导航',
    metaTitle: '全站导航 ⋅ 嘉法狮',
    metaDescription:
      '嘉法狮中国官网全站导航，快速查找个人护理、药用辅料、社会责任、专业知识、关于我们等栏目下的全部页面。',
    sortOrder: 83,
  },
];

async function main() {
  for (const p of PAGES) {
    const htmlPath = path.join(DATA_DIR, p.file);
    if (!fs.existsSync(htmlPath)) {
      console.error(`✗ 缺少正文快照：${htmlPath}`);
      process.exitCode = 1;
      continue;
    }
    const html = fs.readFileSync(htmlPath, 'utf-8').trim();
    if (!html) {
      console.error(`✗ 正文为空：${p.file}`);
      process.exitCode = 1;
      continue;
    }
    const page = await prisma.pageContent.upsert({
      where: { pageKey: p.pageKey },
      update: {
        title: p.title,
        contentHtml: html,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        sortOrder: p.sortOrder,
      },
      create: {
        pageKey: p.pageKey,
        title: p.title,
        contentHtml: html,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        sortOrder: p.sortOrder,
      },
    });
    console.log(`OK  ${p.pageKey} | id=${page.id} | html=${html.length}B | title=${p.title}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
