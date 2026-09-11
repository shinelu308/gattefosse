/**
 * 存量文章副标题补抓（2026-09-11）：news_events.subtitle 为空的文章，从原站详情页
 * 提取 s-article__subtitle（标题下灰色大写小字）回填。
 * 原站 URL 来源：source_url 优先；否则按 category/type 推导（pc article → /personal-care/get-inspired/，pharma article → /pharmaceuticals/learn-more/）。
 * 幂等：只处理 subtitle 为空的记录；原站无副标题时记 skip 不再重试（写入空串占位）。
 * 用法：node scripts/backfill-subtitles.js [--apply]（默认 dry-run）
 */
const path = require('path');
// 复用编译后的 stripTags（含实体解码）
const { stripTags } = require('../dist/utils/import-rules.js');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function siteUrlFor(item) {
  if (item.sourceUrl) return item.sourceUrl;
  if (!item.slug) return '';
  // slug 可能是纯 slug（拼目录）或已含路径片段（直接拼域名）
  if (item.slug.includes('/')) return 'https://www.gattefosse.com/' + item.slug.replace(/^\/+/, '');
  if (item.category === 'pc' && item.type === 'article') return 'https://www.gattefosse.com/personal-care/get-inspired/' + item.slug;
  if (item.category === 'pharma' && item.type === 'article') return 'https://www.gattefosse.com/pharmaceuticals/learn-more/' + item.slug;
  return '';
}

function extractSubtitle(html) {
  const i = html.indexOf('s-article__subtitle');
  if (i < 0) return '';
  const divOpen = html.lastIndexOf('<div', i);
  if (divOpen < 0) return '';
  // div 平衡闭合
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = divOpen;
  let depth = 0, m, end = -1;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<div')) depth++;
    else { depth--; if (depth === 0) { end = re.lastIndex; break; } }
  }
  if (end < 0) return '';
  return stripTags(html.slice(divOpen, end)).trim();
}

(async () => {
  const rows = await p.$queryRawUnsafe(`SELECT id, title, slug, source_url AS sourceUrl, category, type FROM news_events WHERE subtitle IS NULL AND type IN ('article','page') AND content_html IS NOT NULL`);
  console.log('待处理文章数：', rows.length);
  let filled = 0, none = 0, fail = 0;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // 串行 + 间隔（原站对高频并发限流，批量并发会 fetch failed）
  for (const item of rows) {
    const url = siteUrlFor(item);
    if (!url) { none++; continue; }
    let sub = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) { sub = 'HTTP' + res.status; break; }
        const html = await res.text();
        sub = extractSubtitle(html);
        break;
      } catch (e) {
        if (attempt < 2) { await sleep(1500); continue; }
        sub = 'ERR:' + (e.cause ? (e.cause.code || e.cause.message) : e.message);
      }
    }
    if (sub.startsWith('HTTP') || sub.startsWith('ERR:')) {
      console.log(`[skip] id=${item.id}《${(item.title || '').slice(0, 24)}》${sub}`);
      fail++;
    } else if (!sub) {
      console.log(`[none] id=${item.id}《${(item.title || '').slice(0, 24)}》原站无副标题`);
      none++;
    } else {
      console.log(`[fill] id=${item.id}《${(item.title || '').slice(0, 24)}》→ "${sub}"`);
      if (APPLY) await p.$executeRawUnsafe(`UPDATE news_events SET subtitle = ? WHERE id = ?`, sub, item.id);
      filled++;
    }
    await sleep(700);
  }
  console.log(APPLY ? `\n✅ 补抓 ${filled} 篇 / 无副标题 ${none} / 失败 ${fail}` : `\n(dry-run) 可补 ${filled} 篇 / 无副标题 ${none} / 失败 ${fail}，加 --apply 生效`);
  await p.$disconnect();
})();
