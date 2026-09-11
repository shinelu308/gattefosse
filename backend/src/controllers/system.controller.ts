import { Request, Response } from 'express';
import { success } from '../utils/response';
import { getSystemVersion } from '../utils/version';

/** GET /api/system/version — 公开返回当前系统版本号（非敏感） */
export async function getSystemVersionHandler(_req: Request, res: Response) {
  const version = await getSystemVersion();
  return res.json(success({ version }, '获取成功'));
}
