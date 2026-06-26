import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';

/**
 * 获取求职申请列表（后台管理）
 */
export async function listCareers(req: Request, res: Response) {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};
    if (status) where.status = String(status);

    const [total, items] = await Promise.all([
      prisma.careerApplication.count({ where: where as any }),
      prisma.careerApplication.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    return res.json(success({
      list: items,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    }));
  } catch (error) {
    console.error('获取求职列表失败:', error);
    return res.status(500).json(fail('获取求职列表失败'));
  }
}

/**
 * 创建求职申请（前端公开接口）
 */
export async function createCareer(req: Request, res: Response) {
  try {
    const { fullName, email, phone, position, message, resumePath } = req.body;

    if (!fullName || !email) {
      return res.status(400).json(fail('姓名和邮箱为必填项'));
    }

    const application = await prisma.careerApplication.create({
      data: {
        fullName,
        email,
        phone: phone || null,
        position: position || null,
        message: message || null,
        resumePath: resumePath || null,
      },
    });

    return res.json(success(application, '申请提交成功'));
  } catch (error) {
    console.error('提交求职申请失败:', error);
    return res.status(500).json(fail('提交求职申请失败'));
  }
}

/**
 * 更新求职申请状态（后台管理）
 */
export async function updateCareer(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { status, notes } = req.body;

    const updated = await prisma.careerApplication.update({
      where: { id },
      data: { status: status || undefined } as any,
    });

    return res.json(success(updated, '已更新'));
  } catch (error) {
    console.error('更新求职申请失败:', error);
    return res.status(500).json(fail('更新求职申请失败'));
  }
}
