/**
 * 导入后自动一致性校验（第 2 层）
 * 导入器落库后立即对照原站 HTML 逐项核对，产出 ✅/❌ 清单返回给后台对话框；
 * 可自动修复的项目（如作者头像漏抓）直接重试补齐。
 */
import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';
import {
  ORIGIN_BASE, downloadFile, fetchText, absoluteUrl, findTagByClass, attrOfTag, stripImgParams,
  extractBalancedDiv, extractDivByClass, stripTags, normalizeForCompare, structureSignature,
  removeParagraphBlocks, findCardThumbBySlug, findCardCategoryBySlug, translateTag,
} from './import-rules';

export interface VerifyItem {
  name: string;
  ok: boolean;
  detail?: string;
  fixed?: boolean;
}

/** 提取原站文章标题（h1.s-article__title） */
function originTitle(html: string): string {
  const m = /<h1[^>]*s-article__title[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  return m ? stripTags(m[1]) : '';
}

/** 提取原站导语（block-accroche） */
function originAccroche(html: string): string {
  const idx = html.indexOf('block-accroche');
  if (idx < 0) return '';
  const divOpen = html.lastIndexOf('<div', idx);
  if (divOpen < 0) return '';
  const div = extractBalancedDiv(html, divOpen);
  return div ? stripTags(div).trim() : '';
}

/** 提取原站作者信息 */
function originAuthor(html: string): { name: string; poste: string; avatarAbs: string } {
  const nameM = /s-article__author-name[^>]*>([\s\S]*?)</.exec(html);
  const posteM = /s-article__author-poste[^>]*>([\s\S]*?)</.exec(html);
  let avatar = '';
  const tag = findTagByClass(html, 'img', 's-article__author-img');
  if (tag) {
    const src = attrOfTag(tag, 'src');
    if (src) avatar = absoluteUrl(stripImgParams(src));
  }
  return {
    name: nameM ? stripTags(nameM[1]) : '',
    poste: posteM ? stripTags(posteM[1]) : '',
    avatarAbs: avatar,
  };
}

/** 提取原站正文容器（node__content 平衡 div） */
function originContent(html: string): string {
  const articleDiv = extractDivByClass(html, 'node--view-mode-full');
  if (!articleDiv) return '';
  const start = articleDiv.indexOf('<div class="node__content">');
  if (start < 0) return '';
  return extractBalancedDiv(articleDiv, start) || '';
}

/** 结构签名：widget/linked-content 在导入时被拆走或跳过，比对前整块剔除（含其内部图片） */
function sig(html: string): string {
  return structureSignature(removeParagraphBlocks(html, ['widget', 'linked-content']));
}

/** 统计正文中残留的外链图片 src */
function countExternalImages(html: string): number {
  let n = 0;
  const re = /<img[^>]*\ssrc="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!m[1].startsWith('/uploads/')) n++;
  }
  return n;
}

/** 统计残留的相对站内链接（/uploads/ 除外） */
function countRelativeLinks(html: string): number {
  let n = 0;
  const re = /href="(\/[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!m[1].startsWith('/uploads/')) n++;
  }
  return n;
}

/** 统计本地文件存在（/uploads/xxx → backend/uploads/xxx） */
function localFileExists(urlPath: string | null): boolean {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return false;
  const p = path.resolve(__dirname, '../../uploads', urlPath.replace('/uploads/', ''));
  try { return fs.statSync(p).size > 0; } catch { return false; }
}

const hasCJK = (t: string) => /[\u4e00-\u9fff]/.test(t);

/**
 * 主入口：对照原站 HTML 校验刚导入的文章记录
 * item 为 prisma.newsEvent 记录（含 id/title/summary/contentHtml/imageUrl/authorId）
 * authorContext.bioPrefilled：作者在库内已有职务/简介（后台编辑维护过，导入器不覆盖），此时不按原站原文比对
 */
