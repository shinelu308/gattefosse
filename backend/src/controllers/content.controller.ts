import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { applyContentPatches } from '../utils/content-patch';

// ===================== 静态页面内容 =====================

/** 获取指定页面内容 (公开) */
export async function getPageContent(req: Request, res: Response) {
  try {
    const { pageKey } = req.params;
    const page = await prisma.pageContent.findUnique({ where: { pageKey } });
    if (!page) {
      return res.json(fail('页面不存在'));
    }
    res.json(success(page));
  } catch (err: any) {
    console.error('getPageContent error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 获取所有页面列表 (管理端) */
export async function listAllPages(_req: Request, res: Response) {
  try {
    const pages = await prisma.pageContent.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, pageKey: true, title: true, slug: true, metaTitle: true, sortOrder: true, updatedAt: true },
    });
    res.json(success(pages));
  } catch (err: any) {
    console.error('listAllPages error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 创建或更新页面内容 */
export async function savePageContent(req: Request, res: Response) {
  try {
    const { pageKey } = req.params;
    const { title, contentHtml, content, metaTitle, metaDescription, slug } = req.body;
    if (!title) {
      return res.json(fail('页面标题不能为空'));
    }
    const page = await prisma.pageContent.upsert({
      where: { pageKey },
      update: {
        title,
        contentHtml: contentHtml || null,
        content: content ? (typeof content === 'string' ? content : JSON.stringify(content)) : null,
        slug: slug || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        updatedAt: new Date(),
      },
      create: {
        pageKey,
        title,
        contentHtml: contentHtml || null,
        content: content ? (typeof content === 'string' ? content : JSON.stringify(content)) : null,
        slug: slug || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
      },
    });
    res.json(success(page));
  } catch (err: any) {
    console.error('savePageContent error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/**
 * 预览式原位编辑：页面正文补丁回填（2026-09-13）
 * 与文章版同一条技术路线（utils/content-patch 纯函数，jsdom 原位回填），
 * 只回填 content_html 字段——区块 JSON（content）与标题等其它字段一律不碰。
 * 逐补丁校验旧值，任何失败都不落库（全部成功才保存），返回失败明细。
 */
export async function applyPageContentPatchesHandler(req: Request, res: Response) {
  try {
    const { pageKey } = req.params;
    const patches = Array.isArray(req.body?.patches) ? req.body.patches : null;
    if (!pageKey) return res.status(400).json(fail('缺少页面标识'));
    if (!patches || !patches.length) return res.status(400).json(fail('缺少补丁数据'));

    const page = await prisma.pageContent.findUnique({ where: { pageKey }, select: { id: true, pageKey: true, contentHtml: true } });
    if (!page) return res.status(404).json(fail('该页面不存在'));
    if (!page.contentHtml) return res.status(400).json(fail('该页面没有整段 HTML 正文，请使用「区块内容」编辑'));

    const result = applyContentPatches(page.contentHtml, patches);
    if (result.failed.length) {
      return res.status(400).json(fail(
        `${result.failed.length} 处修改应用失败（未保存）：` +
        result.failed.map((f) => `第 ${f.index + 1} 处 ${f.reason}`).join('；')
      ));
    }

    await prisma.pageContent.update({ where: { pageKey }, data: { contentHtml: result.html } });
    return res.json(success({ applied: result.applied, html: result.html }, `已更新 ${result.applied} 处内容`));
  } catch (error: any) {
    console.error('页面内容补丁应用失败:', error);
    return res.status(500).json(fail('内容修改失败：' + (error?.message || '未知错误')));
  }
}

/**
 * 页面预览样式探测（2026-09-13）：从 site/<页面>.html 提取该页真实的 CSS 列表与 main class。
 * 背景：28 个有 HTML 正文的页面在原站各有 4 种 CSS 组合与 theme-pharma / 无主题两类 main，
 *       预览文档若写死一份样式必有几页走样（小白会以为「改坏了」）→ 按页各用各的。
 * 查找规则与 viewPageUrl() 一致：slug || pageKey，去掉开头 / 与结尾 .html，home/index → index。
 */
export async function getPagePreviewTheme(req: Request, res: Response) {
  try {
    const { pageKey } = req.params;
    const page = await prisma.pageContent.findUnique({ where: { pageKey }, select: { pageKey: true, slug: true } });
    if (!page) return res.status(404).json(fail('页面不存在'));
    const raw = String(page.slug || page.pageKey || '').trim().replace(/^\/+/, '').replace(/\.html$/i, '');
    const key = (!raw || raw === 'home' || raw === 'index') ? 'index' : raw;

    // 运行目录兼容：本地与线上都以 backend 为 cwd，site/ 在项目根
    const candidates = [
      path.join(process.cwd(), '..', 'site', key + '.html'),
      path.join(process.cwd(), 'site', key + '.html'),
    ];
    let html: string | null = null;
    for (const f of candidates) {
      try { html = fs.readFileSync(f, 'utf8'); break; } catch { /* 试下一个 */ }
    }
    if (!html) return res.json(success({ mainClass: 's-page--inner main', cssList: [], source: null }));

    const mainM = /<main\b[^>]*class="([^"]*s-page--inner[^"]*)"/i.exec(html);
    const cssList: string[] = [];
    const re = /<link\b[\s\S]*?>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const tag = m[0];
      if (!/rel=["']?stylesheet/i.test(tag)) continue;
      const hrefM = /href=["']([^"']+)["']/i.exec(tag);
      if (!hrefM) continue;
      const href = hrefM[1].trim();
      if (!/\.css(?:\?|$)/i.test(href)) continue;
      if (/^(?:https?:)?\/\//i.test(href)) continue;           // 外链 CSS 不进预览
      cssList.push(href.startsWith('/') ? href : '/' + href);  // 相对路径 → 根相对
    }
    return res.json(success({
      mainClass: mainM ? mainM[1].trim() : 's-page--inner main',
      cssList,
      source: key + '.html',
    }));
  } catch (err: any) {
    console.error('getPagePreviewTheme error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 页面排序（交换两个页面的 sortOrder） */
export async function reorderPages(req: Request, res: Response) {
  try {
    const { id, direction } = req.body; // id: 当前页面ID, direction: 'up' | 'down'
    const current = await prisma.pageContent.findUnique({ where: { id } });
    if (!current) return res.json(fail('页面不存在'));

    const target = await prisma.pageContent.findFirst({
      where: direction === 'up'
        ? { sortOrder: { lt: current.sortOrder } }
        : { sortOrder: { gt: current.sortOrder } },
      orderBy: direction === 'up' ? { sortOrder: 'desc' } : { sortOrder: 'asc' },
    });
    if (!target) return res.json(fail('已经在边界'));

    // 交换 sortOrder
    await prisma.$transaction([
      prisma.pageContent.update({ where: { id: current.id }, data: { sortOrder: target.sortOrder } }),
      prisma.pageContent.update({ where: { id: target.id }, data: { sortOrder: current.sortOrder } }),
    ]);
    res.json(success(null));
  } catch (err: any) {
    console.error('reorderPages error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 删除页面 */
export async function deletePage(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const page = await prisma.pageContent.findUnique({ where: { id: Number(id) } });
    if (!page) return res.json(fail('页面不存在'));
    await prisma.pageContent.delete({ where: { id: Number(id) } });
    res.json(success(null));
  } catch (err: any) {
    console.error('deletePage error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}


// ===================== 分公司管理 =====================

/** 分公司列表 (公开) */
export async function listSubsidiaries(_req: Request, res: Response) {
  try {
    const list = await prisma.subsidiary.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json(success(list));
  } catch (err: any) {
    console.error('listSubsidiaries error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 新增分公司 */
export async function createSubsidiary(req: Request, res: Response) {
  try {
    const { name, country, city, address, phone, email, website, imageUrl, description, sortOrder } = req.body;
    if (!name) return res.json(fail('分公司名称不能为空'));
    const sub = await prisma.subsidiary.create({
      data: {
        name, country, city, address, phone, email, website,
        imageUrl: imageUrl || null,
        description: description || null,
        sortOrder: sortOrder || 0,
      },
    });
    res.json(success(sub));
  } catch (err: any) {
    console.error('createSubsidiary error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 更新分公司 */
export async function updateSubsidiary(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const { name, country, city, address, phone, email, website, imageUrl, description, sortOrder } = req.body;
    if (!name) return res.json(fail('分公司名称不能为空'));
    const sub = await prisma.subsidiary.update({
      where: { id },
      data: {
        name, country, city, address, phone, email, website,
        imageUrl: imageUrl || null,
        description: description || null,
        sortOrder: sortOrder || 0,
      },
    });
    res.json(success(sub));
  } catch (err: any) {
    console.error('updateSubsidiary error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}

/** 删除分公司 */
export async function deleteSubsidiary(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    await prisma.subsidiary.delete({ where: { id } });
    res.json(success(null));
  } catch (err: any) {
    console.error('deleteSubsidiary error:', err);
    res.status(500).json(fail('服务器错误'));
  }
}
