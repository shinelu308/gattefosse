import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

const NEWS_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
  author: { select: { id: true, name: true, avatar: true, bio: true } },
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
      keyword,
      isPublished,
      tags,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page)));
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit))));

    const where: Record<string, unknown> = {};

    if (keyword) {
      const kw = String(keyword);
      where.OR = [
        { title: { contains: kw } },
        { summary: { contains: kw } },
        { contentHtml: { contains: kw } },
      ];
    }

    if (type && type !== 'all') {
      where.type = String(type);
    }

    if (category) {
      where.category = String(category);
    }

    if (articleType) {
      where.articleType = String(articleType);
    }

    if (isPublished !== undefined && isPublished !== '') {
      where.isPublished = String(isPublished) === 'true';
    }

    // tags 筛选：SQLite 的 contains 对 JSON 字符串做模糊匹配
    if (tags) {
      const tagStr = String(tags);
      where.tags = { contains: tagStr };
    }

    const [total, items] = await Promise.all([
      prisma.newsEvent.count({ where }),
      prisma.newsEvent.findMany({
        where,
        include: NEWS_INCLUDE,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { publishedDate: 'desc' },
      }),
    ]);

    return res.json(
      success(paginate(items, total, pageNum, limitNum), '获取成功')
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
    const { type = 'article' } = req.query;
    const where: Record<string, unknown> = {};
    if (type && type !== 'all') {
      where.type = String(type);
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
