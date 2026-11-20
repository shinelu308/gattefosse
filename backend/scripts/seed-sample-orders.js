/**
 * 老系统样品预定数据 → 新系统 sample_orders 导入
 *
 * 数据源：backend/scripts/data/sample-orders-plan.json
 *   （由老系统 web-admin.gattefossechina.cn 的 mallSampleOrder 接口导出后清洗生成，
 *     品名已按 pc_ingredients / pharma_products 归一化匹配为 items）
 *
 * 用法：
 *   node scripts/seed-sample-orders.js            # dry-run，只打印
 *   node scripts/seed-sample-orders.js --apply    # 真正写库
 *   FORCE=1 node scripts/seed-sample-orders.js --apply   # 覆盖已存在的同号订单
 *
 * 幂等：以 order_number（SO-OLD-000123 形式）为唯一键，重复执行不会产生重复订单。
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';

const PLAN_PATH = path.join(__dirname, 'data', 'sample-orders-plan.json');

function txt(v) {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
}

async function main() {
  if (!fs.existsSync(PLAN_PATH)) {
    console.error('找不到导入计划：' + PLAN_PATH);
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
  const orders = plan.orders || [];
  console.log(`计划订单数：${orders.length}（生成时间 ${plan.generatedAt}）`);

  // 邮箱 → 会员 ID（老系统 userId 已失效，按邮箱重新挂接）
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const mailToId = new Map();
  users.forEach((u) => { if (u.email) mailToId.set(u.email.trim().toLowerCase(), u.id); });

  // 已有订单号
  const existing = await prisma.sampleOrder.findMany({ select: { orderNumber: true, id: true } });
  const existMap = new Map(existing.map((o) => [o.orderNumber, o.id]));

  let created = 0, skipped = 0, overwritten = 0, itemsCreated = 0, linkedUser = 0, noItem = 0;
  const failures = [];

  for (const o of orders) {
    const userId = o.email ? (mailToId.get(o.email.trim().toLowerCase()) || null) : null;
    if (userId) linkedUser++;

    const data = {
      userId,
      orderNumber: o.orderNumber,
      status: o.status || 'submitted',
      companyName: txt(o.companyName),
      contactName: txt(o.contactName),
      email: txt(o.email),
      phone: txt(o.phone),
      address: txt(o.address),
      market: txt(o.market),
      department: txt(o.department),
      position: txt(o.position),
      province: txt(o.province),
      city: txt(o.city),
      district: txt(o.district),
      zipcode: txt(o.zipcode),
      sampleListRaw: txt(o.sampleListRaw),
      notes: txt(o.notes),
      submittedAt: o.submittedAt ? new Date(o.submittedAt) : null,
      createdAt: o.createdAt ? new Date(o.createdAt) : undefined,
      updatedAt: o.updatedAt ? new Date(o.updatedAt) : undefined,
    };
    const items = (o.items || []).filter((i) => i && i.id);
    if (!items.length) noItem++;

    const hitId = existMap.get(o.orderNumber);
    if (hitId && !FORCE) { skipped++; continue; }

    if (!APPLY) {
      created++;
      itemsCreated += items.length;
      continue;
    }

    try {
      if (hitId) {
        await prisma.sampleOrder.update({ where: { id: hitId }, data });
        await prisma.sampleOrderItem.deleteMany({ where: { orderId: hitId } });
        if (items.length) {
          await prisma.sampleOrderItem.createMany({
            data: items.map((i) => ({
              orderId: hitId,
              productType: i.type,
              productId: i.id,
              quantity: i.quantity || 1,
            })),
          });
        }
        overwritten++;
        itemsCreated += items.length;
      } else {
        const row = await prisma.sampleOrder.create({
          data: {
            ...data,
            items: items.length
              ? { create: items.map((i) => ({ productType: i.type, productId: i.id, quantity: i.quantity || 1 })) }
              : undefined,
          },
        });
        existMap.set(row.orderNumber, row.id);
        created++;
        itemsCreated += items.length;
      }
    } catch (e) {
      failures.push(`${o.orderNumber} ${o.contactName || ''}: ${e.message}`);
    }
  }

  const total = await prisma.sampleOrder.count();
  const totalItems = await prisma.sampleOrderItem.count();

  console.log('---');
  console.log(`${APPLY ? '已写入' : '将写入'}：新建 ${created} 单，覆盖 ${overwritten} 单，跳过 ${skipped} 单`);
  console.log(`明细：${itemsCreated} 条；无明细订单 ${noItem} 单；按邮箱挂接会员 ${linkedUser} 单`);
  console.log(`库内现有：订单 ${total} 单，明细 ${totalItems} 条`);
  if (failures.length) {
    console.log(`失败 ${failures.length} 条：`);
    failures.slice(0, 20).forEach((f) => console.log('  ' + f));
  }
  if (!APPLY) console.log('（dry-run，加 --apply 才会真正写库）');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
