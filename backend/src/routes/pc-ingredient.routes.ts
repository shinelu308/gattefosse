import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import {
  listPcIngredients,
  getPcIngredient,
  createPcIngredient,
  updatePcIngredient,
  deletePcIngredient,
  batchPublishPcIngredients,
  batchDeletePcIngredients,
  getRelatedPcIngredients,
} from '../controllers/pc-ingredient.controller';

const router = Router();

// 公开接口 — 前端站点调用
router.get('/', listPcIngredients);
router.get('/:id', getPcIngredient);
router.get('/:id/related', getRelatedPcIngredients);

// 后台管理接口 — 需登录 + 编辑以上权限
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createPcIngredient);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updatePcIngredient);
router.delete('/:id', authMiddleware, requireRole('editor', 'super_admin'), deletePcIngredient);
router.post('/batch-publish', authMiddleware, requireRole('editor', 'super_admin'), batchPublishPcIngredients);
router.post('/batch-delete', authMiddleware, requireRole('editor', 'super_admin'), batchDeletePcIngredients);

export default router;
