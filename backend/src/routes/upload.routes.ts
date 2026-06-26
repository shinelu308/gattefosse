import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { uploadImage as imageUpload, uploadDocument as documentUpload } from '../middleware/upload';
import { uploadImage as uploadImageCtrl, uploadImages, uploadDocument as uploadDocumentCtrl } from '../controllers/upload.controller';

const router = Router();

// 需要登录才能上传
router.post('/image', authMiddleware, imageUpload.single('file'), uploadImageCtrl);
router.post('/images', authMiddleware, imageUpload.array('files', 10), uploadImages);
router.post('/document', authMiddleware, documentUpload.single('file'), uploadDocumentCtrl);

export default router;
