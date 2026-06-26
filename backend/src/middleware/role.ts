import { Request, Response, NextFunction } from 'express';
import { fail } from '../utils/response';

/**
 * 角色权限中间件
 * 用法: requireRole('super_admin') 或 requireRole('editor', 'super_admin')
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json(fail('未认证', 401));
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json(fail('权限不足', 403));
    }
    next();
  };
}
