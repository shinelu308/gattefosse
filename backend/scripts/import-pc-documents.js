/**
 * 抓取英文站所有 PC 产品详情页 Resources 文档 → 后台 documents 表分类存放
 *  - Formulation(开放直链 /files/<nid>/<file>.pdf) → type=Formula, is_public=1
 *  - Technical documentation(TDS/SDS/RDS) → type=TDS/SDS（原站登录锁定，尝试 /files/<nid>/<名>.pdf，0B 空文件不入库）
 *  - Brochures → type=Brochure（同上）
 * 用法: node scripts/import-pc-documents.js [--apply] [--only=<slug>]
 */
const path = require('path');
const https = require('https');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const EN = 'https://www.gattefosse.com';
const DOC_DIR = path.join(__dirname, '..', 'uploads', 'documents');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function get(url, binary) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) return resolve(get(new URL(res.headers.location, url).toString(), binary));
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      if (binary) { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve(Buffer.concat(c))); }
      else { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve(b)); }
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带重试的抓取（网络抖动容错） */
async function getRetry(url, binary, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await get(url, binary);
      if (r !== null && r !== undefined) return r;
    } catch (e) { /* 网络抖动继续重试 */ }
    if (i < tries) await sleep(1500 * i);
  }
  return null;
}

/** 解析详情页 Resources 三类文档（含锁定标记与 node id） */
function parseResources(html) {
  const nidM = html.match(/url=\/node\/(\d+)/);
  const nid = nidM ? nidM[1] : null;
  const docs = [];
  const typeRe = /<h3 class="s-product-document__title">([^<]+)<\/h3>\s*<ul class="s-product-document__list">([\s\S]*?)<\/ul>/g;
  let tm;
  while ((tm = typeRe.exec(html)) !== null) {
    const catRaw = tm[1].trim();
    const liRe = /<li class="c-link c-link--document( c-link--locked)?"[\s\S]*?href="([^"]*)"[^>]*>[\s\S]*?<span class="c-link__name">([^<]*)<\/span>/g;
    let lm;
    while ((lm = liRe.exec(tm[2])) !== null) {
      docs.push({ cat: catRaw, locked: !!lm[1], href: lm[2].trim(), name: lm[3].trim() });
    }
  }
  return { nid, docs };
}

function docType(cat, name) {
  if (/Formulation/i.test(cat)) return 'Formula';
  if (/Brochure/i.test(cat)) return 'Brochure';
  if (/^SDS/i.test(name)) return 'SDS';
  return 'TDS'; // Technical documentation: TDS_/RDSCosm_/其他 → 技术文档
}

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e.toLowerCase()] || m;
  });
}

function fileNameFor(url, nid) {
  const base = decodeURIComponent(url.split('?')[0].split('/').pop()) || ('doc-' + nid + '.pdf');
  return base;
}

async function download(url, file) {
  const buf = await getRetry(url, true);
  if (!buf || buf.length < 1000 || buf.slice(0, 5).toString() !== '%PDF-') return null; // 锁定空文件/非PDF
  fs.writeFileSync(path.join(DOC_DIR, file), buf);
  return buf.length;
}

(async () => {
  fs.mkdirSync(DOC_DIR, { recursive: true });
  console.log('模式: ' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  const locals = await prisma.$queryRawUnsafe("SELECT id, name, intl_url FROM pc_ingredients WHERE intl_url IS NOT NULL AND intl_url != '' ORDER BY id");
  console.log('待处理产品 ' + locals.length + ' 个\n');

  // 已有文档（防重）
  const existing = new Set((await prisma.$queryRawUnsafe("SELECT title, type FROM documents")).map((r) => r.title + '|' + r.type));

  let okCount = 0, dupCount = 0, lockFail = [];
  const lockTally = { tds: 0, sds: 0, brochure: 0 };
  for (const l of locals) {
    const slug = l.intl_url.replace(/\/+$/, '').split('/').pop();
    if (onlyArg && !slug.includes(onlyArg)) continue;
    const html = await getRetry(l.intl_url);
    await sleep(250);
    if (!html) { console.log('✗ [' + l.id + '] ' + l.name + ' 详情页不可达: ' + slug); continue; }
    const { nid, docs } = parseResources(html);
    if (!docs.length) { console.log('  [' + l.id + '] ' + l.name + ' 无 Resources'); continue; }

    for (const d of docs) {
      const type = docType(d.cat, d.name);
      if (type === 'Formula') {
        const url = d.href.startsWith('http') ? d.href : EN + d.href;
        const title = decodeEntities(d.name.replace(/\.pdf$/i, ''));
        if (existing.has(title + '|Formula')) { dupCount++; continue; }
        if (!APPLY) { okCount++; console.log('  + [Formula] ' + title); continue; }
        const file = fileNameFor(url, nid);
        const size = await download(url, file);
        if (!size) { lockFail.push(l.name + ' Formula ' + d.name); continue; }
        await prisma.$executeRawUnsafe(
          "INSERT INTO documents (title, type, file_path, file_size, language, is_public, download_count, created_at, updated_at) VALUES (?, 'Formula', ?, ?, 'en', 1, 0, datetime('now'), datetime('now'))",
          title, '/uploads/documents/' + file, size
        );
        existing.add(title + '|Formula');
        okCount++;
        console.log('  ✓ [Formula] ' + title + ' (' + (size / 1024).toFixed(0) + 'KB)');
      } else {
        // 锁定文档：尝试 /files/<nid>/<文件名>
        lockTally[type === 'SDS' ? 'sds' : type === 'Brochure' ? 'brochure' : 'tds']++;
        if (!APPLY) continue;
        const guess = EN + '/files/' + nid + '/' + encodeURIComponent(d.name);
        const buf = await getRetry(guess, true);
        if (buf && buf.length > 1000 && buf.slice(0, 5).toString() === '%PDF-') {
          const file = fileNameFor(decodeEntities(d.name.startsWith('http') ? d.name : guess), nid);
          fs.writeFileSync(path.join(DOC_DIR, file), buf);
          const title = decodeEntities(d.name.replace(/\.pdf$/i, ''));
          if (existing.has(title + '|' + type)) { dupCount++; continue; }
          await prisma.$executeRawUnsafe(
            "INSERT INTO documents (title, type, file_path, file_size, language, is_public, download_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'en', 0, 0, datetime('now'), datetime('now'))",
            title, type, '/uploads/documents/' + file, buf.length
          );
          existing.add(title + '|' + type);
          okCount++;
          console.log('  ✓ [' + type + '] ' + title + ' (' + (buf.length / 1024).toFixed(0) + 'KB)');
        } else {
          lockFail.push(type + ':' + d.name);
        }
        await sleep(150);
      }
    }
  }

  console.log('\n=== 汇总 ===');
  console.log('入库/计划: ' + okCount + ' | 已存在跳过: ' + dupCount);
  console.log('锁定文档统计: TDS ' + lockTally.tds + ' | SDS ' + lockTally.sds + ' | Brochure ' + lockTally.brochure + '（原站需登录，匿名下载为 0B 空文件）');
  if (lockFail.length) console.log('未获取锁定文档 ' + lockFail.length + ' 个（示例前 5）: ' + lockFail.slice(0, 5).join(' | '));
  await prisma.$disconnect();
})().catch(async (e) => { console.error('脚本异常:', e); await prisma.$disconnect(); process.exit(1); });
