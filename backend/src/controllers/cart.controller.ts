import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';

/**
 * 获取购物车列表
 */
export async function listCart(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;

    const items = await prisma.cartItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // 为每个购物车项获取产品详情
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        let productDetail: Record<string, unknown> | null = null;

        if (item.productType === 'pc_ingredient') {
          productDetail = await prisma.pcIngredient.findUnique({
            where: { id: item.productId },
            select: {
              id: true, name: true, inciName: true, imageUrl: true,
              description: true, dosage: true, isPublished: true,
            },
          });
        } else if (item.productType === 'pharma') {
          productDetail = await prisma.pharmaProduct.findUnique({
            where: { id: item.productId },
            select: {
              id: true, name: true, description: true, imageUrl: true,
              isPublished: true,
            },
          });
        }

        return {
          id: item.id,
          productType: item.productType,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          createdAt: item.createdAt,
          product: productDetail,
        };
      })
    );

    return res.json(success(enrichedItems));
  } catch (error) {
    console.error('获取购物车失败:', error);
    return res.status(500).json(fail('获取购物车失败'));
  }
}

/**
 * 获取购物车数量
 */
export async function cartCount(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const count = await prisma.cartItem.count({ where: { userId } });
    return res.json(success({ count }));
  } catch (error) {
    console.error('获取购物车数量失败:', error);
    return res.status(500).json(fail('获取购物车数量失败'));
  }
}

/**
 * 添加商品到购物车
 */
export async function addToCart(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const { productType, productId, productName, quantity } = req.body;

    if (!productType || !productId || !productName) {
      return res.status(400).json(fail('产品类型、ID和名称为必填项'));
    }

    // 检查是否已存在
    const existing = await prisma.cartItem.findUnique({
      where: {
        userId_productType_productId: { userId, productType, productId },
      },
    });

    if (existing) {
      // 已存在则更新数量
      const updated = await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + (quantity || 1) },
      });
      return res.json(success(updated, '已更新购物车数量'));
    }

    const item = await prisma.cartItem.create({
      data: {
        userId,
        productType,
        productId,
        productName,
        quantity: quantity || 1,
      },
    });

    return res.json(success(item, '已添加到购物车'));
  } catch (error) {
    console.error('添加购物车失败:', error);
    return res.status(500).json(fail('添加购物车失败'));
  }
}

/**
 * 更新购物车项数量
 */
export async function updateCartItem(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const itemId = parseInt(req.params.id);
    const { quantity } = req.body;

    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) {
      return res.status(404).json(fail('购物车项不存在'));
    }

    if (quantity !== undefined && quantity <= 0) {
      // 数量为0则删除
      await prisma.cartItem.delete({ where: { id: itemId } });
      return res.json(success(null, '已从购物车移除'));
    }

    const updated = await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
    });

    return res.json(success(updated, '已更新'));
  } catch (error) {
    console.error('更新购物车失败:', error);
    return res.status(500).json(fail('更新购物车失败'));
  }
}

/**
 * 从购物车删除项
 */
export async function removeFromCart(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const itemId = parseInt(req.params.id);

    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) {
      return res.status(404).json(fail('购物车项不存在'));
    }

    await prisma.cartItem.delete({ where: { id: itemId } });

    return res.json(success(null, '已从购物车移除'));
  } catch (error) {
    console.error('删除购物车项失败:', error);
    return res.status(500).json(fail('删除购物车项失败'));
  }
}

/**
 * 清空购物车
 */
export async function clearCart(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    await prisma.cartItem.deleteMany({ where: { userId } });
    return res.json(success(null, '购物车已清空'));
  } catch (error) {
    console.error('清空购物车失败:', error);
    return res.status(500).json(fail('清空购物车失败'));
  }
}
