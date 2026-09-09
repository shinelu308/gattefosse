/**
 * 出版物导入解析模块（原站 gattefosse.com 出版物列表页）
 *
 * 原站出版物没有详情页——卡片即全部信息：
 *   div.c-card--pub > h3.c-card__title（标题）
 *                  + ul.c-card__breadcrumb > li.category（类型，英文原词）
 *                  + p.c-card__info > i（会议/出版物名）+ "&nbsp;- Jun 2026"（日期）
 *                  + p.c-card__author（作者）
 *                  + p.c-card__summary（摘要）
 *                  + .c-card__cta > a.btn[href=/files/{id}/{name}.pdf]（PDF 直链，按钮文字含大小）
 * 分页为 0 基页码：第一页无 page 参数，第二页 ?page=1（pager__item--next 的 href）
 *
 * 复用经验规则：R1 absoluteUrl 相对路径补全、整卡 extractBalancedDiv 定位
 */
import { fetchText, downloadFile, absoluteUrl, ORIGIN_BASE } from './import-rules';

// 与 news.controller.ts 的 PUB_TYPE_ZH 保持一致（类型中文化）
export const PUB_TYPE_ZH: Record<string, string> = {
  'ebook': '电子书',
  'Poster': '海报',
  'Scientific publication': '科技出版物',
  'Whitepaper': '白皮书',
  'Oral communication': '口头交流',
};

export function translatePubType(raw: string): string {
  const t = (raw || '').trim();
  return PUB_TYPE_ZH[t] || t;
}

export interface PubCard {
  title: string;
  articleTypeRaw: string;
  articleTypeZh: string;
  publicationName: string;
  dateText: string;
  publishedDate: Date | null;
  author: string;
  summary: string;
  pdfUrl: string;      // 绝对地址
  pdfHasCta: boolean;  // 卡片是否含下载按钮（原站部分出版物无 PDF，仅摘要）
  pdfFileId: string;   // /files/{id}/ 中的 id（可能为空）
  pdfBasename: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** "Jun 2026" / "June 2026" / "2026" → 当月15日的 Date；解析失败返回 null */
export function parsePubDate(text: string): Date | null {
  if (!text) return null;
  const t = text.trim();
  let m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon !== undefined) return new Date(parseInt(m[2]), mon, 15);
  }
  m = t.match(/^(\d{4})$/);
  if (m) return new Date(parseInt(m[1]), 0, 15);
  return null;
}

function stripTagsOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从列表页 HTML 解析全部出版物卡片 */
export function parsePublicationCards(listHtml: string): PubCard[] {
  const cards: PubCard[] = [];
  const MARK = '<div class="c-card c-card--bordered c-card--pub';
  let pos = listHtml.indexOf(MARK);
  while (pos >= 0) {
    // 平衡 div 提取整卡
    let depth = 0, i = pos, end = -1;
    while (i < listHtml.length) {
      const open = listHtml.indexOf('<div', i);
      const close = listHtml.indexOf('</div>', i);
      if (close < 0) break;
      if (open >= 0 && open < close) { depth++; i = open + 4; }
      else { depth--; i = close + 6; if (depth === 0) { end = close + 6; break; } }
    }
    const card = end > 0 ? listHtml.slice(pos, end) : listHtml.slice(pos, pos + 6000);

    const titleM = card.match(/<h3 class="c-card__title"[^>]*>([\s\S]*?)<\/h3>/);
    const catM = card.match(/<li class="category">([\s\S]*?)<\/li>/);
    const infoM = card.match(/<p class="c-card__info">([\s\S]*?)<\/p>/);
    const authorM = card.match(/<p class="c-card__author">([\s\S]*?)<\/p>/);
    const sumM = card.match(/<p class="c-card__summary">([\s\S]*?)<\/p>/);
    const pdfM = card.match(/<a class="btn btn-primary"[^>]*href="([^"]+)"[^>]*>/);

    const title = titleM ? stripTagsOf(titleM[1]) : '';
    let publicationName = '', dateText = '';
    if (infoM) {
      const iM = infoM[1].match(/<i class="u-text-defaultcase">([\s\S]*?)<\/i>/);
      publicationName = iM ? stripTagsOf(iM[1]) : '';
      // 日期在 </i>&nbsp;- 之后；剥掉 i 标签与所有标签后取末段日期
      const rest = stripTagsOf(infoM[1].replace(/<i[\s\S]*?<\/i>/, '')).replace(/^[-\s]+/, '');
      const dM = rest.match(/([A-Za-z]{3,9}\.?\s+\d{4})|(\d{4})/);
      if (dM) dateText = (dM[1] || dM[2]).trim();
    }
    const pdfHref = pdfM ? pdfM[1].trim() : '';
    const pdfHasCta = card.includes('c-card__cta');

    if (title || pdfHref) {
      const idM = pdfHref.match(/\/files\/(\d+)\//);
      const base = pdfHref.split('?')[0].split('/').pop() || '';
      cards.push({
        title,
        articleTypeRaw: catM ? stripTagsOf(catM[1]) : '',
        articleTypeZh: translatePubType(catM ? stripTagsOf(catM[1]) : ''),
        publicationName,
        dateText,
        publishedDate: parsePubDate(dateText),
        author: authorM ? stripTagsOf(authorM[1]) : '',
        summary: sumM ? stripTagsOf(sumM[1]) : '',
        pdfUrl: pdfHref ? absoluteUrl(pdfHref) : '',
        pdfHasCta,
        pdfFileId: idM ? idM[1] : '',
        pdfBasename: base,
      });
    }
    if (end < 0) break;
    pos = listHtml.indexOf(MARK, end);
  }
  return cards;
}

/** 取当前列表页 pager 的下一页完整 URL（0 基页码），无下一页返回 null */
export function extractNextPageUrl(listHtml: string, pageUrl: string): string | null {
  const m = listHtml.match(/<li class="pager__item pager__item--next">\s*<a href="([^"]*)"/);
  if (!m) return null;
  const href = m[1].trim();
  if (!href || href === '#') return null;
  // absoluteUrl 基于 pageUrl 解析，保留路径与其他 query 参数
  try {
    const u = new URL(href, pageUrl);
    return u.toString();
  } catch {
    return null;
  }
}

/** 从列表页 URL 推导业务分类（R7 精神：从路径推导，禁止写死） */
export function inferCategoryFromUrl(listUrl: string): 'pc' | 'pharma' {
  return /\/pharmaceuticals\//.test(listUrl) ? 'pharma' : 'pc';
}

/** 规范化列表页 URL：相对路径补 ORIGIN_BASE，必须是原站出版物路径 */
export function normalizeListUrl(raw: string): string | null {
  if (!raw) return null;
  let u = raw.trim();
  if (u.startsWith('/')) u = ORIGIN_BASE + u;
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.hostname !== 'www.gattefosse.com') return null;
    if (!/\/publications/.test(parsed.pathname)) return null;
    return u;
  } catch {
    return null;
  }
}

export { fetchText, downloadFile };
