import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { listAllOrders, getOrderDetail, updateOrderStatus, getOrderStats } from '../controllers/order.controller';

const router = Router();

// 管理端接口
router.get('/stats', authMiddleware, requireRole('editor', 'super_admin'), getOrderStats);
router.get('/', authMiddleware, requireRole('editor', 'super_admin'), listAllOrders);
router.get('/:id', authMiddleware, requireRole('editor', 'super_admin'), getOrderDetail);
router.put('/:id/status', authMiddleware, requireRole('editor', 'super_admin'), updateOrderStatus);

export default router;
