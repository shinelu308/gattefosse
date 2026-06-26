import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';

// ===================== 静态页面内容 =====================

/** 获取指定页面内容 (公开) */
export async function getPageContent(req: Request, res: Response) {
  try {
    const { pageKey } = req.params;
    const page = await prisma.pageContent.findUnique({ where: { pageKey } });
    if (!page) {
      return res.json(fail('页面不存在'));
    }
    res.json(success(page));
  } catch (err: any) {
    console.error('getPageContent error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 获取所有页面列表 (管理端) */
export async function listAllPages(_req: Request, res: Response) {
  try {
    const pages = await prisma.pageContent.findMany({
      orderBy: { pageKey: 'asc' },
      select: { id: true, pageKey: true, title: true, metaTitle: true, updatedAt: true },
    });
    res.json(success(pages));
  } catch (err: any) {
    console.error('listAllPages error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 创建或更新页面内容 */
export async function savePageContent(req: Request, res: Response) {
  try {
    const { pageKey } = req.params;
    const { title, contentHtml, metaTitle, metaDescription } = req.body;
    if (!title) {
      return res.json(fail('页面标题不能为空'));
    }
    const page = await prisma.pageContent.upsert({
      where: { pageKey },
      update: {
        title,
        contentHtml: contentHtml || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        updatedAt: new Date(),
      },
      create: {
        pageKey,
        title,
        contentHtml: contentHtml || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
      },
    });
    res.json(success(page));
  } catch (err: any) {
    console.error('savePageContent error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}


// ===================== 分公司管理 =====================

/** 分公司列表 (公开) */
export async function listSubsidiaries(_req: Request, res: Response) {
  try {
    const list = await prisma.subsidiary.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json(success(list));
  } catch (err: any) {
    console.error('listSubsidiaries error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 新增分公司 */
export async function createSubsidiary(req: Request, res: Response) {
  try {
    const { name, country, city, address, phone, email, website, imageUrl, description, sortOrder } = req.body;
    if (!name) return res.json(fail('分公司名称不能为空'));
    const sub = await prisma.subsidiary.create({
      data: {
        name, country, city, address, phone, email, website,
        imageUrl: imageUrl || null,
        description: description || null,
        sortOrder: sortOrder || 0,
      },
    });
    res.json(success(sub));
  } catch (err: any) {
    console.error('createSubsidiary error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 更新分公司 */
export async function updateSubsidiary(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { name, country, city, address, phone, email, website, imageUrl, description, sortOrder } = req.body;
    if (!name) return res.json(fail('分公司名称不能为空'));
    const sub = await prisma.subsidiary.update({
      where: { id },
      data: {
        name, country, city, address, phone, email, website,
        imageUrl: imageUrl || null,
        description: description || null,
        sortOrder: sortOrder || 0,
      },
    });
    res.json(success(sub));
  } catch (err: any) {
    console.error('updateSubsidiary error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 删除分公司 */
export async function deleteSubsidiary(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    await prisma.subsidiary.delete({ where: { id } });
    res.json(success(null));
  } catch (err: any) {
    console.error('deleteSubsidiary error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}
