/**
 * 修复 PC 产品的标签为中文显示
 * 从 gattefossechina.cn API 获取完整标签映射，然后更新数据库
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const API_BASE = 'https://www.gattefossechina.cn/api';

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function main() {
  console.log('🚀 开始修复 PC 产品标签...\n');

  // 1. 获取完整标签字典（包括所有子标签）
  console.log('📦 获取标签字典...');
  const tagDict: Record<number, string> = {};
  try {
    const tagRes = await fetchJson(`${API_BASE}/mallGoodsTag/getMallGoodsTagList?pageSize=100&pageNum=1`);
    const tags = tagRes?.data?.list || tagRes?.data || [];
    for (const t of tags) {
      // 顶级标签
      tagDict[t.ID] = t.tagName || t.name || '';
      // 子标签
      if (t.children && Array.isArray(t.children)) {
        for (const child of t.children) {
          tagDict[child.ID] = child.tagName || child.name || '';
        }
      }
    }
    console.log(`✅ 加载标签字典: ${Object.keys(tagDict).length} 条\n`);
  } catch (e) {
    console.error('❌ 获取标签字典失败:', e);
    await prisma.$disconnect();
    return;
  }

  // 2. 获取所有 PC 产品
  const products = await prisma.pcIngredient.findMany();
  console.log(`📦 共 ${products.length} 条 PC 产品需要修复\n`);

  let fixed = 0;
  let skipped = 0;

  for (const product of products) {
    // 获取原始 tag 字符串（应该从 API 重新获取，因为数据库中可能已损坏）
    // 或者解析现有数据库中的 tag 字符串
    const rawTag = product.functionalityTag || '';
    
    // 如果已经是中文，跳过
    if (!rawTag.startsWith('tag_')) {
      console.log(`  ⏭️  跳过: ${product.name} (已是中文标签)`);
      skipped++;
      continue;
    }

    // 解析 tag 字符串: "tag_165,tag_177,tag_179,..."
    const tagIds = rawTag.split(',').map(s => s.trim()).filter(Boolean);
    const chineseLabels: string[] = [];
    
    for (const tagId of tagIds) {
      const id = parseInt(tagId.replace('tag_', ''));
      if (!isNaN(id) && tagDict[id]) {
        chineseLabels.push(tagDict[id]);
      } else {
        console.warn(`    ⚠️  未找到标签映射: ${tagId} (产品: ${product.name})`);
      }
    }

    // 更新数据库
    const newTagStr = chineseLabels.join(',');
    if (newTagStr) {
      await prisma.pcIngredient.update({
        where: { id: product.id },
        data: { functionalityTag: newTagStr },
      });
      console.log(`  ✅ 修复: ${product.name} → ${newTagStr.slice(0, 60)}${newTagStr.length > 60 ? '...' : ''}`);
      fixed++;
    } else {
      console.log(`  ⏭️  跳过: ${product.name} (无有效标签)`);
      skipped++;
    }
  }

  console.log(`\n📊 修复完成: 成功 ${fixed}, 跳过 ${skipped}, 总计 ${products.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('修复失败:', e);
  prisma.$disconnect();
  process.exit(1);
});
