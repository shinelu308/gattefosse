import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';

const NEWS_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
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
      keyword,
      isPublished,
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

    if (isPublished !== undefined && isPublished !== '') {
      where.isPublished = String(isPublished) === 'true';
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
    } = req.body;

    if (!title) {
      return res.status(400).json(fail('标题不能为空'));
    }

    if (!['news', 'event'].includes(type)) {
      return res.status(400).json(fail('type 必须是 news 或 event'));
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
        createdById: req.user?.userId || null,
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
