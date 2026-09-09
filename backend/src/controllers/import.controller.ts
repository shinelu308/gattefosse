import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { config } from '../config';
import {
  ORIGIN_BASE, downloadFile, fetchText, absoluteUrl, cleanBingLinks, translateTag,
  findTagByClass, attrOfTag, stripImgParams, stripTags, findCardThumbBySlug, findCardCategoryBySlug,
  extractBalancedDiv, extractDivByClass,
} from '../utils/import-rules';
import { translateArticleTheme, translateArticleThemes } from '../utils/article-theme';
import { verifyImportedArticle, reverifyArticle } from '../utils/import-verify';
import {
  normalizeListUrl, inferCategoryFromUrl, parsePublicationCards, extractNextPageUrl,
} from '../utils/import-publications';

const SITE_ORIGIN = ORIGIN_BASE;
const CN_ORIGIN = 'https://www.gattefossechina.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 平衡 div 内部：拆出顶层子 div 片段数组 */
function splitChildDivs(divHtml: string): string[] {
  const openEnd = divHtml.indexOf('>');
  if (openEnd < 0) return [];
  let i = openEnd + 1;
  const children: string[] = [];
  while (i < divHtml.length) {
    const nextDiv = divHtml.indexOf('<div', i);
    const closeIdx = divHtml.indexOf('</div>', i);
    if (nextDiv < 0) break;
    if (closeIdx >= 0 && closeIdx < nextDiv) break; // 顶层结束了
    const frag = extractBalancedDiv(divHtml, nextDiv);
    if (!frag) break;
    children.push(frag);
    i = nextDiv + frag.length;
  }
  return children;
}

function getAttr(fragment: string, attr: string): string | null {
  const m = new RegExp(attr + '="([^"]*)"').exec(fragment);
  return m ? m[1] : null;
}

function textOfFragment(fragment: string): string {
  return stripTags(fragment);
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** 解析 "05 Jun 2026" 格式日期 */
function parseSiteDate(text: string): Date | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(text);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return new Date(Date.UTC(parseInt(m[3], 10), mon - 1, parseInt(m[1], 10)));
}

/** 从中文站 URL 提取新闻 ID（...detail.html?id=293，兼容 ?ID=） */
function extractChinaNewsId(u: string): number | null {
  const m = /[?&]id=(\d+)/i.exec(u);
  return m ? parseInt(m[1], 10) : null;
}

/** GET JSON（中文站接口） */
function fetchJson(target: string): Promise<any> {
  return fetchText(target).then((data) => {
    try { return JSON.parse(data); } catch { throw new Error('中文站接口返回非 JSON'); }
  });
}

/**
 * 中文站（gattefossechina.cn）导入
 * 中文站为 Vue+API 架构：详情页 id → findWebNewsEvents（记录）→ findWebContents（正文 HTML）
 * 自动识别类型（1=新闻 2=活动）与分类（goodsCategoryId 1=个人护理 117=药用辅料）
 */
async function importFromChinaSite(url: string, fallbackCategory: string, forceType?: string) {
  const newsId = extractChinaNewsId(url);
  if (!newsId) throw new Error('未能在链接中找到文章 ID，请粘贴详情页地址（如 https://www.gattefossechina.cn/personal-care-news-detail.html?id=293）');

  const itemRes = await fetchJson(`${CN_ORIGIN}/api/webNewsEvents/findWebNewsEvents?ID=${newsId}`);
  const item = itemRes && itemRes.data && itemRes.data.reWebNewsEvents;
  if (!item) throw new Error('中文站接口未返回新闻数据（ID=' + newsId + '）');

  // 防重复导入
  const cnExist = await prisma.newsEvent.findFirst({ where: { slug: 'cn-' + newsId }, select: { id: true, title: true } });
  if (cnExist) throw new Error(`该文章已导入过（ID=${cnExist.id}《${cnExist.title}》），请勿重复导入`);

  let contentHtml = '';
  if (item.contentId) {
    try {
      const cRes = await fetchJson(`${CN_ORIGIN}/api/webContents/findWebContents?ID=${item.contentId}`);
      const c = cRes && cRes.data && cRes.data.reWebContents;
      if (c && c.content) contentHtml = String(c.content);
    } catch { /* 正文接口失败按空处理，走下方校验 */ }
  }

  const autoType = forceType === 'article' || forceType === 'event' || forceType === 'news'
    ? forceType
    : (Number(item.type) === 2 ? 'event' : 'news');
  const catMap: Record<string, string> = { '1': 'pc', '117': 'pharma' };
  const autoCategory = catMap[String(item.goodsCategoryId)] || fallbackCategory;

  // 新闻/文章必须有正文；活动允许正文为空（以时间/地点为主，后台可补）
  if (!contentHtml && autoType !== 'event') throw new Error('中文站正文内容为空，无法导入');

  // 图片本地化（正文 img + 列表封面 thumb）
  const uploadDir = path.resolve(__dirname, '../../uploads/articles');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const imgMap = new Map<string, string>();
  const downloadErrors: string[] = [];
  let seq = 0;

  const localize = async (rawSrc: string): Promise<string | null> => {
    const abs = /^https?:\/\//i.test(rawSrc) ? rawSrc : CN_ORIGIN + (rawSrc.startsWith('/') ? '' : '/') + rawSrc;
    if (!/^https?:\/\/./.test(abs)) return null;
    seq++;
    let base = '';
    try { base = decodeURIComponent(new URL(abs).pathname.split('/').pop() || ''); } catch { base = ''; }
    base = base.replace(/\.webp$/i, '').replace(/[^\w.\-]+/g, '_');
    if (!base || base.length > 80) base = `img_${Date.now()}_${seq}`;
    if (!/\.(jpe?g|png|gif|webp|svg)$/i.test(base)) base += '.webp';
    const fname = `${Date.now()}_${seq}_${base}`;
    try {
      await downloadFile(abs, path.join(uploadDir, fname));
      imgMap.set(rawSrc, `/uploads/articles/${fname}`);
      return `/uploads/articles/${fname}`;
    } catch (e: any) {
      downloadErrors.push(`${rawSrc}（${e.message}）`);
      return null;
    }
  };

  const allSrcs = [...new Set([...contentHtml.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]))];
  // 并发本地化（5 并发），缩短导入总耗时
  let cnCursor = 0;
  await Promise.all(Array.from({ length: Math.min(5, allSrcs.length) }, async () => {
    while (cnCursor < allSrcs.length) {
      await localize(allSrcs[cnCursor++]);
    }
  }));
  contentHtml = contentHtml.replace(/(<img[^>]*\ssrc=")([^"]+)(")/g, (full, p1, src: string, p3) => {
    const local = imgMap.get(src);
    return local ? p1 + local + p3 : full;
  });

  // 封面：中文站 thumb 优先，失败用正文第一张
  let imageUrl: string | null = null;
  if (item.thumb) imageUrl = await localize(String(item.thumb));
  if (!imageUrl) imageUrl = [...imgMap.values()][0] || null;

  // 日期：活动用活动开始时间，其余用记录创建时间
  const publishedDate = (autoType === 'event' && item.eventTime) ? new Date(item.eventTime) : (item.CreatedAt ? new Date(item.CreatedAt) : new Date());

  const created = await prisma.newsEvent.create({
    data: {
      type: autoType,
      category: autoCategory,
      title: String(item.title || ''),
      slug: 'cn-' + newsId,
      summary: item.summary ? String(item.summary) : null,
      contentHtml,
      imageUrl,
      publishedDate,
      isPublished: false,
      ...(autoType === 'event' ? {
        eventEndDate: item.eventEndTime ? new Date(item.eventEndTime) : null,
        location: item.eventAddress ? String(item.eventAddress) : null,
      } : {}),
    },
  });

  return {
    created,
    imagesDownloaded: imgMap.size,
    imagesTotal: allSrcs.length + (item.thumb ? 1 : 0),
    downloadErrors,
    autoType,
    autoCategory,
  };
}

