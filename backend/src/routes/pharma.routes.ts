import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import {
  listPharmaProducts,
  getPharmaProduct,
  createPharmaProduct,
  updatePharmaProduct,
  deletePharmaProduct,
  batchPublishPharmaProducts,
  batchDeletePharmaProducts,
} from '../controllers/pharma.controller';

const router = Router();

// 公开接口
router.get('/', listPharmaProducts);
router.get('/:id', getPharmaProduct);

// 后台管理接口
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createPharmaProduct);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updatePharmaProduct);
router.delete('/:id', authMiddleware, requireRole('editor', 'super_admin'), deletePharmaProduct);
router.post('/batch-publish', authMiddleware, requireRole('editor', 'super_admin'), batchPublishPharmaProducts);
router.post('/batch-delete', authMiddleware, requireRole('editor', 'super_admin'), batchDeletePharmaProducts);

export default router;
