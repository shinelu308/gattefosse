/**
 * 将 sync-formulation-data.py 抓取的数据导入到数据库
 * 更新 formulations 表的 naturality_index 和 concept_tag 字段
 *
 * 用法: cd backend && npx tsx scripts/sync-formulation-data.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// 天然指数标签 value → 数据库存储值映射
// 数据库存的是 tag_dictionary 中的 value
const NATURALITY_MAP: Record<string, string> = {
  gt_99: 'gt_99',
  gt_98: 'gt_98',
  gt_95: 'gt_95',
  gt_90: 'gt_90',
};

async function main() {
  console.log('🚀 开始导入配方同步数据...\n');

  // 读取 JSON 数据
  const dataPath = path.join(__dirname, '..', 'data', 'formulation_sync_data.json');
  if (!fs.existsSync(dataPath)) {
    console.error('❌ 未找到数据文件，请先运行 python3 scripts/sync-formulation-data.py');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const results: {
    code: string;
    name: string;
    is_natural: boolean;
    naturality_tag: string;
    concept_tags: string[];
  }[] = raw.results;

  console.log(`📋 共读取 ${results.length} 条配方数据\n`);

  // 获取所有配方的 code → id 映射
  const allFormulations = await prisma.formulation.findMany({
    select: { id: true, code: true, name: true, naturalityIndex: true, conceptTag: true },
  });

  const codeToFormulation = new Map<string, typeof allFormulations[0]>();
  for (const f of allFormulations) {
    if (f.code) {
      codeToFormulation.set(f.code, f);
    }
  }

  console.log(`📦 数据库中 ${allFormulations.length} 个配方\n`);

  let updatedNaturality = 0;
  let updatedConcept = 0;
  let notFound = 0;

  for (const item of results) {
    const local = codeToFormulation.get(item.code);
    if (!local) {
      console.log(`  ⚠ 未找到: ${item.name} (${item.code})`);
      notFound++;
      continue;
    }

    const updates: any = {};

    // 更新天然指数
    if (item.naturality_tag && local.naturalityIndex !== item.naturality_tag) {
      updates.naturalityIndex = item.naturality_tag;
    }

    // 更新成分标签
    if (item.concept_tags.length > 0) {
      const newConceptTag = item.concept_tags.join(',');
      if (local.conceptTag !== newConceptTag) {
        updates.conceptTag = newConceptTag;
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.formulation.update({
        where: { id: local.id },
        data: updates,
      });

      if (updates.naturalityIndex) {
        updatedNaturality++;
        console.log(`  ✅ [天然] ${item.name} (${item.code}) → ${updates.naturalityIndex}`);
      }
      if (updates.conceptTag) {
        updatedConcept++;
        console.log(`  ✅ [成分] ${item.name} (${item.code}) → ${updates.conceptTag}`);
      }
    }
  }

  // 汇总
  console.log(`\n📊 导入完成:`);
  console.log(`   更新天然指数: ${updatedNaturality} 个配方`);
  console.log(`   更新成分标签: ${updatedConcept} 个配方`);
  console.log(`   未找到匹配: ${notFound} 个`);

  // 验证结果
  console.log('\n🔍 验证更新后数据:');
  const verifyFormulations = await prisma.formulation.findMany({
    where: {
      OR: [
        { naturalityIndex: { not: '' } },
        { conceptTag: { not: '' } },
      ],
    },
    select: { name: true, code: true, naturalityIndex: true, conceptTag: true },
    orderBy: { name: 'asc' },
  });

  console.log(`   有天然指数: ${verifyFormulations.filter(f => f.naturalityIndex).length} 个`);
  console.log(`   有成分标签: ${verifyFormulations.filter(f => f.conceptTag).length} 个`);

  if (verifyFormulations.length > 0) {
    console.log('\n   数据列表:');
    for (const f of verifyFormulations) {
      const parts = [];
      if (f.naturalityIndex) parts.push(`天然:${f.naturalityIndex}`);
      if (f.conceptTag) parts.push(`成分:${f.conceptTag.split(',').slice(0, 3).join(',')}...`);
      console.log(`   ${f.code?.padEnd(12)} ${f.name.padEnd(20)} | ${parts.join(' | ')}`);
    }
  }

  console.log('\n🎉 导入完成!');
}

main()
  .catch((e) => {
    console.error('❌ 导入失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
