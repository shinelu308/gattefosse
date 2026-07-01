/**
 * 同步 PC 标签字典（TagDictionary）与 gattefossechina.cn 中文站 API
 *
 * 问题背景：
 * - TagDictionary 标签的 label/value 是手动创建的英文 slug（如 "actives"、"body_care"）
 * - 产品中的标签是从中文站 API 导入的中文名（如 "活性物"、"身体护理"）
 * - 两者不一致导致：标签筛选不生效、产品编辑页勾选状态不匹配
 *
 * 解决方案：
 * - 从中文站 API 获取完整的标签树
 * - 将 TagDictionary 中 PC 产品的标签更新为 API 中的中文名（label=value=中文名）
 * - 删除不在 API 中的旧标签
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_BASE = 'https://www.gattefossechina.cn/api';

/**
 * PC 产品的顶级分类映射
 * key = API 中的顶级分类 ID
 * value = TagDictionary 中的 category 值
 */
const CATEGORY_MAP: Record<number, string> = {
  175: 'functionality',   // 功能（PC）
  125: 'application',     // 应用领域
  124: 'concept',         // 概念
  123: 'claim',           // 声明
  209: 'characteristic',  // 特征
  122: 'naturality',      // 自然性和标签
};

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function main() {
  console.log('🚀 开始同步 PC 标签字典...\n');

  // 1. 从中文站 API 获取标签树
  console.log('📦 获取中文站标签树...');
  const tagRes = await fetchJson(`${API_BASE}/mallGoodsTag/getMallGoodsTagList?pageSize=100&pageNum=1`);
  const tags = tagRes?.data?.list || tagRes?.data || [];
  if (!Array.isArray(tags) || tags.length === 0) {
    console.error('❌ 获取标签树失败，数据为空');
    await prisma.$disconnect();
    return;
  }

  // 2. 构建 API 标签集 { category → [label, ...] }
  const apiTags: Record<string, { label: string; id: number }[]> = {};
  let apiTagCount = 0;
  for (const t of tags) {
    const catKey = CATEGORY_MAP[t.ID];
    if (!catKey) continue; // 跳过非 PC 分类
    const children = t.children;
    if (!Array.isArray(children)) continue;

    if (!apiTags[catKey]) apiTags[catKey] = [];
    for (const child of children) {
      const name = child.tagName || child.name || '';
      if (name) {
        apiTags[catKey].push({ label: name, id: child.ID });
        apiTagCount++;
      }
    }
  }
  console.log(`  ✅ API 标签: ${apiTagCount} 个（来自 ${Object.keys(apiTags).length} 个分类）\n`);

  // 3. 获取当前 TagDictionary 中的 PC 标签
  const currentTags = await prisma.tagDictionary.findMany({
    where: { productLine: 'pc' },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
  });
  console.log(`📋 当前标签字典: ${currentTags.length} 条\n`);

  // 4. 构建冲突报告
  const conflicts: { id: number; category: string; oldLabel: string; newLabel: string; oldValue: string; newValue: string }[] = [];
  const toAdd: { category: string; label: string; sourceId: number }[] = [];
  const toDelete: number[] = [];
  const matchedIds = new Set<number>();

  // 按分类分组当前标签
  const currentByCat: Record<string, typeof currentTags> = {};
  for (const ct of currentTags) {
    if (!currentByCat[ct.category]) currentByCat[ct.category] = [];
    currentByCat[ct.category].push(ct);
  }

  // 对每个 API 分类的标签，查找是否已存在
  for (const [catKey, apiTagList] of Object.entries(apiTags)) {
    const existingInCat = currentByCat[catKey] || [];

    for (const apiTag of apiTagList) {
      // 尝试按 label 精确匹配
      const exactMatch = existingInCat.find(e => e.label === apiTag.label);
      if (exactMatch) {
        matchedIds.add(exactMatch.id);
        // 如果 label 已匹配但 value 不同，记录冲突
        if (exactMatch.value !== apiTag.label) {
          conflicts.push({
            id: exactMatch.id,
            category: catKey,
            oldLabel: exactMatch.label,
            newLabel: apiTag.label,
            oldValue: exactMatch.value,
            newValue: apiTag.label,
          });
        }
        continue;
      }

      // 尝试模糊匹配（部分标签名可能略有不同）
      const similarMatch = existingInCat.find(e =>
        e.label.replace(/\s+/g, '') === apiTag.label.replace(/\s+/g, '') ||
        e.value.replace(/[-_]/g, '').toLowerCase() === apiTag.label.replace(/[\s()]/g, '').toLowerCase()
      );
      if (similarMatch) {
        matchedIds.add(similarMatch.id);
        conflicts.push({
          id: similarMatch.id,
          category: catKey,
          oldLabel: similarMatch.label,
          newLabel: apiTag.label,
          oldValue: similarMatch.value,
          newValue: apiTag.label,
        });
        continue;
      }

      // 未匹配 → 需要新增
      toAdd.push({ category: catKey, label: apiTag.label, sourceId: apiTag.id });
    }
  }

  // 找出需要删除的旧标签（在 TagDictionary 但不在 API 中）
  for (const ct of currentTags) {
    if (!matchedIds.has(ct.id)) {
      toDelete.push(ct.id);
    }
  }

  // 5. 输出变更报告
  console.log('📊 变更报告:\n');

  if (conflicts.length > 0) {
    console.log(`🔄 需要更新的标签: ${conflicts.length} 条`);
    for (const c of conflicts) {
      console.log(`  [ID=${c.id}] ${c.oldLabel} → ${c.newLabel} (${c.oldValue} → ${c.newValue})`);
    }
    console.log('');
  }

  if (toAdd.length > 0) {
    console.log(`➕ 需要新增的标签: ${toAdd.length} 条`);
    for (const a of toAdd) {
      console.log(`  ${a.label} (分类: ${a.category})`);
    }
    console.log('');
  }

  if (toDelete.length > 0) {
    console.log(`➖ 需要删除的旧标签: ${toDelete.length} 条`);
    for (const id of toDelete) {
      const tag = currentTags.find(t => t.id === id);
      if (tag) console.log(`  [ID=${id}] ${tag.label} (${tag.category})`);
    }
    console.log('');
  }

  // 确认用户是否继续
  const totalChanges = conflicts.length + toAdd.length + toDelete.length;
  if (totalChanges === 0) {
    console.log('✅ 标签字典已是最新，无需变更');
    await prisma.$disconnect();
    return;
  }

  console.log(`⚙️  共 ${totalChanges} 项变更，开始执行...\n`);

  // 6. 执行更新
  let updated = 0;
  let added = 0;
  let deleted = 0;

  // 更新标签
  for (const c of conflicts) {
    await prisma.tagDictionary.update({
      where: { id: c.id },
      data: {
        label: c.newLabel,
        value: c.newValue,
      },
    });
    updated++;
  }
  console.log(`  ✅ 更新 ${updated} 条`);

  // 新增标签
  let sortOrder = await prisma.tagDictionary.aggregate({ _max: { sortOrder: true } });
  let nextSort = (sortOrder._max.sortOrder ?? 0) + 1;
  for (const a of toAdd) {
    await prisma.tagDictionary.create({
      data: {
        category: a.category,
        productLine: 'pc',
        label: a.label,
        value: a.label,
        sortOrder: nextSort++,
      },
    });
    added++;
  }
  console.log(`  ✅ 新增 ${added} 条`);

  // 删除旧标签
  for (const id of toDelete) {
    await prisma.tagDictionary.delete({ where: { id } });
    deleted++;
  }
  console.log(`  ✅ 删除 ${deleted} 条`);

  // 7. 最终统计
  const finalCount = await prisma.tagDictionary.count({ where: { productLine: 'pc' } });
  console.log(`\n📊 同步完成: 更新 ${updated}, 新增 ${added}, 删除 ${deleted}`);
  console.log(`   TagDictionary PC 标签总数: ${finalCount}`);
  console.log(`   API 标签总数: ${apiTagCount}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('💥 同步失败:', e);
  prisma.$disconnect();
  process.exit(1);
});
