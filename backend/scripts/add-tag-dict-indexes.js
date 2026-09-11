/**
 * 给 tag_dictionary 加唯一索引（2026-09-12 / P2）
 * ============================================================================
 * 原表**没有任何唯一约束**，同一分类下可以插入重复 value，后果是：
 * 前台筛选器出现两个一模一样的选项、后台列表里两行无法分辨。
 *
 * ⚠️ 这里刻意**没有**照搬「@@unique([productLine, category, value])」：
 *    article_theme 的字典是 label=英文原词 / value=中文译文，
 *    而 texture 与 textures 都译作「质地」—— 这是**合法同译**，按 value 唯一会误杀。
 *    实测：全表唯一一处 value 冲突正好就是这一对（id 524/525）。
 *
 * 因此实际落两条索引：
 *   1. uq_tag_dict_label    (product_line, category, label)  —— 四条产品线通吃，label 天然是身份
 *   2. uq_tag_dict_value    (product_line, category, value) WHERE product_line <> 'article_theme'
 *      —— 部分索引，只在有产品字段承载的三条线上保证 value 唯一（value 才是产品里存的东西）
 *
 * 用法：
 *   node scripts/add-tag-dict-indexes.js              # 预演（只报告，不建）
 *   node scripts/add-tag-dict-indexes.js --apply      # 实际执行（幂等，可重复跑）
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const INDEXES = [
  {
    name: 'uq_tag_dict_label',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_dict_label ON tag_dictionary(product_line, category, label)`,
    desc: '同一产品线同一分类下 label 唯一（四条线通吃）',
  },
  {
    name: 'uq_tag_dict_value',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_dict_value ON tag_dictionary(product_line, category, value) WHERE product_line <> 'article_theme'`,
    desc: "有产品字段承载的三条线上 value 唯一（article_theme 的合法同译不在此列）",
  },
];

(async () => {
  console.log('=== 前置检查：是否存在会违反唯一索引的重复 ===');

  const dupLabel = await prisma.$queryRawUnsafe(
    `SELECT product_line, category, label, COUNT(*) AS n, GROUP_CONCAT(id) AS ids
     FROM tag_dictionary GROUP BY product_line, category, label HAVING COUNT(*) > 1`
  );
  console.log(`① (product_line, category, label) 重复：${dupLabel.length} 组`);
  dupLabel.forEach((d) => console.log('   ⚠️', d.product_line, d.category, JSON.stringify(d.label), 'ids=' + d.ids));

  const dupValue = await prisma.$queryRawUnsafe(
    `SELECT product_line, category, value, COUNT(*) AS n, GROUP_CONCAT(id) AS ids
     FROM tag_dictionary WHERE product_line <> 'article_theme'
     GROUP BY product_line, category, value HAVING COUNT(*) > 1`
  );
  console.log(`② (product_line, category, value) 重复（排除 article_theme）：${dupValue.length} 组`);
  dupValue.forEach((d) => console.log('   ⚠️', d.product_line, d.category, JSON.stringify(d.value), 'ids=' + d.ids));

  const infoOnly = await prisma.$queryRawUnsafe(
    `SELECT product_line, category, value, COUNT(*) AS n, GROUP_CONCAT(label) AS labels, GROUP_CONCAT(id) AS ids
     FROM tag_dictionary WHERE product_line = 'article_theme'
     GROUP BY product_line, category, value HAVING COUNT(*) > 1`
  );
  console.log(`\n（仅供参考，不算冲突）article_theme 同 value 多 label：${infoOnly.length} 组`);
  infoOnly.forEach((d) =>
    console.log('   ℹ️ value=' + JSON.stringify(d.value), '←', d.labels, 'ids=' + d.ids)
  );

  if (dupLabel.length || dupValue.length) {
    console.log('\n❌ 存在真实重复，请先清理再建索引。未做任何改动。');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('\n✓ 无真实重复，可以建索引');

  console.log('\n=== 现有索引 ===');
  const before = await prisma.$queryRawUnsafe(
    `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='tag_dictionary'`
  );
  console.log(before.length ? before.map((i) => '  ' + i.name).join('\n') : '  （无）');

  if (!APPLY) {
    console.log('\n=== 预演：将要建立的索引 ===');
    INDEXES.forEach((i) => console.log(`  ${i.name}\n     ${i.desc}\n     ${i.sql}`));
    console.log('\n（预演结束，未执行。确认无误后加 --apply）');
    await prisma.$disconnect();
    return;
  }

  console.log('\n=== 执行 ===');
  for (const idx of INDEXES) {
    await prisma.$executeRawUnsafe(idx.sql);
    console.log('  ✓ ' + idx.name);
  }

  console.log('\n=== 建立后的索引 ===');
  const after = await prisma.$queryRawUnsafe(
    `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='tag_dictionary'`
  );
  after.forEach((i) => console.log('  ' + i.name + '\n     ' + (i.sql || '(自动)')));
  console.log('\n✅ 完成');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
