import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  company: true,
  industry: true,
  jobFunction: true,
  phone: true,
  role: true,
  status: true,
  samlEnabled: true,
  lastLogin: true,
  createdAt: true,
  _count: { select: { favorites: true, sampleOrders: true } },
};

/**
 * 用户列表
 */
export async function listUsers(req: Request, res: Response) {
  try {
    const {
      page = '1',
      limit = '20',
      role,
      status,
      keyword,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};

    if (keyword) {
      const kw = String(keyword);
      where.OR = [
        { email: { contains: kw } },
        { fullName: { contains: kw } },
        { company: { contains: kw } },
      ];
    }

    if (role) {
      where.role = String(role);
    }

    if (status) {
      where.status = String(status);
    }

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.json(
      success(paginate(items, total, pageNum, limitNum), '获取成功')
    );
  } catch (error) {
    console.error('获取用户列表失败:', error);
    return res.status(500).json(fail('获取用户列表失败'));
  }
}

/**
 * 用户详情
 */
export async function getUserById(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });

    if (!user) {
      return res.status(404).json(fail('用户不存在'));
    }

    return res.json(success(user, '获取成功'));
  } catch (error) {
    console.error('获取用户详情失败:', error);
    return res.status(500).json(fail('获取用户详情失败'));
  }
}

/**
 * 编辑用户
 */
export async function updateUser(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('用户不存在'));
    }

    const {
      fullName,
      company,
      industry,
      jobFunction,
      phone,
      role,
      status,
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (company !== undefined) updateData.company = company;
    if (industry !== undefined) updateData.industry = industry;
    if (jobFunction !== undefined) updateData.jobFunction = jobFunction;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (status !== undefined) updateData.status = status;

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: USER_SELECT,
    });

    return res.json(success(user, '更新成功'));
  } catch (error) {
    console.error('更新用户失败:', error);
    return res.status(500).json(fail('更新用户失败'));
  }
}

/**
 * 用户状态管理（审核/启用/禁用）
 */
export async function updateUserStatus(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;

    if (!status || !['active', 'disabled', 'pending'].includes(status)) {
      return res.status(400).json(fail('无效状态值，允许: active, disabled, pending'));
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('用户不存在'));
    }

    const user = await prisma.user.update({
      where: { id },
      data: { status },
      select: USER_SELECT,
    });

    return res.json(success(user, '状态更新成功'));
  } catch (error) {
    console.error('更新用户状态失败:', error);
    return res.status(500).json(fail('更新用户状态失败'));
  }
}

/**
 * 删除用户
 */
export async function deleteUser(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('用户不存在'));
    }

    // 不允许删除自己
    if (id === req.user?.userId) {
      return res.status(400).json(fail('不能删除自己'));
    }

    await prisma.user.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除用户失败:', error);
    return res.status(500).json(fail('删除用户失败'));
  }
}

/**
 * 用户统计
 */
export async function getUserStats(_req: Request, res: Response) {
  try {
    const [total, active, pending, disabled] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'active' } }),
      prisma.user.count({ where: { status: 'pending' } }),
      prisma.user.count({ where: { status: 'disabled' } }),
    ]);

    return res.json(success({ total, active, pending, disabled }, '获取成功'));
  } catch (error) {
    console.error('获取用户统计失败:', error);
    return res.status(500).json(fail('获取用户统计失败'));
  }
}
