/**
 * 补齐药用辅料的全部详情信息 —— 对照原中文站（gattefossechina.cn，商品分类 117）
 *   1) pharma_products.description  完整「简述」（原站 contentId 正文，纯文本）
 *   2) pharma_products.image_url    头部大图本地化（原来指向原站 hotlink）
 *   3) content_blocks 四节：
 *        名称和别称 → spec（标签/值表格）
 *        产品特性   → imagetext（左侧规格表格 + 右侧图片/视频）
 *        主要应用   → imagetext（左侧图片/视频 + 右侧 HTML 富文本）
 *        主要制剂技术 → imagetext / video / richtext
 *
 * 数据源：backend/scripts/data/pharma-blocks.json
 * 用法：node scripts/seed-pharma-blocks.js           dry-run
 *       node scripts/seed-pharma-blocks.js --apply   写库（只新建缺失区块）
 *       FORCE=1 ... --apply                          覆盖已存在且内容不同的区块/字段
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';

const DATA = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'pharma-blocks.json'), 'utf8')
);

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const normJson = (s) => {
  try {
    const v = typeof s === 'string' ? JSON.parse(s) : s;
    return JSON.stringify(v);
  } catch (e) {
    return String(s || '');
  }
};

(async () => {
  console.log('药用辅料条目', DATA.length, APPLY ? '【写库】' : '【dry-run】', FORCE ? 'FORCE' : '');

  const stat = {
    prodDesc: 0, prodDescSkip: 0,
    prodImg: 0, prodImgSkip: 0,
    prodInci: 0,
    blkNew: 0, blkUpd: 0, blkSkip: 0,
    prodMissing: [],
  };

  for (const p of DATA) {
    const prod = await prisma.pharmaProduct.findUnique({ where: { id: p.id } });
    if (!prod) { stat.prodMissing.push(p.id + ' ' + p.name); continue; }

    // ---- 1) 简述 ----
    if (p.introText && norm(prod.description) !== norm(p.introText)) {
      if (FORCE) {
        stat.prodDesc++;
        if (APPLY) await prisma.pharmaProduct.update({ where: { id: p.id }, data: { description: p.introText } });
      } else {
        stat.prodDesc++;
      }
    } else {
      stat.prodDescSkip++;
    }

    // ---- 2) 头部大图本地化 ----
    if (p.headImage && norm(prod.imageUrl) !== norm(p.headImage)) {
      stat.prodImg++;
      if (APPLY) await prisma.pharmaProduct.update({ where: { id: p.id }, data: { imageUrl: p.headImage } });
    } else {
      stat.prodImgSkip++;
    }

    // ---- 2.5) 中文名（后台「INCI 名称」字段在原站实为中文副标题；只在为空时补）----
    if (p.subtitle && !norm(prod.inciName)) {
      stat.prodInci++;
      if (APPLY) await prisma.pharmaProduct.update({ where: { id: p.id }, data: { inciName: p.subtitle } });
    }

    // ---- 3) 区块 ----
    const existing = await prisma.contentBlock.findMany({
      where: { productId: p.id, productType: 'pharma' },
    });

    for (let i = 0; i < p.blocks.length; i++) {
      const b = p.blocks[i];
      const contentStr = JSON.stringify(b.content);
      const match = existing.find(
        (e) => e.blockType === b.blockType && norm(e.title) === norm(b.title)
      );
      if (!match) {
        stat.blkNew++;
        if (APPLY) {
          await prisma.contentBlock.create({
            data: {
              productId: p.id,
              productType: 'pharma',
              blockType: b.blockType,
              title: b.title,
              content: contentStr,
              sortOrder: i,
              isPublished: true,
            },
          });
        }
        continue;
      }
      const same = normJson(match.content) === normJson(contentStr);
      if (same) {
        stat.blkSkip++;
        if (match.sortOrder !== i || match.isPublished !== true) {
          if (APPLY) {
            await prisma.contentBlock.update({ where: { id: match.id }, data: { sortOrder: i, isPublished: true } });
          }
        }
        continue;
      }
      if (FORCE) {
        stat.blkUpd++;
        if (APPLY) {
          await prisma.contentBlock.update({
            where: { id: match.id },
            data: { content: contentStr, sortOrder: i, isPublished: true },
          });
        }
      } else {
        stat.blkSkip++;
      }
    }

    // 多余区块（早期手工）不删，仅提示
    const wanted = new Set(p.blocks.map((b) => b.blockType + '|' + norm(b.title)));
    for (const e of existing) {
      if (!wanted.has(e.blockType + '|' + norm(e.title))) {
        console.log('  ⚠ 多余区块', p.id, p.name, e.blockType, e.title, '(保留)');
      }
    }
  }

  console.log('简述需更新', stat.prodDesc, '已一致', stat.prodDescSkip);
  console.log('头部大图需更新', stat.prodImg, '已一致', stat.prodImgSkip);
  console.log('中文名（INCI 字段）补空', stat.prodInci);
  console.log('区块 新建', stat.blkNew, '更新', stat.blkUpd, '跳过', stat.blkSkip);
  if (stat.prodMissing.length) console.log('缺产品', stat.prodMissing.join(', '));
  await prisma.$disconnect();
})();
