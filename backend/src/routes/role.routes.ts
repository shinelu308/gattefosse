import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { fail } from '../utils/response';
import { listRoles, createRole, updateRole, deleteRole } from '../controllers/role.controller';

// 角色管理写操作仅超级管理员可用（与员工管理一致）
const router = Router();

// 列表对所有登录的后台员工只读开放：主框架侧栏/徽章需要按角色 key 渲染角色名。
// C 端会员（role=user）与未登录一律拒绝。
const staffOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role === 'user') {
    return res.status(403).json(fail('权限不足', 403));
  }
  next();
};

router.get('/', authMiddleware, staffOnly, listRoles);
router.post('/', authMiddleware, requireRole('super_admin'), createRole);
router.put('/:id', authMiddleware, requireRole('super_admin'), updateRole);
router.delete('/:id', authMiddleware, requireRole('super_admin'), deleteRole);

export default router;
