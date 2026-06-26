import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

const ORDER_INCLUDE = {
  user: { select: { id: true, fullName: true, email: true, company: true } },
  items: true,
};

const ORDER_STATUSES = ['draft', 'submitted', 'processing', 'shipped', 'completed', 'cancelled'] as const;

/**
 * 管理端 - 获取全部样品订单列表
 */
export async function listAllOrders(req: Request, res: Response) {
  try {
    const {
      page = '1',
      limit = '20',
      status,
      keyword,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};

    if (keyword) {
      const kw = String(keyword);
      where.OR = [
        { orderNumber: { contains: kw } },
        { companyName: { contains: kw } },
        { contactName: { contains: kw } },
        { email: { contains: kw } },
      ];
    }

    if (status) {
      where.status = String(status);
    }

    const [total, items] = await Promise.all([
      prisma.sampleOrder.count({ where }),
      prisma.sampleOrder.findMany({
        where,
        include: ORDER_INCLUDE,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.json(
      success(paginate(items, total, pageNum, limitNum), '获取成功')
    );
  } catch (error) {
    console.error('获取订单列表失败:', error);
    return res.status(500).json(fail('获取订单列表失败'));
  }
}

/**
 * 获取订单详情（含订单明细）
 */
export async function getOrderDetail(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const item = await prisma.sampleOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });

    if (!item) {
      return res.status(404).json(fail('订单不存在'));
    }

    return res.json(success(item, '获取成功'));
  } catch (error) {
    console.error('获取订单详情失败:', error);
    return res.status(500).json(fail('获取订单详情失败'));
  }
}

/**
 * 更新订单状态（状态流转）
 */
export async function updateOrderStatus(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;

    if (!status || !ORDER_STATUSES.includes(status)) {
      return res.status(400).json(fail(`无效的状态值，允许: ${ORDER_STATUSES.join(', ')}`));
    }

    const existing = await prisma.sampleOrder.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('订单不存在'));
    }

    const updateData: Record<string, unknown> = { status };
    if (status === 'submitted' && !existing.submittedAt) {
      updateData.submittedAt = new Date();
    }

    const item = await prisma.sampleOrder.update({
      where: { id },
      data: updateData,
      include: ORDER_INCLUDE,
    });

    return res.json(success(item, '状态更新成功'));
  } catch (error) {
    console.error('更新订单状态失败:', error);
    return res.status(500).json(fail('更新订单状态失败'));
  }
}

/**
 * 创建订单（从购物车提交）
 */
export async function createOrder(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const { companyName, contactName, phone, address, notes } = req.body;

    // 获取购物车商品
    const cartItems = await prisma.cartItem.findMany({ where: { userId } });
    if (cartItems.length === 0) {
      return res.status(400).json(fail('购物车为空'));
    }

    // 生成订单号
    const orderNumber = 'SO' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

    // 创建订单
    const order = await prisma.sampleOrder.create({
      data: {
        userId,
        orderNumber,
        status: 'submitted',
        companyName: companyName || null,
        contactName: contactName || null,
        phone: phone || null,
        address: address || null,
        notes: notes || null,
        submittedAt: new Date(),
        items: {
          create: cartItems.map(item => ({
            productType: item.productType,
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      },
      include: ORDER_INCLUDE,
    });

    // 清空购物车
    await prisma.cartItem.deleteMany({ where: { userId } });

    return res.json(success(order, '订单提交成功'));
  } catch (error) {
    console.error('创建订单失败:', error);
    return res.status(500).json(fail('创建订单失败'));
  }
}

/**
 * 提交反馈（公开接口，无需登录）
 */
export async function submitFeedback(req: Request, res: Response) {
  try {
    const { fullName, email, phone, company, message, productInterest } = req.body;

    if (!fullName || !email || !message) {
      return res.status(400).json(fail('姓名、邮箱和留言为必填项'));
    }

    // 生成订单号
    const orderNumber = 'FB' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

    const order = await prisma.sampleOrder.create({
      data: {
        orderNumber,
        status: 'draft',
        companyName: company || null,
        contactName: fullName,
        email,
        phone: phone || null,
        notes: `[反馈] ${message}${productInterest ? ' | 兴趣产品: ' + productInterest : ''}`,
      },
    });

    return res.json(success(order, '反馈提交成功'));
  } catch (error) {
    console.error('提交反馈失败:', error);
    return res.status(500).json(fail('提交反馈失败'));
  }
}

/**
 * 获取当前用户的订单列表
 */
export async function listMyOrders(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    const { page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const [total, items] = await Promise.all([
      prisma.sampleOrder.count({ where: { userId } }),
      prisma.sampleOrder.findMany({
        where: { userId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    return res.json(success({
      list: items,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    }));
  } catch (error) {
    console.error('获取我的订单失败:', error);
    return res.status(500).json(fail('获取我的订单失败'));
  }
}

/**
 * 获取订单统计
 */
export async function getOrderStats(_req: Request, res: Response) {
  try {
    const [total, submitted, processing, shipped, completed, draftOrders] = await Promise.all([
      prisma.sampleOrder.count(),
      prisma.sampleOrder.count({ where: { status: 'submitted' } }),
      prisma.sampleOrder.count({ where: { status: 'processing' } }),
      prisma.sampleOrder.count({ where: { status: 'shipped' } }),
      prisma.sampleOrder.count({ where: { status: 'completed' } }),
      prisma.sampleOrder.count({ where: { status: 'draft' } }),
    ]);

    return res.json(success({
      total,
      draft: draftOrders,
      submitted,
      processing,
      shipped,
      completed,
    }, '获取成功'));
  } catch (error) {
    console.error('获取订单统计失败:', error);
    return res.status(500).json(fail('获取订单统计失败'));
  }
}
