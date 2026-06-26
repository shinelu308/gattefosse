import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { listNews, getNewsItem, createNewsItem, updateNewsItem, deleteNewsItem } from '../controllers/news.controller';

const router = Router();

// 公开接口
router.get('/', listNews);
router.get('/:id', getNewsItem);

// 管理接口
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createNewsItem);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateNewsItem);
router.delete('/:id', authMiddleware, requireRole('super_admin'), deleteNewsItem);

export default router;
