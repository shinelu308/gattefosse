import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

const FORMULATION_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
};

/**
 * 获取配方列表 - 支持多维标签筛选 + 分页 + 搜索
 */
export async function listFormulations(req: Request, res: Response) {
  try {
    const {
      page = '1',
      limit = '20',
      keyword,
      application,
      form,
      claim,
      naturalityIndex,
      isPublished,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};

    if (keyword) {
      const kw = String(keyword);
      where.OR = [
        { name: { contains: kw } },
        { code: { contains: kw } },
        { description: { contains: kw } },
      ];
    }

    const tagFilters: [string, string | undefined][] = [
      ['applicationTag', application as string],
      ['formTag', form as string],
      ['claimTag', claim as string],
    ];
    for (const [field, val] of tagFilters) {
      if (val) {
        const vals = String(val).split(',').filter(Boolean);
        if (vals.length > 0) {
          where[field] = { contains: vals[0] };
        }
      }
    }

    if (naturalityIndex) {
      where.naturalityIndex = String(naturalityIndex);
    }

    if (isPublished !== undefined && isPublished !== '') {
      where.isPublished = String(isPublished) === 'true';
    }

    const [total, items] = await Promise.all([
      prisma.formulation.count({ where }),
      prisma.formulation.findMany({
        where,
        include: FORMULATION_INCLUDE,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    return res.json(
      success(
        paginate(
          items.map(formatFormulation),
          total,
          pageNum,
          limitNum
        ),
        '获取成功'
      )
    );
  } catch (error) {
    console.error('获取配方列表失败:', error);
    return res.status(500).json(fail('获取配方列表失败'));
  }
}

/**
 * 获取配方详情
 */
export async function getFormulation(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const item = await prisma.formulation.findUnique({
      where: { id },
      include: {
        ...FORMULATION_INCLUDE,
        docFormulations: {
          include: { document: true },
        },
      },
    });

    if (!item) {
      return res.status(404).json(fail('配方不存在'));
    }

    return res.json(success(formatFormulation(item), '获取成功'));
  } catch (error) {
    console.error('获取配方详情失败:', error);
    return res.status(500).json(fail('获取配方详情失败'));
  }
}

/**
 * 创建配方
 */
export async function createFormulation(req: Request, res: Response) {
  try {
    const {
      name,
      code,
      description,
      imageUrl,
      pdfPath,
      applicationTag,
      formTag,
      claimTag,
      naturalityIndex,
      compositionText,
      preparationSteps,
      sortOrder,
      isPublished,
    } = req.body;

    if (!name) {
      return res.status(400).json(fail('配方名称不能为空'));
    }

    const item = await prisma.formulation.create({
      data: {
        name,
        code: code || null,
        description: description || null,
        imageUrl: imageUrl || null,
        pdfPath: pdfPath || null,
        applicationTag: Array.isArray(applicationTag) ? applicationTag.join(',') : (applicationTag || ''),
        formTag: Array.isArray(formTag) ? formTag.join(',') : (formTag || ''),
        claimTag: Array.isArray(claimTag) ? claimTag.join(',') : (claimTag || ''),
        naturalityIndex: naturalityIndex || null,
        compositionText: compositionText || null,
        preparationSteps: preparationSteps || null,
        sortOrder: sortOrder || 0,
        isPublished: isPublished || false,
        createdById: req.user?.userId || null,
      },
      include: FORMULATION_INCLUDE,
    });

    return res.json(success(formatFormulation(item), '创建成功'));
  } catch (error) {
    console.error('创建配方失败:', error);
    return res.status(500).json(fail('创建配方失败'));
  }
}

/**
 * 更新配方
 */
export async function updateFormulation(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.formulation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('配方不存在'));
    }

    const {
      name,
      code,
      description,
      imageUrl,
      pdfPath,
      applicationTag,
      formTag,
      claimTag,
      naturalityIndex,
      compositionText,
      preparationSteps,
      sortOrder,
      isPublished,
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code || null;
    if (description !== undefined) updateData.description = description || null;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl || null;
    if (pdfPath !== undefined) updateData.pdfPath = pdfPath || null;
    if (applicationTag !== undefined) updateData.applicationTag = Array.isArray(applicationTag) ? applicationTag.join(',') : applicationTag;
    if (formTag !== undefined) updateData.formTag = Array.isArray(formTag) ? formTag.join(',') : formTag;
    if (claimTag !== undefined) updateData.claimTag = Array.isArray(claimTag) ? claimTag.join(',') : claimTag;
    if (naturalityIndex !== undefined) updateData.naturalityIndex = naturalityIndex || null;
    if (compositionText !== undefined) updateData.compositionText = compositionText || null;
    if (preparationSteps !== undefined) updateData.preparationSteps = preparationSteps || null;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (isPublished !== undefined) updateData.isPublished = isPublished;

    const item = await prisma.formulation.update({
      where: { id },
      data: updateData,
      include: FORMULATION_INCLUDE,
    });

    return res.json(success(formatFormulation(item), '更新成功'));
  } catch (error) {
    console.error('更新配方失败:', error);
    return res.status(500).json(fail('更新配方失败'));
  }
}

/**
 * 删除配方
 */
export async function deleteFormulation(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.formulation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('配方不存在'));
    }

    await prisma.formulation.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除配方失败:', error);
    return res.status(500).json(fail('删除配方失败'));
  }
}

/**
 * 批量删除配方
 */
export async function batchDeleteFormulations(req: Request, res: Response) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(fail('请选择要删除的配方'));
    }
    await prisma.formulation.deleteMany({
      where: { id: { in: ids } },
    });
    return res.json(success(null, `成功删除 ${ids.length} 个配方`));
  } catch (error) {
    console.error('批量删除失败:', error);
    return res.status(500).json(fail('批量删除失败'));
  }
}

/** 逗号分隔字符串转数组 */
function splitTags(str: string): string[] {
  if (!str) return [];
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

/** 格式化配方输出 */
function formatFormulation(item: any) {
  return {
    ...item,
    applicationTag: splitTags(item.applicationTag),
    formTag: splitTags(item.formTag),
    claimTag: splitTags(item.claimTag),
  };
}
