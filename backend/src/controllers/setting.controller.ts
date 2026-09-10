import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { getAiConfig, AI_PROVIDERS, testAiConnection } from '../utils/ai-translate';
import { verifySmtp } from '../utils/mailer';

/** 需要脱敏的设置项（公开接口不可泄露） */
const SECRET_KEYS = ['aiTranslateApiKey', 'smtp_pass', 'smtpPass'];
const maskValue = (key: string, value: string | null) =>
  SECRET_KEYS.includes(key) ? (value ? '******' : '') : value;

/** 获取所有设置 (公开；敏感项脱敏) */
export async function getAllSettings(_req: Request, res: Response) {
  try {
    const settings = await prisma.setting.findMany();
    // 转换为 key-value 对象
    const map: Record<string, string | null> = {};
    for (const s of settings) {
      map[s.key] = maskValue(s.key, s.value);
    }
    res.json(success(map));
  } catch (err: any) {
    console.error('getAllSettings error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 获取单个设置 */
export async function getSetting(req: Request, res: Response) {
  try {
    const { key } = req.params;
    const setting = await prisma.setting.findUnique({ where: { key } });
    if (!setting) return res.json(fail('设置项不存在'));
    res.json(success({ ...setting, value: maskValue(key, setting.value) }));
  } catch (err: any) {
    console.error('getSetting error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 创建或更新设置项 */
export async function saveSetting(req: Request, res: Response) {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value: value ?? null, updatedAt: new Date() },
      create: { key, value: value ?? null },
    });
    res.json(success(setting));
  } catch (err: any) {
    console.error('saveSetting error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 批量保存设置 */
export async function batchSaveSettings(req: Request, res: Response) {
  try {
    const settings = req.body; // { key1: value1, key2: value2, ... }
    if (!settings || typeof settings !== 'object') {
      return res.json(fail('参数格式错误'));
    }
    for (const [key, value] of Object.entries(settings)) {
      // 脱敏占位值不回写（保留已存的真实 Key）
      if (SECRET_KEYS.includes(key) && value === '******') continue;
      await prisma.setting.upsert({
        where: { key },
        update: { value: (value as string) ?? null, updatedAt: new Date() },
        create: { key, value: (value as string) ?? null },
      });
    }
    res.json(success(null));
  } catch (err: any) {
    console.error('batchSaveSettings error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/**
 * AI 翻译连接测试
 * POST /api/settings/ai-test  body: { provider?, apiKey?, model? }（不传则用已保存配置）
 */
export async function testAiSetting(req: Request, res: Response) {
  try {
    const { provider, apiKey, model } = req.body || {};
    let cfg = undefined;
    if (apiKey) {
      const p = AI_PROVIDERS[provider] || AI_PROVIDERS.zhipu;
      cfg = { provider: provider || 'zhipu', apiKey, model: model || p.defaultModel, baseUrl: p.baseUrl };
    }
    const result = await testAiConnection(cfg);
    res.json(result.ok ? success(result, result.message) : fail(result.message));
  } catch (err: any) {
    res.status(500).json(fail('测试失败：' + (err?.message || '未知错误')));
  }
}

/**
 * 获取 AI 翻译服务商预设（供设置页下拉使用）
 * GET /api/settings/ai-providers
 */
export async function getAiProviders(_req: Request, res: Response) {
  res.json(success(AI_PROVIDERS));
}

/**
 * SMTP 连接测试（求职申请邮件通知用）
 * POST /api/settings/smtp-test
 */
export async function testSmtpSetting(_req: Request, res: Response) {
  try {
    const result = await verifySmtp();
    res.json(result.ok ? success(null, result.message) : fail(result.message));
  } catch (err: any) {
    res.status(500).json(fail('测试失败：' + (err?.message || '未知错误')));
  }
}
