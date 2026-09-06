import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { config } from '../config';

const SITE_ORIGIN = 'https://www.gattefosse.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 下载远程文件到本地（带 UA，跟随跳转） */
function downloadFile(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('重定向次数过多'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadFile(next, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

/** 从 HTML 中截取一段平衡 div（从 start 处的 <div 到与之配对的 </div>），返回完整片段 */
function extractBalancedDiv(html: string, start: number): string | null {
  const openM = /^<div[\s>]/.exec(html.slice(start, start + 6));
  if (!openM) return null;
  let depth = 0;
  const re = /<div[\s>]|<\/div>/g;
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0] === '</div>') depth--;
    else depth++;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return null;
}

/** 找到某 class 首次出现的元素所在的平衡 div 片段 */
function extractDivByClass(html: string, className: string): string | null {
  const idx = html.indexOf(className);
  if (idx < 0) return null;
  // 从 class 位置向前找最近的 <div
  const divStart = html.lastIndexOf('<div', idx);
  if (divStart < 0) return null;
  return extractBalancedDiv(html, divStart);
}

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

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
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

/** 绝对化原站 URL */
function absoluteUrl(src: string): string {
  if (/^https?:\/\//.test(src)) return src;
  return SITE_ORIGIN + (src.startsWith('/') ? '' : '/') + src;
}

/**
 * 原站文章导入器
 * 抓取 gattefosse.com 文章页 → 解析 Drupal paragraphs → 图片本地化 → 存为草稿
 */
export async function importArticleFromSite(req: Request, res: Response) {
  const { url } = req.body || {};
  if (!url || !/^https:\/\/([a-z0-9-]+\.)*gattefosse\.com\//i.test(url)) {
    return res.status(400).json(fail('请提供 gattefosse.com 站点的文章链接'));
  }

  // 1. 抓取页面
  let html: string;
  try {
    html = await new Promise<string>((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req2 = mod.get(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 30000,
      }, (r) => {
        if (r.statusCode !== 200) { r.resume(); return reject(new Error(`原站返回 HTTP ${r.statusCode}`)); }
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c) => { data += c; });
        r.on('end', () => resolve(data));
        r.on('error', reject);
      });
      req2.on('timeout', () => req2.destroy(new Error('抓取超时')));
      req2.on('error', reject);
    });
  } catch (e: any) {
    return res.status(400).json(fail('抓取原站页面失败：' + e.message));
  }

  // 2. 解析头部信息
  const articleDiv = extractDivByClass(html, 'node--view-mode-full');
  if (!articleDiv) return res.status(400).json(fail('未在页面中找到文章主体（node--view-mode-full）'));

  const titleM = /<h1[^>]*s-article__title[^>]*>([\s\S]*?)<\/h1>/.exec(articleDiv);
  const title = titleM ? stripTags(titleM[1]) : '';
  if (!title) return res.status(400).json(fail('未找到文章标题'));

  const dateM = /class="c-card__date"[\s\S]*?>([\s\S]*?)</.exec(articleDiv);
  const publishedDate = (dateM && parseSiteDate(dateM[1])) || new Date();

  const readingM = /Reading\s*:?\s*(\d+)\s*mn/i.exec(articleDiv);
  const readingTime = readingM ? parseInt(readingM[1], 10) : null;

  const authorNameM = /s-article__author-name[^>]*>([\s\S]*?)</.exec(articleDiv);
  const authorName = authorNameM ? stripTags(authorNameM[1]) : null;
  const authorPosteM = /s-article__author-poste[^>]*>([\s\S]*?)</.exec(articleDiv);
  const authorPoste = authorPosteM ? stripTags(authorPosteM[1]) : null;

  // 3. 正文容器
  const contentStart = articleDiv.indexOf('<div class="node__content">');
  if (contentStart < 0) return res.status(400).json(fail('未找到正文容器（node__content）'));
  const contentDiv = extractBalancedDiv(articleDiv, contentStart);
  if (!contentDiv) return res.status(400).json(fail('正文容器解析失败'));
  const children = splitChildDivs(contentDiv);

  // 4. 图片收集与下载
  const imgMap = new Map<string, string>(); // 原始 src → 本地路径
  const uploadDir = path.resolve(__dirname, '../../uploads/articles');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const allSrcs: string[] = [];
  const imgRe = /<img[^>]*\ssrc="([^"]+)"/g;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(contentDiv)) !== null) allSrcs.push(im[1]);

  const downloadErrors: string[] = [];
  let seq = 0;
  for (const rawSrc of [...new Set(allSrcs)]) {
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

  // 5. 逐区块转换
  const blocks: string[] = [];
  const skippedTypes = new Set<string>();

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

    if (cls.includes('paragraph--type--titre-h2')) {
      const inner = /<h\d[^>]*>([\s\S]*?)<\/h\d>/.exec(child);
      if (inner) blocks.push(`<h2>${inner[1].trim()}</h2>`);
    } else if (cls.includes('paragraph--type--titre-h3')) {
      const inner = /<h\d[^>]*>([\s\S]*?)<\/h\d>/.exec(child);
      if (inner) blocks.push(`<h3>${inner[1].trim()}</h3>`);
    } else if (cls.includes('paragraph--type--image')) {
      const srcM = /<img[^>]*\ssrc="([^"]+)"/.exec(child);
      if (srcM) {
        const local = imgMap.get(srcM[1]) || absoluteUrl(srcM[1]);
        blocks.push(`<p><a href="${local}"><img src="${local}" style="max-width:100%;"></a></p>`);
      }
    } else if (cls.includes('paragraph--type--widget') || cls.includes('salesforce')) {
      skippedTypes.add('嵌入表单(widget)');
    } else if (cls.includes('s-zone') && cls.includes('zone-')) {
      // 多栏区块：拆出其中的图片 → 横排表格；其中的 texte-encadre → 保留
      const imgs: string[] = [];
      const imgRe2 = /<img[^>]*\ssrc="([^"]+)"/g;
      let im2: RegExpExecArray | null;
      while ((im2 = imgRe2.exec(child)) !== null) imgs.push(im2[1]);
      if (imgs.length >= 2) {
        const tds = imgs.map((src) => {
          const local = imgMap.get(src) || absoluteUrl(src);
          return `            <td><a href="${local}"><img src="${local}" style="max-width:100%;"></a></td>\n`;
        }).join('');
        blocks.push(`<table class="adp-img-table">\n<tbody>\n<tr>\n${tds}        </tr>\n</tbody>\n</table>`);
      } else if (imgs.length === 1) {
        const local = imgMap.get(imgs[0]) || absoluteUrl(imgs[0]);
        blocks.push(`<p><a href="${local}"><img src="${local}" style="max-width:100%;"></a></p>`);
      }
      // 栏内的文字/跳转框（如 Jump to a section）按 texte-encadre 保留
      for (const sub of splitChildDivs(child)) {
        const subCls = getAttr(sub, 'class') || '';
        if (subCls.includes('paragraph--type--texte-encadre')) {
          const inner = innerOfFieldItem(sub);
          if (inner && stripTags(inner)) blocks.push(`<div class="paragraph--type--texte-encadre"><div class="field__item">${rewrite(inner)}</div></div>`);
        }
      }
    } else if (cls.includes('paragraph--type--texte-encadre')) {
      const inner = innerOfFieldItem(child);
      if (inner && stripTags(inner)) blocks.push(`<div class="paragraph--type--texte-encadre"><div class="field__item">${rewrite(inner)}</div></div>`);
    } else if (cls.includes('paragraph--type--highlighted-block')) {
      blocks.push(rewrite(child));
    } else if (cls.includes('paragraph--type--texte') || /paragraph--type--(list|table|video)/.test(cls)) {
      const inner = innerOfFieldItem(child);
      if (inner && stripTags(inner)) blocks.push(rewrite(inner));
    } else if (cls.trim() === '' || cls.includes('paragraph')) {
      // 其他未知段落：保底提取纯 HTML
      const inner = innerOfFieldItem(child) || child;
      if (stripTags(inner)) blocks.push(rewrite(inner));
    }
  }

  const contentHtml = blocks.join('\n');
  if (!contentHtml) return res.status(400).json(fail('正文解析结果为空，请检查链接是否为文章详情页'));

  // 6. 摘要：第一段有效文本（跳过导航跳转框、表格、纯标题）
  let summary = '';
  for (const b of blocks) {
    const t = stripTags(b);
    if (t.length < 60) continue;
    if (/jump to a section/i.test(t)) continue;
    summary = t.slice(0, 160) + (t.length > 160 ? '…' : '');
    break;
  }

  // 7. 封面图：第一张本地化的正文图
  const firstLocal = [...imgMap.values()][0] || null;

  // 8. 落库（草稿）
  const slugBase = url.split('/').filter(Boolean).pop() || null;
  const created = await prisma.newsEvent.create({
    data: {
      type: 'article',
      category: 'pharma',
      title,
      slug: slugBase,
      summary: summary || null,
      contentHtml,
      imageUrl: firstLocal,
      readingTime,
      publishedDate,
      isPublished: false,
      authorName: authorName ? (authorPoste ? `${authorName}（${authorPoste}）` : authorName) : null,
    },
  });

  return res.json(success({
    item: created,
    imagesDownloaded: imgMap.size,
    imagesTotal: new Set(allSrcs).size,
    downloadErrors,
    skippedBlocks: [...skippedTypes],
  }, '导入成功，已保存为草稿'));
}
