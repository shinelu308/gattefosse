/**
 * 回归抽查：新签名规则下，存量已导入文章「正文结构与原站一致」是否仍通过
 * 只读比对，不写库
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const rules = require(path.resolve(__dirname, '../dist/utils/import-rules'));
const { verifyImportedArticle } = require(path.resolve(__dirname, '../dist/utils/import-verify'));
const p = new PrismaClient();

const IDS = [129, 131, 133, 136, 150, 9013]; // 存量抽样 + 本次新导入的 haute-couture（须严格比对）

(async () => {
  for (const id of IDS) {
    const item = await p.newsEvent.findUnique({ where: { id } });
    if (!item || !item.slug) { console.log(`[${id}] 不存在或无 slug，跳过`); continue; }
    const originUrl = rules.ORIGIN_BASE + '/' + item.slug.replace(/^\/+/, '');
    let html = '';
    try { html = await rules.fetchText(originUrl); } catch (e) { console.log(`[${id}] 原站抓取失败：${e.message}`); continue; }
    const items = await verifyImportedArticle(html, {
      id: item.id, title: item.title || '', summary: item.summary,
      contentHtml: item.contentHtml || '', imageUrl: item.imageUrl, authorId: item.authorId,
    });
    const v7 = items.find(v => v.name === '正文结构与原站一致');
    console.log(`[${id}] ${item.slug.split('/').pop().slice(0, 45)} → ${v7 ? (v7.ok ? '✅ 通过' : '❌ ' + (v7.detail || '').slice(0, 150)) : '无该项'}`);
  }
  await p.$disconnect();
})();
