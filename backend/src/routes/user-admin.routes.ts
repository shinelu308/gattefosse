import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { listUsers, getUserById, updateUser, updateUserStatus, deleteUser, getUserStats } from '../controllers/user-admin.controller';

const router = Router();

router.get('/stats', authMiddleware, requireRole('super_admin'), getUserStats);
router.get('/', authMiddleware, requireRole('super_admin'), listUsers);
router.get('/:id', authMiddleware, requireRole('super_admin'), getUserById);
router.put('/:id', authMiddleware, requireRole('super_admin'), updateUser);
router.put('/:id/status', authMiddleware, requireRole('super_admin'), updateUserStatus);
router.delete('/:id', authMiddleware, requireRole('super_admin'), deleteUser);

export default router;
