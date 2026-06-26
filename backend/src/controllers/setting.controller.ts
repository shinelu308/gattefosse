import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';

/** 获取所有设置 (公开) */
export async function getAllSettings(_req: Request, res: Response) {
  try {
    const settings = await prisma.setting.findMany();
    // 转换为 key-value 对象
    const map: Record<string, string | null> = {};
    for (const s of settings) {
      map[s.key] = s.value;
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
    res.json(success(setting));
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
