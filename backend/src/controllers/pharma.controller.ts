import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

const PHARMA_LIST_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
};

/**
 * 获取药用辅料列表 - 支持4维标签筛选 + 分页 + 搜索
 */
export async function listPharmaProducts(req: Request, res: Response) {
  try {
    const {
      page = '1',
      limit = '20',
      keyword,
      market,
      route,
      functionality,
      dosageForm,
      isPublished,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};

    if (keyword) {
      const kw = String(keyword);
      where.OR = [
        { name: { contains: kw } },
        { slug: { contains: kw } },
        { description: { contains: kw } },
      ];
    }

    const tagFilters: [string, string | undefined][] = [
      ['marketTag', market as string],
      ['routeTag', route as string],
      ['functionalityTag', functionality as string],
      ['dosageFormTag', dosageForm as string],
    ];

    const tagConditions: Record<string, unknown>[] = [];
    for (const [field, value] of tagFilters) {
      if (value) {
        const values = String(value).split(',').filter(Boolean);
        values.forEach(v => {
          tagConditions.push({ [field]: { contains: v } });
        });
      }
    }

    // 标签条件用 AND 连接（同一分类多选 = 必须包含所有选中标签）
    if (tagConditions.length === 1) {
      Object.assign(where, tagConditions[0]);
    } else if (tagConditions.length > 1) {
      where.AND = tagConditions;
    }

    if (isPublished !== undefined && isPublished !== '') {
      where.isPublished = String(isPublished) === 'true';
    }

    const [total, items] = await Promise.all([
      prisma.pharmaProduct.count({ where: where as any }),
      prisma.pharmaProduct.findMany({
        where: where as any,
        include: PHARMA_LIST_INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    return res.json(success(paginate(items.map(parsePharma), total, pageNum, limitNum)));
  } catch (error) {
    console.error('获取辅料列表失败:', error);
    return res.status(500).json(fail('获取辅料列表失败'));
  }
}

export async function getPharmaProduct(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(fail('无效的产品ID'));

    const item = await prisma.pharmaProduct.findUnique({
      where: { id },
      include: PHARMA_LIST_INCLUDE,
    });
    if (!item) return res.status(404).json(fail('产品不存在'));

    return res.json(success(parsePharma(item)));
  } catch (error) {
    console.error('获取辅料详情失败:', error);
    return res.status(500).json(fail('获取辅料详情失败'));
  }
}

export async function createPharmaProduct(req: Request, res: Response) {
  try {
    const {
      name, slug, description, imageUrl,
      marketTag, routeTag, functionalityTag, dosageFormTag,
      compositionHtml, applicationHtml, regulatoryHtml,
      sortOrder, isPublished,
    } = req.body;

    if (!name) {
      return res.status(400).json(fail('产品名称为必填项'));
    }

    const item = await prisma.pharmaProduct.create({
      data: {
        name,
        slug: slug || null,
        description: description || null,
        imageUrl: imageUrl || null,
        marketTag: arrayToTag(marketTag),
        routeTag: arrayToTag(routeTag),
        functionalityTag: arrayToTag(functionalityTag),
        dosageFormTag: arrayToTag(dosageFormTag),
        compositionHtml: compositionHtml || null,
        applicationHtml: applicationHtml || null,
        regulatoryHtml: regulatoryHtml || null,
        sortOrder: sortOrder || 0,
        isPublished: isPublished || false,
        createdById: req.user?.userId || null,
      },
      include: PHARMA_LIST_INCLUDE,
    });

    return res.json(success(parsePharma(item), '创建成功'));
  } catch (error) {
    console.error('创建辅料失败:', error);
    return res.status(500).json(fail('创建辅料失败'));
  }
}

export async function updatePharmaProduct(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(fail('无效的产品ID'));

    const existing = await prisma.pharmaProduct.findUnique({ where: { id } });
    if (!existing) return res.status(404).json(fail('产品不存在'));

    const body = req.body;
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.description !== undefined) data.description = body.description;
    if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;
    if (body.marketTag !== undefined) data.marketTag = arrayToTag(body.marketTag);
    if (body.routeTag !== undefined) data.routeTag = arrayToTag(body.routeTag);
    if (body.functionalityTag !== undefined) data.functionalityTag = arrayToTag(body.functionalityTag);
    if (body.dosageFormTag !== undefined) data.dosageFormTag = arrayToTag(body.dosageFormTag);
    if (body.compositionHtml !== undefined) data.compositionHtml = body.compositionHtml;
    if (body.applicationHtml !== undefined) data.applicationHtml = body.applicationHtml;
    if (body.regulatoryHtml !== undefined) data.regulatoryHtml = body.regulatoryHtml;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.isPublished !== undefined) data.isPublished = body.isPublished;

    const item = await prisma.pharmaProduct.update({
      where: { id },
      data: data as any,
      include: PHARMA_LIST_INCLUDE,
    });

    return res.json(success(parsePharma(item), '更新成功'));
  } catch (error) {
    console.error('更新辅料失败:', error);
    return res.status(500).json(fail('更新辅料失败'));
  }
}

export async function deletePharmaProduct(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(fail('无效的产品ID'));

    const existing = await prisma.pharmaProduct.findUnique({ where: { id } });
    if (!existing) return res.status(404).json(fail('产品不存在'));

    await prisma.pharmaProduct.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除辅料失败:', error);
    return res.status(500).json(fail('删除辅料失败'));
  }
}

export async function batchPublishPharmaProducts(req: Request, res: Response) {
  try {
    const { ids, isPublished } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(fail('请选择要操作的产品'));
    }
    await prisma.pharmaProduct.updateMany({
      where: { id: { in: ids } },
      data: { isPublished: !!isPublished },
    });
    return res.json(success(null, `${isPublished ? '发布' : '取消发布'}成功`));
  } catch (error) {
    console.error('批量操作失败:', error);
    return res.status(500).json(fail('批量操作失败'));
  }
}

/**
 * 批量删除药用辅料
 */
export async function batchDeletePharmaProducts(req: Request, res: Response) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(fail('请选择要删除的产品'));
    }
    await prisma.pharmaProduct.deleteMany({
      where: { id: { in: ids } },
    });
    return res.json(success(null, `成功删除 ${ids.length} 个产品`));
  } catch (error) {
    console.error('批量删除失败:', error);
    return res.status(500).json(fail('批量删除失败'));
  }
}

// ===== 工具函数 =====

function parsePharma(item: any) {
  return {
    ...item,
    marketTag: tagToArray(item.marketTag),
    routeTag: tagToArray(item.routeTag),
    functionalityTag: tagToArray(item.functionalityTag),
    dosageFormTag: tagToArray(item.dosageFormTag),
  };
}

function tagToArray(tag: string | null | undefined): string[] {
  if (!tag) return [];
  return tag.split(',').map((t: string) => t.trim()).filter(Boolean);
}

function arrayToTag(val: string | string[] | undefined): string {
  if (!val) return '';
  if (Array.isArray(val)) return val.join(',');
  return val;
}
