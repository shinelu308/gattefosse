import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { uploadResumeDoc } from '../middleware/upload';
import {
  createCareer,
  listCareers,
  getCareer,
  updateCareer,
  deleteCareer,
  uploadResume,
  downloadCareerFile,
} from '../controllers/career.controller';
import { fail } from '../utils/response';
import { config } from '../config';

const router = Router();

const adminOnly = [authMiddleware, requireRole('editor', 'super_admin')];

// ===== 前台公开接口 =====
// 附件上传（匿名）：?kind=resume（默认，简历）| cover（求职信）
// 落私有目录，返回 token，提交申请时回传
router.post(
  '/upload',
  (req, res, next) => {
    uploadResumeDoc.single('file')(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json(fail(`文件过大，请控制在 ${Math.round(config.resume.maxFileSize / 1024 / 1024)}MB 以内`));
        }
        return res.status(400).json(fail('上传失败：' + err.message));
      }
      return res.status(400).json(fail((err as Error).message || '上传失败'));
    });
  },
  uploadResume
);

// 提交求职申请
router.post('/', createCareer);

// ===== 后台管理接口 =====
router.get('/', ...adminOnly, listCareers);
router.get('/:id', ...adminOnly, getCareer);
router.get('/:id/file/:kind', ...adminOnly, downloadCareerFile);
router.put('/:id', ...adminOnly, updateCareer);
router.delete('/:id', ...adminOnly, deleteCareer);

export default router;
