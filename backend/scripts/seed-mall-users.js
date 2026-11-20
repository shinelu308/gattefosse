/**
 * 把老系统（gin-vue-admin）会员导入新系统 users 表
 * 数据源：backend/scripts/data/old-mall-users.json
 *
 * 用法：
 *   node scripts/seed-mall-users.js            # dry-run，只报告
 *   node scripts/seed-mall-users.js --apply    # 写入
 *   FORCE=1 node scripts/seed-mall-users.js --apply   # 覆盖已存在会员的可编辑字段
 *
 * 规则：
 * - 以 email 为准 upsert；role !== 'user' 的账号（后台员工/超管）一律跳过
 * - 有密码 hash 的原样搬过来（bcrypt 兼容，老密码可直接登录）
 * - 老系统没有密码的，写入一个随机占位 hash（该账号无法用密码登录，需管理员重置）
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';
const DATA = path.join(__dirname, 'data', 'old-mall-users.json');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

(async () => {
  if (!fs.existsSync(DATA)) {
    console.error('缺少数据文件：' + DATA);
    process.exit(1);
  }
  const src = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const rows = src.list || [];
  console.log('数据源 ' + rows.length + ' 条（抓到 ' + src.fetchedAt + '）');

  // 占位密码：明文随机生成后即丢弃，任何人无法用密码登录
  const placeholderHash = bcrypt.hashSync('GF_IMPORT_' + crypto.randomBytes(24).toString('hex'), 10);

  const stat = { total: rows.length, create: 0, update: 0, same: 0, skipStaff: 0, badEmail: 0, placeholderPwd: 0 };
  const pendingCreate = [];
  const pendingUpdate = [];
  const badEmails = [];
  const staffHits = [];

  for (const r of rows) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { stat.badEmail++; badEmails.push(r.email + ' (' + (r.fullName || '') + ')'); continue; }

    const existed = await prisma.user.findUnique({ where: { email } });
    if (existed && existed.role !== 'user') { stat.skipStaff++; staffHits.push(email + ' → role=' + existed.role); continue; }

    const data = {
      fullName: r.fullName || email.split('@')[0],
      company: r.company || null,
      industry: r.industry || null,
      jobFunction: r.jobFunction || null,
      department: r.department || null,
      phone: r.phone || null,
      status: r.status || 'active',
      role: 'user',
    };
    const usePwd = r.passwordHash && String(r.passwordHash).startsWith('$2');
    if (!usePwd) stat.placeholderPwd++;

    if (!existed) {
      stat.create++;
      pendingCreate.push({ email, ...data, passwordHash: usePwd ? r.passwordHash : placeholderHash, createdAt: r.createdAt ? new Date(r.createdAt) : undefined });
    } else {
      // 已有会员：只补空字段，除非 FORCE
      const patch = {};
      for (const [k, v] of Object.entries(data)) {
        if (k === 'role') continue;
        if (FORCE) { if (v !== null && v !== undefined && v !== '') patch[k] = v; }
        else if ((existed[k] === null || existed[k] === undefined || existed[k] === '') && v) patch[k] = v;
      }
      if (usePwd && !existed.passwordHash.startsWith('$2')) patch.passwordHash = r.passwordHash;
      if (Object.keys(patch).length) { stat.update++; pendingUpdate.push({ email, patch }); }
      else stat.same++;
    }
  }

  console.log('\n=== 计划 ===');
  console.log(JSON.stringify(stat, null, 1));
  if (badEmails.length) console.log('邮箱不合法（跳过）: ' + badEmails.join(' | '));
  if (staffHits.length) console.log('命中后台账号（跳过）: ' + staffHits.join(' | '));
  console.log('新增样例: ' + JSON.stringify(pendingCreate.slice(0, 2).map((u) => ({ email: u.email, fullName: u.fullName, company: u.company, status: u.status, pwd: u.passwordHash.slice(0, 10) })), null, 1));
  console.log('更新样例: ' + JSON.stringify(pendingUpdate.slice(0, 3), null, 1));

  if (!APPLY) {
    console.log('\n（dry-run，未写库。加 --apply 才会写入）');
    await prisma.$disconnect();
    return;
  }

  console.log('\n开始写入…');
  let done = 0;
  for (const u of pendingCreate) {
    await prisma.user.create({ data: u });
    if (++done % 200 === 0) process.stdout.write('  ' + done + '/' + pendingCreate.length + '\n');
  }
  const doneCreate = done;
  done = 0;
  for (const u of pendingUpdate) {
    await prisma.user.update({ where: { email: u.email }, data: u.patch });
    if (++done % 200 === 0) process.stdout.write('  upd ' + done + '/' + pendingUpdate.length + '\n');
  }
  console.log('写入完成：新增 ' + doneCreate + ' 更新 ' + done);

  const total = await prisma.user.count();
  const members = await prisma.user.count({ where: { role: 'user' } });
  const byStatus = await prisma.user.groupBy({ by: ['status'], where: { role: 'user' }, _count: true });
  console.log('users 总数 ' + total + ' | 会员 ' + members);
  console.log('会员状态分布: ' + byStatus.map((x) => x.status + '=' + x._count).join('  '));
  await prisma.$disconnect();
})();
