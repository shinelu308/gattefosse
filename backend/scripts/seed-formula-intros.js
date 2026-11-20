/**
 * 把原中文站（www.gattefossechina.cn）的完整「简述」正文写成配方详情页区块
 *
 * 背景：formulations.description 存的是原站列表接口的 goodsIntro（摘要，56/99 被截断）；
 *       原站详情页的完整简述在 contentId → findWebContents 正文里。
 *
 * 数据源: backend/scripts/data/formula-intros.json  [{ code, name, id, zhId, html, text, textLen }]
 * 目标  : content_blocks title='简述' blockType='richtext' content={"html":"<p>..</p>"}
 *         前台 getBlockContent('简述') 优先于 description
 *
 * 用法: node scripts/seed-formula-intros.js            # dry-run
 *       node scripts/seed-formula-intros.js --apply    # 写库
 *       FORCE=1 ... --apply                          # 覆盖已存在的「简述」区块
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';
const DATA = path.join(__dirname, 'data', 'formula-intros.json');
const TITLE = '简述';

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", reg: '®', trade: '™', copy: '©', deg: '°', plusmn: '±', hellip: '…', ndash: '–', mdash: '—', middot: '·', bull: '•', times: '×' };
const decode = (s) => String(s).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&([A-Za-z]+);/g, (m, n) => (NAMED[n] !== undefined ? NAMED[n] : m));
const plain = (s) => decode(String(s).replace(/<[^>]+>/g, '')).replace(/[\u200b\u200c\u200d\ufeff\u00ad]/g, '').replace(/\s+/g, '');

(async () => {
  const items = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  console.log(`数据 ${items.length} 条，${APPLY ? '写库模式' : 'dry-run'}${FORCE ? ' + FORCE' : ''}`);

  let created = 0, updated = 0, skipped = 0, notFound = 0;
  const msgs = [];

  for (const it of items) {
    if (!it.html || !String(it.html).trim()) { skipped++; continue; }

    const f = await prisma.formulation.findFirst({ where: { code: it.code }, select: { id: true, name: true } });
    if (!f) { msgs.push(`  跳过 ${it.code} ${it.name}: 库里没有该编号`); notFound++; continue; }

    const blocks = await prisma.contentBlock.findMany({
      where: { productId: f.id, productType: 'formula' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, blockType: true, title: true, sortOrder: true, content: true },
    });

    const exist = blocks.find((b) => String(b.title || '').trim() === TITLE && b.blockType === 'richtext');
    const html = String(it.html).trim();
    const content = JSON.stringify({ html });

    if (exist) {
      let oldHtml = '';
      try { oldHtml = (JSON.parse(exist.content || '{}').html || '').trim(); } catch (e) { oldHtml = ''; }
      // 文本等价即视为一致（允许人工排版差异：颜色/字体/换行）
      if (plain(oldHtml) === plain(html)) { skipped++; continue; }
      if (!FORCE) { skipped++; continue; }
      if (APPLY) {
        await prisma.contentBlock.update({ where: { id: exist.id }, data: { content, title: TITLE, isPublished: true } });
      }
      updated++;
      continue;
    }

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
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
