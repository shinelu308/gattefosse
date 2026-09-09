/**
 * 文章主题标签全局管理（2026-09-09）
 * 把文章主题标签字典落入 tag_dictionary（productLine='article_theme', category='theme'），
 * 后台「标签管理」页可增删改；导入/reverify 翻译主题时优先查字典，代码 TAG_ZH 仅作兜底，
 * 字典改译文后可一键同步到全部存量文章——一处修改全站生效。
 * label = 英文原词（原站列表卡片分类），value = 中文译文
 */
import { prisma } from './prisma';
import { TAG_ZH, translateTag } from './import-rules';

export const THEME_LINE = 'article_theme';
export const THEME_CATEGORY = 'theme';

/** 首次访问时把 TAG_ZH 幂等种子化进字典（本地/线上自动就绪，无需手工导数） */
let seedPromise: Promise<void> | null = null;
export function ensureArticleThemeSeed(): Promise<void> {
  if (!seedPromise) seedPromise = doSeed();
  return seedPromise;
}
async function doSeed(): Promise<void> {
  try {
    const existing = await prisma.tagDictionary.findMany({
      where: { productLine: THEME_LINE, category: THEME_CATEGORY },
      select: { label: true },
    });
    const have = new Set(existing.map(e => e.label.toLowerCase()));
    const missing = Object.entries(TAG_ZH).filter(([en]) => !have.has(en.toLowerCase()));
    if (missing.length) {
      let order = 100;
      await prisma.$transaction(
        missing.map(([en, zh]) =>
          prisma.tagDictionary.create({
            data: { productLine: THEME_LINE, category: THEME_CATEGORY, label: en, value: zh, sortOrder: order++ },
          }),
        ),
      );
    }
  } catch (e) {
    seedPromise = null; // 失败允许重试
    throw e;
  }
}

/** 查字典翻译（未命中回退代码 TAG_ZH 并记录未知词）；批量版只查一次库 */
export async function translateArticleThemes(tags: string[], unknownSink?: string[]): Promise<string[]> {
  if (!tags.length) return [];
  await ensureArticleThemeSeed();
  const dict = await prisma.tagDictionary.findMany({
    where: { productLine: THEME_LINE, category: THEME_CATEGORY },
    select: { label: true, value: true },
  });
  const map = new Map(dict.map(d => [d.label.toLowerCase(), d.value]));
  return tags.map(t => {
    const key = t.toLowerCase().trim();
    if (map.has(key)) return map.get(key) as string;
    return translateTag(t, unknownSink); // 回退代码映射 / 原样保留并记未知词
  });
}

/** 单个版（reverify 用） */
export async function translateArticleTheme(tag: string, unknownSink?: string[]): Promise<string> {
  const [r] = await translateArticleThemes([tag], unknownSink);
  return r;
}

/**
 * 把字典条目同步到全部存量文章：tags 数组中等于 fromList 任意一项的元素替换为 toValue
 * 返回更新的文章篇数
 */
export async function applyThemeTagToArticles(
  tagId: number,
  extraFrom: string[] = [],
): Promise<{ updated: number }> {
  const tag = await prisma.tagDictionary.findUnique({ where: { id: tagId } });
  if (!tag || tag.productLine !== THEME_LINE) throw new Error('仅文章主题标签支持同步到文章');
  const fromList = Array.from(new Set([...extraFrom.map(s => s.trim()).filter(Boolean), tag.label]))
    .filter(s => s !== tag.value); // 目标值自身不必替换
  const items = await prisma.newsEvent.findMany({
    where: { tags: { not: null } },
    select: { id: true, tags: true },
  });
  let updated = 0;
  for (const it of items) {
    let arr: unknown;
    try { arr = JSON.parse(it.tags as string); } catch { continue; }
    if (!Array.isArray(arr) || !arr.length) continue;
    let changed = false;
    const next = (arr as unknown[]).map(t => {
      if (typeof t === 'string' && fromList.includes(t)) { changed = true; return tag.value; }
      return t;
    });
    if (changed) {
      await prisma.newsEvent.update({ where: { id: it.id }, data: { tags: JSON.stringify(next) } });
      updated++;
    }
  }
  return { updated };
}
