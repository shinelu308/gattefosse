import express from 'express';
import cors from 'cors';
import path from 'path';

import { config } from './config';
import { prisma } from './utils/prisma';
import authRoutes from './routes/auth.routes';
import tagRoutes from './routes/tag.routes';
import uploadRoutes from './routes/upload.routes';
import pcIngredientRoutes from './routes/pc-ingredient.routes';
import pharmaRoutes from './routes/pharma.routes';
import formulationRoutes from './routes/formulation.routes';
import documentRoutes from './routes/document.routes';
import newsRoutes from './routes/news.routes';
import orderRoutes from './routes/order.routes';
import userAdminRoutes from './routes/user-admin.routes';
import favoritesRoutes from './routes/favorites.routes';
import contentRoutes from './routes/content.routes';
import settingRoutes from './routes/setting.routes';
import cartRoutes from './routes/cart.routes';
import careerRoutes from './routes/career.routes';
import searchRoutes from './routes/search.routes';
import orderPublicRoutes from './routes/order-public.routes';
import blockRoutes from './routes/block.routes';

const app = express();

// 中间件
app.use(cors({
  origin: config.env === 'development' ? true : config.cors.frontendUrl,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（上传的文件）
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// 管理后台静态文件
app.use('/admin', express.static(path.resolve(__dirname, '../../admin')));

// 前端网站静态文件
app.use(express.static(path.resolve(__dirname, '../../site')));

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/pc-ingredients', pcIngredientRoutes);
app.use('/api/pharma-products', pharmaRoutes);
app.use('/api/formulations', formulationRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/admin/orders', orderRoutes);
app.use('/api/admin/users', userAdminRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/careers', careerRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/orders', orderPublicRoutes);
app.use('/api/blocks', blockRoutes);

// 404 处理
app.use('*', (_req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在', data: null });
});

// 错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
});

// 启动服务器
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`🚀 嘉法狮后台 API 服务启动成功`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   环境: ${config.env}`);
});
