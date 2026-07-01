/**
 * 从 gattefossechina.cn 导入 PC 产品
 * API 字段映射到本地数据库的 PcIngredient 模型
 * 标签按分类分配到对应字段：functionalityTag / applicationTag / conceptTag / claimTag / characteristicTag / naturalityLabel
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const API_BASE = 'https://www.gattefossechina.cn/api';
const PAGE_SIZE = 250;

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

/** 解析标签字符串为分类后的对象 */
function parseCategorizedTags(
  tagStr: string,
  tagDict: Record<string, string>,
  labelToCategory: Record<string, string>,
): Record<string, string[]> {
  const categorized: Record<string, string[]> = {
    functionality: [],
    application: [],
    concept: [],
    claim: [],
    characteristic: [],
    naturality: [],
  };

  if (!tagStr || tagStr === '""' || tagStr === '""""' || tagStr === '""\\""\\""""') return categorized;

  try {
    const pairs: number[][] = JSON.parse(tagStr.replace(/\\/g, ''));
    for (const p of pairs) {
      const label = tagDict[p[1]] || `tag_${p[1]}`;
      const catKey = labelToCategory[label];
      if (catKey && categorized[catKey]) {
        categorized[catKey].push(label);
      } else {
        // 未分类的标签默认归到功能
        categorized.functionality.push(label);
      }
    }
  } catch {
    // 解析失败，返回空
  }

  return categorized;
}

async function main() {
  console.log('🚀 开始导入 PC 产品...\n');

  // 1. 获取标签字典和分类映射
  const tagDict: Record<string, string> = {};       // tagId → 中文标签名
  const labelToCategory: Record<string, string> = {}; // 中文标签名 → category key
  try {
    const tagRes = await fetchJson(`${API_BASE}/mallGoodsTag/getMallGoodsTagList`);
    const tags = tagRes?.data?.list || tagRes?.data || [];
    for (const t of tags) {
      // 记录顶级标签本身
      const tName = t.name || t.tagName || '';
      if (tName) tagDict[t.ID] = tName;

      // 记录子标签并建立分类映射
      const catInfo = PC_CATEGORIES[t.ID];
      if (catInfo && t.children && Array.isArray(t.children)) {
        for (const child of t.children) {
          const childName = child.tagName || child.name || '';
          if (childName) {
            tagDict[child.ID] = childName;
            labelToCategory[childName] = catInfo.key;
          }
        }
      }
    }
    console.log(`✅ 加载标签字典: ${Object.keys(tagDict).length} 条, 分类映射: ${Object.keys(labelToCategory).length} 条`);
  } catch (e) {
    console.warn('⚠️  加载标签字典失败，标签将为空:', (e as Error).message);
  }

  // 2. 获取产品列表
  console.log('\n📦 获取产品列表...');
  const listRes = await fetchJson(`${API_BASE}/mallGoodsInfo/getMallGoodsInfoList?pageSize=${PAGE_SIZE}&pageNum=1`);
  const allProducts = listRes?.data?.list || [];
  // 过滤出 PC 产品 (goodsCategoryId === 121) 且有商品名称的
  const pcProducts = allProducts.filter((p: any) => p.goodsCategoryId === 121 && p.goodsName);
  console.log(`共获取 ${allProducts.length} 条, 其中 PC 产品 ${pcProducts.length} 条`);

  let imported = 0;
  let skipped = 0;

  for (const item of pcProducts) {
    const name = item.goodsName;
    // 检查是否已存在
    const existing = await prisma.pcIngredient.findFirst({ where: { name } });
    if (existing) {
      console.log(`  ⏭️  跳过: ${name} (已存在)`);
      skipped++;
      continue;
    }

    // 3. 获取详情内容
    let detailHtml = '';
    let compositionHtml = '';
    let sensoryHtml = '';
    let clinicalHtml = '';
    if (item.contentId) {
      try {
        const detailRes = await fetchJson(`${API_BASE}/webContents/findWebContents?contentId=${item.contentId}`);
        const contents = detailRes?.data?.list || detailRes?.data || [];
        if (Array.isArray(contents)) {
          // 详情内容的组织方式可能多样，尝试拼接到一个HTML中
          const parts: string[] = [];
          for (const c of contents) {
            if (c.content) parts.push(c.content);
          }
          detailHtml = parts.join('\n');
          // 粗略按关键词分类（实际可根据 contentId 体系细化）
          compositionHtml = detailHtml;
        }
      } catch (e) {
        console.warn(`    ⚠️  获取详情失败: ${name}:`, (e as Error).message);
      }
    }

    // 4. 处理标签（按分类分配到对应字段）
    const categorized = parseCategorizedTags(item.tag, tagDict, labelToCategory);

    // 5. 构建数据库记录
    const data: any = {
      name: item.goodsName || '',
      inciName: item.cardCode || '',
      description: item.goodsIntro || '',
      dosage: '',
      imageUrl: item.goodsCoverImg
        ? `https://www.gattefossechina.cn/${item.goodsCoverImg}`
        : '',
      detailImageUrl: item.goodsCarousel
        ? `https://www.gattefossechina.cn/${item.goodsCarousel}`
        : '',
      videoUrl: item.movieUrl
        ? (item.movieUrl.startsWith('http') ? item.movieUrl : `https:${item.movieUrl}`)
        : '',
      tagline: item.subtitle || '',
      intlUrl: item.enUrl || '',
      functionalityTag: categorized.functionality.join(','),
      applicationTag: categorized.application.join(','),
      conceptTag: categorized.concept.join(','),
      claimTag: categorized.claim.join(','),
      characteristicTag: categorized.characteristic.join(','),
      naturalityLabel: categorized.naturality.join(','),
      compositionHtml: compositionHtml || '',
      sensoryHtml: sensoryHtml || '',
      clinicalHtml: clinicalHtml || '',
      sortOrder: item.sort != null ? item.sort : 0,
      isPublished: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await prisma.pcIngredient.create({ data });
      console.log(`  ✅ 导入: ${name}`);
      imported++;
    } catch (e) {
      console.error(`  ❌ 导入失败: ${name}:`, (e as Error).message);
    }
  }

  console.log(`\n📊 导入完成: 成功 ${imported}, 跳过 ${skipped}, 总计 ${pcProducts.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('导入失败:', e);
  prisma.$disconnect();
  process.exit(1);
});
