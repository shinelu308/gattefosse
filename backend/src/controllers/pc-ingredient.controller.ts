import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

const PC_LIST_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
};

/**
 * 获取个人护理原料列表 - 支持6维标签筛选 + 分页 + 搜索
 */
export async function listPcIngredients(req: Request, res: Response) {
  try {
    const {
      page = '1',
      limit = '20',
      keyword,
      // 6 个筛选维度 (逗号分隔多选)
      functionality,
      application,
      concept,
      claim,
      characteristic,
      naturality,
      isPublished,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};

    // 关键词搜索（产品名 + INCI名）
    if (keyword) {
      const kw = String(keyword);
      where.OR = [
        { name: { contains: kw } },
        { inciName: { contains: kw } },
        { description: { contains: kw } },
      ];
    }

    // 标签筛选 - 同一分类多选使用 AND 逻辑
    const tagFilters: [string, string | undefined][] = [
      ['functionalityTag', functionality as string],
      ['applicationTag', application as string],
      ['conceptTag', concept as string],
      ['claimTag', claim as string],
      ['characteristicTag', characteristic as string],
      ['naturalityLabel', naturality as string],
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

    // 将标签条件合并到 where（多个条件用 AND 连接）
    if (tagConditions.length === 1) {
      Object.assign(where, tagConditions[0]);
    } else if (tagConditions.length > 1) {
      where.AND = tagConditions;
    }

    // 发布状态筛选
    if (isPublished !== undefined && isPublished !== '') {
      where.isPublished = String(isPublished) === 'true';
    }

    const [total, items] = await Promise.all([
      prisma.pcIngredient.count({ where: where as any }),
      prisma.pcIngredient.findMany({
        where: where as any,
        include: PC_LIST_INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    // 将逗号分隔的标签转为数组返回
    const parsed = items.map(parsePcIngredient);

    return res.json(success(paginate(parsed, total, pageNum, limitNum)));
  } catch (error) {
    console.error('获取原料列表失败:', error);
    return res.status(500).json(fail('获取原料列表失败'));
  }
}

/**
 * 获取单个原料详情
 */
export async function getPcIngredient(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(fail('无效的产品ID'));

    const item = await prisma.pcIngredient.findUnique({
      where: { id },
      include: PC_LIST_INCLUDE,
    });

    if (!item) return res.status(404).json(fail('产品不存在'));

    return res.json(success(parsePcIngredient(item)));
  } catch (error) {
    console.error('获取原料详情失败:', error);
    return res.status(500).json(fail('获取原料详情失败'));
  }
}

/**
 * 创建原料
 */
export async function createPcIngredient(req: Request, res: Response) {
  try {
    const {
      name,
      inciName,
      description,
      dosage,
      imageUrl,
      detailImageUrl,
      videoUrl,
      tagline,
      intlUrl,
      functionalityTag,
      applicationTag,
      conceptTag,
      claimTag,
      characteristicTag,
      naturalityLabel,
      compositionHtml,
      sensoryHtml,
      clinicalHtml,
      sortOrder,
      isPublished,
      specInfo,
    } = req.body;

    if (!name || !inciName) {
      return res.status(400).json(fail('产品名称和INCI名称为必填项'));
    }

    const item = await prisma.pcIngredient.create({
      data: {
        name,
        inciName,
        description: description || null,
        dosage: dosage || null,
        imageUrl: imageUrl || null,
        detailImageUrl: detailImageUrl || null,
        videoUrl: videoUrl || null,
        tagline: tagline || null,
        intlUrl: intlUrl || null,
        functionalityTag: arrayToTag(functionalityTag),
        applicationTag: arrayToTag(applicationTag),
        conceptTag: arrayToTag(conceptTag),
        claimTag: arrayToTag(claimTag),
        characteristicTag: arrayToTag(characteristicTag),
        naturalityLabel: arrayToTag(naturalityLabel),
        compositionHtml: compositionHtml || null,
        sensoryHtml: sensoryHtml || null,
        clinicalHtml: clinicalHtml || null,
        sortOrder: sortOrder || 0,
        isPublished: isPublished || false,
        specInfo: specInfo ? JSON.stringify(specInfo) : null,
        createdById: req.user?.userId || null,
      },
      include: PC_LIST_INCLUDE,
    });

    return res.json(success(parsePcIngredient(item), '创建成功'));
  } catch (error) {
    console.error('创建原料失败:', error);
    return res.status(500).json(fail('创建原料失败'));
  }
}

/**
 * 更新原料
 */
export async function updatePcIngredient(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(fail('无效的产品ID'));

    const existing = await prisma.pcIngredient.findUnique({ where: { id } });
    if (!existing) return res.status(404).json(fail('产品不存在'));

    const body = req.body;
    const data: Record<string, unknown> = {};

    // 基础字段
    if (body.name !== undefined) data.name = body.name;
    if (body.inciName !== undefined) data.inciName = body.inciName;
    if (body.description !== undefined) data.description = body.description;
    if (body.dosage !== undefined) data.dosage = body.dosage;
    if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;
    if (body.detailImageUrl !== undefined) data.detailImageUrl = body.detailImageUrl;
    if (body.videoUrl !== undefined) data.videoUrl = body.videoUrl;
    if (body.tagline !== undefined) data.tagline = body.tagline;
    if (body.intlUrl !== undefined) data.intlUrl = body.intlUrl;

    // 标签字段
    if (body.functionalityTag !== undefined) data.functionalityTag = arrayToTag(body.functionalityTag);
    if (body.applicationTag !== undefined) data.applicationTag = arrayToTag(body.applicationTag);
    if (body.conceptTag !== undefined) data.conceptTag = arrayToTag(body.conceptTag);
    if (body.claimTag !== undefined) data.claimTag = arrayToTag(body.claimTag);
    if (body.characteristicTag !== undefined) data.characteristicTag = arrayToTag(body.characteristicTag);
    if (body.naturalityLabel !== undefined) data.naturalityLabel = arrayToTag(body.naturalityLabel);

    // 富文本
    if (body.compositionHtml !== undefined) data.compositionHtml = body.compositionHtml;
    if (body.sensoryHtml !== undefined) data.sensoryHtml = body.sensoryHtml;
    if (body.clinicalHtml !== undefined) data.clinicalHtml = body.clinicalHtml;

    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.isPublished !== undefined) data.isPublished = body.isPublished;
    if (body.specInfo !== undefined) data.specInfo = body.specInfo ? JSON.stringify(body.specInfo) : null;

    const item = await prisma.pcIngredient.update({
      where: { id },
      data: data as any,
      include: PC_LIST_INCLUDE,
    });

    return res.json(success(parsePcIngredient(item), '更新成功'));
  } catch (error) {
    console.error('更新原料失败:', error);
    return res.status(500).json(fail('更新原料失败'));
  }
}

/**
 * 删除原料
 */
export async function deletePcIngredient(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(fail('无效的产品ID'));

    const existing = await prisma.pcIngredient.findUnique({ where: { id } });
    if (!existing) return res.status(404).json(fail('产品不存在'));

    await prisma.pcIngredient.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除原料失败:', error);
    return res.status(500).json(fail('删除原料失败'));
  }
}

/**
 * 获取相关推荐产品 — 按标签相似度自动匹配
 * GET /api/pc-ingredients/:id/related
 */
export async function getRelatedPcIngredients(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json(fail('无效的产品ID'));

    const product = await prisma.pcIngredient.findUnique({ where: { id } });
    if (!product) return res.status(404).json(fail('产品不存在'));

    // 获取当前产品的所有标签
    const currentTags = [
      ...tagToArray(product.functionalityTag),
      ...tagToArray(product.applicationTag),
      ...tagToArray(product.conceptTag),
      ...tagToArray(product.claimTag),
      ...tagToArray(product.characteristicTag),
      ...tagToArray(product.naturalityLabel),
    ];

    // 获取所有已发布的其他产品
    const allProducts = await prisma.pcIngredient.findMany({
      where: { id: { not: id }, isPublished: true },
    });

    // 按共享标签数量评分
    const scored = allProducts.map((other) => {
      const otherTags = [
        ...tagToArray(other.functionalityTag),
        ...tagToArray(other.applicationTag),
        ...tagToArray(other.conceptTag),
        ...tagToArray(other.claimTag),
        ...tagToArray(other.characteristicTag),
        ...tagToArray(other.naturalityLabel),
      ];
      const sharedCount = currentTags.filter((t) => otherTags.includes(t)).length;
      return { product: other, score: sharedCount };
    });

    // 过滤掉得分为0的，按得分降序排列，取前6条
    const related = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((s) => parsePcIngredient(s.product));

    return res.json(success(related));
  } catch (error) {
    console.error('获取相关产品失败:', error);
    return res.status(500).json(fail('获取相关产品失败'));
  }
}

