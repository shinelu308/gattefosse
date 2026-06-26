import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';

const router = Router();

// 文档上传需要 multer，动态导入以保持路由文件简洁
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(__dirname, '../../../uploads/documents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  },
});

const documentUpload = multer({
  storage: docStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

import {
  listDocuments,
  getDocument,
  createDocument,
  uploadDocument,
  updateDocument,
  deleteDocument,
  downloadDocument,
  linkDocToProduct,
  unlinkDocFromProduct,
  linkDocToFormulation,
  unlinkDocFromFormulation,
} from '../controllers/document.controller';

// 公开接口
router.get('/', listDocuments);
router.get('/:id', getDocument);
router.get('/:id/download', downloadDocument);

// 管理后台接口
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createDocument);
router.post('/upload', authMiddleware, requireRole('editor', 'super_admin'), documentUpload.single('file'), uploadDocument);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateDocument);
router.delete('/:id', authMiddleware, requireRole('editor', 'super_admin'), deleteDocument);

// 文档关联
router.post('/:id/link-product', authMiddleware, requireRole('editor', 'super_admin'), linkDocToProduct);
router.delete('/:id/link-product/:linkId', authMiddleware, requireRole('editor', 'super_admin'), unlinkDocFromProduct);
router.post('/:id/link-formulation', authMiddleware, requireRole('editor', 'super_admin'), linkDocToFormulation);
router.delete('/:id/link-formulation/:linkId', authMiddleware, requireRole('editor', 'super_admin'), unlinkDocFromFormulation);

export default router;
