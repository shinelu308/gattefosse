import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

const NEWS_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
  author: { select: { id: true, name: true, title: true, avatar: true, bio: true } },
  blocks: { orderBy: { sortOrder: 'asc' as const } },
};

/**
 * 获取新闻/活动列表 - 支持类型筛选 + 分页 + 搜索
 */
export async function listNews(req: Request, res: Response) {
  try {
    const {
      page = '1',
      limit = '20',
      type = 'all',
      category,
      articleType,
      excludeArticleType,
      keyword,
      isPublished,
      tags,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const parseMulti = (val: any): string[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(String).filter(Boolean);
      return String(val).split(',').map((s) => s.trim()).filter(Boolean);
    };

    const categories = parseMulti(category);
    const tagFilters = parseMulti(tags);

    const andConditions: Record<string, unknown>[] = [];

    if (keyword) {
      const kw = String(keyword);
      andConditions.push({
        OR: [
          { title: { contains: kw } },
          { summary: { contains: kw } },
          { contentHtml: { contains: kw } },
        ],
      });
    }

    if (type && type !== 'all') {
      andConditions.push({ type: String(type) });
    }

    if (categories.length) {
      andConditions.push({ category: { in: categories } });
    }

    if (articleType) {
      andConditions.push({ articleType: String(articleType) });
    }

    if (excludeArticleType) {
      andConditions.push({
        OR: [
          { articleType: null },
          { articleType: { not: String(excludeArticleType) } },
        ],
      });
    }

    if (isPublished !== undefined && isPublished !== '') {
      andConditions.push({ isPublished: String(isPublished) === 'true' });
    }

    // tags 多选：满足任意一个选中标签即命中（JSON 字符串 contains 模糊匹配）
    if (tagFilters.length) {
      andConditions.push({
        OR: tagFilters.map((t) => ({ tags: { contains: t } })),
      });
    }

    const where: Record<string, unknown> = andConditions.length
      ? { AND: andConditions }
      : {};

    const [total, items] = await Promise.all([
      prisma.newsEvent.count({ where }),
      prisma.newsEvent.findMany({
        where,
        include: NEWS_INCLUDE,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: [{ adminSort: 'desc' }, { publishedDate: 'desc' }],
      }),
    ]);

    // 统计各 category 和 tags 的数量（静态总数，供前端侧栏筛选展示）
    const allPublished = await prisma.newsEvent.findMany({
      where: { isPublished: true },
      select: { category: true, tags: true },
    });
    const counts: Record<string, number> = { all: allPublished.length, corporate: 0, pc: 0, pharma: 0 };
    const tagCounts: Record<string, number> = {};
    allPublished.forEach((n) => {
      if (n.category in counts) counts[n.category]++;
      // 解析 tags JSON 并统计
      if (n.tags) {
        try {
          const parsed = JSON.parse(n.tags);
          if (Array.isArray(parsed)) {
            parsed.forEach((t: string) => {
              if (t) tagCounts[t] = (tagCounts[t] || 0) + 1;
            });
          }
        } catch {
          // 非 JSON 格式，按逗号分割
          n.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
            tagCounts[t] = (tagCounts[t] || 0) + 1;
          });
        }
      }
    });

    const result = paginate(items, total, pageNum, limitNum);
    (result as any).counts = counts;
    (result as any).tagCounts = tagCounts;

    return res.json(
      success(result, '获取成功')
    );
  } catch (error) {
    console.error('获取新闻列表失败:', error);
    return res.status(500).json(fail('获取新闻列表失败'));
  }
}

/**
 * 获取新闻/活动详情
 */
export async function getNewsItem(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const item = await prisma.newsEvent.findUnique({
      where: { id },
      include: NEWS_INCLUDE,
    });

    if (!item) {
      return res.status(404).json(fail('该新闻/活动不存在'));
    }

    return res.json(success(item, '获取成功'));
  } catch (error) {
    console.error('获取新闻详情失败:', error);
    return res.status(500).json(fail('获取新闻详情失败'));
  }
}

/**
 * 创建新闻/活动
 */
