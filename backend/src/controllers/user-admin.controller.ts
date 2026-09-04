import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { hashPassword } from '../utils/hash';
import { success, fail, paginate } from '../utils/response';

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  company: true,
  industry: true,
  jobFunction: true,
  department: true,
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
      scope,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};

    // scope=member 只显示前台注册会员；scope=staff 只显示后台员工（超管/编辑员）
    if (scope === 'member') {
      where.role = 'user';
    } else if (scope === 'staff') {
      where.role = { in: ['super_admin', 'editor'] };
    }

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
      department,
      phone,
      role,
      status,
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (company !== undefined) updateData.company = company;
    if (industry !== undefined) updateData.industry = industry;
    if (jobFunction !== undefined) updateData.jobFunction = jobFunction;
    if (department !== undefined) updateData.department = department || null;
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
 * 用户统计（仅统计前台注册会员）
 */
export async function getUserStats(_req: Request, res: Response) {
  try {
    const [total, active, pending, disabled] = await Promise.all([
      prisma.user.count({ where: { role: 'user' } }),
      prisma.user.count({ where: { status: 'active', role: 'user' } }),
      prisma.user.count({ where: { status: 'pending', role: 'user' } }),
      prisma.user.count({ where: { status: 'disabled', role: 'user' } }),
    ]);

    return res.json(success({ total, active, pending, disabled }, '获取成功'));
  } catch (error) {
    console.error('获取用户统计失败:', error);
    return res.status(500).json(fail('获取用户统计失败'));
  }
}

/**
 * 创建后台员工账号（企业组织架构内使用）
 */
export async function createStaff(req: Request, res: Response) {
  try {
    const { email, password, fullName, phone, jobFunction, department, role = 'editor' } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json(fail('邮箱、密码、姓名为必填项'));
    }
    if (String(password).length < 6) {
      return res.status(400).json(fail('密码至少 6 位'));
    }
    if (!['super_admin', 'editor'].includes(role)) {
      return res.status(400).json(fail('员工角色只能为超级管理员或编辑员'));
    }

    const exists = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (exists) {
      return res.status(400).json(fail('该邮箱已被使用'));
    }

    const passwordHash = await hashPassword(String(password));
    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase().trim(),
        passwordHash,
        fullName: String(fullName).trim(),
        phone: phone || null,
        jobFunction: jobFunction || null,
        department: department || null,
        role,
        status: 'active',
      },
      select: USER_SELECT,
    });

    return res.json(success(user, '员工创建成功'));
  } catch (error) {
    console.error('创建员工失败:', error);
    return res.status(500).json(fail('创建员工失败'));
  }
}

/**
 * 重置员工密码
 */
export async function resetStaffPassword(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { password } = req.body;
    if (!password || String(password).length < 6) {
      return res.status(400).json(fail('新密码至少 6 位'));
    }
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('用户不存在'));
    }
    const passwordHash = await hashPassword(String(password));
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    return res.json(success(null, '密码已重置'));
  } catch (error) {
    console.error('重置密码失败:', error);
    return res.status(500).json(fail('重置密码失败'));
  }
}
