import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { success, fail, paginate } from '../utils/response';
import { getAiConfig, translateText, translateHtml, mapPool } from '../utils/ai-translate';
import { applyContentPatches } from '../utils/content-patch';

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

    // type 支持逗号分隔多值（如 type=news,event）；'all' 不过滤
    const typeList = type && type !== 'all' ? parseMulti(type) : [];
    if (typeList.length === 1) {
      andConditions.push({ type: typeList[0] });
    } else if (typeList.length > 1) {
      andConditions.push({ type: { in: typeList } });
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
    // 侧栏计数与列表过滤条件保持一致（同一 type 范围内统计）
    const countWhere: Record<string, unknown> = { isPublished: true };
    if (typeList.length === 1) countWhere.type = typeList[0];
    else if (typeList.length > 1) countWhere.type = { in: typeList };
    const allPublished = await prisma.newsEvent.findMany({
      where: countWhere,
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

    // 阅读时长兜底：无值时按正文长度估算（约 400 字/分钟，中文为主的译文合理）
    for (const it of (result as any).list || []) {
      if (!it.readingTime && it.contentHtml) {
        const text = String(it.contentHtml).replace(/<[^>]*>/g, ' ').replace(/\s+/g, '').trim();
        if (text.length >= 50) {
          it.readingTime = Math.max(1, Math.round(text.length / 400));
        }
      }
    }

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
      pdfSize,
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

    const validTypes = ['news', 'event', 'article', 'webinar', 'publication', 'magazine', 'page'];
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
        pdfSize: pdfSize !== undefined && pdfSize !== null && !isNaN(parseInt(pdfSize)) ? parseInt(pdfSize) : null,
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
      pdfSize,
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
    if (pdfSize !== undefined) updateData.pdfSize = pdfSize === null || pdfSize === '' || isNaN(parseInt(pdfSize)) ? null : parseInt(pdfSize);
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
 * 获取文章标签（侧栏 facet 数据源）
 * GET /api/news/tags/list?type=article|publication&category=pc|pharma
 *
 * 默认返回字符串数组（向后兼容：hot-topics / brochures / webinars / admin 编辑器等均在用）；
 * 加 format=grouped 时返回 { groups, types }（出版物页专用）：
 * - groups: 标签分组 [{ key:'year', label:'年份', items:['2026',...] }, ...]（数据驱动，空组不返回）
 *   - tags 存 JSON 对象数组 [{"name":"...","group":"theme"}] 时按 group 精确分组
 *   - tags 存字符串数组时按启发式分组（4位数字→年份，®/™→产品，语言词→语言，其余→主题/成分）
 * - types: publication 类型聚合 [{ name:'海报', count:11 }, ...]（中文，供类型 facet 链接组）
 */
const PUB_TYPE_ZH: Record<string, string> = {
  'ebook': '电子书',
  'Poster': '海报',
  'Scientific publication': '科技出版物',
  'Whitepaper': '白皮书',
  'Oral communication': '口头交流',
};
// type=publication 的 grouped 模式下资料手册归属 brochures 页，出版物页 facet 需排除
const BROCHURE_TYPE = '资料手册';

function classifyPubTag(tag: string, fallback: string): string {
  if (/^\d{4}$/.test(tag)) return 'year';
  if (/^(英文|中文|法文|德文|日文|English|French|German|Japanese|Chinese)$/i.test(tag)) return 'language';
  return fallback; // pharma→theme，pc→ingredient（成分名常含®/™，PC 原站无「产品」组；产品名建议导入时用对象数组精确分组）
}

export async function listNewsTags(req: Request, res: Response) {
  try {
    const { type = 'article', category, format } = req.query;
    const grouped = String(format) === 'grouped';
    const where: Record<string, unknown> = {};
    if (type && type !== 'all') {
      where.type = String(type);
    }
    if (category) {
      const cats = String(category).split(',').map(s => s.trim()).filter(Boolean);
      if (cats.length) where.category = { in: cats };
    }
    where.isPublished = true;
    if (grouped && String(type) === 'publication') {
      // 资料手册归属 brochures 页，出版物页 facet 不统计
      where.NOT = { articleType: BROCHURE_TYPE };
    }

    const items = await prisma.newsEvent.findMany({
      where,
      select: { tags: true, articleType: true },
    });

    if (!grouped) {
      // 兼容模式：返回去重后的标签字符串数组（原行为）
      const tagSet = new Set<string>();
      for (const item of items) {
        if (item.tags) {
          try {
            const parsed = JSON.parse(item.tags);
            if (Array.isArray(parsed)) {
              parsed.forEach((t: unknown) => {
                if (typeof t === 'object' && t !== null && (t as Record<string, unknown>).name) tagSet.add(String((t as Record<string, unknown>).name));
                else if (t) tagSet.add(String(t));
              });
            }
          } catch {
            item.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
          }
        }
      }
      return res.json(success(Array.from(tagSet).sort(), '获取成功'));
    }

    const GROUP_LABEL: Record<string, string> = {
      year: '年份', theme: '主题', subject: '科目',
      product: '产品', language: '语言', ingredient: '成分',
    };
    const fallbackGroup = String(category) === 'pc' ? 'ingredient' : 'theme';
    // key -> Set<tagName>（对象数组精确分组用精确 key；字符串启发式归入 theme/ingredient 等）
    const groupItems: Record<string, Set<string>> = {};
    for (const item of items) {
      if (!item.tags) continue;
      try {
        const parsed = JSON.parse(item.tags);
        if (Array.isArray(parsed)) {
          for (const raw of parsed) {
            if (!raw) continue;
            if (typeof raw === 'object' && (raw as Record<string, unknown>).name) {
              const t = String((raw as Record<string, unknown>).name);
              const g = String((raw as Record<string, unknown>).group || classifyPubTag(t, fallbackGroup));
              if (!groupItems[g]) groupItems[g] = new Set();
              groupItems[g].add(t);
            } else {
              const t = String(raw);
              const g = classifyPubTag(t, fallbackGroup);
              if (!groupItems[g]) groupItems[g] = new Set();
              groupItems[g].add(t);
            }
          }
        }
      } catch {
        // 不是合法JSON时按逗号分割
        item.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
          const g = classifyPubTag(t, fallbackGroup);
          if (!groupItems[g]) groupItems[g] = new Set();
          groupItems[g].add(t);
        });
      }
    }

    // 侧栏组顺序：原站为 主题/成分 → 科目 → 产品 → 年份 → 语言
    const GROUP_ORDER = ['theme', 'ingredient', 'subject', 'product', 'year', 'language'];
    const groups = GROUP_ORDER
      .filter(g => groupItems[g] && groupItems[g]!.size > 0)
      .map(g => ({
        key: g,
        label: GROUP_LABEL[g] || g,
        items: Array.from(groupItems[g]!).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
      }));

    // publication 类型聚合（articleType trim 归一 + 中文映射后合并同名词，输出中文）
    const types: { name: string; count: number }[] = [];
    if (String(type) === 'publication') {
      const typeCounts = new Map<string, number>();
      for (const it of items) {
        const at = (it.articleType || '').trim();
        if (!at) continue;
        const zh = PUB_TYPE_ZH[at] || at;
        typeCounts.set(zh, (typeCounts.get(zh) || 0) + 1);
      }
      for (const [zh, count] of typeCounts) {
        types.push({ name: zh, count });
      }
      types.sort((a, b) => b.count - a.count);
    }

    return res.json(success({ groups, types }, '获取成功'));
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

/**
 * AI 自动翻译（英→中）— 后台任务模式
 * POST /api/news/:id/ai-translate 立即返回 jobId，翻译在后台执行
 * GET /api/news/ai-translate/status/:jobId 轮询进度（须注册在 /:id 之前）
 */
interface TranslateJob {
  id: string;
  newsId: number;
  status: 'running' | 'done' | 'error';
  stage: string;      // 当前阶段描述
  done: number;       // 已完成分块/条目
  total: number;      // 总分块/条目
  startedAt: number;
  finishedAt?: number;
  result?: any;
  error?: string;
}
const translateJobs = new Map<string, TranslateJob>();
// 任务最多保留 30 分钟，防止内存累积
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of translateJobs) {
    if (j.finishedAt && j.finishedAt < cutoff) translateJobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

async function runTranslateJob(job: TranslateJob, itemId: number): Promise<void> {
  try {
    const item = await prisma.newsEvent.findUnique({ where: { id: itemId }, include: { blocks: true } });
    if (!item) throw new Error('该内容不存在');
    const cfg = await getAiConfig();
    if (!cfg) throw new Error('尚未配置 AI 翻译：请到「系统设置 → AI 翻译配置」选择服务商并填写 API Key，保存后即可使用');

    // 1. 标题 + 摘要（并行）
    job.stage = '翻译标题与摘要';
    const [titleZh, summaryZh] = await Promise.all([
      item.title ? translateText(item.title, cfg) : Promise.resolve(''),
      item.summary ? translateText(item.summary, cfg) : Promise.resolve(''),
    ]);

    // 2. 正文 HTML（DOM 级文本节点翻译：结构零改动，按批并行 + 进度实时回写）
    let contentZh = '';
    let chunks = 0;
    if (item.contentHtml) {
      job.stage = '翻译正文';
      contentZh = await translateHtml(item.contentHtml, cfg, (done, total) => {
        job.done = done;
        job.total = total;
      });
    }

    if (!titleZh && !summaryZh && !contentZh) throw new Error('该内容没有可翻译的文字');

    // 3. 相关内容卡片区块：收集全部待翻译文本后并行翻译
    job.stage = '翻译相关卡片';
    interface CardRef { block: any; card: any; field: 'description' | 'typeLabel'; text: string; }
    const refs: CardRef[] = [];
    for (const b of item.blocks) {
      if (b.blockType !== 'product_cards') continue;
      let parsed: any;
      try { parsed = JSON.parse(b.content); } catch { continue; }
      if (!parsed || !Array.isArray(parsed.products)) continue;
      for (const card of parsed.products) {
        if (card.description && !/[\u4e00-\u9fff]/.test(card.description)) refs.push({ block: b, card, field: 'description', text: card.description });
        if (card.typeLabel && !/[\u4e00-\u9fff]/.test(card.typeLabel)) refs.push({ block: b, card, field: 'typeLabel', text: card.typeLabel });
      }
    }
    job.total = chunks + refs.length;
    job.done = chunks;
    await mapPool(refs, 3, async (ref) => {
      ref.card[ref.field] = await translateText(ref.text, cfg);
      job.done++;
    });
    const blockIds = new Set(refs.map(r => r.block.id));
    let blocksTranslated = 0;
    for (const b of item.blocks) {
      if (b.blockType !== 'product_cards' || !blockIds.has(b.id)) continue;
      const parsed = JSON.parse(b.content);
      await prisma.articleBlock.update({ where: { id: b.id }, data: { content: JSON.stringify(parsed) } });
      blocksTranslated++;
    }

    // 4. 回写主表
    job.stage = '保存译文';
    await prisma.newsEvent.update({
      where: { id: itemId },
      data: {
        title: titleZh || item.title,
        summary: summaryZh || item.summary,
        contentHtml: contentZh || item.contentHtml,
      },
    });

    job.status = 'done';
    job.finishedAt = Date.now();
    job.result = {
      id: itemId,
      titleTranslated: !!titleZh,
      summaryTranslated: !!summaryZh,
      contentTranslated: !!contentZh,
      chunks,
      blocksTranslated,
      provider: cfg.provider,
      model: cfg.model,
      elapsedMs: Date.now() - job.startedAt,
    };
  } catch (e: any) {
    job.status = 'error';
    job.finishedAt = Date.now();
    job.error = e?.message === 'AI_NOT_CONFIGURED'
      ? '尚未配置 AI 翻译：请到「系统设置 → AI 翻译配置」选择服务商并填写 API Key'
      : (e?.message || '未知错误');
  }
}

/** 启动翻译任务：立即返回 jobId */
export async function aiTranslateNews(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const exists = await prisma.newsEvent.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return res.status(404).json(fail('该内容不存在'));

    const jobId = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const job: TranslateJob = { id: jobId, newsId: id, status: 'running', stage: '准备中', done: 0, total: 0, startedAt: Date.now() };
    translateJobs.set(jobId, job);
    // 后台执行，不等待
    runTranslateJob(job, id).catch(() => {});
    return res.json(success({ jobId }, '翻译任务已启动'));
  } catch (error: any) {
    console.error('AI 翻译任务启动失败:', error);
    return res.status(500).json(fail('AI 翻译任务启动失败：' + (error?.message || '未知错误')));
  }
}

/** 查询翻译任务进度 */
export function aiTranslateStatus(req: Request, res: Response) {
  const job = translateJobs.get(String(req.params.jobId));
  if (!job) return res.status(404).json(fail('任务不存在或服务已重启，请重新发起翻译'));
  return res.json(success({
    status: job.status,
    stage: job.stage,
    done: job.done,
    total: job.total,
    elapsedMs: (job.finishedAt || Date.now()) - job.startedAt,
    result: job.status === 'done' ? job.result : undefined,
    error: job.status === 'error' ? job.error : undefined,
  }));
}

/**
 * 预览式原位编辑：内容补丁回填（2026-09-11）
 * 后台预览编辑器只产出三类受限补丁（文本节点 / img src / 视频iframe src），
 * 后端 jsdom 原位回填进 contentHtml——class/结构一个不动，版式 100% 保真。
 * 逐补丁校验旧值，任何失败都不落库（全部成功才保存），返回失败明细。
 */
export async function applyContentPatchesHandler(req: Request, res: Response) {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) return res.status(400).json(fail('缺少文章 ID'));
    const patches = Array.isArray(req.body?.patches) ? req.body.patches : null;
    if (!patches || !patches.length) return res.status(400).json(fail('缺少补丁数据'));

    const item = await prisma.newsEvent.findUnique({ where: { id }, select: { id: true, contentHtml: true } });
    if (!item) return res.status(404).json(fail('该内容不存在'));
    if (!item.contentHtml) return res.status(400).json(fail('本文没有 HTML 正文，无法应用内容修改'));

    const result = applyContentPatches(item.contentHtml, patches);
    if (result.failed.length) {
      return res.status(400).json(fail(
        `${result.failed.length} 处修改应用失败（未保存）：` +
        result.failed.map((f) => `第 ${f.index + 1} 处 ${f.reason}`).join('；')
      ));
    }

    await prisma.newsEvent.update({ where: { id }, data: { contentHtml: result.html } });
    return res.json(success({ applied: result.applied, html: result.html }, `已更新 ${result.applied} 处内容`));
  } catch (error: any) {
    console.error('内容补丁应用失败:', error);
    return res.status(500).json(fail('内容修改失败：' + (error?.message || '未知错误')));
  }
}
