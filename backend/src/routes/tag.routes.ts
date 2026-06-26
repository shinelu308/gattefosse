import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getTagDictionary, listTags, createTag, updateTag, deleteTag } from '../controllers/tag.controller';

const router = Router();

// 公开接口
// GET /api/tags?productLine=pc  -> 个人护理标签字典（分组）
// GET /api/tags?productLine=pharma -> 药用辅料标签字典
// GET /api/tags  -> 全部标签
router.get('/', getTagDictionary);

// 管理接口（需登录）
router.get('/list', authMiddleware, listTags);
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createTag);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateTag);
router.delete('/:id', authMiddleware, requireRole('editor', 'super_admin'), deleteTag);

export default router;
