import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { listCareers, createCareer, updateCareer } from '../controllers/career.controller';

const router = Router();

// 前端公开接口 — 提交求职申请
router.post('/', createCareer);

// 后台管理接口
router.get('/', authMiddleware, requireRole('editor', 'super_admin'), listCareers);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateCareer);

export default router;
