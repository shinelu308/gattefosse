/**
 * PC 产品详情区块批量导入（从中文老站 gattefossechina.cn → 本系统 content_blocks）
 *
 * 数据源（均已验证无需登录）：
 *   - 列表:  GET https://www.gattefossechina.cn/api/mallGoodsInfo/getMallGoodsInfoList?goodsCategoryId=121&pageSize=100&page=1
 *   - 描述:  GET /api/webContents/findWebContents?ID=<contentId>
 *   - 主内容: GET /api/webContents/findWebContents?ID=<mainContentId>   （按 <h2> 分区块）
 *   - 英文站: 老站 enUrl → og:image（缩略图/大图）+ 英文区块首图（文中配图）
 *
 * 区块结构对齐手动成品（Noxifense/Eyeglorius/Kappa MB）：
 *   [0] richtext 「描述」     {html}
 *   [1] richtext 「产品宣称」 {html}   ← 老站 claims 字段
 *   [2..] 老站 mainContent 的每个 h2 区块，保留中文原名：
 *         有图 → imagetext {leftType:'image',leftUrl, rightType:'richtext',rightHtml}
 *         有视频链接 → imagetext {leftType:'video',leftUrl, rightType:'richtext',rightHtml}
 *         无图 → richtext {html}
 *
 * 图片策略：缩略图/详情大图/文中配图一律抓取下载到本地 uploads/images，全部写相对路径。
 * 幂等：--apply 先删该产品旧区块再插入；默认跳过已有区块的产品（手动成品）。
 *
 * 用法：
 *   node scripts/import-pc-blocks.js                      # dry-run
 *   node scripts/import-pc-blocks.js --apply              # 实际写库
 *   node scripts/import-pc-blocks.js --only=Solastemis    # 单产品调试
 *   node scripts/import-pc-blocks.js --apply --include-manual
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const INCLUDE_MANUAL = process.argv.includes('--include-manual');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';

const OLD_SITE = 'https://www.gattefossechina.cn';
const EN_SITE = 'https://www.gattefosse.com';
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'images');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// 手动成品固定名单（Noxifense 59 / Eyeglorius 60 / Kappa MB 75），不参与批量导入覆盖
const MANUAL_IDS = [59, 60, 75];

// 中文区块标题 → 英文站区块标题（取配图用）
const H2_EN_MAP = [
  [/^来源|^植物来源/, 'Sourcing'],
  [/^作用机制|^作用机理|^行动机制/, 'Mechanism of action'],
  [/^临床评估|^临床评价|^临床测试/, 'Clinical evaluation'],
  [/^组成|^原料组成/, 'Composition'],
  [/^感官/, 'Sensory'],
  [/^配方/, 'Formulation'],
  [/^视频/, 'The ingredient video summary'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normName = (s) => (s || '').toLowerCase().replace(/[™®©]/g, '').replace(/[’']/g, '')
  .replace(/²/g, '2').replace(/[^a-z0-9]+/g, '').trim();

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': UA, Referer: OLD_SITE + '/' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b, type: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout ' + url)));
  });
}

async function fetchJson(url) {
  const { body } = await fetchText(url);
  return JSON.parse(body);
}

async function downloadImage(url, filepath) {
  if (fs.existsSync(filepath) && fs.statSync(filepath).size > 500) return true;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Referer: EN_SITE + '/' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(downloadImage(new URL(res.headers.location, url).toString(), filepath));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const ws = fs.createWriteStream(filepath);
      res.pipe(ws);
      ws.on('finish', () => resolve(true));
      ws.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(45000, () => req.destroy(new Error('img timeout')));
  });
}

function extFromUrl(u) {
  const m = (u.split('?')[0]).match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}

function extractImgs(html) {
  const out = [];
  const re = /<img[^>]*\ssrc=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1];
    if (/^data:/.test(u)) continue;
    if (/^\/\//.test(u)) u = 'https:' + u;
    else if (/^\/uploads\//.test(u)) u = OLD_SITE + u;
    else if (/^uploads\//.test(u)) u = OLD_SITE + '/' + u;
    else if (!/^https?:\/\//i.test(u)) continue;
    if (!/gattefossechina\.cn/.test(u)) continue;
    out.push(u);
  }
  return [...new Set(out)];
}

/** 按 <h2> 把主内容切成区块 [{title, html}] */
function splitByH2(mainHtml) {
  const clean = (mainHtml || '').split('&nbsp;').join(' ');
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const heads = [];
  let m;
  while ((m = re.exec(clean))) {
    heads.push({ title: m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim(), index: m.index, end: re.lastIndex });
  }
  const sections = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].end;
    const end = i + 1 < heads.length ? heads[i + 1].index : clean.length;
    const title = heads[i].title;
    if (!title) continue;
    sections.push({ title, html: clean.slice(start, end).trim() });
  }
  if (!sections.length && clean.trim()) sections.push({ title: '', html: clean.trim() });
  return sections;
}

