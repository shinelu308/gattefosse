import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createOrder, submitFeedback, listMyOrders } from '../controllers/order.controller';

const router = Router();

// 公开接口 — 反馈提交
router.post('/feedback', submitFeedback);

// 需要登录的接口
router.post('/', authMiddleware, createOrder);
router.get('/my', authMiddleware, listMyOrders);

export default router;
