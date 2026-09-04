import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getVisitOverview } from '../controllers/stats.controller';

const router = Router();

// 访问统计总览（编辑员及以上可见）
router.get('/overview', authMiddleware, requireRole('editor', 'super_admin'), getVisitOverview);

export default router;
