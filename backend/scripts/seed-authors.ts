/**
 * 种子脚本：添加英文站中的作者/专家数据
 * 运行: npx ts-node backend/scripts/seed-authors.ts
 */
import { prisma } from '../src/utils/prisma';

const authors = [
  {
    name: 'Carly-Jean Booker',
    title: 'Technical Marketing Lead',
    avatar: 'https://www.gattefossechina.cn/uploads/file/c174b0d0203cb9bd759c52183e1e09fd_20250324085207.jpg',
    bio: 'Carly-Jean Booker 是嘉法狮个人护理部门的技术营销主管，专注于天然活性成分和功能性原料的市场推广与应用支持。',
    department: 'Personal Care',
    region: 'UK',
    linkedin: '',
    sortOrder: 1,
  },
  {
    name: 'Ben Blinder',
    title: 'Chief Operating Officer',
    avatar: '',
    bio: 'Ben Blinder 是嘉法狮美国公司的首席运营官，负责美国得克萨斯州 Lufkin 工厂的运营管理，推动北美地区的生产扩张和供应链优化。',
    department: 'Operations',
    region: 'USA',
    linkedin: '',
    sortOrder: 2,
  },
  {
    name: 'Laurie CANEL',
    title: 'Product Marketing Leader, Active Ingredients',
    avatar: '',
    bio: 'Laurie CANEL 是嘉法狮活性成分产品营销负责人，专注于市场趋势分析和创新活性成分的全球推广。',
    department: 'Personal Care',
    region: 'France',
    linkedin: '',
    sortOrder: 3,
  },
  {
    name: 'Lucie COUTURIER',
    title: 'Head of R&D, Actives Ingredients',
    avatar: '',
    bio: 'Lucie COUTURIER 是嘉法狮活性成分研发主管，领导团队通过植物化学、生物加工和皮肤生物学研究开发创新活性物。',
    department: 'R&D',
    region: 'France',
    linkedin: '',
    sortOrder: 4,
  },
  {
    name: 'Marion LECONTE',
    title: 'Marketing Manager',
    avatar: '',
    bio: 'Marion LECONTE 是嘉法狮个人护理市场营销经理，负责品牌策略和市场推广活动。',
    department: 'Personal Care',
    region: 'France',
    linkedin: '',
    sortOrder: 5,
  },
  {
    name: 'Elodie MATHA',
    title: 'Technical Marketing Manager',
    avatar: '',
    bio: 'Elodie MATHA 是嘉法狮个人护理技术营销经理，专注于为客户提供配方开发技术支持和产品应用方案。',
    department: 'Personal Care',
    region: 'France',
    linkedin: '',
    sortOrder: 6,
  },
];

async function main() {
  console.log(`准备插入 ${authors.length} 位作者...`);
  for (const a of authors) {
    // 检查是否已存在同名作者
    const existing = await prisma.author.findFirst({ where: { name: a.name } });
    if (existing) {
      console.log(`跳过(已存在): ${a.name}`);
      continue;
    }
    await prisma.author.create({ data: a });
    console.log(`已添加: ${a.name} (${a.bio})`);
  }
  console.log('完成!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
