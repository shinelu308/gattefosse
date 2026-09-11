/**
 * 原站抓取经验规则库（第 1 层：规则资产）
 * 目的：把历史踩过的坑固化为可维护、可复用的规则，确保抓取内容与原站一致。
 * 每条规则来自真实事故，注释标明出处，后续遇到新坑继续在此沉淀。
 */
import fs from 'fs';
import https from 'https';
import http from 'http';


/** 英文原站域名 */
export const ORIGIN_BASE = 'https://www.gattefosse.com';
/** 中文站域名 */
export const CN_BASE = 'https://www.gattefossechina.cn';

/** 抓取 UA（原站对无 UA 请求可能返回 403） */
export const SCRAPER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 下载远程文件到本地（带 UA，跟随跳转，最多 5 次重定向） */
export function downloadFile(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('重定向次数过多'));
    const mod: typeof http = url.startsWith('https') ? (https as unknown as typeof http) : http;
    const req = mod.get(url, { headers: { 'User-Agent': SCRAPER_UA, Accept: '*/*' }, timeout: 30000 }, (res) => {
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

/** 获取远程文本（HTML 抓取复用） */
export function fetchText(target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod: typeof http = target.startsWith('https') ? (https as unknown as typeof http) : http;
    const req = mod.get(target, {
      headers: { 'User-Agent': SCRAPER_UA, Accept: 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 30000,
    }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(`HTTP ${r.statusCode}: ${target}`)); }
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => { data += c; });
      r.on('end', () => resolve(data));
      r.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

// ==================== 原站 HTML 解析工具集 ====================

/** 去标签取纯文本 */
export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 文本归一化（去空白/标点/大小写差异），用于原站与导入内容一致性比对 */
export function normalizeForCompare(t: string): string {
  return t.toLowerCase().replace(/[\u2018\u2019\u201c\u201d\u00b4`]/g, "'").replace(/[\u2013\u2014\u2015]/g, '-').replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

/** 从 HTML 中截取一段平衡 div（从 start 处的 <div 到与之配对的 </div>） */
export function extractBalancedDiv(html: string, start: number): string | null {
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
export function extractDivByClass(html: string, className: string): string | null {
  const idx = html.indexOf(className);
  if (idx < 0) return null;
  const divStart = html.lastIndexOf('<div', idx);
  if (divStart < 0) return null;
  return extractBalancedDiv(html, divStart);
}

/**
 * 规则 R1：相对 URL 自动补全域名
 * 出处：作者头像 src="/sites/default/files/..." 是相对路径，直接下载 404（2026-09-09）
 */
export function absoluteUrl(raw: string, base: string = ORIGIN_BASE): string {
  if (!raw) return '';
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(data|blob|javascript|mailto):/i.test(s)) return '';
  return base + (s.startsWith('/') ? '' : '/') + s;
}

/**
 * 规则 R2：元素定位一律「整标签匹配」，class 与 src/属性顺序无关
 * 出处：原站 img 标签存在两种写法 <img class=".." src=".."> 和 <img src=".." class="..">，
 * 用 "class...src" 固定顺序的正则会漏抓（2026-09-09 作者头像丢失）
 * 返回匹配的完整 <img> 标签字符串（可能含换行）
 */
export function findTagByClass(html: string, tag: string, className: string): string | null {
  const re = new RegExp('<' + tag + '[^>]*\\b' + className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[^>]*>', 'i');
  const m = re.exec(html);
  return m ? m[0] : null;
}

/** 从整标签字符串中提取某属性值 */
export function attrOfTag(tagHtml: string, attr: string): string | null {
  const m = new RegExp('\\b' + attr + '="([^"]*)"').exec(tagHtml);
  return m ? m[1] : null;
}

/**
 * 剔除指定类型的 Drupal paragraph 区块（整个平衡 div，含内部嵌套内容）
 * 用于结构比对前剥离 widget / linked-content 等导入时不进正文的区块
 * ⚠️ 2026-09-11 稳健化：从 type 字样反查所在 div 开标签（class 里含该 type 才算命中），
 * 不再要求块 class 以 "paragraph" 开头（c-video--remote paragraph paragraph--type--xxx 也能正确整块剔除）
 */
export function removeParagraphBlocks(html: string, types: string[]): string {
  for (const t of types) {
    let idx: number;
    let guard = 0;
    while ((idx = html.indexOf('paragraph--type--' + t)) >= 0 && guard++ < 50) {
      const start = findOwningDivOpen(html, idx, 'paragraph--type--' + t);
      if (start < 0) break;
      const frag = extractBalancedDiv(html, start);
      if (!frag) break;
      html = html.slice(0, start) + html.slice(start + frag.length);
    }
  }
  return html;
}

/** 从 pos 位置反查「开标签 class 中含 token」的最近 <div 开标签；找不到返回 -1 */
function findOwningDivOpen(html: string, pos: number, token: string): number {
  let from = pos;
  while (from >= 0) {
    const open = html.lastIndexOf('<div', from);
    if (open < 0) return -1;
    const tagEnd = html.indexOf('>', open);
    if (tagEnd >= pos) {
      // pos 落在该开标签内部 → 它就是承载 token 的开标签
      if (html.slice(open, tagEnd + 1).includes(token)) return open;
      return -1;
    }
    if (html.slice(open, tagEnd + 1).includes(token)) return open;
    from = open - 1;
  }
  return -1;
}

/**
 * 规则 R3：图片地址清洗——剥离 ?w= / ?h= / ?itok= 等裁剪参数（ Drupal image style 参数）
 * 注意：仅用于取「原图」时；列表缩略图反而要保留 ?w= 参数以拿小图。
 */
export function stripImgParams(src: string): string {
  return src.split('?')[0].trim();
}

/**
 * 规则 R4：脏链清洗——原站正文中存在 bing.com/ck/a 跳转链接（原站自己的 SEO 行为），
 * 形如 https://www.bing.com/ck/a?!&&p=...&u=a1AHR0cHM6Ly...&ntb=1
 * u 参数 = 'a1' + 真实 URL 的 base64（URL-safe：-→+ _→/，去尾部 padding）
 * 出处：Noxifense 文章外链（2026-09-09 排查确认是原站自身 HTML 所带，非导入问题）
 */
export function decodeBingRedirect(url: string): string | null {
  try {
    // ⚠️ 原站 href 里的 & 是 HTML 实体 &amp;，直接 new URL 会把 amp; 当参数名导致 u 参数丢失（2026-09-09）
    const cleaned = url.replace(/&amp;/gi, '&');
    const u = new URL(cleaned);
    if (!/(^|\.)bing\.com$/i.test(u.hostname) || !/^\/ck\/a$/i.test(u.pathname)) return null;
    let raw = u.searchParams.get('u') || '';
    if (!raw.startsWith('a1')) {
      // 兜底：直接从字符串截取 u=a1<base64>
      const m = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(cleaned);
      if (m) raw = 'a1' + m[1];
    }
    if (!raw.startsWith('a1')) return null;
    let b64 = raw.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
}

export interface CleanLinksResult {
  html: string;
  cleaned: Array<{ from: string; to: string }>;
}

/**
 * 规则 R4 应用：把正文里所有 bing 跳转链接替换为解码后的真实地址
 * 覆盖 href="..."（a 标签）；清洗失败的链接原样保留
 */
export function cleanBingLinks(html: string): CleanLinksResult {
  const cleaned: CleanLinksResult['cleaned'] = [];
  const out = html.replace(/href="(https?:\/\/[^"]*bing\.com\/ck\/a[^"]*)"/gi, (full, href: string) => {
    const real = decodeBingRedirect(href);
    if (real && real !== href) {
      cleaned.push({ from: href.slice(0, 120), to: real });
      return 'href="' + real.replace(/&/g, '&amp;') + '"';
    }
    return full;
  });
  return { html: out, cleaned };
}

/**
 * 规则 R5：原站主题标签 EN→CN 映射（未命中保留英文）
 * 出处：导入文章标签需中文化，与前台标签词表一致（2026-09 起）
 */
export const TAG_ZH: Record<string, string> = {
  'actives': '活性成分', 'aging': '抗老化', 'skin biology': '皮肤生物学', 'inspiration': '灵感',
  'formulation': '配方', 'efficacy': '功效', 'sensory': '感官', 'texture': '质地', 'textures': '质地',
  'sustainability': '可持续', 'microbiome': '微生态', 'wellness': '健康', 'sun care': '防晒',
  'hair care': '洗护发', 'color cosmetics': '彩妆', 'emulsifiers': '乳化剂', 'soft focus': '柔焦',
  'repair': '修护', 'soothing': '舒缓', 'moisturizing': '保湿', 'anti-pollution': '抗污染',
  'biotech': '生物科技', 'clean beauty': '纯净美妆', 'blue beauty': '蓝色美妆', 'slower beauty': '慢美妆',
  'skin longevity': '皮肤长寿', 'longevity': '长寿', 'resilience': '韧性', 'beauty': '美妆',
  'self-care': '自我护理', 'circular economy': '循环经济', 'upcycling': '升级回收',
  'natural origin': '天然来源', 'naturality': '自然性', 'preservation': '防腐',
  // 药用板块（pharma）主题词：来自列表页卡片分类与 Themes facet（2026-09-09 补）
  'lipids and polymers': '脂质与聚合物', 'lipid-based formulations': '脂质制剂',
  'liquid-based formulations': '液体制剂', 'animal health': '动物健康', 'cannabinoids': '大麻素',
  'hot melt extrusion': '热熔挤出', 'intestinal permeation enhancers': '肠道渗透促进剂',
  'oral drug delivery': '口服给药', 'lipid-based drug delivery': '脂质给药',
};

/**
 * 规则 R5 应用：标签翻译 + 未命中词自动记录（沉淀到未知标签清单，便于人工补充映射）
 */
export function translateTag(tag: string, unknownSink?: string[]): string {
  const hit = TAG_ZH[tag.toLowerCase().trim()];
  if (hit) return hit;
  if (unknownSink && /[\u4e00-\u9fff]/.test(tag) === false && unknownSink.indexOf(tag) < 0) unknownSink.push(tag);
  return tag;
}

/**
 * 规则 R6：结构签名——提取正文区块类型序列，用于导入前后一致性校验（第 2 层使用）
 * 签名格式如 "titre-h2>texte>image>titre-h3>zone-size>texte"
 * 忽略空白差异，只看 Drupal paragraph 类型 + 图片顺序
 * ⚠️ 2026-09-11（haute-couture 事故）：正则不要求 class 属性以 paragraph 开头——
 * video-remote 等区块输出 class="c-video c-video--remote paragraph paragraph--type--video-remote"，
 * 旧正则 class="paragraph\s+ 抓不到，导致视频区块从签名中隐身，导入器把它丢了校验器也发现不了
 */
export function structureSignature(html: string): string {
  const parts: string[] = [];
  const re = /paragraph--type--([a-z0-9_-]+)|<img[^>]*\ssrc="/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0].toLowerCase().startsWith('<img')) {
      // 连续图片折叠为单个 image 标记
      if (parts[parts.length - 1] !== 'img') parts.push('img');
    } else {
      // 同一块 class 双写类型名（如 linked-content paragraph--type--linked-content ... 重复两次）折叠为一个
      if (parts[parts.length - 1] !== m[1]) parts.push(m[1]);
    }
  }
  return parts.join('>');
}

/**
 * 规则 R7：列表缩略图取原站列表页的卡片裁剪图，不是详情页 banner
 * 出处：详情页 page-top__image banner 是 1140×405 头图；列表页卡片用的是另一张
 * Drupal image style 裁剪图（styles/publication_card 或 styles/card，369×208），
 * 位于卡片 c-card__image > img.card__image（部分列表页外层包装类名不同，如 prov__image，
 * 因此以 img 自身的 card__image class 为锚，遵循 R2 整标签匹配）
 * 2026-09-09 用户指认缩略图抓取位置后固化
 * ⚠️ 2026-09-09 二次事故：列表页 URL 禁止写死 /personal-care/get-inspired——热点话题
 * （/pharmaceuticals/learn-more/xxx）文章全部回退正文首图。必须从文章路径推导父目录
 * （候选：父目录 → get-inspired 兜底）；reverify 时末段 slug 用 sitemap.xml 定位完整路径
 */
/**
 * 规则 R8：渲染样式一致性清单（导入 + AI 翻译后，页面必须与原站逐项一致）
 * 出处：2026-09-09 连环事故（h2 字体/h1 字重/内链颜色/按钮文字/下划线），全部为
 * 「原站各页 CSS 聚合不同、本地包缺失对应规则」导致，修复值均为原站 getComputedStyle 实测。
 * 校验工具：scripts/compare-article.js（双页截图 + 计算样式逐元素对比，含按钮/链接颜色维度）。
 * 以后发现新的样式偏差，先实测原站值 → 补进共享 CSS → 同步更新本清单。
 *
 * ⚠️ 全局同步机制（2026-09-09 二次事故后确立）：渲染修复样式已从各页 <style> 抽出为共享文件
 *    /static/css/article-render-260909.css（单一来源）。所有渲染导入内容的详情页
 *    （personal-care-article-detail / pharmaceuticals-article-detail / news-detail …）
 *    统一 <link> 引用，禁止再在页面内复制规则；修改样式只改共享文件。
 *    ⚠️ 文件名带日期（宝塔对静态资源缓存激进）：修改内容后必须改名并同步所有引用页。
 *    新增渲染导入内容的页面时必须引用该文件，否则必复发链接变绿/横线/字重类事故。
 *    事故模式：修复只落在某一个详情页（如 PC 文章页），新闻详情页 news-detail.html 没有 →
 *    导入新闻后链接绿色、摘要带上下边框渲染在底部（「两条横线」）、缺 meta 行。
 *    news-detail.html 已重构为原站 s-article 布局（meta 行+大标题+导语在顶部，正文容器
 *    挂 .node__content.adp-content）。
 *
 * 1. h1 标题：Din Next Slab Pro Bold 48px / weight 400（Slab Pro 族本身是 Bold，weight 必须 400，
 *    浏览器默认 700 会加粗过度）
 * 2. 正文 h2（.s-article .adp-content h2）：40px / weight 400 / 品红 #C4004D，行高 48px
 *    ⚠️ 选择器必须用容器级 .adp-content h2——s-zone 布局的 h2 直接挂在 s-zone 下，无 titre-h2 包装
 * 3. h3（.paragraph--type--titre-h3 h3）：33px / 39.6px / #232426
 * 4. 导语 .block-accroche：20px / 30px；且正文首段与导语重复时隐藏导语（summary 前 50 字命中正文）
 * 5. 正文内联链接（.text-formatted 内 p a / li a）：绛红 #910039 + 下划线，hover #6e002b；
 *    ⚠️ 链接文字常包在 <strong>/<span> 里，站内 strong 有显式深色会盖掉继承，必须
 *    对链接内 strong/b/em/span 强制 color:inherit
 * 6. CTA 按钮（.paragraph--type--bouton-cta a）：白字 / 无下划线 / 品红底 #C4004D；
 *    ⚠️ 按钮链接不在 .text-formatted/p/li 容器内，会继承全站 a 的绿色+下划线，必须显式压回
 * 7. 修复规则一律落在共享 CSS（见上）并带实测值注释；对比工具的 SELECTORS 覆盖面必须与清单同步扩充
 * 8. ⚠️ 主题色系分档（2026-09-09 三次事故）：原站按板块分两套主题——个护 theme-cosm（品红系：
 *    h2 #C4004D / 链接 #910039）与药用 theme-pharma（蓝系：h2 #0075BB=rgb(0,117,187) /
 *    链接 #00588D=rgb(0,88,141)，含目录跳转锚链接）。共享 CSS 默认品红，.theme-pharma 前缀覆盖；
 *    两套详情页模板 <main> 已带对应主题类。校验/对比时必须先看原站 main 的 theme-* 类，
 *    按主题选预期值——拿品红预期去比对药用文章会误报，拿品红样式渲染药用文章即事故。
 */
export function findCardThumbBySlug(listingHtml: string, articlePath: string): string | null {
  const card = findCardBlockBySlug(listingHtml, articlePath);
  if (!card) return null;
  const imgTag = findTagByClass(card, 'img', 'card__image');
  if (!imgTag) return null;
  const src = attrOfTag(imgTag, 'src') || attrOfTag(imgTag, 'data-src');
  if (!src) return null;
  return absoluteUrl(stripImgParams(src));
}

/** R7 配套：取列表卡片内的分类文字（li.category，如 "Lipids and polymers"）。
 *  热点话题（pharma）详情页无主题标签区，分类只存在于列表卡片——2026-09-09 补 */
export function findCardCategoryBySlug(listingHtml: string, articlePath: string): string | null {
  const card = findCardBlockBySlug(listingHtml, articlePath);
  if (!card) return null;
  const m = /<li[^>]*class="[^"]*category[^"]*"[^>]*>([\s\S]*?)<\/li>/.exec(card);
  if (!m) return null;
  const t = stripTags(m[1]).trim();
  return t || null;
}

/** 共用：按文章路径定位列表页卡片平衡 div（回溯到包含 card__image 的 c-card 容器） */
function findCardBlockBySlug(listingHtml: string, articlePath: string): string | null {
  if (!articlePath) return null;
  const pathRe = new RegExp('href="([^"]*' + articlePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([?#][^"]*)?)"');
  const linkM = pathRe.exec(listingHtml);
  if (!linkM) return null;
  // 回溯卡片容器：链接在 c-card__content 内层 div 里，图片是其兄弟节点，
  // 所以要逐层向外回溯，直到所在平衡 div 包含 card__image
  let searchFrom = linkM.index;
  for (let guard = 0; guard < 6; guard++) {
    const cardStart = listingHtml.lastIndexOf('<div class="c-card', searchFrom);
    if (cardStart < 0) return null;
    const card = extractBalancedDiv(listingHtml, cardStart);
    if (card && card.indexOf('card__image') >= 0) return card;
    searchFrom = cardStart - 1;
    if (searchFrom < 0) return null;
  }
  return null;
}
