import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { config } from '../config';
import { sendCareerNotifications } from '../utils/mailer';

/** 状态白名单：与后台下拉一致 */
const CAREER_STATUS = ['new', 'contacting', 'interview', 'hired', 'rejected', 'archived'] as const;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 把存储的相对路径（可能形如 resumes/xxx.pdf）安全解析为磁盘绝对路径
 * 只取 basename，杜绝 ../ 穿越
 */
function resolveResumeFile(stored: string): string {
  return path.join(config.resume.dir, path.basename(stored));
}

/** 校验上传返回的 token 是否形如随机文件名（防目录穿越/注入） */
function isSafeToken(token: string): boolean {
  return /^[a-z0-9]{8,40}\.(pdf|doc|docx)$/i.test(token);
}

/**
 * multer(busboy) 按 latin1 解析 multipart 文件名，中文名会变乱码
 * （如「张三-简历.pdf」→「å¼ ä¸-ç®å.pdf」）。此处还原为 UTF-8。
 * 若字符串本身已含 latin1 以外的字符，说明已被正确解码，原样返回。
 */
function decodeOriginalName(name: string): string {
  const raw = String(name || '');
  if (!raw) return '';
  if (/[^\x00-\xFF]/.test(raw)) return raw;
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? raw : decoded;
  } catch {
    return raw;
  }
}

/**
 * 上传简历/求职信（前台匿名，multipart）
 * 返回 token（文件名），提交申请时回传，不暴露可直接访问的 URL
 */
export async function uploadResume(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json(fail('请选择要上传的简历文件'));
    }
    return res.json(
      success(
        {
          token: req.file.filename,
          name: decodeOriginalName(req.file.originalname),
          size: req.file.size,
        },
        '上传成功'
      )
    );
  } catch (error) {
    console.error('简历上传失败:', error);
    return res.status(500).json(fail('简历上传失败'));
  }
}

/**
 * 创建求职申请（前台公开接口）
 * - 蜜罐字段 url：被填写即视为机器人，静默丢弃
 * - 隐私政策必须同意
 * - 同邮箱 5 分钟内重复提交拦截
 * - 邮件通知异步发送，失败不影响提交结果
 */
export async function createCareer(req: Request, res: Response) {
  try {
    const body = req.body || {};

    // 蜜罐：原站表单里名为 url 的隐藏字段，正常用户永远留空
    if (String(body.url || '').trim()) {
      console.warn('[career] 蜜罐字段被填写，判定为垃圾提交，已丢弃');
      return res.json(success({ id: null }, '申请提交成功'));
    }

    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();

    if (!fullName) return res.status(400).json(fail('请填写姓名'));
    if (!email) return res.status(400).json(fail('请填写邮箱'));
    if (!isValidEmail(email)) return res.status(400).json(fail('邮箱格式不正确'));
    if (fullName.length > 100) return res.status(400).json(fail('姓名过长'));

    // 隐私政策同意（原站复选框默认勾选，未勾选不允许提交）
    if (body.agreed === false || body.agreed === 'false') {
      return res.status(400).json(fail('请先阅读并同意隐私政策'));
    }

    // 重复提交拦截（同一邮箱 5 分钟内）
    const recent = await prisma.careerApplication.findFirst({
      where: { email, createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
      select: { id: true },
    });
    if (recent) {
      return res.status(429).json(fail('您刚刚已提交过申请，请稍后再试'));
    }

    // 简历 token → 落库相对路径（文件不存在则视为未上传）
    let resumePath: string | null = null;
    let resumeName: string | null = null;
    const resumeToken = String(body.resumeToken || '').trim();
    if (resumeToken && isSafeToken(resumeToken)) {
      const abs = resolveResumeFile(resumeToken);
      if (fs.existsSync(abs)) {
        resumePath = `resumes/${path.basename(resumeToken)}`;
        resumeName = body.resumeName
          ? decodeOriginalName(String(body.resumeName)).slice(0, 200)
          : path.basename(resumeToken);
      }
    }

    const firstName = String(body.firstName || '').trim() || null;
    const lastName = String(body.lastName || '').trim() || null;

    const application = await prisma.careerApplication.create({
      data: {
        fullName,
        firstName,
        lastName,
        email,
        phone: String(body.phone || '').trim() || null,
        country: String(body.country || '').trim() || null,
        position: String(body.position || '').trim() || null,
        jobFunction: String(body.jobFunction || '').trim() || null,
        message: String(body.message || '').trim() || null,
        resumePath,
        resumeName,
        status: 'new',
        ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
      },
    });

    // 邮件通知：不 await 阻塞响应，失败只记日志
    void sendCareerNotifications({
      id: application.id,
      fullName: application.fullName,
      email: application.email,
      phone: application.phone,
      country: application.country,
      position: application.position,
      jobFunction: application.jobFunction,
      message: application.message,
      resumeName: application.resumeName,
      createdAt: application.createdAt,
    }).catch((err) => console.error('[career] 邮件通知异常:', err));

    return res.json(success({ id: application.id }, '申请提交成功'));
  } catch (error) {
    console.error('提交求职申请失败:', error);
    return res.status(500).json(fail('提交求职申请失败，请稍后重试'));
  }
}

/**
 * 获取求职申请列表（后台管理）
 * 支持 status / keyword / 日期区间筛选
 */
export async function listCareers(req: Request, res: Response) {
  try {
    const { page = '1', limit = '20', status, keyword, startDate, endDate } = req.query;
    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit)) || 20));

    const where: Record<string, unknown> = {};
    if (status && CAREER_STATUS.includes(String(status) as (typeof CAREER_STATUS)[number])) {
      where.status = String(status);
    }
    if (keyword && String(keyword).trim()) {
      const kw = String(keyword).trim();
      where.OR = [
        { fullName: { contains: kw } },
        { email: { contains: kw } },
        { position: { contains: kw } },
        { phone: { contains: kw } },
      ];
    }
    if (startDate || endDate) {
      const range: Record<string, Date> = {};
      if (startDate) range.gte = new Date(`${startDate}T00:00:00`);
      if (endDate) range.lte = new Date(`${endDate}T23:59:59.999`);
      where.createdAt = range;
    }

    const [total, items, statusCounts] = await Promise.all([
      prisma.careerApplication.count({ where: where as never }),
      prisma.careerApplication.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.careerApplication.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const counts: Record<string, number> = {};
    statusCounts.forEach((c) => {
      counts[c.status] = c._count._all;
    });

    return res.json(
      success({
        list: items,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
        counts,
      })
    );
  } catch (error) {
    console.error('获取求职列表失败:', error);
    return res.status(500).json(fail('获取求职列表失败'));
  }
}

