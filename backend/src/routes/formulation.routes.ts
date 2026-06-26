import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import {
  listFormulations,
  getFormulation,
  createFormulation,
  updateFormulation,
  deleteFormulation,
  batchDeleteFormulations,
} from '../controllers/formulation.controller';

const router = Router();

// 公开接口
router.get('/', listFormulations);
router.get('/:id', getFormulation);

// 管理后台接口
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createFormulation);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateFormulation);
router.delete('/:id', authMiddleware, requireRole('editor', 'super_admin'), deleteFormulation);
router.post('/batch-delete', authMiddleware, requireRole('editor', 'super_admin'), batchDeleteFormulations);

export default router;
