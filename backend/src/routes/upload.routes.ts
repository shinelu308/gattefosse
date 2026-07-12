import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { uploadImage as imageUpload, uploadDocument as documentUpload, uploadVideo as videoUpload } from '../middleware/upload';
import { uploadImage as uploadImageCtrl, uploadImages, uploadDocument as uploadDocumentCtrl, uploadVideo as uploadVideoCtrl } from '../controllers/upload.controller';

const router = Router();

// 需要登录才能上传
router.post('/image', authMiddleware, imageUpload.single('file'), uploadImageCtrl);
router.post('/images', authMiddleware, imageUpload.array('files', 10), uploadImages);
router.post('/video', authMiddleware, videoUpload.single('file'), uploadVideoCtrl);
router.post('/document', authMiddleware, documentUpload.single('file'), uploadDocumentCtrl);

export default router;
