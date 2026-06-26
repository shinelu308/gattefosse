import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';

/**
 * 全局搜索 — 同时搜索 PC产品、Pharma产品、新闻、配方
 */
export async function search(req: Request, res: Response) {
  try {
    const { keyword, type, limit = '10' } = req.query;
    const kw = String(keyword || '').trim();
    const limitNum = Math.min(50, Math.max(1, parseInt(String(limit))));

    if (!kw) {
      return res.json(success({ products: [], news: [], formulations: [], total: 0 }));
    }

    const results: Record<string, unknown> = {};

    // 搜索 PC 产品
    const pcProducts = await prisma.pcIngredient.findMany({
      where: {
        isPublished: true,
        OR: [
          { name: { contains: kw } },
          { inciName: { contains: kw } },
          { description: { contains: kw } },
        ],
      },
      select: { id: true, name: true, inciName: true, description: true, imageUrl: true },
      take: limitNum,
      orderBy: { sortOrder: 'asc' },
    });

    // 搜索 Pharma 产品
    const pharmaProducts = await prisma.pharmaProduct.findMany({
      where: {
        isPublished: true,
        OR: [
          { name: { contains: kw } },
          { description: { contains: kw } },
        ],
      },
      select: { id: true, name: true, description: true, imageUrl: true },
      take: limitNum,
      orderBy: { sortOrder: 'asc' },
    });

    // 格式化产品结果
    const products = [
      ...pcProducts.map(p => ({ ...p, type: 'pc' })),
      ...pharmaProducts.map(p => ({ ...p, type: 'pharma' })),
    ].slice(0, limitNum);

    // 搜索新闻
    const news = await prisma.newsEvent.findMany({
      where: {
        isPublished: true,
        OR: [
          { title: { contains: kw } },
          { summary: { contains: kw } },
        ],
      },
      select: { id: true, title: true, summary: true, imageUrl: true, type: true, publishedDate: true },
      take: limitNum,
      orderBy: { publishedDate: 'desc' },
    });

    // 搜索配方
    const formulations = await prisma.formulation.findMany({
      where: {
        isPublished: true,
        OR: [
          { name: { contains: kw } },
          { description: { contains: kw } },
        ],
      },
      select: { id: true, name: true, description: true, imageUrl: true },
      take: limitNum,
      orderBy: { sortOrder: 'asc' },
    });

    results.products = products;
    results.news = news;
    results.formulations = formulations;
    results.total = products.length + news.length + formulations.length;

    return res.json(success(results));
  } catch (error) {
    console.error('搜索失败:', error);
    return res.status(500).json(fail('搜索失败'));
  }
}
