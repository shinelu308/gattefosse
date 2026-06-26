import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

/**
 * 获取我的收藏列表
 */
export async function listMyFavorites(req: Request, res: Response) {
  try {
    const {
      page = '1',
      limit = '20',
      itemType,
    } = req.query;

    const userId = req.user!.userId;
    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = { userId };
    if (itemType) {
      where.itemType = String(itemType);
    }

    const [total, items] = await Promise.all([
      prisma.userFavorite.count({ where }),
      prisma.userFavorite.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.json(
      success(paginate(items, total, pageNum, limitNum), '获取成功')
    );
  } catch (error) {
    console.error('获取收藏列表失败:', error);
    return res.status(500).json(fail('获取收藏列表失败'));
  }
}

/**
 * 添加收藏
 */
export async function addFavorite(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const { itemType, itemId } = req.body;

    if (!itemType || !itemId) {
      return res.status(400).json(fail('itemType 和 itemId 不能为空'));
    }

    if (!['pc_ingredient', 'pharma', 'formulation'].includes(itemType)) {
      return res.status(400).json(fail('itemType 无效，允许: pc_ingredient, pharma, formulation'));
    }

    // 检查是否已经收藏
    const existing = await prisma.userFavorite.findUnique({
      where: {
        userId_itemType_itemId: { userId, itemType, itemId },
      },
    });

    if (existing) {
      return res.json(success(existing, '已收藏'));
    }

    const favorite = await prisma.userFavorite.create({
      data: { userId, itemType, itemId },
    });

    return res.json(success(favorite, '收藏成功'));
  } catch (error) {
    console.error('添加收藏失败:', error);
    return res.status(500).json(fail('添加收藏失败'));
  }
}

/**
 * 取消收藏
 */
export async function removeFavorite(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;

    const existing = await prisma.userFavorite.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('收藏不存在'));
    }

    if (existing.userId !== userId) {
      return res.status(403).json(fail('无权操作他人收藏'));
    }

    await prisma.userFavorite.delete({ where: { id } });
    return res.json(success(null, '取消收藏成功'));
  } catch (error) {
    console.error('取消收藏失败:', error);
    return res.status(500).json(fail('取消收藏失败'));
  }
}

/**
 * 检查是否收藏
 */
export async function checkFavorite(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const { itemType, itemId } = req.query;

    if (!itemType || !itemId) {
      return res.status(400).json(fail('itemType 和 itemId 不能为空'));
    }

    const favorite = await prisma.userFavorite.findUnique({
      where: {
        userId_itemType_itemId: {
          userId,
          itemType: String(itemType),
          itemId: parseInt(String(itemId)),
        },
      },
    });

    return res.json(success({ isFavorited: !!favorite, favoriteId: favorite?.id || null }));
  } catch (error) {
    console.error('检查收藏状态失败:', error);
    return res.status(500).json(fail('检查收藏状态失败'));
  }
}
