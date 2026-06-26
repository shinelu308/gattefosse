import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { listMyFavorites, addFavorite, removeFavorite, checkFavorite } from '../controllers/favorites.controller';

const router = Router();

router.get('/check', authMiddleware, checkFavorite);
router.get('/', authMiddleware, listMyFavorites);
router.post('/', authMiddleware, addFavorite);
router.delete('/:id', authMiddleware, removeFavorite);

export default router;
