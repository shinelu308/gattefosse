/**
 * 把「植物」图标下其实是护发 / 防晒的条目，纠正为专属图标。
 * 早期后台只有 plante 一种图标，护发、防晒都被存成了 plante，
 * 前台于是显示同一片叶子。现在有 cheveux.svg / soleil.svg。
 *
 * 用法：
 *   node scripts/normalize-picto-icons.js            # dry-run
 *   node scripts/normalize-picto-icons.js --apply    # 写库
 */
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

// 标签 → 专属图标（只在 iconType 仍是 plante 时才纠正，不覆盖用户已选的其他图标）
const LABEL_TO_ICON = {
  '护发': 'cheveux',
  '头发养护': 'cheveux',
  '洗发护发': 'cheveux',
  '防晒': 'soleil',
  '紫外线防护': 'soleil',
  'UV防护': 'soleil',
};

(async () => {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT id, name, pictos FROM formulations WHERE pictos IS NOT NULL AND pictos <> '[]' AND pictos <> ''"
  );
  console.log('[normalize-picto] 有 pictos 的配方 = ' + rows.length + (APPLY ? '（写库模式）' : '（dry-run，加 --apply 才写库）'));

  let changed = 0;
  for (const row of rows) {
    let arr;
    try { arr = JSON.parse(row.pictos || '[]'); } catch (e) { continue; }
    if (!Array.isArray(arr)) continue;

    let dirty = false;
    const next = arr.map((pi) => {
      if (!pi || pi.iconType !== 'plante') return pi;
      const label = String(pi.label || '').trim();
      const target = LABEL_TO_ICON[label];
      if (!target) return pi;
      dirty = true;
      return { iconType: target, label: pi.label };
    });
    if (!dirty) continue;

    changed++;
    const before = arr.map((x) => (x.iconType || '?') + ':' + (x.label || '')).join(' / ');
    const after = next.map((x) => (x.iconType || '?') + ':' + (x.label || '')).join(' / ');
    console.log('  #' + row.id + ' ' + row.name);
    console.log('     - ' + before);
    console.log('     + ' + after);

    if (APPLY) {
      await prisma.$executeRawUnsafe(
        'UPDATE formulations SET pictos = ? WHERE id = ?',
        JSON.stringify(next),
        row.id
      );
    }
  }

  console.log('[normalize-picto] 需要纠正的配方 = ' + changed + (APPLY ? '（已写入）' : ''));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('[normalize-picto] 失败：', e);
  await prisma.$disconnect();
  process.exit(1);
});
