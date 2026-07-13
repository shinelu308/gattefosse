import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

/**
 * 获取作者列表
 */
export async function listAuthors(req: Request, res: Response) {
  try {
    const { page = '1', limit = '50', keyword } = req.query;
    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));
    const where: Record<string, unknown> = {};
    if (keyword) {
      where.OR = [
        { name: { contains: String(keyword) } },
        { bio: { contains: String(keyword) } },
        { title: { contains: String(keyword) } },
        { department: { contains: String(keyword) } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.author.count({ where }),
      prisma.author.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    return res.json(success(paginate(items, total, pageNum, limitNum), '获取成功'));
  } catch (error) {
    console.error('获取作者列表失败:', error);
    return res.status(500).json(fail('获取作者列表失败'));
  }
}

/**
 * 获取单个作者
 */
export async function getAuthor(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const item = await prisma.author.findUnique({ where: { id } });
    if (!item) return res.status(404).json(fail('作者不存在'));
    return res.json(success(item, '获取成功'));
  } catch (error) {
    console.error('获取作者失败:', error);
    return res.status(500).json(fail('获取作者失败'));
  }
}

/**
 * 创建作者
 */
export async function createAuthor(req: Request, res: Response) {
  try {
    const { name, title, avatar, bio, department, region, linkedin, sortOrder } = req.body;
    if (!name) return res.status(400).json(fail('作者姓名不能为空'));
    const item = await prisma.author.create({
      data: {
        name,
        title: title || null,
        avatar: avatar || null,
        bio: bio || null,
        department: department || null,
        region: region || null,
        linkedin: linkedin || null,
        sortOrder: sortOrder || 0,
      },
    });
    return res.json(success(item, '创建成功'));
  } catch (error) {
    console.error('创建作者失败:', error);
    return res.status(500).json(fail('创建作者失败'));
  }
}

/**
 * 更新作者
 */
export async function updateAuthor(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.author.findUnique({ where: { id } });
    if (!existing) return res.status(404).json(fail('作者不存在'));
    const { name, title, avatar, bio, department, region, linkedin, sortOrder } = req.body;
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (title !== undefined) updateData.title = title || null;
    if (avatar !== undefined) updateData.avatar = avatar || null;
    if (bio !== undefined) updateData.bio = bio || null;
    if (department !== undefined) updateData.department = department || null;
    if (region !== undefined) updateData.region = region || null;
    if (linkedin !== undefined) updateData.linkedin = linkedin || null;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    const item = await prisma.author.update({ where: { id }, data: updateData });
    return res.json(success(item, '更新成功'));
  } catch (error) {
    console.error('更新作者失败:', error);
    return res.status(500).json(fail('更新作者失败'));
  }
}

/**
 * 删除作者
 */
export async function deleteAuthor(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.author.findUnique({ where: { id } });
    if (!existing) return res.status(404).json(fail('作者不存在'));
    await prisma.author.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除作者失败:', error);
    return res.status(500).json(fail('删除作者失败'));
  }
}
