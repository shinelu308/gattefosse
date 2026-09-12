const fs = require('fs');
const path = require('path');
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SITE = 'E:/项目开发区/嘉法狮网站重建/site';
function fileOf(slug, pageKey) {
  const raw = String(slug || pageKey || '').trim();
  const p = raw.replace(/^\/+/, '').replace(/\.html$/i, '');
  if (!p || p === 'home' || p === 'index') return path.join(SITE, 'index.html');
  return path.join(SITE, p + '.html');
}

// 与区块类型对应的「模板引用」判定（含 data.xxx 与 getXxxBlock 两种写法）
function wiredSignals(types, html) {
  const map = {
    hero: [/data\.hero\b/, /hero\.(title|summary|backgroundImage|buttons|videoUrl)/, /getHeroBlock\s*\(/],
    tagline: [/getTaglineBlock\s*\(/, /data\.tagline\b/],
    home_themes: [/getThemesBlock\s*\(/, /data\.themes\b/, /getHomeThemesBlock\s*\(/],
    stats: [/getStatsBlock\s*\(/, /data\.stats\b/],
    feature_cards: [/getFeatureCardsBlock\s*\(/, /data\.featureCards\b/, /featureCards/],
    product_promo: [/getProductPromoBlock\s*\(/, /data\.productPromo\b/, /productPromo/],
    cta_cards: [/getCtaBlock\s*\(/, /data\.ctaCards\b/, /ctaCards/],
  };
  const out = {};
  for (const t of types) {
    const res = map[t] || [new RegExp("get[A-Za-z]*Block\\s*\\([^)]*\\)[\\s\\S]{0,40}" + t)];
    out[t] = res.some((re) => re.test(html));
  }
  return out;
}

(async () => {
  const rows = await prisma.pageContent.findMany({ orderBy: { sortOrder: 'asc' } });
  console.log('①  区块接驳（修正判定：data.xxx 与 getXxxBlock() 都算）\n');
  const all = [];
  for (const r of rows) {
    let types = [];
    try { types = (r.content ? JSON.parse(r.content) : []).map((b) => b.type); } catch (e) {}
    let html = '';
    try { html = fs.readFileSync(fileOf(r.slug, r.pageKey), 'utf8'); } catch (e) {}
    const st = wiredSignals(types, html);
    all.push({ pageKey: r.pageKey, types, st, html });
    if (types.length) {
      console.log('  ' + r.pageKey.padEnd(30) + types.map((t) => t + (st[t] ? '✅' : '❌')).join('  '));
    } else {
      console.log('  ' + r.pageKey.padEnd(30) + '(后台无区块)');
    }
  }

  const withHero = all.filter((s) => s.types.includes('hero'));
  const heroWired = withHero.filter((s) => s.st.hero);
  const heroStatic = withHero.filter((s) => !s.st.hero);
  console.log('\n  hero 区块：共 ' + withHero.length + ' 页，已接 ' + heroWired.length + '（' +
    heroWired.map((s) => s.pageKey).join(', ') + '）');
  console.log('           写死 ' + heroStatic.length + ' 页 → ' + heroStatic.map((s) => s.pageKey).join(', '));

  const anyWired = all.filter((s) => s.types.some((t) => s.st[t]));
  console.log('  至少接了一个区块的页面：' + anyWired.length + '/' + all.length);
  console.log('  完全没接任何区块的页面：' + (all.length - anyWired.length) + ' → ' +
    all.filter((s) => !s.types.some((t) => s.st[t])).map((s) => s.pageKey).join(', '));

  await prisma.$disconnect();

  // ② 原站可达性
  console.log('\n②  原站可达性（决定「自动化抓取」有没有前提）');
  const probe = (u) => new Promise((res) => {
    const t = Date.now();
    const req = https.get(u, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
      let n = 0; r.on('data', (d) => (n += d.length));
      r.on('end', () => res({ url: u, code: r.statusCode, bytes: n, ms: Date.now() - t, loc: r.headers.location || '' }));
    });
    req.on('error', (e) => res({ url: u, code: 'ERR ' + e.code, ms: Date.now() - t }));
    req.on('timeout', () => { req.destroy(); res({ url: u, code: 'TIMEOUT', ms: Date.now() - t }); });
  });
  for (const u of ['https://www.gattefosse.com/', 'https://www.gattefosse.com/about-us', 'https://www.gattefosse.com/sitemap.xml']) {
    const r = await probe(u);
    console.log('  ' + r.url.padEnd(46) + String(r.code).padEnd(10) + (r.bytes ? (r.bytes / 1024).toFixed(0) + ' KB' : '') + '  ' + r.ms + 'ms' + (r.loc ? '  → ' + r.loc : ''));
  }
})().catch(async (e) => { console.error('ERR ' + e.message); await prisma.$disconnect(); });
