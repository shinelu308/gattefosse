/**
 * 药用辅料「配方技术」详情页种子
 * ------------------------------------------------------------
 * 数据源：backend/scripts/data/pharma-tech-pages.json（由原中文站抓取生成）
 *   pages[]: { id, pageKey: 'ft-<id>', title, summary, slug, contentHtml, sortOrder }
 * 写入 page_contents（pageKey 唯一），前台 formulation-technologies-detail.html?id=<id>
 * 请求 /api/content/pages/ft-<id> 渲染。
 *
 * 用法：
 *   node scripts/seed-pharma-tech-pages.js            # dry-run
 *   node scripts/seed-pharma-tech-pages.js --apply    # 写库
 *   FORCE=1 node scripts/seed-pharma-tech-pages.js --apply   # 覆盖已存在且内容不同的页面
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';
const DATA = require('./data/pharma-tech-pages.json');

(async () => {
  const stat = { total: 0, created: 0, updated: 0, skipped: 0, same: 0 };
  const warns = [];

  for (const p of DATA.pages) {
    stat.total++;
    const pageKey = p.pageKey || ('ft-' + p.id);
    const payload = {
      title: p.title,
      contentHtml: p.contentHtml,
      slug: p.slug || null,
      sortOrder: p.sortOrder || 0,
      metaTitle: (p.title || '') + ' | 嘉法狮',
      metaDescription: (p.summary || '').slice(0, 200) || null,
    };

    const exist = await prisma.pageContent.findUnique({ where: { pageKey } });
    if (!exist) {
      stat.created++;
      console.log('[新建]', pageKey, '|', p.title, '| html', p.contentHtml.length);
      if (APPLY) await prisma.pageContent.create({ data: { pageKey, ...payload } });
      continue;
    }

    const diff = Object.keys(payload).filter(
      (k) => (exist[k] || '') !== (payload[k] || '')
    );
    if (!diff.length) { stat.same++; continue; }

    if (!FORCE) {
      stat.skipped++;
      warns.push(pageKey + ' 字段差异: ' + diff.join(',') + '（加 FORCE=1 覆盖）');
      console.log('[跳过]', pageKey, '差异:', diff.join(','));
      continue;
    }
    stat.updated++;
    console.log('[更新]', pageKey, '| 差异:', diff.join(','));
    if (APPLY) await prisma.pageContent.update({ where: { pageKey }, data: payload });
  }

  console.log('\n=== 汇总 ===');
  console.log(APPLY ? '已写库' : 'DRY-RUN（未写库，加 --apply 生效）');
  console.log(JSON.stringify(stat, null, 0));
  if (warns.length) { console.log('\n待确认:'); warns.forEach(w => console.log('  -', w)); }

  // 顺带核对 slug 唯一性（前台靠 slug 反查 id）
  const all = await prisma.pageContent.findMany({
    where: { pageKey: { startsWith: 'ft-' } },
    select: { pageKey: true, slug: true, title: true },
  });
  const seen = new Map();
  all.forEach(r => {
    if (!r.slug) return;
    if (seen.has(r.slug)) console.warn('⚠ slug 重复:', r.slug, seen.get(r.slug), '与', r.pageKey);
    else seen.set(r.slug, r.pageKey);
  });
  console.log('ft-* 页面总数:', all.length, '| 有 slug:', seen.size);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAIL', e);
  await prisma.$disconnect();
  process.exit(1);
});
