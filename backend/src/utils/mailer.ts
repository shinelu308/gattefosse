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
  'order_notify_email',
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
  /** 订单业务通知收件人（未配置时回退 HR 收件人） */
  orderNotifyTo: string;
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
    orderNotifyTo:
      get('order_notify_email', 'ORDER_NOTIFY_EMAIL') ||
      get('hr_notify_email', 'HR_NOTIFY_EMAIL') ||
      get('smtp_user', 'SMTP_USER'),
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
  coverLetterName?: string | null;
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
      ${row('求职信文件', app.coverLetterName)}
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

/* ============================================================================
 * 样品订单邮件通知（261010）
 * 客户诉求：把订单与邮件推送绑定 —— 注册会员提交申请后能收到邮件，
 * 邮件中说明审批结果；订单被审核/流转时给会员发状态提醒。
 *
 * 与求职申请同一套 SMTP 配置；未配置时静默跳过，绝不影响订单主流程。
 * ==========================================================================*/

export interface OrderMailItem {
  name: string;
  code?: string | null;
  quantity: number;
}

export interface OrderMailPayload {
  id: number;
  orderNumber: string;
  status: string;
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  /** 后台审批意见（随状态变更邮件发给会员） */
  adminNote?: string | null;
  items?: OrderMailItem[];
}

/** 订单状态 → 邮件标题/审批结论文案/步骤下标 */
const ORDER_STATUS_MAIL: Record<
  string,
  { title: string; subject: string; lead: string; step: number; tone: 'ok' | 'warn' | 'bad' }
> = {
  draft: {
    title: '申请已保存为草稿',
    subject: '您的样品申请已保存为草稿',
    lead: '您的样品申请目前为草稿状态，尚未提交审核。如需提交，请在「我的订单」中确认后提交。',
    step: -1,
    tone: 'warn',
  },
  submitted: {
    title: '申请已提交，等待审核',
    subject: '我们已收到您的样品申请',
    lead: '您的样品申请已成功提交，我们已进入资料核对阶段，审核结果将第一时间通过邮件通知您。',
    step: 0,
    tone: 'ok',
  },
  processing: {
    title: '审核通过 · 正在处理',
    subject: '您的样品申请已通过初审，正在处理中',
    lead: '恭喜，您的样品申请已通过资质初审，目前正在安排备样与出库，请留意后续发货通知。',
    step: 1,
    tone: 'ok',
  },
  shipped: {
    title: '样品已寄出',
    subject: '您的样品已寄出，请注意查收',
    lead: '您的样品已交付物流，预计 3～5 个工作日送达，请注意查收。',
    step: 2,
    tone: 'ok',
  },
  completed: {
    title: '申请已完成',
    subject: '您的样品申请已完成',
    lead: '本次样品申请已全部完成。感谢您对 Gattefossé 的关注，期待后续为您提供更多支持。',
    step: 3,
    tone: 'ok',
  },
  cancelled: {
    title: '很遗憾，申请未通过审核',
    subject: '关于您的样品申请审核结果',
    lead: '经审核，本次样品申请暂未通过。如您认为有误或希望补充资料，欢迎回复本邮件与我们联系。',
    step: -1,
    tone: 'bad',
  },
};

const ORDER_STEPS = ['提交申请', '审核处理', '样品寄出', '完成'];

const TONE_COLOR: Record<string, string> = {
  ok: '#8EB73C',
  warn: '#D89A22',
  bad: '#D64545',
};

export function orderStatusMailTitle(status: string): string {
  return (ORDER_STATUS_MAIL[status] || ORDER_STATUS_MAIL.submitted).title;
}

function stepBar(status: string): string {
  const meta = ORDER_STATUS_MAIL[status] || ORDER_STATUS_MAIL.submitted;
  const cur = meta.step;
  if (cur < 0) {
    return `<div style="margin:18px 0 6px;padding:12px 14px;background:#fdf3f3;border-left:3px solid ${TONE_COLOR.bad};font-size:13px;color:#8a3b3b;">当前环节：${esc(meta.title)}</div>`;
  }
  const cells = ORDER_STEPS.map((label, i) => {
    const done = i <= cur;
    const color = done ? TONE_COLOR.ok : '#d7dbe0';
    const text = done ? '#3c4248' : '#9aa5ad';
    return `<td style="width:25%;text-align:center;vertical-align:top;">
      <div style="height:6px;border-radius:3px;background:${color};"></div>
      <div style="margin-top:7px;font-size:12px;color:${text};${i === cur ? 'font-weight:600;' : ''}">${esc(label)}</div>
    </td>`;
  }).join('');
  return `<table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:20px 0 4px;"><tr>${cells}</tr></table>`;
}

