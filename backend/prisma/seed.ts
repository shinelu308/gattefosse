import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/hash';
import { PC_TAG_DICTIONARY, PHARMA_TAG_DICTIONARY, FORMULATION_TAG_DICTIONARY, DOCUMENT_TYPE } from '../src/types/dictionary';
import path from 'path';
import fs from 'fs';

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

  // 4.1 标签字典（由数据备份统一恢复，此处跳过）
  // 注：标签字典数据已从 _db_dump.json 恢复（见第5步）
  // 如果运行 seed 时没有备份文件，则会使用下方代码初始化默认标签

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

  // 5. 从数据备份恢复业务数据（PC 产品、内容区块、配方、药用辅料等）
  const backupPath = path.join(__dirname, '../../_db_dump.json');
  if (fs.existsSync(backupPath)) {
    const raw = fs.readFileSync(backupPath, 'utf-8');
    const dump = JSON.parse(raw);

    // 5a. 个人护理原料
    if (dump.pcIngredients && dump.pcIngredients.length > 0) {
      const existingPc = await prisma.pcIngredient.count();
      if (existingPc === 0) {
        for (const item of dump.pcIngredients) {
          await prisma.pcIngredient.create({ data: item });
        }
        console.log(`✅ 恢复 ${dump.pcIngredients.length} 个个人护理原料`);
      } else {
        console.log(`⏭️  个人护理原料已存在 ${existingPc} 条，跳过恢复`);
      }
    }

    // 5b. 内容区块
    if (dump.contentBlocks && dump.contentBlocks.length > 0) {
      const existingBlocks = await prisma.contentBlock.count();
      if (existingBlocks === 0) {
        for (const item of dump.contentBlocks) {
          await prisma.contentBlock.create({ data: item });
        }
        console.log(`✅ 恢复 ${dump.contentBlocks.length} 个内容区块`);
      } else {
        console.log(`⏭️  内容区块已存在 ${existingBlocks} 条，跳过恢复`);
      }
    }

    // 5c. 标签字典（清空重填）
    if (dump.tagDictionary && dump.tagDictionary.length > 0) {
      await prisma.tagDictionary.deleteMany();
      for (const item of dump.tagDictionary) {
        await prisma.tagDictionary.create({ data: item });
      }
      console.log(`✅ 恢复 ${dump.tagDictionary.length} 条标签字典`);
    }

    // 5d. 药用辅料
    if (dump.pharmaProducts && dump.pharmaProducts.length > 0) {
      const existingPharma = await prisma.pharmaProduct.count();
      if (existingPharma === 0) {
        for (const item of dump.pharmaProducts) {
          await prisma.pharmaProduct.create({ data: item });
        }
        console.log(`✅ 恢复 ${dump.pharmaProducts.length} 个药用辅料`);
      } else {
        console.log(`⏭️  药用辅料已存在 ${existingPharma} 条，跳过恢复`);
      }
    }

    // 5e. 文档
    if (dump.documents && dump.documents.length > 0) {
      const existingDocs = await prisma.document.count();
      if (existingDocs === 0) {
        for (const item of dump.documents) {
          await prisma.document.create({ data: item });
        }
        console.log(`✅ 恢复 ${dump.documents.length} 个文档`);
      } else {
        console.log(`⏭️  文档已存在 ${existingDocs} 条，跳过恢复`);
      }
    }

    // 5f. 配方
    if (dump.formulations && dump.formulations.length > 0) {
      const existingFormulas = await prisma.formulation.count();
      if (existingFormulas === 0) {
        for (const item of dump.formulations) {
          await prisma.formulation.create({ data: item });
        }
        console.log(`✅ 恢复 ${dump.formulations.length} 个配方`);
      } else {
        console.log(`⏭️  配方已存在 ${existingFormulas} 条，跳过恢复`);
      }
    }
  } else {
    console.log('⏭️  未找到数据备份文件 (_db_dump.json)，跳过业务数据恢复');
  }

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
