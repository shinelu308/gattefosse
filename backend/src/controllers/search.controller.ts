import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';

/**
 * 全局搜索 — PC产品、Pharma产品、配方、新闻/活动/研讨会/出版物/杂志/手册/文章、分公司
 *
 * facet 参数对齐前台 search.html 侧栏：
 *   type=1 新闻(catId=36 基本内容 / 30 全球 → category=corporate)
 *   type=2 活动   type=3 研讨会(i=1 pc / 117 pharma)
 *   type=4 出版物(i=1 pc / 117 pharma，排除资料手册)
 *   type=5 杂志/手册(i=1 → magazine；i=117 → publication+pharma+articleType=资料手册)
 *   type=6 文章(i=1 pc / 117 pharma)
 *   type=7 分公司(Subsidiary)
 *   type=9 产品(i=121 PC成分 / 120 配方 / 117 药用辅料；缺省全搜)
 *   i=goodsCategoryId：1=个人护理 117=药用辅料 120=配方 121=PC成分
 *
 * total 一律用 count() 取数据库真实命中数；单表返回上限 200（当前数据量远小于该值）。
 */
const TAKE = 200;

export async function search(req: Request, res: Response) {
  try {
    const { keyword } = req.query;
    const kw = String(keyword || '').trim();
    const type = req.query.type ? String(req.query.type) : '';
    const goodsCat = req.query.i ? String(req.query.i) : '';
    const catId = req.query.catId ? String(req.query.catId) : '';

    if (!kw) {
      return res.json(success({ products: [], news: [], formulations: [], contents: [], total: 0 }));
    }

    // ---- 组装 NewsEvent 过滤条件 ----
    let newsWhere: Prisma.NewsEventWhereInput | null = null;
    const withCategory = (base: Record<string, unknown>, category?: string) =>
      category ? { ...base, category } : base;

    switch (type) {
      case '1':
        newsWhere = withCategory(
          { type: 'news' },
          catId === '36' || catId === '30' ? 'corporate' : undefined
        );
        break;
      case '3':
        newsWhere = withCategory({ type: 'webinar' }, goodsCat === '117' ? 'pharma' : goodsCat === '1' ? 'pc' : undefined);
        break;
      case '4':
        newsWhere = withCategory(
          { type: 'publication', articleType: { not: '资料手册' } },
          goodsCat === '117' ? 'pharma' : goodsCat === '1' ? 'pc' : undefined
        );
        break;
      case '5':
        if (goodsCat === '117') {
          // 手册: 药用辅料
          newsWhere = { type: 'publication', category: 'pharma', articleType: '资料手册' };
        } else if (goodsCat === '1') {
          // Addiactive 杂志: 个人护理
          newsWhere = { type: 'magazine' };
        } else {
          newsWhere = {
            OR: [
              { type: 'magazine' },
              { type: 'publication', category: 'pharma', articleType: '资料手册' },
            ],
          };
        }
        break;
      case '6':
        newsWhere = withCategory({ type: 'article' }, goodsCat === '117' ? 'pharma' : goodsCat === '1' ? 'pc' : undefined);
        break;
      default:
        break;
    }

    const results: Record<string, unknown> = {
      products: [],
      news: [],
      formulations: [],
      contents: [],
    };
    let total = 0;

    // ---- 产品 / 配方 / 分公司（仅当未指定新闻类 type 时才搜）----
    const searchProducts = type === '' || type === '9';
    const searchSubs = type === '' || type === '7';

    if (searchProducts) {
      const wantPc = type !== '9' || goodsCat === '' || goodsCat === '121' || goodsCat === '1';
      const wantPharma = type !== '9' || goodsCat === '' || goodsCat === '117';
      const wantForm = type !== '9' || goodsCat === '' || goodsCat === '120';

      if (wantPc) {
        const where: Prisma.PcIngredientWhereInput = {
          isPublished: true,
          OR: [
            { name: { contains: kw } },
            { inciName: { contains: kw } },
            { description: { contains: kw } },
          ],
        };
        const [rows, count] = await Promise.all([
          prisma.pcIngredient.findMany({
            where,
            select: { id: true, name: true, inciName: true, description: true, imageUrl: true },
            take: TAKE,
            orderBy: { sortOrder: 'asc' },
          }),
          prisma.pcIngredient.count({ where }),
        ]);
        results.products = [
          ...(results.products as unknown[]),
          ...rows.map((p) => ({ ...p, type: 'pc' })),
        ];
        total += count;
      }
      if (wantPharma) {
        const where: Prisma.PharmaProductWhereInput = {
          isPublished: true,
          OR: [
            { name: { contains: kw } },
            { inciName: { contains: kw } },
            { description: { contains: kw } },
          ],
        };
        const [rows, count] = await Promise.all([
          prisma.pharmaProduct.findMany({
            where,
            select: { id: true, name: true, inciName: true, description: true, imageUrl: true },
            take: TAKE,
            orderBy: { sortOrder: 'asc' },
          }),
          prisma.pharmaProduct.count({ where }),
        ]);
        results.products = [
          ...(results.products as unknown[]),
          ...rows.map((p) => ({ ...p, type: 'pharma' })),
        ];
        total += count;
      }
      if (wantForm) {
        const where: Prisma.FormulationWhereInput = {
          isPublished: true,
          OR: [
            { name: { contains: kw } },
            { code: { contains: kw } },
            { description: { contains: kw } },
          ],
        };
        const [rows, count] = await Promise.all([
          prisma.formulation.findMany({
            where,
            select: { id: true, name: true, code: true, description: true, imageUrl: true },
            take: TAKE,
            orderBy: { sortOrder: 'asc' },
          }),
          prisma.formulation.count({ where }),
        ]);
        results.formulations = rows;
        total += count;
      }
    }

    // ---- NewsEvent（type 缺省时搜全部；type=9 产品 / type=7 分公司不搜新闻）----
    if (newsWhere === null && type !== '7' && type !== '9') {
      newsWhere = {};
    }
    if (newsWhere !== null) {
      const where: Prisma.NewsEventWhereInput = {
        isPublished: true,
        ...newsWhere,
        OR: [
          { title: { contains: kw } },
          { summary: { contains: kw } },
        ],
      };
      const [rows, count] = await Promise.all([
        prisma.newsEvent.findMany({
          where,
          select: {
            id: true, type: true, category: true, title: true, summary: true,
            imageUrl: true, publishedDate: true, eventEndDate: true, location: true,
            authorName: true, pdfUrl: true, tags: true,
          },
          take: TAKE,
          orderBy: { publishedDate: 'desc' },
        }),
        prisma.newsEvent.count({ where }),
      ]);
      results.news = rows;
      total += count;
    }

    // ---- 分公司 ----
    if (searchSubs) {
      const where: Prisma.SubsidiaryWhereInput = {
        OR: [
          { name: { contains: kw } },
          { country: { contains: kw } },
          { city: { contains: kw } },
        ],
      };
      const [rows, count] = await Promise.all([
        prisma.subsidiary.findMany({
          where,
          select: { id: true, name: true, country: true, city: true, website: true, description: true },
          take: TAKE,
          orderBy: { sortOrder: 'asc' },
        }),
        prisma.subsidiary.count({ where }),
      ]);
      results.contents = rows;
      total += count;
    }

    results.total = total;
    return res.json(success(results));
  } catch (error) {
    console.error('搜索失败:', error);
    return res.status(500).json(fail('搜索失败'));
  }
}
