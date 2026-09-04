/**
 * 刷新 _db_dump.json 备份。
 *
 * 用途：每次新增 schema 列或大批量入库后跑一次，把当前 sqlite DB 状态
 * 序列化到项目根的 _db_dump.json（已被 git 跟踪）。
 *
 * 运行: cd backend && npx tsx scripts/dump-db.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

const OUT = join(__dirname, '..', '..', '_db_dump.json');

/** 收集每个模型的全部行（按 id 升序） */
async function collect() {
  const data: Record<string, unknown[]> = {};

  data.author = await prisma.author.findMany({ orderBy: { id: 'asc' } });
  data.newsEvent = await prisma.newsEvent.findMany({ orderBy: { id: 'asc' } });
  data.pcIngredient = await prisma.pcIngredient.findMany({ orderBy: { id: 'asc' } });
  data.formulation = await prisma.formulation.findMany({ orderBy: { id: 'asc' } });
  data.pharmaProduct = await prisma.pharmaProduct.findMany({ orderBy: { id: 'asc' } });
  data.document = await prisma.document.findMany({ orderBy: { id: 'asc' } });
  data.user = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  data.tagDictionary = await prisma.tagDictionary.findMany({ orderBy: { id: 'asc' } });
  data.page_contents = await prisma.pageContent.findMany({ orderBy: { id: 'asc' } });

  return data;
}

async function main() {
  const data = await collect();
  let total = 0;
  for (const [k, v] of Object.entries(data)) total += v.length;
  writeFileSync(OUT, JSON.stringify(data, replacer, 2) + '\n', 'utf-8');
  console.log(`✅ 已写入 ${OUT}（${Object.keys(data).length} 张表，共 ${total} 行）`);
}

/** BigInt（Prisma DateTime 底层 ms 时间戳）→ number */
function replacer(_k: string, v: unknown) {
  return typeof v === 'bigint' ? Number(v) : v;
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(async () => prisma.$disconnect());