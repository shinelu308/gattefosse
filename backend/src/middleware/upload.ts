import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

// 文件类型过滤
const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
  const allowedDocTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  if ([...allowedImageTypes, ...allowedDocTypes].includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型'));
  }
};

// 图片上传配置
export const uploadImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(config.upload.dir, 'images'));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${ext}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter,
  limits: { fileSize: config.upload.maxFileSize },
});

// 文档上传配置
export const uploadDocument = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(config.upload.dir, 'documents'));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${ext}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('只支持 PDF 文件'));
    }
  },
  limits: { fileSize: config.upload.maxFileSize },
});

// 视频上传配置
export const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(config.upload.dir, 'videos'));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${ext}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('只支持视频文件'));
    }
  },
  limits: { fileSize: config.upload.maxFileSize },
});

// 翻译 Word 上传配置（文章翻译回填用，用完即删的临时文件）
export const uploadTranslationDoc = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(config.upload.dir, 'tmp');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, 'translation_' + Date.now() + '.docx');
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.docx')) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .docx 文件'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});
