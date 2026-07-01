/**
 * 修复 PC 产品的标签分类
 * 将当前全部写入 functionality_tag 的标签，按 API 中的父级分类
 * 分配到正确的字段：functionalityTag / applicationTag / conceptTag / claimTag / characteristicTag / naturalityLabel
 *
 * 使用步骤：
 *   cd backend
 *   npx tsx scripts/fix-pc-tags.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_BASE = 'https://www.gattefossechina.cn/api';

/**
 * PC 产品相关的顶级分类映射
 * 注意：功能(ID=292)和剂型(ID=293)是药用辅料的，不用于PC
 */
const PC_CATEGORIES: Record<number, { key: string; field: string; name: string }> = {
  175: { key: 'functionality', field: 'functionalityTag', name: '功能' },
  125: { key: 'application', field: 'applicationTag', name: '应用领域' },
  124: { key: 'concept', field: 'conceptTag', name: '概念' },
  123: { key: 'claim', field: 'claimTag', name: '声明' },
  209: { key: 'characteristic', field: 'characteristicTag', name: '特征' },
  122: { key: 'naturality', field: 'naturalityLabel', name: '自然性和标签' },
};

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function main() {
  console.log('🚀 开始修复 PC 产品标签分类...\n');

  // 1. 从 API 获取完整标签树，构建 标签名 → 分类 的映射
  console.log('📦 获取标签树...');
  const labelToCategory: Record<string, string> = {}; // 中文标签名 → category key
  const labelToId: Record<string, number> = {};       // 中文标签名 → 标签 ID

  try {
    const tagRes = await fetchJson(`${API_BASE}/mallGoodsTag/getMallGoodsTagList?pageSize=100&pageNum=1`);
    const tags = tagRes?.data?.list || tagRes?.data || [];

    for (const t of tags) {
      const parentId = t.ID;
      const catInfo = PC_CATEGORIES[parentId];
      if (!catInfo) continue; // 跳过非 PC 分类（如 剂型、药用功能）

      const children = t.children;
      if (!children || !Array.isArray(children)) continue;

      for (const child of children) {
        const childName = child.tagName || child.name || '';
        if (childName) {
          labelToCategory[childName] = catInfo.key;
          labelToId[childName] = child.ID;
        }
      }
    }

    console.log(`  ✅ 加载 ${Object.keys(labelToCategory).length} 个 PC 标签分类映射\n`);
  } catch (e) {
    console.error('❌ 获取标签树失败:', e);
    await prisma.$disconnect();
    return;
  }

  // 2. 获取所有 PC 产品
  const products = await prisma.pcIngredient.findMany({ orderBy: { id: 'asc' } });
  console.log(`📦 共 ${products.length} 条 PC 产品\n`);

  let fixed = 0;
  let skipped = 0;

  for (const product of products) {
    const rawTag = (product.functionalityTag || '').trim();

    if (!rawTag) {
      console.log(`  ⏭️  跳过: ${product.name} (无标签)`);
      skipped++;
      continue;
    }

    // 解析逗号分隔的中文标签
    const labels = rawTag.split(',').map(s => s.trim()).filter(Boolean);

    // 按分类分组
    const categorized: Record<string, string[]> = {
      functionality: [],
      application: [],
      concept: [],
      claim: [],
      characteristic: [],
      naturality: [],
    };
    const uncategorized: string[] = [];

    for (const label of labels) {
      const catKey = labelToCategory[label];
      if (catKey && categorized[catKey]) {
        categorized[catKey].push(label);
      } else {
        uncategorized.push(label);
      }
    }

    // 构建更新数据
    const updateData: any = {};

    for (const [catKey, catLabels] of Object.entries(categorized)) {
      const field = PC_CATEGORIES[Object.entries(PC_CATEGORIES).find(([, v]) => v.key === catKey)?.[0] as any]?.field;
      if (field && catLabels.length > 0) {
        updateData[field] = catLabels.join(',');
      }
    }

    // 更新 functionalityTag 为未分类的标签（通常是功能标签）
    // 但如果所有标签都被分到其他类别了，就清空
    if (uncategorized.length > 0) {
      updateData.functionalityTag = uncategorized.join(',');
    } else {
      // 检查有没有任何标签被分到功能类别
      if (categorized.functionality.length > 0) {
        updateData.functionalityTag = categorized.functionality.join(',');
      } else {
        updateData.functionalityTag = '';
      }
    }

    // 检查是否有变化
    const hasChanges = Object.keys(updateData).some(
      field => (product as any)[field] !== updateData[field]
    );

    if (!hasChanges) {
      console.log(`  ⏭️  跳过: ${product.name} (无需变更)`);
      skipped++;
      continue;
    }

    // 更新数据库
    try {
      await prisma.pcIngredient.update({
        where: { id: product.id },
        data: updateData,
      });
      console.log(`  ✅ ${product.name}`);
      console.log(`     functionality: ${updateData.functionalityTag || '(空)'}`);
      console.log(`     application:   ${updateData.applicationTag || '(空)'}`);
      if (updateData.conceptTag)      console.log(`     concept:       ${updateData.conceptTag}`);
      if (updateData.claimTag)         console.log(`     claim:         ${updateData.claimTag}`);
      if (updateData.characteristicTag) console.log(`     characteristic:${updateData.characteristicTag}`);
      if (updateData.naturalityLabel)  console.log(`     naturality:    ${updateData.naturalityLabel}`);
      console.log('');
      fixed++;
    } catch (e) {
      console.error(`  ❌ 更新失败: ${product.name}:`, e);
    }
  }

  console.log(`\n📊 修复完成: 成功 ${fixed}, 跳过 ${skipped}, 总计 ${products.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('💥 修复失败:', e);
  prisma.$disconnect();
  process.exit(1);
});
