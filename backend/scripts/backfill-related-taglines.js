/**
 * 给「相关产品」区块的产品补上 tagline（宣传标语）
 *
 * 背景：related 区块的 products 是 PC 成分的字段快照，早期只存了
 *       id/name/inciName/imageUrl/description，没有 tagline。
 *       英文原站卡片是「标题 / 标语 / INCI / 摘要」四段式，缺了标语排版会显得空。
 *
 * 用法：
 *   node scripts/backfill-related-taglines.js           # dry-run
 *   node scripts/backfill-related-taglines.js --apply   # 写库
 */
const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

(async () => {
  console.log('模式: ' + (APPLY ? 'APPLY' : 'DRY-RUN'));

  const blocks = await prisma.$queryRawUnsafe(
    "SELECT id, product_type, product_id, content FROM content_blocks WHERE block_type = 'related' ORDER BY id"
  );
  console.log('related 区块: ' + blocks.length + ' 个');

  const pcs = await prisma.$queryRawUnsafe('SELECT id, name, tagline FROM pc_ingredients');
  const taglineById = new Map(pcs.map((r) => [Number(r.id), r.tagline || '']));

  let changedBlocks = 0;
  let filled = 0;

  for (const b of blocks) {
    let content;
    try { content = typeof b.content === 'string' ? JSON.parse(b.content) : b.content; } catch (e) { console.log('  ⚠ 区块 ' + b.id + ' JSON 解析失败，跳过'); continue; }
    if (!content || !Array.isArray(content.products)) continue;

    let dirty = false;
    for (const p of content.products) {
      if (p.tagline) continue;
      const t = taglineById.get(Number(p.id));
      if (t) { p.tagline = t; dirty = true; filled++; console.log('  + 区块 ' + b.id + ' / ' + p.name + ' → ' + t); }
      else console.log('  - 区块 ' + b.id + ' / ' + (p.name || p.id) + '：PC 库里没有标语');
    }

    if (dirty) {
      changedBlocks++;
      if (APPLY) {
        await prisma.$executeRawUnsafe(
          "UPDATE content_blocks SET content = ?, updated_at = datetime('now') WHERE id = ?",
          JSON.stringify(content),
          b.id
        );
      }
    }
  }

  console.log('\n待更新区块: ' + changedBlocks + ' | 补上的标语: ' + filled);
  if (!APPLY) console.log('（dry-run，未写库；加 --apply 执行）');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('💥 ' + e.message);
  await prisma.$disconnect();
  process.exit(1);
});
