import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/hash';
import { PC_TAG_DICTIONARY, PHARMA_TAG_DICTIONARY, FORMULATION_TAG_DICTIONARY, DOCUMENT_TYPE } from '../src/types/dictionary';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始种子数据...');

  // 1. 创建超级管理员账号
  const adminExists = await prisma.user.findUnique({
    where: { email: 'admin@gattefosse.cn' },
  });

  if (!adminExists) {
    const passwordHash = await hashPassword('admin123456');
    await prisma.user.create({
      data: {
        email: 'admin@gattefosse.cn',
        passwordHash,
        fullName: '超级管理员',
        company: '嘉法狮中国',
        role: 'super_admin',
        status: 'active',
      },
    });
    console.log('✅ 超级管理员账号创建成功 (admin@gattefosse.cn / admin123456)');
  } else {
    console.log('⏭️  超级管理员账号已存在，跳过');
  }

  // 2. 创建测试编辑账号
  const editorExists = await prisma.user.findUnique({
    where: { email: 'editor@gattefosse.cn' },
  });

  if (!editorExists) {
    const passwordHash = await hashPassword('editor123456');
    await prisma.user.create({
      data: {
        email: 'editor@gattefosse.cn',
        passwordHash,
        fullName: '内容编辑',
        company: '嘉法狮中国',
        role: 'editor',
        status: 'active',
      },
    });
    console.log('✅ 内容编辑账号创建成功 (editor@gattefosse.cn / editor123456)');
  } else {
    console.log('⏭️  内容编辑账号已存在，跳过');
  }

  // 3. 创建系统设置初始数据
  const settings = [
    { key: 'site_name', value: '嘉法狮中国' },
    { key: 'site_description', value: '嘉法狮中国官方网站' },
    { key: 'contact_email', value: 'contact.cn@gattefosse.com' },
    { key: 'contact_phone', value: '+86 21 1234 5678' },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
  console.log('✅ 系统设置初始数据创建成功');

  // 4. 创建静态页面初始数据
  const pages = [
    {
      pageKey: 'about',
      title: '关于嘉法狮',
      contentHtml: '<p>关于嘉法狮的内容，请在管理后台编辑。</p>',
    },
    {
      pageKey: 'history',
      title: '公司历史',
      contentHtml: '<p>公司历史内容，请在管理后台编辑。</p>',
    },
    {
      pageKey: 'expertise_lipid',
      title: '脂质化学',
      contentHtml: '<p>脂质化学内容，请在管理后台编辑。</p>',
    },
    {
      pageKey: 'expertise_plant',
      title: '植物化学',
      contentHtml: '<p>植物化学内容，请在管理后台编辑。</p>',
    },
    {
      pageKey: 'csr',
      title: '企业社会责任',
      contentHtml: '<p>企业社会责任内容，请在管理后台编辑。</p>',
    },
  ];

  for (const page of pages) {
    await prisma.pageContent.upsert({
      where: { pageKey: page.pageKey },
      update: { title: page.title, contentHtml: page.contentHtml },
      create: page,
    });
  }
  console.log('✅ 静态页面初始数据创建成功');

  // 4.1 清空并填充标签字典
  await prisma.tagDictionary.deleteMany();
  console.log('🔄 填充标签字典...');

  let tagCount = 0;
  // 个人护理原料标签
  for (const [category, options] of Object.entries(PC_TAG_DICTIONARY)) {
    for (let i = 0; i < options.length; i++) {
      const tag = options[i];
      await prisma.tagDictionary.create({
        data: {
          category,
          productLine: 'pc',
          label: tag.label,
          value: tag.value,
          sortOrder: i,
        },
      });
      tagCount++;
    }
  }

  // 药用辅料标签
  for (const [category, options] of Object.entries(PHARMA_TAG_DICTIONARY)) {
    for (let i = 0; i < options.length; i++) {
      const tag = options[i];
      await prisma.tagDictionary.create({
        data: {
          category: category === 'dosageForm' ? 'dosage_form' : category,
          productLine: 'pharma',
          label: tag.label,
          value: tag.value,
          sortOrder: i,
        },
      });
      tagCount++;
    }
  }

  // 配方标签
  for (const [category, options] of Object.entries(FORMULATION_TAG_DICTIONARY)) {
    for (let i = 0; i < options.length; i++) {
      const tag = options[i];
      await prisma.tagDictionary.create({
        data: {
          category,
          productLine: 'formulation',
          label: tag.label,
          value: tag.value,
          sortOrder: i,
        },
      });
      tagCount++;
    }
  }

  console.log(`✅ 标签字典填充完成，共 ${tagCount} 条`);

  console.log('🎉 种子数据完成！');
}

main()
  .catch((e) => {
    console.error('❌ 种子数据失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