export async function createNewsItem(req: Request, res: Response) {
  try {
    const {
      type = 'news',
      category,
      title,
      slug,
      summary,
      contentHtml,
      imageUrl,
      readingTime,
      publishedDate,
      eventEndDate,
      location,
      booth,
      isPublished,
      articleType,
      tags,
      publicationName,
      authorName,
      pdfUrl,
      videoUrl,
      lock,
      topBackground,
      metaTitle,
      metaDescription,
      metaKeywords,
      authorId,
      blocks,
    } = req.body;

    if (!title) {
      return res.status(400).json(fail('标题不能为空'));
    }

    const validTypes = ['news', 'event', 'article', 'webinar', 'publication', 'magazine'];
    if (!validTypes.includes(type)) {
      return res.status(400).json(fail('type 必须是 news/event/article/webinar/publication/magazine'));
    }

    if (!publishedDate) {
      return res.status(400).json(fail('发布日期不能为空'));
    }

    const item = await prisma.newsEvent.create({
      data: {
        type,
        category: category || 'corporate',
        title,
        slug: slug || null,
        summary: summary || null,
        contentHtml: contentHtml || null,
        imageUrl: imageUrl || null,
        readingTime: readingTime || null,
        publishedDate: new Date(publishedDate),
        eventEndDate: eventEndDate ? new Date(eventEndDate) : null,
        location: location || null,
        booth: booth || null,
        isPublished: isPublished !== undefined ? isPublished : false,
        articleType: articleType || null,
        tags: tags || null,
        publicationName: publicationName || null,
        authorName: authorName || null,
        pdfUrl: pdfUrl || null,
        videoUrl: videoUrl || null,
        lock: lock !== undefined ? lock : false,
        topBackground: topBackground || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        metaKeywords: metaKeywords || null,
        authorId: authorId || null,
        createdById: req.user?.userId || null,
        // 扩展：文章区块
        ...(Array.isArray(blocks) && blocks.length > 0 ? {
          blocks: {
            create: blocks.map((b: any, i: number) => ({
              blockType: b.blockType || 'text',
              title: b.title || null,
              content: typeof b.content === 'object' ? JSON.stringify(b.content) : (b.content || '{}'),
              sortOrder: b.sortOrder ?? i,
            })),
          },
        } : {}),
      },
      include: NEWS_INCLUDE,
    });

    return res.json(success(item, '创建成功'));
  } catch (error) {
    console.error('创建新闻失败:', error);
    return res.status(500).json(fail('创建新闻失败'));
  }
}

/**
 * 更新新闻/活动
 */
