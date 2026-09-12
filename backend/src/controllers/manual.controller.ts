import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { config } from '../config';

/**
 * 使用手册 —— 后台「帮助 → 使用手册」
 * ============================================================================
 * 手册按「章节」入库（表 manual_sections，建表脚本 scripts/create-manual-sections-table.js）。
 * 目的：① 操作人员不必记网址，后台一键查阅；② 系统界面改版后，文字与截图在后台
 * 直接改、直接换图，保存即生效，不用等发版。
 *
 * 权限：读取=任何登录用户；写入=editor / super_admin（与其它模块一致，不新增权限项）。
 * 详见 docs/后台使用手册方案.md
 */

/** 章节列表（按 sortOrder）；前端据此渲染左侧目录与正文 */
export async function listSections(_req: Request, res: Response) {
  try {
    const rows = await prisma.manualSection.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    // 顺带把「章」分组好，省得前端再算一遍
    const chapters: Array<{ no: string; title: string; sections: unknown[] }> = [];
    for (const r of rows) {
      let g = chapters.find((c) => c.no === r.chapterNo);
      if (!g) {
        g = { no: r.chapterNo, title: r.chapter, sections: [] };
        chapters.push(g);
      }
      g.sections.push({
        id: r.id,
        key: r.sectionKey,
        title: r.title,
        bodyHtml: r.bodyHtml || '',
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      });
    }
    return res.json(success({ total: rows.length, chapters }, '获取成功'));
  } catch (error) {
    console.error('获取使用手册失败:', error);
    return res.status(500).json(fail('获取使用手册失败'));
  }
}

/** 保存单章（标题 + 正文 HTML） */
export async function saveSection(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json(fail('章节 id 不合法'));

    const existing = await prisma.manualSection.findUnique({ where: { id } });
    if (!existing) return res.status(404).json(fail('章节不存在'));

    const { title, bodyHtml } = req.body || {};
    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json(fail('章节标题不能为空'));
    }

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) data.title = String(title).trim();
    if (bodyHtml !== undefined) data.bodyHtml = String(bodyHtml);
    data.updatedBy = req.user?.email || null;

    const item = await prisma.manualSection.update({ where: { id }, data });
    return res.json(success(item, '保存成功'));
  } catch (error) {
    console.error('保存使用手册章节失败:', error);
    return res.status(500).json(fail('保存使用手册章节失败'));
  }
}

/** 新增一章（系统加了新模块时用） */
export async function createSection(req: Request, res: Response) {
  try {
    const { sectionKey, chapterNo, chapter, title, bodyHtml } = req.body || {};
    if (!sectionKey || !String(sectionKey).trim()) {
      return res.status(400).json(fail('章节号不能为空，如 5.4'));
    }
    if (!title || !String(title).trim()) {
      return res.status(400).json(fail('节标题不能为空'));
    }
    const key = String(sectionKey).trim();
    const dup = await prisma.manualSection.findUnique({ where: { sectionKey: key } });
    if (dup) return res.status(409).json(fail(`章节号 ${key} 已存在`));

    const no = String(chapterNo || key.split('.')[0] || '').trim();
    // 排到末尾
    const last = await prisma.manualSection.findFirst({ orderBy: { sortOrder: 'desc' } });
    const item = await prisma.manualSection.create({
      data: {
        sectionKey: key,
        chapterNo: no,
        chapter: String(chapter || '').trim() || no,
        title: String(title).trim(),
        bodyHtml: bodyHtml ? String(bodyHtml) : '',
        sortOrder: (last?.sortOrder ?? 0) + 10,
        updatedBy: req.user?.email || null,
      },
    });
    return res.json(success(item, '新增成功'));
  } catch (error) {
    console.error('新增使用手册章节失败:', error);
    return res.status(500).json(fail('新增使用手册章节失败'));
  }
}

/** 删除一章 */
export async function deleteSection(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json(fail('章节 id 不合法'));
    const existing = await prisma.manualSection.findUnique({ where: { id } });
    if (!existing) return res.status(404).json(fail('章节不存在'));
    await prisma.manualSection.delete({ where: { id } });
    return res.json(success(null, '删除成功'));
  } catch (error) {
    console.error('删除使用手册章节失败:', error);
    return res.status(500).json(fail('删除使用手册章节失败'));
  }
}

/** 重排章节顺序（传 id 数组，按数组下标写 sortOrder） */
export async function reorderSections(req: Request, res: Response) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!ids || !ids.length) return res.status(400).json(fail('缺少 ids'));
    await prisma.$transaction(
      ids.map((raw: unknown, i: number) =>
        prisma.manualSection.update({
          where: { id: parseInt(String(raw), 10) },
          data: { sortOrder: (i + 1) * 10 },
        })
      )
    );
    return res.json(success(null, '排序已保存'));
  } catch (error) {
    console.error('重排使用手册章节失败:', error);
    return res.status(500).json(fail('重排使用手册章节失败'));
  }
}

/**
 * 手册配图上传
 * 落 uploads/manual/，返回可直接写进正文的 URL。
 * ⚠️ 上传/换图是手册「跟上系统改版」的主要动作 —— 截图重拍后在这里换掉即可。
 */
export async function uploadManualImage(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json(fail('请选择要上传的图片'));
    const url = `/uploads/manual/${req.file.filename}`;
    const stat = fs.statSync(path.join(config.upload.dir, 'manual', req.file.filename));
    return res.json(success({ url, filename: req.file.filename, size: stat.size }, '上传成功'));
  } catch (error) {
    console.error('手册配图上传失败:', error);
    return res.status(500).json(fail('手册配图上传失败'));
  }
}
