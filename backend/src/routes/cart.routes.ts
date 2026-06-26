import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listCart,
  cartCount,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
} from '../controllers/cart.controller';

const router = Router();

// 所有购物车接口需要登录
router.use(authMiddleware);

router.get('/', listCart);
router.get('/count', cartCount);
router.post('/', addToCart);
router.put('/:id', updateCartItem);
router.delete('/clear', clearCart); // 必须在 /:id 之前
router.delete('/:id', removeFromCart);

export default router;
