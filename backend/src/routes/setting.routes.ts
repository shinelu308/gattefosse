import { Router } from 'express';
import { authMiddleware as auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getAllSettings, getSetting, saveSetting, batchSaveSettings } from '../controllers/setting.controller';

const router = Router();

// 公开：获取所有设置
router.get('/', getAllSettings);
router.get('/:key', getSetting);

// 管理：保存设置
router.put('/:key', auth, requireRole('super_admin'), saveSetting);
router.post('/batch', auth, requireRole('super_admin'), batchSaveSettings);

export default router;
