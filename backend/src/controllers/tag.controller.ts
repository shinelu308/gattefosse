import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { ensureArticleThemeSeed, applyThemeTagToArticles } from '../utils/article-theme';
import { getTagLine } from '../utils/tag-map';
import {
  scanTagHealth,
  scanAllTagHealth,
  fillTagDictionary,
  getUsageCounts,
  getTagLineSchema,
} from '../utils/tag-health';

/**
 * 获取标签字典 - 按产品线和分类分组返回，供前端筛选器使用
 *
 * ?withCount=1 时额外附带每个值的「命中产品数」(`count`)，
 * 前台可据此把 0 命中的筛选项置灰 —— 避免用户点出一个空列表。
 * 默认不带（要多扫一次产品表，前台首页没必要为它买单）。
 */
export async function getTagDictionary(req: Request, res: Response) {
  try {
    const { productLine, withCount } = req.query; // pc / pharma / formulation / article_theme
    if (productLine === 'article_theme') await ensureArticleThemeSeed();

    const where = productLine
      ? { productLine: String(productLine) }
      : {};

    const tags = await prisma.tagDictionary.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });

    // 按需附带命中数
    let counts: Record<string, Record<string, number>> | null = null;
    if (withCount === '1' || withCount === 'true') {
      if (productLine && getTagLine(String(productLine))) {
        counts = await getUsageCounts(String(productLine));
      }
    }

    // 按 category 分组。除 label/value 外额外返回 id / category / sortOrder：
    // 后台标签管理页依赖它们做「排序」列显示与编辑/删除定位（只返 label/value 时 t.id 为 undefined，
    // editTag 会退化成传 t.value，后端 parseInt('活性物')=NaN → Prisma 抛错 → 编辑删除必然失败）。
    const grouped: Record<
      string,
      { id: number; label: string; value: string; category: string; sortOrder: number; count?: number }[]
    > = {};
    for (const t of tags) {
      if (!grouped[t.category]) grouped[t.category] = [];
      const item: { id: number; label: string; value: string; category: string; sortOrder: number; count?: number } = {
        id: t.id,
        label: t.label,
        value: t.value,
        category: t.category,
        sortOrder: t.sortOrder,
      };
      if (counts) item.count = counts[t.category]?.[t.value] ?? 0;
      grouped[t.category].push(item);
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

    // 前置去重：同一产品线同一分类下，value 或 label 任一命中即视为已存在。
    // （字典表原本没有任何唯一约束，重复条目会让前台出现两个同值选项、后台无法分辨）
    const dup = await prisma.tagDictionary.findFirst({
      where: { productLine, category, OR: [{ value: String(value) }, { label: String(label) }] },
    });
    if (dup) {
      // 用 200 + success 返回而不是 409：前端 axios 对非 2xx 会直接 reject，
      // 拿不到这里的 message，用户只会看到 "Request failed with status code 409"。
      // 语义上「创建已存在的标签」本就是幂等的，返回既有条目即可。
      return res.json(success(dup, `该分类下已存在「${dup.label}」，未重复创建`));
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

/**
 * 标签健康巡检（只读）—— GET /api/tags/health?productLine=pc
 * 不传 productLine 则巡检全部产品线。
 *
 * 回答的就是「新标签出现时能不能自动补齐」：巡检会列出
 *   缺口（产品在用但字典没有）/ 死标签（字典有但没人用）/ 同值冲突 / 疑似脏值
 * 其中「缺口」就是待补齐清单，由后台人工确认后调 /api/tags/health/fill 写入。
 */
export async function getTagHealth(req: Request, res: Response) {
  try {
    const { productLine } = req.query;
    if (!productLine) {
      const all = await scanAllTagHealth();
      return res.json(success(all, '检查完成'));
    }
    const line = String(productLine);
    if (!getTagLine(line)) {
      return res.status(400).json(fail(`「${line}」没有产品字段承载标签，无法巡检`));
    }
    return res.json(success(await scanTagHealth(line), '检查完成'));
  } catch (error) {
    console.error('标签巡检失败:', error);
    return res.status(500).json(fail('标签巡检失败'));
  }
}

/**
 * 补齐标签（写入）—— POST /api/tags/health/fill
 * body: { productLine, items: [{ category, value, label? }] }
 *
 * 刻意设计成「必须显式传 items」：不会自己去扫库再偷偷写入，
 * 调用方一定是先看了 /api/tags/health 的 diff 再决定补哪些。
 */
export async function fillTagMissing(req: Request, res: Response) {
  try {
    const { productLine, items } = req.body || {};
    if (!productLine) return res.status(400).json(fail('productLine 为必填项'));
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json(fail('items 不能为空——补齐必须由人工确认清单后显式提交'));
    }
    const result = await fillTagDictionary(String(productLine), items);
    const msg =
      result.created.length > 0
        ? `已补齐 ${result.created.length} 条${result.skipped.length ? `，跳过 ${result.skipped.length} 条` : ''}` +
          `${result.rejected.length ? `，拒绝 ${result.rejected.length} 条` : ''}`
        : `没有新增（跳过 ${result.skipped.length} 条，拒绝 ${result.rejected.length} 条）`;
    return res.json(success(result, msg));
  } catch (error: any) {
    console.error('补齐标签失败:', error);
    return res.status(400).json(fail(error.message || '补齐标签失败'));
  }
}

/**
 * 后台用的产品线/分类清单 —— GET /api/tags/lines
 * 分类取自 DB 实际存在的 category ∪ tag-map 声明，保证不会有「字典里有、后台看不到」的分类。
 */
export async function getTagLines(req: Request, res: Response) {
  try {
    return res.json(success(await getTagLineSchema(), '获取成功'));
  } catch (error) {
    console.error('获取标签维度失败:', error);
    return res.status(500).json(fail('获取标签维度失败'));
  }
}
