/**
 * 修复配方(formulation)标签数据 — 对齐原中文站 gattefossechina.cn
 *
 * 问题：
 *   1. tag_dictionary 中 formulation 的 application/form 分类标签与原中文站不一致
 *   2. formulations 表中的 application_tag/form_tag 值混用英文slug和中文名
 *
 * 用法：npx tsx scripts/fix-formulation-tags.ts
 *
 * 参照原中文站截图，正确的标签为：
 *   应用领域: 婴儿/儿童护理 | 身体护理 | 眼部护理 | 脸部护理 | 脸部和头皮护理 | 彩妆 | 防晒
 *   性状:     香脂 | 润肤膏 | 乳霜 | 乳剂/啫哩 | 凝胶
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ========== 正确的标签定义（参照原中文站） ==========

const CORRECT_APPLICATION_TAGS = [
  { label: '婴儿/儿童护理', value: '婴儿/儿童护理', order: 0 },
  { label: '身体护理',       value: '身体护理',       order: 1 },
  { label: '眼部护理',       value: '眼部护理',       order: 2 },
  { label: '脸部护理',       value: '脸部护理',       order: 3 },
  { label: '脸部和头皮护理', value: '脸部和头皮护理', order: 4 },
  { label: '彩妆',           value: '彩妆',           order: 5 },
  { label: '防晒',           value: '防晒',           order: 6 },
];

const CORRECT_FORM_TAGS = [
  { label: '香脂',     value: '香脂',     order: 0 },
  { label: '润肤膏',   value: '润肤膏',   order: 1 },
  { label: '乳霜',     value: '乳霜',     order: 2 },
  { label: '乳剂/啫哩', value: '乳剂/啫哩', order: 3 },
  { label: '凝胶',     value: '凝胶',     order: 4 },
];

// ========== 旧值 → 新值映射 ==========

/** application_tag 值映射 */
const APP_VALUE_MAP: Record<string, string> = {
  'body_care':  '身体护理',
  'face_care':  '脸部护理',
  '脸部护理':   '脸部护理',       // 已是中文，保持
  'eye_care':   '眼部护理',
  'hair_care':  '脸部和头皮护理', // 头发→脸部和头皮（原站无独立头发分类）
  'lip_care':   '脸部护理',       // 唇部→脸部区域
  'make_up':    '彩妆',
  'sun_care':   '防晒',
};

/** form_tag 值映射（13项旧值 → 5项新值） */
const FORM_VALUE_MAP: Record<string, string> = {
  'balm':      '香脂',
  'butter':    '乳霜',
  'cream':     '乳霜',
  'emulsion':  '乳剂/啫哩',
  'gel':       '凝胶',
  'milk':      '润肤膏',
  'oil':       '乳剂/啫哩',
  'paste':     '乳霜',
  'powder':    '香脂',        // 粉末类压制产品
  'serum':     '乳剂/啫哩',
  'spray':     '乳剂/啫哩',
  'stick':     '香脂',        // 棒状产品
  '乳霜':      '乳霜',         // 已是中文，保持
};

function mapTagValue(value: string, map: Record<string, string>): string {
  return map[value] || value; // 未知的保留原值
}

