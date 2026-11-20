/**
 * 补齐配方的「附加信息」——对照原中文站
 *   1) formulations.video_url / video_section_title（视频链接 + 视频区标题）
 *   2) formulations.pictos（特点图标 + 图标后标签文字）
 *   3) content_blocks: spec（规格 Specifications）
 *   4) content_blocks: richtext（Operating instruction 配制步骤）
 *
 * 数据源：backend/scripts/data/formula-extras.json
 * 用法：node scripts/seed-formula-extras.js           dry-run
 *       node scripts/seed-formula-extras.js --apply   写库
 *       FORCE=1 ... --apply                           覆盖已存在区块
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';
const SORT_OP = 3;
const SORT_SPEC = 4;
const SORT_RELATED = 9;

const esc = (s) => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const OP_TITLES = ['Operating instruction', '作业指导书', '配制方法', '操作步骤'];
const SPEC_TITLES = ['Specifications', '规格'];

// 原站有的图标文件名带 Drupal 样式后缀（cheveux-gatefosse-icone_1），本地图标名已归一
function normIcon(t) {
  const s = String(t || '').trim();
  if (/^cheveux(-gatefosse-icone(_\d+)?)?$/i.test(s)) return 'cheveux';
  if (/^plante/g.test(s) === false && /gatefosse-icone/i.test(s)) return s.replace(/-gatefosse-icone(_\d+)?$/i, '');
  return s;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'formula-extras.json'), 'utf8'));
  const forms = await prisma.formulation.findMany({ select: { id: true, code: true, name: true, pictos: true, videoUrl: true, videoSectionTitle: true } });
  const byCode = new Map();
  forms.forEach((f) => byCode.set(String(f.code || '').trim(), f));

  const stat = { videoUpd: 0, pictoUpd: 0, specNew: 0, specUpd: 0, specSkip: 0, opNew: 0, opUpd: 0, opSkip: 0, relOrder: 0, missing: [], imgOldDel: 0, pictoDetail: [] };

  for (const ex of data) {
    const f = byCode.get(String(ex.code || '').trim());
    if (!f) { stat.missing.push(ex.code); continue; }

    // ---- 1) 视频 ----
    if (ex.video && ex.video.url) {
      const wantUrl = String(ex.video.url).trim();
      const wantTitle = String(ex.video.title || '').trim();
      if (String(f.videoUrl || '').trim() !== wantUrl || String(f.videoSectionTitle || '').trim() !== wantTitle) {
        stat.videoUpd++;
        if (APPLY) {
          await prisma.formulation.update({ where: { id: f.id }, data: { videoUrl: wantUrl, videoSectionTitle: wantTitle } });
        }
      }
    }

    // ---- 2) 特点图标（只补缺失的图标种类，保留本地已有标签文案）----
    if (Array.isArray(ex.pictos) && ex.pictos.length) {
      let cur = [];
      try { cur = JSON.parse(f.pictos || '[]'); } catch (e) { cur = []; }
      if (!Array.isArray(cur)) cur = [];
      const srcPictos = ex.pictos.map((i) => ({ iconType: normIcon(i.iconType), label: String(i.label || '').trim() }));
      const curTypes = new Set(cur.map((i) => String(i.iconType || '')));
      const missingIcon = srcPictos.some((i) => !curTypes.has(i.iconType));
      if (missingIcon) {
        const labelByType = new Map(cur.map((i) => [String(i.iconType || ''), String(i.label || '')]));
        const rebuilt = srcPictos.map((i) => ({
          iconType: i.iconType,
          label: labelByType.get(i.iconType) || i.label || '',
        }));
        stat.pictoUpd++;
        stat.pictoDetail.push({ code: ex.code, from: cur.map(i => i.iconType + '|' + (i.label || '')).join(','), to: rebuilt.map(i => i.iconType + '|' + (i.label || '')).join(',') });
        if (APPLY) {
          await prisma.formulation.update({ where: { id: f.id }, data: { pictos: JSON.stringify(rebuilt) } });
        }
      }
    }

    // ---- 3) 规格区块 ----
    if (Array.isArray(ex.specRows) && ex.specRows.length) {
      const content = { rows: ex.specRows.map((r) => ({ label: r.label || '', value: r.value || '' })) };
      const exist = await prisma.contentBlock.findFirst({
        where: { productId: f.id, productType: 'formula', blockType: 'spec' },
      });
      if (exist) {
        if (FORCE) {
          stat.specUpd++;
          if (APPLY) {
            await prisma.contentBlock.update({ where: { id: exist.id }, data: { title: ex.specTitle || 'Specifications', content: JSON.stringify(content), sortOrder: SORT_SPEC } });
          }
        } else stat.specSkip++;
      } else {
        stat.specNew++;
        if (APPLY) {
          // 早期手工建的「图文并排 Specifications」会造成重复，替换掉
          const old = await prisma.contentBlock.findMany({
            where: { productId: f.id, productType: 'formula', blockType: 'imagetext', title: { in: SPEC_TITLES } },
          });
          for (const o of old) {
            await prisma.contentBlock.delete({ where: { id: o.id } });
            stat.imgOldDel++;
          }
          await prisma.contentBlock.create({
            data: { productId: f.id, productType: 'formula', blockType: 'spec', title: ex.specTitle || 'Specifications', content: JSON.stringify(content), sortOrder: SORT_SPEC },
          });
        }
      }
    }

    // ---- 4) 配制方法（Operating instruction）----
    if (Array.isArray(ex.opItems) && ex.opItems.length) {
      const html = '<ul>' + ex.opItems.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
      const content = { html };
      const exist = await prisma.contentBlock.findFirst({
        where: { productId: f.id, productType: 'formula', blockType: 'richtext', title: { in: OP_TITLES } },
      });
      if (exist) {
        if (FORCE) {
          stat.opUpd++;
          if (APPLY) await prisma.contentBlock.update({ where: { id: exist.id }, data: { content: JSON.stringify(content), sortOrder: SORT_OP } });
        } else stat.opSkip++;
      } else {
        stat.opNew++;
        if (APPLY) {
          await prisma.contentBlock.create({
            data: { productId: f.id, productType: 'formula', blockType: 'richtext', title: ex.opTitle || 'Operating instruction', content: JSON.stringify(content), sortOrder: SORT_OP },
          });
        }
      }
    }

    // ---- 5) 相关产品推到底 ----
    const rels = await prisma.contentBlock.findMany({ where: { productId: f.id, productType: 'formula', blockType: 'related' } });
    for (const r of rels) {
      if (r.sortOrder !== SORT_RELATED) {
        stat.relOrder++;
        if (APPLY) await prisma.contentBlock.update({ where: { id: r.id }, data: { sortOrder: SORT_RELATED } });
      }
    }
  }

  console.log(JSON.stringify(stat, null, 1));
  console.log(APPLY ? '✅ 已写库' : '🔍 dry-run（未写库，加 --apply 生效）');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
