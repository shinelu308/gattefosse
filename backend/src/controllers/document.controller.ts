import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

const DOCUMENT_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
  docProducts: true,
  docFormulations: true,
};

/** 序列化：BigInt → Number */
function sanitize(item: any) {
  if (!item) return item;
  return { ...item, fileSize: Number(item.fileSize) };
}
function sanitizeList(items: any[]) {
  return items.map(sanitize);
}

/**
 * 获取文档列表
 */
export async function listDocuments(req: Request, res: Response) {
  try {
    const {
      page = '1',
      limit = '20',
      keyword,
      type,
      language,
      isPublic,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};

    if (keyword) {
      const kw = String(keyword);
      where.title = { contains: kw };
    }
    if (type) {
      where.type = String(type);
    }
    if (language) {
      where.language = String(language);
    }
    if (isPublic !== undefined && isPublic !== '') {
      where.isPublic = String(isPublic) === 'true';
    }

    const [total, items] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        include: DOCUMENT_INCLUDE,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.json(
      success(paginate(sanitizeList(items), total, pageNum, limitNum), '获取成功')
    );
  } catch (error) {
    console.error('获取文档列表失败:', error);
    return res.status(500).json(fail('获取文档列表失败'));
  }
}

/**
 * 获取文档详情
 */
export async function getDocument(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const item = await prisma.document.findUnique({
      where: { id },
      include: DOCUMENT_INCLUDE,
    });

    if (!item) {
      return res.status(404).json(fail('文档不存在'));
    }

    return res.json(success(sanitize(item), '获取成功'));
  } catch (error) {
    console.error('获取文档详情失败:', error);
    return res.status(500).json(fail('获取文档详情失败'));
  }
}

/**
 * 创建文档记录（不含文件上传）
 */
export async function createDocument(req: Request, res: Response) {
  try {
    const { title, type, summary, fileUrl, isPublished, language } = req.body;
    if (!title) return res.status(400).json(fail('文档标题不能为空'));

    const item = await prisma.document.create({
      data: {
        title,
        type: type || 'Other',
        filePath: fileUrl || '',
        fileSize: 0,
        language: language || 'zh',
        isPublic: isPublished !== false,
        createdById: (req as any).userId || null,
      },
    });
    const result = sanitize(item);
    return res.status(201).json(success(result, '文档创建成功'));
  } catch (err: any) {
    console.error('创建文档失败:', err);
    return res.status(500).json(fail('创建文档失败'));
  }
}

/**
 * 上传并创建文档记录
 */
export async function uploadDocument(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json(fail('请选择要上传的文件'));
    }

    const { title, type, language, isPublic } = req.body;

    if (!title) {
      return res.status(400).json(fail('文档标题不能为空'));
    }

    const filePath = `/uploads/documents/${req.file.filename}`;
    const fullUrl = `${config.baseUrl}${filePath}`;

    const item = await prisma.document.create({
      data: {
        title,
        type: type || 'Other',
        filePath,
        fileSize: BigInt(req.file.size),
        language: language || 'zh',
        isPublic: isPublic === 'true' || isPublic === true,
        downloadCount: 0,
        createdById: req.user?.userId || null,
      },
      include: DOCUMENT_INCLUDE,
    });

    return res.json(
      success({
        ...item,
        fileSize: item.fileSize.toString(),
        url: fullUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
      }, '上传成功')
    );
  } catch (error) {
    console.error('文档上传失败:', error);
    return res.status(500).json(fail('文档上传失败'));
  }
}

/**
 * 更新文档信息
 */
export async function updateDocument(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('文档不存在'));
    }

    const { title, type, language, isPublic, filePath } = req.body;
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (type !== undefined) updateData.type = type;
    if (language !== undefined) updateData.language = language;
    if (isPublic !== undefined) updateData.isPublic = isPublic;
    if (filePath !== undefined) updateData.filePath = filePath;

    const item = await prisma.document.update({
      where: { id },
      data: updateData,
      include: DOCUMENT_INCLUDE,
    });

    // 序列化 BigInt
    const result = sanitize(item);
    return res.json(success(result, '更新成功'));
  } catch (error: any) {
    console.error('更新文档失败:', error);
    return res.status(500).json(fail('更新文档失败: ' + (error.message || '未知错误')));
  }
}

/**
 * 删除文档（含物理文件）
 */
export async function deleteDocument(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('文档不存在'));
    }

    // 删除物理文件（仅当有文件路径且文件存在时）
    if (existing.filePath) {
      const fullPath = path.resolve(__dirname, '../../', existing.filePath.replace(/^\//, ''));
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          fs.unlinkSync(fullPath);
        }
      }
    }

    await prisma.document.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除文档失败:', error);
    return res.status(500).json(fail('删除文档失败'));
  }
}

/**
 * 文档下载（记录计数）
 */
export async function downloadDocument(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const item = await prisma.document.findUnique({ where: { id } });

    if (!item) {
      return res.status(404).json(fail('文档不存在'));
    }

    // 检查权限
    if (!item.isPublic) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json(fail('此文档需要登录后才能下载', 401));
      }
    }

    // 更新下载计数
    await prisma.document.update({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });

    const fullPath = path.resolve(__dirname, '../../', item.filePath.replace(/^\//, ''));
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json(fail('文件不存在'));
    }

    return res.download(fullPath, item.title);
  } catch (error) {
    console.error('文档下载失败:', error);
    return res.status(500).json(fail('文档下载失败'));
  }
}

/**
 * 关联文档到产品
 */
export async function linkDocToProduct(req: Request, res: Response) {
  try {
    const documentId = parseInt(req.params.id);
    const { productId, productType } = req.body; // productType: 'pc' | 'pharma'

    if (!productId || !productType) {
      return res.status(400).json(fail('productId 和 productType 不能为空'));
    }

    const link = await prisma.docProduct.create({
      data: { documentId, productId: parseInt(String(productId)), productType },
    });

    return res.json(success(link, '关联成功'));
  } catch (error) {
    console.error('关联文档到产品失败:', error);
    return res.status(500).json(fail('关联文档到产品失败'));
  }
}

/**
 * 取消文档与产品的关联
 */
export async function unlinkDocFromProduct(req: Request, res: Response) {
  try {
    const linkId = parseInt(req.params.linkId);
    await prisma.docProduct.delete({ where: { id: linkId } });
    return res.json(success(null, '取消关联成功'));
  } catch (error) {
    console.error('取消关联失败:', error);
    return res.status(500).json(fail('取消关联失败'));
  }
}

/**
 * 关联文档到配方
 */
export async function linkDocToFormulation(req: Request, res: Response) {
  try {
    const documentId = parseInt(req.params.id);
    const { formulationId } = req.body;

    if (!formulationId) {
      return res.status(400).json(fail('formulationId 不能为空'));
    }

    const link = await prisma.docFormulation.create({
      data: { documentId, formulationId: parseInt(String(formulationId)) },
    });

    return res.json(success(link, '关联成功'));
  } catch (error) {
    console.error('关联文档到配方失败:', error);
    return res.status(500).json(fail('关联文档到配方失败'));
  }
}

/**
 * 取消文档与配方的关联
 */
export async function unlinkDocFromFormulation(req: Request, res: Response) {
  try {
    const linkId = parseInt(req.params.linkId);
    await prisma.docFormulation.delete({ where: { id: linkId } });
    return res.json(success(null, '取消关联成功'));
  } catch (error) {
    console.error('取消关联失败:', error);
    return res.status(500).json(fail('取消关联失败'));
  }
}
