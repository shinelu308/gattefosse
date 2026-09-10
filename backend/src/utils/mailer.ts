import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { prisma } from './prisma';

/**
 * 邮件通知（求职申请）
 *
 * SMTP 配置优先级：数据库 settings 表 > 环境变量。
 * 未配置（smtp_enabled 未开启 / 缺 host 或 from）时 **静默跳过**，绝不影响主流程。
 * 后台「系统设置」页可随时补填账号，无需改代码重新部署。
 */

export const SMTP_SETTING_KEYS = [
  'smtp_enabled',
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'smtp_from_name',
  'hr_notify_email',
] as const;

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
  /** HR 收件人（多个用逗号分隔） */
  notifyTo: string;
}

function pick(v: string | undefined | null): string {
  return (v ?? '').toString().trim();
}

/**
 * 读取 SMTP 配置（settings 表优先，回退环境变量）
 * 返回 null 表示未配置或未启用
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  let map: Record<string, string> = {};
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: SMTP_SETTING_KEYS as unknown as string[] } },
    });
    map = Object.fromEntries(rows.map((r) => [r.key, pick(r.value)]));
  } catch (err) {
    console.error('[mailer] 读取 SMTP 配置失败:', err);
  }

  const get = (key: string, env?: string) => map[key] || pick(env ? process.env[env] : '');

  const enabled = get('smtp_enabled', 'SMTP_ENABLED');
  // enabled 为显式 false/0/off 时关闭；其余情况只要配了 host + from 就认为可用
  if (['false', '0', 'off', 'no'].includes(enabled.toLowerCase())) return null;

  const host = get('smtp_host', 'SMTP_HOST');
  const from = get('smtp_from', 'SMTP_FROM') || get('smtp_user', 'SMTP_USER');
  if (!host || !from) return null;

  const port = parseInt(get('smtp_port', 'SMTP_PORT') || '465', 10);
  const secureRaw = get('smtp_secure', 'SMTP_SECURE').toLowerCase();
  // 465 默认 SSL；显式配置优先
  const secure = secureRaw ? ['true', '1', 'ssl', 'yes'].includes(secureRaw) : port === 465;

  return {
    host,
    port,
    secure,
    user: get('smtp_user', 'SMTP_USER'),
    pass: get('smtp_pass', 'SMTP_PASS'),
    from,
    fromName: get('smtp_from_name', 'SMTP_FROM_NAME') || 'Gattefossé China',
    notifyTo: get('hr_notify_email', 'HR_NOTIFY_EMAIL') || get('smtp_user', 'SMTP_USER'),
  };
}

let cachedTransporter: { key: string; transporter: Transporter } | null = null;

async function getTransporter(cfg: SmtpConfig): Promise<Transporter> {
  const key = `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user}`;
  if (cachedTransporter && cachedTransporter.key === key) return cachedTransporter.transporter;

  const base = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };
  const transporter = nodemailer.createTransport(
    cfg.user ? { ...base, auth: { user: cfg.user, pass: cfg.pass } } : base
  );

  cachedTransporter = { key, transporter };
  return transporter;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 检查 SMTP 是否可用（后台设置页「测试连接」用），返回 null 表示成功 */
export async function verifySmtp(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getSmtpConfig();
  if (!cfg) return { ok: false, message: 'SMTP 未配置或未启用' };
  try {
    const t = await getTransporter(cfg);
    await t.verify();
    return { ok: true, message: 'SMTP 连接成功' };
  } catch (err) {
    return { ok: false, message: `SMTP 连接失败：${(err as Error).message}` };
  }
}

export interface CareerMailPayload {
  id: number;
  fullName: string;
  email: string;
  phone?: string | null;
  country?: string | null;
  position?: string | null;
  jobFunction?: string | null;
  message?: string | null;
  resumeName?: string | null;
  createdAt: Date;
}

function row(label: string, value: unknown): string {
  if (!value) return '';
  return `<tr><td style="padding:6px 14px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:6px 0;color:#111827;">${esc(value)}</td></tr>`;
}

/**
 * 发送求职申请通知：HR 提醒 + 候选人回执
 * 全程不抛出异常（失败只打日志）
 */
export async function sendCareerNotifications(app: CareerMailPayload): Promise<void> {
  let cfg: SmtpConfig | null = null;
  try {
    cfg = await getSmtpConfig();
  } catch {
    cfg = null;
  }
  if (!cfg) {
    console.log('[mailer] SMTP 未配置，跳过求职申请邮件通知（申请已入库）');
    return;
  }

  const transporter = await getTransporter(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
  const appliedAt = new Date(app.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 1) HR 提醒
  const hrSubject = `【新求职申请】${app.fullName}${app.position ? ' · ' + app.position : ''}`;
  const hrHtml = `
  <div style="font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:640px;">
    <h2 style="color:#8EB73C;margin:0 0 4px;">收到一份新的求职申请</h2>
    <p style="color:#6b7280;margin:0 0 16px;font-size:13px;">提交时间：${esc(appliedAt)}</p>
    <table style="border-collapse:collapse;font-size:14px;width:100%;">
      ${row('姓名', app.fullName)}
      ${row('邮箱', app.email)}
      ${row('电话', app.phone)}
      ${row('国家/地区', app.country)}
      ${row('应聘岗位', app.position)}
      ${row('职能领域', app.jobFunction)}
      ${row('简历文件', app.resumeName)}
    </table>
    ${app.message ? `<div style="margin-top:16px;padding:12px 14px;background:#f9fafb;border-left:3px solid #8EB73C;font-size:14px;color:#111827;white-space:pre-wrap;">${esc(app.message)}</div>` : ''}
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">请登录后台「招聘管理」查看完整信息并下载简历附件。</p>
    <p style="margin-top:6px;font-size:13px;color:#9ca3af;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>`;

  // 2) 候选人回执
  const candSubject = '我们已收到您的申请 · Gattefossé';
  const candHtml = `
  <div style="font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:640px;color:#111827;">
    <h2 style="color:#8EB73C;margin:0 0 12px;">申请已收到</h2>
    <p style="font-size:14px;line-height:1.7;">尊敬的 ${esc(app.fullName)}：</p>
    <p style="font-size:14px;line-height:1.7;">感谢您对 Gattefossé 的关注。我们已收到您的求职申请，人力资源团队会尽快审阅，并视情况与您进一步联系。</p>
    ${app.position ? `<p style="font-size:14px;line-height:1.7;">应聘岗位：<strong>${esc(app.position)}</strong></p>` : ''}
    <p style="font-size:14px;line-height:1.7;">祝您一切顺利。</p>
    <p style="margin-top:20px;font-size:14px;color:#4b5563;">Gattefossé 人力资源团队</p>
    <p style="margin-top:6px;font-size:12px;color:#9ca3af;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>`;

  const jobs: Array<{ to: string; subject: string; html: string; label: string }> = [];
  if (cfg.notifyTo) {
    jobs.push({ to: cfg.notifyTo, subject: hrSubject, html: hrHtml, label: 'HR 提醒' });
  }
  if (app.email) {
    jobs.push({ to: app.email, subject: candSubject, html: candHtml, label: '候选人回执' });
  }

  await Promise.all(
    jobs.map(async (job) => {
      try {
        await transporter.sendMail({
          from,
          to: job.to,
          subject: job.subject,
          html: job.html,
        });
        console.log(`[mailer] ${job.label} 已发送 → ${job.to}（申请 #${app.id}）`);
      } catch (err) {
        console.error(`[mailer] ${job.label} 发送失败（申请 #${app.id}）:`, (err as Error).message);
      }
    })
  );
}
