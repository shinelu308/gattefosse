/**
 * 中文老站（gattefossechina.cn）文档抓取 → 后台 documents 表
 * 需会员 token（localStorage._token，SAML 登录后获取），存 .localize_tmp/oldsite_token.txt
 *  - fileSet=1 技术文档：title 前缀 SDS_*→SDS，其余（TDS_/RDSCosm_）→TDS，is_public=0
 *  - fileSet=2 手册 → Brochure，is_public=0
 *  - fileSet=3 配方 → Formula，is_public=1（与英文站抓取去重衔接：title+type 查重）
 * 用法: node scripts/import-oldsite-documents.js [--apply]
 */
const path = require('path');
const https = require('https');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const OLD = 'https://www.gattefossechina.cn';
const TOKEN = fs.readFileSync(path.join(__dirname, '..', '..', '.localize_tmp', 'oldsite_token.txt'), 'utf8').trim();
const DOC_DIR = path.join(__dirname, '..', 'uploads', 'documents');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function get(url, binary, tries = 4) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'x-token': TOKEN } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) return resolve(get(new URL(res.headers.location, url).toString(), binary, tries));
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      if (binary) {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => resolve(Buffer.concat(c)));
      } else { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve(b)); }
    });
    // 60s 无响应视为连接黑洞，中断触发重试
    req.setTimeout(60000, () => { req.destroy(new Error('timeout 60s')); });
    req.on('error', () => { if (tries > 1) setTimeout(() => resolve(get(url, binary, tries - 1)), 1500); else resolve(null); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e.toLowerCase()] || m;
  });
}
function docType(fileSet, title) {
  if (fileSet === 3) return 'Formula';
  if (fileSet === 2) return 'Brochure';
  return /^SDS/i.test(title) ? 'SDS' : 'TDS';
}

(async () => {
  fs.mkdirSync(DOC_DIR, { recursive: true });
  console.log('模式: ' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.localize_tmp', 'oldsite_pc_list.json'), 'utf8'));
  const items = list.data ? list.data.list : list;
  console.log('老站产品 ' + items.length + ' 个\n');

  const existing = new Set((await prisma.$queryRawUnsafe("SELECT title, type FROM documents")).map((r) => r.title + '|' + r.type));
  let ok = 0, dup = 0, fail = [];
  for (const it of items) {
    const goodsId = it.ID;
    const r = await get(OLD + '/api/mallGoodsFiles/getMallGoodsFilesList?goodsId=' + goodsId);
    await sleep(250);
    if (!r) { fail.push(it.goodsName + '(list)'); continue; }
    let files = [];
    try { files = JSON.parse(r).data.list || []; } catch (e) { fail.push(it.goodsName + '(parse)'); continue; }
    if (!files.length) continue;
    console.log('▶ [' + goodsId + '] ' + it.goodsName + '（' + files.length + ' 个文件）');

    for (const f of files) {
      if (!f.url) { fail.push(f.title + '(nourl)'); continue; }
      const type = docType(f.fileSet, f.title);
      // title 清洗：老站部分数据把后续标题粘连进来（如 "SDS_xx.pdf Brochures Personal Care Guide"），截取 .pdf 之前
      let t = decodeEntities(String(f.title));
      const pdfIdx = t.toLowerCase().indexOf('.pdf');
      if (pdfIdx > -1) t = t.slice(0, pdfIdx);
      const title = t.trim();
      if (existing.has(title + '|' + type)) { dup++; continue; }
      if (!APPLY) { ok++; console.log('  + [' + type + '] ' + title); continue; }
      const url = f.url.startsWith('http') ? f.url : OLD + (f.url.startsWith('/') ? '' : '/') + f.url;
      const fname = decodeURIComponent(f.url.split('?')[0].split('/').pop());
      const buf = await get(url, true);
      await sleep(150);
      if (!buf || buf.length < 1000 || buf.slice(0, 5).toString() !== '%PDF-') { fail.push(title + '(dl)'); continue; }
      fs.writeFileSync(path.join(DOC_DIR, fname), buf);
      await prisma.$executeRawUnsafe(
        "INSERT INTO documents (title, type, file_path, file_size, language, is_public, download_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'en', ?, 0, datetime('now'), datetime('now'))",
        title, type, '/uploads/documents/' + fname, buf.length, type === 'Formula' ? 1 : 0
      );
      existing.add(title + '|' + type);
      ok++;
      console.log('  ✓ [' + type + '] ' + title + ' (' + (buf.length / 1024).toFixed(0) + 'KB)');
    }
  }
  console.log('\n=== 汇总 ===');
  console.log('入库/计划: ' + ok + ' | 去重跳过: ' + dup + ' | 失败: ' + fail.length);
  if (fail.length) console.log('失败清单(前10): ' + [...new Set(fail)].slice(0, 10).join(' | '));
  await prisma.$disconnect();
})().catch(async (e) => { console.error('脚本异常:', e); await prisma.$disconnect(); process.exit(1); });