/** 视频嵌入地址：iframe / B站 / 直接 mp4 */
function extractVideoUrl(html) {
  if (!html) return '';
  const iframe = html.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  if (iframe) return iframe[1];
  const bv = html.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
  if (bv) return '//player.bilibili.com/player.html?bvid=' + bv[1] + '&autoplay=0';
  const mp4 = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
  if (mp4) return mp4[0];
  return '';
}

/** 英文站详情页解析：og:image + 英文区块标题 → 首张内容图 */
async function parseEnPage(enUrl) {
  const result = { ogImage: null, ogOriginal: null, blocks: {} };
  if (!enUrl) return result;
  try {
    const { status, body } = await fetchText(enUrl);
    if (status !== 200) { console.log('    ⚠️ 英文站 ' + status + ': ' + enUrl); return result; }
    const og = body.match(/property="og:image"\s+content="([^"]+)"/) || body.match(/content="([^"]+)"\s+property="og:image"/);
    if (og) {
      result.ogImage = og[1];
      // styles/facebook/public/2023-06/x.jpg.webp → 原图 /sites/default/files/2023-06/x.jpg(.webp)
      const orig = og[1].replace(/\/styles\/[^/]+\/public\//, '/sites/default/files/').split('?')[0];
      result.ogOriginal = orig !== og[1] ? orig : null;
    }
    const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
    const heads = [];
    let m;
    while ((m = re.exec(body))) heads.push({ title: m[1].replace(/<[^>]+>/g, '').trim(), index: m.index, end: re.lastIndex });
    for (let i = 0; i < heads.length; i++) {
      const seg = body.slice(heads[i].end, i + 1 < heads.length ? heads[i + 1].index : body.length);
      const imgs = [...seg.matchAll(/src="([^"]*\/sites\/default\/files\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)]
        .map((x) => x[1])
        .filter((u) => !/styles\/card_default|styles\/facebook|styles\/hero|styles\/thumbnail/.test(u))
        .map((u) => (u.startsWith('http') ? u : EN_SITE + u));
      if (imgs.length) result.blocks[heads[i].title] = imgs[0];
    }
  } catch (e) {
    console.log('    ⚠️ 英文站解析失败: ' + e.message);
  }
  return result;
}

/** 区块 HTML → 图片本地化（英文站图优先，回退中文站图），返回 {html, images[]} */
async function localizeBlockImages(pid, slug, bIdx, sectionHtml, enFirstImg) {
  const oldImgs = extractImgs(sectionHtml);
  const images = [];
  let html = sectionHtml;

  // 候选顺序：英文站对应区块图在前，老站自带图兜底
  const candidates = [];
  if (enFirstImg) candidates.push(enFirstImg);
  candidates.push(...oldImgs);

  let n = 0;
  for (const url of candidates) {
    const ext = extFromUrl(url);
    const file = 'pc' + pid + '-' + slug + '-b' + bIdx + '-' + (n + 1) + ext;
    const filepath = path.join(UPLOAD_DIR, file);
    const ok = await downloadImage(url, filepath);
    if (!ok) { console.log('    ⚠️ 图片下载失败: ' + url.slice(0, 90)); continue; }
    images.push('/uploads/images/' + file);
    n++;
    if (n === 1) {
      // 第一张：替换/注入为区块左图；HTML 里的 <img> 移除（左图已单独渲染）
      if (oldImgs.length) {
        html = html.replace(/<img[^>]*\ssrc=["'][^"']*["'][^>]*>/gi, '');
      }
    }
    if (n >= 3) break; // 每区块最多 3 张，够 imagetext/slider 用
  }
  if (!n && oldImgs.length) {
    // 全部下载失败：保留原 HTML（含老站图），人工兜底
    console.log('    ⚠️ 区块图片全部下载失败，保留原文 ' + oldImgs.length + ' 张图');
  }
  html = html.replace(/(?:<p>\s*<\/p>\s*)+/g, '').trim();
  return { html, images };
}

