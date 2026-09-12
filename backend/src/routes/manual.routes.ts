import { Router } from 'express';
import { authMiddleware as auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { uploadManualImage as manualImageUpload } from '../middleware/upload';
import {
  listSections,
  saveSection,
  createSection,
  deleteSection,
  reorderSections,
  uploadManualImage,
} from '../controllers/manual.controller';

const router = Router();

// 阅读：任何登录用户都能看（操作人员包括普通编辑员）
router.get('/sections', auth, listSections);

// 编辑：与其它模块一致，editor / super_admin
router.post('/admin/sections', auth, requireRole('editor', 'super_admin'), createSection);
router.put('/admin/sections/:id', auth, requireRole('editor', 'super_admin'), saveSection);
router.delete('/admin/sections/:id', auth, requireRole('editor', 'super_admin'), deleteSection);
router.post('/admin/sections/reorder', auth, requireRole('editor', 'super_admin'), reorderSections);
router.post(
  '/admin/upload',
  auth,
  requireRole('editor', 'super_admin'),
  manualImageUpload.single('file'),
  uploadManualImage
);

export default router;