async function main() {
  console.log('🔧 开始修复配方标签数据...\n');

  // ---- Step 1: 更新 tag_dictionary ----
  console.log('📋 Step 1: 更新标签字典 (tag_dictionary)');

  // 删除旧的 application 标签
  const deletedApp = await prisma.tagDictionary.deleteMany({
    where: { productLine: 'formulation', category: 'application' },
  });
  console.log(`   删除旧 application 标签: ${deletedApp.count} 条`);

  // 删除旧的 form 标签
  const deletedForm = await prisma.tagDictionary.deleteMany({
    where: { productLine: 'formulation', category: 'form' },
  });
  console.log(`   删除旧 form 标签: ${deletedForm.count} 条`);

  // 插入正确的 application 标签
  for (const tag of CORRECT_APPLICATION_TAGS) {
    await prisma.tagDictionary.create({
      data: {
        category: 'application',
        productLine: 'formulation',
        label: tag.label,
        value: tag.value,
        sortOrder: tag.order,
      },
    });
  }
  console.log(`   插入新 application 标签: ${CORRECT_APPLICATION_TAGS.length} 条`);

  // 插入正确的 form 标签
  for (const tag of CORRECT_FORM_TAGS) {
    await prisma.tagDictionary.create({
      data: {
        category: 'form',
        productLine: 'formulation',
        label: tag.label,
        value: tag.value,
        sortOrder: tag.order,
      },
    });
  }
  console.log(`   插入新 form 标签: ${CORRECT_FORM_TAGS.length} 条`);

  // ---- Step 2: 更新 formulations 表中的标签值 ----
  console.log('\n📦 Step 2: 更新配方表 (formulations) 标签值');

  const formulations = await prisma.formulation.findMany({
    select: { id: true, name: true, applicationTag: true, formTag: true },
  });

  let updatedCount = 0;
  for (const f of formulations) {
    let newAppTag: string | null = null;
    let newFormTag: string | null = null;

    // 转换 application_tag
    if (f.applicationTag) {
      const parts = f.applicationTag.split(',').map((s: string) => s.trim()).filter(Boolean);
      const newParts = parts.map(p => mapTagValue(p, APP_VALUE_MAP));
      // 去重
      const unique = [...new Set(newParts)];
      newAppTag = unique.join(',');
    }

    // 转换 form_tag
    if (f.formTag) {
      const parts = f.formTag.split(',').map((s: string) => s.trim()).filter(Boolean);
      const newParts = parts.map(p => mapTagValue(p, FORM_VALUE_MAP));
      // 去重
      const unique = [...new Set(newParts)];
      newFormTag = unique.join(',');
    }

    // 仅在有变化时更新
    if (newAppTag !== f.applicationTag || newFormTag !== f.formTag) {
      await prisma.formulation.update({
        where: { id: f.id },
        data: {
          applicationTag: newAppTag,
          formTag: newFormTag,
        },
      });
      updatedCount++;
    }
  }
  console.log(`   更新了 ${updatedCount}/${formulations.length} 个配方的标签`);

  // ---- 验证结果 ----
  console.log('\n✅ 验证结果:');

  const appTags = await prisma.tagDictionary.findMany({
    where: { productLine: 'formulation', category: 'application' },
    orderBy: { sortOrder: 'asc' },
  });
  console.log(`\n   应用领域 (${appTags.length} 项):`);
  for (const t of appTags) {
    console.log(`     - ${t.label}`);
  }

  const formTags = await prisma.tagDictionary.findMany({
    where: { productLine: 'formulation', category: 'form' },
    orderBy: { sortOrder: 'asc' },
  });
  console.log(`\n   性状 (${formTags.length} 项):`);
  for (const t of formTags) {
    console.log(`     - ${t.label}`);
  }

  // 显示标签值分布
  const appDist = await prisma.$queryRaw<
    { application_tag: string; cnt: bigint }[]
  >`SELECT application_tag, COUNT(*) as cnt FROM formulations WHERE application_tag != '' GROUP BY application_tag ORDER BY cnt DESC`;
  console.log('\n   配方应用领域分布:');
  for (const r of appDist) {
    console.log(`     ${r.application_tag}: ${r.cnt} 个`);
  }

  const formDist = await prisma.$queryRaw<
    { form_tag: string; cnt: bigint }
  >`SELECT form_tag, COUNT(*) as cnt FROM formulations WHERE form_tag != '' GROUP BY form_tag ORDER BY cnt DESC`;
  console.log('\n   配方性状分布:');
  for (const r of formDist) {
    console.log(`     ${r.form_tag}: ${r.cnt} 个`);
  }

  console.log('\n🎉 修复完成!');
}

main()
  .catch((e) => {
    console.error('❌ 修复失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