export async function verifyImportedArticle(
  originHtml: string,
  item: { id: number; title: string; summary: string | null; contentHtml: string; imageUrl: string | null; authorId: number | null },
  authorContext?: { bioPrefilled?: boolean },
): Promise<VerifyItem[]> {
  const out: VerifyItem[] = [];
  const author = item.authorId ? await prisma.author.findUnique({ where: { id: item.authorId } }) : null;
  const oAuthor = originAuthor(originHtml);

  // 1. 标题一致性（已翻译为中文的记录视为通过）
  const oTitle = originTitle(originHtml);
  if (!oTitle) {
    out.push({ name: '标题与原站一致', ok: false, detail: '原站未找到标题' });
  } else if (normalizeForCompare(oTitle) === normalizeForCompare(item.title)) {
    out.push({ name: '标题与原站一致', ok: true });
  } else if (hasCJK(item.title)) {
    out.push({ name: '标题与原站一致', ok: true, detail: '已翻译为中文' });
  } else {
    out.push({ name: '标题与原站一致', ok: false, detail: `原站「${oTitle}」→ 库内「${item.title}」` });
  }

  // 2. 摘要（导语）一致性：库内摘要应为原站导语的前缀或兜底首段；已翻译视为通过
  const oAcc = originAccroche(originHtml);
  if (oAcc) {
    if (item.summary && normalizeForCompare(oAcc).startsWith(normalizeForCompare(item.summary).slice(0, 50))) {
      out.push({ name: '摘要与原站导语一致', ok: true });
    } else if (item.summary && hasCJK(item.summary)) {
      out.push({ name: '摘要与原站导语一致', ok: true, detail: '已翻译为中文' });
    } else {
      out.push({ name: '摘要与原站导语一致', ok: false, detail: '库内摘要与原站导语不匹配' });
    }
  } else {
    out.push({ name: '摘要（原站无导语，取首段兜底）', ok: !!item.summary, detail: item.summary ? undefined : '原站无导语且未生成兜底摘要' });
  }

  // 3. 作者姓名 / 职务
  if (oAuthor.name) {
    const coreName = oAuthor.name.split(',')[0].trim();
    out.push({
      name: '作者姓名一致',
      ok: !!author && normalizeForCompare(author.name) === normalizeForCompare(coreName),
      detail: author ? undefined : '库内未关联作者',
    });
    if (oAuthor.poste) {
      const matchPoste = !!author && (normalizeForCompare(author.bio || '') === normalizeForCompare(oAuthor.poste) || normalizeForCompare(author.title || '') === normalizeForCompare(oAuthor.poste));
      out.push({
        name: '作者职务一致',
        ok: matchPoste || !!authorContext?.bioPrefilled,
        detail: matchPoste || authorContext?.bioPrefilled ? (authorContext?.bioPrefilled && !matchPoste ? '作者资料已有后台维护内容，未覆盖' : undefined) : '库内未关联作者',
      });
    }
  }

  // 4. 作者头像本地化（失败时自动重试下载修复）
  if (oAuthor.name) {
    let avatarOk = localFileExists(author?.avatar || null);
    let fixed = false;
    if (!avatarOk && author && oAuthor.avatarAbs) {
      try {
        const authorDir = path.resolve(__dirname, '../../uploads/authors');
        if (!fs.existsSync(authorDir)) fs.mkdirSync(authorDir, { recursive: true });
        const extM = /\.(jpe?g|png|webp|gif)$/i.exec(oAuthor.avatarAbs.split('/').pop() || '');
        const fname = `author_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extM ? extM[1] : 'jpg'}`;
        await downloadFile(oAuthor.avatarAbs, path.join(authorDir, fname));
        await prisma.author.update({ where: { id: author.id }, data: { avatar: `/uploads/authors/${fname}` } });
        avatarOk = true;
        fixed = true;
      } catch { /* 修复失败保持 ❌ */ }
    }
    out.push({ name: '作者头像已本地化', ok: avatarOk, fixed: fixed || undefined, detail: avatarOk ? undefined : `原站头像地址 ${oAuthor.avatarAbs || '未找到'}` });
  }

  // 5. 封面图本地化
  out.push({
    name: '封面图已本地化',
    ok: localFileExists(item.imageUrl),
    detail: item.imageUrl ? undefined : '未设置封面',
  });

  // 6. 正文图片全部本地化
  const extImgs = countExternalImages(item.contentHtml);
  out.push({
    name: '正文图片全部本地化',
    ok: extImgs === 0,
    detail: extImgs ? `${extImgs} 张外链图残留` : undefined,
  });

  // 7. 结构签名一致
  const oContent = originContent(originHtml);
  if (oContent) {
    const s1 = sig(oContent);
    const s2 = sig(item.contentHtml);
    out.push({
      name: '正文结构与原站一致',
      ok: s1 === s2,
      detail: s1 === s2 ? undefined : `原站 [${s1.slice(0, 120)}] / 导入 [${s2.slice(0, 120)}]`,
    });
  }

  // 8. 无脏链（bing 跳转等）
  const dirty = /bing\.com\/ck\/a/i.test(item.contentHtml);
  out.push({ name: '无追踪脏链', ok: !dirty, detail: dirty ? '正文残留 bing.com/ck/a 跳转链接' : undefined });

  // 9. 站内链接已绝对化
  const rel = countRelativeLinks(item.contentHtml);
  out.push({ name: '站内链接已绝对化', ok: rel === 0, detail: rel ? `${rel} 处相对链接残留` : undefined });

  return out;
}

