/**
 * 从 gattefossechina.cn 导入 PC 产品
 * API 字段映射到本地数据库的 PcIngredient 模型
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const API_BASE = 'https://www.gattefossechina.cn/api';
const PAGE_SIZE = 100;

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function main() {
  console.log('🚀 开始导入 PC 产品...\n');

  // 1. 获取标签字典（将标签ID映射为中文标签名）
  const tagDict: Record<string, { id: number; label: string }> = {};
  try {
    const tagRes = await fetchJson(`${API_BASE}/mallGoodsTag/getMallGoodsTagList`);
    const tags = tagRes?.data?.list || tagRes?.data || [];
    for (const t of tags) {
      tagDict[t.ID] = { id: t.ID, label: t.name || t.tagName || '' };
    }
    console.log(`✅ 加载标签字典: ${Object.keys(tagDict).length} 条`);
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

    // 4. 处理标签
    const parseTags = (tagStr: string): string => {
      if (!tagStr || tagStr === '""' || tagStr === '""""' || tagStr === '""\\""\\""""') return '';
      try {
        const pairs: number[][] = JSON.parse(tagStr.replace(/\\/g, ''));
        return pairs.map((p: number[]) => {
          const t = tagDict[p[1]];
          return t ? t.label : `tag_${p[1]}`;
        }).filter(Boolean).join(',');
      } catch {
        return '';
      }
    };

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
      functionalityTag: parseTags(item.tag),
      applicationTag: '',
      conceptTag: '',
      claimTag: item.claims
        ? item.claims.replace(/<[^>]+>/g, '').replace(/\s+/g, ',').slice(0, 500)
        : '',
      characteristicTag: '',
      naturalityLabel: '',
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
