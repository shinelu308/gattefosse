import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { listNews, getNewsItem, createNewsItem, updateNewsItem, deleteNewsItem, listNewsTags, incrementNewsViews, batchDeleteNews } from '../controllers/news.controller';
import { importArticleFromSite, applyDocxTranslation } from '../controllers/import.controller';
import { uploadTranslationDoc } from '../middleware/upload';

const router = Router();

// 公开接口（tags和views必须在:id之前，避免路由冲突）
router.get('/tags/list', listNewsTags);
router.put('/:id/views', incrementNewsViews);
router.get('/', listNews);
router.get('/:id', getNewsItem);

// 管理接口（batch-delete 必须在 /:id 之前注册）
router.post('/batch-delete', authMiddleware, requireRole('super_admin'), batchDeleteNews);
router.post('/import-from-site', authMiddleware, requireRole('editor', 'super_admin'), importArticleFromSite);
router.post('/:id/apply-docx', authMiddleware, requireRole('editor', 'super_admin'), uploadTranslationDoc.single('file'), applyDocxTranslation);
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createNewsItem);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateNewsItem);
router.delete('/:id', authMiddleware, requireRole('super_admin'), deleteNewsItem);

export default router;
