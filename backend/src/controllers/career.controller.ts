import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../utils/prisma';
import { success, fail } from '../utils/response';
import { config } from '../config';
import { sendCareerNotifications } from '../utils/mailer';

/** 状态白名单：与后台下拉一致 */
const CAREER_STATUS = ['new', 'contacting', 'interview', 'hired', 'rejected', 'archived'] as const;

/** 职能领域白名单：与原站 gattefosse.com/job-form 的 Function 下拉一致 */
const JOB_FUNCTIONS = ['Pharmaceuticals', 'Personal care', 'Support'] as const;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 姓名拼装：名字里含中日韩字符时按「姓+名」排列，否则按「名 姓」
 * 三 + 张 → 张三；John + Smith → John Smith
 */
function composeFullName(firstName: string, lastName: string): string {
  if (firstName && lastName) {
    const hasCjk = /[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(firstName + lastName);
    return hasCjk ? `${lastName}${firstName}` : `${firstName} ${lastName}`;
  }
  return firstName || lastName || '';
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
 * kind=resume（默认）| cover，均由 ?kind= 指定
 * 返回 token（文件名），提交申请时回传，不暴露可直接访问的 URL
 */
export async function uploadResume(req: Request, res: Response) {
  const kind = String(req.query.kind || 'resume') === 'cover' ? 'cover' : 'resume';
  const label = kind === 'cover' ? '求职信' : '简历';
  try {
    if (!req.file) {
      return res.status(400).json(fail(`请选择要上传的${label}文件`));
    }
    return res.json(
      success(
        {
          kind,
          token: req.file.filename,
          name: decodeOriginalName(req.file.originalname),
          size: req.file.size,
        },
        '上传成功'
      )
    );
  } catch (error) {
    console.error(`${label}上传失败:`, error);
    return res.status(500).json(fail(`${label}上传失败`));
  }
}

/**
 * 解析上传 token → { stored: 'resumes/xxx.pdf', name } | null
 * token 不合法或文件不存在时返回 null（视为未上传，不阻断提交）
 */
function resolveUploaded(token: unknown, name: unknown): { stored: string; name: string } | null {
  const t = String(token || '').trim();
  if (!t || !isSafeToken(t)) return null;
  const base = path.basename(t);
  if (!fs.existsSync(resolveResumeFile(base))) return null;
  const finalName = name ? decodeOriginalName(String(name)).slice(0, 200) : base;
  return { stored: `resumes/${base}`, name: finalName };
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

    // ===== 姓名：原站为 First name / Last name 两栏，兼容旧客户端的 fullName =====
    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim();
    const fullName = String(body.fullName || '').trim() || composeFullName(firstName, lastName);

    if (!fullName) return res.status(400).json(fail('请填写姓名'));
    if (fullName.length > 100) return res.status(400).json(fail('姓名过长'));
    if (firstName.length > 50 || lastName.length > 50) return res.status(400).json(fail('姓名过长'));

    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json(fail('请填写邮箱'));
    if (!isValidEmail(email)) return res.status(400).json(fail('邮箱格式不正确'));

    // ===== 岗位相关：与原站 job-form 必填项一一对应 =====
    const position = String(body.position || '').trim();          // Desired job 期望岗位
    const jobFunction = String(body.jobFunction || '').trim();    // Function 职能领域
    const country = String(body.country || '').trim();            // Desired country 期望国家
    const message = String(body.message || '').trim();            // Explain your motivation 申请说明

    if (!position) return res.status(400).json(fail('请填写期望岗位'));
    if (position.length > 150) return res.status(400).json(fail('期望岗位过长'));
    if (!jobFunction) return res.status(400).json(fail('请选择职能领域'));
    if (!(JOB_FUNCTIONS as readonly string[]).includes(jobFunction)) {
      return res.status(400).json(fail('职能领域取值无效'));
    }
    if (!country) return res.status(400).json(fail('请选择期望国家'));
    if (!message) return res.status(400).json(fail('请填写申请说明'));

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

    // 简历（必填）/ 求职信（选填）：token → 落库相对路径，文件不存在则视为未上传
    const resume = resolveUploaded(body.resumeToken, body.resumeName);
    const cover = resolveUploaded(body.coverLetterToken, body.coverLetterName);

    const application = await prisma.careerApplication.create({
      data: {
        fullName,
        firstName: firstName || null,
        lastName: lastName || null,
        email,
        phone: String(body.phone || '').trim() || null,
        country,
        position,
        jobFunction,
        message,
        resumePath: resume?.stored || null,
        resumeName: resume?.name || null,
        coverLetterPath: cover?.stored || null,
        coverLetterName: cover?.name || null,
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
      coverLetterName: application.coverLetterName,
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