/**
 * 原站文章导入器
 * 英文站 gattefosse.com：抓取文章页 → 解析 Drupal paragraphs → 图片本地化 → 存为草稿
 * 中文站 gattefossechina.cn：调详情接口取结构化中文数据 → 图片本地化 → 存为草稿
 */
export async function importArticleFromSite(req: Request, res: Response) {
  const { url, type: rawType, category: rawCategory } = req.body || {};
  if (!url || !/^https:\/\/([a-z0-9-]+\.)*(gattefosse\.com|gattefossechina\.cn)\//i.test(url)) {
    return res.status(400).json(fail('请提供 gattefosse.com 或 gattefossechina.cn 站点的文章链接'));
  }
  const allowedTypes = ['article', 'news', 'event'];
  const allowedCategories = ['corporate', 'pc', 'pharma'];
  const userType = String(rawType || '');
  const userSpecifiedType = allowedTypes.includes(userType);
  const importType = userSpecifiedType ? userType : 'article';
  const importCategory = allowedCategories.includes(String(rawCategory)) ? String(rawCategory) : 'pharma';

  // 中文站分支：结构化接口导入（类型/分类自动识别）
  if (/gattefossechina\.cn/i.test(url)) {
    try {
      const r = await importFromChinaSite(url, importCategory, userSpecifiedType ? userType : undefined);
      return res.json(success({
        item: r.created,
        imagesDownloaded: r.imagesDownloaded,
        imagesTotal: r.imagesTotal,
        downloadErrors: r.downloadErrors,
      }, `导入成功（中文站，识别为${{ news: '新闻', event: '活动', article: '文章' }[r.autoType] || r.autoType}·${{ corporate: '企业', pc: '个护', pharma: '药用' }[r.autoCategory] || r.autoCategory}），已保存为草稿`));
    } catch (e: any) {
      return res.status(400).json(fail('中文站导入失败：' + e.message));
    }
  }

  // 防重复导入：同一原站文章（slug 相同）只允许存在一条记录
  //（2026-09-09 用户反馈：校验清单弹出后再点「开始导入」会生成重复文章）
  const dupSlug = url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '';
  if (dupSlug) {
    const existing = await prisma.newsEvent.findFirst({
      where: { slug: dupSlug },
      select: { id: true, title: true, isPublished: true },
    });
    if (existing) {
      return res.status(400).json(fail(
        `该文章已导入过（ID=${existing.id}《${existing.title}》${existing.isPublished ? '，已发布' : '，草稿'}），请勿重复导入。如需重导请先删除旧记录。`
      ));
    }
  }

  // 1. 抓取页面
  let html: string;
  try {
    html = await fetchText(url);
  } catch (e: any) {
    return res.status(400).json(fail('抓取原站页面失败：' + e.message));
  }

  // 2. 解析头部信息
  const articleDiv = extractDivByClass(html, 'node--view-mode-full');
  if (!articleDiv) return res.status(400).json(fail('未在页面中找到文章主体（node--view-mode-full）'));

  const titleM = /<h1[^>]*s-article__title[^>]*>([\s\S]*?)<\/h1>/.exec(articleDiv);
  const title = titleM ? stripTags(titleM[1]) : '';
  if (!title) return res.status(400).json(fail('未找到文章标题'));

  // 日期：优先 <time datetime="..."> 精确时间戳，退回 "14 Aug 2026" 文本解析
  const timeAttrM = /<time[^>]*\bdatetime="([^"]+)"/.exec(articleDiv);
  const dateM = /class="c-card__date"[\s\S]*?>([\s\S]*?)</.exec(articleDiv);
  const publishedDate =
    (timeAttrM && !isNaN(Date.parse(timeAttrM[1])) && new Date(timeAttrM[1])) ||
    (dateM && parseSiteDate(dateM[1])) ||
    new Date();

  // 分类标题（s-article__category-title：News / Event / Article…）→ 自动推断类型
  const catTitleM = /s-article__category-title[^>]*>([\s\S]*?)</.exec(articleDiv);
  const categoryTitle = catTitleM ? stripTags(catTitleM[1]) : '';
  let finalType = importType;
  let typeAutoDetected = false;
  if (!userSpecifiedType && categoryTitle) {
    const cat = categoryTitle.toLowerCase();
    if (/event|show|trade|salon/.test(cat)) { finalType = 'event'; typeAutoDetected = true; }
    else if (/news|actualit/.test(cat)) { finalType = 'news'; typeAutoDetected = true; }
    else if (/article/.test(cat)) { finalType = 'article'; typeAutoDetected = true; }
  }
  // URL 路径兜底（无分类标题时）：/news/* → 新闻，/event/* → 活动
  if (!userSpecifiedType && !typeAutoDetected) {
    const lp = url.toLowerCase();
    if (/\/event/.test(lp)) { finalType = 'event'; typeAutoDetected = true; }
    else if (/\/news/.test(lp)) { finalType = 'news'; typeAutoDetected = true; }
  }

  const readingM = /Reading\s*:?\s*(\d+)\s*mn/i.exec(articleDiv);
  const readingTime = readingM ? parseInt(readingM[1], 10) : null;

  const authorNameM = /s-article__author-name[^>]*>([\s\S]*?)</.exec(articleDiv);
  const authorName = authorNameM ? stripTags(authorNameM[1]) : null;
  const authorPosteM = /s-article__author-poste[^>]*>([\s\S]*?)</.exec(articleDiv);
  const authorPoste = authorPosteM ? stripTags(authorPosteM[1]) : null;
  // 作者头像（s-article__author-img）：规则库「整标签匹配」定位——class 与 src 属性顺序不限
  //（原站两种写法都出现过：<img class="...author-img" src="..."> 和 <img src="..." class="...author-img">），
  // 相对路径按 R1 规则补全域名，并剥离 ?w= 等裁剪参数取原图
  const authorImgTag = findTagByClass(articleDiv, 'img', 's-article__author-img');
  const authorImgRawSrc = authorImgTag ? attrOfTag(authorImgTag, 'src') : null;
  let authorImgRaw = authorImgRawSrc ? stripImgParams(authorImgRawSrc) : '';
  if (authorImgRaw) authorImgRaw = absoluteUrl(authorImgRaw);
  // 主题标签（头部 s-article__data 内第一个 o-tag-list）
  const articleTags: string[] = [];
  const tagListM = /o-tag-list[^>]*>([\s\S]*?)<\/ul>/.exec(articleDiv);
  if (tagListM) {
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let liM: RegExpExecArray | null;
    while ((liM = liRe.exec(tagListM[1]))) {
      const t = stripTags(liM[1]).trim();
      if (t) articleTags.push(t);
    }
  }

  // 文章子类型：原站分类标题映射到前台子类型词表（Trends→灵感和趋势 等）
  let articleTypeZh: string | null = null;
  if (finalType === 'article' && categoryTitle) {
    const cat = categoryTitle.toLowerCase();
    if (/trend|inspir/.test(cat)) articleTypeZh = '灵感和趋势';
    else if (/application/i.test(cat)) articleTypeZh = '应用领域';
    else if (/expertise|science|knowledge/i.test(cat)) articleTypeZh = '专业知识';
    else if (/texture|formul/i.test(cat)) articleTypeZh = '质地与配方';
    else articleTypeZh = '其他';
  }

  // 原站主题标签 EN→CN（规则库映射；未命中保留英文并记录，便于后续补充映射）
  const unknownTags: string[] = [];
  const tagsZh = await translateArticleThemes(articleTags, unknownTags); // 字典优先，TAG_ZH 兜底

  // 导语（block-accroche）：位于 s-article__top-part、node__content 之外，需单独提取
  let accrocheText = '';
  const accrocheStart = articleDiv.indexOf('block-accroche');
  if (accrocheStart >= 0) {
    // 回退到该 class 所在 div 的开标签
    const divOpen = articleDiv.lastIndexOf('<div', accrocheStart);
    const accrocheDiv = divOpen >= 0 ? extractBalancedDiv(articleDiv, divOpen) : null;
    if (accrocheDiv) accrocheText = stripTags(accrocheDiv).trim();
  }

  // 3. 正文容器
  const contentStart = articleDiv.indexOf('<div class="node__content">');
  if (contentStart < 0) return res.status(400).json(fail('未找到正文容器（node__content）'));
  const contentDiv = extractBalancedDiv(articleDiv, contentStart);
  if (!contentDiv) return res.status(400).json(fail('正文容器解析失败'));
  const children = splitChildDivs(contentDiv);

  // 3.5 封面大图：page-top__image 的背景图（原站文章专用 banner 裁剪，1140×405）
  // 优先于正文首图——正文首图常是 6000px 原始大图，直接当列表封面会模糊/比例失衡
  const uploadDir = path.resolve(__dirname, '../../uploads/articles');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const downloadErrors: string[] = [];
  let seq = 0;
  let coverRaw = '';
  const bannerIdx = html.indexOf('page-top__image');
  if (bannerIdx >= 0) {
    const bgM = /background-image:\s*url\((['"]?)([^)'"]+)\1\)/.exec(html.slice(bannerIdx, bannerIdx + 1200));
    if (bgM) coverRaw = bgM[2].split('?')[0].trim();
  }
  let coverLocal = '';
  if (coverRaw) {
    const abs = absoluteUrl(coverRaw);
    if (/^https?:\/\/./.test(abs)) {
      seq++;
      let base = '';
      try { base = decodeURIComponent(new URL(abs).pathname.split('/').pop() || ''); } catch { base = ''; }
      base = base.replace(/\.webp$/i, '').replace(/[^\w.\-]+/g, '_');
      if (!base || base.length > 80) base = `cover_${Date.now()}_${seq}`;
      if (!/\.(jpe?g|png|gif|webp|svg)$/i.test(base)) base += '.webp';
      const fname = `${Date.now()}_${seq}_${base}`;
      try {
        await downloadFile(abs, path.join(uploadDir, fname));
        coverLocal = `/uploads/articles/${fname}`;
      } catch (e: any) {
        downloadErrors.push(`封面 ${coverRaw}（${e.message}）`);
      }
    }
  }

  // 3.7 列表缩略图（规则 R7）：优先取原站列表页卡片裁剪图（c-card__image > img.card__image），
  // 与详情页 banner 不是同一张图；banner 只做详情页头图（topBackground）。取不到时回退 banner。
  // ⚠️ 列表页地址必须从文章路径推导父目录（/pharmaceuticals/learn-more/xxx → /pharmaceuticals/learn-more），
  // 禁止写死 /personal-care/get-inspired——热点话题文章曾因写死列表页而全部回退正文首图（2026-09-09）
  let thumbLocal = '';
  let thumbSource: 'listing-card' | 'banner' | 'first-image' = 'first-image';
  try {
    let selfPathTmp = '';
    try { selfPathTmp = new URL(url).pathname; } catch { selfPathTmp = ''; }
    const listingCandidates: string[] = [];
    const segs = selfPathTmp.split('/').filter(Boolean);
    if (segs.length > 1) listingCandidates.push('/' + segs.slice(0, -1).join('/'));
    listingCandidates.push('/personal-care/get-inspired'); // 兼容：个护获取灵感历史入口
    let cardThumbRaw: string | null = null;
    let cardCategory: string | null = null;
    for (const cand of [...new Set(listingCandidates)]) {
      let listingHtml = '';
      try { listingHtml = await fetchText(SITE_ORIGIN + cand); } catch { continue; }
      cardThumbRaw = findCardThumbBySlug(listingHtml, selfPathTmp);
      cardCategory = findCardCategoryBySlug(listingHtml, selfPathTmp);
      if (cardThumbRaw || cardCategory) break;
    }
    // 卡片分类（如 "Lipids and polymers"）→ 中文主题标签；详情页无标签区时这是主题唯一来源
    if (cardCategory) {
      const catZh = await translateArticleTheme(cardCategory, unknownTags); // 字典优先
      if (!tagsZh.includes(catZh)) tagsZh.push(catZh);
    }
    if (cardThumbRaw) {
      seq++;
      let base = '';
      try { base = decodeURIComponent(new URL(cardThumbRaw).pathname.split('/').pop() || ''); } catch { base = ''; }
      base = base.replace(/\.webp$/i, '').replace(/[^\w.\-]+/g, '_');
      if (!base || base.length > 80) base = `thumb_${Date.now()}_${seq}`;
      if (!/\.(jpe?g|png|gif|webp|svg)$/i.test(base)) base += '.webp';
      const fname = `${Date.now()}_${seq}_${base}`;
      try {
        await downloadFile(cardThumbRaw, path.join(uploadDir, fname));
        thumbLocal = `/uploads/articles/${fname}`;
        thumbSource = 'listing-card';
      } catch (e: any) {
        downloadErrors.push(`列表缩略图 ${cardThumbRaw}（${e.message}）`);
      }
    }
  } catch { /* 列表页抓取失败不阻塞导入，回退 banner */ }
  if (!thumbLocal && coverLocal) thumbSource = 'banner';

  // 4. 图片收集与下载
  const imgMap = new Map<string, string>(); // 原始 src → 本地路径
  const widthMap = new Map<string, number>(); // 原始 src → 标记原始宽度（用于封面优选）

  const allSrcs: string[] = [];
  const imgRe = /<img[^>]*\ssrc="([^"]+)"[^>]*>/g;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(contentDiv)) !== null) {
    // 过滤追踪像素（width/height="1" 的 1×1 监测图）
    if (/\s(?:width|height)="1"/.test(im[0])) continue;
    allSrcs.push(im[1]);
    const wm = /\swidth="(\d{2,})"/.exec(im[0]);
    if (wm) widthMap.set(im[1], parseInt(wm[1], 10));
  }

  // 并发下载（5 并发）——串行下载多图常超过反代默认 60s 超时导致 nginx 返回 504 HTML 页
  const rawList = [...new Set(allSrcs)];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < rawList.length) {
      const rawSrc = rawList[cursor++];
      const abs = absoluteUrl(rawSrc);
      if (!/^https?:\/\/./.test(abs)) continue;
      // 跳过外部营销追踪图（1x1 之类）
      seq++;
      let base = '';
      try { base = decodeURIComponent(new URL(abs).pathname.split('/').pop() || ''); } catch { base = ''; }
      base = base.replace(/\.webp$/i, '').replace(/[^\w.\-]+/g, '_');
      if (!base || base.length > 80) base = `img_${Date.now()}_${seq}`;
      if (!/\.(jpe?g|png|gif|webp|svg)$/i.test(base)) base += '.webp';
      const fname = `${Date.now()}_${seq}_${base}`;
      try {
        await downloadFile(abs, path.join(uploadDir, fname));
        imgMap.set(rawSrc, `/uploads/articles/${fname}`);
      } catch (e: any) {
        downloadErrors.push(`${rawSrc}（${e.message}）`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, rawList.length) }, () => worker()));

  // 5. 逐区块转换
  const blocks: string[] = [];
  const skippedTypes = new Set<string>();
  const linkedContentBlocks: string[] = []; // 原站 Related content 区块（可能多个，不进正文，单独转卡片区块）

  // 本文自身的路径（用于把自引用链接改写为页内锚点）
  let selfPath = '';
  try { selfPath = new URL(url).pathname; } catch { selfPath = ''; }

  const rewrite = (frag: string): string => {
    let out = frag;
    // 图片本地化
    out = out.replace(/(<img[^>]*\ssrc=")([^"]+)(")/g, (full, p1, src, p3) => {
      const local = imgMap.get(src);
      return local ? p1 + local + p3 : full;
    });
    // 指向本文的链接 → 页内锚点
    if (selfPath) {
      out = out.replace(new RegExp('href="' + SITE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + selfPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(#[^"]*)?"', 'g'), 'href="$1"');
      out = out.replace(new RegExp('href="' + selfPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(#[^"]*)?"', 'g'), 'href="$1"');
    }
    // 站内链接绝对化（详情页跳转锚点除外）
    out = out.replace(/(href=")(\/[^"][^"]*)(")/g, (full, p1, href, p3) => {
      if (href.startsWith('/uploads/')) return full;
      return p1 + SITE_ORIGIN + href + p3;
    });
    return out;
  };

  // 提取区块内部 field__item / 指定子元素的 HTML
  function innerOfFieldItem(frag: string): string | null {
    const m = /field__item">([\s\S]*?)<\/div>\s*<\/div>\s*$/.exec(frag.trimEnd());
    if (m) return m[1];
    const m2 = /field__item">([\s\S]*)$/.exec(frag);
    if (m2) {
      // 宽松兜底：从 field__item 开始到结尾再去掉末尾闭合 div
      let inner = m2[1];
      inner = inner.replace(/<\/div>\s*$/,'');
      return inner;
    }
    return null;
  }

  for (const child of children) {
    const cls = getAttr(child, 'class') || '';

    // 嵌入表单（salesforce widget）跳过
    if (cls.includes('paragraph--type--widget') || cls.includes('salesforce')) {
      skippedTypes.add('嵌入表单(widget)');
      continue;
    }

    // 原站 Related content（linked-content）：解析为卡片区块，不进正文
    if (cls.includes('paragraph--type--linked-content')) {
      linkedContentBlocks.push(child);
      skippedTypes.add('相关内容(转独立卡片区块)');
      continue;
    }

    // 其余区块一律原样保留原站标记（.paragraph 包装层承载原站全部样式，
    // 拍平会导致 .paragraph h2 / .text-formatted 等选择器失配），仅重写图片与链接
    // 注意：纯图片区块（无文字）也要保留——stripTags 为空但含 <img>
    if (stripTags(child) || /<img/i.test(child)) blocks.push(rewrite(child));
  }

  let contentHtml = blocks.join('\n');
  if (!contentHtml) return res.status(400).json(fail('正文解析结果为空，请检查链接是否为文章详情页'));

  // 规则 R4：清洗原站自带的 bing 跳转脏链（解码还原真实地址）
  const cleaned = cleanBingLinks(contentHtml);
  contentHtml = cleaned.html;

  // 6. 摘要：优先使用原站导语（block-accroche）；无导语时退回第一段有效文本
  let summary = accrocheText.slice(0, 500);
  if (!summary) {
    for (const b of blocks) {
      const t = stripTags(b);
      if (t.length < 60) continue;
      if (/jump to a section/i.test(t)) continue;
      summary = t.slice(0, 160) + (t.length > 160 ? '…' : '');
      break;
    }
  }

  // 7. 封面兜底：按正文顺序取第一张成功本地化、原始宽度≥600 的图；
  // 无 banner 且无大图时退回第一张（并行下载完成顺序随机，不能按 imgMap 插入序取）
  let firstLocal: string | null = null;
  for (const s of allSrcs) {
    if (!imgMap.has(s)) continue;
    if (!firstLocal) firstLocal = imgMap.get(s) || null;
    if ((widthMap.get(s) || 0) >= 600) { firstLocal = imgMap.get(s) || null; break; }
  }

  // 8. 作者关联：按姓名匹配 authors 表，无则自动创建；头像从原站下载补齐
  let authorId: number | null = null;
  let authorBioPrefilled = false; // 库内已有职务/简介（后台编辑维护过），导入器不覆盖
  if (authorName) {
    // 去掉学位后缀（如 "Nick DiFranco, MEM" → "Nick DiFranco"）
    const coreName = authorName.split(',')[0].trim();
    // 下载作者头像到 /uploads/authors/
    let authorAvatar: string | null = null;
    if (authorImgRaw && /^https?:\/\/./.test(authorImgRaw)) {
      const authorDir = path.resolve(__dirname, '../../uploads/authors');
      if (!fs.existsSync(authorDir)) fs.mkdirSync(authorDir, { recursive: true });
      const extM = /\.(jpe?g|png|webp|gif)$/i.exec(authorImgRaw.split('/').pop() || '');
      const fname = `author_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extM ? extM[1] : 'jpg'}`;
      try {
        await downloadFile(authorImgRaw, path.join(authorDir, fname));
        authorAvatar = `/uploads/authors/${fname}`;
      } catch { /* 头像下载失败不阻塞导入 */ }
    }
    let author = await prisma.author.findFirst({
      where: { name: { equals: coreName } },
    });
    if (!author) {
      author = await prisma.author.create({
        data: { name: coreName, title: authorPoste || null, bio: authorPoste || null, avatar: authorAvatar, sortOrder: 99 },
      });
    } else {
      if (author.bio || author.title) authorBioPrefilled = true;
      const patch: any = {};
      if (authorPoste && !author.title) patch.title = authorPoste;
      if (authorPoste && !author.bio) patch.bio = authorPoste; // 详情页职务行显示 bio 字段
      if (authorAvatar && !author.avatar) patch.avatar = authorAvatar;
      if (Object.keys(patch).length) {
        author = await prisma.author.update({ where: { id: author.id }, data: patch });
      }
    }
    authorId = author.id;
  }

  // 9. 落库（草稿）；slug 清洗查询参数与锚点
  const slugBase = url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || null;
  const created = await prisma.newsEvent.create({
    data: {
      type: finalType,
      category: importCategory,
      title,
      slug: slugBase,
      summary: summary || null,
      contentHtml,
      imageUrl: thumbLocal || coverLocal || firstLocal,
      topBackground: coverLocal || null,
      readingTime,
      publishedDate,
      isPublished: false,
      authorId,
      authorName: authorName ? (authorPoste ? `${authorName}（${authorPoste}）` : authorName) : null,
      // 文章：自动补子类型与主题标签（保持与原站详情页一致）
      ...(finalType === 'article' && articleTypeZh ? { articleType: articleTypeZh } : {}),
      ...(finalType === 'article' && tagsZh.length ? { tags: JSON.stringify(tagsZh) } : {}),
    },
  });

  // 10. 相关内容卡片 → 独立区块（解析原站 linked-content，映射本站产品/配方）
  let relatedCount = 0;
  if (linkedContentBlocks.length) {
    try {
      const relatedCards = extractRelatedCards(linkedContentBlocks.join('\n'), imgMap);
      if (relatedCards.length > 0) {
        await resolveRelatedCards(relatedCards);
        await prisma.articleBlock.create({
          data: {
            articleId: created.id,
            blockType: 'product_cards',
            title: '相关内容',
            content: JSON.stringify({
              products: relatedCards.map(c => ({
                kind: c.kind,
                id: c.id || null,
                name: c.name,
                inciName: c.inciName || '',
                imageUrl: c.imageUrl || '',
                description: c.description || '',
                typeLabel: c.typeLabel,
                code: c.code || '',
                tags: c.tags || [],
              })),
            }),
            sortOrder: 0,
          },
        });
        relatedCount = relatedCards.length;
      }
    } catch (e: any) {
      console.error('解析 Related content 失败:', e.message);
    }
  }

  // 11. 第 2 层：导入后自动一致性校验（对照原站 HTML 逐项核对 + 自动修复）
  let verification: Awaited<ReturnType<typeof verifyImportedArticle>> = [];
  try {
    verification = await verifyImportedArticle(html, {
      id: created.id,
      title: created.title,
      summary: created.summary,
      contentHtml: created.contentHtml || '',
      imageUrl: created.imageUrl,
      authorId: created.authorId,
    }, { bioPrefilled: authorBioPrefilled });
  } catch (e: any) {
    console.error('导入校验异常:', e.message);
  }

  return res.json(success({
    item: created,
    imagesDownloaded: imgMap.size,
    imagesTotal: new Set(allSrcs).size,
    downloadErrors,
    skippedBlocks: [...skippedTypes],
    relatedCards: relatedCount,
    coverSource: coverLocal ? 'banner' : 'first-image',
    thumbSource,
    typeAutoDetected,
    cleanedLinks: cleaned.cleaned,
    unknownTags,
    verification,
  }, '导入成功，已保存为草稿'
    + (typeAutoDetected ? `（识别为${{ news: '新闻', event: '活动', article: '专栏文章' }[finalType]}）` : '')
    + (relatedCount ? `，相关内容 ${relatedCount} 张卡片已转独立区块` : '')
    + (thumbSource === 'listing-card' ? '，列表缩略图取自原站卡片' : (coverLocal ? '，缩略图回退banner（列表页未找到卡片图）' : ''))
    + (verification.length ? `，校验 ${verification.filter(v => v.ok).length}/${verification.length} 项通过` : '')));
}

/** 重新校验已导入文章：POST /news/:id/reverify */
export async function reverifyImportedArticle(req: Request, res: Response) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json(fail('缺少文章 ID'));
  try {
    const verification = await reverifyArticle(id);
    const pass = verification.filter(v => v.ok).length;
    return res.json(success({ verification, pass, total: verification.length },
      `校验完成：${pass}/${verification.length} 项通过`));
  } catch (e: any) {
    return res.status(400).json(fail('校验失败：' + e.message));
  }
}

// ==================== 翻译 Word 回填 ====================

/** 判断文本是否以中文为主 */
function isChineseText(t: string): boolean {
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk === 0) return false;
  return cjk / Math.max(1, t.replace(/\s/g, '').length) > 0.15;
}

/** 归一化文本用于匹配（去空白/标点/大小写/弯引号差异） */
function normalizeForMatch(t: string): string {
  return t
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d\u00b4`]/g, "'")
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/[\u00ae\u2122\u00a9]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

/**
 * PDF 文件名匹配键：取 basename、去扩展名、去本地化时加的 {fileId}_ 前缀、全小写。
 * 注意：历史回填的文件名可能被文件系统 255 字节上限截断（尾部 hash 丢失），
 * 因此匹配须用「前缀包含」而非全等——见 pdfCoreMatch。
 */
function pdfCore(p: string | null | undefined): string {
  if (!p) return '';
  let b = String(p).replace(/\\/g, '/').split('?')[0].split('#')[0];
  try { b = decodeURIComponent(b); } catch { /* 保留原样 */ }
  b = b.split('/').pop() || '';
  b = b.replace(/\.pdf$/i, '').replace(/^\d+_/, '');
  return b.toLowerCase();
}

/** PDF 核心名匹配：处理长文件名被截断的历史数据（一方是另一方的前缀即命中，短名要求全等避免误伤） */
function pdfCoreMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length < 20 || b.length < 20) return a === b;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** 限制落盘文件名长度（ext4 单文件名上限 255 字节，超长会被静默截断导致文件名对不上） */
function safePdfName(fname: string): string {
  if (fname.length <= 200) return fname;
  const m = fname.match(/(\.pdf)$/i);
  const cut = fname.slice(0, 200);
  return m ? cut.replace(/\.pdf$/i, '') + '.pdf' : cut;
}

interface DocxParagraph { text: string; }

/** 从 docx 二进制中按顺序提取全部段落文本（含表格单元格，保持文档顺序） */
export function extractDocxParagraphs(buf: Buffer): DocxParagraph[] {
  const zip = new AdmZip(buf);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('不是有效的 Word (.docx) 文件');
  const xml = entry.getData().toString('utf8');
  const paras: DocxParagraph[] = [];
  const re = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const body = m[1] || '';
    const texts = [...body.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(x => x[1]).join('');
    paras.push({ text: texts });
  }
  return paras;
}

/** 从双语对照段落序列构建 英文→中文 映射 */
function buildTranslationMap(paras: DocxParagraph[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < paras.length; i++) {
    const cur = paras[i].text.trim();
    if (!cur) continue;

    // 模式 A：单段内「英文... 中文...」混排（常见于表格单元格），按首个中文字符拆分
    const firstCjk = cur.search(/[\u4e00-\u9fff]/);
    if (firstCjk > 0) {
      const enPart = cur.slice(0, firstCjk).trim();
      const zhPart = cur.slice(firstCjk).trim();
      const key = normalizeForMatch(enPart);
      if (key.length >= 4 && isChineseText(zhPart) && !map.has(key)) map.set(key, zhPart);
    }

    // 模式 B：英文段落紧跟中文段落
    if (i < paras.length - 1) {
      const next = paras[i + 1].text.trim();
      if (!next) continue;
      if (isChineseText(cur) || !isChineseText(next)) continue;
      const key = normalizeForMatch(cur);
      if (key.length >= 6 && !map.has(key)) map.set(key, next);
    }
  }
  return map;
}

/** 在映射中查找翻译：先全文匹配，再前 40 字符前缀匹配 */
function lookupTranslation(map: Map<string, string>, text: string): null | string {
  const key = normalizeForMatch(text);
  if (!key) return null;
  if (map.has(key)) return map.get(key) || null;
  // 前缀匹配（Word 与网页文本常有尾注号/标点差异）
  if (key.length >= 40) {
    const prefix = key.slice(0, 40);
    for (const [k, v] of map) {
      if (k.startsWith(prefix) || key.startsWith(k.slice(0, 40))) return v;
    }
  }
  return null;
}

// ==================== 原站 Related content（linked-content）解析与映射 ====================

interface RelatedCard {
  kind: 'pc' | 'formulation' | 'external';
  id?: number;
  name: string;
  inciName?: string;
  imageUrl: string;
  description: string;
  typeLabel: string;
  code?: string;
  applicationTag?: string;
  tags: string[];
  href?: string;
}

/** 从 linked-content 区块 HTML 中解析原站相关内容卡片 */
function extractRelatedCards(linkedHtml: string, imgMap: Map<string, string>): RelatedCard[] {
  const cards: RelatedCard[] = [];
  const cardRe = /<div class="c-card c-card--bordered[^"]*"/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(linkedHtml)) !== null) starts.push(m.index);
  for (const start of starts) {
    const frag = extractBalancedDiv(linkedHtml, start);
    if (!frag) continue;
    const hrefM = /c-card__title-link"\s+href="([^"]+)"/.exec(frag);
    const titleM = /c-card__title-link[^>]*>([\s\S]*?)<\/a>/.exec(frag);
    const typeM = /c-card__breadcrumb[^>]*>\s*<li[^>]*>([\s\S]*?)<\/li>/.exec(frag);
    const codeM = /c-card__code[^>]*>([\s\S]*?)</.exec(frag);
    const sumM = /c-card__summary[^>]*>([\s\S]*?)<\/p>/.exec(frag);
    const tagArr = [...frag.matchAll(/c-card__tag-item[^>]*>([\s\S]*?)<\/li>/g)].map(x => stripTags(x[1]));
    const imgM = /<img[^>]*\ssrc="([^"]+)"/.exec(frag);
    const name = titleM ? stripTags(titleM[1]) : '';
    if (!name) continue;
    // 卡片图片：导入时已随正文统一下载，imgMap 里有本地路径
    const imgLocal = imgM ? (imgMap.get(imgM[1]) || imgMap.get(absoluteUrl(imgM[1])) || '') : '';
    cards.push({
      kind: 'external',
      name,
      imageUrl: imgLocal,
      description: sumM ? stripTags(sumM[1]) : '',
      typeLabel: typeM ? stripTags(typeM[1]) : 'Related',
      code: codeM ? stripTags(codeM[1]) : undefined,
      tags: tagArr,
      href: hrefM ? hrefM[1] : '',
    });
  }
  return cards;
}

/** 卡片映射本站数据：产品按 intlUrl 精确匹配，配方按 code / 归一化名称匹配；命中则替换为本站中文数据 */
async function resolveRelatedCards(cards: RelatedCard[]): Promise<void> {
  for (const c of cards) {
    const href = c.href || '';
    try {
      if (/product-finder/.test(href)) {
        const abs = href.startsWith('http') ? href : SITE_ORIGIN + href;
        const prod = await prisma.pcIngredient.findFirst({ where: { intlUrl: abs } });
        if (prod) {
          c.kind = 'pc';
          c.id = prod.id;
          c.name = prod.name;
          c.inciName = prod.inciName;
          if (prod.imageUrl) c.imageUrl = prod.imageUrl;
          if (prod.description) c.description = prod.description;
          c.applicationTag = prod.functionalityTag || '';
          continue;
        }
      }
      if (/formulation-finder/.test(href)) {
        let f: { id: number; name: string; code: string | null; imageUrl: string | null; description: string | null; applicationTag: string } | null = null;
        if (c.code) {
          f = await prisma.formulation.findFirst({ where: { code: c.code } });
        }
        if (!f) {
          const key = normalizeForMatch(c.name);
          if (key) {
            const all = await prisma.formulation.findMany({ take: 500 });
            f = all.find((x: any) => normalizeForMatch(x.name) === key) || null;
          }
        }
        if (f) {
          c.kind = 'formulation';
          c.id = f.id;
          c.name = f.name;
          if (f.imageUrl) c.imageUrl = f.imageUrl;
          if (f.description) c.description = f.description;
          c.applicationTag = f.applicationTag || '';
          continue;
        }
      }
    } catch {
      // 匹配异常时保留原站数据（external）
    }
  }
}

/** 单个元素内部 HTML 的纯文本 */
function elementText(inner: string): string {
  return inner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

/**
 * 应用翻译 Word：POST /api/news/:id/apply-docx（multer file 字段）
 * 以英文原稿 HTML 的文本元素为锚点，用双语对照 Word 中的中文逐段替换
 */
export async function applyDocxTranslation(req: Request, res: Response) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json(fail('缺少文章 ID'));
  if (!req.file) return res.status(400).json(fail('请选择要上传的翻译 Word 文档（.docx）'));

  const item = await prisma.newsEvent.findUnique({ where: { id } });
  if (!item) return res.status(404).json(fail('文章不存在'));
  if (!item.contentHtml) return res.status(400).json(fail('该文章没有正文内容，无法回填翻译'));

  // 1. 解析 Word，构建翻译映射
  let paras: DocxParagraph[];
  try {
    paras = extractDocxParagraphs(fs.readFileSync(req.file.path));
  } catch (e: any) {
    return res.status(400).json(fail('解析 Word 失败：' + e.message));
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* 临时文件清理失败可忽略 */ }
  }
  const map = buildTranslationMap(paras);
  if (map.size < 3) return res.status(400).json(fail('未在 Word 中找到「英文+中文」对照内容，请确认上传的是双语对照翻译稿'));

  let replaced = 0;
  const untranslated: string[] = [];

  // 2. 替换正文中的 h2/h3/p/li/td/th/span 文本元素
  let html = item.contentHtml;
  const elemRe = /<(h[23]|p|li|td|th|span)(?=[\s/>])((?:"[^"]*"|[^">])*)>([\s\S]*?)<\/\1>/g;
  html = html.replace(elemRe, (full, tag: string, attrs: string, inner: string) => {
    // 含图片/其他媒体或仅剩换行的元素不处理
    if (/<img|<video|<iframe/i.test(inner)) return full;
    const text = elementText(inner);
    if (!text || text.length < 2) return full;
    let zh = lookupTranslation(map, text);
    // 表格单元格整体未匹配时，按 <br>/块级子元素拆行逐行匹配
    if (!zh && (tag === 'td' || tag === 'th') && /<br|<(?:p|div|h\d)\b/i.test(inner)) {
      const parts = inner.split(/(<br\s*\/?>|<(?:p|div|h\d)\b[^>]*>[\s\S]*?<\/(?:p|div|h\d)>)/i);
      let changed = false;
      const newParts = parts.map((part: string) => {
        if (/^<br/i.test(part) || /^</.test(part)) return part;
        const t = part.trim();
        if (!t) return part;
        const z = lookupTranslation(map, t);
        if (z) { changed = true; return z; }
        return part;
      });
      if (changed) { replaced++; return `<${tag}${attrs}>${newParts.join('')}</${tag}>`; }
      zh = null;
    }
    if (zh) {
      replaced++;
      return `<${tag}${attrs}>${zh}</${tag}>`;
    }
    // 兜底：整体未匹配时，按内联标签/<br>边界拆分逐段匹配（处理"Key components:Labrasol®..."这类拼接段）
    if (text.length >= 8 && /[a-zA-Z]/.test(text) && /<(?:br|\/(?:span|em|strong|b|i|sup|sub|u))/.test(inner)) {
      const parts = inner.split(/(<br\s*\/?>|<\/?(?:span|em|strong|b|i|sup|sub|u|a)\b[^>]*>)/i);
      let changed = false;
      const newParts = parts.map((part: string) => {
        if (/^</.test(part)) return part;
        const t = part.trim();
        if (!t || t.length < 3 || isChineseText(t)) return part;
        const z = lookupTranslation(map, t);
        if (z) { changed = true; return part.replace(t, z); }
        return part;
      });
      if (changed) { replaced++; return `<${tag}${attrs}>${newParts.join('')}</${tag}>`; }
    }
    if (text.length >= 20 && !isChineseText(text) && !/^https?:/.test(text)) untranslated.push(text.slice(0, 60));
    return full;
  });

  // 3. 标题与摘要回填
  const zhTitle = lookupTranslation(map, item.title);

  const updateData: any = { contentHtml: html };
  if (zhTitle && isChineseText(zhTitle)) updateData.title = zhTitle;
  if (item.summary) {
    const zhSummary = lookupTranslation(map, item.summary);
    if (zhSummary && isChineseText(zhSummary)) updateData.summary = zhSummary;
  }

  await prisma.newsEvent.update({ where: { id }, data: updateData });

  return res.json(success({
    id,
    replaced,
    untranslated: untranslated.slice(0, 15),
    untranslatedCount: untranslated.length,
    titleUpdated: !!(zhTitle && isChineseText(zhTitle)),
    mapSize: map.size,
  }, `回填完成：替换 ${replaced} 段` + (untranslated.length ? `，${untranslated.length} 处未匹配（保留英文）` : '')));
}

// ==================================================================
// 出版物批量导入（原站出版物无详情页，从列表页逐卡抓取）
// POST /news/import-publications  body: { listUrl, maxPages }
// ==================================================================
export async function importPublicationsFromSite(req: Request, res: Response) {
  const rawUrl = String(req.body.listUrl || '');
  const maxPages = Math.min(30, Math.max(1, parseInt(req.body.maxPages) || 1));
  const listUrl = normalizeListUrl(rawUrl);
  if (!listUrl) {
    return res.status(400).json(fail('请提供原站出版物列表页链接（如 https://www.gattefosse.com/personal-care/get-inspired/publications）'));
  }
  const category = inferCategoryFromUrl(listUrl);
  const uploadDir = path.resolve(__dirname, '../../uploads/documents');
  fs.mkdirSync(uploadDir, { recursive: true });

  const items: { title: string; status: string; pdf: string; docId: number | null; message: string }[] = [];
  let imported = 0, skipped = 0, pages = 0, failed = 0;
  let pageUrl: string | null = listUrl;

  // 预载既有出版物做内存去重（跨语言：title / source_title 归一化 + PDF 核心名前缀 + 类型+出版物名+作者指纹）
  const existing = await prisma.newsEvent.findMany({
    where: { type: 'publication', category },
    select: { id: true, title: true, sourceTitle: true, pdfUrl: true, articleType: true, publicationName: true, authorName: true, isPublished: true },
  });
  const existTitleKeys = new Set<string>();
  const existCores: string[] = [];
  const existFp = new Set<string>();
  for (const r of existing) {
    for (const t of [r.title, r.sourceTitle]) {
      const k = t ? normalizeForMatch(t) : '';
      if (k) existTitleKeys.add(k);
    }
    const c = pdfCore(r.pdfUrl);
    if (c) existCores.push(c);
    const at = r.articleType || '', pn = r.publicationName || '', an = r.authorName || '';
    if (at || pn || an) existFp.add(normalizeForMatch(at) + '|' + normalizeForMatch(pn) + '|' + normalizeForMatch(an));
  }

  try {
    while (pageUrl && pages < maxPages) {
      let html: string;
      try {
        html = await fetchText(pageUrl);
      } catch (e: any) {
        items.push({ title: '第 ' + (pages + 1) + ' 页抓取失败', status: 'error', pdf: '', docId: null, message: e.message });
        failed++;
        break;
      }
      pages++;
      const cards = parsePublicationCards(html);
      if (!cards.length && pages === 1) {
        return res.status(400).json(fail('未在页面中解析到出版物卡片，请确认链接为原站出版物列表页'));
      }

      for (const card of cards) {
        // 字段完整性清单（原站无详情页可比对，校验=抓取完整性）
        const issues: string[] = [];
        if (!card.title) issues.push('❌ 未抓到标题');
        if (!card.pdfUrl) {
          // 原站部分出版物（多为 Scientific publication）无 PDF 下载入口，属正常，不算失败
          issues.push(card.pdfHasCta ? '❌ 有下载按钮但未抓到 PDF 链接' : '⚠️ 该出版物无 PDF（原站仅有摘要）');
        }
        else if (!/\.pdf(\?|$)/i.test(card.pdfUrl)) issues.push('⚠️ 下载链接不是 .pdf');
        if (!card.summary) issues.push('⚠️ 无摘要');
        if (!card.author) issues.push('⚠️ 无作者');
        if (!card.publishedDate) issues.push('⚠️ 日期解析失败');

        // 防重（内存匹配，跨语言稳定）：
        // ① 标题/source_title 归一化全等（source_title 存导入时英文原标题，AI 翻译不改）
        // ② PDF 核心名前缀匹配（历史本地化文件名可能被 255 字节截断）
        // ③ 类型+出版物名+作者指纹（忽略日期：新旧批次日期口径不同）
        const cardCore = pdfCore(card.pdfUrl);
        let dupRow: { id: number; isPublished: boolean } | null = null;
        const cardTitleKey = card.title ? normalizeForMatch(card.title) : '';
        if (cardTitleKey && existTitleKeys.has(cardTitleKey)) {
          dupRow = { id: -1, isPublished: true };
        } else if (cardCore && existCores.some((c) => pdfCoreMatch(c, cardCore))) {
          dupRow = { id: -1, isPublished: true };
        } else {
          const fpKey = normalizeForMatch(card.articleTypeZh || '') + '|' + normalizeForMatch(card.publicationName || '') + '|' + normalizeForMatch(card.author || '');
          if (fpKey !== '||' && existFp.has(fpKey)) dupRow = { id: -1, isPublished: true };
        }
        if (dupRow) {
          skipped++;
          items.push({ title: card.title || card.pdfBasename, status: 'skipped', pdf: '', docId: null, message: '已导入过，跳过' });
          continue;
        }
        if (issues.some((i) => i.startsWith('❌'))) failed++;

        // PDF 下载 → uploads/documents/，入文档资源（文件/文档资源已存在则复用，避免重复下载与重复入库）
        let pdfLocal = '', pdfSize: number | null = null, docId: number | null = null;
        if (card.pdfUrl) {
          const fname = safePdfName((card.pdfFileId ? card.pdfFileId + '_' : '') + (card.pdfBasename || ('publication_' + Date.now() + '.pdf')));
          const target = path.join(uploadDir, fname);
          pdfLocal = '/uploads/documents/' + fname;
          try {
            if (!fs.existsSync(target)) {
              await downloadFile(card.pdfUrl, target);
            }
            const st = fs.statSync(target);
            pdfSize = st.size;
            const existedDoc = await prisma.document.findFirst({ where: { filePath: pdfLocal }, select: { id: true } });
            if (existedDoc) {
              docId = existedDoc.id;
            } else {
              const doc = await prisma.document.create({
                data: {
                  title: card.title || card.pdfBasename,
                  type: 'Publication',
                  filePath: pdfLocal,
                  fileSize: BigInt(st.size),
                  language: 'en',
                  isPublic: true,
                  createdById: (req as any).userId || null,
                },
              });
              docId = doc.id;
            }
          } catch (e: any) {
            issues.push('⚠️ PDF 下载/入库失败：' + e.message);
          }
        }

        const created = await prisma.newsEvent.create({
          data: {
            type: 'publication',
            category,
            title: card.title || (card.pdfBasename || '').replace(/\.pdf$/i, ''),
            summary: card.summary || null,
            articleType: card.articleTypeZh || null,
            publicationName: card.publicationName || null,
            authorName: card.author || null,
            pdfUrl: pdfLocal || null,
            pdfSize,
            sourceTitle: card.title || null,
            publishedDate: card.publishedDate || new Date(),
            isPublished: false,
            createdById: (req as any).userId || null,
          },
          select: { id: true },
        });
        imported++;
        items.push({ title: card.title || card.pdfBasename, status: issues.some((i) => i.startsWith('❌')) ? 'partial' : 'ok', pdf: pdfLocal, docId, message: issues.length ? issues.join('；') : '字段齐全，PDF 已入文档资源' });
      }

      pageUrl = extractNextPageUrl(html, pageUrl);
    }

    const errCount = items.filter((i) => i.status === 'error' || i.status === 'partial').length;
    return res.json(success({
      imported, skipped, failed, pages, items,
      category,
    }, '导入完成：新增 ' + imported + ' 条、跳过 ' + skipped + ' 条（已导入过），共处理 ' + pages + ' 页' + (errCount ? '，' + errCount + ' 条存在缺项请查看清单' : '')));
  } catch (e: any) {
    return res.status(500).json(fail('出版物导入失败：' + e.message));
  }
}

// ==================================================================
// 存量出版物 PDF 本地化补抓（旧批次 pdfUrl 为原站绝对地址且无 pdfSize）
// POST /news/import-publications-backfill-pdfs
// ==================================================================
export async function backfillPublicationPdfs(req: Request, res: Response) {
  const uploadDir = path.resolve(__dirname, '../../uploads/documents');
  fs.mkdirSync(uploadDir, { recursive: true });

  const rows = await prisma.newsEvent.findMany({
    where: { type: 'publication', pdfUrl: { startsWith: 'http' } },
    select: { id: true, title: true, pdfUrl: true, pdfSize: true },
    orderBy: { id: 'asc' },
  });

  const items: { id: number; title: string; status: string; pdf: string; docId: number | null; message: string }[] = [];
  let downloaded = 0, reused = 0, failed = 0;

  for (const row of rows) {
    // 从原站 URL 取 fileId/basename：https://www.gattefosse.com/files/{fileId}/{basename}.pdf
    let fileId = '', basename = '';
    try {
      const u = new URL(row.pdfUrl!);
      const segs = u.pathname.split('/').filter(Boolean);
      basename = decodeURIComponent(segs[segs.length - 1] || '');
      const fi = segs.indexOf('files');
      if (fi >= 0 && segs[fi + 1]) fileId = segs[fi + 1];
    } catch { /* basename 保持空，走兜底名 */ }
    if (!/\.pdf$/i.test(basename)) basename = (basename || 'publication_' + row.id) + '.pdf';
    const fname = safePdfName((fileId ? fileId + '_' : '') + basename);
    const target = path.join(uploadDir, fname);
    const pdfLocal = '/uploads/documents/' + fname;

    try {
      let pdfSize: number;
      let docId: number | null = null;
      const existedDoc = await prisma.document.findFirst({ where: { filePath: pdfLocal }, select: { id: true } });
      let justDownloaded = false;
      if (fs.existsSync(target)) {
        // 文件已存在（本轮或此前已下载）：复用文件，不重复下载
        pdfSize = fs.statSync(target).size;
        reused++;
        if (existedDoc) docId = existedDoc.id;
      } else {
        await downloadFile(row.pdfUrl!, target);
        pdfSize = fs.statSync(target).size;
        downloaded++;
        justDownloaded = true;
      }
      if (!existedDoc) {
        const doc = await prisma.document.create({
          data: {
            title: row.title || basename,
            type: 'Publication',
            filePath: pdfLocal,
            fileSize: BigInt(pdfSize),
            language: 'en',
            isPublic: true,
            createdById: (req as any).userId || null,
          },
          select: { id: true },
        });
        docId = doc.id;
      }
      await prisma.newsEvent.update({ where: { id: row.id }, data: { pdfUrl: pdfLocal, pdfSize } });
      items.push({ id: row.id, title: (row.title || '').slice(0, 80), status: 'ok', pdf: pdfLocal, docId, message: justDownloaded ? '已下载并本地化' : '文件已存在，复用' });
    } catch (e: any) {
      failed++;
      items.push({ id: row.id, title: (row.title || '').slice(0, 80), status: 'error', pdf: '', docId: null, message: '❌ 下载失败（保留原链接）：' + e.message });
    }
  }

  return res.json(success(
    { total: rows.length, downloaded, reused, failed, items },
    '补抓完成：共 ' + rows.length + ' 条，新下载 ' + downloaded + '、复用 ' + reused + '、失败 ' + failed
  ));
}
