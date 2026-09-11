/**
 * 通用修复：所有文章正文里 youtube_player 空壳 div → 标准 YouTube embed iframe。
 * 背景：原站 videoID 可能带跟踪参数（tGfp1ciqNZw?si=xxx），旧版导入器转换校验失败后
 * 原样保留空壳 div，前台/预览均无法渲染视频（2026-09-11 silk-inspired 用户反馈）。
 * 幂等：只转换 div 形态；已是 iframe 的不动。用法：node scripts/fix-video-shell.js [--apply]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APPLY = process.argv.includes('--apply');

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

(async () => {
  // 物理列名 raw SQL（Prisma raw 用物理列名）
  const rows = await p.$queryRawUnsafe(`SELECT id, title, content_html AS html FROM news_events WHERE content_html LIKE '%youtube_player%'`);
  console.log('含 youtube_player 的文章数：', rows.length);
  let fixed = 0;
  for (const r of rows) {
    const next = convertVideoBlocks(r.html || '');
    if (next === r.html) continue;
    const vidM = /\/embed\/([A-Za-z0-9_-]+)/.exec(next) || [];
    const shellsBefore = (r.html.match(/<div[^>]*youtube_player[^>]*><\/div>/gi) || []).length;
    console.log(`[fix] id=${r.id}《${(r.title || '').slice(0, 30)}》空壳 ${shellsBefore} 个 → embed ${vidM[1] || '?'}`);
    if (APPLY) {
      await p.$executeRawUnsafe(`UPDATE news_events SET content_html = ? WHERE id = ?`, next, r.id);
    }
    fixed++;
  }
  console.log(APPLY ? `✅ 已修复 ${fixed} 篇` : `(dry-run) 待修复 ${fixed} 篇，加 --apply 生效`);
  await p.$disconnect();
})();
