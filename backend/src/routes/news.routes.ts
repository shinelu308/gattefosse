import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { listNews, getNewsItem, createNewsItem, updateNewsItem, deleteNewsItem, listNewsTags, incrementNewsViews } from '../controllers/news.controller';

const router = Router();

// 公开接口（tags和views必须在:id之前，避免路由冲突）
router.get('/tags/list', listNewsTags);
router.put('/:id/views', incrementNewsViews);
router.get('/', listNews);
router.get('/:id', getNewsItem);

// 管理接口
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createNewsItem);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateNewsItem);
router.delete('/:id', authMiddleware, requireRole('super_admin'), deleteNewsItem);

export default router;