/**
 * 批量删除产品
 * POST /api/pc-ingredients/batch-delete
 */
export async function batchDeletePcIngredients(req: Request, res: Response) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(fail('请选择要删除的产品'));
    }
    await prisma.pcIngredient.deleteMany({
      where: { id: { in: ids } },
    });
    return res.json(success(null, `成功删除 ${ids.length} 个产品`));
  } catch (error) {
    console.error('批量删除失败:', error);
    return res.status(500).json(fail('批量删除失败'));
  }
}

/**
 * 批量发布/取消发布
 */
export async function batchPublishPcIngredients(req: Request, res: Response) {
  try {
    const { ids, isPublished } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(fail('请选择要操作的产品'));
    }

    await prisma.pcIngredient.updateMany({
      where: { id: { in: ids } },
      data: { isPublished: !!isPublished },
    });

    return res.json(success(null, `${isPublished ? '发布' : '取消发布'}成功`));
  } catch (error) {
    console.error('批量操作失败:', error);
    return res.status(500).json(fail('批量操作失败'));
  }
}

// ===== 工具函数 =====

/** 将逗号分隔字符串转为数组 */
function parsePcIngredient(item: any) {
  return {
    ...item,
    functionalityTag: tagToArray(item.functionalityTag),
    applicationTag: tagToArray(item.applicationTag),
    conceptTag: tagToArray(item.conceptTag),
    claimTag: tagToArray(item.claimTag),
    characteristicTag: tagToArray(item.characteristicTag),
    naturalityLabel: tagToArray(item.naturalityLabel),
  };
}

/** 标签字符串转数组 */
function tagToArray(tag: string | null | undefined): string[] {
  if (!tag) return [];
  return tag.split(',').map((t) => t.trim()).filter(Boolean);
}

/** 数组或字符串转逗号分隔标签 */
function arrayToTag(val: string | string[] | undefined): string {
  if (!val) return '';
  if (Array.isArray(val)) return val.join(',');
  return val;
}
