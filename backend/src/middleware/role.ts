import { Request, Response, NextFunction } from 'express';
import { fail } from '../utils/response';

/**
 * 角色权限中间件
 * 用法: requireRole('super_admin') 或 requireRole('editor', 'super_admin')
 *
 * 语义约定（2026-10-13 角色管理上线后）：
 * - requireRole('super_admin')      → 仅超级管理员（用户/角色/系统设置等管理面）
 * - requireRole('editor', 'super_admin') → 「员工级」接口：任意后台员工角色放行
 *   （roles 表登记的自定义角色与 editor 同级；C 端会员 role=user 一律拒绝。
 *    菜单可见性由角色管理的「查看」矩阵控制，后端写能力员工级一致）
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json(fail('未认证', 401));
    }
    const isStaffLevel = roles.includes('editor') && req.user.role !== 'user';
    if (!roles.includes(req.user.role) && !isStaffLevel) {
      return res.status(403).json(fail('权限不足', 403));
    }
    next();
  };
}
