import { Request, Response } from 'express';
import path from 'path';
import sharp from 'sharp';
import { success, fail } from '../utils/response';
import { config } from '../config';

/**
 * 图片上传（自动缩放到 268x201）
 */
export async function uploadImage(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json(fail('请选择要上传的图片'));
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.filename);
    const resizedName = `${path.basename(req.file.filename, ext)}_268x201${ext}`;
    const resizedPath = path.join(path.dirname(filePath), resizedName);

    // 缩放到 268x201（cover 模式，会裁剪填充）
    await sharp(filePath)
      .resize(268, 201, { fit: 'cover', position: 'centre' })
      .toFile(resizedPath);

    const url = `${config.baseUrl}/uploads/images/${resizedName}`;
    return res.json(success({ url, filename: resizedName }, '上传成功'));
  } catch (error) {
    console.error('图片上传失败:', error);
    return res.status(500).json(fail('图片上传失败'));
  }
}

/**
 * 多图上传（也缩放）
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
      const resizedName = `${path.basename(f.filename, ext)}_268x201${ext}`;
      const resizedPath = path.join(path.dirname(filePath), resizedName);
      await sharp(filePath)
        .resize(268, 201, { fit: 'cover', position: 'centre' })
        .toFile(resizedPath);
      return {
        url: `${config.baseUrl}/uploads/images/${resizedName}`,
        filename: resizedName,
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
