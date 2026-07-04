import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { listAuthors, getAuthor, createAuthor, updateAuthor, deleteAuthor } from '../controllers/authors.controller';

const router = Router();

// 公开
router.get('/', listAuthors);
router.get('/:id', getAuthor);

// 管理
router.post('/', authMiddleware, requireRole('editor', 'super_admin'), createAuthor);
router.put('/:id', authMiddleware, requireRole('editor', 'super_admin'), updateAuthor);
router.delete('/:id', authMiddleware, requireRole('super_admin'), deleteAuthor);

export default router;
