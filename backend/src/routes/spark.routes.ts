import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { authMiddleware } from '../middleware/auth';
import { success, fail } from '../utils/response';

/**
 * 星火中台对接：签发 SSO ticket
 *
 * 流程：
 *   ① 管理员在后台点侧栏「星火」→ 前端调本接口（带嘉法狮 JWT）
 *   ② 本接口用与星火共享的密钥签发**短时效一次性 ticket**
 *   ③ 前端把 ticket 拼进星火地址，在 iframe 里打开
 *   ④ 星火校验 ticket → 建立自己的会话
 *
 * 🔴 安全要点：
 *   - ticket 有效期仅 120 秒；含 jti，星火侧做一次性校验（重放被拒）
 *   - 共享密钥只走内网，不落前端
 *   - 星火侧不自动建号：邮箱必须在星火已开通，否则拒绝
 *     （避免嘉法狮一个越权就凭空造出星火管理员）
 */
const router = Router();

router.get('/sso-ticket', authMiddleware, (req, res) => {
  const secret = process.env.SPARK_SSO_SECRET || '';
  const baseUrl = (process.env.SPARK_BASE_URL || 'http://localhost:4100').replace(/\/$/, '');
  const tenantCode = process.env.SPARK_TENANT_CODE || 'gattefosse';

  if (!secret) {
    return res.status(503).json(fail('未配置 SPARK_SSO_SECRET，无法跳转星火中台', 503));
  }

  const email = req.user?.email;
  if (!email) {
    return res.status(401).json(fail('无法获取当前登录账号', 401));
  }

  const ticket = jwt.sign(
    { email, tenantCode, jti: randomUUID() },
    secret,
    { algorithm: 'HS256', expiresIn: '120s' }
  );

  const url = `${baseUrl}/login.html?ticket=${encodeURIComponent(ticket)}`;

  return res.json(success({
    ticket,
    url,
    expiresInSeconds: 120,
    // 便于前端展示提示
    sparkBaseUrl: baseUrl,
  }));
});

/** 星火是否已配置（后台侧栏入口据此显示/禁用） */
router.get('/status', (_req, res) => {
  const configured = !!process.env.SPARK_SSO_SECRET;
  res.json(success({
    configured,
    baseUrl: process.env.SPARK_BASE_URL || null,
  }));
});

export default router;
