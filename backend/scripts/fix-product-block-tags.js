/**
 * 修复脚本：为所有 article_blocks (product_cards) 中的产品补充完整数据
 * 包括：functionalityTag（功能标签）等搜索API返回的全部字段
 * 
 * 用法：cd backend && node scripts/fix-product-block-tags.js
 */

const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

const API_BASE = 'http://localhost:3000/api';

async function api(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message || 'API error');
  return json.data;
}

async function main() {
  console.log('🔍 查找所有 product_cards 区块...');
  
  const blocks = await prisma.articleBlock.findMany({
    where: { blockType: 'product_cards' },
  });
  
  console.log(`找到 ${blocks.length} 个产品区块`);
  
  let updatedCount = 0;
  
  for (const block of blocks) {
    const content = JSON.parse(block.content);
    if (!content.products || !content.products.length) continue;
    
    console.log(`\n📦 区块 #${block.id} (文章 ${block.articleId}): ${content.products.length} 个产品`);
    
    // 获取每个产品的最新完整数据
    for (let i = 0; i < content.products.length; i++) {
      const p = content.products[i];
      try {
        // 通过 ID 从 API 获取完整产品信息
        const result = await api(`/pc-ingredients/${p.id}`);
        // 单个产品API返回直接对象，列表API返回 { list: [...] }
        const fullProduct = Array.isArray(result) ? (result[0] || null) : (result.list?.[0] || result);
        
        if (fullProduct) {
          // 补全字段
          content.products[i] = {
            id: fullProduct.id,
            name: fullProduct.name,
            inciName: fullProduct.inciName || '',
            imageUrl: fullProduct.imageUrl || '',
            description: fullProduct.description || '',
            functionalityTag: fullProduct.functionalityTag || [],
          };
          console.log(`   ✅ ${fullProduct.name}: 标签=${JSON.stringify(fullProduct.functionalityTag || [])}`);
        } else {
          console.log(`   ⚠️ 产品 #${p.id} (${p.name}) 未在API中找到`);
        }
      } catch (e) {
        console.log(`   ❌ 产品 #${p.id} (${p.name}) 获取失败: ${e.message?.substring(0, 60)}`);
      }
    }
    
    // 更新数据库
    await prisma.articleBlock.update({
      where: { id: block.id },
      data: { content: JSON.stringify(content) },
    });
    
    updatedCount++;
    console.log(`   💾 区块 #${block.id} 已更新`);
  }
  
  console.log(`\n✅ 完成！更新了 ${updatedCount} 个区块`);
}

main()
  .catch(e => { console.error('❌ 错误:', e); process.exit(1); })
  .then(() => prisma.$disconnect());
