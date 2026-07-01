/**
 * 从 gattefossechina.cn 导入配方产品
 * API 字段映射到本地数据库的 Formulation 模型
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_BASE = 'https://www.gattefossechina.cn/api';

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/**
 * 从 claims HTML 中提取纯文本标签（逗号分隔）
 */
function extractClaims(claimsHtml: string | undefined): string {
  if (!claimsHtml) return '';
  return claimsHtml
    .replace(/<[^>]+>/g, '')       // 去掉 HTML 标签
    .replace(/\s+/g, ',')          // 空白转逗号
    .replace(/,+/g, ',')           // 去重逗号
    .replace(/^,|,$/g, '')         // 去掉首尾逗号
    .slice(0, 500);
}

async function main() {
  console.log('🚀 开始重新导入配方（先清空旧数据）...\n');

  // 0. 清空所有旧配方数据
  console.log('🗑️  清空旧配方数据...');
  await prisma.docFormulation.deleteMany();
  await prisma.formulation.deleteMany();
  console.log('  ✅ 已清空\n');

  // 1. 获取配方列表（goodsCategoryId=120）
  console.log('📦 获取配方列表...');
  const listRes = await fetchJson(`${API_BASE}/mallGoodsInfo/getMallGoodsInfoList?pageSize=250&pageNum=1`);
  const allProducts = listRes?.data?.list || [];
  const formulations = allProducts.filter((p: any) => p.goodsCategoryId === 120 && p.goodsName);
  console.log(`共获取 ${allProducts.length} 条, 其中配方 ${formulations.length} 条\n`);

  let imported = 0;

  for (const item of formulations) {
    const name = item.goodsName;

    // 构建数据库记录
    const data: any = {
      name: name,
      code: item.subtitle || '',
      description: item.goodsIntro || '',
      imageUrl: item.goodsCoverImg
        ? `https://www.gattefossechina.cn/${item.goodsCoverImg}`
        : '',
      pdfPath: item.pdfUrl || '',
      applicationTag: '',
      formTag: '',
      claimTag: extractClaims(item.claims),
      naturalityIndex: '',
      compositionText: '',
      preparationSteps: '',
      sortOrder: item.sort != null ? item.sort : 0,
      isPublished: true,
    };

    try {
      await prisma.formulation.create({ data });
      console.log(`  ✅ 导入: ${name}`);
      imported++;
    } catch (e) {
      console.error(`  ❌ 导入失败: ${name}:`, (e as Error).message);
    }
  }

  const total = await prisma.formulation.count();
  console.log(`\n📊 导入完成: 成功 ${imported}, 总计 ${formulations.length}`);
  console.log(`  本地配方总数: ${total}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('💥 导入失败:', e);
  prisma.$disconnect();
  process.exit(1);
});
