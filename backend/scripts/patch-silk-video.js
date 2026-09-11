/**
 * 补丁：silk-inspired 文章（id=493）补回被旧版导入器丢弃的 video-remote YouTube 视频块。
 * 用法：node scripts/patch-silk-video.js [--apply]
 * 幂等：正文已含 youtube_player embed 时跳过。默认 dry-run。
 * 视频块取自原站 /tmp/silk.html 缓存（或现场抓取），按导入器规则转 iframe（videoID 截断 ?si= 跟踪参数）。
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const ORIGIN_HTML = '/tmp/silk.html';
const SITE_URL = 'https://www.gattefosse.com/personal-care/get-inspired/unlock-secrets-silk-inspired-formulation';
const SLUG = 'unlock-secrets-silk-inspired-formulation'; // 按 slug 匹配（本地与线上 id 可能不同）

// 与导入器一致：youtube_player 空 div → 标准 embed iframe；videoID 截断 ?/& 跟踪参数
function convertVideoBlocks(html) {
  return html.replace(
    /<div([^>]*class="[^"]*youtube_player[^"]*"[^>]*)><\/div>/gi,
    (full, attrs) => {
      const vidM = /\bvideoID="([^"]+)"/i.exec(attrs);
      const vid = vidM ? vidM[1].split(/[?&]/)[0] : '';
      if (!vid || !/^[A-Za-z0-9_-]{6,20}$/.test(vid)) return full;
      return `<iframe class="youtube_player" src="https://www.youtube.com/embed/${vid}" title="Video player" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    },
  );
}

// 从原站 HTML 提取 video-remote 完整区块（paragraph 开标签起，div 平衡闭合）
function extractVideoBlock(siteHtml) {
  const marker = 'paragraph--type--video-remote';
  const i = siteHtml.indexOf(marker);
  if (i < 0) throw new Error('原站 HTML 中未找到 video-remote 区块');
  const start = siteHtml.lastIndexOf('<div', i);
  let depth = 0, end = -1;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(siteHtml))) {
    if (m[0].startsWith('<div')) depth++;
    else { depth--; if (depth === 0) { end = re.lastIndex; break; } }
  }
  if (end < 0) throw new Error('video-remote 区块闭合定位失败');
  return siteHtml.slice(start, end);
}

(async () => {
  // 1. 取原站块
  let siteHtml;
  try {
    siteHtml = fs.readFileSync(ORIGIN_HTML, 'utf8');
    if (!siteHtml.includes('paragraph--type--video-remote')) throw new Error('cache stale');
    console.log('[src] 使用本地缓存原站 HTML');
  } catch (e) {
    console.log('[src] 缓存无效，现场抓取原站…');
    const res = await fetch(SITE_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' } });
    siteHtml = await res.text();
    if (!siteHtml.includes('paragraph--type--video-remote')) throw new Error('原站页面无 video-remote 区块');
  }
  const block = convertVideoBlocks(extractVideoBlock(siteHtml));
  const vidM = /\/embed\/([A-Za-z0-9_-]+)/.exec(block);
  console.log('[block] videoID =', vidM ? vidM[1] : '(转换失败!)', '| 长度', block.length);
  if (!vidM) throw new Error('视频块转换失败（未得到 embed iframe）');

  for (const target of ['local']) {
    try {
      const rec = await p.newsEvent.findFirst({ where: { slug: SLUG }, select: { id: true, contentHtml: true, slug: true } });
      if (!rec) { console.log('[local] slug=' + SLUG + ' 不存在，跳过'); continue; }
      let html = rec.contentHtml || '';
      if (/youtube_player|youtube\.com\/embed/.test(html)) {
        console.log('[local] id=' + rec.id + ' 正文已含视频块，幂等跳过');
        continue;
      }
      const next = html.replace(/\s*$/, '\n') + block + '\n';
      console.log('[local] id=' + rec.id + ' 原长度', html.length, '→ 新长度', next.length);
      if (APPLY) {
        await p.newsEvent.update({ where: { id: rec.id }, data: { contentHtml: next } });
        console.log('[local] ✅ 已写入 id=' + rec.id);
      } else {
        console.log('[local] (dry-run，加 --apply 生效)');
      }
    } catch (e) {
      console.error('[local] 失败：', e.message);
      process.exitCode = 1;
    }
  }
  await p.$disconnect();
})();
