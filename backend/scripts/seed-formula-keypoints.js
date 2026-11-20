/**
 * 把原中文站（www.gattefossechina.cn）的「关键点」（claims）写成配方详情页区块
 *
 * 数据源: backend/scripts/data/formula-keypoints.json  [{ code, name, id, zhId, claims:[] }]
 * 目标  : content_blocks 里 title='关键点' blockType='richtext' content={"html":"<ul><li>..</li></ul>"}
 *         （前台 getBlockContent('关键点') 就是取这个；formulations 表没有 claims 字段）
 *
 * 用法: node scripts/seed-formula-keypoints.js            # dry-run，只打印
 *       node scripts/seed-formula-keypoints.js --apply    # 写库
 *       FORCE=1 ... --apply                              # 覆盖已存在的「关键点」区块
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';
const DATA = path.join(__dirname, 'data', 'formula-keypoints.json');
const TITLE = '关键点';

// 置底区块：相关产品 / 相关资料（新块永远插在这些之前，且整体置于最前）
function pinRank(b) {
  if (b.blockType === 'related') return 2;
  if (b.blockType === 'files' && String(b.title || '').trim() === '相关资料') return 1;
  return 0;
}

function toHtml(claims) {
  return '<ul>' + claims.map((c) => '<li>' + String(c).replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m])) + '</li>').join('') + '</ul>';
}

(async () => {
  const items = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  console.log(`数据 ${items.length} 条，${APPLY ? '写库模式' : 'dry-run'}${FORCE ? ' + FORCE' : ''}`);

  let created = 0, updated = 0, skipped = 0, notFound = 0;
  const msgs = [];

  for (const it of items) {
    const claims = (it.claims || []).map((s) => String(s).trim()).filter(Boolean);
    if (!claims.length) { skipped++; continue; }

    const f = await prisma.formulation.findFirst({ where: { code: it.code }, select: { id: true, name: true } });
    if (!f) { msgs.push(`  跳过 ${it.code} ${it.name}: 库里没有该编号`); notFound++; continue; }

    const blocks = await prisma.contentBlock.findMany({
      where: { productId: f.id, productType: 'formula' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, blockType: true, title: true, sortOrder: true, content: true },
    });

    const exist = blocks.find((b) => String(b.title || '').trim() === TITLE && b.blockType === 'richtext');
    const html = toHtml(claims);
    const content = JSON.stringify({ html });

    if (exist) {
      let oldHtml = '';
      try { oldHtml = (JSON.parse(exist.content || '{}').html || '').trim(); } catch (e) { oldHtml = ''; }
      if (oldHtml === html) { skipped++; continue; }
      if (!FORCE) { skipped++; continue; }
      if (APPLY) {
        await prisma.contentBlock.update({ where: { id: exist.id }, data: { content, title: TITLE, isPublished: true } });
      }
      updated++;
      continue;
    }

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        // 「关键点」在页面顶部渲染，放到区块流最前；其余块统一下移
        await tx.contentBlock.create({
          data: {
            productId: f.id,
            productType: 'formula',
            blockType: 'richtext',
            title: TITLE,
            content,
            sortOrder: 0,
            isPublished: true,
          },
        });
        for (const b of blocks) {
          await tx.contentBlock.update({ where: { id: b.id }, data: { sortOrder: b.sortOrder + 1 } });
        }
      });
    }
    created++;
  }

  console.log(`新建 ${created} / 更新 ${updated} / 跳过 ${skipped} / 无此配方 ${notFound}`);
  if (msgs.length) console.log(msgs.join('\n'));
  if (!APPLY) console.log('（dry-run，未写库；加 --apply 生效）');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e);
  await prisma.$disconnect();
  process.exit(1);
});
