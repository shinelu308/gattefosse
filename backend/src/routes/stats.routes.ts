import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getVisitOverview } from '../controllers/stats.controller';
import { getContentHeat } from '../controllers/content-stats.controller';

const router = Router();

// 访问统计总览（编辑员及以上可见）
router.get('/overview', authMiddleware, requireRole('editor', 'super_admin'), getVisitOverview);

// 内容热度：哪个产品 / 资料 / 文章被看得多（数据来自 content_views，业务口径）
router.get('/content-heat', authMiddleware, requireRole('editor', 'super_admin'), getContentHeat);

export default router;
