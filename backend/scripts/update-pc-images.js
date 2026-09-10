/**
 * 全量替换 PC 产品「产品图片(小图) + 详情大图」为英文原站最新设计图
 *  - 小图:  列表页 .c-card__image img  → /styles/product_list/public/<...> (268x201)
 *  - 大图:  详情页 .s-product-header__img background-image → /styles/page_product_banner/public/<...>
 *  URL 一律保留原样下载（含 ?h=/?itok= token），存相对路径
 * 用法:
 *   node scripts/update-pc-images.js            # dry-run
 *   node scripts/update-pc-images.js --apply    # 下载+写库
 *   node scripts/update-pc-images.js --only=silkaress
 */
const path = require('path');
const https = require('https');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const EN = 'https://www.gattefosse.com';
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'images');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function get(url, binary) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: binary ? '*/*' : 'text/html' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        return resolve(get(new URL(res.headers.location, url).toString(), binary));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      if (binary) {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      } else {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve(b));
      }
    });
    req.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extFromUrl(u) {
  const clean = u.split('?')[0];
  const m = clean.match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? '.' + m[1] : '.jpg';
}

/** 1) 列表页翻页，提取 slug → 列表小图 URL */
async function fetchListImages() {
  const map = new Map();
  for (let page = 0; page < 6; page++) {
    const html = await get(EN + '/personal-care/product-finder?page=' + page);
    if (!html) break;
    // 每张卡片: <h3...><a href="/personal-care/product-finder/<slug>">Name</a></h3> ... <div class="c-card__image"> <a href=...><img src="..."
    const re = /product-finder\/([a-z0-9-]+)"[^>]*>[^<]*<\/a>[^*]*?class="c-card__image">\s*<a[^>]*>\s*<img src="([^"]+)"/gis;
    let n = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (!map.has(m[1])) map.set(m[1], m[2]);
      n++;
    }
    console.log('列表页 page=' + page + ': 本页卡片 ' + n + ' 张');
    if (n === 0) break;
    await sleep(300);
  }
  return map;
}

/** 2) 详情页提取 banner 大图 URL */
function fetchCoverUrl(html) {
  const m = html.match(/class="s-product-header__img"\s*style="background-image:\s*url\(([^)]+)\)"/);
  return m ? m[1] : null;
}

async function download(url, file) {
  const buf = await get(url, true);
  if (!buf || buf.length < 500) return false;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  return true;
}

(async () => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log('模式: ' + (APPLY ? 'APPLY' : 'DRY-RUN'));

  const locals = await prisma.$queryRawUnsafe("SELECT id, name, intl_url FROM pc_ingredients ORDER BY id");
  console.log('本地 PC 产品 ' + locals.length + ' 个');

  // 英文站 slug 集合（用于校验 intl_url）
  const listImgs = await fetchListImages();
  console.log('英文站列表图 ' + listImgs.size + ' 张\n');

  let ok = 0, noUrl = [], noList = [], noCover = [], fail = [];
  const plan = [];
  for (const l of locals) {
    const label = '[' + l.id + '] ' + l.name;
    if (!l.intl_url) { noUrl.push(l.name); continue; }
    const slug = l.intl_url.replace(/\/+$/, '').split('/').pop();
    if (onlyArg && !slug.includes(onlyArg)) continue;
    const listImg = listImgs.get(slug);
    if (!listImg) { noList.push(label + '(' + slug + ')'); continue; }

    // 详情页 cover
    const html = await get(EN + '/personal-care/product-finder/' + slug);
    await sleep(250);
    let cover = null;
    if (html) cover = fetchCoverUrl(html);
    if (!cover) { noCover.push(label + '(' + slug + ')'); }

    plan.push({ id: l.id, name: l.name, slug, listImg: EN + listImg, cover: cover ? EN + cover : null });
  }

  console.log('=== 计划 ===');
  console.log('可替换: ' + plan.length + ' | 无intl_url: ' + noUrl.length + ' | 列表无图: ' + noList.length + ' | 详情无cover: ' + noCover.length);
  if (noList.length) console.log('  列表无图: ' + noList.join(', '));
  if (noCover.length) console.log('  详情无cover: ' + noCover.join(', '));
  plan.slice(0, 5).forEach((p) => console.log('  [' + p.id + '] ' + p.name + '\n    小图: ' + p.listImg.slice(0, 110) + '\n    大图: ' + (p.cover || '(无)').slice(0, 110)));

  if (!APPLY) { console.log('\n(dry-run 结束)'); await prisma.$disconnect(); return; }

  for (const p of plan) {
    const cardFile = 'pc' + p.id + '-' + p.slug + '-card' + extFromUrl(p.listImg);
    const cardOk = await download(p.listImg, cardFile);
    let coverRel = null;
    if (p.cover) {
      const coverFile = 'pc' + p.id + '-' + p.slug + '-cover' + extFromUrl(p.cover);
      const coverOk = await download(p.cover, coverFile);
      if (coverOk) coverRel = '/uploads/images/' + coverFile; else fail.push(p.name + '(cover)');
    }
    if (!cardOk) { fail.push(p.name + '(card)'); continue; }
    await prisma.$executeRawUnsafe(
      "UPDATE pc_ingredients SET image_url = ?, detail_image_url = COALESCE(?, detail_image_url), updated_at = datetime('now') WHERE id = ?",
      '/uploads/images/' + cardFile, coverRel, p.id
    );
    ok++;
    console.log('  ✓ [' + p.id + '] ' + p.name + ' → ' + cardFile + (coverRel ? ' + cover' : ''));
    await sleep(150);
  }
  console.log('\n完成: 成功 ' + ok + ' | 下载失败: ' + fail.length + (fail.length ? ' → ' + fail.join(', ') : ''));
  await prisma.$disconnect();
})().catch(async (e) => { console.error('脚本异常:', e); await prisma.$disconnect(); process.exit(1); });
