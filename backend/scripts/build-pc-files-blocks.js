/**
 * 产品「相关资料」区块自动挂接文档库（覆盖全部 57 个 PC 产品，含手动成品 59/60/75）
 * 流程：老站 API（需 token）拿每产品文件清单 → docType 归类 → 按 title+type 匹配 documents.fileId
 *       → UPSERT content_blocks 的 files 区块（只动 block_type='files'，其他区块不碰）
 * files 项: {title, url:'/api/documents/<id>/download', fileId, isPublic, docType}
 * 排序：技术文件(TDS/RDS→SDS) → 产品手册(Brochure) → 配方(Formula)
 * 用法: node scripts/build-pc-files-blocks.js [--apply]
 */
const path = require('path');
const https = require('https');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const OLD = 'https://www.gattefossechina.cn';
const TOKEN = fs.readFileSync(path.join(__dirname, '..', '..', '.localize_tmp', 'oldsite_token.txt'), 'utf8').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function get(url, tries = 4) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'x-token': TOKEN } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) return resolve(get(new URL(res.headers.location, url).toString(), tries));
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve(b));
    });
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.on('error', () => { if (tries > 1) setTimeout(() => resolve(get(url, tries - 1)), 1500); else resolve(null); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normName(s) {
  return String(s || '').toLowerCase().replace(/[®™²]/g, '').replace(/\s+/g, ' ').trim();
}
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e.toLowerCase()] || m;
  });
}
function cleanTitle(t) {
  let s = decodeEntities(String(t));
  const i = s.toLowerCase().indexOf('.pdf');
  if (i > -1) s = s.slice(0, i);
  return s.trim();
}
/** 与文档库最终状态一致：Formula 按 fileSet；SDS/TDS/RDSCosm 前缀优先（修正老站 fileSet 错录）；其余 fileSet 2→Brochure 1→TDS */
function docTypeOf(fileSet, title) {
  if (fileSet === 3) return 'Formula';
  if (/^SDS/i.test(title)) return 'SDS';
  if (/^(TDS|RDSCosm)/i.test(title)) return 'TDS';
  if (fileSet === 2) return 'Brochure';
  return 'TDS';
}
const ORDER = { TDS: 0, SDS: 1, Brochure: 2, Formula: 3 };

(async () => {
  console.log('模式: ' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.localize_tmp', 'oldsite_pc_list.json'), 'utf8'));
  const items = list.data ? list.data.list : list;

  const locals = await prisma.$queryRawUnsafe("SELECT id, name FROM pc_ingredients ORDER BY id");
  const byNorm = new Map(locals.map((l) => [normName(l.name), l]));

  // 文档库索引：title|type → id
  const docs = await prisma.$queryRawUnsafe("SELECT id, title, type, is_public FROM documents");
  const docIndex = new Map(docs.map((d) => [d.title + '|' + d.type, d.id]));
  console.log('文档库 ' + docs.length + ' 条\n');

  let total = 0, miss = [], noProduct = [];
  for (const it of items) {
    const local = byNorm.get(normName(it.goodsName));
    if (!local) { noProduct.push(it.goodsName); continue; }
    const r = await get(OLD + '/api/mallGoodsFiles/getMallGoodsFilesList?goodsId=' + it.ID);
    await sleep(200);
    if (!r) { miss.push(it.goodsName + '(api)'); continue; }
    let files = [];
    try { files = JSON.parse(r).data.list || []; } catch (e) { miss.push(it.goodsName + '(parse)'); continue; }

    const seen = new Set();
    const entries = [];
    for (const f of files) {
      const type = docTypeOf(f.fileSet, f.title);
      const title = cleanTitle(f.title);
      const key = title + '|' + type;
      if (seen.has(key)) continue;
      seen.add(key);
      const fileId = docIndex.get(key);
      if (!fileId) { miss.push(it.goodsName + '→' + title + '(无fileId)'); continue; }
      entries.push({ title, url: '/api/documents/' + fileId + '/download', fileId, isPublic: type === 'Formula', docType: type });
    }
    entries.sort((a, b) => ORDER[a.docType] - ORDER[b.docType] || a.title.localeCompare(b.title));
    total += entries.length;
    console.log('[' + local.id + '] ' + local.name + ' → ' + entries.length + ' 个文档（TDS/SDS ' + entries.filter(e => e.docType !== 'Brochure' && e.docType !== 'Formula').length + ' / 手册 ' + entries.filter(e => e.docType === 'Brochure').length + ' / 配方 ' + entries.filter(e => e.docType === 'Formula').length + '）');

    if (!APPLY || !entries.length) continue;
    const content = JSON.stringify({ files: entries });
    const existing = await prisma.$queryRawUnsafe("SELECT id, content FROM content_blocks WHERE product_type='pc' AND block_type='files' AND product_id=" + local.id);
    if (existing.length) {
      if (existing.length > 1) console.log('  ⚠️ 多个 files 区块(' + existing.length + ')，全部替换');
      // 备份旧内容到日志
      existing.forEach((e) => console.log('  ↺ 替换原区块#' + e.id + ': ' + Buffer.from(e.content).toString().slice(0, 120)));
      await prisma.$executeRawUnsafe("UPDATE content_blocks SET content=?, updated_at=datetime('now') WHERE product_type='pc' AND block_type='files' AND product_id=" + local.id, content);
    } else {
      const maxSort = await prisma.$queryRawUnsafe("SELECT COALESCE(MAX(sort_order),-1) as m FROM content_blocks WHERE product_type='pc' AND product_id=" + local.id);
      await prisma.$executeRawUnsafe(
        "INSERT INTO content_blocks (product_id, product_type, block_type, title, content, sort_order, is_published, created_at, updated_at) VALUES (?, 'pc', 'files', '相关资料', ?, ?, 1, datetime('now'), datetime('now'))",
        local.id, content, Number(maxSort[0].m) + 1
      );
      console.log('  + 新增 files 区块 sort=' + (Number(maxSort[0].m) + 1));
    }
  }

  console.log('\n=== 汇总 ===');
  console.log('挂接文档总数: ' + total + ' | 产品无匹配: ' + noProduct.length + ' | 文件缺失: ' + miss.length);
  if (noProduct.length) console.log('  无匹配产品: ' + noProduct.join(', '));
  if (miss.length) console.log('  缺失示例(前10): ' + [...new Set(miss)].slice(0, 10).join(' | '));
  await prisma.$disconnect();
})().catch(async (e) => { console.error('脚本异常:', e); await prisma.$disconnect(); process.exit(1); });
