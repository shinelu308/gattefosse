/**
 * 给药途径 3 子页面(oral/topical/rectal-and-vaginal)结构化导入
 * 与 pharmaceuticals.html 一致：content 存 hero JSON 区块（含头图），contentHtml 存正文 HTML
 * 后台在「站点内容」直接管理
 *
 * contentHtml 数据源优先级：
 *   1. scripts/data/<pageKey>.content.html  — 抓取自原站 node__content-wrapper 的完整 HTML（1:1 复刻）
 *   2. 无文件时回退为下方内联占位文案
 *
 * 运行: cd backend && npx tsx scripts/import-routes-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

/** 读取数据文件中的完整正文 HTML（若存在） */
function loadHtml(pageKey: string, fallback: string): string {
  const file = join(__dirname, 'data', `${pageKey}.content.html`);
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf-8').trim();
    if (raw.length > 100) {
      console.log(`  📄 ${pageKey}: 使用 data/${pageKey}.content.html (${raw.length} 字符)`);
      return raw;
    }
  }
  return fallback.trim();
}

interface RoutePage {
  pageKey: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  backgroundImage: string;
  contentHtml: string;
}

const ROUTE_PAGES: RoutePage[] = [
  {
    pageKey: 'oral-drug-delivery',
    title: '口服给药',
    metaTitle: '口服给药 | 嘉法狮',
    metaDescription:
      '嘉法狮为口服固体制剂提供创新的脂质辅料，包括自乳化、固体分散和缓控释等多种递送技术。',
    backgroundImage:
      '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/gattefosse_oral_lipid_excipients.jpg.jpg',
    contentHtml: loadHtml(
      'oral-drug-delivery',
      `
<p>口服给药是制药领域最常见的给药途径。嘉法狮凭借超过60年的脂质化学专长，为口服固体制剂提供全方位的辅料解决方案，包括自乳化给药系统（SNEDDS）、固体分散体、缓控释骨架等创新技术。</p>
<p>我们的口服脂质辅料可显著提高难溶性药物的生物利用度，改善药物稳定性，并为患者提供更灵活的给药方案。</p>
<h3>主要产品类别</h3>
<ul>
  <li><strong>自乳化辅料（SNEDDS）</strong>：Labrasol®、Labrafil®、Gelucire® 系列</li>
  <li><strong>增溶剂</strong>：Capryol® 90、Labrasol® ALF</li>
  <li><strong>固体分散体载体</strong>：Gelucire® 50/13、Gelucire® 48/16</li>
  <li><strong>缓释骨架材料</strong>：Compritol® 888 ATO、Precirol® ATO 5</li>
  <li><strong>包衣材料</strong>：Sepifilm™ 系列、Sepisperse™ 系列</li>
</ul>
<h3>技术优势</h3>
<ul>
  <li>提高难溶性药物（BCS II/IV 类）的溶出度和生物利用度</li>
  <li>增强配方稳定性，避免药物结晶</li>
  <li>灵活调控释药速度（速释/缓释/肠溶/结肠靶向）</li>
  <li>适用于热熔挤出、喷雾干燥、制粒等多种工艺</li>
  <li>完善的法规支持（DMF、CEP 等）</li>
</ul>`
    ),
  },
  {
    pageKey: 'topical-drug-delivery',
    title: '外用给药',
    metaTitle: '外用给药 | 嘉法狮',
    metaDescription:
      '嘉法狮为外用半固体制剂（乳膏、凝胶、透皮给药系统）提供创新的脂质辅料和处方支持。',
    backgroundImage:
      '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/topical-and-transdermal-application.jpg.jpg',
    contentHtml: loadHtml(
      'topical-drug-delivery',
      `
<p>外用给药是药物直接作用于皮肤或黏膜的给药途径，包括局部治疗和全身性透皮给药。嘉法狮为外用半固体制剂（乳膏、凝胶、软膏、透皮贴剂）提供全面的脂质辅料解决方案。</p>
<p>我们的外用辅料可改善活性成分的皮肤渗透性，增强配方稳定性，并提供愉悦的感官体验。</p>
<h3>主要产品类别</h3>
<ul>
  <li><strong>乳膏基质</strong>：Emulium® 系列（已停售）、Gelot™、Plurol®</li>
  <li><strong>增溶剂/促渗剂</strong>：Labrasol®、Transcutol® P、Capryol® 90</li>
  <li><strong>增稠剂</strong>：Compritol® 888 ATO、Precirol® ATO 5</li>
  <li><strong>透皮促渗剂</strong>：Labrafac® Lipophile WL 1349</li>
  <li><strong>润肤剂/封闭剂</strong>：Suppocire® 系列</li>
</ul>
<h3>技术优势</h3>
<ul>
  <li>改善活性成分的皮肤渗透性</li>
  <li>提供稳定的乳化体系（O/W、W/O）</li>
  <li>适合多种剂型（乳膏、凝胶、软膏、贴剂）</li>
  <li>无刺激性、皮肤相容性好</li>
  <li>支持定制化处方</li>
</ul>`
    ),
  },
  {
    pageKey: 'rectal-vaginal-drug-delivery',
    title: '直肠和阴道给药',
    metaTitle: '直肠和阴道给药 | 嘉法狮',
    metaDescription:
      '嘉法狮为直肠和阴道给药提供栓剂、凝胶等专用脂质辅料，覆盖多种治疗领域。',
    backgroundImage:
      '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/gattefosse_rectal_lipid_excipients.jpg.jpg',
    contentHtml: loadHtml(
      'rectal-vaginal-drug-delivery',
      `
<p>直肠和阴道给药是重要的局部和系统性给药途径，适用于口服不耐受、需局部作用或需绕过首过效应的药物。嘉法狮为这类剂型提供专业的脂质辅料和处方支持。</p>
<p>我们的栓剂基质和阴道用辅料可满足多种治疗需求，包括消炎、止痛、激素替代、抗菌等领域。</p>
<h3>主要产品类别</h3>
<ul>
  <li><strong>栓剂基质</strong>：Suppocire® 系列（多种熔点规格）</li>
  <li><strong>阴道用凝胶基质</strong>：Plurol®、Labrasol®</li>
  <li><strong>增溶剂</strong>：Labrafac® Lipophile WL 1349、Transcutol® P</li>
  <li><strong>乳化剂/稳定剂</strong>：Gelot™、Plurol® Diisostearique</li>
</ul>
<h3>技术优势</h3>
<ul>
  <li>多种熔点规格可选，适配不同气候条件</li>
  <li>良好的生物相容性和黏膜刺激性低</li>
  <li>释药速度可控（速释/缓释）</li>
  <li>生产工艺成熟，支持规模化生产</li>
  <li>完善的法规支持（DMF、CEP）</li>
</ul>`
    ),
  },
];

const HERO_BASE = {
  buttons: [] as Array<{ label: string; url: string }>,
  videoUrl: '',
  videoType: '',
};

async function main() {
  for (const p of ROUTE_PAGES) {
    const heroBlock = {
      type: 'hero',
      data: {
        title: p.title,
        summary: p.metaDescription,
        backgroundImage: p.backgroundImage,
        ...HERO_BASE,
      },
    };
    const content = JSON.stringify([heroBlock]);

    const page = await prisma.pageContent.upsert({
      where: { pageKey: p.pageKey },
      update: {
        title: p.title,
        content,
        contentHtml: p.contentHtml,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        sortOrder: 30,
      },
      create: {
        pageKey: p.pageKey,
        title: p.title,
        content,
        contentHtml: p.contentHtml,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        sortOrder: 30,
      },
    });
    console.log(`✅ ${p.pageKey} 已保存 id=${page.id} | 头图=${p.backgroundImage.slice(-50)}`);
  }
  console.log(`\n完成: 共导入 ${ROUTE_PAGES.length} 个给药途径子页面`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());