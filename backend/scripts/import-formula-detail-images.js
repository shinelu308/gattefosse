/**
 * 抓取 99 个配方的「详情页大图」到本地并写库
 *
 * 数据来源：原中文站 www.gattefossechina.cn 商品接口
 *   GET /api/mallGoodsInfo/getMallGoodsInfoList?pageSize=250&pageNum=1  (goodsCategoryId=120 = 配方)
 * 字段映射：
 *   goodsCoverImg  → 列表小图 image_url（早前已导入）
 *   goodsCarousel  → 详情页顶部横幅大图 detail_image_url  ← 本脚本负责
 *
 * 做法与 PC 成分一致：图片下载到 backend/uploads/images，库里存相对路径。
 *
 * 用法：
 *   node scripts/import-formula-detail-images.js            # dry-run，只打印计划
 *   node scripts/import-formula-detail-images.js --apply    # 下载图片 + 写库
 *   node scripts/import-formula-detail-images.js --force    # 连已有 detail_image_url 的也重下
 */
const path = require('path');
const https = require('https');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const CN = 'https://www.gattefossechina.cn';
const API = CN + '/api/mallGoodsInfo/getMallGoodsInfoList?pageSize=250&pageNum=1';
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'images');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function get(url, binary) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: binary ? '*/*' : 'application/json' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        return resolve(get(new URL(res.headers.location, url).toString(), binary));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout ' + url)));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extFromUrl(u) {
  const clean = u.split('?')[0];
  const m = clean.match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? '.' + m[1].toLowerCase() : '.webp';
}

/** 配方编号 → 文件名片段：2712-1.38 → 2712-1-38 */
function codeSlug(code) {
  return String(code || '')
    .trim()
    .replace(/[^0-9a-zA-Z]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

(async () => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log('模式: ' + (APPLY ? 'APPLY' : 'DRY-RUN') + (FORCE ? ' + FORCE' : ''));

  // 1) 拉原站商品列表
  const body = await get(API, false);
  if (!body) throw new Error('原站接口无响应');
  const json = JSON.parse(body);
  const all = (json.data && json.data.list) || [];
  const remote = all.filter((x) => String(x.goodsCategoryId) === '120' && x.goodsName);
  console.log('原站配方: ' + remote.length + ' 条');

  // 2) 本地配方
  const locals = await prisma.$queryRawUnsafe('SELECT id, name, code, detail_image_url FROM formulations ORDER BY id');
  console.log('本地配方: ' + locals.length + ' 条\n');

  const byCode = new Map();
  const byName = new Map();
  for (const l of locals) {
    if (l.code) byCode.set(String(l.code).trim(), l);
    byName.set(String(l.name || '').trim().toLowerCase(), l);
  }

  const plan = [];
  const unmatchedRemote = [];
  const usedIds = new Set();

  for (const r of remote) {
    const code = String(r.subtitle || '').trim();
    let local = byCode.get(code);
    if (!local) local = byName.get(String(r.goodsName).trim().toLowerCase());
    if (!local) { unmatchedRemote.push(r.goodsName + ' (' + code + ')'); continue; }
    if (usedIds.has(local.id)) { unmatchedRemote.push('[重复匹配] ' + r.goodsName); continue; }
    usedIds.add(local.id);

    const carousel = String(r.goodsCarousel || '').trim();
    if (!carousel) { plan.push({ local, skip: '原站无 goodsCarousel' }); continue; }
    const srcUrl = /^https?:\/\//.test(carousel) ? carousel : CN + '/' + carousel.replace(/^\/+/, '');
    const ext = extFromUrl(srcUrl);
    const file = 'formula' + local.id + '-' + (codeSlug(code) || 'x') + '-cover' + ext;
    plan.push({ local, srcUrl, file, rel: '/uploads/images/' + file });
  }

  const missingLocal = locals.filter((l) => !usedIds.has(l.id));
  console.log('匹配成功: ' + plan.length + ' / 本地 ' + locals.length);
  if (unmatchedRemote.length) console.log('原站未匹配: ' + unmatchedRemote.length + ' → ' + unmatchedRemote.join(' | '));
  if (missingLocal.length) console.log('本地未覆盖: ' + missingLocal.length + ' → ' + missingLocal.map((m) => m.id + ':' + m.name).join(' | '));

  const todo = plan.filter((p) => !p.skip && (FORCE || !p.local.detail_image_url));
  console.log('待下载: ' + todo.length + ' 张（已有 detail_image_url 的跳过 ' + (plan.length - todo.length) + ' 张）\n');

  if (plan.some((p) => p.skip)) {
    plan.filter((p) => p.skip).forEach((p) => console.log('  ⚠ ' + p.local.id + ' ' + p.local.name + ' — ' + p.skip));
  }

  if (!APPLY) {
    plan.filter((p) => p.srcUrl).slice(0, 8).forEach((p) => console.log('  ' + p.local.id + ' ' + p.local.name + '\n      ' + p.srcUrl + '\n   →  ' + p.rel));
    console.log('\n（dry-run，未下载也未写库；加 --apply 执行）');
    await prisma.$disconnect();
    return;
  }

  // 3) 下载 + 写库
  let ok = 0;
  const fails = [];
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    try {
      const buf = await get(p.srcUrl, true);
      if (!buf || buf.length < 5000) { fails.push(p.local.name + ' (下载失败/' + (buf ? buf.length + 'B' : '0') + ')'); continue; }
      fs.writeFileSync(path.join(UPLOAD_DIR, p.file), buf);
      await prisma.$executeRawUnsafe(
        "UPDATE formulations SET detail_image_url = ?, updated_at = datetime('now') WHERE id = ?",
        p.rel,
        p.local.id
      );
      ok++;
      console.log('  ✅ ' + p.local.id + ' ' + p.local.name + ' → ' + p.rel + ' (' + Math.round(buf.length / 1024) + 'KB)');
    } catch (e) {
      fails.push(p.local.name + ' (' + e.message + ')');
    }
    await sleep(120);
  }

  console.log('\n📊 完成: 成功 ' + ok + ' / 待下载 ' + todo.length);
  if (fails.length) console.log('❌ 失败 ' + fails.length + ':\n  ' + fails.join('\n  '));

  const cnt = await prisma.$queryRawUnsafe("SELECT COUNT(*) c FROM formulations WHERE detail_image_url IS NOT NULL AND detail_image_url <> ''");
  console.log('库中已有详情大图: ' + Number(cnt[0].c));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('💥 ' + e.message);
  await prisma.$disconnect();
  process.exit(1);
});
