/**
 * 药用辅料页(pharmaceuticals)结构化区块导入 + pharma 分类修正
 * 1) page_contents.pharmaceuticals → content JSON（与后台 hero/text 编辑器 schema 一致）
 * 2) 将 3 篇医药技术文章 139/187/188 归入 category='pharma'
 *
 * 运行: cd backend && npx tsx scripts/import-pharma-content.ts
 * 幂等: pageContent upsert 覆盖；新闻仅 update 指定 id
 */
import { prisma } from '../src/utils/prisma';

const HERO_BG =
  '/sites/default/files/styles/page_banner_desktop_full/public/2023-07/gattefosse_oral_lipid_excipients.jpg.jpg';

// 与原站 www.gattefossechina.cn/pharmaceuticals.html 及 HEAD 镜像 1:1 的内容
const contentBlocks = [
  {
    type: 'hero',
    data: {
      title: '药用辅料',
      summary: '我们提供创新的脂质辅料，由经验丰富的专家提供个性化技术支持。',
      backgroundImage: HERO_BG,
      buttons: [
        { label: '查找产品', url: '/pharmaceuticals/product-finder.html' },
        { label: '查找出版物', url: '/pharmaceuticals/learn-more/publications.html' },
      ],
      videoUrl: '',
      videoType: '',
    },
  },
  {
    type: 'text',
    data: {
      html: '<p>嘉法狮在制药领域拥有超过60年的经验。我们的脂质化学专长覆盖口服固体制剂、半固体制剂等广泛剂型，为您的配方开发提供创新辅料与个性化技术支持。</p>',
    },
  },
  {
    type: 'feature_cards',
    data: {
      title: '关于药用辅料',
      items: [
        {
          title: '产品检索',
          description: '找到最适合您的开发项目的辅料。',
          icon: '--ico-flask',
          linkUrl: '/pharmaceuticals/product-finder.html',
        },
        {
          title: '配方技术',
          description: '了解如何使用我们的脂质辅料进行处方开发。',
          icon: '--magnifying-glass',
          linkUrl: '/formulation-technologies.html',
        },
        {
          title: '市场分类',
          description: '用于人用药、动物用药以及保健食品的辅料。',
          icon: '--list',
          linkUrl: '/markets.html',
        },
        {
          title: '了解更多',
          description: '我们的新闻、出版物、网络研讨会和产品手册。',
          icon: '--book-open',
          linkUrl: '/pharmaceuticals/learn-more.html',
        },
      ],
    },
  },
];

// 医药主题文章（原错标为 pc → pharma）
const PHARMA_ARTICLE_IDS = [139, 187, 188];

async function main() {
  // 1. upsert 页面区块
  const page = await prisma.pageContent.upsert({
    where: { pageKey: 'pharmaceuticals' },
    update: {
      title: '药用辅料',
      content: JSON.stringify(contentBlocks),
      metaTitle: '药用辅料 | 嘉法狮',
      metaDescription:
        '嘉法狮为口服固体制剂和半固体制剂提供创新的脂质辅料，由经验丰富的专家提供个性化技术支持。',
      sortOrder: 25,
    },
    create: {
      pageKey: 'pharmaceuticals',
      title: '药用辅料',
      content: JSON.stringify(contentBlocks),
      metaTitle: '药用辅料 | 嘉法狮',
      metaDescription:
        '嘉法狮为口服固体制剂和半固体制剂提供创新的脂质辅料，由经验丰富的专家提供个性化技术支持。',
      sortOrder: 25,
    },
  });
  console.log(`✅ page_contents.pharmaceuticals 已保存 id=${page.id}`);
  console.log('   content 区块: ' + contentBlocks.map((b) => b.type).join(' → '));

  // 2. 医药文章归类 pharma
  for (const id of PHARMA_ARTICLE_IDS) {
    const exist = await prisma.newsEvent.findUnique({ where: { id } });
    if (!exist) {
      console.warn(`⚠️  新闻 #${id} 不存在，跳过`);
      continue;
    }
    await prisma.newsEvent.update({
      where: { id },
      data: { category: 'pharma', articleType: '专业知识' },
    });
    console.log(`✅ 新闻 #${id}「${exist.title.slice(0, 32)}」category → pharma, articleType → 专业知识`);
  }

  // 3. 校验 pharma 数据量
  const articleCount = await prisma.newsEvent.count({ where: { type: 'article', category: 'pharma' } });
  const eventCount = await prisma.newsEvent.count({ where: { type: 'event', category: 'pharma' } });
  const pubCount = await prisma.newsEvent.count({ where: { type: 'publication', category: 'pharma' } });
  console.log(`\n📊 pharma 数据: article=${articleCount}, event=${eventCount}, publication=${pubCount}`);
  console.log('完成');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
