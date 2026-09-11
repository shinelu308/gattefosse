/**
 * 存量封面修复：把「回退成详情页 banner」的封面换成原站列表卡片图（369×208）
 *
 * 背景（2026-09-11）：
 *   导入器 R7 只在**父目录（落地页）**找列表卡片图，但原站落地页只渲染 3 张精选卡，
 *   其余文章取不到卡片图 → 兜底用了详情页 banner（1440×405 等超宽横幅）。
 *   横幅塞进 369×208 的列表卡片后大片留白 + 横向挤扁，表现为「空占位」。
 *   已修 R7（补 parent/articles、parent/hot-topics 子列表页候选），本脚本负责**存量**重抓。
 *
 * 判定规则（只动真正有问题的记录，不churn正常记录）：
 *   当前本地封面宽高比与卡片比例 1.774 偏差 > 15%  →  视为「非卡片图」，替换
 *   文件缺失 / imageUrl 为空                        →  替换
 *   已在容差内（就是卡片图）                        →  跳过
 *
 * 幂等：跑第二遍时封面已是 369×208，落在容差内 → 自动跳过。
 *
 * 用法（在 backend/ 目录下执行，需先 npx tsc）：
 *   node scripts/fix-article-thumbs.js                   # dry-run，只列不改
 *   node scripts/fix-article-thumbs.js --apply           # 实际下载 + 写库
 *   node scripts/fix-article-thumbs.js --apply --only=1033,1041
 *   node scripts/fix-article-thumbs.js --apply --no-tags # 不补主题标签
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const {
  ORIGIN_BASE, fetchText, downloadFile,
  findCardThumbBySlug, findCardCategoryBySlug,
} = require('../dist/utils/import-rules.js');

const APPLY = process.argv.includes('--apply');
const WITH_TAGS = !process.argv.includes('--no-tags');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const ONLY_IDS = ONLY ? ONLY.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean) : null;

const CARD_RATIO = 369 / 208;   // 1.7740
const TOLERANCE = 0.15;         // 偏差 15% 以内视为已是卡片图

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prisma = new PrismaClient();

/** 从各种写法的 sourceUrl 里取出原站路径（兼容 /www.gattefosse.com/xxx 这类无协议脏数据） */
function originPathOf(srcUrl) {
  if (!srcUrl) return '';
  let m = /https?:\/\/[^/\s]*gattefosse\.com(\/[^?#\s]*)/i.exec(srcUrl);
  if (m) return m[1];
  m = /gattefosse\.com(\/[^?#\s]*)/i.exec(srcUrl);
  if (m) return m[1];
  m = /((?:personal-care|pharmaceuticals)\/[^?#\s]*)/i.exec(srcUrl);
  return m ? '/' + m[1] : '';
}

/** 本地封面物理路径；返回 null 表示不是本站 /uploads 相对路径 */
function localFileOf(imageUrl) {
  if (!imageUrl || !/^\/uploads\//.test(imageUrl)) return null;
  return path.join(process.cwd(), imageUrl.replace(/^\//, '').split('?')[0]);
}

async function ratioOfFile(p) {
  if (!p) return null;
  try {
    const m = await sharp(p).metadata();
    if (!m.width || !m.height) return null;
    return m.width / m.height;
  } catch { return null; }
}

/** 依次试「落地页 → /articles → /hot-topics」，返回 { thumb, cat, from, errs }
 *  ⚠️ 把「抓取失败」与「页面里没有这张卡」分开报，否则 302 限流会被误判成「原站没图」 */
async function lookupCard(originPath) {
  const segs = originPath.split('/').filter(Boolean);
  const errs = [];
  if (segs.length < 2) return { thumb: null, cat: null, from: '', errs: ['路径层级不足'] };
  const parent = '/' + segs.slice(0, -1).join('/');
  let thumb = null, cat = null, from = '';
  for (const cand of [parent, parent + '/articles', parent + '/hot-topics']) {
    let html = '';
    try { html = await fetchText(ORIGIN_BASE + cand); }
    catch (e) { errs.push(`${cand}（${e.message}）`); await sleep(400); continue; }
    if (!thumb) { thumb = findCardThumbBySlug(html, originPath); if (thumb) from = cand; }
    if (!cat) cat = findCardCategoryBySlug(html, originPath);
    if (thumb && cat) break;
    await sleep(400); // 礼貌间隔，降低触发原站限流（302）的概率
  }
  return { thumb, cat, from, errs };
}

(async () => {
  const rows = await prisma.newsEvent.findMany({
    where: { sourceUrl: { contains: 'gattefosse.com' } },
    select: { id: true, type: true, title: true, imageUrl: true, sourceUrl: true, tags: true },
    orderBy: { id: 'asc' },
  });
  const targets = ONLY_IDS ? rows.filter((r) => ONLY_IDS.includes(r.id)) : rows;
  console.log(`扫描到 sourceUrl 指向原站的记录 ${rows.length} 条` + (ONLY_IDS ? `，--only 过滤后 ${targets.length} 条` : ''));
  console.log(`模式：${APPLY ? '★ APPLY（实际写库）' : 'dry-run（只列不改）'} | 主题标签补齐：${WITH_TAGS ? '开' : '关'}\n`);

  const uploadDir = path.join(process.cwd(), 'uploads', 'articles');
  if (APPLY && !fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const stat = { skipOk: 0, noThumb: 0, noSource: 0, fixed: 0, failed: 0, tags: 0 };

  for (const it of targets) {
    const originPath = originPathOf(it.sourceUrl);
    const label = `#${it.id} ${String(it.title || '').slice(0, 26)}`;
    if (!originPath) { stat.noSource++; console.log(`— ${label} | 无法解析原站路径（${it.sourceUrl}）`); continue; }

    const curFile = localFileOf(it.imageUrl);
    const curRatio = await ratioOfFile(curFile);
    const curBad = !curFile || !fs.existsSync(curFile) || curRatio === null
      || Math.abs(curRatio - CARD_RATIO) / CARD_RATIO > TOLERANCE;
    const curTxt = curRatio ? `当前 ${curRatio.toFixed(3)}` : (curFile ? '当前 文件缺失' : `当前 ${String(it.imageUrl || '(空)').slice(0, 30)}`);

    const { thumb, cat, from, errs } = await lookupCard(originPath);
    if (!thumb) {
      stat.noThumb++;
      console.log(`— ${label} | ${curTxt} | ${errs.length ? '列表页抓取失败：' + errs.join('；') : '候选页均无此卡'}`);
      continue;
    }

    if (!curBad) {
      stat.skipOk++;
      console.log(`✓ ${label} | ${curTxt} → 已是卡片图，跳过`);
      if (WITH_TAGS && cat && !it.tags) {
        // 主题标签只存在于列表卡片；这里顺手补齐（与 import-verify 行为一致）
        if (APPLY) { await prisma.newsEvent.update({ where: { id: it.id }, data: { tags: JSON.stringify([cat]) } }); stat.tags++; }
        console.log(`    ↳ 主题标签${APPLY ? '已补' : '待补'}：${cat}${from ? '（取自 ' + from + '）' : ''}`);
      }
      continue;
    }

    const remoteBase = decodeURIComponent(new URL(thumb).pathname.split('/').pop() || '')
      .replace(/\.webp$/i, '').replace(/[^\w.\-]+/g, '_').slice(0, 60) || 'thumb';
    const fname = `${Date.now()}_99_${remoteBase}`;
    const withExt = /\.(jpe?g|png|gif|webp|svg)$/i.test(fname) ? fname : fname + '.webp';

    if (!APPLY) {
      console.log(`✎ ${label} | ${curTxt} → 将替换为 ${remoteBase}（369×208，取自 ${from}）`);
      if (WITH_TAGS && cat && !it.tags) console.log(`    ↳ 主题标签待补：${cat}`);
      stat.fixed++;
      continue;
    }
    try {
      await downloadFile(thumb, path.join(uploadDir, withExt));
      await prisma.newsEvent.update({ where: { id: it.id }, data: { imageUrl: `/uploads/articles/${withExt}` } });
      stat.fixed++;
      console.log(`✔ ${label} | ${curTxt} → ${withExt}`);
      if (WITH_TAGS && cat && !it.tags) {
        await prisma.newsEvent.update({ where: { id: it.id }, data: { tags: JSON.stringify([cat]) } });
        stat.tags++;
        console.log(`    ↳ 主题标签已补：${cat}`);
      }
    } catch (e) {
      stat.failed++;
      console.log(`✖ ${label} | 失败：${e.message}`);
    }
  }

  console.log(`\n汇总：${APPLY ? '已修' : '待修'} ${stat.fixed} | 已是卡片图跳过 ${stat.skipOk} | 原站无卡片图 ${stat.noThumb} | 无来源 ${stat.noSource} | 失败 ${stat.failed} | 补标签 ${stat.tags}`);
  if (!APPLY) console.log('（dry-run，未写库；加 --apply 执行）');
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERR', e); try { await prisma.$disconnect(); } catch {} process.exit(1); });
