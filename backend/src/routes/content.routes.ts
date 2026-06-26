import { Router } from 'express';
import { authMiddleware as auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import {
  getPageContent,
  listAllPages,
  savePageContent,
  listSubsidiaries,
  createSubsidiary,
  updateSubsidiary,
  deleteSubsidiary,
} from '../controllers/content.controller';

const router = Router();

// 公开：获取页面内容
router.get('/pages/:pageKey', getPageContent);

// 管理：页面列表 + 编辑
router.get('/admin/pages', auth, requireRole('editor', 'super_admin'), listAllPages);
router.put('/admin/pages/:pageKey', auth, requireRole('editor', 'super_admin'), savePageContent);

// 公开：分公司列表
router.get('/subsidiaries', listSubsidiaries);

// 管理：分公司 CRUD
router.post('/admin/subsidiaries', auth, requireRole('editor', 'super_admin'), createSubsidiary);
router.put('/admin/subsidiaries/:id', auth, requireRole('editor', 'super_admin'), updateSubsidiary);
router.delete('/admin/subsidiaries/:id', auth, requireRole('super_admin'), deleteSubsidiary);

export default router;
