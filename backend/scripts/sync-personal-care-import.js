/**
 * 从数据库同步 personal-care 页面数据到 import-personal-care-data.js
 * 用法：node backend/scripts/sync-personal-care-import.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, 'import-personal-care-data.js');

function escapeString(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function stringifyBlocks(blocks) {
  return JSON.stringify(blocks, null, 2)
    .replace(/"/g, "'")
    .replace(/\n/g, '\n  ')
    .replace(/\{\\n  /g, '{\n  ');
}

async function main() {
  const page = await prisma.pageContent.findUnique({ where: { pageKey: 'personal-care' } });
  if (!page) {
    console.error('personal-care page not found in database');
    process.exit(1);
  }

  const blocks = typeof page.content === 'string' ? JSON.parse(page.content) : page.content;
  const blocksStr = stringifyBlocks(blocks);
  const blocksArray = '[\n  ' + blocksStr.slice(2, -2) + '\n]';

  const script = "/**\n" +
    " * 导入个人护理页面数据\n" +
    " * 写入 page_contents 表的 content JSON 字段\n" +
    " * 由 sync-personal-care-import.js 从数据库最新数据生成\n" +
    " */\n\n" +
    "const { PrismaClient } = require('@prisma/client');\n" +
    "const prisma = new PrismaClient();\n\n" +
    "const blocks = " + blocksArray + ";\n\n" +
    "async function main() {\n" +
    "  // Upsert the personal-care page\n" +
    "  const page = await prisma.pageContent.upsert({\n" +
    "    where: { pageKey: 'personal-care' },\n" +
    "    update: {\n" +
    "      title: '" + escapeString(page.title) + "',\n" +
    "      content: JSON.stringify(blocks),\n" +
    "      metaTitle: " + (page.metaTitle ? "'" + escapeString(page.metaTitle) + "'" : "null") + ",\n" +
    "      metaDescription: " + (page.metaDescription ? "'" + escapeString(page.metaDescription) + "'" : "null") + ",\n" +
    "      slug: " + (page.slug ? "'" + escapeString(page.slug) + "'" : "null") + ",\n" +
    "      updatedAt: new Date(),\n" +
    "    },\n" +
    "    create: {\n" +
    "      pageKey: 'personal-care',\n" +
    "      title: '" + escapeString(page.title) + "',\n" +
    "      content: JSON.stringify(blocks),\n" +
    "      metaTitle: " + (page.metaTitle ? "'" + escapeString(page.metaTitle) + "'" : "null") + ",\n" +
    "      metaDescription: " + (page.metaDescription ? "'" + escapeString(page.metaDescription) + "'" : "null") + ",\n" +
    "      slug: " + (page.slug ? "'" + escapeString(page.slug) + "'" : "null") + ",\n" +
    "      sortOrder: " + (page.sortOrder ?? 30) + ",\n" +
    "    },\n" +
    "  });\n" +
    "  console.log('✅ personal-care page upserted, id:', page.id);\n" +
    "  console.log('   Blocks:', blocks.length, 'types:', blocks.map(b => b.type).join(', '));\n" +
    "}\n\n" +
    "main()\n" +
    "  .catch(e => { console.error('Error:', e); process.exit(1); })\n" +
    "  .finally(() => prisma.$disconnect());\n";

  fs.writeFileSync(outputFile, script, 'utf-8');
  console.log('✅ Synced to', outputFile);
  console.log('   Blocks:', blocks.length, 'types:', blocks.map(b => b.type).join(', '));
}

main()
  .catch(e => { console.error('Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
