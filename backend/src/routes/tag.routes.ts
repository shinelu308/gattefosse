import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import {
  getTagDictionary,
  listTags,
  createTag,
  updateTag,
  deleteTag,
  applyTagToArticles,
  getTagHealth,
  fillTagMissing,
  getTagLines,
} from '../controllers/tag.controller';

const router = Router();

// 公开接口
// GET /api/tags?productLine=pc  -> 个人护理标签字典（分组）
// GET /api/tags?productLine=pharma -> 药用辅料标签字典
// GET /api/tags  -> 全部标签
//   ?withCount=1 额外附带每个值的命中产品数（前台可把 0 命中的项置灰）
router.get('/', getTagDictionary);

// 管理接口（需登录）
router.get('/list', authMiddleware, listTags);

// ⚠️ 注意顺序：/health 等固定路径必须排在 /:id 之前，
//    否则 GET /api/tags/health 会被当成 id 参数路由吃掉。
router.get('/lines', authMiddleware, getTagLines);
router.get('/health', authMiddleware, getTagHealth);
router.post('/health/fill', authMiddleware, requireRole('editor', 'super_admin'), fillTagMissing);

router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createTag);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateTag);
router.delete('/:id', authMiddleware, requireRole('editor', 'super_admin'), deleteTag);
// 文章主题标签：字典译文一键同步到全部存量文章
router.post('/:id/apply', authMiddleware, requireRole('editor', 'super_admin'), applyTagToArticles);

export default router;