/**
 * 重跑校验（后台"重新校验"入口）：按文章 id 重新抓原站页面并核对
 * originUrl 从 slug 还原（slugBase 即原站 URL 末段）
 */
export async function reverifyArticle(id: number): Promise<VerifyItem[]> {
  const item = await prisma.newsEvent.findUnique({ where: { id } });
  if (!item) throw new Error('文章不存在');
  if (!item.slug) throw new Error('该记录无原站 slug，无法定位原站页面');
  // slug 兼容两种历史格式：末段（新导入）或完整路径（旧导入，含 /）
  // 末段格式先用 sitemap 定位完整路径（热点话题等非个护板块文章不能拼 get-inspired，2026-09-09），
  // sitemap 找不到再回退 get-inspired 拼接
  let originPath = '';
  if (item.slug.includes('/')) {
    originPath = item.slug.replace(/^\/+/, '');
  } else {
    try {
      const sm = await fetchText(`${ORIGIN_BASE}/sitemap.xml`);
      const locM = new RegExp('<loc>[^<]*' + item.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^<]*</loc>').exec(sm);
      if (locM) {
        const u = new URL(locM[0].replace(/<\/?loc>/g, ''));
        originPath = u.pathname;
      }
    } catch { /* sitemap 拉取失败走回退 */ }
    if (!originPath) originPath = `personal-care/get-inspired/${item.slug}`;
  }
  const originUrl = `${ORIGIN_BASE}/${originPath.replace(/^\/+/, '')}`;
  const originHtml = await fetchText(originUrl);

  const items = await verifyImportedArticle(originHtml, {
    id: item.id,
    title: item.title || '',
    summary: item.summary,
    contentHtml: item.contentHtml || '',
    imageUrl: item.imageUrl,
    authorId: item.authorId,
  });

  // 缩略图修复（R7）：列表卡片图与本站 imageUrl 不一致时自动下载替换。
  // 存量导入（列表页写死 get-inspired 时期）的记录 imageUrl 是正文首图，靠此修复。
  try {
    const segs = originPath.split('/').filter(Boolean);
    if (segs.length > 1) {
      const listingHtml = await fetchText(`${ORIGIN_BASE}/${segs.slice(0, -1).join('/')}`);
      const thumbRaw = findCardThumbBySlug(listingHtml, originPath);
      // 主题补齐：热点话题详情页无标签区，分类只在列表卡片——tags 为空时从卡片补
      let existingTags: string[] = [];
      if (item.tags) {
        try { existingTags = JSON.parse(item.tags); } catch { existingTags = item.tags.split(',').map(s => s.trim()).filter(Boolean); }
      }
      const catRaw = findCardCategoryBySlug(listingHtml, originPath);
      if (catRaw && !existingTags.length) {
        const catZh = translateTag(catRaw);
        await prisma.newsEvent.update({ where: { id: item.id }, data: { tags: JSON.stringify([catZh]) } });
        items.push({ name: '主题标签', ok: true, fixed: true, detail: `已从列表卡片补齐主题（${catRaw}${catZh !== catRaw ? ' → ' + catZh : ''}）` });
      }
      if (thumbRaw) {
        const remoteBaseRaw = decodeURIComponent(new URL(thumbRaw).pathname.split('/').pop() || '').replace(/\.webp$/i, '');
        const remoteKey = remoteBaseRaw.replace(/[^\w.\-]+/g, '_').slice(0, 40);
        const localBase = (item.imageUrl || '').split('/').pop() || '';
        // 本地文件名 = 时间戳_序号_原文件名；去掉前两段后应包含远端原始文件名
        const localKey = localBase.split('_').slice(2).join('_');
        if (!remoteKey || !localKey || !localKey.includes(remoteKey)) {
          const uploadDir = path.join(process.cwd(), 'uploads', 'articles');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const base = `${Date.now()}_99_${remoteKey || `thumb_${Date.now()}`}`;
          const target = /\.(jpe?g|png|gif|webp|svg)$/i.test(base) ? base : base + '.webp';
          try {
            await downloadFile(thumbRaw, path.join(uploadDir, target));
            await prisma.newsEvent.update({ where: { id: item.id }, data: { imageUrl: `/uploads/articles/${target}` } });
            items.push({ name: '列表缩略图', ok: true, fixed: true, detail: `已从原站列表卡片修复缩略图（${remoteBaseRaw}）` });
          } catch (e: any) {
            items.push({ name: '列表缩略图', ok: false, detail: `下载失败：${e.message}` });
          }
        } else {
          items.push({ name: '列表缩略图', ok: true, detail: '与本站缩略图一致' });
        }
      }
    }
  } catch { /* 缩略图修复失败不阻塞校验结论 */ }

  return items;
}
