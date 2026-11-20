/**
 * 把 PDF 提取出来的成分表写成配方详情页的「成分配方表」区块（blockType=formula）
 *
 * 数据源: backend/scripts/data/formula-tables.json  [{ code, name, rows:[{phase,name,inci,supplier,percent}] }]
 * 用法: node scripts/seed-formula-tables.js            # dry-run，只打印
 *       node scripts/seed-formula-tables.js --apply    # 写库
 *       FORCE=1 ... --apply                            # 覆盖已存在的 formula 区块
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';
const DATA = path.join(__dirname, 'data', 'formula-tables.json');
const TITLE = 'Formula';

// 置底区块：相关产品 / 相关资料
function pinRank(b) {
  if (b.blockType === 'related') return 2;
  if (b.blockType === 'files' && String(b.title || '').trim() === '相关资料') return 1;
  return 0;
}

(async () => {
  const items = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  console.log(`数据 ${items.length} 条，${APPLY ? '写库模式' : 'dry-run'}`);

  let created = 0, updated = 0, skipped = 0, noFormula = 0;
  const msgs = [];

  for (const it of items) {
    const rows = (it.rows || []).filter((r) => (r.name || '').trim() || (r.inci || '').trim());
    if (!rows.length) { noFormula++; continue; }

    const f = await prisma.formulation.findFirst({ where: { code: it.code }, select: { id: true, name: true } });
    if (!f) { msgs.push(`  跳过 ${it.code} ${it.name}: 库里没有该编号`); skipped++; continue; }

    const blocks = await prisma.contentBlock.findMany({
      where: { productId: f.id, productType: 'formula' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, blockType: true, title: true, sortOrder: true, content: true },
    });

    const exist = blocks.find((b) => b.blockType === 'formula');
    const content = JSON.stringify({ rows });

    if (exist) {
      if (!FORCE) { skipped++; continue; }
      if (APPLY) {
        await prisma.contentBlock.update({ where: { id: exist.id }, data: { content, title: exist.title || TITLE } });
      }
      updated++;
      continue;
    }

    // 插到「置底块」之前
    let insertAt = blocks.length;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (pinRank(blocks[i]) === 0) { insertAt = i + 1; break; }
      insertAt = i;
    }

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        const nb = await tx.contentBlock.create({
          data: {
            productId: f.id,
            productType: 'formula',
            blockType: 'formula',
            title: TITLE,
            content,
            sortOrder: insertAt,
            isPublished: true,
          },
        });
        // 重排 sortOrder：新块之后的所有块 +1
        const after = blocks.filter((b) => b.sortOrder >= insertAt);
        for (const b of after) {
          await tx.contentBlock.update({ where: { id: b.id }, data: { sortOrder: b.sortOrder + 1 } });
        }
        return nb;
      });
    }
    created++;
  }

  console.log(`新建 ${created} / 更新 ${updated} / 跳过 ${skipped} / 无表格 ${noFormula}`);
  if (msgs.length) console.log(msgs.join('\n'));
  if (!APPLY) console.log('（dry-run，未写库；加 --apply 生效）');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e);
  await prisma.$disconnect();
  process.exit(1);
});
