import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { hashPassword, comparePassword } from '../utils/hash';
import { signToken } from '../utils/jwt';
import { success, fail } from '../utils/response';
import { z } from 'zod';

// 登录验证 Schema
const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6位'),
});

// 注册验证 Schema
const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6位'),
  fullName: z.string().min(1, '姓名不能为空'),
  company: z.string().optional(),
  phone: z.string().optional(),
});

/**
 * 用户登录
 */
export async function login(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(fail(parsed.error.errors[0].message));
    }

    const { email, password } = parsed.data;

    // 查找用户
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json(fail('邮箱或密码错误'));
    }

    // 验证密码
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return res.status(400).json(fail('邮箱或密码错误'));
    }

    // 检查状态
    if (user.status !== 'active') {
      return res.status(403).json(fail('账号未激活，请联系管理员'));
    }

    // 更新最后登录时间
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // 签发 Token
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return res.json(success({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
      },
    }, '登录成功'));
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json(fail('服务器错误'));
  }
}

/**
 * 用户注册
 */
export async function register(req: Request, res: Response) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(fail(parsed.error.errors[0].message));
    }

    const { email, password, fullName, company, phone } = parsed.data;

    // 检查邮箱是否已存在
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json(fail('该邮箱已注册'));
    }

    // 哈希密码
    const passwordHash = await hashPassword(password);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        company,
        phone,
        role: 'user',
        status: 'pending', // 需要管理员审核
      },
    });

    return res.json(success({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
    }, '注册成功，请等待管理员审核'));
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json(fail('服务器错误'));
  }
}

/**
 * 获取当前用户信息
 */
export async function me(req: Request, res: Response) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        company: true,
        role: true,
        status: true,
        lastLogin: true,
      },
    });

    if (!user) {
      return res.status(404).json(fail('用户不存在'));
    }

    return res.json(success(user));
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json(fail('服务器错误'));
  }
}