/**
 * 获取单条求职申请详情（后台管理）
 */
export async function getCareer(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json(fail('参数错误'));

    const item = await prisma.careerApplication.findUnique({ where: { id } });
    if (!item) return res.status(404).json(fail('申请不存在'));

    return res.json(success(item));
  } catch (error) {
    console.error('获取求职详情失败:', error);
    return res.status(500).json(fail('获取求职详情失败'));
  }
}

/**
 * 更新求职申请状态/备注（后台管理）
 */
export async function updateCareer(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json(fail('参数错误'));

    const { status, notes } = req.body || {};

    if (status !== undefined && !CAREER_STATUS.includes(String(status) as (typeof CAREER_STATUS)[number])) {
      return res.status(400).json(fail('无效的状态值'));
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) {
      data.status = String(status);
      // 首次离开「新申请」时记录审阅时间
      const cur = await prisma.careerApplication.findUnique({ where: { id }, select: { reviewedAt: true } });
      if (!cur?.reviewedAt && String(status) !== 'new') data.reviewedAt = new Date();
    }
    if (notes !== undefined) data.notes = String(notes);

    const updated = await prisma.careerApplication.update({ where: { id }, data: data as never });
    return res.json(success(updated, '已更新'));
  } catch (error) {
    console.error('更新求职申请失败:', error);
    return res.status(500).json(fail('更新求职申请失败'));
  }
}

/**
 * 删除求职申请（后台管理）— 同时清理简历文件
 */
export async function deleteCareer(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json(fail('参数错误'));

    const item = await prisma.careerApplication.findUnique({ where: { id } });
    if (!item) return res.status(404).json(fail('申请不存在'));

    for (const stored of [item.resumePath, item.coverLetterPath]) {
      if (!stored) continue;
      try {
        const abs = resolveResumeFile(stored);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (err) {
        console.error('[career] 删除附件失败:', err);
      }
    }

    await prisma.careerApplication.delete({ where: { id } });
    return res.json(success(null, '已删除'));
  } catch (error) {
    console.error('删除求职申请失败:', error);
    return res.status(500).json(fail('删除求职申请失败'));
  }
}

/**
 * 下载简历/求职信（后台鉴权，私有目录文件由服务端读出后回传）
 * kind: resume | cover
 */
export async function downloadCareerFile(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    const kind = String(req.params.kind || 'resume');
    if (!id) return res.status(400).json(fail('参数错误'));
    if (!['resume', 'cover'].includes(kind)) return res.status(400).json(fail('参数错误'));

    const item = await prisma.careerApplication.findUnique({ where: { id } });
    if (!item) return res.status(404).json(fail('申请不存在'));

    const stored = kind === 'resume' ? item.resumePath : item.coverLetterPath;
    const origName = (kind === 'resume' ? item.resumeName : item.coverLetterName) || path.basename(stored || '');
    if (!stored) return res.status(404).json(fail('该申请没有附件'));

    const abs = resolveResumeFile(stored);
    if (!fs.existsSync(abs)) {
      return res.status(404).json(fail('附件文件已不存在'));
    }

    const ext = path.extname(abs).toLowerCase();
    const mime =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.doc'
          ? 'application/msword'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(origName)}"; filename*=UTF-8''${encodeURIComponent(origName)}`
    );
    return res.sendFile(abs);
  } catch (error) {
    console.error('下载简历失败:', error);
    return res.status(500).json(fail('下载简历失败'));
  }
}
