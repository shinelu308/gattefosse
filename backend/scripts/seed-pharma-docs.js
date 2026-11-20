/**
 * 补齐药用辅料的「相关资料」模块 —— 对照原中文站（商品分类 117）的
 * 技术文件 / 产品手册 / 科学文献 三类文档，写入 documents + doc_products。
 *
 * 数据源：backend/scripts/data/pharma-docs.json
 * 文件：  backend/uploads/pharma-docs/（由 .tmp/doc-map.json 映射的本地 PDF）
 *
 * 约定：
 *  - 库里 type 用既有枚举（TDS / Brochure / Publication），前台再映射成
 *    原站中文分组名「技术文件 / 产品手册 / 科学文献」，避免后台类型下拉出现选不中的脏值
 *  - 锁定文档（SDS/RDS 等原站需登录）落 is_public=0，链接指向站内 /account.html，
 *    与原站「点击跳登录页」的行为一致
 *  - 幂等：同 (title, type, file_path) 的文档只建一次；doc_products 关联按
 *    (document_id, product_id, product_type) 去重
 *
 * 用法：node scripts/seed-pharma-docs.js [--apply]
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
// 本地开发库不重复下载 300MB PDF，加此开关跳过文件存在性校验（线上不要用）
const NO_FILE_CHECK = process.argv.includes('--no-file-check');
const DATA = require('./data/pharma-docs.json');
const DOC_DIR = path.join(__dirname, '..', 'uploads', 'pharma-docs');

const TYPE_MAP = { '技术文件': 'TDS', '产品手册': 'Brochure', '科学文献': 'Publication' };
const isZh = (s) => /[\u4e00-\u9fa5]/.test(s);

(async () => {
  console.log('药用辅料「相关资料」补齐 ' + DATA.length + ' 个产品 ' + (APPLY ? '【写库】' : '【dry-run】'));

  const stat = { docNew: 0, docExist: 0, linkNew: 0, linkExist: 0, missingFile: [], noGroup: [] };

  for (const p of DATA) {
    if (!p.groups.length) { stat.noGroup.push(p.id + ' ' + p.name); continue; }
    const pagePath = '/pharmaceuticals/product-finder/product-detail.html?id=' + p.id;

    for (const g of p.groups) {
      const type = TYPE_MAP[g.title];
      if (!type) { console.warn('未知分组: ' + g.title); continue; }

      for (const d of g.docs) {
        let filePath;
        if (d.locked) {
          filePath = '/account.html?url=' + encodeURIComponent(pagePath);
        } else {
          const abs = path.join(DOC_DIR, d.file);
          if (!NO_FILE_CHECK && !fs.existsSync(abs)) { stat.missingFile.push(d.file); continue; }
          filePath = '/uploads/pharma-docs/' + d.file;
        }

        let doc = await prisma.document.findFirst({ where: { title: d.title, type, filePath } });
        if (doc) {
          stat.docExist++;
        } else {
          stat.docNew++;
          if (APPLY) {
            const abs = d.locked ? '' : path.join(DOC_DIR, d.file);
            const size = d.locked ? 0 : (fs.existsSync(abs) ? fs.statSync(abs).size : (d.size || 0));
            doc = await prisma.document.create({
              data: {
                title: d.title,
                type,
                filePath,
                fileSize: BigInt(size),
                language: isZh(d.title) ? 'zh' : 'en',
                isPublic: !d.locked,
              },
            });
          }
        }

        if (APPLY && doc) {
          const link = await prisma.docProduct.findFirst({
            where: { documentId: doc.id, productId: p.id, productType: 'pharma' },
          });
          if (link) stat.linkExist++;
          else {
            await prisma.docProduct.create({
              data: { documentId: doc.id, productId: p.id, productType: 'pharma' },
            });
            stat.linkNew++;
          }
        }
      }
    }
  }

  console.log('文档：新建 ' + stat.docNew + ' / 已存在 ' + stat.docExist);
  if (APPLY) console.log('关联：新建 ' + stat.linkNew + ' / 已存在 ' + stat.linkExist);
  if (stat.noGroup.length) console.log('原站无相关资料：' + stat.noGroup.join(', '));
  if (stat.missingFile.length) console.log('⚠️ 缺文件 ' + stat.missingFile.length + ' 个：' + stat.missingFile.slice(0, 5).join(', '));

  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
