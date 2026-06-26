import { Router } from 'express';
import { login, register, me } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 登录
router.post('/login', login);

// 注册
router.post('/register', register);

// 获取当前用户信息（需要认证）
router.get('/me', authMiddleware, me);

export default router;
