import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { success, fail } from '../utils/response';
import { config } from '../config';

/**
 * 图片上传（保留原始高清图，同时生成缩略图用于列表页）
 */
export async function uploadImage(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json(fail('请选择要上传的图片'));
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.filename);
    const basename = path.basename(req.file.filename, ext);
    const dir = path.dirname(filePath);

    // 原文件名就是 multer 生成的临时文件，直接重命名为 _original 后缀保留原图
    const originalName = `${basename}_original${ext}`;
    const originalPath = path.join(dir, originalName);
    fs.renameSync(filePath, originalPath);

    // 从原图生成缩略图（268x201）
    const thumbName = `${basename}_thumb${ext}`;
    const thumbPath = path.join(dir, thumbName);
    await sharp(originalPath)
      .resize(268, 201, { fit: 'cover', position: 'centre' })
      .toFile(thumbPath);

    const url = `${config.baseUrl}/uploads/images/${originalName}`;
    return res.json(success({ url, filename: originalName, thumbnail: thumbName }, '上传成功'));
  } catch (error) {
    console.error('图片上传失败:', error);
    return res.status(500).json(fail('图片上传失败'));
  }
}

/**
 * 多图上传（也生成原图 + 缩略图）
 */
export async function uploadImages(req: Request, res: Response) {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json(fail('请选择要上传的图片'));
    }

    const urls = await Promise.all(files.map(async (f) => {
      const filePath = f.path;
      const ext = path.extname(f.filename);
      const basename = path.basename(f.filename, ext);
      const dir = path.dirname(filePath);

      // 重命名原文件为 _original
      const originalName = `${basename}_original${ext}`;
      const originalPath = path.join(dir, originalName);
      fs.renameSync(filePath, originalPath);

      // 生成缩略图
      const thumbName = `${basename}_thumb${ext}`;
      const thumbPath = path.join(dir, thumbName);
      await sharp(originalPath)
        .resize(268, 201, { fit: 'cover', position: 'centre' })
        .toFile(thumbPath);

      return {
        url: `${config.baseUrl}/uploads/images/${originalName}`,
        filename: originalName,
        thumbnail: thumbName,
      };
    }));

    return res.json(success(urls, '上传成功'));
  } catch (error) {
    console.error('批量图片上传失败:', error);
    return res.status(500).json(fail('批量图片上传失败'));
  }
}

/**
 * 文档上传
 */
export async function uploadDocument(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json(fail('请选择要上传的文档'));
    }

    const url = `${config.baseUrl}/uploads/documents/${req.file.filename}`;
    return res.json(
      success({
        url,
        filename: req.file.filename,
        size: req.file.size,
        originalName: req.file.originalname,
      }, '上传成功')
    );
  } catch (error) {
    console.error('文档上传失败:', error);
    return res.status(500).json(fail('文档上传失败'));
  }
}
