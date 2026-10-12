import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getProfile, updateProfile, changePassword } from '../controllers/profile.controller';
import { fail } from '../utils/response';

const router = Router();

// 个人资料仅对后台员工开放（C 端会员 role=user 走前台，不进后台）
const staffOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json(fail('未认证', 401));
  if (req.user.role === 'user') return res.status(403).json(fail('后台仅企业员工可用', 403));
  next();
};

// 我的资料（以 token 身份为准，只能看自己）
router.get('/', authMiddleware, staffOnly, getProfile);
// 修改我的基本资料（姓名/电话）
router.put('/', authMiddleware, staffOnly, updateProfile);
// 修改我的密码（验证当前密码）
router.put('/password', authMiddleware, staffOnly, changePassword);

export default router;
