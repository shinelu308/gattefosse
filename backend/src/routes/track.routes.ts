/**
 * 内容浏览埋点路由（2026-09-12）
 * 公开接口：前台 sendBeacon 直接上报，无鉴权（不返回敏感信息，只回 accepted 计数）
 */
import { Router, json, text } from 'express';
import { trackContent } from '../controllers/track.controller';

const router = Router();

// 主解析器：application/json（前端默认用 Blob 标 application/json）
// 兜底解析器：部分浏览器 sendBeacon 发送 Blob 时会标成 text/plain，
//   此时全局 express.json 会跳过，由这里收成字符串交给 controller 自行 JSON.parse。
const looseBody = [json({ limit: '64kb' }), text({ type: () => true, limit: '64kb' })];

router.post('/content', looseBody, trackContent);

export default router;
