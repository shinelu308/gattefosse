/**
 * 回滚 PC 产品批量导入（恢复到 2026-09-10 自动填充之前）：
 *  1) 删除非手动成品（59/60/75）的 content_blocks
 *  2) 按 _db_dump.json 恢复 pc_ingredients 的 imageUrl/detailImageUrl
 * 用法：node scripts/rollback-pc-import.js [--apply]   （默认 dry-run）
 * 线上执行：--apply --remap-localhost（把 dump 中 localhost:3000 前缀转相对路径，对齐线上清洗规则）
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const REMAP = process.argv.includes('--remap-localhost');
const MANUAL_IDS = [59, 60, 75];
const dump = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '_db_dump.json'), 'utf8'));
const pi = dump.pcIngredient || dump.pcIngredients;
const byId = new Map(pi.map((x) => [x.id, x]));

function remap(u) {
  if (!u) return u;
  return REMAP ? u.replace(/^https?:\/\/localhost:3000/, '') : u;
}

(async () => {
  const rows = await prisma.$queryRawUnsafe("SELECT product_id, COUNT(*) as n FROM content_blocks WHERE product_type='pc' GROUP BY product_id");
  console.log('当前有区块的产品:', rows.map((r) => r.product_id).join(','));

  const delTargets = rows.map((r) => Number(r.product_id)).filter((id) => !MANUAL_IDS.includes(id));
  console.log('将删除区块的产品 ' + delTargets.length + ' 个:', delTargets.join(','));

  // 主图恢复计划
  const cur = await prisma.$queryRawUnsafe("SELECT id, name, image_url, detail_image_url FROM pc_ingredients");
  const plan = [];
  for (const c of cur) {
    if (MANUAL_IDS.includes(c.id)) continue;
    const d = byId.get(c.id);
    if (!d) { console.log('  ⚠️ dump 无此产品，跳过: [' + c.id + '] ' + c.name); continue; }
    const newImg = remap(d.imageUrl), newDetail = remap(d.detailImageUrl);
    if (c.image_url !== newImg || c.detail_image_url !== newDetail) {
      plan.push({ id: c.id, name: c.name, oldImg: c.image_url, oldDetail: c.detail_image_url, newImg, newDetail });
    }
  }
  console.log('\n主图需恢复的产品 ' + plan.length + ' 个:');
  plan.slice(0, 6).forEach((p) => console.log('  [' + p.id + '] ' + p.name + '\n    现: ' + String(p.oldImg).slice(0, 70) + '\n    恢: ' + String(p.newImg).slice(0, 70)));
  if (plan.length > 6) console.log('  ... 其余 ' + (plan.length - 6) + ' 个同规则');

  if (!APPLY) { console.log('\n(dry-run 结束，加 --apply 执行；线上加 --remap-localhost)'); await prisma.$disconnect(); return; }

  await prisma.$executeRawUnsafe("DELETE FROM content_blocks WHERE product_type='pc' AND product_id NOT IN (59,60,75)");
  console.log('✓ 已删除 ' + delTargets.length + ' 个产品的区块');
  for (const p of plan) {
    await prisma.$executeRawUnsafe("UPDATE pc_ingredients SET image_url = ?, detail_image_url = ?, updated_at = datetime('now') WHERE id = ?", p.newImg, p.newDetail, p.id);
  }
  console.log('✓ 已恢复 ' + plan.length + ' 个产品的主图');

  const after = await prisma.$queryRawUnsafe("SELECT product_id, COUNT(*) as n FROM content_blocks WHERE product_type='pc' GROUP BY product_id");
  console.log('\n回滚后 pc 区块分布:', JSON.stringify(after.map((r) => ({ id: Number(r.product_id), n: Number(r.n) }))));
  await prisma.$disconnect();
})().catch(async (e) => { console.error('脚本异常:', e); await prisma.$disconnect(); process.exit(1); });