export async function updateNewsItem(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.newsEvent.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('该新闻/活动不存在'));
    }

    const {
      type,
      category,
      title,
      slug,
      summary,
      contentHtml,
      imageUrl,
      readingTime,
      publishedDate,
      eventEndDate,
      location,
      booth,
      isPublished,
      articleType,
      tags,
      publicationName,
      authorName,
      pdfUrl,
      videoUrl,
      lock,
      topBackground,
      metaTitle,
      metaDescription,
      metaKeywords,
      authorId,
      blocks,
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (type !== undefined) updateData.type = type;
    if (category !== undefined) updateData.category = category;
    if (title !== undefined) updateData.title = title;
    if (slug !== undefined) updateData.slug = slug || null;
    if (summary !== undefined) updateData.summary = summary || null;
    if (contentHtml !== undefined) updateData.contentHtml = contentHtml || null;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl || null;
    if (readingTime !== undefined) updateData.readingTime = readingTime || null;
    if (publishedDate !== undefined) updateData.publishedDate = new Date(publishedDate);
    if (eventEndDate !== undefined) updateData.eventEndDate = eventEndDate ? new Date(eventEndDate) : null;
    if (location !== undefined) updateData.location = location || null;
    if (booth !== undefined) updateData.booth = booth || null;
    if (isPublished !== undefined) updateData.isPublished = isPublished;
    if (articleType !== undefined) updateData.articleType = articleType || null;
    if (tags !== undefined) updateData.tags = tags || null;
    if (publicationName !== undefined) updateData.publicationName = publicationName || null;
    if (authorName !== undefined) updateData.authorName = authorName || null;
    if (pdfUrl !== undefined) updateData.pdfUrl = pdfUrl || null;
    if (videoUrl !== undefined) updateData.videoUrl = videoUrl || null;
    if (lock !== undefined) updateData.lock = lock;
    if (topBackground !== undefined) updateData.topBackground = topBackground || null;
    if (metaTitle !== undefined) updateData.metaTitle = metaTitle || null;
    if (metaDescription !== undefined) updateData.metaDescription = metaDescription || null;
    if (metaKeywords !== undefined) updateData.metaKeywords = metaKeywords || null;
    if (authorId !== undefined) updateData.authorId = authorId || null;

    // 处理区块：替换全部
    if (Array.isArray(blocks)) {
      // 先删除旧区块
      await prisma.articleBlock.deleteMany({ where: { articleId: id } });
      // 创建新区块
      if (blocks.length > 0) {
        await prisma.articleBlock.createMany({
          data: blocks.map((b: any, i: number) => ({
            articleId: id,
            blockType: b.blockType || 'text',
            title: b.title || null,
            content: typeof b.content === 'object' ? JSON.stringify(b.content) : (b.content || '{}'),
            sortOrder: b.sortOrder ?? i,
          })),
        });
      }
    }

    const item = await prisma.newsEvent.update({
      where: { id },
      data: updateData,
      include: NEWS_INCLUDE,
    });

    return res.json(success(item, '更新成功'));
  } catch (error) {
    console.error('更新新闻失败:', error);
    return res.status(500).json(fail('更新新闻失败'));
  }
}

/**
 * 删除新闻/活动
 */
export async function deleteNewsItem(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.newsEvent.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('该新闻/活动不存在'));
    }

    await prisma.newsEvent.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除新闻失败:', error);
    return res.status(500).json(fail('删除新闻失败'));
  }
}

/**
 * 批量删除新闻/活动
 * POST /api/news/batch-delete
 */
export async function batchDeleteNews(req: Request, res: Response) {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(fail('ids 不能为空'));
    }
    await prisma.newsEvent.deleteMany({
      where: { id: { in: ids } },
    });
    return res.json(success({ deleted: ids.length }, '批量删除成功'));
  } catch (error) {
    console.error('批量删除失败:', error);
    return res.status(500).json(fail('批量删除失败'));
  }
}

/**
 * 获取所有文章标签（去重）
 * GET /api/news/tags/list?type=article
 */
export async function listNewsTags(req: Request, res: Response) {
  try {
    const { type = 'article', category } = req.query;
    const where: Record<string, unknown> = {};
    if (type && type !== 'all') {
      where.type = String(type);
    }
    if (category) {
      const cats = String(category).split(',').map(s => s.trim()).filter(Boolean);
      if (cats.length) where.category = { in: cats };
    }
    where.isPublished = true;

    const items = await prisma.newsEvent.findMany({
      where,
      select: { tags: true },
    });

    // 提取所有标签并去重
    const tagSet = new Set<string>();
    for (const item of items) {
      if (item.tags) {
        try {
          const parsed = JSON.parse(item.tags);
          if (Array.isArray(parsed)) {
            parsed.forEach((t: string) => { if (t) tagSet.add(t); });
          }
        } catch {
          // 不是合法JSON时尝试按逗号分割
          item.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
        }
      }
    }

    const sorted = Array.from(tagSet).sort();
    return res.json(success(sorted, '获取成功'));
  } catch (error) {
    console.error('获取标签列表失败:', error);
    return res.status(500).json(fail('获取标签列表失败'));
  }
}

/**
 * 增加阅读量
 * PUT /api/news/:id/views
 */
export async function incrementNewsViews(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.newsEvent.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(fail('该新闻/活动不存在'));
    }
    const updated = await prisma.newsEvent.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { id: true, views: true },
    });
    return res.json(success(updated, '更新成功'));
  } catch (error) {
    console.error('更新阅读量失败:', error);
    return res.status(500).json(fail('更新阅读量失败'));
  }
}
