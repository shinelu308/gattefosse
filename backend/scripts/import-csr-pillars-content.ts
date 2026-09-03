/**
 * CSR 三大支柱子页导入脚本
 * 数据源：原中文站 webNewsEvents ID + webContents content
 * 存储：page_contents (pageKey = 页面 URL slug)
 *
 * 三页信息：
 *   preserving-our-environement  id=199  contentId=1627  title=保护我们的环境
 *   caring-our-people            id=200  contentId=1628  title=关爱我们的员工
 *   acting-world-citizen         id=211  contentId=2835  title=担当世界公民
 *
 * 4 张正文图已从 www.gattefosse.com 下载至本地 /sites/default/files/...：
 *   paragraph_quote/2023-07/citation-segolene-pilier-societal.jpg.webp
 *   paragraphe_image_100/2023-07/initiative-pilier-societal-entreprise-des-possibles.png.webp
 *   paragraphe_image_100/2023-07/initiative-pilier-societal-usa-recolte-legumes_1.jpg.webp
 *   webp/2023-07/initiative-pilier-societal-ethique-des-affaires.jpg.webp
 *
 * 运行: cd backend && npx tsx scripts/import-csr-pillars-content.ts
 * 幂等: pageContent upsert 覆盖
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/utils/prisma';

interface Pillar {
  slug: string;
  newsId: number;
  contentId: number;
  title: string;
  metaTitle: string;
  metaDescription: string;
  heroBg: string;
  apiFile: string;
}

const PILLARS: Pillar[] = [
  {
    slug: 'preserving-our-environement',
    newsId: 199,
    contentId: 1627,
    title: '保护我们的环境',
    metaTitle: '保护我们的环境 ⋅ 嘉法狮',
    metaDescription: '在日常工作中，在公司的各个层面，我们希望减少我们对气候、自然资源和生物多样性的直接或间接的活动所产生的影响。',
    heroBg: '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/visuel-bandeau-pilier-environnement_5.jpg.webp',
    apiFile: 'csr_preserving_our_environement_content.json',
  },
  {
    slug: 'caring-our-people',
    newsId: 200,
    contentId: 1628,
    title: '关爱我们的员工',
    metaTitle: '关爱我们的员工 ⋅ 嘉法狮',
    metaDescription: '我们的员工每天都在努力工作，以确保我们发展的成功并迎接明天的挑战。让他们能够完全安全地工作，促进他们的福祉和职业成就。',
    heroBg: '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/visuel-bandeau-pilier-social_0.jpg.webp',
    apiFile: 'csr_caring_our_people_content.json',
  },
  {
    slug: 'acting-world-citizen',
    newsId: 211,
    contentId: 2835,
    title: '担当世界公民',
    metaTitle: '担当世界公民 ⋅ 嘉法狮',
    metaDescription: '动员我们的员工和合作伙伴为共同利益和道德关系服务是我们文化的一部分。无论是为了健康、环境还是团结，我们每天都致力于各种慈善活动。',
    heroBg: '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/visuel-bandeau-pilier-societal_1.jpg.webp',
    apiFile: 'csr_acting_world_citizen_content.json',
  },
];

/** 重写图片绝对 URL 为本地路径（与 CSR hub 一致） */
function rewriteUrls(raw: string): string {
  return raw
    .replace(/https?:\/\/www\.gattefossechina\.cn\/sites\//g, '/sites/')
    .replace(/https?:\/\/www\.gattefosse\.com\/sites\//g, '/sites/')
    .replace(/\/\/www\.gattefosse\.com\/sites\//g, '/sites/')
    .replace(/\/\/www\.gattefossechina\.cn\/sites\//g, '/sites/');
}

async function main() {
  for (const p of PILLARS) {
    const apiPath = join(__dirname, '../../.localize_tmp', p.apiFile);
    const raw = JSON.parse(readFileSync(apiPath, 'utf-8'));
    const contentHtml = rewriteUrls(raw.data.reWebContents.content);

    const heroBlock = {
      type: 'hero',
      data: {
        title: p.title,
        summary: p.metaDescription,
        backgroundImage: p.heroBg,
        buttons: [] as Array<{ label: string; url: string }>,
        videoUrl: '',
        videoType: '',
      },
    };

    const page = await prisma.pageContent.upsert({
      where: { pageKey: p.slug },
      update: {
        title: p.title,
        content: JSON.stringify([heroBlock]),
        contentHtml,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        sortOrder: 65,
      },
      create: {
        pageKey: p.slug,
        title: p.title,
        content: JSON.stringify([heroBlock]),
        contentHtml,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        sortOrder: 65,
      },
    });

    const imgCount = (contentHtml.match(/<img/g) || []).length;
    console.log(`✅ ${p.slug} 已保存 id=${page.id} | contentHtml=${contentHtml.length}B | images=${imgCount}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());