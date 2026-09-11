import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { ensureArticleThemeSeed, applyThemeTagToArticles } from '../utils/article-theme';

/**
 * 获取标签字典 - 按产品线和分类分组返回，供前端筛选器使用
 */
export async function getTagDictionary(req: Request, res: Response) {
  try {
    const { productLine } = req.query; // pc / pharma / formulation / article_theme
    if (productLine === 'article_theme') await ensureArticleThemeSeed();

    const where = productLine
      ? { productLine: String(productLine) }
      : {};

    const tags = await prisma.tagDictionary.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });

    // 按 category 分组。除 label/value 外额外返回 id / category / sortOrder：
    // 后台标签管理页依赖它们做「排序」列显示与编辑/删除定位（只返 label/value 时 t.id 为 undefined，
    // editTag 会退化成传 t.value，后端 parseInt('活性物')=NaN → Prisma 抛错 → 编辑删除必然失败）。
    const grouped: Record<string, { id: number; label: string; value: string; category: string; sortOrder: number }[]> = {};
    for (const t of tags) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push({
        id: t.id,
        label: t.label,
        value: t.value,
        category: t.category,
        sortOrder: t.sortOrder,
      });
    }

    return res.json(success(grouped, '获取成功'));
  } catch (error) {
    console.error('获取标签字典失败:', error);
    return res.status(500).json(fail('获取标签字典失败'));
  }
}

/**
 * 获取标签列表（展平，带 id，用于管理）
 */
export async function listTags(req: Request, res: Response) {
  try {
    const { productLine } = req.query;
    if (productLine === 'article_theme') await ensureArticleThemeSeed();
    const where: any = {};
    if (productLine) where.productLine = String(productLine);

    const tags = await prisma.tagDictionary.findMany({
      where,
      orderBy: [{ productLine: 'asc' }, { category: 'asc' }, { sortOrder: 'asc' }],
    });
    return res.json(success(tags));
  } catch (error) {
    console.error('获取标签列表失败:', error);
    return res.status(500).json(fail('获取标签列表失败'));
  }
}

/**
 * 创建标签
 */
export async function createTag(req: Request, res: Response) {
  try {
    const { productLine, category, label, value, sortOrder } = req.body;
    if (!productLine || !category || !label || !value) {
      return res.status(400).json(fail('产品线、分类、显示名称和选项值为必填项'));
    }
    const tag = await prisma.tagDictionary.create({
      data: {
        productLine,
        category,
        label,
        value,
        sortOrder: sortOrder || 0,
      },
    });
    return res.json(success(tag, '创建成功'));
  } catch (error) {
    console.error('创建标签失败:', error);
    return res.status(500).json(fail('创建标签失败'));
  }
}

/**
 * 更新标签
 */
export async function updateTag(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { label, value, sortOrder, category } = req.body;
    const data: any = {};
    if (label !== undefined) data.label = label;
    if (value !== undefined) data.value = value;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (category !== undefined) data.category = category;

    const tag = await prisma.tagDictionary.update({
      where: { id },
      data,
    });
    return res.json(success(tag, '更新成功'));
  } catch (error) {
    console.error('更新标签失败:', error);
    return res.status(500).json(fail('更新标签失败'));
  }
}

/**
 * 删除标签
 */
export async function deleteTag(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    await prisma.tagDictionary.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除标签失败:', error);
    return res.status(500).json(fail('删除标签失败'));
  }
}

/**
 * 文章主题标签：把字典译文同步到全部存量文章（POST /api/tags/:id/apply）
 * body.from 可选——编辑前旧译文列表（如改译前的 value），一并替换
 */
export async function applyTagToArticles(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const extraFrom: string[] = Array.isArray(req.body?.from) ? req.body.from.map(String) : [];
    const { updated } = await applyThemeTagToArticles(id, extraFrom);
    return res.json(success({ updated }, `已同步 ${updated} 篇文章`));
  } catch (error: any) {
    console.error('同步文章标签失败:', error);
    return res.status(400).json(fail(error.message || '同步失败'));
  }
}
