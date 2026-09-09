import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { listNews, getNewsItem, createNewsItem, updateNewsItem, deleteNewsItem, listNewsTags, incrementNewsViews, batchDeleteNews, aiTranslateNews, aiTranslateStatus } from '../controllers/news.controller';
import { importArticleFromSite, importPublicationsFromSite, backfillPublicationPdfs, importMagazinesFromSite, backfillMagazinePdfs, applyDocxTranslation, reverifyImportedArticle } from '../controllers/import.controller';
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
// 出版物批量导入（从原站出版物列表页抓卡片，PDF 入文档资源）
router.post('/import-publications', authMiddleware, requireRole('editor', 'super_admin'), importPublicationsFromSite);
// 存量出版物 PDF 本地化补抓（旧批次绝对地址 → /uploads/documents + pdfSize）
router.post('/import-publications-backfill-pdfs', authMiddleware, requireRole('editor', 'super_admin'), backfillPublicationPdfs);
// addiactive 杂志导入（原站列表页抓封面卡片，沿用全局去重经验）
router.post('/import-magazines', authMiddleware, requireRole('editor', 'super_admin'), importMagazinesFromSite);
// 杂志 PDF 归档补抓（pdf_url → 文档资源，类型 Magazine）
router.post('/import-magazines-backfill-pdfs', authMiddleware, requireRole('editor', 'super_admin'), backfillMagazinePdfs);
// AI 翻译：启动任务 / 查询进度（必须在 /:id 之前注册）
router.get('/ai-translate/status/:jobId', authMiddleware, requireRole('editor', 'super_admin'), aiTranslateStatus);
router.post('/:id/ai-translate', authMiddleware, requireRole('editor', 'super_admin'), aiTranslateNews);
// 重新校验已导入文章与原站的一致性
router.post('/:id/reverify', authMiddleware, requireRole('editor', 'super_admin'), reverifyImportedArticle);
router.post('/:id/apply-docx', authMiddleware, requireRole('editor', 'super_admin'), uploadTranslationDoc.single('file'), applyDocxTranslation);
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createNewsItem);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateNewsItem);
router.delete('/:id', authMiddleware, requireRole('super_admin'), deleteNewsItem);

export default router;
