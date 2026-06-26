import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import {
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  reorderBlocks,
} from '../controllers/block.controller';

const router = Router();

// 公开接口 — 前端产品详情页调用
router.get('/', listBlocks);

// 后台管理接口 — 需登录 + 编辑以上权限
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createBlock);
router.put('/reorder', authMiddleware, requireRole('editor', 'super_admin'), reorderBlocks);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateBlock);
router.delete('/:id', authMiddleware, requireRole('editor', 'super_admin'), deleteBlock);

export default router;
