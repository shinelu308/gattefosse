/**
 * 老系统「加入我们 / webCareer」→ 新系统 career_applications 导入
 *
 * 数据源：backend/scripts/data/career-applications-plan.json
 * 简历文件：需先放到 RESUME_DIR（默认 backend/storage/resumes/），文件名已在 plan 中给定
 *
 * 用法：
 *   node scripts/seed-career-applications.js            # dry-run
 *   node scripts/seed-career-applications.js --apply    # 写库
 *   FORCE=1 node scripts/seed-career-applications.js --apply  # 覆盖同 legacy_id 的记录
 *
 * 幂等：以 legacy_id（老系统 ID）为唯一键。
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';

const PLAN_PATH = path.join(__dirname, 'data', 'career-applications-plan.json');
const RESUME_DIR = process.env.RESUME_DIR
  ? (path.isAbsolute(process.env.RESUME_DIR) ? process.env.RESUME_DIR : path.resolve(__dirname, '..', process.env.RESUME_DIR))
  : path.resolve(__dirname, '../storage/resumes');

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
  const rows = plan.applications || [];
  console.log(`计划记录：${rows.length}（含简历 ${plan.withResume} 条，生成于 ${plan.generatedAt}）`);
  console.log('简历目录：' + RESUME_DIR);

  const existing = await prisma.careerApplication.findMany({ where: { legacyId: { not: null } }, select: { legacyId: true, id: true } });
  const existMap = new Map(existing.map((r) => [r.legacyId, r.id]));

  let create = 0, update = 0, skip = 0, missFile = 0;
  const failures = [];

  for (const r of rows) {
    const hit = existMap.get(r.legacyId);
    if (hit && !FORCE) { skip++; continue; }

    // 简历文件缺失时不写路径，避免后台下载 404
    let resumePath = r.resumePath;
    let resumeName = r.resumeName;
    if (resumePath) {
      const abs = path.join(RESUME_DIR, path.basename(resumePath));
      if (!fs.existsSync(abs)) { missFile++; resumePath = null; resumeName = null; }
    }

    const data = {
      fullName: txt(r.fullName) || '未填写姓名',
      email: r.email || '', // 老系统这 2 条没有邮箱；列是 NOT NULL，空串表示未填写
      phone: txt(r.phone),
      country: txt(r.country),
      position: txt(r.position),
      jobFunction: txt(r.jobFunction),
      message: txt(r.message),
      resumePath,
      resumeName,
      status: r.status || 'new',
      legacyId: r.legacyId,
      createdAt: r.createdAt ? new Date(r.createdAt) : undefined,
      updatedAt: r.updatedAt ? new Date(r.updatedAt) : undefined,
    };

    if (!APPLY) { hit ? update++ : create++; continue; }

    try {
      if (hit) {
        await prisma.careerApplication.update({ where: { id: hit }, data });
        update++;
      } else {
        const row = await prisma.careerApplication.create({ data });
        existMap.set(r.legacyId, row.id);
        create++;
      }
    } catch (e) {
      failures.push(`#${r.legacyId} ${r.fullName || ''}: ${e.message}`);
    }
  }

  const total = await prisma.careerApplication.count();
  console.log('---');
  console.log(`${APPLY ? '已写入' : '将写入'}：新建 ${create}，更新 ${update}，跳过 ${skip}`);
  if (missFile) console.log(`⚠️ 简历文件缺失 ${missFile} 条（未写 resumePath）`);
  console.log(`库内现有求职申请：${total} 条`);
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