async function main() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log('模式: ' + (APPLY ? 'APPLY（实际写库）' : 'DRY-RUN（仅打印计划）'));
  if (onlyArg) console.log('仅处理名称含: ' + onlyArg);

  // 1) 本地产品
  const locals = await prisma.$queryRawUnsafe("SELECT id, name, inci_name, image_url, detail_image_url, intl_url FROM pc_ingredients ORDER BY id");
  const byNorm = new Map();
  locals.forEach((l) => byNorm.set(normName(l.name), l));

  // 已有区块的产品（手动成品）
  const hasBlocks = new Set((await prisma.$queryRawUnsafe("SELECT DISTINCT product_id AS pid FROM content_blocks WHERE product_type='pc'")).map((r) => Number(r.pid)));
  console.log('本地 PC 产品 ' + locals.length + ' 个；已有区块（视为手动成品）: ' + [...hasBlocks].join(','));

  // 2) 老站列表
  const listRes = await fetchJson(OLD_SITE + '/api/mallGoodsInfo/getMallGoodsInfoList?pageSize=100&page=1&goodsCategoryId=121');
  const oldItems = listRes.data.list;
  console.log('老站产品 ' + oldItems.length + ' 个\n');

  let done = 0, skippedManual = 0, noMatch = [], plan = [];

  for (const it of oldItems) {
    const local = byNorm.get(normName(it.goodsName));
    if (!local) { noMatch.push(it.goodsName); continue; }
    if (MANUAL_IDS.includes(local.id) && !INCLUDE_MANUAL) { skippedManual++; continue; }
    if (onlyArg && !it.goodsName.includes(onlyArg)) continue;

    console.log('▶ [' + local.id + '] ' + it.goodsName);
    const slug = normName(it.goodsName).slice(0, 24) || 'p' + local.id;

    // 3) 英文站页面（og:image + 区块图）
    const en = await parseEnPage(it.enUrl);
    await sleep(200);

    // 4) 老站描述 + 主内容
    let descHtml = '';
    if (it.contentId) {
      try {
        const d = await fetchJson(OLD_SITE + '/api/webContents/findWebContents?ID=' + it.contentId);
        descHtml = (d.data.reWebContents.content || '').trim();
      } catch (e) { console.log('    ⚠️ 描述拉取失败: ' + e.message); }
      await sleep(150);
    }
    let mainHtml = '';
    try {
      const d = await fetchJson(OLD_SITE + '/api/webContents/findWebContents?ID=' + it.mainContentId);
      mainHtml = (d.data.reWebContents.content || '').trim();
    } catch (e) { console.log('    ⚠️ 主内容拉取失败: ' + e.message); }
    await sleep(150);

    // 5) 组装区块
    const blocks = [];
    if (descHtml) blocks.push({ blockType: 'richtext', title: '描述', content: { html: descHtml } });
    if (it.claims && String(it.claims).trim()) blocks.push({ blockType: 'richtext', title: '产品宣称', content: { html: String(it.claims).trim() } });

    const sections = splitByH2(mainHtml);
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const enTitle = (H2_EN_MAP.find(([re2]) => re2.test(sec.title)) || [])[1];
      const enImg = enTitle ? en.blocks[enTitle] : null;
      const { html, images } = await localizeBlockImages(local.id, slug, si, sec.html, enImg);
      if (!html && !images.length) continue;

      const videoUrl = extractVideoUrl(sec.html);
      if (/^视频/.test(sec.title) && videoUrl && !images.length) {
        blocks.push({ blockType: 'video', title: sec.title, content: { url: videoUrl } });
        continue;
      }
      if (images.length >= 2) {
        // 多图 → slider（每图一页，文字放第一页右侧）
        blocks.push({
          blockType: 'slider', title: sec.title,
          content: { slides: images.map((u, i) => ({ leftType: 'image', leftUrl: u, leftText: '', leftHtml: '', rightType: i === 0 ? 'richtext' : 'text', rightText: i === 0 ? '' : '', rightUrl: '', rightHtml: i === 0 ? html : '' })) },
        });
        continue;
      }
      if (images.length === 1) {
        blocks.push({
          blockType: 'imagetext', title: sec.title,
          content: { leftType: 'image', leftUrl: images[0], leftText: '', leftHtml: '', rightType: 'richtext', rightText: '', rightUrl: '', rightHtml: html },
        });
        continue;
      }
      if (videoUrl) {
        blocks.push({
          blockType: 'imagetext', title: sec.title,
          content: { leftType: 'video', leftUrl: videoUrl, leftText: '', leftHtml: '', rightType: 'richtext', rightText: '', rightUrl: '', rightHtml: html },
        });
        continue;
      }
      blocks.push({ blockType: 'richtext', title: sec.title, content: { html } });
    }

    // 6) 缩略图 / 详情大图（英文站 og:image）
    let newThumb = null, newDetail = null;
    if (en.ogImage) {
      const t = 'pc' + local.id + '-' + slug + '-thumb' + extFromUrl(en.ogImage);
      if (await downloadImage(en.ogImage, path.join(UPLOAD_DIR, t))) newThumb = '/uploads/images/' + t;
      const origUrl = en.ogOriginal || en.ogImage;
      const dfile = 'pc' + local.id + '-' + slug + '-detail' + extFromUrl(origUrl);
      if (await downloadImage(origUrl, path.join(UPLOAD_DIR, dfile))) newDetail = '/uploads/images/' + dfile;
      if (!newDetail && newThumb) newDetail = newThumb;
    }
    if (!newThumb || !newDetail) console.log('    ⚠️ 英文站主图缺失，保留现有缩略/详情图');

    plan.push({ local, old: it, blocks, newThumb, newDetail });
    done++;
  }

  // 7) 计划汇总
  console.log('\n========== 导入计划 ==========');
  console.log('匹配成功: ' + done + ' | 跳过手动成品: ' + skippedManual + ' | 老站有本地无: ' + noMatch.length);
  if (noMatch.length) console.log('  未匹配: ' + noMatch.join(', '));
  let blockCount = {}, imgCount = 0;
  for (const p of plan) {
    console.log('\n[' + p.local.id + '] ' + p.local.name + ' → ' + p.blocks.length + ' 个区块:');
    p.blocks.forEach((b) => {
      blockCount[b.title] = (blockCount[b.title] || 0) + 1;
      const c = JSON.stringify(b.content);
      imgCount += (c.match(/\/uploads\/images\//g) || []).length;
      console.log('    [' + b.blockType + '] ' + b.title + ' (' + c.length + 'B)');
    });
    console.log('    主图: 缩略=' + (p.newThumb || '(保留)') + ' 详情=' + (p.newDetail || '(保留)'));
  }
  console.log('\n区块标题分布:', JSON.stringify(blockCount));
  console.log('本地化图片引用总数: ' + imgCount);

  if (!APPLY) {
    console.log('\n(DRY-RUN 结束，加 --apply 实际写库)');
    await prisma.$disconnect();
    return;
  }

  // 8) 写库
  console.log('\n开始写库...');
  let okProducts = 0, failProducts = 0;
  for (const p of plan) {
    try {
      await prisma.$executeRawUnsafe("DELETE FROM content_blocks WHERE product_type='pc' AND product_id=" + p.local.id);
      let so = 0;
      for (const b of p.blocks) {
        await prisma.$executeRawUnsafe(
          "INSERT INTO content_blocks (product_id, product_type, block_type, title, content, sort_order, is_published, created_at, updated_at) VALUES (?, 'pc', ?, ?, ?, ?, 1, datetime('now'), datetime('now'))",
          p.local.id, b.blockType, b.title || null, JSON.stringify(b.content), so++
        );
      }
      if (p.newThumb || p.newDetail) {
        await prisma.$executeRawUnsafe(
          "UPDATE pc_ingredients SET image_url = COALESCE(?, image_url), detail_image_url = COALESCE(?, detail_image_url), updated_at = datetime('now') WHERE id = ?",
          p.newThumb, p.newDetail, p.local.id
        );
      }
      okProducts++;
      console.log('  ✓ [' + p.local.id + '] ' + p.local.name + '（' + p.blocks.length + ' 区块）');
      // 清理旧版无区块索引命名的冲突图片（pc<id>-<slug>-<n>.<ext>，不含 -thumb/-detail/-bIdx）
      const slug2 = normName(p.old.goodsName).slice(0, 24) || 'p' + p.local.id;
      const staleRe = new RegExp('^pc' + p.local.id + '-' + slug2 + '-\\d+\\.(png|jpe?g|webp|gif)$', 'i');
      let cleaned = 0;
      for (const f of fs.readdirSync(UPLOAD_DIR)) {
        if (staleRe.test(f)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); cleaned++; } catch (_) {} }
      }
      if (cleaned) console.log('    清理旧冲突图片 ' + cleaned + ' 张');
    } catch (e) {
      failProducts++;
      console.log('  ✗ [' + p.local.id + '] ' + p.local.name + ': ' + e.message);
    }
  }
  console.log('\n完成: 成功 ' + okProducts + '，失败 ' + failProducts);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('脚本异常:', e); await prisma.$disconnect(); process.exit(1); });
