/**
 * 种子脚本：添加英文站中的作者/专家数据
 * 运行: npx ts-node backend/scripts/seed-authors.ts
 */
import { prisma } from '../src/utils/prisma';

const authors = [
  {
    name: 'Carly-Jean Booker',
    avatar: 'https://www.gattefossechina.cn/uploads/file/c174b0d0203cb9bd759c52183e1e09fd_20250324085207.jpg',
    bio: 'Technical Marketing Lead – Personal Care',
    sortOrder: 1,
  },
  {
    name: 'Ben Blinder',
    avatar: '',
    bio: 'Chief Operating Officer at Gattefossé USA',
    sortOrder: 2,
  },
  {
    name: 'Laurie CANEL',
    avatar: '',
    bio: 'Product Marketing Leader, Active Ingredients',
    sortOrder: 3,
  },
  {
    name: 'Lucie COUTURIER',
    avatar: '',
    bio: 'Head of R&D, Actives Ingredients',
    sortOrder: 4,
  },
  {
    name: 'Marion LECONTE',
    avatar: '',
    bio: 'Marketing Manager Personal Care',
    sortOrder: 5,
  },
  {
    name: 'Elodie MATHA',
    avatar: '',
    bio: 'Technical Marketing Manager, Personal Care',
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
