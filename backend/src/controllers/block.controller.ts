import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';

/**
 * 获取产品的所有内容区块 — 按 sortOrder 排序
 */
export async function listBlocks(req: Request, res: Response) {
  try {
    const { productId, productType = 'pc' } = req.query;
    if (!productId) {
      return res.status(400).json(fail('缺少 productId 参数'));
    }
    const blocks = await prisma.contentBlock.findMany({
      where: {
        productId: parseInt(String(productId)),
        productType: String(productType),
        isPublished: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
    // content 字段是 JSON 字符串，自动解析
    const parsed = blocks.map((b) => ({
      ...b,
      content: b.content ? JSON.parse(b.content) : null,
    }));
    return res.json(success(parsed));
  } catch (e: any) {
    return res.status(500).json(fail('获取区块失败: ' + e.message, 500));
  }
}

/**
 * 创建内容区块 (admin)
 */
export async function createBlock(req: Request, res: Response) {
  try {
    const { productId, productType, blockType, title, content, sortOrder } = req.body;
    if (!productId || !blockType) {
      return res.status(400).json(fail('缺少必填字段: productId, blockType'));
    }
    // 如果没有指定 sortOrder，放到最后
    let order = sortOrder;
    if (order === undefined || order === null) {
      const last = await prisma.contentBlock.findFirst({
        where: { productId, productType: productType || 'pc' },
        orderBy: { sortOrder: 'desc' },
      });
      order = last ? last.sortOrder + 1 : 0;
    }
    const block = await prisma.contentBlock.create({
      data: {
        productId: parseInt(productId),
        productType: productType || 'pc',
        blockType,
        title: title || null,
        content: content ? JSON.stringify(content) : null,
        sortOrder: order,
      },
    });
    return res.json(success(block, '区块创建成功'));
  } catch (e: any) {
    return res.status(500).json(fail('创建区块失败: ' + e.message, 500));
  }
}

/**
 * 更新内容区块 (admin)
 */
export async function updateBlock(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { blockType, title, content, sortOrder, isPublished } = req.body;
    const data: Record<string, unknown> = {};
    if (blockType !== undefined) data.blockType = blockType;
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = JSON.stringify(content);
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isPublished !== undefined) data.isPublished = isPublished;
    const block = await prisma.contentBlock.update({
      where: { id },
      data,
    });
    return res.json(success(block, '区块更新成功'));
  } catch (e: any) {
    return res.status(500).json(fail('更新区块失败: ' + e.message, 500));
  }
}

/**
 * 删除内容区块 (admin)
 */
export async function deleteBlock(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    await prisma.contentBlock.delete({ where: { id } });
    return res.json(success(null, '区块删除成功'));
  } catch (e: any) {
    return res.status(500).json(fail('删除区块失败: ' + e.message, 500));
  }
}

/**
 * 批量排序内容区块 (admin)
 * body: { items: [{ id: 1, sortOrder: 0 }, { id: 2, sortOrder: 1 }, ...] }
 */
export async function reorderBlocks(req: Request, res: Response) {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json(fail('缺少 items 数组'));
    }
    await prisma.$transaction(
      items.map((item: { id: number; sortOrder: number }) =>
        prisma.contentBlock.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );
    return res.json(success(null, '排序更新成功'));
  } catch (e: any) {
    return res.status(500).json(fail('排序更新失败: ' + e.message, 500));
  }
}
