/**
 * 为配方批量创建「相关产品」区块（related）
 *
 * 数据来源：scripts/data/related-plan.json
 *   由配方 PDF（原站 intuitive/*.pdf）的成分表解析得到：
 *   把「Supplier = Gattefossé」的原料名与 pc_ingredients 对名匹配。
 *   图片型 PDF（无文本层）的少数量按同类配方常见成分兜底，plan 中 source='fallback'。
 *
 * 校准：与原站商城 relatedProducts 的 11 条官方配置比对，9 条完全一致、1 条多列 1 项（PDF 确有使用）、
 *       1 条原站无 PDF 文本。
 *
 * 用法：
 *   node scripts/seed-related-products.js            # dry-run
 *   node scripts/seed-related-products.js --apply    # 写库
 *   node scripts/seed-related-products.js --apply --force   # 已有区块也覆盖 products
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const PLAN_PATH = process.env.PLAN || path.join(__dirname, 'data', 'related-plan.json');

(async () => {
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
  console.log('模式: ' + (APPLY ? 'APPLY' : 'DRY-RUN') + (FORCE ? ' + FORCE' : ''));
  console.log('计划: ' + plan.length + ' 个配方');

  // 校验产品 id 都存在
  const pcs = await prisma.$queryRawUnsafe('SELECT id, name FROM pc_ingredients');
  const pcIds = new Set(pcs.map((r) => Number(r.id)));
  let badProduct = 0;
  plan.forEach((p) => p.products.forEach((x) => { if (!pcIds.has(Number(x.id))) { badProduct++; console.log('  ⚠ 产品不存在: ' + x.id + ' ' + x.name); } }));

  // 已存在的 related 区块
  const existRows = await prisma.$queryRawUnsafe(
    "SELECT id, product_id, content FROM content_blocks WHERE product_type = 'formula' AND block_type = 'related'"
  );
  const existMap = new Map(existRows.map((r) => [Number(r.product_id), r]));

  const toCreate = [];
  const toUpdate = [];
  const skipped = [];
  for (const p of plan) {
    if (!p.formulationId) { skipped.push(p.name + '(无本地配方)'); continue; }
    if (!p.products.length) { skipped.push(p.name + '(无产品)'); continue; }
    const ex = existMap.get(p.formulationId);
    if (ex && !FORCE) { skipped.push(p.name + '(已有区块 id=' + ex.id + ')'); continue; }
    if (ex) toUpdate.push({ plan: p, blockId: Number(ex.id) });
    else toCreate.push(p);
  }

  console.log('待新建: ' + toCreate.length + ' | 待覆盖: ' + toUpdate.length + ' | 跳过: ' + skipped.length);
  if (skipped.length && skipped.length <= 12) console.log('  跳过: ' + skipped.join(' | '));
  if (badProduct) { console.log('\n❌ 有 ' + badProduct + ' 个产品 id 无效，中止'); await prisma.$disconnect(); process.exit(1); }

  if (!APPLY) {
    toCreate.slice(0, 6).forEach((p) => console.log('  + [配方 ' + p.formulationId + '] ' + p.name + ' → ' + p.products.map((x) => x.name).join(', ')));
    console.log('\n（dry-run，未写库；加 --apply 执行）');
    await prisma.$disconnect();
    return;
  }

  let created = 0, updated = 0;
  for (const p of toCreate) {
    const maxRow = await prisma.$queryRawUnsafe(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM content_blocks WHERE product_type = ? AND product_id = ?',
      'formula',
      p.formulationId
    );
    const nextOrder = Number(maxRow[0].m) + 1;
    const content = JSON.stringify({ products: p.products });
    await prisma.$executeRawUnsafe(
      "INSERT INTO content_blocks (product_id, product_type, block_type, title, content, sort_order, is_published, created_at, updated_at) VALUES (?, 'formula', 'related', '相关产品', ?, ?, 1, datetime('now'), datetime('now'))",
      p.formulationId,
      content,
      nextOrder
    );
    created++;
  }

  for (const u of toUpdate) {
    await prisma.$executeRawUnsafe(
      "UPDATE content_blocks SET content = ?, updated_at = datetime('now') WHERE id = ?",
      JSON.stringify({ products: u.plan.products }),
      u.blockId
    );
    updated++;
  }

  console.log('\n✅ 新建 ' + created + ' 个区块，覆盖 ' + updated + ' 个');
  const cnt = await prisma.$queryRawUnsafe(
    "SELECT COUNT(1) AS c FROM content_blocks WHERE product_type = 'formula' AND block_type = 'related'"
  );
  console.log('库中配方 related 区块总数: ' + Number(cnt[0].c));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('💥 ' + e.message);
  await prisma.$disconnect();
  process.exit(1);
});
