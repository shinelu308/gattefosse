import { Router } from 'express';
import { getSystemVersionHandler } from '../controllers/system.controller';

const router = Router();

// 公开接口（版本号非敏感）：后台系统信息卡片展示用
router.get('/version', getSystemVersionHandler);

export default router;
