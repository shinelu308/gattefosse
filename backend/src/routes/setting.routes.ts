import { Router } from 'express';
import { authMiddleware as auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getAllSettings, getSetting, saveSetting, batchSaveSettings, testAiSetting, getAiProviders, testSmtpSetting } from '../controllers/setting.controller';

const router = Router();

// AI 翻译：服务商预设（登录即可读，供设置页下拉；须注册在 /:key 之前）
router.get('/ai-providers', auth, getAiProviders);
// AI 翻译：连接测试（用传入的 key 或已保存配置）
router.post('/ai-test', auth, requireRole('super_admin'), testAiSetting);
// 邮件通知：SMTP 连接测试（须注册在 /:key 之前）
router.post('/smtp-test', auth, requireRole('super_admin'), testSmtpSetting);

// 公开：获取所有设置（API Key 等敏感项已脱敏）
router.get('/', getAllSettings);
router.get('/:key', getSetting);

// 管理：保存设置
router.put('/:key', auth, requireRole('super_admin'), saveSetting);
router.post('/batch', auth, requireRole('super_admin'), batchSaveSettings);

export default router;
