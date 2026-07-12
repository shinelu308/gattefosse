/**
 * 导入个人护理页面数据
 * 写入 page_contents 表的 content JSON 字段
 * 由 sync-personal-care-import.js 从数据库最新数据生成
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const blocks = [
      {
      'type': 'hero',
      'data': {
        'title': '个人护理',
        'summary': '我们专注于油脂和植物化学两个互补领域的专业知识。这一技术实力使我们能够满足最新的市场趋势，提供**天然高性能活性成分**和**功能性成分**，以其感官益处而闻名。',
        'backgroundImage': 'http://localhost:3000/uploads/images/1783838513988-djces4t_original.webp',
        'buttons': [
          {
            'label': '找到您要的产品',
            'url': '/personal-care/product-finder.html'
          },
          {
            'label': '查找您要的配方',
            'url': '/personal-care/formulation-finder.html'
          }
        ],
        'videoUrl': 'dIF1FOa1BjQ',
        'videoType': ''
      }
    },
    {
      'type': 'feature_cards',
      'data': {
        'title': 'All about Personal Care',
        'items': [
          {
            'imageUrl': '/sites/default/files/2023-06/ingredients_0.svg',
            'icon': '',
            'title': 'Ingredients',
            'description': '为您开发项目寻找最合适的成分。',
            'linkUrl': '/personal-care/product-finder.html'
          },
          {
            'imageUrl': '/sites/default/files/2023-06/formulation.svg',
            'icon': '',
            'title': 'Formulations',
            'description': '探索我们独特的配方库，展示我们的活性成分和质地成分。',
            'linkUrl': '/personal-care/formulation-finder.html'
          },
          {
            'imageUrl': '/sites/default/files/2023-06/get-inspired.svg',
            'icon': '',
            'title': 'Get inspired',
            'description': '阅读我们的最新文章，随时观看无限量的在线研讨会。',
            'linkUrl': '/personal-care/get-inspired.html'
          }
        ]
      }
    },
    {
      'type': 'product_promo',
      'data': {
        'title': 'Eyeglorius™',
        'subtitle': 'Brilliance with every blink',
        'description': 'Eyeglorius™ 是一种脂溶性生物活性物，旨在矫正黑眼圈和浮肿，恢复焕发活力的光彩。',
        'imageUrl': '/sites/default/files/styles/card_default/public/2023-06/gettyimages-1460122345-copie_0.webp',
        'linkUrl': '/personal-care/product-finder/product-detail.html?id=1',
        'linkLabel': '阅读更多'
      }
    },
    {
      'type': 'text',
      'data': {
        'html': '<p>嘉法狮（Gattefossé）在个人护理领域拥有超过一个世纪的经验，是油脂和植物化学两个互补领域的专家。我们为全球化妆品品牌提供创新的活性成分和功能性成分。</p>'
      }
    },
    {
      'type': 'cta_cards',
      'data': {
        'title': '探索更多',
        'cards': [
          {
            'imageUrl': '/sites/default/files/styles/card_default/public/2023-10/istock_38105902_xxlarge.jpg.webp',
            'subtitle': 'Unexpected Suncare',
            'title': '探索独特的感官创新',
            'description': 'Gattefossé 将其感官和配方专业知识应用于防晒产品，以满足不断变化的市场需求。',
            'linkUrl': '/unexpected-suncare.html'
          },
          {
            'imageUrl': '/sites/default/files/styles/card_default/public/2023-07/istock_000054577596_large.jpg.webp',
            'subtitle': 'The Wax Butter Technology',
            'title': '天然和感官配方的解决方案',
            'description': '了解蜡黄油技术的优势，该技术由 Gattefossé 创建并获得专利。',
            'linkUrl': '/wax-butter-technology.html'
          }
        ]
      }
    }
 
];

async function main() {
  // Upsert the personal-care page
  const page = await prisma.pageContent.upsert({
    where: { pageKey: 'personal-care' },
    update: {
      title: '个人护理',
      content: JSON.stringify(blocks),
      metaTitle: '个人护理 | 嘉法狮',
      metaDescription: '嘉法狮在个人护理领域提供油脂和植物化学的专业解决方案，包括活性成分和功能性成分。',
      slug: 'personal-care',
      updatedAt: new Date(),
    },
    create: {
      pageKey: 'personal-care',
      title: '个人护理',
      content: JSON.stringify(blocks),
      metaTitle: '个人护理 | 嘉法狮',
      metaDescription: '嘉法狮在个人护理领域提供油脂和植物化学的专业解决方案，包括活性成分和功能性成分。',
      slug: 'personal-care',
      sortOrder: 30,
    },
  });
  console.log('✅ personal-care page upserted, id:', page.id);
  console.log('   Blocks:', blocks.length, 'types:', blocks.map(b => b.type).join(', '));
}

main()
  .catch(e => { console.error('Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
