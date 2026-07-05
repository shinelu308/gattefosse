/**
 * CSR 页面数据导入脚本
 * 从原中文站抓取数据并写入 page_contents 表（pageKey = 'csr'）
 * 
 * 用法：cd backend && node scripts/import-csr-data.js
 */
const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

// CSR 页面结构化区块数据（抓取自原中文站）
const csrBlocks = [
  {
    type: 'hero',
    data: {
      title: '企业社会责任',
      summary: '嘉法狮在对化妆品和医药原料进行创新的同时，始终将科学与社会责任结合起来，**尊重所有形式的生活环境**。我们特别注意管控我们的运营，以降低对周围 **生态系统的影响。**'
    }
  },
  {
    type: 'text',
    data: {
      html: '<p>让我们一起了解我们如何致力于提高负责任的科学水平。</p>'
    }
  },
  {
    type: 'stats',
    data: {
      items: [
        { number: '95', unit: '%', label: '个人护理成分经过 RSPO MB 认证。到 2025 年，100% 将获得认证。' },
        { number: '82', unit: '%', label: '2022 年，82%的生产废物在法国Saint-Priest工厂得到回收。' },
        { number: '40万', unit: '€', label: '2022 年实施企业社会责任行动计划的投入金额。' },
        { number: '34', unit: '', label: '嘉法狮基金会过去 10 年提供的赠款次数。' },
        { number: '91/100', unit: '', label: '2023 年法国职业平等指数。' }
      ]
    }
  },
  {
    type: 'text',
    data: {
      html: '<h2>我们的 2023-2030 年主要目标</h2><p>2023 年，我们决定特别关注减少总体碳排放量。</p><p><a href="https://sciencebasedtargets.org/" target="_blank">基于科学的目标</a>倡议已批准我们的近期基于科学的减排目标，该目标旨在保持温室气体排放符合巴黎 2015 年协议。</p><p>我们的总体目标是 <strong>到 2030 年将温室气体排放总量</strong> 比 2021 年减少 25%（范围 1、2 和 3）。</p><p>嘉法狮历来致力于 <strong>道德、社会、环境和社会责任</strong>。这些承诺已汇总在我们的 <strong>Gatt\'Up&Act</strong> 计划中。</p>'
    }
  },
  {
    type: 'text',
    data: {
      html: '<h2>基于三个关键支柱的战略</h2><p>我们的 Gatt\'Up&Act 计划是我们企业社会责任团队以及所有员工共同协作的结果，围绕集团战略直接相关的 3 个关键支柱构建。</p>'
    }
  },
  {
    type: 'pillar_cards',
    data: {
      cards: [
        {
          imageUrl: 'https://www.gattefossechina.cn/sites/default/files/styles/webp/public/2023-06/photo-une-demarche-reconnue-sbti.png.webp',
          title: '保护我们的环境',
          description: '应对环境突发事件是我们企业社会责任路线图的主要支柱。在嘉法狮，我们专注于减少碳排放、原材料的可持续性以及对我们使用的自然资源进行负责任的管理。',
          linkUrl: '/preserving-our-environement.html'
        },
        {
          imageUrl: 'https://www.gattefossechina.cn/sites/default/files/styles/webp/public/2023-07/action-engages.jpg.webp',
          title: '关爱我们的员工',
          description: '我们的员工每天都在努力工作，以确保我们发展的成功并迎接明天的挑战。让他们能够完全安全地工作，促进他们的福祉和职业成就，同时依靠强大的包容性价值观至关重要。',
          linkUrl: '/caring-our-people.html'
        },
        {
          imageUrl: 'https://www.gattefossechina.cn/sites/default/files/styles/webp/public/2023-07/action-sociaux.jpg.webp',
          title: '担当世界公民',
          description: '动员我们的员工和合作伙伴为共同利益和道德关系服务是我们文化的一部分。无论是为了健康、环境还是团结，我们每天都致力于各种慈善活动。',
          linkUrl: '/acting-world-citizen.html'
        }
      ]
    }
  },
  {
    type: 'quote',
    data: {
      imageUrl: 'https://www.gattefossechina.cn/sites/default/files/styles/webp/public/2023-07/portrait-laurent-schubnel-citation.jpg.webp',
      text: '嘉法狮始终将环境和人类因素融入其整个价值链。我们今天继续发展的正是这种负责任的活动方式，因为它是我们集团创新和绩效的强大杠杆。',
      author: 'Laurent SCHUBNEL',
      title: '嘉法狮集团企业社会责任总监'
    }
  },
  {
    type: 'text',
    data: {
      html: '<h2>公认的企业社会责任表现</h2><p>在持续改进战略的推动下，我们对各种外部评估做出积极回应，制定相应的行动计划。</p>'
    }
  },
  {
    type: 'text',
    data: {
      html: '<h2>社会责任表现</h2><p>EcoVadis评估方法评估了数万家公司，涵盖环境、道德、可持续采购实践、劳工和人权。2023 年，我们以 <strong>75/100</strong> 的总分荣获 <strong>金牌，比 2017 年的第一次评估高出 21 分</strong>。这证实了我们保持和发展对企业社会责任承诺的决心。</p><p>如需查看我们上次评估的详细结果，请访问 <a href="https://ecovadis.com/" target="_blank">ecovadis.com</a> 并请求访问以下帐户：<strong>Gattefossé SAS</strong>。</p>'
    }
  }
];

async function main() {
  console.log('📄 导入 CSR 页面数据...');
  
  const existing = await prisma.pageContent.findUnique({ where: { pageKey: 'csr' } });
  
  if (existing) {
    console.log('  CSR 页面已存在，更新中...');
    await prisma.pageContent.update({
      where: { pageKey: 'csr' },
      data: {
        title: '企业社会责任',
        content: JSON.stringify(csrBlocks),
        updatedAt: new Date(),
      },
    });
  } else {
    console.log('  创建 CSR 页面...');
    await prisma.pageContent.create({
      data: {
        pageKey: 'csr',
        title: '企业社会责任',
        content: JSON.stringify(csrBlocks),
      },
    });
  }
  
  console.log(`  ✅ 已导入 ${csrBlocks.length} 个结构化区块`);
  
  // 验证
  const saved = await prisma.pageContent.findUnique({ where: { pageKey: 'csr' } });
  if (saved) {
    const blocks = JSON.parse(saved.content);
    console.log(`  📊 验证: ${blocks.length} 个区块`);
    blocks.forEach((b, i) => console.log(`    [${i}] ${b.type}`));
  }
}

main()
  .catch(e => { console.error('❌ 错误:', e); process.exit(1); })
  .then(() => prisma.$disconnect());
