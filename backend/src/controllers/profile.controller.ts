import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { hashPassword, comparePassword } from '../utils/hash';
import { success, fail } from '../utils/response';
import { z } from 'zod';

/**
 * 个人资料（本人）接口
 * - 全部以 token 中的 userId 为准，只能读写自己的信息（不存在查看/操作他人的入口）
 * - 所有后台员工角色（含自定义角色）可用；C 端会员（role=user）由路由层 staffOnly 拒绝
 */

// 只读展示 + 本人可改字段（role/department/status 等组织属性不在本人可改范围）
const PROFILE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  avatar: true,
  phone: true,
  department: true,
  jobFunction: true,
  role: true,
  status: true,
  lastLogin: true,
} as const;

/**
 * 获取我的资料
 */
export async function getProfile(req: Request, res: Response) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: PROFILE_SELECT,
    });
    if (!user) return res.status(404).json(fail('用户不存在', 404));
    return res.json(success(user));
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json(fail('服务器错误'));
  }
}

// 修改基本资料 Schema（仅本人信息：姓名/电话）
const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, '姓名不能为空').max(50, '姓名过长'),
  phone: z.string().max(30, '电话过长').optional().nullable(),
});

/**
 * 修改我的基本资料（姓名/电话）
 */
export async function updateProfile(req: Request, res: Response) {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(fail(parsed.error.errors[0].message));
    }
    const { fullName, phone } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { id: true } });
    if (!existing) return res.status(404).json(fail('用户不存在', 404));

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { fullName: fullName.trim(), phone: phone || null },
      select: PROFILE_SELECT,
    });
    return res.json(success(user, '资料已更新'));
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json(fail('服务器错误'));
  }
}

// 修改密码 Schema
const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入当前密码'),
  newPassword: z.string().min(6, '新密码至少6位').max(72, '新密码过长'),
});

/**
 * 修改我的密码（需验证当前密码）
 */
export async function changePassword(req: Request, res: Response) {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(fail(parsed.error.errors[0].message));
    }
    const { oldPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) return res.status(404).json(fail('用户不存在', 404));

    // 验证当前密码
    const valid = await comparePassword(oldPassword, user.passwordHash);
    if (!valid) {
      return res.status(400).json(fail('当前密码不正确'));
    }
    if (oldPassword === newPassword) {
      return res.status(400).json(fail('新密码不能与当前密码相同'));
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return res.json(success({ ok: true }, '密码已更新，下次登录请使用新密码'));
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json(fail('服务器错误'));
  }
}
