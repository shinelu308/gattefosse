/**
 * 按原中文站（gattefossechina.cn）的 picto 字段，把 99 个配方详情页的「特点图标」一次性对齐。
 *
 * 数据来源：backend/scripts/data/formula-pictos.json
 *   - 由原站 /api/mallGoodsInfo/findMallGoodsInfo?ID=xxx 的 picto HTML 解析而来
 *   - 用 subtitle（=配方编号 code）与本地 formulations.code 对齐
 *   - inferred:true 表示原站该配方没有 picto，按品类推断补全（7 个新配方）
 *
 * 用法：
 *   node scripts/sync-formula-pictos.js            # dry-run，只打印差异
 *   node scripts/sync-formula-pictos.js --apply    # 写库
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'formula-pictos.json'), 'utf8'));

const fmt = (arr) =>
  arr.length === 0 ? '(空)' : arr.map((x) => x.iconType + (x.label ? '/' + x.label : '')).join(' | ');

(async () => {
  const plan = new Map();
  for (const it of DATA.items) plan.set(String(it.code || '').trim(), it);

  const rows = await prisma.formulation.findMany({ select: { id: true, name: true, code: true, pictos: true } });
  console.log(`[sync-picto] 本地配方 ${rows.length} / 数据文件 ${DATA.items.length}` + (APPLY ? '  ⚠️ 写库模式' : '  (dry-run，加 --apply 才写库)'));

  let same = 0;
  let changed = 0;
  let noData = 0;
  const touched = [];

  for (const row of rows) {
    const code = String(row.code || '').trim();
    const target = plan.get(code);
    if (!target) {
      noData++;
      console.log(`  ! #${row.id} ${code} ${row.name} —— 数据文件里没有该编号，跳过`);
      continue;
    }
    let cur = [];
    try { cur = JSON.parse(row.pictos || '[]'); } catch (e) { cur = []; }
    if (!Array.isArray(cur)) cur = [];

    const before = fmt(cur);
    const after = fmt(target.pictos);
    if (before === after) { same++; plan.delete(code); continue; }

    changed++;
    plan.delete(code);
    touched.push({ id: row.id, code, name: row.name });
    console.log(`  ~ #${row.id} ${code} ${row.name}${target.inferred ? ' [原站无·推断]' : ''}`);
    console.log(`      - ${before}`);
    console.log(`      + ${after}`);

    if (APPLY) {
      await prisma.$executeRawUnsafe(
        'UPDATE formulations SET pictos = ? WHERE id = ?',
        JSON.stringify(target.pictos),
        row.id
      );
    }
  }

  if (plan.size) {
    console.log(`  ! 数据文件里有 ${plan.size} 个编号在本地找不到配方：` + [...plan.keys()].join(', '));
  }

  console.log(`[sync-picto] 一致 ${same} / 变更 ${changed} / 无数据 ${noData}` + (APPLY ? '（已写入）' : ''));
  if (APPLY) console.log('[sync-picto] 写入配方 id：' + touched.map((t) => t.id).join(','));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('[sync-picto] 失败：', e);
  await prisma.$disconnect();
  process.exit(1);
});