function orderItemsTable(items?: OrderMailItem[]): string {
  if (!items || !items.length) return '';
  const rows = items
    .map(
      (it, i) =>
        `<tr style="background:${i % 2 ? '#fafbfc' : '#fff'};">
          <td style="padding:9px 12px;border-bottom:1px solid #eef1f4;font-size:13px;color:#111827;">${esc(it.name)}${
            it.code ? `<span style="color:#9aa5ad;font-size:12px;"> · ${esc(it.code)}</span>` : ''
          }</td>
          <td style="padding:9px 12px;border-bottom:1px solid #eef1f4;font-size:13px;color:#6b7280;white-space:nowrap;text-align:right;">× ${esc(it.quantity)}</td>
        </tr>`
    )
    .join('');
  return `<table style="border-collapse:collapse;width:100%;margin-top:8px;">
    <tr><th style="text-align:left;padding:8px 12px;font-size:12px;color:#6b7280;font-weight:500;background:#f6f8fa;">样品名称</th>
        <th style="text-align:right;padding:8px 12px;font-size:12px;color:#6b7280;font-weight:500;background:#f6f8fa;">数量</th></tr>
    ${rows}
  </table>`;
}

/** 会员端状态提醒邮件 HTML */
export function buildOrderMemberHtml(o: OrderMailPayload): string {
  const meta = ORDER_STATUS_MAIL[o.status] || ORDER_STATUS_MAIL.submitted;
  const tone = TONE_COLOR[meta.tone];
  const when = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const greet = o.contactName ? `${esc(o.contactName)}，您好：` : '您好：';

  return `
  <div style="font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:640px;color:#111827;background:#fff;">
    <div style="padding:20px 24px;border-bottom:3px solid ${tone};">
      <div style="font-size:13px;letter-spacing:.08em;color:#8EB73C;font-weight:600;">GATTEFOSSÉ CHINA</div>
      <div style="font-size:20px;font-weight:700;margin-top:6px;">${esc(meta.title)}</div>
      <div style="font-size:12px;color:#9aa5ad;margin-top:6px;">订单号 ${esc(o.orderNumber)} · ${esc(when)}</div>
    </div>

    <div style="padding:22px 24px 4px;">
      <p style="font-size:14px;line-height:1.8;margin:0 0 10px;">${greet}</p>
      <p style="font-size:14px;line-height:1.8;margin:0;color:#3c4248;">${esc(meta.lead)}</p>
      ${o.adminNote ? `<div style="margin-top:16px;padding:13px 15px;background:#f6f9ef;border-left:3px solid ${TONE_COLOR.ok};font-size:14px;line-height:1.75;color:#2f3a20;white-space:pre-wrap;"><strong style="display:block;margin-bottom:4px;color:#5b7a1f;">审批意见</strong>${esc(o.adminNote)}</div>` : ''}
      ${stepBar(o.status)}
    </div>

    <div style="padding:14px 24px 4px;">
      <table style="border-collapse:collapse;font-size:13px;width:100%;">
        ${row('订单号', o.orderNumber)}
        ${row('公司名称', o.companyName)}
        ${row('联系人', o.contactName)}
        ${row('联系电话', o.phone)}
        ${row('收货地址', o.address)}
        ${row('申请备注', o.notes)}
      </table>
    </div>

    ${o.items && o.items.length ? `<div style="padding:10px 24px 4px;"><div style="font-size:13px;font-weight:600;color:#3c4248;margin-bottom:2px;">申请样品</div>${orderItemsTable(o.items)}</div>` : ''}

    <div style="padding:20px 24px 24px;">
      <p style="font-size:13px;line-height:1.8;color:#6b7280;margin:0;">您也可以登录网站，在「<a href="/account-my-order.html" style="color:#8EB73C;text-decoration:none;">我的订单</a>」中随时查看本单的最新状态与审批意见。</p>
      <p style="font-size:13px;color:#4b5563;margin:18px 0 0;">Gattefossé 中国 · 客户服务团队</p>
      <p style="font-size:12px;color:#9ca3af;margin:6px 0 0;">此邮件由系统自动发送，请勿直接回复。</p>
    </div>
  </div>`;
}

