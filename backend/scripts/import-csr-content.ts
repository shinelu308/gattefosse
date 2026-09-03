/**
 * 企业社会责任 (corporate-social-responsability) 页面导入脚本
 * 数据源：原中文站 CSR hub 页正文 (webNewsEvents ID=134 → webContents ID=747)
 * 存储：page_contents (pageKey = 'corporate-social-responsability')
 *
 * 图片处理（原站 gattefossechina.cn 的 /sites/... 均返回 HTML 错误页，图片实体在 gattefosse.com）：
 *   1. photo-une-demarche-reconnue-sbti.png.webp  / portrait-laurent-schubnel...  → 已从 www.gattefosse.com 下载本地（同路径）
 *   2. photo-pilier-*（3张，gattefosse.com 已 404）→ 替换为英文站 innovating-care-and-responsibility
 *      2026-03 新版 vignette_impact_environnement / vignette_collaborateurs / vignette_action_sociale（已下载本地）
 *   3. 所有正文 img src 一律改写为本地相对路径 /sites/default/files/...（本地服务 site/ 静态根）
 *
 * 运行: cd backend && npx tsx scripts/import-csr-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

// 原站正文原始 HTML（含 JSON 转义，由脚本内联读取）
const API_FILE = join(__dirname, '../../.localize_tmp/csr_api_747.json');

// 图片替换规则: 原站完整 src URL → 本地完整路径（含 styles 段）
const SRC_PREFIX = 'https://www.gattefosse.com/sites/default/files/styles/webp/public/';
const IMG_REPLACE: Array<[string, string]> = [
  // 3 张 404 的旧 pilier 图 → 英文站 2026-03 新版图
  [
    `${SRC_PREFIX}2023-06/photo-pilier-preserver-notre-environnement.png.webp`,
    '/sites/default/files/styles/webp/public/2026-03/vignette_impact_environnement_gattefosse.png.webp',
  ],
  [
    `${SRC_PREFIX}2023-06/photo-pilier-prendre-soin-de-nos-collaborateurs.png.webp`,
    '/sites/default/files/styles/webp/public/2026-03/vignette_collaborateurs_gattefosse.png.webp',
  ],
  [
    `${SRC_PREFIX}2023-06/photo-pilier-agir-en-citoyen-du-monde.png.webp`,
    '/sites/default/files/styles/webp/public/2026-03/vignette_action_sociale_gattefosse.png.webp',
  ],
];

/** 将原站正文改写为本地可用 HTML */
function buildContentHtml(raw: string): string {
  let html = raw;
  // 1) 应用整 URL 替换规则
  for (const [from, to] of IMG_REPLACE) {
    html = html.split(from).join(to);
  }
  // 2) 其余 www.gattefosse.com/sites/... 绝对地址 → 本地相对 /sites/...
  html = html.replace(/https?:\/\/www\.gattefosse\.com\/sites\//g, '/sites/');
  return html;
}

async function main() {
  const raw = JSON.parse(readFileSync(API_FILE, 'utf-8'));
  const contentHtml = buildContentHtml(raw.data.reWebContents.content);

  const pageKey = 'corporate-social-responsability';
  const title = '企业社会责任';
  const metaTitle = '社会责任 ⋅ 嘉法狮';
  const metaDescription =
    '嘉法狮在对化妆品和医药原料进行创新的同时，始终将科学与社会责任结合起来，尊重所有形式的生活环境。';

  const heroBlock = {
    type: 'hero',
    data: {
      title,
      summary: metaDescription,
      backgroundImage:
        '/sites/default/files/styles/page_banner_desktop_full/public/2023-06/tests-visuels-bandeau-header-page-rse.jpg.webp',
      buttons: [] as Array<{ label: string; url: string }>,
      videoUrl: '',
      videoType: '',
    },
  };
  const content = JSON.stringify([heroBlock]);

  const page = await prisma.pageContent.upsert({
    where: { pageKey },
    update: {
      title,
      content,
      contentHtml,
      metaTitle,
      metaDescription,
      sortOrder: 60,
    },
    create: {
      pageKey,
      title,
      content,
      contentHtml,
      metaTitle,
      metaDescription,
      sortOrder: 60,
    },
  });

  console.log(`✅ corporate-social-responsability 已保存 id=${page.id}`);
  console.log(`   contentHtml 长度: ${contentHtml.length}`);
  const imgs = contentHtml.match(/<img[^>]+src="([^"]+)"/g) || [];
  console.log(`   正文图片 ${imgs.length} 张:`);
  for (const m of contentHtml.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    console.log('     -', m[1]);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
