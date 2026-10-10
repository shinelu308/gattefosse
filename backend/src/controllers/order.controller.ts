import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';
import { sendOrderNotifications, getSmtpConfig, type OrderMailItem } from '../utils/mailer';

const ORDER_INCLUDE = {
  user: { select: { id: true, fullName: true, email: true, company: true } },
  items: true,
};

const ORDER_STATUSES = ['draft', 'submitted', 'processing', 'shipped', 'completed', 'cancelled'] as const;

/**
 * 订单明细 → 邮件/后台展示用的「样品名称」清单
 * items 只存 productType + productId，名称需按类型反查产品表
 */
async function resolveOrderItems(
  items: Array<{ productType: string; productId: number; quantity: number }>
): Promise<Array<OrderMailItem & { productType: string; productId: number }>> {
  const pcIds = items.filter((i) => i.productType === 'pc_ingredient').map((i) => i.productId);
  const phIds = items.filter((i) => i.productType === 'pharma').map((i) => i.productId);

  const [pcs, phs] = await Promise.all([
    pcIds.length
      ? prisma.pcIngredient.findMany({ where: { id: { in: pcIds } }, select: { id: true, name: true, inciName: true } })
      : Promise.resolve([] as Array<{ id: number; name: string; inciName: string | null }>),
    phIds.length
      ? prisma.pharmaProduct.findMany({ where: { id: { in: phIds } }, select: { id: true, name: true, inciName: true } })
      : Promise.resolve([] as Array<{ id: number; name: string; inciName: string | null }>),
  ]);

  const nameMap = new Map<string, { name: string; inciName: string | null }>();
  pcs.forEach((p) => nameMap.set(`pc_ingredient:${p.id}`, { name: p.name, inciName: p.inciName }));
  phs.forEach((p) => nameMap.set(`pharma:${p.id}`, { name: p.name, inciName: p.inciName }));

  return items.map((i) => {
    const hit = nameMap.get(`${i.productType}:${i.productId}`);
    return {
      productType: i.productType,
      productId: i.productId,
      name: hit ? hit.name : `#${i.productId}`,
      code: hit && hit.inciName ? hit.inciName : null,
      quantity: i.quantity,
    };
  });
}

/** 订单 → 邮件负载（含已反查的样品名称） */
async function buildOrderMailPayload(order: {
  id: number;
  orderNumber: string;
  status: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  adminNote?: string | null;
  items?: Array<{ productType: string; productId: number; quantity: number }>;
}) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    companyName: order.companyName,
    contactName: order.contactName,
    email: order.email,
    phone: order.phone,
    address: order.address,
    notes: order.notes,
    adminNote: order.adminNote ?? null,
    items: order.items && order.items.length ? await resolveOrderItems(order.items) : [],
  };
}

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

    // 附带样品名称（明细表只存 productId）
    const items = await resolveOrderItems(item.items);

    return res.json(success({ ...item, itemsResolved: items }, '获取成功'));
  } catch (error) {
    console.error('获取订单详情失败:', error);
    return res.status(500).json(fail('获取订单详情失败'));
  }
}

/** SMTP 是否已配置（用于给后台返回如实的「邮件是否已发出」提示） */
async function smtpReady(): Promise<boolean> {
  try {
    return !!(await getSmtpConfig());
  } catch {
    return false;
  }
}

/**
 * 更新订单状态（状态流转）
 * 审核动作与邮件推送绑定：状态变更后给会员发「审批结果 + 状态提醒」邮件。
 * 可同时提交 remark（审批意见），会随邮件发送并在订单详情留痕。
 */
export async function updateOrderStatus(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { status, remark } = req.body;

    if (!status || !ORDER_STATUSES.includes(status)) {
      return res.status(400).json(fail(`无效的状态值，允许: ${ORDER_STATUSES.join(', ')}`));
    }

    const existing = await prisma.sampleOrder.findUnique({ where: { id }, include: { items: true } });
    if (!existing) {
      return res.status(404).json(fail('订单不存在'));
    }

    const updateData: Record<string, unknown> = { status };
    if (status === 'submitted' && !existing.submittedAt) {
      updateData.submittedAt = new Date();
    }
    // 审批意见：仅当请求里带 remark 字段时才写（传空串 = 清空）
    if (typeof remark === 'string') {
      updateData.adminNote = remark.trim() || null;
    }

    const item = await prisma.sampleOrder.update({
      where: { id },
      data: updateData,
      include: ORDER_INCLUDE,
    });

    // 邮件推送（不阻塞响应；未配置 SMTP 时静默跳过）
    const statusChanged = existing.status !== status;
    const mailOn = await smtpReady();
    if (statusChanged) {
      void buildOrderMailPayload({ ...item, adminNote: (updateData.adminNote as string | null) ?? existing.adminNote })
        .then((payload) => sendOrderNotifications(payload, { mode: 'status' }))
        .catch((err) => console.error('[order] 状态变更邮件推送异常:', (err as Error).message));
    }

    let tip: string;
    if (!statusChanged) tip = '状态未变化，未发送邮件';
    else if (mailOn) tip = '状态更新成功，已向会员推送状态提醒邮件';
    else tip = '状态更新成功（邮件通知尚未配置，未发送邮件）';

    return res.json(
      success(
        { ...item, mailSent: statusChanged && mailOn ? 'queued' : 'skipped' },
        tip
      )
    );
  } catch (error) {
    console.error('更新订单状态失败:', error);
    return res.status(500).json(fail('更新订单状态失败'));
  }
}

/**
 * 创建订单（从购物车提交）
 * 提交成功后与邮件推送绑定：给会员发「申请已收到」确认邮件，并内部提醒业务同事。
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

    // 会员邮箱：优先 token 内邮箱，回退用户表（订单邮件通知必需）
    let email: string | null = (req.user as { email?: string } | undefined)?.email || null;
    if (!email) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      email = u?.email || null;
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
        email,
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

    // 邮件推送（不阻塞响应；未配置 SMTP 时静默跳过）
    const mailOn = await smtpReady();
    void buildOrderMailPayload(order)
      .then((payload) => sendOrderNotifications(payload, { mode: 'created' }))
      .catch((err) => console.error('[order] 新订单邮件推送异常:', (err as Error).message));

    return res.json(
      success(
        { ...order, mailSent: mailOn ? 'queued' : 'skipped' },
        mailOn ? '订单提交成功，确认邮件已发送' : '订单提交成功（邮件通知尚未配置）'
      )
    );
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