/** 内部业务提醒邮件 HTML（新申请到达） */
export function buildOrderInternalHtml(o: OrderMailPayload): string {
  const when = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return `
  <div style="font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:640px;color:#111827;">
    <h2 style="color:#8EB73C;margin:0 0 4px;">收到一份新的样品申请</h2>
    <p style="color:#6b7280;margin:0 0 16px;font-size:13px;">提交时间：${esc(when)} · 订单号 ${esc(o.orderNumber)}</p>
    <table style="border-collapse:collapse;font-size:14px;width:100%;">
      ${row('公司名称', o.companyName)}
      ${row('联系人', o.contactName)}
      ${row('邮箱', o.email)}
      ${row('联系电话', o.phone)}
      ${row('收货地址', o.address)}
      ${row('申请备注', o.notes)}
    </table>
    ${o.items && o.items.length ? `<div style="margin-top:14px;font-size:13px;font-weight:600;color:#3c4248;">申请样品</div>${orderItemsTable(o.items)}` : ''}
    <p style="margin-top:20px;font-size:13px;color:#6b7280;">请登录后台「运营 → 样品订单」审核，审核结论与审批意见会同步邮件通知会员。</p>
    <p style="margin-top:6px;font-size:13px;color:#9ca3af;">此邮件由系统自动发送。</p>
  </div>`;
}

/**
 * 发送订单邮件通知
 * @param o 订单负载
 * @param opts.mode 'created' = 新申请（会员确认 + 内部提醒）；'status' = 状态流转（仅会员提醒）
 * 全程不抛出异常（失败只打日志），订单主流程不受影响
 */
export async function sendOrderNotifications(
  o: OrderMailPayload,
  opts: { mode?: 'created' | 'status' } = {}
): Promise<void> {
  const mode = opts.mode || 'status';
  let cfg: SmtpConfig | null = null;
  try {
    cfg = await getSmtpConfig();
  } catch {
    cfg = null;
  }
  if (!cfg) {
    console.log(`[mailer] SMTP 未配置，跳过订单邮件通知（订单 ${o.orderNumber}，状态 ${o.status}）`);
    return;
  }

  const meta = ORDER_STATUS_MAIL[o.status] || ORDER_STATUS_MAIL.submitted;
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
  const to = (o.email || '').trim();

  const jobs: Array<{ to: string; subject: string; html: string; label: string }> = [];
  if (to) {
    jobs.push({
      to,
      subject: `${meta.subject} · ${o.orderNumber}`,
      html: buildOrderMemberHtml(o),
      label: '会员状态提醒',
    });
  }
  if (mode === 'created' && cfg.orderNotifyTo) {
    jobs.push({
      to: cfg.orderNotifyTo,
      subject: `【新样品申请】${o.companyName || o.contactName || o.orderNumber} · ${o.orderNumber}`,
      html: buildOrderInternalHtml(o),
      label: '内部业务提醒',
    });
  }

  if (!jobs.length) {
    console.log(`[mailer] 订单 ${o.orderNumber} 无可用收件人，跳过`);
    return;
  }

  let transporter: Transporter;
  try {
    transporter = await getTransporter(cfg);
  } catch (err) {
    console.error(`[mailer] 创建 SMTP 连接失败（订单 ${o.orderNumber}）:`, (err as Error).message);
    return;
  }

  await Promise.all(
    jobs.map(async (job) => {
      try {
        await transporter.sendMail({ from, to: job.to, subject: job.subject, html: job.html });
        console.log(`[mailer] ${job.label} 已发送 → ${job.to}（订单 ${o.orderNumber}）`);
      } catch (err) {
        console.error(`[mailer] ${job.label} 发送失败（订单 ${o.orderNumber}）:`, (err as Error).message);
      }
    })
  );
}
