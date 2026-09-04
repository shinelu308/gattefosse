/**
 * 找到我们（Find Us）子公司数据导入脚本
 * 数据源：原中文站 api/webAffiliates/getWebAffiliatesList?catId=37（13 条全球分公司/经销商）
 *         + api/sysDictionary?type=country（countryId → 国家名映射）
 * 存储：subsidiaries 表（Subsidiary 模型，extra 列存卡片扩展字段 JSON）
 *
 * 字段映射：
 *   name=title | country=国家名(由 countryId 映射) | address | phone
 *   description=summary(富文本，affiliates-detail 详情页用) | imageUrl=thumb
 *   website=url(公司官网) | sortOrder=sort
 *   extra(JSON)={type, expertise, mapUrl, mobile, enUrl, goodsCategoryId}
 *   （type: 0=总部 1=分公司 2=经销商；expertise 含「个人护理/药用辅料/应用实验室」）
 *
 * 幂等策略：deleteMany 全量 + createMany 重建（13 条小表，同时清掉历史脏数据）
 * 运行: cd backend && npx tsx scripts/import-find-us-subsidiaries.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

interface Aff {
  ID: number;
  title: string;
  summary: string;
  url: string;
  enUrl: string;
  thumb: string;
  sort: number;
  expertise: string;
  countryId: number;
  address: string;
  phone: string;
  mobile: string;
  mapUrl: string;
  type: number;
}

async function main() {
  const affRaw: { list: Aff[] } = JSON.parse(
    readFileSync(join(__dirname, '../../.localize_tmp/affiliates_full.json'), 'utf-8')
  ).data;
  const dictRaw = JSON.parse(
    readFileSync(join(__dirname, '../../.localize_tmp/country_dict.json'), 'utf-8')
  );
  const details: Array<{ value: string; label: string }> =
    dictRaw.data.resysDictionary.sysDictionaryDetails;
  const countryMap = new Map(details.map((d) => [String(d.value), d.label]));

  const rows = affRaw.list.map((a) => ({
    name: a.title?.trim() || `#${a.ID}`,
    country: countryMap.get(String(a.countryId)) || null,
    city: null,
    address: a.address || null,
    phone: a.phone || null,
    email: null,
    website: a.url || a.enUrl || null,
    imageUrl: a.thumb || null,
    description: a.summary || null,
    extra: JSON.stringify({
      originId: a.ID,
      type: a.type,
      expertise: a.expertise || '',
      mapUrl: a.mapUrl || '',
      mobile: a.mobile || '',
      enUrl: a.enUrl || '',
      goodsCategoryId: a.goodsCategoryId ?? 0,
    }),
    sortOrder: a.sort ?? 0,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.subsidiary.deleteMany({});
    await tx.subsidiary.createMany({ data: rows });
  });

  console.log(`✅ subsidiaries 已重建 ${rows.length} 条（含总部/分公司/经销商）`);
  for (const r of rows) {
    console.log(`  - [${r.sortOrder}] ${r.name} | ${r.country}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
